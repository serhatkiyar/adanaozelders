"""Tanıtım videosu şemaları ve saf dönüşümler — DB'siz.

* Yükleme başlatma girdisi yalnız `video/*` kabul eder (ön filtre; asıl
  doğrulama worker'da ffprobe ile).
* Public yanıta yalnız ACTIVE video girer; işlenen/onay bekleyen video
  görünmez (eski aktif video yayında kalır — atomik değişim kuralı).
* Kendi görünümünde işlenmiş dosya adresi yalnız PENDING_REVIEW/ACTIVE'de döner.
* Bağlantı satırı (kind=LINK) `intro_video` public alanına hiç girmez; yayındaki
  bağlantı public'e `tutors.intro_video_url` kopyasıyla çıkar.
"""
from __future__ import annotations

import datetime
import types

import pytest
from pydantic import ValidationError

from core.config import settings
from schemas.tutor_video import UploadInitIn
from services import tutor_video_service as svc


def _video(**over):
    base = dict(
        id=7,
        tutor_id=3,
        status="ACTIVE",
        kind="UPLOAD",
        link_url=None,
        source_key="private/tutor-videos/3/abc.bin",
        output_key="tutor-videos/abc.mp4",
        poster_key="tutor-videos/abc.jpg",
        width=1280,
        height=720,
        duration_seconds=61.25,
        error_code=None,
        error_message=None,
        review_note=None,
        created_at=datetime.datetime(2026, 9, 28, tzinfo=datetime.timezone.utc),
        updated_at=datetime.datetime(2026, 9, 28, tzinfo=datetime.timezone.utc),
    )
    base.update(over)
    ns = types.SimpleNamespace(**base)
    ns.is_link = ns.kind == "LINK"
    return ns


@pytest.mark.parametrize("ct", ["video/mp4", "VIDEO/QuickTime", "video/x-matroska", "video/webm"])
def test_video_content_type_kabul(ct):
    assert UploadInitIn(filename="a.mov", size_bytes=10, content_type=ct).content_type.startswith("video/")


@pytest.mark.parametrize(
    "ct, baz",
    [
        ("video/webm;codecs=vp9,opus", "video/webm"),
        ("video/mp4;codecs=avc1,mp4a", "video/mp4"),
        ("video/mp4; charset=x", "video/mp4"),
    ],
)
def test_tarayici_kaydi_parametreli_tip_baz_tipe_kirpilir(ct, baz):
    """MediaRecorder tipi codec parametresiyle gelir; imzalı PUT'a baz tip yazılır."""
    assert UploadInitIn(filename="kamera-kaydi.webm", size_bytes=10, content_type=ct).content_type == baz


@pytest.mark.parametrize("ct", ["image/png", "application/octet-stream", "video/", "text/html", "image/png;x=video/mp4"])
def test_video_disi_content_type_ret(ct):
    with pytest.raises(ValidationError):
        UploadInitIn(filename="a.mp4", size_bytes=10, content_type=ct)


def test_sifir_boyut_ret():
    with pytest.raises(ValidationError):
        UploadInitIn(filename="a.mp4", size_bytes=0, content_type="video/mp4")


@pytest.fixture
def cdn(monkeypatch):
    monkeypatch.setattr(settings, "S3_PUBLIC_BASE_URL", "https://cdn.test")
    monkeypatch.setattr(settings, "S3_PUBLIC_BUCKET", "pub")
    monkeypatch.setattr(settings, "S3_PRIVATE_BUCKET", "priv")


def test_public_yanit_yalniz_active(cdn):
    out = svc.to_public_out(_video())
    assert out is not None and out.kind == "upload"
    dumped = out.model_dump()
    assert dumped["mp4_url"] == "https://cdn.test/tutor-videos/abc.mp4"
    assert dumped["poster_url"] == "https://cdn.test/tutor-videos/abc.jpg"
    assert dumped["duration_seconds"] == pytest.approx(61.25)
    for st in ("PENDING_UPLOAD", "UPLOADED", "PROCESSING", "PENDING_REVIEW", "FAILED", "REJECTED", "REPLACED"):
        assert svc.to_public_out(_video(status=st)) is None
    assert svc.to_public_out(None) is None
    # Çıktısı olmayan ACTIVE (tutarsız veri) public'e çıkmaz.
    assert svc.to_public_out(_video(output_key=None)) is None


def test_kendi_gorunumunde_adres_yalniz_islenmis_durumlarda(cdn):
    islenen = svc.to_own_out(_video(status="PROCESSING"))
    assert islenen.model_dump()["mp4_url"] is None
    bekleyen = svc.to_own_out(_video(status="PENDING_REVIEW"))
    assert bekleyen.model_dump()["mp4_url"] == "https://cdn.test/tutor-videos/abc.mp4"
    basarisiz = svc.to_own_out(
        _video(status="FAILED", error_code="TOO_LONG", error_message="çok uzun", output_key=None)
    )
    assert basarisiz.error_code == "TOO_LONG" and basarisiz.model_dump()["mp4_url"] is None


@pytest.mark.sinifsiz_depo_degeri
def test_kaynak_anahtari_public_yanita_asla_girmez(cdn):
    """Ham yükleme `private/` altındadır; `PublicAsset` onu None'a çevirir
    (fail-closed) — çıktı anahtarı yanlışlıkla kaynağa eşitlense bile sızmaz."""
    out = svc.to_public_out(_video(output_key="private/tutor-videos/3/abc.bin"))
    assert out is not None
    assert out.model_dump()["mp4_url"] is None


def test_baglanti_satiri_public_video_olarak_yayinlanmaz(cdn):
    link = _video(
        kind="LINK",
        link_url="https://youtu.be/dQw4w9WgXcQ",
        source_key=None,
        output_key=None,
        poster_key=None,
    )
    assert svc.to_public_out(link) is None
    # Güvenlik ağı: ACTIVE bağlantı satırında çıktı anahtarı olsa bile public'e girmez.
    assert svc.to_public_out(_video(kind="LINK", link_url="https://vimeo.com/1")) is None
    own = svc.to_own_out(link)
    assert own.kind == "LINK" and own.link_url == "https://youtu.be/dQw4w9WgXcQ"
    assert own.mp4_url is None

async def test_durum_istemciye_cozunurluk_alt_sinirini_verir(monkeypatch):
    """İstemci ön kontrolü worker'ın kısa kenar sınırıyla aynı sayıyı kullanır."""

    async def _yok(*_a, **_k):
        return None

    for ad in ("get_active", "get_in_flight", "_last_failed"):
        monkeypatch.setattr(svc, ad, _yok)
    monkeypatch.setattr(settings, "TUTOR_VIDEO_MIN_HEIGHT", 480)
    tutor = types.SimpleNamespace(id=3, intro_video_url=None)
    durum = await svc.get_state(None, tutor)
    assert durum.min_short_side == 480
    assert durum.min_seconds == settings.TUTOR_VIDEO_MIN_SECONDS
