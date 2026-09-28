"""FFmpeg/ffprobe komut kurucuları ve probe doğrulaması — SAF, pytest'li.

Güvenlik sözleşmesi:
* Komutlar argüman LİSTESİ olarak kurulur ve `asyncio.create_subprocess_exec`
  ile çalışır — shell yok. Kullanıcı girdisi hiçbir argümana girmez: dosya
  yolları worker'ın kendi ürettiği geçici yollardır.
* Dosya uzantısı ve beyan edilen content-type HİÇ kullanılmaz; tür ve sınırlar
  `ffprobe` çıktısından (`parse_probe`) doğrulanır, çıktı yeniden kodlanır.
* Her çalıştırma zaman aşımına bağlıdır; aşımda süreç `kill` edilir.
"""
from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from typing import Any

#: Çıktı: en fazla 720p, H.264 + AAC, faststart MP4. Çözünürlük üst sınırı;
#: küçük kaynak büyütülmez, dikey video 720 yüksekliğe sığdırılır.
MAX_WIDTH = 1280
MAX_HEIGHT = 720
#: Kaynak sınırları — makul telefon kaydının çok üstündeki her şey reddedilir
#: (aşırı çözünürlük/akış sayısı kaynak tüketen kötü niyetli dosyanın işaretidir).
MAX_SOURCE_DIMENSION = 4096
MAX_STREAMS = 8
#: Bu kadar kısa video için poster 0. saniyeden alınır.
POSTER_SEEK_SECONDS = 1.0


class VideoRejected(Exception):
    """Doğrulama/işleme hatası — `code` makine, `message` eğitmene gösterilen metin."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


@dataclass(frozen=True)
class ProbeInfo:
    duration: float
    width: int
    height: int
    has_audio: bool
    format_name: str


@dataclass(frozen=True)
class RunResult:
    returncode: int
    stdout: str
    stderr: str


def probe_args(path: str) -> list[str]:
    return [
        "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        path,
    ]


def _rotation(stream: dict[str, Any]) -> int:
    """Görüntü dönüşü (derece, 0/90/180/270). Telefonlar görüntüyü yatay
    kaydedip "90 derece çevir" bilgisini ayrı yazar: yeni ffprobe'da
    `side_data_list[].rotation`, eskisinde `tags.rotate`."""
    raw: Any = None
    for sd in stream.get("side_data_list") or []:
        if isinstance(sd, dict) and "rotation" in sd:
            raw = sd.get("rotation")
            break
    if raw is None:
        raw = (stream.get("tags") or {}).get("rotate")
    try:
        return int(round(float(raw))) % 360 if raw is not None else 0
    except (TypeError, ValueError):
        return 0


def _display_size(stream: dict[str, Any]) -> tuple[int, int]:
    """İzleyicinin GÖRDÜĞÜ boyut: 90/270 derece dönüşte genişlik ve yükseklik
    yer değiştirir. Yatay/dikey kararı bu değere göre verilir."""
    width, height = int(stream.get("width") or 0), int(stream.get("height") or 0)
    if _rotation(stream) in (90, 270):
        return height, width
    return width, height


def check_duration(duration: float, *, min_seconds: int, max_seconds: int) -> None:
    """Süre sınırları — kaynak probe'unda ve (kaynak süresi okunamadıysa)
    dönüştürülmüş çıktının probe'unda aynı kural."""
    if duration > max_seconds:
        raise VideoRejected(
            "TOO_LONG",
            f"Video {max_seconds // 60} dakikadan uzun ({int(duration)} sn); kısaltıp yeniden dene",
        )
    if min_seconds and duration < min_seconds:
        raise VideoRejected(
            "TOO_SHORT",
            f"Video çok kısa ({int(duration)} sn); en az {min_seconds} saniye olmalı",
        )


