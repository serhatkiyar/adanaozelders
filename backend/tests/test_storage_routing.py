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
    signed = storage.resolve_url(storage.object_url("private/answer-keys/k.pdf"))
    parsed = urlparse(signed)
    assert parsed.netloc == urlparse(R2_API).netloc
    assert "cdn." not in signed
    assert "/adanaozelders-private/private/answer-keys/k.pdf" in parsed.path
    assert "X-Amz-Signature=" in parsed.query


def test_public_adres_imzalanmaz(r2):
    url = storage.object_url("profiles/a.webp")
    assert storage.resolve_url(url) == url


# ── Yükleme ve silme: doğru bucket, ACL yok ─────────────────────────────────


class _SahteS3:
    def __init__(self, kayit, *, head_size=None):
        self.kayit = kayit
        self._head_size = head_size

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def put_object(self, **kw):
        self.kayit.append(("put", kw))

    async def delete_object(self, **kw):
        self.kayit.append(("delete", kw))

    async def head_object(self, **kw):
        self.kayit.append(("head", kw))
        if self._head_size is None:
            from botocore.exceptions import ClientError

            raise ClientError({"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject")
        return {"ContentLength": self._head_size}

    async def upload_file(self, path, bucket, key, ExtraArgs=None):
        self.kayit.append(("upload_file", {"Bucket": bucket, "Key": key, "ExtraArgs": ExtraArgs or {}}))


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
    key = await getattr(storage, fn)(_png(), **kw)
    [(islem, put)] = s3_kayit
    assert islem == "put"
    assert put["Bucket"] == bucket
    assert put["Key"].startswith(onek)
    assert key == put["Key"], "DB'ye tam adres değil anahtar yazılır"
    assert "ACL" not in put, "ACL gönderilmez (R2 desteklemez, MinIO yok sayar)"
    if bucket == "adanaozelders-private":
        assert "cdn." not in storage.resolve_url(key)
    else:
        assert storage.resolve_url(key).startswith(CDN + "/")


async def test_upload_file_her_zaman_private_buckete(s3_kayit):
    key = await storage.upload_file(
        b"%PDF", original_name="karne.pdf", content_type="application/pdf", prefix="exam-results"
    )
    [(_, put)] = s3_kayit
    assert put["Bucket"] == "adanaozelders-private"
    assert put["Key"].startswith("private/exam-results/")
    assert key == put["Key"]
    assert "ACL" not in put
    assert "cdn." not in storage.resolve_url(key)


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
    """Uygulama kodunda ve betiklerde (api/, services/, core/, scripts/,
    main.py) `Bucket=`, `AWS_BUCKET_NAME` ya da iç istemci `_s3_client`
    kullanan tek dosya storage.py olmalı; başka bir yer bucket seçerse
    fail-closed yönlendirme atlanmış olur (R2 adım 6: betikler de dahil)."""
    dosyalar = [BACKEND / "main.py"]
    for kok in ("api", "services", "core", "scripts"):
        dosyalar += list((BACKEND / kok).rglob("*.py"))
    ihlaller = []
    for dosya in dosyalar:
        if dosya.name in ("storage.py", "config.py"):
            continue
        agac = ast.parse(dosya.read_text(encoding="utf-8"))
        for dugum in ast.walk(agac):
            yer = f"{dosya.relative_to(BACKEND)}:{getattr(dugum, 'lineno', '?')}"
            if isinstance(dugum, ast.keyword) and dugum.arg == "Bucket":
                ihlaller.append(f"{yer} Bucket=")
            if isinstance(dugum, ast.Attribute) and dugum.attr in ("AWS_BUCKET_NAME", "_s3_client"):
                ihlaller.append(f"{yer} {dugum.attr}")
            if isinstance(dugum, (ast.Import, ast.ImportFrom)):
                adlar = [a.name for a in dugum.names] + [getattr(dugum, "module", "") or ""]
                if any(a.split(".")[0] in ("boto3", "aioboto3", "botocore", "minio") for a in adlar):
                    ihlaller.append(f"{yer} doğrudan S3 istemci importu")
    assert ihlaller == []


# ── Anahtar → adres çözümleme (R2 adım 2) ───────────────────────────────────


def test_key_from_url_semasiz_anahtari_oldugu_gibi_doner(r2):
    assert storage.key_from_url("profiles/a.webp") == "profiles/a.webp"
    assert storage.key_from_url("private/x/y.pdf") == "private/x/y.pdf"
    assert storage.key_from_url("/logo.png") is None
    assert storage.key_from_url("data:image/png;base64,AAAA") is None


def test_resolve_public_anahtar_cdn_adresine(r2):
    assert storage.resolve_url("profiles/a.webp") == f"{CDN}/profiles/a.webp"


def test_resolve_private_anahtar_s3_api_de_imzalanir(r2):
    signed = storage.resolve_url("private/answer-keys/k.pdf")
    assert urlparse(signed).netloc == urlparse(R2_API).netloc
    assert "X-Amz-Signature=" in signed


@pytest.mark.sinifsiz_depo_degeri
def test_resolve_public_alanda_private_anahtar_cikmaz(r2):
    assert storage.resolve_url("private/answer-keys/k.pdf", allow_private=False) is None
    eski = f"{R2_API}/adanaozelders-private/private/answer-keys/k.pdf"
    assert storage.resolve_url(eski, allow_private=False) is None


@pytest.mark.sinifsiz_depo_degeri
def test_resolve_sinifsiz_anahtar_none_sinifsiz_eski_adres_aynen(r2):
    assert storage.resolve_url("avatars/x.webp") is None
    eski = "https://depo.adanaozelders.com.tr/avatars/avatars/x.webp"
    assert storage.resolve_url(eski) == eski


def test_resolve_kendi_bucket_eski_public_adresini_guncel_koke_tasir(r2):
    eski = f"{R2_API}/adanaozelders-public/library-photos/b.webp"
    assert storage.resolve_url(eski) == f"{CDN}/library-photos/b.webp"


@pytest.mark.parametrize(
    "deger",
    [
        None,
        "",
        "profiles/a.webp",
        "private/lesson-resources/r.pdf",
        f"{CDN}/store-hero/h.webp",
        f"{R2_API}/adanaozelders-private/private/x.pdf",
        "https://baska.site/foto.jpg",
        "/logo.png",
    ],
)
def test_resolve_idempotent(r2, deger):
    """Şemalar dökümden yeniden kurulabiliyor ve step-1 katmanı hâlâ üstte
    çalışıyor: çözülmüş adresi yeniden çözmek aynı sonucu vermeli."""
    bir = storage.resolve_url(deger)
    assert storage.resolve_url(bir) == bir


async def test_silme_semasiz_anahtari_kabul_eder(s3_kayit):
    """Hesap silme `orphan_files` listesi anahtar taşıyabilir."""
    await storage.delete_file("profiles/a.webp")
    await storage.delete_file("private/education-docs/d.pdf")
    assert [(k["Bucket"], k["Key"]) for _, k in s3_kayit] == [
        ("adanaozelders-public", "profiles/a.webp"),
        ("adanaozelders-private", "private/education-docs/d.pdf"),
    ]


@pytest.mark.sinifsiz_depo_degeri
def test_publicasset_ve_privateasset_serilestirmede_cozer(r2):
    from pydantic import BaseModel

    from core.storage_types import PrivateAsset, PublicAsset

    class Ornek(BaseModel):
        foto: PublicAsset | None = None
        gizli_foto: PublicAsset | None = None
        belge: PrivateAsset | None = None
        bos: PrivateAsset | None = None

    out = Ornek(
        foto="profiles/a.webp", gizli_foto="private/x.webp", belge="private/d.pdf"
    ).model_dump(mode="json")
    assert out["foto"] == f"{CDN}/profiles/a.webp"
    assert out["gizli_foto"] is None
    assert urlparse(out["belge"]).netloc == urlparse(R2_API).netloc
    assert out["bos"] is None


# ── Nöbetçi: depolama alanı taşıyan yanıt şeması tipsiz kalmaz ──────────────

# Depolama nesnesi taşıyabilen alan adları.
_DEPO_ALANI = (
    "avatar_url", "cover_url", "logo_url", "photo_url", "answer_key_url",
    "result_document_url", "document_url", "download_url",
)
# (sınıf, alan) → neden tipsiz: girdi şeması ya da depolama dışı adres.
_TIPSIZ_IZINLI = {
    ("LibraryCreate", "cover_url"), ("LibraryCreate", "logo_url"),
    ("LibraryUpdate", "cover_url"), ("LibraryUpdate", "logo_url"),
    ("ProductCreate", "cover_url"), ("ProductUpdate", "cover_url"),
    ("SellerProductCreate", "cover_url"),
}


def _asset_mi(annotation) -> bool:
    from typing import get_args

    from core import storage_types

    hedef = {storage_types._public, storage_types._private}
    for meta in getattr(annotation, "__metadata__", ()):
        if getattr(meta, "func", None) in hedef:
            return True
    return any(_asset_mi(a) for a in get_args(annotation))


def test_depolama_alanlari_publicasset_ya_da_privateasset():
    import importlib
    import pkgutil

    import schemas
    from pydantic import BaseModel

    tipsiz = []
    for mod in pkgutil.iter_modules(schemas.__path__):
        m = importlib.import_module(f"schemas.{mod.name}")
        for ad, sinif in vars(m).items():
            if not (isinstance(sinif, type) and issubclass(sinif, BaseModel)):
                continue
            if sinif.__module__ != m.__name__:
                continue
            for alan, bilgi in sinif.model_fields.items():
                if not alan.endswith(_DEPO_ALANI) or (ad, alan) in _TIPSIZ_IZINLI:
                    continue
                if not _asset_mi(bilgi.annotation) and not any(
                    getattr(x, "func", None) for x in bilgi.metadata
                ):
                    tipsiz.append(f"{m.__name__}.{ad}.{alan}")
    assert tipsiz == []


@pytest.mark.sinifsiz_depo_degeri
def test_og_gorseli_anahtari_cdn_adresine_private_i_varsayilana_cevirir(r2):
    """OG/Twitter görseli yanıt şeması dışında üretilir; kırılırsa hata vermez."""
    from services.social_meta import DEFAULT_IMAGE, _abs

    assert _abs("profiles/a.webp") == f"{CDN}/profiles/a.webp"
    assert _abs("private/x.pdf").endswith(DEFAULT_IMAGE)


# ── R2 adım 3: yalnız bilinen host'lar, tek imza kaynağı, girdi doğrulama ────

YABANCI = [
    "https://kotu.site/adanaozelders-private/private/x.pdf",
    "https://kotu.site/adanaozelders-public/profiles/a.webp",
    "https://kotu.site/private/x.pdf",
    "https://kotu.site/profiles/a.webp",
    "https://cdn.adanaozelders.com.tr.kotu.site/profiles/a.webp",
    "https://kotu.site/?u=https://cdn.adanaozelders.com.tr/profiles/a.webp",
    f"https://kotu.site/yol{R2_API}/adanaozelders-private/private/x.pdf",
    "ftp://hesap123.r2.cloudflarestorage.com/adanaozelders-private/private/x.pdf",
]


@pytest.mark.parametrize("url", YABANCI)
def test_yabanci_host_anahtar_sayilmaz(r2, url):
    """Yolu private/ ya da public önekle eşleşse bile harici adres bizim değil."""
    assert storage.key_from_url(url) is None
    assert not storage.is_private_url(url)


@pytest.mark.sinifsiz_depo_degeri
@pytest.mark.parametrize("url", YABANCI)
def test_yabanci_adres_imzalanmaz(r2, url):
    """Yabancı adres asla imzalanmaz; yolunda `private/` varsa hiç geçirilmez."""
    out = storage.resolve_url(url)
    if "/private/" in urlparse(url).path:
        assert out is None
    else:
        assert out == url


@pytest.mark.parametrize("url", YABANCI)
async def test_yabanci_adres_silme_yolunda_nesnemiz_sanilmaz(s3_kayit, url):
    await storage.delete_file(url)
    await storage.delete_avatar(url)
    assert s3_kayit == []


def test_bilinen_hostta_yalniz_kendi_bucketlarimiz(r2):
    assert storage.key_from_url(f"{R2_API}/baska-bucket/private/x.pdf") is None
    assert storage.key_from_url(f"{CDN}/profiles/a.webp?v=1") == "profiles/a.webp"


def test_ayni_anahtara_ayni_imza_farkli_anahtara_farkli(r2):
    """Kararlılık: canlı takip 15 sn'de bir yenilenir; imza her turda değişirse
    tarayıcı önbelleği tutmaz ve kurye fotoğrafı titrer."""
    a = storage.resolve_url("private/couriers/a.webp")
    assert a == storage.resolve_url("private/couriers/a.webp")
    assert a != storage.resolve_url("private/couriers/b.webp")


def test_eski_imza_katmani_ve_presign_kaldirildi():
    """Private adres üretiminin tek kaynağı `resolve_url` (typed alanlar)."""
    assert not (BACKEND / "core" / "private_urls.py").exists()
    assert not hasattr(storage, "presign")
    assert not hasattr(storage, "presign_many")
    assert "private_urls" not in (BACKEND / "main.py").read_text(encoding="utf-8")


@pytest.mark.sinifsiz_depo_degeri
@pytest.mark.parametrize(
    ("deger", "tur"),
    [("avatars/x.webp", "bare_key"), ("private/x.pdf", "private_in_public"),
     (f"{R2_API}/adanaozelders-public/avatars/x.webp", "legacy_url")],
)
def test_sinifsiz_deger_sayilir_ve_loglanir(r2, caplog, deger, tur):
    once = storage.unclassified_hits[tur]
    storage._unclassified_logged.clear()
    with caplog.at_level("ERROR", logger="core.storage"):
        storage.resolve_url(deger, allow_private=False)
    assert storage.unclassified_hits[tur] == once + 1
    assert any("sınıfsız depolama değeri" in r.getMessage() for r in caplog.records)


# ── Girdi: PublicAssetInput ─────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("girdi", "beklenen"),
    [
        (f"{CDN}/profiles/a.webp", "profiles/a.webp"),
        (f"{R2_API}/adanaozelders-public/library-photos/b.webp", "library-photos/b.webp"),
        ("store-hero/h.webp", "store-hero/h.webp"),
        ("https://baska.site/kapak.jpg", "https://baska.site/kapak.jpg"),
        ("/logo.png", "/logo.png"),
        ("  ", None),
        (None, None),
    ],
)
def test_public_girdi_normallesir(r2, girdi, beklenen):
    assert storage.normalize_public_input(girdi) == beklenen


