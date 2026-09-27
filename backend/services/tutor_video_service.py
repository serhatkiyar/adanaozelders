"""Eğitmen tanıtım videosu — doğrudan yükleme yaşam döngüsü.

Akış: `init_upload` (imzalı PUT) → tarayıcı PUT → `complete_upload` (HEAD ile
boyut) → worker (`claim_next` → FFmpeg → `finalize_*`) → `admin_review`
(ön-moderasyon açıksa) → `activate`.

Atomik değişim kuralı: eski ACTIVE video ve `intro_video_url`, yalnız
`activate` içinde ve aynı transaction'da değişir. Başarısız işleme, red ve
iptal eskiye hiç dokunmaz. Nesne silme HİÇBİR zaman transaction içinde
yapılmaz; terminal duruma düşen satırın nesnelerini worker'ın temizlik turu
(`cleanup_objects`) siler.
"""
from __future__ import annotations

import datetime
import logging
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core import frontend_yollari, storage
from core.config import settings
from models.admin import Admin
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor, TutorStatus
from models.tutor_intro_video import (
    CLEANUP_STATUSES,
    IN_FLIGHT_STATUSES,
    TutorIntroVideo,
    TutorIntroVideoStatus,
)
from schemas.tutor_video import (
    IntroVideoOut,
    TutorIntroVideoOut,
    TutorIntroVideoStateOut,
    UploadInitIn,
    UploadInitOut,
)
from services import notification_service

logger = logging.getLogger("adana.tutor_video")

S = TutorIntroVideoStatus
#: Bildirim bağlantısı — Profilim → Video bölümü.
_VIDEO_LINK = f"{frontend_yollari.ILANIM}?bolum=video"


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _mb(n: int) -> int:
    return n // (1024 * 1024)


# ── Şema dönüşümleri ────────────────────────────────────────────────────────


def to_own_out(v: TutorIntroVideo) -> TutorIntroVideoOut:
    return TutorIntroVideoOut(
        id=v.id,
        status=v.status,
        mp4_url=v.output_key if v.status in (S.PENDING_REVIEW.value, S.ACTIVE.value) else None,
        poster_url=v.poster_key if v.status in (S.PENDING_REVIEW.value, S.ACTIVE.value) else None,
        width=v.width,
        height=v.height,
        duration_seconds=float(v.duration_seconds) if v.duration_seconds is not None else None,
        error_code=v.error_code,
        error_message=v.error_message,
        review_note=v.review_note,
        created_at=v.created_at,
        updated_at=v.updated_at,
    )


def to_public_out(v: TutorIntroVideo | None) -> IntroVideoOut | None:
    """Yalnız ACTIVE ve çıktısı olan video public yanıta girer."""
    if v is None or v.status != S.ACTIVE.value or not v.output_key:
        return None
    return IntroVideoOut(
        mp4_url=v.output_key,
        poster_url=v.poster_key,
        width=v.width,
        height=v.height,
        duration_seconds=float(v.duration_seconds) if v.duration_seconds is not None else None,
    )


# ── Sorgular ─────────────────────────────────────────────────────────────────


async def get_active(db: AsyncSession, tutor_id: int) -> TutorIntroVideo | None:
    return (
        await db.execute(
            select(TutorIntroVideo).where(
                TutorIntroVideo.tutor_id == tutor_id,
                TutorIntroVideo.status == S.ACTIVE.value,
            )
        )
    ).scalar_one_or_none()


async def get_in_flight(db: AsyncSession, tutor_id: int) -> TutorIntroVideo | None:
    return (
        await db.execute(
            select(TutorIntroVideo).where(
                TutorIntroVideo.tutor_id == tutor_id,
                TutorIntroVideo.status.in_(IN_FLIGHT_STATUSES),
            )
        )
    ).scalar_one_or_none()


