"""Tanıtım videosu bağlantısı: profil ve ön başvuru aynı kuralı kullanır.

Örnek listesi `frontend/src/lib/video.test.ts` ile aynı tutulur; gömülü
oynatıcıya çevrilemeyen biçim sunucuda da kabul edilmemeli.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from schemas.tutor import TutorProfileUpdate
from schemas.tutor_pre_application import TutorPreApplicationProfileIn

KABUL = [
    "https://youtu.be/dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://vimeo.com/123456789",
    "https://www.vimeo.com/123456789",
    "https://vimeo.com/123456789/abcdef1234",
]

OYNATILAMAZ = [
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "https://www.youtube.com/@kanal",
    "https://www.youtube.com/channels/UC123",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/",
    "https://youtu.be/",
    "https://vimeo.com/kanal",
    "https://vimeo.com/",
]

SHORTS = [
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://m.youtube.com/shorts/dQw4w9WgXcQ",
]

SEMALAR = [TutorProfileUpdate, TutorPreApplicationProfileIn]


def _hata(schema, url: str) -> dict:
    with pytest.raises(ValidationError) as exc:
        schema(intro_video_url=url)
    [err] = exc.value.errors()
    return err


@pytest.mark.parametrize("schema", SEMALAR)
@pytest.mark.parametrize("url", KABUL)
def test_kabul_edilen_bicimler(schema, url):
    assert schema(intro_video_url=url).intro_video_url == url


@pytest.mark.parametrize("schema", SEMALAR)
def test_bos_deger_temizler(schema):
    assert schema(intro_video_url="  ").intro_video_url is None


@pytest.mark.parametrize("schema", SEMALAR)
@pytest.mark.parametrize("url", SHORTS)
def test_shorts_ozel_mesajla_reddedilir(schema, url):
    err = _hata(schema, url)
    assert err["loc"] == ("intro_video_url",)
    assert "Dikey (Shorts) video kabul edilmiyor" in err["msg"]


@pytest.mark.parametrize("schema", SEMALAR)
@pytest.mark.parametrize("url", OYNATILAMAZ)
def test_oynatilamayan_bicim_reddedilir(schema, url):
    err = _hata(schema, url)
    assert err["loc"] == ("intro_video_url",)
    assert "profilde oynatılamıyor" in err["msg"]


@pytest.mark.parametrize("schema", SEMALAR)
@pytest.mark.parametrize(
    "url",
    [
        "http://youtu.be/dQw4w9WgXcQ",
        "https://kotu-site.example/watch?v=abc",
        "https://youtube.com.kotu.example/watch?v=abc",
        "https://youtube.com@kotu.example/watch?v=abc",
    ],
)
def test_guvensiz_konak_reddedilir(schema, url):
    _hata(schema, url)
