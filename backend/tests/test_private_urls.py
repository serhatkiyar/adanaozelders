"""Hassas dosya adreslerinin sınıflandırılması ve yanıt gövdesinde imzalanması.

Kapsanan kural: yanıttan çıkan hiçbir ``private/`` adresi imzasız kalmaz, ve
imzalama yalnız BİZİM bucket'ımızdaki adreslere dokunur.
"""
import json

import pytest

from core import private_urls, storage
from core.config import settings


@pytest.fixture
def bucket() -> str:
    return settings.AWS_BUCKET_NAME


def _url(key: str) -> str:
    return storage.object_url(key)


# ── Anahtar/URL sınıflandırma ───────────────────────────────────────────────────


def test_key_from_url_bizim_bucket():
    assert storage.key_from_url(_url("private/answer-keys/x.pdf")) == (
        "private/answer-keys/x.pdf"
    )


def test_key_from_url_sorgu_parametresini_atar():
    """İmzalı bir adres tekrar işlenirse anahtar yine doğru çıkmalı."""
    assert storage.key_from_url(_url("avatars/a.webp") + "?X-Amz-Signature=abc") == (
        "avatars/a.webp"
    )


def test_key_from_url_yabanci_adres_tanimaz():
    assert storage.key_from_url("https://example.com/private/gizli.pdf") is None
    assert storage.key_from_url(None) is None
    assert storage.key_from_url("") is None


def test_is_private_url_ayrimi():
    assert storage.is_private_url(_url("private/education-docs/d.pdf"))
    assert not storage.is_private_url(_url("avatars/a.webp"))
    assert not storage.is_private_url(_url("library-photos/l.webp"))


# ── Gövde dönüşümü ──────────────────────────────────────────────────────────────


def test_govdedeki_private_adres_imzalanir():
    body = json.dumps({"download_url": _url("private/digital-assets/kitap.pdf")}).encode()
    out = json.loads(private_urls.sign_body(body))
    assert out["download_url"] != _url("private/digital-assets/kitap.pdf")
    assert "X-Amz-Signature" in out["download_url"]
    assert "private/digital-assets/kitap.pdf" in out["download_url"]


def test_ic_ice_yapida_da_imzalanir():
    """Adresler kalem listelerinde taşınıyor — katmanın asıl varlık sebebi bu."""
    raw = _url("private/exam-results/karne.pdf")
    body = json.dumps({"items": [{"a": {"result_document_url": raw}}]}).encode()
    out = json.loads(private_urls.sign_body(body))
    assert out["items"][0]["a"]["result_document_url"].startswith(raw + "?")


def test_public_adrese_dokunulmaz():
    body = json.dumps({"avatar_url": _url("avatars/a.webp")}).encode()
    assert private_urls.sign_body(body) == body


def test_yabanci_private_yollu_adrese_dokunulmaz():
    """Kullanıcının girdiği harici bağlantı yanlışlıkla imzalanmamalı."""
    body = json.dumps({"url": "https://baska-site.com/private/dosya.pdf"}).encode()
    assert private_urls.sign_body(body) == body


def test_marker_yoksa_govde_aynen_doner():
    body = b'{"toplam": 3, "ad": "Ali"}'
    assert private_urls.sign_body(body) is body


def test_ayni_adres_birden_cok_yerde_gecerse_hepsi_imzalanir():
    raw = _url("private/delivery-proof/kapi.webp")
    body = json.dumps({"a": raw, "b": raw}).encode()
    out = json.loads(private_urls.sign_body(body))
    assert out["a"] == out["b"]
    assert "X-Amz-Signature" in out["a"]


def test_ayni_anahtara_ayni_adres_doner():
    """Kararlılık: canlı takip 15 sn'de bir yenilenir. İmza her turda değişirse
    tarayıcı önbelleği tutmaz, kurye fotoğrafı ve teslim kanıtı titrer."""
    raw = _url("private/couriers/vesikalik.webp")
    assert storage.presign(raw) == storage.presign(raw)


def test_farkli_anahtarlar_farkli_imza_alir():
    a = storage.presign(_url("private/couriers/a.webp"))
    b = storage.presign(_url("private/couriers/b.webp"))
    assert a != b