async def _last_failed(db: AsyncSession, tutor_id: int) -> TutorIntroVideo | None:
    """Son başarısız deneme — eğitmene 'işlenemedi' + yeniden dene gösterilir.

    Yalnız yolda bir kayıt YOKSA anlamlıdır (yenisi başladıysa eski hata gizlenir);
    eğitmen "Kapat" ile (iptal → REPLACED) listeden düşürür. Nesnelerin
    silinmiş olması hatayı GİZLEMEZ (temizlik turu dakikalar içinde koşar).
    """
    return (
        await db.execute(
            select(TutorIntroVideo)
            .where(
                TutorIntroVideo.tutor_id == tutor_id,
                TutorIntroVideo.status.in_((S.FAILED.value, S.REJECTED.value)),
            )
            .order_by(TutorIntroVideo.updated_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def get_state(db: AsyncSession, tutor: Tutor) -> TutorIntroVideoStateOut:
    active = await get_active(db, tutor.id)
    pending = await get_in_flight(db, tutor.id)
    if pending is None:
        pending = await _last_failed(db, tutor.id)
    return TutorIntroVideoStateOut(
        active=to_own_out(active) if active else None,
        pending=to_own_out(pending) if pending else None,
        link_url=tutor.intro_video_url,
        uploads_enabled=settings.TUTOR_VIDEO_UPLOADS_ENABLED,
        max_bytes=settings.TUTOR_VIDEO_MAX_BYTES,
        max_seconds=settings.TUTOR_VIDEO_MAX_SECONDS,
        require_review=settings.TUTOR_VIDEO_REQUIRE_REVIEW,
    )


async def _own_or_404(db: AsyncSession, tutor: Tutor, video_id: int) -> TutorIntroVideo:
    v = (
        await db.execute(
            select(TutorIntroVideo).where(
                TutorIntroVideo.id == video_id, TutorIntroVideo.tutor_id == tutor.id
            )
        )
    ).scalar_one_or_none()
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video kaydı bulunamadı")
    return v


# ── Eğitmen akışı ────────────────────────────────────────────────────────────


async def init_upload(db: AsyncSession, tutor: Tutor, payload: UploadInitIn) -> UploadInitOut:
    if not settings.TUTOR_VIDEO_UPLOADS_ENABLED:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Video yükleme geçici olarak kapalı"
        )
    if tutor.status == TutorStatus.PENDING_APPROVAL:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Profilin onay sürecinde; bu sırada video yüklenemez",
        )
    if payload.size_bytes > settings.TUTOR_VIDEO_MAX_BYTES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Video en fazla {_mb(settings.TUTOR_VIDEO_MAX_BYTES)} MB olabilir",
        )
    if await get_in_flight(db, tutor.id) is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Zaten işlemde olan bir videon var; önce onu iptal et ya da bitmesini bekle",
        )
    ttl = settings.TUTOR_VIDEO_UPLOAD_TTL_SECONDS
    expires_at = _now() + datetime.timedelta(seconds=ttl)
    video = TutorIntroVideo(
        tutor_id=tutor.id,
        status=S.PENDING_UPLOAD.value,
        source_key=storage.tutor_video_source_key(tutor.id),
        declared_size_bytes=payload.size_bytes,
        declared_content_type=payload.content_type,
        upload_expires_at=expires_at,
    )
    db.add(video)
    try:
        await db.flush()
    except IntegrityError:
        # Kısmi unique (tek yolda video): eşzamanlı ikinci başlatma.
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Zaten işlemde olan bir videon var"
        ) from None
    upload_url = storage.presign_put(
        video.source_key, content_type=payload.content_type, ttl_seconds=ttl
    )
    return UploadInitOut(
        video_id=video.id,
        upload_url=upload_url,
        headers={"Content-Type": payload.content_type},
        expires_at=expires_at,
    )