def parse_probe(
    raw: str | dict[str, Any],
    *,
    max_seconds: int,
    min_seconds: int = 0,
    min_short_side: int = 0,
    require_landscape: bool = False,
    allow_missing_duration: bool = False,
) -> ProbeInfo:
    """ffprobe JSON'unu doğrular; kabul edilmezse `VideoRejected`.

    ``allow_missing_duration``: tarayıcı kaydı (MediaRecorder webm) çoğu zaman
    container'a süre yazmaz. O zaman süre 0 döner ve karar dönüştürülmüş
    çıktının probe'unda (`check_duration`) verilir.
    """
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError as exc:
        raise VideoRejected("NOT_VIDEO", "Dosya bir video olarak okunamadı") from exc
    fmt = data.get("format") or {}
    streams = data.get("streams") or []
    if not streams:
        raise VideoRejected("NOT_VIDEO", "Dosya bir video olarak okunamadı")
    if len(streams) > MAX_STREAMS:
        raise VideoRejected("NOT_VIDEO", "Dosya beklenmedik sayıda akış içeriyor")
    video_streams = [
        s
        for s in streams
        if s.get("codec_type") == "video"
        # Kapak resmi gibi tek kare "video" akışları gerçek görüntü değildir.
        and str(s.get("disposition", {}).get("attached_pic", 0)) != "1"
    ]
    if not video_streams:
        raise VideoRejected("NOT_VIDEO", "Dosyada görüntü akışı yok (ses ya da resim olabilir)")
    video = video_streams[0]
    width, height = _display_size(video)
    if width <= 0 or height <= 0:
        raise VideoRejected("NOT_VIDEO", "Görüntü boyutu okunamadı")
    if width > MAX_SOURCE_DIMENSION or height > MAX_SOURCE_DIMENSION:
        raise VideoRejected("TOO_LARGE", "Çözünürlük çok yüksek; 4K veya daha küçük bir kayıt yükle")
    if require_landscape and height > width:
        raise VideoRejected(
            "VERTICAL", "Video dikey çekilmiş; telefonu yatay tutarak yeniden çek"
        )
    if min_short_side and min(width, height) < min_short_side:
        raise VideoRejected(
            "LOW_RESOLUTION",
            f"Görüntü çözünürlüğü çok düşük ({width}×{height}); en az {min_short_side}p bir kayıt yükle",
        )
    try:
        duration = float(fmt.get("duration") or video.get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0.0
    if duration <= 0:
        if not allow_missing_duration:
            raise VideoRejected("NOT_VIDEO", "Video süresi okunamadı")
        duration = 0.0
    else:
        check_duration(duration, min_seconds=min_seconds, max_seconds=max_seconds)
    has_audio = any(s.get("codec_type") == "audio" for s in streams)
    return ProbeInfo(
        duration=duration,
        width=width,
        height=height,
        has_audio=has_audio,
        format_name=str(fmt.get("format_name") or ""),
    )


def transcode_args(src: str, out: str, *, max_seconds: int, threads: int = 2) -> list[str]:
    """720p H.264/AAC faststart MP4. Meta veri (GPS, cihaz) ve bölümler atılır;
    altyazı/data akışları dışlanır; ses varsa ilk ses akışı (`?` = isteğe bağlı)."""
    scale = (
        f"scale='min({MAX_WIDTH},iw)':'min({MAX_HEIGHT},ih)'"
        ":force_original_aspect_ratio=decrease:force_divisible_by=2"
    )
    return [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        src,
        "-t",
        str(max_seconds),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-sn",
        "-dn",
        "-vf",
        scale,
        "-fpsmax",
        "30",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-profile:v",
        "high",
        "-level",
        "4.0",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        "-map_metadata",
        "-1",
        "-map_metadata:s",
        "-1",
        "-map_chapters",
        "-1",
        "-threads",
        str(threads),
        out,
    ]


def poster_args(src: str, out: str, *, duration: float) -> list[str]:
    seek = POSTER_SEEK_SECONDS if duration > POSTER_SEEK_SECONDS + 0.5 else 0.0
    return [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{seek:.1f}",
        "-i",
        src,
        "-frames:v",
        "1",
        "-q:v",
        "3",
        out,
    ]


def _lower_priority() -> None:  # pragma: no cover — yalnız POSIX'te çağrılır
    try:
        os.nice(10)
    except Exception:  # noqa: BLE001
        pass


async def run(args: list[str], *, timeout: float, on_start=None) -> RunResult:
    """Komutu shell'siz çalıştırır; zaman aşımında süreci öldürür.

    `on_start(proc)` çağırana süreç tutamağını verir (SIGTERM'de öldürmek için).
    """
    kwargs: dict[str, Any] = {
        "stdout": asyncio.subprocess.PIPE,
        "stderr": asyncio.subprocess.PIPE,
    }
    if hasattr(os, "nice"):
        kwargs["preexec_fn"] = _lower_priority
    proc = await asyncio.create_subprocess_exec(*args, **kwargs)
    if on_start is not None:
        on_start(proc)
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise VideoRejected(
            "TIMEOUT", "İşleme zaman aşımına uğradı; videoyu kısaltıp yeniden dene"
        ) from None
    return RunResult(
        returncode=proc.returncode or 0,
        stdout=stdout.decode("utf-8", "replace"),
        stderr=stderr.decode("utf-8", "replace"),
    )