@pytest.mark.parametrize(
    "girdi",
    ["private/answer-keys/k.pdf", f"{R2_API}/adanaozelders-private/private/k.pdf",
     "avatars/x.webp", "kapak.jpg"],
)
def test_public_girdi_private_ve_sinifsizi_reddeder(r2, girdi):
    with pytest.raises(ValueError):
        storage.normalize_public_input(girdi)


def _asset_girdi_mi(annotation) -> bool:
    from typing import get_args

    for meta in getattr(annotation, "__metadata__", ()):
        if getattr(meta, "func", None) is storage.normalize_public_input:
            return True
    return any(_asset_girdi_mi(a) for a in get_args(annotation))


def test_girdi_semalari_private_i_reddeder_kendi_adresimizi_anahtara_cevirir(r2):
    from pydantic import ValidationError

    from schemas.blog import BlogPostWrite
    from schemas.library import LibraryUpdate
    from schemas.store import ProductCategoryCreate

    with pytest.raises(ValidationError):
        LibraryUpdate(cover_url="private/x.webp")
    with pytest.raises(ValidationError):
        ProductCategoryCreate(name="K", icon_url=f"{R2_API}/adanaozelders-private/private/i.webp")
    with pytest.raises(ValidationError):
        BlogPostWrite(title="B", cover_image_url="private/b.webp")
    assert LibraryUpdate(logo_url=f"{CDN}/library-photos/l.webp").logo_url == "library-photos/l.webp"


