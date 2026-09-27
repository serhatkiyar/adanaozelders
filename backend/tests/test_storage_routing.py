"""Public/private bucket yönlendirmesi — fail-closed sözleşme (R2 geçişi, 27 Eyl 2026).

R2'de önek bazlı bucket policy yoktur; custom domain (cdn) bağlanan public
bucket'ın TAMAMI herkese açıktır. Tek güvenlik sınırı "private anahtar public
bucket'a yazılmaz"dır. Bu dosya o sınırı kilitler:

* bucket yalnız ``bucket_for_key`` ile seçilir, whitelist dışı anahtar hata alır;
* private adres CDN host'uyla ASLA üretilmez; imza yalnız S3 API adresinde;
* her ``upload_*`` doğru bucket'a ve doğru öneke yazar, ACL göndermez.
"""
from __future__ import annotations

import ast
import io
from pathlib import Path
from urllib.parse import urlparse

import pytest
from PIL import Image

from core import storage
from core.config import settings

BACKEND = Path(__file__).resolve().parents[1]

CDN = "https://cdn.adanaozelders.com.tr"
R2_API = "https://hesap123.r2.cloudflarestorage.com"


@pytest.fixture
def r2(monkeypatch):
    """Üretim biçimi: iki ayrı bucket, CDN kökü, R2 S3 API adresi."""
    monkeypatch.setattr(settings, "S3_PUBLIC_BUCKET", "adanaozelders-public")
    monkeypatch.setattr(settings, "S3_PRIVATE_BUCKET", "adanaozelders-private")
    monkeypatch.setattr(settings, "S3_PUBLIC_BASE_URL", CDN)
    monkeypatch.setattr(settings, "AWS_ENDPOINT_URL", R2_API)
    monkeypatch.setattr(settings, "S3_PUBLIC_ENDPOINT_URL", "")
    monkeypatch.setattr(settings, "AWS_REGION_NAME", "auto")
    storage._presign_client.cache_clear()
    storage._presign_cache.clear()
    yield
    storage._presign_client.cache_clear()
    storage._presign_cache.clear()


# ── bucket_for_key: fail-closed ──────────────────────────────────────────────


@pytest.mark.parametrize("prefix", storage.PUBLIC_PREFIXES)
def test_whitelist_onekleri_public_buckete(r2, prefix):
    assert storage.bucket_for_key(f"{prefix}x.webp") == "adanaozelders-public"


def test_private_onek_private_buckete(r2):
    assert storage.bucket_for_key("private/answer-keys/x.pdf") == "adanaozelders-private"


@pytest.mark.parametrize(
    "key",
    ["", "avatars/x.webp", "exam-photos/x.webp", "privat/x.pdf", "Profiles/x.webp",
     "x.webp", "/profiles/x.webp", "profilesx/y.webp"],
)
def test_sinifsiz_anahtar_hata_verir(r2, key):
    """Bilinmeyen önek sessizce public'e DÜŞMEZ; yazım hatası görünür hataya döner."""
    with pytest.raises(ValueError):
        storage.bucket_for_key(key)


def test_public_ve_private_onekler_cakismaz():
    assert not any(p.startswith(storage.PRIVATE_PREFIX) for p in storage.PUBLIC_PREFIXES)
    assert f"{storage.PROFILE_PREFIX}/" in storage.PUBLIC_PREFIXES
    assert "avatars/" not in storage.PUBLIC_PREFIXES


def test_bucket_adlari_bossa_tek_buckete_duser(monkeypatch):
    """Yerel MinIO: tek bucket, ayrımı önek whitelist'li policy yapar."""
    monkeypatch.setattr(settings, "S3_PUBLIC_BUCKET", "")
    monkeypatch.setattr(settings, "S3_PRIVATE_BUCKET", "")
    assert storage.public_bucket() == storage.private_bucket() == settings.AWS_BUCKET_NAME


# ── Adresler: private asla CDN'de değil ─────────────────────────────────────


def test_public_adres_cdn_kokunde_bucket_adi_yolda_yok(r2):
    assert storage.object_url("profiles/a.webp") == f"{CDN}/profiles/a.webp"
    assert storage.public_url("store-hero/b.webp") == f"{CDN}/store-hero/b.webp"


def test_private_adres_cdn_host_u_tasimaz(r2):
    url = storage.object_url("private/education-docs/d.pdf")
    assert urlparse(url).netloc == urlparse(R2_API).netloc
    assert "cdn." not in url
    assert url == f"{R2_API}/adanaozelders-private/private/education-docs/d.pdf"


@pytest.mark.parametrize("key", ["private/x.pdf", "exam-photos/x.webp"])
def test_public_url_private_ya_da_sinifsiz_anahtari_reddeder(r2, key):
    with pytest.raises(ValueError):
        storage.public_url(key)


def test_key_from_url_iki_bicimi_de_cozer(r2):
    assert storage.key_from_url(f"{CDN}/profiles/a.webp") == "profiles/a.webp"
    assert (
        storage.key_from_url(f"{R2_API}/adanaozelders-private/private/x.pdf?X-Amz-Signature=1")
        == "private/x.pdf"
    )
    assert storage.key_from_url("https://baska.site/foo.webp") is None
    assert storage.is_private_url(storage.object_url("private/x.pdf"))
    assert not storage.is_private_url(storage.object_url("profiles/a.webp"))