async def complete_upload(db: AsyncSession, tutor: Tutor, video_id: int) -> TutorIntroVideoOut:
    """Tarayıcı PUT'u bitirdi: nesne var mı, boyutu sınırda mı? → UPLOADED.

    Boyut aşımı 4xx DEĞİL, FAILED durumu döner: hata yükseltilse transaction
    geri alınır, satır PENDING_UPLOAD'da takılır ve eğitmen temizlik turuna
    kadar yeni video başlatamaz.
    """
    v = await _own_or_404(db, tutor, video_id)
    if v.status != S.PENDING_UPLOAD.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu yükleme zaten tamamlanmış")
    size = await storage.head_size(v.source_key)
    if size is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Yüklenen dosya bulunamadı; yüklemeyi yeniden dene"
        )
    if size > settings.TUTOR_VIDEO_MAX_BYTES:
        await storage.delete_key(v.source_key)
        v.status = S.FAILED.value
        v.error_code = "TOO_LARGE"
        v.error_message = f"Dosya {_mb(settings.TUTOR_VIDEO_MAX_BYTES)} MB sınırını aşıyor"
        v.objects_deleted_at = _now()  # kaynak zaten silindi, çıktı yok
        await db.flush()
        return to_own_out(v)
    v.declared_size_bytes = size
    v.status = S.UPLOADED.value
    await db.flush()
    return to_own_out(v)


async def cancel_upload(db: AsyncSession, tutor: Tutor, video_id: int) -> None:
    """Yolda ya da başarısız kaydı kaldırır. PROCESSING de iptal edilebilir:
    worker'ın final UPDATE'i `status='PROCESSING'` koşuluyla yazıldığından
    kaybeden deneme kendi çıktısını siler."""
    v = await _own_or_404(db, tutor, video_id)
    if v.status not in IN_FLIGHT_STATUSES + (S.FAILED.value, S.REJECTED.value):
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu kayıt iptal edilemez")
    v.status = S.REPLACED.value
    v.lock_token = None
    await db.flush()


async def remove_active(db: AsyncSession, tutor: Tutor) -> None:
    active = await get_active(db, tutor.id)
    if active is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Yayında yüklenmiş video yok")
    active.status = S.REPLACED.value
    await db.flush()


async def replace_active_for_link(db: AsyncSession, tutor_id: int) -> bool:
    """Eğitmen YouTube/Vimeo bağlantısı kaydederken aktif upload'ı düşürür
    (tek kaynak kuralı; `tutor_service.update_profile` çağırır)."""
    active = await get_active(db, tutor_id)
    if active is None:
        return False
    active.status = S.REPLACED.value
    return True


async def activate(db: AsyncSession, video: TutorIntroVideo) -> None:
    """Yeni videoyu yayına alır — TEK transaction: önceki ACTIVE → REPLACED,
    bu → ACTIVE, `intro_video_url` → NULL. Nesne silme burada YAPILMAZ."""
    prev = await get_active(db, video.tutor_id)
    if prev is not None and prev.id != video.id:
        prev.status = S.REPLACED.value
        await db.flush()  # kısmi unique (tek ACTIVE) için sıra önemli
    video.status = S.ACTIVE.value
    tutor = await db.get(Tutor, video.tutor_id)
    if tutor is not None:
        tutor.intro_video_url = None
    await db.flush()


# ── Admin ────────────────────────────────────────────────────────────────────


async def admin_list_pending(db: AsyncSession) -> list[tuple[TutorIntroVideo, Tutor]]:
    stmt = (
        select(TutorIntroVideo, Tutor)
        .join(Tutor, Tutor.id == TutorIntroVideo.tutor_id)
        .where(TutorIntroVideo.status == S.PENDING_REVIEW.value)
        .order_by(TutorIntroVideo.updated_at.asc())
    )
    return [(v, t) for v, t in (await db.execute(stmt)).all()]