def test_girdi_semalarindaki_depo_alanlari_publicassetinput():
    import schemas.library
    import schemas.store

    for sinif, alan in _TIPSIZ_IZINLI:
        mod = schemas.library if sinif.startswith("Library") else schemas.store
        assert _asset_girdi_mi(getattr(mod, sinif).model_fields[alan].annotation), (sinif, alan)


# ── Ders materyali: bağlantı imzalanmaz ─────────────────────────────────────


def test_materyal_baglantisi_kendi_depomuzu_gosteremez(r2):
    from pydantic import ValidationError

    from schemas.booking import BookingResourceCreate

    for url in (f"{R2_API}/adanaozelders-private/private/lesson-resources/r.pdf",
                f"{CDN}/profiles/a.webp"):
        with pytest.raises(ValidationError):
            BookingResourceCreate(title="x", url=url)
    assert BookingResourceCreate(title="x", url="https://drive.example/d").url


def test_materyal_yalniz_dosya_turunde_imzalanir(r2):
    import datetime

    from schemas.booking import BookingResourceOut

    ortak = dict(id=1, booking_id=1, uploader_role="TUTOR", uploader_id=1, title="t",
                 created_at=datetime.datetime(2026, 9, 27))
    dosya = BookingResourceOut(kind="file", url="private/lesson-resources/r.pdf", **ortak)
    assert "X-Amz-Signature=" in dosya.model_dump(mode="json")["url"]
    eski_link = BookingResourceOut(
        kind="link", url=f"{R2_API}/adanaozelders-private/private/lesson-resources/r.pdf", **ortak
    )
    assert eski_link.model_dump(mode="json")["url"] is None
    dis = BookingResourceOut(kind="link", url="https://drive.example/d", **ortak)
    assert dis.model_dump(mode="json")["url"] == "https://drive.example/d"