def test_imza_yalniz_s3_api_adresinde_ve_private_buckette(r2):
    signed = storage.presign(storage.object_url("private/answer-keys/k.pdf"))
    parsed = urlparse(signed)
    assert parsed.netloc == urlparse(R2_API).netloc
    assert "cdn." not in signed
    assert "/adanaozelders-private/private/answer-keys/k.pdf" in parsed.path
    assert "X-Amz-Signature=" in parsed.query


def test_public_adres_imzalanmaz(r2):
    url = storage.object_url("profiles/a.webp")
    assert storage.presign(url) == url


# ── Yükleme ve silme: doğru bucket, ACL yok ─────────────────────────────────


class _SahteS3:
    def __init__(self, kayit):
        self.kayit = kayit

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def put_object(self, **kw):
        self.kayit.append(("put", kw))

    async def delete_object(self, **kw):
        self.kayit.append(("delete", kw))


@pytest.fixture
def s3_kayit(r2, monkeypatch):
    kayit: list = []
    monkeypatch.setattr(storage, "_s3_client", lambda **kw: _SahteS3(kayit))
    return kayit


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (20, 30), "red").save(buf, format="PNG")
    return buf.getvalue()


YUKLEYICILER = [
    ("upload_avatar", {}, "profiles/", "adanaozelders-public"),
    ("upload_library_photo", {}, "library-photos/", "adanaozelders-public"),
    ("upload_library_photo", {"square": True}, "library-photos/", "adanaozelders-public"),
    ("upload_product_photo", {}, "library-photos/", "adanaozelders-public"),
    ("upload_store_hero_photo", {}, "store-hero/", "adanaozelders-public"),
    ("upload_store_showcase_photo", {}, "store-showcase/", "adanaozelders-public"),
    ("upload_pre_application_photo", {}, "private/tutor-pre-applications/", "adanaozelders-private"),
    ("upload_delivery_photo", {}, "private/delivery-proof/", "adanaozelders-private"),
    ("upload_courier_photo", {}, "private/couriers/", "adanaozelders-private"),
]


@pytest.mark.parametrize(("fn", "kw", "onek", "bucket"), YUKLEYICILER)
async def test_her_gorsel_yukleyici_dogru_buckete_ve_onege_yazar(s3_kayit, fn, kw, onek, bucket):
    url = await getattr(storage, fn)(_png(), **kw)
    [(islem, put)] = s3_kayit
    assert islem == "put"
    assert put["Bucket"] == bucket
    assert put["Key"].startswith(onek)
    assert "ACL" not in put, "ACL gönderilmez (R2 desteklemez, MinIO yok sayar)"
    if bucket == "adanaozelders-private":
        assert "cdn." not in url
    else:
        assert url.startswith(CDN + "/")


async def test_upload_file_her_zaman_private_buckete(s3_kayit):
    url = await storage.upload_file(
        b"%PDF", original_name="karne.pdf", content_type="application/pdf", prefix="exam-results"
    )
    [(_, put)] = s3_kayit
    assert put["Bucket"] == "adanaozelders-private"
    assert put["Key"].startswith("private/exam-results/")
    assert "ACL" not in put
    assert "cdn." not in url


async def test_sinifsiz_onekle_yazma_yapilmaz(s3_kayit):
    with pytest.raises(ValueError):
        await storage._put_webp(b"x", prefix="exam-photos")
    assert s3_kayit == []


async def test_silme_nesneyi_kendi_bucketindan_siler(s3_kayit):
    await storage.delete_file(storage.object_url("private/lesson-resources/r.pdf"))
    await storage.delete_avatar(storage.object_url("profiles/a.webp"))
    assert [(k["Bucket"], k["Key"]) for _, k in s3_kayit] == [
        ("adanaozelders-private", "private/lesson-resources/r.pdf"),
        ("adanaozelders-public", "profiles/a.webp"),
    ]


async def test_sinifsiz_anahtar_tahminle_silinmez(s3_kayit):
    await storage.delete_avatar(f"{R2_API}/adanaozelders-public/avatars/eski.webp")
    assert s3_kayit == []


# ── Nöbetçi: bucket adı storage.py dışında seçilmez ─────────────────────────


def test_bucket_adi_yalniz_storage_katmaninda_secilir():
    """Uygulama kodunda (api/, services/, core/) `Bucket=` ya da
    `AWS_BUCKET_NAME` kullanan tek dosya storage.py olmalı; başka bir yer
    bucket seçerse fail-closed yönlendirme atlanmış olur."""
    ihlaller = []
    for kok in ("api", "services", "core"):
        for dosya in (BACKEND / kok).rglob("*.py"):
            if dosya.name in ("storage.py", "config.py"):
                continue
            agac = ast.parse(dosya.read_text(encoding="utf-8"))
            for dugum in ast.walk(agac):
                if isinstance(dugum, ast.keyword) and dugum.arg == "Bucket":
                    ihlaller.append(f"{dosya.relative_to(BACKEND)}:{dugum.value.lineno} Bucket=")
                if isinstance(dugum, ast.Attribute) and dugum.attr == "AWS_BUCKET_NAME":
                    ihlaller.append(f"{dosya.relative_to(BACKEND)}:{dugum.lineno} AWS_BUCKET_NAME")
    assert ihlaller == []
