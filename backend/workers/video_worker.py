"""Eğitmen tanıtım videosu işçisi — ayrı konteyner (`python -m workers.video_worker`).

Neden ayrı süreç: 2 dakikalık 1080p kaynağı 720p'ye çevirmek CPU'yu dakikalarca
doyurur; API süreciyle aynı yerde koşsa istek gecikmesi, health check aşımı ve
restart döngüsü riski doğar. Konteyner `cpus`/`mem_limit` ile sınırlanır,
çökmesi siteyi etkilemez. Kuyruk DB tablosudur (`FOR UPDATE SKIP LOCKED`);
Celery/Redis kuyruğu gerekmez.

Üç KISA transaction, FFmpeg transaction dışında (sunucu tarafı statement
timeout 15 sn):
  1. claim   — UPLOADED → PROCESSING + lock_token + aday çıktı anahtarları
  2. (tx dışı) indir → ffprobe doğrula → ffmpeg → poster → public'e yükle
  3. final   — `lock_token` koşullu; kaybedilirse bu denemenin çıktısı silinir,
               kaynak SİLİNMEZ. Kaynak yalnız kazanan final'den sonra silinir.

Temizlik turu: stale PROCESSING geri alma, yetim PENDING_UPLOAD, terminal
satırların nesneleri.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import shutil
import signal
import sys
import tempfile
from dataclasses import dataclass

from core import storage, ws_outbox
from core.config import settings
from core.database import AsyncSessionLocal, engine
from services import tutor_video_service
from workers import ffmpeg

logger = logging.getLogger("adana.video_worker")

_CLEANUP_INTERVAL_SECONDS = 60
# `immutable` yok: kaldırılan/reddedilen video CDN'de uzun süre kalmasın
# (anlık purge yok; bkz. docs/teknik-borc.md).
_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400"


@dataclass
class Outcome:
    ok: bool
    duration: float = 0.0
    width: int = 0
    height: int = 0
    size: int = 0
    code: str = ""
    message: str = ""


class _State:
    """Kapanış (SIGTERM) için süren alt süreç ve deneme kimliği."""

    def __init__(self) -> None:
        self.stop = asyncio.Event()
        self.proc: asyncio.subprocess.Process | None = None
        self.current: tuple[int, str] | None = None  # (video_id, lock_token)

    def track(self, proc) -> None:
        self.proc = proc


async def _run_job(name: str, job) -> None:
    """Hata sınırı: bir iş düşerse yalnız kendisi düşer (main.py deseni)."""
    try:
        await job()
    except Exception:
        logger.exception("video worker işi başarısız: %s", name)


def _probe_dimensions(raw: str) -> tuple[int, int, float]:
    """Çıktı dosyasının (autorotate SONRASI) boyutu ve süresi."""
    info = ffmpeg.parse_probe(raw, max_seconds=10**6)
    return info.width, info.height, info.duration


async def _process(video, state: _State) -> Outcome:
    """Tx dışı ağır iş. Hiçbir durumda eski aktif videoya dokunmaz."""
    workdir = tempfile.mkdtemp(prefix=f"tutor-video-{video.id}-", dir=settings.TUTOR_VIDEO_WORK_DIR)
    src = os.path.join(workdir, "src.bin")
    out = os.path.join(workdir, "out.mp4")
    poster = os.path.join(workdir, "poster.jpg")
    max_bytes = settings.TUTOR_VIDEO_MAX_BYTES
    try:
        size = await storage.head_size(video.source_key)
        if size is None:
            return Outcome(False, code="SOURCE_MISSING", message="Yüklenen dosya bulunamadı")
        if size > max_bytes:
            await storage.delete_key(video.source_key)
            return Outcome(
                False,
                code="TOO_LARGE",
                message=f"Dosya {max_bytes // (1024 * 1024)} MB sınırını aşıyor",
            )
        await storage.download_to_path(video.source_key, src)

        probe = await ffmpeg.run(
            ffmpeg.probe_args(src),
            timeout=settings.TUTOR_VIDEO_PROBE_TIMEOUT_SECONDS,
            on_start=state.track,
        )
        if probe.returncode != 0:
            return Outcome(False, code="NOT_VIDEO", message="Dosya bir video olarak okunamadı")
        kaynak = ffmpeg.parse_probe(
            probe.stdout,
            max_seconds=settings.TUTOR_VIDEO_MAX_SECONDS,
            min_seconds=settings.TUTOR_VIDEO_MIN_SECONDS,
            min_short_side=settings.TUTOR_VIDEO_MIN_HEIGHT,
            require_landscape=True,
            allow_missing_duration=True,
        )
        # Kaynak süresi bilinmiyorsa (tarayıcı kaydı) 1 sn fazlası kesilir:
        # çıktı sınırı aşarsa kaynak uzundur → TOO_LONG (sessizce kırpılmaz).
        kesim = settings.TUTOR_VIDEO_MAX_SECONDS + (0 if kaynak.duration > 0 else 1)

        enc = await ffmpeg.run(
            ffmpeg.transcode_args(src, out, max_seconds=kesim),
            timeout=settings.TUTOR_VIDEO_FFMPEG_TIMEOUT_SECONDS,
            on_start=state.track,
        )
        if enc.returncode != 0 or not os.path.exists(out):
            logger.warning("ffmpeg başarısız (video %s): %s", video.id, enc.stderr[-2000:])
            return Outcome(False, code="FFMPEG_FAILED", message="Video dönüştürülemedi; başka bir kayıt dene")

        verify = await ffmpeg.run(
            ffmpeg.probe_args(out),
            timeout=settings.TUTOR_VIDEO_PROBE_TIMEOUT_SECONDS,
            on_start=state.track,
        )
        if verify.returncode != 0:
            return Outcome(False, code="FFMPEG_FAILED", message="Dönüştürülen video doğrulanamadı")
        width, height, duration = _probe_dimensions(verify.stdout)
        ffmpeg.check_duration(
            duration,
            min_seconds=settings.TUTOR_VIDEO_MIN_SECONDS,
            max_seconds=settings.TUTOR_VIDEO_MAX_SECONDS,
        )

        pst = await ffmpeg.run(
            ffmpeg.poster_args(out, poster, duration=duration),
            timeout=settings.TUTOR_VIDEO_PROBE_TIMEOUT_SECONDS,
            on_start=state.track,
        )
        has_poster = pst.returncode == 0 and os.path.exists(poster)

        await storage.upload_public_file(
            video.output_key, out, content_type="video/mp4", cache_control=_CACHE_CONTROL
        )
        if has_poster:
            await storage.upload_public_file(
                video.poster_key, poster, content_type="image/jpeg", cache_control=_CACHE_CONTROL
            )
        return Outcome(
            True,
            duration=duration,
            width=width,
            height=height,
            size=os.path.getsize(out),
        )
    except ffmpeg.VideoRejected as exc:
        return Outcome(False, code=exc.code, message=exc.message)
    finally:
        state.proc = None
        shutil.rmtree(workdir, ignore_errors=True)


async def _commit_and_flush(db) -> None:
    await db.commit()
    # Bildirim push'ları yalnız commit başarılıysa (core/database.get_db deseni).
    await ws_outbox.flush(db)


async def process_one(state: _State) -> bool:
    """Bir kayıt işler; kuyruk boşsa False."""
    async with AsyncSessionLocal() as db:
        video = await tutor_video_service.claim_next(db)
        if video is None:
            return False
        await db.commit()
        video_id, lock_token = video.id, video.lock_token
        output_key, poster_key = video.output_key, video.poster_key

    state.current = (video_id, lock_token)
    try:
        outcome = await _process(video, state)
    except asyncio.CancelledError:
        # Kapanış: kuyruğa geri koy, bu denemenin çıktısını sil.
        async with AsyncSessionLocal() as db:
            await tutor_video_service.requeue(db, video_id, lock_token)
            await db.commit()
        await storage.delete_key(output_key)
        await storage.delete_key(poster_key)
        raise
    except Exception:
        # Beklenmeyen hata (depo, disk…): kayıt 20 dk PROCESSING'de kalmasın.
        # Hak varsa kuyruğa döner (deneme sayılır), yoksa FAILED/INTERNAL.
        logger.exception("video %s işlenirken beklenmeyen hata", video_id)
        async with AsyncSessionLocal() as db:
            await tutor_video_service.fail_or_retry(db, video_id, lock_token)
            await _commit_and_flush(db)
        await storage.delete_key(output_key)
        await storage.delete_key(poster_key)
        return True
    finally:
        state.current = None

    async with AsyncSessionLocal() as db:
        if outcome.ok:
            new_status = await tutor_video_service.finalize_success(
                db,
                video_id,
                lock_token,
                duration_seconds=outcome.duration,
                width=outcome.width,
                height=outcome.height,
                output_size_bytes=outcome.size,
            )
            won = new_status is not None
        else:
            won = await tutor_video_service.finalize_failure(
                db, video_id, lock_token, code=outcome.code, message=outcome.message
            )
        await _commit_and_flush(db)

    if not won:
        # Kilit kaybedildi (stale geri alma ya da iptal): kendi çıktımızı
        # siliyoruz, kaynağa DOKUNMUYORUZ (başka deneme onu okuyabilir).
        logger.info("video %s: deneme kilidi kaybedildi, çıktı siliniyor", video_id)
        await storage.delete_key(output_key)
        await storage.delete_key(poster_key)
        return True
    if outcome.ok:
        # Kaynak yalnız kazanan final'den sonra silinir; kalırsa temizlik alır.
        await storage.delete_key(video.source_key)
        logger.info("video %s işlendi → %s (%sx%s, %.1fs)", video_id, new_status, outcome.width, outcome.height, outcome.duration)
    else:
        logger.info("video %s başarısız: %s", video_id, outcome.code)
    return True


async def cleanup_tick() -> None:
    async with AsyncSessionLocal() as db:
        orphans = await tutor_video_service.requeue_stale(db)
        expired = await tutor_video_service.expire_pending_uploads(db)
        await _commit_and_flush(db)
    for out_key, poster_key in orphans:
        await storage.delete_key(out_key)
        await storage.delete_key(poster_key)
    if orphans or expired:
        logger.info("temizlik: %s stale geri alındı, %s yükleme süresi doldu", len(orphans), expired)

    done = failed = 0
    async with AsyncSessionLocal() as db:
        rows = await tutor_video_service.list_for_cleanup(db)
        for v in rows:
            ok = True
            for key in tutor_video_service.object_keys(v):
                try:
                    storage.bucket_for_key(key)
                except ValueError:
                    # Sınıfsız anahtar hiçbir zaman silinemez; beklemek boşuna.
                    logger.warning("video %s: sınıfsız anahtar atlandı: %s", v.id, key)
                    continue
                if not await storage.delete_key(key):
                    ok = False
            if ok:
                v.objects_deleted_at = tutor_video_service._now()
                done += 1
            else:
                # Damga yok → sonraki turda yeniden denenir; `updated_at`
                # ilerletilir ki satır kuyruğun önünü tıkamasın.
                v.updated_at = tutor_video_service._now()
                failed += 1
        await db.commit()
    if rows:
        logger.info("temizlik: %s kaydın nesneleri silindi, %s kayıt yeniden denenecek", done, failed)


def _check_binaries() -> None:
    missing = [b for b in ("ffmpeg", "ffprobe") if shutil.which(b) is None]
    if missing:
        logger.critical("gerekli ikili(ler) yok: %s — imaj `worker` hedefiyle kurulmalı", ", ".join(missing))
        sys.exit(1)


async def main_loop(state: _State) -> None:
    last_cleanup = 0.0
    loop = asyncio.get_running_loop()
    while not state.stop.is_set():
        now = loop.time()
        if now - last_cleanup >= _CLEANUP_INTERVAL_SECONDS:
            last_cleanup = now
            await _run_job("temizlik", cleanup_tick)
        did_work = False
        try:
            did_work = await process_one(state)
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("video işleme turu başarısız")
        if did_work:
            continue
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(state.stop.wait(), timeout=settings.TUTOR_VIDEO_WORKER_POLL_SECONDS)


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    _check_binaries()
    os.makedirs(settings.TUTOR_VIDEO_WORK_DIR, exist_ok=True)
    state = _State()
    loop = asyncio.get_running_loop()
    task = asyncio.create_task(main_loop(state))

    def _shutdown() -> None:
        logger.info("kapanış sinyali alındı")
        state.stop.set()
        if state.proc is not None:
            with contextlib.suppress(ProcessLookupError):
                state.proc.kill()
        task.cancel()

    for sig in (signal.SIGTERM, signal.SIGINT):
        with contextlib.suppress(NotImplementedError):  # Windows
            loop.add_signal_handler(sig, _shutdown)

    logger.info(
        "video worker başladı (poll %ss, ffmpeg tavanı %ss, inceleme %s)",
        settings.TUTOR_VIDEO_WORKER_POLL_SECONDS,
        settings.TUTOR_VIDEO_FFMPEG_TIMEOUT_SECONDS,
        "açık" if settings.TUTOR_VIDEO_REQUIRE_REVIEW else "kapalı",
    )
    try:
        await task
    except asyncio.CancelledError:
        pass
    finally:
        await engine.dispose()
        logger.info("video worker durdu")


if __name__ == "__main__":
    asyncio.run(main())