# ── Eski depo host'u (R2 geçişi sonrası): açıkça tanınır, dış adres sayılmaz ──

ESKI = "https://depo.adanaozelders.com.tr/avatars"


@pytest.fixture
def r2_eski(r2, monkeypatch):
    monkeypatch.setattr(settings, "S3_LEGACY_BASE_URLS", ESKI)


def test_eski_private_adres_yeni_private_bucketta_imzalanir(r2_eski):
    out = storage.resolve_url(f"{ESKI}/private/answer-keys/k.pdf")
    parsed = urlparse(out)
    assert parsed.netloc == urlparse(R2_API).netloc
    assert parsed.path == "/adanaozelders-private/private/answer-keys/k.pdf"
    assert "depo." not in out


@pytest.mark.sinifsiz_depo_degeri
def test_eski_private_adres_public_alanda_cikmaz(r2_eski):
    assert storage.resolve_url(f"{ESKI}/private/x.pdf", allow_private=False) is None


def test_eski_public_adres_cdn_ye_tasinir(r2_eski):
    assert storage.resolve_url(f"{ESKI}/library-photos/b.webp") == f"{CDN}/library-photos/b.webp"


@pytest.mark.sinifsiz_depo_degeri
def test_eski_sinifsiz_adres_yanittan_cikarilir(r2_eski):
    assert storage.resolve_url(f"{ESKI}/avatars/x.webp") is None


