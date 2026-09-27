"""Depolama erişim sınırının GERÇEK MinIO/S3'e karşı doğrulanması.

Bu paketteki diğer dosyalardan farkı: burada doğrulanan şey veritabanı değil,
**bucket policy**. Hassas dosyaların (diploma, karne, cevap anahtarı, dijital
ürün, teslim kanıtı fotoğrafı) gizliliği tek bir şeye dayanıyor — o dosyaların
öneki policy'de listelenmemiş olması. Bu kural yalnız gerçek depoya sorularak
doğrulanabilir: birim testi policy JSON'unun metnini kontrol eder, uygulanıp
uygulanmadığını değil.

Depo erişilemezse testler yerelde atlanır; CI'da (`CI_REQUIRE_SERVICES=1`)
KIRILIR — bkz. `tests/service_guard.py`. Eskiden burada koşulsuz bir SKIP
vardı ve CI'da MinIO servisi olmadığı için altı testin tamamı atlanıyordu:
yani bu dosyanın doğruladığı güvenlik iddiası CI'da HİÇ kanıtlanmıyordu.
"""
from __future__ import annotations

import uuid

import httpx
import pytest

from core import storage
from tests.service_guard import servis_yok

pytestmark = pytest.mark.asyncio


async def _put(key: str, body: bytes = b"gizli-icerik") -> None:
    async with storage._s3_client() as s3:
        await s3.put_object(Bucket=storage.bucket_for_key(key), Key=key, Body=body)


async def _delete(key: str) -> None:
    async with storage._s3_client() as s3:
        await s3.delete_object(Bucket=storage.bucket_for_key(key), Key=key)


@pytest.fixture
async def bucket_ready():
    """Bucket + güncel policy; depo yoksa yerelde atla, CI'da kır."""
    try:
        await storage.ensure_bucket()
        async with storage._s3_client() as s3:
            for bucket in {storage.public_bucket(), storage.private_bucket()}:
                await s3.head_bucket(Bucket=bucket)
    except Exception as exc:  # noqa: BLE001
        servis_yok("MinIO/S3", exc)
    return True


@pytest.fixture
async def private_object(bucket_ready):
    key = f"{storage.PRIVATE_PREFIX}answer-keys/{uuid.uuid4().hex}.txt"
    await _put(key)
    yield key
    await _delete(key)


@pytest.fixture
async def public_object(bucket_ready):
    key = f"{storage.PROFILE_PREFIX}/{uuid.uuid4().hex}.txt"
    await _put(key)
    yield key
    await _delete(key)


async def test_private_nesne_anonim_okunamaz(private_object):
    """Asıl güvenlik iddiası: adresi bilmek yetmez."""
    async with httpx.AsyncClient() as c:
        r = await c.get(storage.object_url(private_object))
    assert r.status_code == 403, (
        "private önek anonim erişime AÇIK — bucket policy hassas dosyaları koruyamıyor"
    )


async def test_private_nesne_imzali_adresle_okunur(private_object):
    signed = storage.resolve_url(private_object)
    async with httpx.AsyncClient() as c:
        r = await c.get(signed)
    assert r.status_code == 200
    assert r.content == b"gizli-icerik"


async def test_public_nesne_anonim_okunur(public_object):
    """Karşı taraf: daraltma fazla ileri gitmemeli, avatarlar açık kalmalı."""
    async with httpx.AsyncClient() as c:
        r = await c.get(storage.object_url(public_object))
    assert r.status_code == 200


async def test_bucket_koku_anonim_listelenemez(bucket_ready):
    """Anahtarlar uuid4; liste açık olsaydı tahmin gereksizleşirdi."""
    async with httpx.AsyncClient() as c:
        for bucket in {storage.public_bucket(), storage.private_bucket()}:
            r = await c.get(f"{storage._public_endpoint()}/{bucket}/")
            assert r.status_code in (403, 404), bucket


async def test_yuklenen_hassas_dosya_private_onege_gider(bucket_ready):
    """Yükleme yolunun kendisi doğru sınıfa yazıyor mu (uçtan uca)."""
    key = await storage.upload_file(
        b"%PDF-1.4 sahte", original_name="karne.pdf", content_type="application/pdf"
    )
    try:
        assert storage.is_private_key(key)
        async with httpx.AsyncClient() as c:
            assert (await c.get(storage.object_url(key))).status_code == 403
            assert (await c.get(storage.resolve_url(key))).status_code == 200
    finally:
        await _delete(key)


async def test_avatar_public_onege_gider(bucket_ready):
    """Profil fotoğrafı `profiles/` altında ve public bucket'ta olmalı."""
    from PIL import Image
    import io

    buf = io.BytesIO()
    Image.new("RGB", (10, 10), "red").save(buf, format="PNG")
    key = await storage.upload_avatar(buf.getvalue())
    try:
        assert key.startswith("profiles/")
        async with httpx.AsyncClient() as c:
            assert (await c.get(storage.resolve_url(key))).status_code == 200
    finally:
        await _delete(key)