async def admin_review(
    db: AsyncSession,
    video_id: int,
    admin: Admin,
    *,
    action: str,
    note: str | None = None,
) -> TutorIntroVideo:
    """Onayla → aktifleşir; reddet → REJECTED (ACTIVE olan da sonradan
    kaldırılabilir). Eğitmene bildirim gider; audit çağıran router'da."""
    v = await db.get(TutorIntroVideo, video_id)
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video kaydı bulunamadı")
    if action == "approve":
        if v.status != S.PENDING_REVIEW.value:
            raise HTTPException(status.HTTP_409_CONFLICT, "Yalnız onay bekleyen video onaylanır")
        await activate(db, v)
        v.reviewed_by = admin.id
        v.reviewed_at = _now()
        v.review_note = None
        message = "Tanıtım videon onaylandı ve profilinde yayında."
    elif action == "reject":
        if v.status not in (S.PENDING_REVIEW.value, S.ACTIVE.value):
            raise HTTPException(status.HTTP_409_CONFLICT, "Bu video reddedilemez")
        v.status = S.REJECTED.value
        v.reviewed_by = admin.id
        v.reviewed_at = _now()
        v.review_note = note
        message = "Tanıtım videon onaylanmadı" + (f": {note}" if note else ".")
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Geçersiz işlem")
    await db.flush()
    await notification_service.notify(
        db,
        user_id=v.tutor_id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message=message,
        link=_VIDEO_LINK,
    )
    await db.refresh(v)
    return v


# ── Worker tarafı (DB adımları; FFmpeg `workers/` içinde) ────────────────────