def test_eski_adres_girdide_anahtara_cevrilir_ya_da_reddedilir(r2_eski):
    assert storage.normalize_public_input(f"{ESKI}/profiles/a.webp") == "profiles/a.webp"
    for kotu in (f"{ESKI}/private/x.pdf", f"{ESKI}/avatars/x.webp"):
        with pytest.raises(ValueError):
            storage.normalize_public_input(kotu)


async def test_eski_adres_silmede_yeni_buckettaki_nesneyi_hedefler(s3_kayit, monkeypatch):
    monkeypatch.setattr(settings, "S3_LEGACY_BASE_URLS", ESKI)
    await storage.delete_file(f"{ESKI}/private/lesson-resources/r.pdf")
    await storage.delete_file(f"{ESKI}/avatars/eski.webp")  # sınıfsız: dokunulmaz
    assert [(k["Bucket"], k["Key"]) for _, k in s3_kayit] == [
        ("adanaozelders-private", "private/lesson-resources/r.pdf"),
    ]


def test_eski_hostun_baska_yolu_eski_kok_sayilmaz(r2_eski):
    assert storage.key_from_url("https://depo.adanaozelders.com.tr/baska/profiles/a.webp") is None


@pytest.mark.sinifsiz_depo_degeri
def test_eski_host_tanimsizsa_bile_private_yollu_adres_gecirilmez(r2):
    """Ayar unutulsa da eski private adres dış adres gibi dönmez."""
    assert storage.resolve_url(f"{ESKI}/private/answer-keys/k.pdf") is None
    with pytest.raises(ValueError):
        storage.normalize_public_input(f"{ESKI}/private/answer-keys/k.pdf")


# ── Private bucket hiçbir public adres üretmez (R2 adım 4) ──────────────────

_MODLAR = {
    # Üretim: R2 + CDN.
    "r2": {"S3_PUBLIC_BUCKET": "adanaozelders-public", "S3_PRIVATE_BUCKET": "adanaozelders-private",
           "S3_PUBLIC_BASE_URL": CDN, "AWS_ENDPOINT_URL": R2_API},
    # Yerel/CI iki bucket: CDN yok, MinIO adresi.
    "minio_iki": {"S3_PUBLIC_BUCKET": "yerel-public", "S3_PRIVATE_BUCKET": "yerel-private",
                  "S3_PUBLIC_BASE_URL": "", "AWS_ENDPOINT_URL": "http://localhost:9000"},
}
_PRIVATE_ANAHTARLAR = [
    "private/answer-keys/k.pdf", "private/education-docs/d.pdf",
    "private/digital-assets/e.pdf", "private/delivery-proof/p.webp",
    "private/couriers/c.webp", "private/tutor-pre-applications/t.webp",
]


@pytest.fixture(params=sorted(_MODLAR))
def depo_modu(request, monkeypatch):
    for k, v in _MODLAR[request.param].items():
        monkeypatch.setattr(settings, k, v)
    monkeypatch.setattr(settings, "S3_PUBLIC_ENDPOINT_URL", "")
    storage._presign_client.cache_clear()
    storage._presign_cache.clear()
    yield _MODLAR[request.param]
    storage._presign_client.cache_clear()
    storage._presign_cache.clear()


@pytest.mark.parametrize("key", _PRIVATE_ANAHTARLAR)
def test_private_anahtar_public_adres_uretmez(depo_modu, key):
    with pytest.raises(ValueError):
        storage.public_url(key)
    ham = storage.object_url(key)
    assert f"/{depo_modu['S3_PRIVATE_BUCKET']}/" in ham
    assert f"/{depo_modu['S3_PUBLIC_BUCKET']}/" not in ham
    if depo_modu["S3_PUBLIC_BASE_URL"]:
        assert not ham.startswith(depo_modu["S3_PUBLIC_BASE_URL"])
    imzali = storage.resolve_url(key)
    assert "X-Amz-Signature=" in imzali, "private dosya imzasız adresle çıkmaz"
    assert f"/{depo_modu['S3_PRIVATE_BUCKET']}/" in imzali
    if depo_modu["S3_PUBLIC_BASE_URL"]:
        assert not imzali.startswith(depo_modu["S3_PUBLIC_BASE_URL"])


@pytest.mark.parametrize("prefix", storage.PUBLIC_PREFIXES)
def test_public_adres_private_bucketi_gostermez(depo_modu, prefix):
    url = storage.resolve_url(f"{prefix}x.webp")
    assert depo_modu["S3_PRIVATE_BUCKET"] not in url
    assert "X-Amz-Signature" not in url


# ── R2 adım 6: paylaşılan istemci ve bucket kontrolü ortak katmanda ─────────


class _SayanS3(_SahteS3):
    async def head_bucket(self, **kw):
        self.kayit.append(("head", kw))


async def test_paylasilan_istemci_yeni_istemci_acmaz(r2, monkeypatch):
    acilan: list = []
    monkeypatch.setattr(storage, "_s3_client", lambda **kw: acilan.append(1) or _SahteS3([]))
    kayit: list = []
    paylasilan = _SahteS3(kayit)
    anahtarlar = [await storage.upload_product_photo(_png(), client=paylasilan) for _ in range(3)]
    assert acilan == [], "paylaşılan istemci varken yeni istemci açıldı"
    assert [k["Bucket"] for _, k in kayit] == ["adanaozelders-public"] * 3
    assert all(a.startswith("library-photos/") for a in anahtarlar)
    assert all("ACL" not in k for _, k in kayit)


async def test_check_buckets_iki_bucketi_da_sorar(r2, monkeypatch):
    kayit: list = []
    monkeypatch.setattr(storage, "_s3_client", lambda **kw: _SayanS3(kayit))
    await storage.check_buckets()
    assert [k["Bucket"] for _, k in kayit] == ["adanaozelders-public", "adanaozelders-private"]


def test_eski_gorunurluk_gecis_betigi_kaldirildi():
    assert not (BACKEND / "scripts" / "migrate_storage_visibility.py").exists()


# ── Eğitmen tanıtım videosu: anahtar sınıfları, imzalı PUT, HEAD, public yükleme ──