async def claim_next(db: AsyncSession) -> TutorIntroVideo | None:
    """Sıradaki UPLOADED kaydı alır (FOR UPDATE SKIP LOCKED) ve PROCESSING'e
    çeker. Çağıran commit eder. Çıktı anahtarları deneme başına yenidir."""
    v = (
        await db.execute(
            select(TutorIntroVideo)
            .where(TutorIntroVideo.status == S.UPLOADED.value)
            .order_by(TutorIntroVideo.created_at)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
    ).scalar_one_or_none()
    if v is None:
        return None
    v.status = S.PROCESSING.value
    v.lock_token = uuid.uuid4().hex
    v.processing_started_at = _now()
    v.attempts = (v.attempts or 0) + 1
    v.output_key, v.poster_key = storage.tutor_video_output_keys()
    await db.flush()
    return v


async def _locked_processing(
    db: AsyncSession, video_id: int, lock_token: str
) -> TutorIntroVideo | None:
    """Satırı kilitler ve hâlâ BU denemeye ait PROCESSING ise döner; değilse
    (stale geri alma, iptal) None → çağıran sonucu atar."""
    v = (
        await db.execute(
            select(TutorIntroVideo)
            .where(TutorIntroVideo.id == video_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if v is None or v.status != S.PROCESSING.value or v.lock_token != lock_token:
        return None
    return v


async def finalize_success(
    db: AsyncSession,
    video_id: int,
    lock_token: str,
    *,
    duration_seconds: float,
    width: int,
    height: int,
    output_size_bytes: int,
) -> str | None:
    """Sonucu yazar; yeni durumu döner. Kilit kaybedilmişse None (çağıran kendi
    çıktısını siler, kaynağı SİLMEZ)."""
    v = await _locked_processing(db, video_id, lock_token)
    if v is None:
        return None
    v.duration_seconds = round(duration_seconds, 2)
    v.width, v.height = width, height
    v.output_size_bytes = output_size_bytes
    v.error_code = v.error_message = None
    v.lock_token = None
    v.processing_started_at = None
    if settings.TUTOR_VIDEO_REQUIRE_REVIEW:
        v.status = S.PENDING_REVIEW.value
        message = "Tanıtım videon işlendi; onaylanınca profilinde yayına girecek."
    else:
        await activate(db, v)
        message = "Tanıtım videon işlendi ve profilinde yayında."
    await db.flush()
    await notification_service.notify(
        db,
        user_id=v.tutor_id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message=message,
        link=_VIDEO_LINK,
    )
    return v.status


async def finalize_failure(
    db: AsyncSession, video_id: int, lock_token: str, *, code: str, message: str
) -> bool:
    v = await _locked_processing(db, video_id, lock_token)
    if v is None:
        return False
    v.status = S.FAILED.value
    v.error_code = code
    v.error_message = message[:500]
    v.lock_token = None
    v.processing_started_at = None
    await db.flush()
    await notification_service.notify(
        db,
        user_id=v.tutor_id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message=f"Tanıtım videon işlenemedi: {message}",
        link=_VIDEO_LINK,
    )
    return True


async def requeue(db: AsyncSession, video_id: int, lock_token: str) -> bool:
    """Worker kapanırken (SIGTERM) süren denemeyi kuyruğa geri koyar."""
    v = await _locked_processing(db, video_id, lock_token)
    if v is None:
        return False
    v.status = S.UPLOADED.value
    v.lock_token = None
    v.processing_started_at = None
    v.attempts = max((v.attempts or 1) - 1, 0)  # kesinti deneme sayılmaz
    await db.flush()
    return True


async def requeue_stale(db: AsyncSession) -> list[tuple[str | None, str | None]]:
    """PROCESSING'de takılı kalan satırları geri alır (çöken worker). Dönen:
    çöken denemenin aday çıktı anahtarları — çağıran best-effort siler."""
    cutoff = _now() - datetime.timedelta(minutes=settings.TUTOR_VIDEO_STALE_MINUTES)
    rows = (
        (
            await db.execute(
                select(TutorIntroVideo)
                .where(
                    TutorIntroVideo.status == S.PROCESSING.value,
                    TutorIntroVideo.processing_started_at < cutoff,
                )
                .with_for_update(skip_locked=True)
            )
        )
        .scalars()
        .all()
    )
    orphans: list[tuple[str | None, str | None]] = []
    for v in rows:
        orphans.append((v.output_key, v.poster_key))
        v.lock_token = None
        v.processing_started_at = None
        if (v.attempts or 0) < settings.TUTOR_VIDEO_MAX_ATTEMPTS:
            v.status = S.UPLOADED.value
        else:
            v.status = S.FAILED.value
            v.error_code = "TIMEOUT"
            v.error_message = "İşleme zaman aşımına uğradı; videoyu kısaltıp yeniden dene"
            v.output_key = v.poster_key = None
    await db.flush()
    return orphans


async def expire_pending_uploads(db: AsyncSession) -> int:
    cutoff = _now() - datetime.timedelta(hours=settings.TUTOR_VIDEO_PENDING_UPLOAD_TTL_HOURS)
    rows = (
        (
            await db.execute(
                select(TutorIntroVideo).where(
                    TutorIntroVideo.status == S.PENDING_UPLOAD.value,
                    TutorIntroVideo.upload_expires_at < cutoff,
                )
            )
        )
        .scalars()
        .all()
    )
    for v in rows:
        v.status = S.EXPIRED.value
    await db.flush()
    return len(rows)


async def list_for_cleanup(db: AsyncSession, *, limit: int = 20) -> list[TutorIntroVideo]:
    """Terminal durumda olup nesneleri henüz silinmemiş kayıtlar."""
    return (
        (
            await db.execute(
                select(TutorIntroVideo)
                .where(
                    TutorIntroVideo.status.in_(CLEANUP_STATUSES),
                    TutorIntroVideo.objects_deleted_at.is_(None),
                )
                .order_by(TutorIntroVideo.updated_at)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )


def object_keys(v: TutorIntroVideo) -> list[str]:
    return [k for k in (v.source_key, v.output_key, v.poster_key) if k]


async def anonymize_for_account_deletion(db: AsyncSession, tutor_id: int) -> list[str]:
    """Hesap silme: bütün kayıtları REPLACED'a çeker, nesne anahtarlarını döner
    (çağıran commit SONRASI best-effort siler; satırlar CASCADE ile gider)."""
    rows = (
        (
            await db.execute(
                select(TutorIntroVideo).where(TutorIntroVideo.tutor_id == tutor_id)
            )
        )
        .scalars()
        .all()
    )
    keys: list[str] = []
    for v in rows:
        if v.objects_deleted_at is None:
            keys.extend(object_keys(v))
        v.status = S.REPLACED.value
        v.lock_token = None
    return keys