def test_video_anahtarlari_dogru_sinifta(r2):
    kaynak = storage.tutor_video_source_key(42)
    assert kaynak.startswith("private/tutor-videos/42/") and kaynak.endswith(".bin")
    assert storage.bucket_for_key(kaynak) == "adanaozelders-private"
    mp4, poster = storage.tutor_video_output_keys()
    assert mp4.startswith("tutor-videos/") and mp4.endswith(".mp4")
    assert poster == mp4[:-4] + ".jpg"
    assert storage.bucket_for_key(mp4) == "adanaozelders-public"
    assert storage.public_url(mp4) == f"{CDN}/{mp4}"
    # İşlenmiş çıktı CDN'den döner (ham kaynağın public'ten çözülmemesi:
    # `test_video_kaynagi_public_alandan_cozulmez_sayac_artar`).
    assert storage.resolve_url(mp4, allow_private=False) == f"{CDN}/{mp4}"


def test_imzali_put_tek_anahtar_tek_metod_content_type_imzali(r2):
    key = storage.tutor_video_source_key(5)
    url = storage.presign_put(key, content_type="video/mp4", ttl_seconds=900)
    parsed = urlparse(url)
    assert parsed.netloc == urlparse(R2_API).netloc and "cdn." not in url
    assert parsed.path == f"/adanaozelders-private/{key}"
    q = parsed.query
    assert "X-Amz-Signature=" in q and "X-Amz-Expires=900" in q
    # Content-Type imzalı başlıktadır: tarayıcı birebir aynı değeri göndermeli.
    assert "content-type" in q.lower().split("x-amz-signedheaders=")[1].split("&")[0]


def test_imzali_put_public_oneke_verilmez_sinifsizda_patlar(r2):
    with pytest.raises(ValueError):
        storage.presign_put("avatars/x.bin", content_type="video/mp4", ttl_seconds=60)


@pytest.mark.sinifsiz_depo_degeri
def test_video_kaynagi_public_alandan_cozulmez_sayac_artar(r2):
    """`PublicAsset` private anahtarı None'a çevirir ve sayaç artar (fail-closed)."""
    assert storage.resolve_url("private/tutor-videos/1/a.bin", allow_private=False) is None


async def test_head_size_yoksa_none_varsa_boyut(r2, monkeypatch):
    kayit: list = []
    monkeypatch.setattr(storage, "_s3_client", lambda **kw: _SahteS3(kayit, head_size=None))
    assert await storage.head_size("private/tutor-videos/1/a.bin") is None
    monkeypatch.setattr(storage, "_s3_client", lambda **kw: _SahteS3(kayit, head_size=12345))
    assert await storage.head_size("private/tutor-videos/1/a.bin") == 12345
    assert all(k["Bucket"] == "adanaozelders-private" for _, k in kayit)


async def test_delete_key_dogru_bucket_sinifsiz_dokunulmaz(r2, monkeypatch):
    kayit: list = []
    monkeypatch.setattr(storage, "_s3_client", lambda **kw: _SahteS3(kayit))
    assert await storage.delete_key("tutor-videos/a.mp4") is True
    assert await storage.delete_key("private/tutor-videos/1/a.bin") is True
    assert await storage.delete_key("avatars/eski.webp") is False
    assert await storage.delete_key(None) is False
    assert [k["Bucket"] for _, k in kayit] == ["adanaozelders-public", "adanaozelders-private"]


async def test_public_dosya_yuklemesi_content_type_ve_cache_control(r2, monkeypatch, tmp_path):
    kayit: list = []
    monkeypatch.setattr(storage, "_s3_client", lambda **kw: _SahteS3(kayit))
    f = tmp_path / "out.mp4"
    f.write_bytes(b"x")
    await storage.upload_public_file(
        "tutor-videos/a.mp4", str(f), content_type="video/mp4", cache_control="public, max-age=1, immutable"
    )
    op, kw = kayit[0]
    assert op == "upload_file" and kw["Bucket"] == "adanaozelders-public"
    assert kw["ExtraArgs"] == {"ContentType": "video/mp4", "CacheControl": "public, max-age=1, immutable"}
    with pytest.raises(ValueError):
        await storage.upload_public_file("private/x.mp4", str(f), content_type="video/mp4", cache_control="")
