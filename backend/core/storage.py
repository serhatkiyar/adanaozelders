import asyncio
import io
import json
import logging
import os
import time
import uuid
from collections import Counter
from functools import lru_cache
from urllib.parse import urlsplit

import aioboto3
from botocore.config import Config as BotoConfig
from PIL import Image

from core.config import settings

logger = logging.getLogger(__name__)

# Büyük banner decode/encode işleri aynı anda sınırsız thread açmasın. Bu sınır
# yalnız mağaza vitrinine özeldir; avatar/ürün yüklemelerini birbirine kilitlemez.
_STORE_HERO_PROCESS_LIMIT = asyncio.Semaphore(2)

# ── Erişim sınıfları ve bucket seçimi ────────────────────────────────────────
#
# İki erişim sınıfı vardır ve sınıf ANAHTAR ÖNEKİNDEN belirlenir:
#
#   PRIVATE_PREFIX   → private bucket. Anonim okunamaz; yalnız kısa ömürlü
#                      presigned URL ile (S3 API adresi üzerinden) açılır.
#   PUBLIC_PREFIXES  → public bucket. Yalnız zaten herkese gösterilen görseller:
#                      profil, kütüphane/ürün fotoğrafı, mağaza vitrini.
#
# Seçim FAIL-CLOSED'dur (27 Eyl 2026, R2 geçişi): ne `private/` ne de whitelist
# öneki taşıyan bir anahtar HİÇBİR bucket'a yazılmaz, `ValueError` alır. R2'de
# önek bazlı policy yok; custom domain bağlanan public bucket'ın tamamı açık.
# "private değilse public" kuralı, sınıflandırılmayı unutulan yeni bir hassas
# öneki (ya da `privat/` gibi bir yazım hatasını) sessizce herkese açardı.
# Tek güvenlik sınırı "private anahtar public bucket'a yazılmaz" olduğu için
# bucket adı yalnız :func:`bucket_for_key` üzerinden seçilir.
#
# Yerel MinIO'da iki bucket aynı olabilir (S3_PUBLIC/PRIVATE_BUCKET boş); o
# zaman ayrımı önek whitelist'li bucket policy yapar (:func:`public_read_policy`).
PROFILE_PREFIX = "profiles"
# İşlenmiş eğitmen tanıtım videosu (720p MP4) ve posteri — CDN'den servis edilir.
# Ham yükleme ise `private/tutor-videos/` altındadır ve asla public'e çıkmaz.
TUTOR_VIDEO_PREFIX = "tutor-videos"
PUBLIC_PREFIXES: tuple[str, ...] = (
    f"{PROFILE_PREFIX}/",
    "library-photos/",
    "store-hero/",
    "store-showcase/",
    f"{TUTOR_VIDEO_PREFIX}/",
)
PRIVATE_PREFIX = "private/"
TUTOR_VIDEO_SOURCE_PREFIX = f"{PRIVATE_PREFIX}{TUTOR_VIDEO_PREFIX}"


def public_bucket() -> str:
    return settings.S3_PUBLIC_BUCKET or settings.AWS_BUCKET_NAME


def private_bucket() -> str:
    return settings.S3_PRIVATE_BUCKET or settings.AWS_BUCKET_NAME


def bucket_for_key(key: str) -> str:
    """Anahtarın yazılacağı/okunacağı bucket. Sınıfsız anahtar → ``ValueError``."""
    if not key:
        raise ValueError("boş depolama anahtarı")
    if key.startswith(PRIVATE_PREFIX):
        return private_bucket()
    if key.startswith(PUBLIC_PREFIXES):
        return public_bucket()
    raise ValueError(f"sınıfsız depolama anahtarı: {key!r}")


def _make_key(prefix: str, ext: str) -> str:
    """Yeni nesne anahtarı üretir; sınıfsız önekte (yazmadan önce) patlar."""
    key = f"{prefix.strip('/')}/{uuid.uuid4().hex}{ext}"
    bucket_for_key(key)
    return key


def _s3_client(*, public_endpoint: bool = False):
    """Ortak S3/MinIO istemcisi — timeout ve deneme sayısı SINIRLI.

    Botocore varsayılanları bağlantı başına ~60 sn bekler ve 5 kez dener.
    Erişilemez bir MinIO'da tek avatar yüklemesi böylece dakikalarca sürer ve
    bu süre boyunca isteğin DB session'ı da açık kalır → birkaç yükleme havuzu
    tüketip tüm siteyi düşürür. Hızlı başarısızlık, yavaş başarısızlıktan iyidir.

    ``public_endpoint=True`` istemciyi TARAYICININ göreceği adrese kurar. Presigned
    URL'in imzası host'u da kapsar: sunucu MinIO'ya ``http://minio:9000`` üzerinden
    bağlanırken imzayı o host'la üretirse, tarayıcı ``localhost:9000``'e gittiğinde
    imza tutmaz. Ayar boşsa fark yoktur (tek adres).
    """
    return aioboto3.Session().client(
        "s3",
        endpoint_url=(_public_endpoint() if public_endpoint else settings.AWS_ENDPOINT_URL) or None,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_REGION_NAME,
        config=BotoConfig(
            connect_timeout=settings.S3_CONNECT_TIMEOUT_SECONDS,
            read_timeout=settings.S3_READ_TIMEOUT_SECONDS,
            retries={"max_attempts": settings.S3_MAX_ATTEMPTS, "mode": "standard"},
        ),
    )


def _public_endpoint() -> str:
    """Tarayıcının erişebildiği depolama adresi (yoksa dahili adres)."""
    return settings.S3_PUBLIC_ENDPOINT_URL or settings.AWS_ENDPOINT_URL


def public_read_policy(bucket: str) -> str:
    """Bucket policy JSON'u: anonim okuma YALNIZ ``PUBLIC_PREFIXES`` altında.

    (``mc anonymous set download`` eşleniği ama prefix'e daraltılmış.) Modern
    MinIO obje ACL'lerini yok sayar — anonim erişim yalnız bucket policy ile
    açılır; dolayısıyla listede olmayan her önek (``private/`` dahil) kapalıdır.
    """
    return json.dumps(
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Principal": {"AWS": ["*"]},
                    "Action": ["s3:GetBucketLocation"],
                    "Resource": [f"arn:aws:s3:::{bucket}"],
                },
                {
                    "Effect": "Allow",
                    "Principal": {"AWS": ["*"]},
                    "Action": ["s3:GetObject"],
                    "Resource": [f"arn:aws:s3:::{bucket}/{p}*" for p in PUBLIC_PREFIXES],
                },
            ],
        }
    )


def open_client():
    """Toplu işler için PAYLAŞILAN istemci (``async with storage.open_client() as c``).

    ``aioboto3.Session()`` her açılışta botocore servis modellerini diskten
    yeniden yükler (ölçüldü: görsel başına ~1,1 sn). Binlerce yüklemede tek
    istemci açılıp ``upload_product_photo(..., client=c)`` ile paylaşılır;
    bucket seçimi yine :func:`bucket_for_key` ile bu modülde kalır.
    """
    return _s3_client()


async def check_buckets() -> None:
    """Public ve private bucket'a erişimi doğrular; erişilemezse hata fırlatır.

    Sağlık kontrolü ve toplu betikler kullanır. ``ensure_bucket`` best-effort'tur
    ve hatayı yutar; bu fonksiyon yutmaz.
    """
    async with _s3_client() as s3:
        for bucket in dict.fromkeys((public_bucket(), private_bucket())):
            await s3.head_bucket(Bucket=bucket)


async def ensure_bucket() -> None:
    """Açılışta bucket'ları ve public bucket'ın anonim-okuma policy'sini garanti
    eder (best-effort).

    Yalnız kendi MinIO'muzda çalışır (``S3_MANAGE_BUCKETS`` ve ``AWS_ENDPOINT_URL``
    dolu). R2/AWS'de bucket'lar konsoldan yönetilir; R2 bucket policy desteklemez.
    Private bucket'a policy YAZILMAZ: ayrı bucket'ta anonim okuma hiç açılmaz.
    Hata uygulamayı durdurmaz (loglanır).
    """
    if not (settings.S3_MANAGE_BUCKETS and settings.AWS_ENDPOINT_URL):
        return
    try:
        async with _s3_client() as s3:
            for bucket in dict.fromkeys((public_bucket(), private_bucket())):
                try:
                    await s3.head_bucket(Bucket=bucket)
                except Exception:
                    await s3.create_bucket(Bucket=bucket)
            await s3.put_bucket_policy(
                Bucket=public_bucket(),
                Policy=public_read_policy(public_bucket()),
            )
            logger.info(
                "MinIO bucket'ları hazır: public=%s private=%s",
                public_bucket(),
                private_bucket(),
            )
    except Exception:
        logger.warning(
            "MinIO bucket/policy garantilenemedi (storage kapalı olabilir)",
            exc_info=True,
        )


# ── Anahtar / URL dönüşümleri ───────────────────────────────────────────────────


def _s3_api_endpoint() -> str:
    """İmza ve private adreslerin üretildiği S3 API adresi (asla CDN değil)."""
    return (_public_endpoint() or "").rstrip("/")


def public_url(key: str) -> str:
    """Public anahtarın tarayıcıya verilen adresi. Private anahtar → ``ValueError``."""
    if key.startswith(PRIVATE_PREFIX):
        raise ValueError(f"private anahtar için public URL istendi: {key!r}")
    bucket_for_key(key)  # whitelist dışı → ValueError
    if settings.S3_PUBLIC_BASE_URL:
        return f"{settings.S3_PUBLIC_BASE_URL.rstrip('/')}/{key}"
    return f"{_s3_api_endpoint()}/{public_bucket()}/{key}"


def object_url(key: str) -> str:
    """Anahtardan kalıcı URL üretir (DB'de bu biçim saklanır).

    Public anahtar → :func:`public_url` (CDN varsa CDN). Private anahtar →
    ``{S3 API}/{private bucket}/{key}``: bu adres tek başına ÇALIŞMAZ (anonim
    GET 403) ve CDN host'uyla ASLA üretilmez; kullanıma sunulmadan önce
    :func:`resolve_url` ile imzalanır.
    """
    if key.startswith(PRIVATE_PREFIX):
        return f"{_s3_api_endpoint()}/{private_bucket()}/{key}"
    return public_url(key)


def _is_bare_key(value: str) -> bool:
    """Şema (``https:``, ``data:``) ve kök ``/`` taşımayan değer bir nesne anahtarıdır."""
    return not value.startswith("/") and ":" not in value.split("/", 1)[0]


def _own_api_hosts() -> set[str]:
    """Bucket'larımıza path-style (``/{bucket}/{key}``) erişilen S3 API host'ları."""
    return {
        urlsplit(u).netloc.lower()
        for u in (settings.AWS_ENDPOINT_URL, settings.S3_PUBLIC_ENDPOINT_URL)
        if u
    }


def _legacy_roots() -> list[tuple[str, str]]:
    """``S3_LEGACY_BASE_URLS`` → [(host, yol kökü)]."""
    out = []
    for raw in settings.S3_LEGACY_BASE_URLS.split(","):
        raw = raw.strip()
        if raw:
            parts = urlsplit(raw)
            out.append((parts.netloc.lower(), parts.path.rstrip("/") + "/"))
    return out


def _parse_url(url: str | None) -> tuple[str | None, str | None]:
    """Değeri (anahtar, kaynak) çiftine ayırır.

    Kaynak: ``"bare"`` (şemasız anahtar), ``"own"`` (güncel CDN/S3 API host'u),
    ``"legacy"`` (``S3_LEGACY_BASE_URLS``) ya da ``None`` (bize ait değil).
    """
    if not url:
        return None, None
    if _is_bare_key(url):
        return url, "bare"
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return None, None
    host, path = parts.netloc.lower(), parts.path
    base = urlsplit(settings.S3_PUBLIC_BASE_URL) if settings.S3_PUBLIC_BASE_URL else None
    if base and host == base.netloc.lower():
        root = base.path.rstrip("/") + "/"
        if path.startswith(root):
            return path[len(root) :] or None, "own"
    if host in _own_api_hosts():
        for bucket in dict.fromkeys((private_bucket(), public_bucket())):
            root = f"/{bucket}/"
            if path.startswith(root):
                return path[len(root) :] or None, "own"
    for legacy_host, root in _legacy_roots():
        if host == legacy_host and path.startswith(root):
            return path[len(root) :] or None, "legacy"
    return None, None


def key_from_url(url: str | None) -> str | None:
    """URL'den obje anahtarını çıkarır; bize ait olmayan adreste ``None``.

    Yalnız BİLİNEN host'lar kabul edilir (27 Eyl 2026, R2 adım 3):

    * ``S3_PUBLIC_BASE_URL`` (CDN) host'u → ``{base}/{key}``;
    * S3 API host'ları (``AWS_ENDPOINT_URL``, ``S3_PUBLIC_ENDPOINT_URL``) →
      ``/{bucket}/{key}``, yalnız kendi public/private bucket'larımız;
    * eski depolama kökleri (``S3_LEGACY_BASE_URLS``) → ``{kök}/{key}``.

    Harici bir adresin yolu ``private/...`` ya da public önekle eşleşse bile
    anahtarımız sayılmaz: aksi halde kullanıcının girdiği bir bağlantı imzalanır
    ya da silme yolunda bizim nesnemiz sanılırdı. Şemasız değer
    (``profiles/a.webp``) zaten anahtardır ve olduğu gibi döner.
    """
    return _parse_url(url)[0]


def _has_private_segment(url: str) -> bool:
    return f"/{PRIVATE_PREFIX}" in urlsplit(url).path


def is_private_key(key: str | None) -> bool:
    return bool(key) and key.startswith(PRIVATE_PREFIX)  # type: ignore[union-attr]


def is_private_url(url: str | None) -> bool:
    return is_private_key(key_from_url(url))


@lru_cache(maxsize=1)
def _presign_client():
    """İmzalama istemcisi — SENKRON ve tek örnek.

    ``generate_presigned_url`` ağ isteği yapmaz; yalnız anahtarla HMAC hesaplar.
    Bu yüzden async istemci gerekmez ve event loop bloklanmaz. Pahalı olan tek
    şey istemci kurulumudur (servis modelinin yüklenmesi) — bu da önbelleklenir.
    """
    import boto3

    # İmza host'u kapsar ve private dosyalar yalnız S3 API adresinden açılır:
    # bu istemci ASLA S3_PUBLIC_BASE_URL (CDN) ile kurulmaz.
    return boto3.client(
        "s3",
        endpoint_url=_s3_api_endpoint() or None,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_REGION_NAME,
        config=BotoConfig(signature_version="s3v4"),
    )


# İmzalı adres önbelleği: anahtar → (adres, üretim anı).
#
# Sadece hız için değil, KARARLILIK için var. İmza her yanıtta yeniden
# üretilirse aynı fotoğrafın adresi her istekte değişir; canlı takip sayfası
# 15 sn'de bir yenilendiğinden tarayıcı kurye vesikalığını ve kanıt fotoğrafını
# her turda baştan indirir ve görsel gözle görülür biçimde titrer. Aynı anahtara
# aynı adresi vermek, tarayıcı önbelleğinin çalışmasını sağlar.
_presign_cache: dict[tuple[str, int], tuple[str, float]] = {}
_PRESIGN_CACHE_MAX = 4096


def _sign(key: str, ttl: int | None = None) -> str | None:
    """Private anahtarın imzalı adresi (önbellekli); üretilemezse ``None``."""
    seconds = ttl or settings.S3_PRESIGN_TTL_SECONDS
    now = time.monotonic()
    cache_key = (key, seconds)
    hit = _presign_cache.get(cache_key)
    # Ömrünün yarısını geçmiş imzayı yenile: dönen adres her zaman en az
    # TTL/2 kadar geçerli kalsın (istemci sayfayı hemen açmayabilir).
    if hit is not None and (now - hit[1]) < seconds / 2:
        return hit[0]
    try:
        signed = _presign_client().generate_presigned_url(
            "get_object",
            Params={"Bucket": private_bucket(), "Key": key},
            ExpiresIn=seconds,
        )
    except Exception:
        logger.warning("presigned URL üretilemedi", exc_info=True)
        return None
    if len(_presign_cache) >= _PRESIGN_CACHE_MAX:
        _presign_cache.clear()  # basit tavan: sınırsız büyümesin
    _presign_cache[cache_key] = (signed, now)
    return signed


# Sınıflandırılamayan depolama değerlerinin sayacı (tür → adet). Metrik
# altyapısı yok; sayaç süreç içinde tutulur, testlerde kök conftest nöbetçisi
# okur. Her farklı değer ayrıca bir kez ERROR loglanır (Sentry varsa olay olur).
unclassified_hits: Counter[str] = Counter()
_unclassified_logged: set[str] = set()
_UNCLASSIFIED_LOG_MAX = 1000


def _note_unclassified(kind: str, value: str) -> None:
    unclassified_hits[kind] += 1
    if value in _unclassified_logged or len(_unclassified_logged) >= _UNCLASSIFIED_LOG_MAX:
        return
    _unclassified_logged.add(value)
    logger.error("sınıfsız depolama değeri (%s): %s", kind, value)


def resolve_url(value: str | None, *, allow_private: bool = True) -> str | None:
    """DB değerini (anahtar ya da eski tam adres) istemciye verilecek adrese çevirir.

    * private anahtar → S3 API üzerinden kısa ömürlü imzalı adres
      (``allow_private=False`` ise ``None``: public yüzeyden private dosya çıkmaz);
    * whitelist'li public anahtar → :func:`public_url` (CDN varsa CDN). Kendi
      bucket'ımıza ait eski tam adresler de böylece güncel köke taşınır;
    * sınıfsız şemasız anahtar → ``None`` (tahminle adres üretilmez);
    * eski depo kökündeki (``S3_LEGACY_BASE_URLS``) sınıfsız adres → ``None``;
    * yolunda ``private/`` olan yabancı adres → ``None`` (imzalanmaz);
    * dış adres, kök-göreli yol ve güncel host'taki sınıfsız adres → olduğu gibi.

    Sınıfsız değerler kullanıcıya anahtar olarak gösterilmez ama yutulmaz:
    :data:`unclassified_hits` sayacı artar ve değer ERROR loglanır.

    İdempotenttir: çıktısını yeniden vermek aynı sonucu üretir.
    """
    if not value:
        return None
    key, source = _parse_url(value)
    bare = source == "bare"
    if is_private_key(key):
        if not allow_private:
            _note_unclassified("private_in_public", key)  # type: ignore[arg-type]
            return None
        return _sign(key) or (None if bare else value)  # type: ignore[arg-type]
    if key and key.startswith(PUBLIC_PREFIXES):
        return public_url(key)
    if bare:
        _note_unclassified("bare_key", value)
        return None
    if source == "legacy":
        # Eski depodaki sınıfsız nesne: eski host kapanmış olabilir ve anahtarın
        # hangi sınıfa ait olduğu bilinmiyor → yanıttan çıkarılır.
        _note_unclassified("legacy_url", value)
        return None
    if source == "own":
        # Güncel host'umuzda ama sınıfsız önekte (ör. yerel MinIO'daki eski
        # `avatars/`) duran kayıt: adres değiştirilmeden döner, ama görünür kalsın.
        _note_unclassified("legacy_url", value)
        return value
    if _has_private_segment(value):
        # Bize ait görünmeyen ama yolunda `private/` taşıyan adres (ör. tanımı
        # unutulmuş eski depo host'u): dış adres gibi geçirilmez, imzalanmaz.
        _note_unclassified("foreign_private_path", value)
        return None
    return value


def normalize_public_input(value: str | None) -> str | None:
    """İstemcinin gönderdiği görsel adresini DB'ye yazılacak değere çevirir.

    * bize ait public adres ya da anahtar → anahtar (API'nin döndürdüğü CDN
      adresi forma geri gönderildiğinde DB'ye yine anahtar yazılır);
    * private anahtar/adres ya da yolunda ``private/`` olan yabancı adres →
      ``ValueError`` (public alana hassas dosya bağlanmaz);
    * sınıfsız şemasız anahtar ve eski depo kökündeki sınıfsız adres → ``ValueError``;
    * dış adres, kök-göreli yol ve kendi host'umuzdaki eski sınıfsız adres
      (API'nin döndürdüğü değer) → olduğu gibi.
    """
    if value is None:
        return None
    v = value.strip()
    if not v:
        return None
    key, source = _parse_url(v)
    if is_private_key(key):
        raise ValueError("Özel (private) dosya bu alana bağlanamaz.")
    if key and key.startswith(PUBLIC_PREFIXES):
        return key
    if source in ("bare", "legacy"):
        raise ValueError("Geçersiz görsel adresi.")
    if source is None and _has_private_segment(v):
        raise ValueError("Özel (private) dosya bu alana bağlanamaz.")
    return v


# Ders materyali olarak kabul edilen uzantılar (bucket'a keyfi yürütülebilir dosya
# konmasın diye whitelist). Bu dosyalar `private/` altına yazılır ve yalnız imzalı
# URL ile okunur.
ALLOWED_RESOURCE_EXTS: frozenset[str] = frozenset(
    {
        ".pdf",
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".gif",
        ".doc",
        ".docx",
        ".ppt",
        ".pptx",
        ".xls",
        ".xlsx",
        ".txt",
        ".csv",
        ".zip",
    }
)


def resource_ext(filename: str | None) -> str:
    return os.path.splitext(filename or "")[1].lower()


def is_allowed_resource(filename: str | None) -> bool:
    return resource_ext(filename) in ALLOWED_RESOURCE_EXTS


# Alfa kanalı TAŞIYAN Pillow modları. Paletli ("P") görüntü listede yoktur ve
# ayrı ele alınır: orada şeffaflık piksel verisinde değil, `info["transparency"]`
# alanında durur.
_ALFA_MODLARI = ("RGBA", "RGBa", "LA", "La", "PA")


def flatten_on_white(img: Image.Image) -> Image.Image:
    """Şeffaf görüntüyü BEYAZ zemine yapıştırıp RGB döndürür.

    WebP'ye yazmadan önce doğrudan ``convert("RGB")`` demek şeffaf alanları
    SİYAH yapıyordu: alfa düşünce geriye o piksellerin renk değeri kalır ve
    tam şeffaf piksellerde bu neredeyse her zaman (0,0,0)'dır. Ürün kapakları
    ve profil fotoğrafları beyaz zeminde gösterildiği için doğru zemin beyazdır.

    Paletli görüntüde ayrıca doğrudan ``P → RGB`` dönüşümü Pillow'un "Palette
    images with Transparency expressed in bytes should be converted to RGBA
    images" uyarısını tetikler ve şeffaflık bilgisini sessizce atar; ``P → RGBA``
    üzerinden geçmek hem uyarıyı hem kaybı ortadan kaldırır.

    Şeffaflığı olmayan görüntü OLDUĞU GİBİ (aynı nesne, aynı mod) döner —
    çağıranın kendi mod dönüşümü ve mevcut davranışı değişmez.
    """
    seffaf = img.mode in _ALFA_MODLARI or "transparency" in img.info
    if not seffaf:
        return img
    rgba = img if img.mode == "RGBA" else img.convert("RGBA")
    zemin = Image.new("RGB", rgba.size, (255, 255, 255))
    zemin.paste(rgba, mask=rgba.getchannel("A"))
    return zemin


def optimize_image(file_bytes: bytes, size: tuple[int, int] = (256, 256)) -> bytes:
    """Görseli kare şeklinde kırpar (crop) ve WebP formatında küçültür."""
    img = Image.open(io.BytesIO(file_bytes))

    # Düzleştirme crop/resize'dan ÖNCE yapılır. LANCZOS renk ve alfa kanallarını
    # ayrı ayrı interpole eder; şeffaf piksellerin renk değeri (0,0,0) olduğu
    # için düzleştirme sonraya bırakılsaydı yarı saydam kenarlarda koyu bir hale
    # kalırdı. Şeffaflığı olmayan görüntüde bu çağrı hiçbir şey yapmaz.
    img = flatten_on_white(img)

    # Crop to center square
    min_dim = min(img.size)
    left = (img.size[0] - min_dim) / 2
    top = (img.size[1] - min_dim) / 2
    right = (img.size[0] + min_dim) / 2
    bottom = (img.size[1] + min_dim) / 2
    img = img.crop((left, top, right, bottom))

    # Resize
    img = img.resize(size, Image.Resampling.LANCZOS)

    # Convert to WebP bytes
    out_io = io.BytesIO()
    if img.mode != "RGB":
        img = img.convert("RGB")
    img.save(out_io, format="WebP", quality=85)
    return out_io.getvalue()


def optimize_photo(file_bytes: bytes, max_dim: int = 1600, quality: int = 82) -> bytes:
    """Galeri/banner görseli: en-boy oranını KORUR, yalnız büyükse küçültür (max_dim'e
    sığdırır) ve WebP'ye çevirir. Logo/avatar'ın kare-crop'undan farkı budur."""
    img = Image.open(io.BytesIO(file_bytes))
    # Küçültmeden ÖNCE beyaz zemine düzleştir (gerekçe: `optimize_image`).
    img = flatten_on_white(img)
    img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
    if img.mode != "RGB":
        img = img.convert("RGB")
    out_io = io.BytesIO()
    img.save(out_io, format="WebP", quality=quality)
    return out_io.getvalue()


def pad_to_square(file_bytes: bytes, size: int | None = None, quality: int = 82) -> bytes:
    """Ürün görselini BEYAZ zeminli KARE tuvale oturtur (kırpma DEĞİL, pad).

    Neden ayrı bir fonksiyon: mağaza kataloğunda kitap kapağı dikey, kırtasiye
    ürünü kare/yatay geliyor. ``optimize_photo`` en-boy oranını koruduğu için
    liste kutuları farklı yükseklikte çıkıyor ve ızgara dağınık görünüyor.
    ``optimize_image``'in merkezden kare CROP'u ise burada kullanılamaz: dikey
    bir kitap kapağında kadrajın alt ve üstünü — yani kitabın adını — keser.

    Doğru davranış e-ticaret standardıdır: görsel oranı bozulmadan kareye
    SIĞDIRILIR, artan alan beyazla doldurulur.

    **``size`` sabit çıktı boyutu DEĞİL, ÜST SINIRDIR.** Görsel önce ona
    sığdırılır (yalnız küçültme; ``thumbnail`` büyütmez), sonra tuval
    **kalan içeriğin uzun kenarı** kadar açılır. Yani çıktı hep karedir ama
    boyutu girdiye göre değişir: 400×580 → 580×580, 2000×1000 → 1200×1200.

    Neden sabit tuval değil: katalogdaki kapakların %98'i 400×580, yani üst
    sınırın çok altında. Tuval her zaman 1200 olsaydı, büyütme yasağı yüzünden
    400×580'lik içerik 1200'lük karenin ortasında küçücük kalırdı —
    ``object-contain`` ile kutuya sığdırıldığında kapak görünürde yarı yarıya
    küçülürdü (ölçüldü: kutu genişliğinin ~%69'undan ~%33'üne). İçerik kadar
    tuval, hem pikselleri bozmaz hem görünen boyutu korur.

    - ``size`` verilmezse ``settings.PRODUCT_IMAGE_SIZE`` kullanılır.
    """
    ust_sinir = int(size or settings.PRODUCT_IMAGE_SIZE)
    img = Image.open(io.BytesIO(file_bytes))

    # Düzleştirme resize'dan ÖNCE (gerekçe: `optimize_image`). Sıra ters
    # çevrilirse LANCZOS yarı saydam kenarlarda (0,0,0) renk değerini
    # interpole eder ve şeffaf PNG'de koyu bir hale kalır.
    img = flatten_on_white(img)
    if img.mode != "RGB":
        img = img.convert("RGB")

    img.thumbnail((ust_sinir, ust_sinir), Image.Resampling.LANCZOS)

    # Tuval = küçültme SONRASI içeriğin uzun kenarı (üst sınır değil).
    kenar = max(img.width, img.height)
    tuval = Image.new("RGB", (kenar, kenar), (255, 255, 255))
    tuval.paste(img, ((kenar - img.width) // 2, (kenar - img.height) // 2))

    out_io = io.BytesIO()
    tuval.save(out_io, format="WebP", quality=quality)
    return out_io.getvalue()


async def _put_webp(data: bytes, *, prefix: str, client=None) -> str:
    """Optimize edilmiş WebP'yi doğru bucket'a koyar ve nesne ANAHTARINI döner.

    DB'ye anahtar yazılır; istemciye giden adresi yanıt şeması
    (``core.storage_types``) serileştirirken üretir.

    Bucket, anahtarın önekinden :func:`bucket_for_key` ile seçilir; sınıfsız
    önek yazmadan önce ``ValueError`` alır. ACL gönderilmez: MinIO obje
    ACL'lerini yok sayar, R2 ACL desteklemez; public erişim bucket (ve yerel
    MinIO'da önek whitelist'li policy) ile sağlanır.

    ``client`` verilirse (bkz. :func:`open_client`) yeni istemci açılmaz.
    """
    key = _make_key(prefix, ".webp")
    kwargs = {"Bucket": bucket_for_key(key), "Key": key, "Body": data, "ContentType": "image/webp"}
    if client is not None:
        await client.put_object(**kwargs)
        return key
    async with _s3_client() as s3:
        await s3.put_object(**kwargs)
    return key


async def _optimize_in_thread(fn, *args, **kwargs) -> bytes:
    """Pillow işini iş parçacığına taşır.

    Görsel dönüştürme saf CPU'dur ve GIL'i bırakmayan uzun bir işlemdir: event
    loop üzerinde çalıştırıldığında, 1600px'lik bir fotoğraf işlenirken TÜM
    isteklerin yanıtı durur. Aynı anda birkaç yükleme, sunucuyu yanıt veremez
    hale getirir.
    """
    return await asyncio.to_thread(fn, *args, **kwargs)


async def upload_pre_application_photo(file_bytes: bytes) -> str:
    """Eğitmen ön başvurusunun profil fotoğrafı — PRIVATE önekte.

    ``upload_avatar`` ile aynı işi yapar ama ``profiles/`` yerine
    ``private/tutor-pre-applications/`` altına yazar. Neden: bu uç ANONİMDİR.
    Public önek'e yazan bir anonim uç, siteyi herkese açık bedava görsel
    barındırmaya çevirirdi. Fotoğrafı yalnız panel görür; yanıttaki
    ``PrivateAsset`` alanı imzalı adrese çevirir.

    Pillow dosyayı gerçekten çözer: uzantı whitelist'i (``is_allowed_resource``)
    adı kontrol eder, içeriği DEĞİL. Çözülemeyen dosya burada patlar ve çağıran
    onu 415'e çevirir.
    """
    data = await _optimize_in_thread(optimize_image, file_bytes, size=(512, 512))
    return await _put_webp(data, prefix=f"{PRIVATE_PREFIX}tutor-pre-applications")


async def upload_library_photo(file_bytes: bytes, *, square: bool = False) -> str:
    """Kütüphane görseli yükler. ``square=True`` → logo (512×512 kare crop);
    aksi halde banner/galeri (en-boy korunur, max 1600px). Public anahtar döner."""
    if square:
        data = await _optimize_in_thread(optimize_image, file_bytes, size=(512, 512))
    else:
        data = await _optimize_in_thread(optimize_photo, file_bytes)
    return await _put_webp(data, prefix="library-photos")


async def upload_product_photo(file_bytes: bytes, *, client=None) -> str:
    """Mağaza ürün görseli: beyaz zeminli kare tuval (bkz. :func:`pad_to_square`).

    Önek bilerek ``library-photos`` olarak BIRAKILDI. Mevcut ürün görsellerinin
    tamamı zaten bu önekte duruyor ve önek ``PUBLIC_PREFIXES`` içinde anonim
    okumaya açık. Yeni bir önek açmak, bucket policy'nin elle yönetildiği gerçek
    S3 kurulumunda tüm ürün görsellerini sessizce 403'e düşürürdü.

    Toplu betikler ``client`` ile tek istemciyi paylaşır (bkz. :func:`open_client`).
    """
    data = await _optimize_in_thread(pad_to_square, file_bytes)
    return await _put_webp(data, prefix="library-photos", client=client)


async def upload_store_hero_photo(file_bytes: bytes) -> str:
    """Mağaza hero görseli: oranı koru, 2400px üst sınırla WebP'ye çevir.

    Masaüstü ve mobil dosyaları aynı işleme girer; kırpma içerik yöneticisinin
    yüklediği kadraja bırakılır. Obje public ``store-hero/`` öneğinde yaşar.
    """
    async with _STORE_HERO_PROCESS_LIMIT:
        data = await _optimize_in_thread(optimize_photo, file_bytes, max_dim=2400, quality=86)
    return await _put_webp(data, prefix="store-hero")


async def upload_store_showcase_photo(file_bytes: bytes) -> str:
    """Yönetilebilir vitrin kartı görseli: oranı koru ve public WebP olarak sakla."""
    async with _STORE_HERO_PROCESS_LIMIT:
        data = await _optimize_in_thread(optimize_photo, file_bytes, max_dim=1600, quality=86)
    return await _put_webp(data, prefix="store-showcase")


def _validate_store_hero_photo_sync(file_bytes: bytes) -> None:
    """Gerçek dosya türü ile açılabilir boyutu doğrula; sıkıştırma bombalarını reddet."""
    try:
        with Image.open(io.BytesIO(file_bytes)) as image:
            if image.format not in {"JPEG", "PNG", "WEBP"}:
                raise ValueError("Yalnızca JPG, PNG veya WebP görsel yüklenebilir.")
            width, height = image.size
            if width <= 0 or height <= 0 or width > 12_000 or height > 12_000:
                raise ValueError("Görsel boyutları geçersiz veya çok büyük.")
            if width * height > 16_000_000:
                raise ValueError("Görsel en fazla 16 megapiksel olabilir.")
            image.verify()
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("Dosya geçerli bir JPG, PNG veya WebP görsel değil.") from exc


async def validate_store_hero_photo(file_bytes: bytes) -> None:
    async with _STORE_HERO_PROCESS_LIMIT:
        await _optimize_in_thread(_validate_store_hero_photo_sync, file_bytes)


async def upload_delivery_photo(file_bytes: bytes) -> str:
    """Teslim kanıtı fotoğrafı (PoD) — en-boy korunur, max 1600px WebP.

    **Private**: kadraja müşterinin kapısı, sokağı, kimi zaman kendisi girer.
    Yalnız sipariş sahibine ve teslimatı yapan tarafa, imzalı URL ile gösterilir.
    """
    data = await _optimize_in_thread(optimize_photo, file_bytes)
    return await _put_webp(data, prefix=f"{PRIVATE_PREFIX}delivery-proof")


async def upload_courier_photo(file_bytes: bytes) -> str:
    """Kurye vesikalık fotoğrafı (müşteri takip sayfasında kimlik kartı) —
    512×512 kare crop + WebP.

    **Private**: çalışanın vesikalığı biyometrik nitelikli kişisel veridir.
    Takip yanıtında imzalanarak döner; yanıtın kendisi zaten sipariş sahibine
    (veya takip token'ını bilene) sınırlıdır.
    """
    data = await _optimize_in_thread(optimize_image, file_bytes, size=(512, 512))
    return await _put_webp(data, prefix=f"{PRIVATE_PREFIX}couriers")


async def upload_avatar(file_bytes: bytes) -> str:
    """Profil fotoğrafını optimize edip public bucket'a yükler, anahtar döner.

    Önek ``profiles/`` (27 Eyl 2026'ya kadar ``avatars/``); public whitelist'te.
    """
    optimized_bytes = await _optimize_in_thread(optimize_image, file_bytes)
    return await _put_webp(optimized_bytes, prefix=PROFILE_PREFIX)


async def delete_avatar(avatar_url: str) -> None:
    """Verilen URL'deki nesneyi kendi bucket'ından siler (best-effort)."""
    key = key_from_url(avatar_url)
    if not key:
        return
    try:
        bucket = bucket_for_key(key)
    except ValueError:
        # Sınıfsız (ör. eski `avatars/` önekli) nesne: hangi bucket'ta olduğu
        # güvenle bilinemez; tahminle silme yapılmaz.
        logger.warning("sınıfsız anahtar silinmedi: %s", key)
        return
    try:
        async with _s3_client() as s3:
            await s3.delete_object(Bucket=bucket, Key=key)
    except Exception:
        # best-effort silme; başarısızlık akışı bozmaz ama iz bırakırız.
        logger.warning("avatar delete failed for %s", avatar_url, exc_info=True)


async def upload_file(
    file_bytes: bytes,
    *,
    original_name: str | None,
    content_type: str | None,
    prefix: str = "lesson-resources",
) -> str:
    """Genel dosyayı (ders materyali, belge, cevap anahtarı, dijital ürün…)
    yükler ve nesne anahtarını döner.

    Avatar'dan farkı: görsel optimizasyonu YAPMAZ (PDF/doc dahil her türü olduğu
    gibi saklar). Anahtar ``private/<prefix>/<uuid><ext>`` biçimindedir:
    **bu fonksiyonun ürettiği hiçbir dosya anonim okunamaz.** Yanıtta
    ``PrivateAsset`` alanı imzalı adrese çevirir — alanı yanıta koymadan önce
    sahiplik/rol kontrolünü yapan taraf çağıran uçtur.
    """
    ext = resource_ext(original_name)
    key = _make_key(f"{PRIVATE_PREFIX}{prefix.strip('/')}", ext)
    body_kwargs = {"Bucket": bucket_for_key(key), "Key": key, "Body": file_bytes}
    if content_type:
        body_kwargs["ContentType"] = content_type

    async with _s3_client() as s3:
        await s3.put_object(**body_kwargs)
    return key


async def delete_file(url: str) -> None:
    """Genel obje silme (ders materyali). delete_avatar ile aynı bucket seçimi."""
    await delete_avatar(url)


# ── Eğitmen tanıtım videosu: imzalı PUT, HEAD, dosya indirme/yükleme ─────────
#
# Tarayıcı ham videoyu doğrudan private bucket'a PUT eder (backend'e uğramaz);
# worker indirir, FFmpeg ile işler ve çıktıyı public `tutor-videos/` önekine
# yazar. Anahtarlar YALNIZ burada üretilir; istemci hiçbir uçta anahtar
# göndermez (rastgele anahtara yazma imkânsız).


def tutor_video_source_key(tutor_id: int) -> str:
    """Ham yükleme anahtarı: ``private/tutor-videos/{tutor_id}/{uuid}.bin``.

    Uzantı `.bin`: dosyanın türüne güvenilmediğini kodda görünür kılar; içerik
    hiçbir zaman `video/*` olarak servis edilmez, yalnız worker okur.
    """
    return _make_key(f"{TUTOR_VIDEO_SOURCE_PREFIX}/{int(tutor_id)}", ".bin")


def tutor_video_output_keys() -> tuple[str, str]:
    """(mp4, poster) çifti — deneme başına yeni uuid; aynı kökü paylaşırlar."""
    stem = uuid.uuid4().hex
    mp4 = f"{TUTOR_VIDEO_PREFIX}/{stem}.mp4"
    poster = f"{TUTOR_VIDEO_PREFIX}/{stem}.jpg"
    bucket_for_key(mp4)  # public whitelist'te olduğunu garanti et
    return mp4, poster


def presign_put(key: str, *, content_type: str, ttl_seconds: int) -> str:
    """Tek anahtara, tek metoda (PUT) bağlı imzalı yükleme adresi.

    ``ContentType`` imzalı header'a girer: tarayıcı birebir aynı değeri
    göndermek zorundadır (aksi 403). ``Content-Length`` imzalı PUT ile
    zorlanamaz; boyut sınırını çağıran taraf HEAD ile uygular.

    :func:`_presign_client` tarayıcının gördüğü S3 API adresiyle imzalar
    (compose'ta ``S3_PUBLIC_ENDPOINT_URL``); private anahtar için ``_sign``
    gibi ama GET önbelleğine dokunmaz.
    """
    bucket = bucket_for_key(key)
    return _presign_client().generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": content_type},
        ExpiresIn=ttl_seconds,
        HttpMethod="PUT",
    )


def _is_missing_error(exc: Exception) -> bool:
    code = str(getattr(exc, "response", {}).get("Error", {}).get("Code", ""))
    status_code = getattr(exc, "response", {}).get("ResponseMetadata", {}).get("HTTPStatusCode")
    return code in ("404", "NoSuchKey", "NotFound") or status_code == 404


async def head_size(key: str) -> int | None:
    """Nesnenin gerçek boyutu (bayt); yoksa ``None``. Diğer hatalar yükselir."""
    try:
        async with _s3_client() as s3:
            resp = await s3.head_object(Bucket=bucket_for_key(key), Key=key)
    except Exception as exc:  # noqa: BLE001 — yalnız 404 yutulur
        if _is_missing_error(exc):
            return None
        raise
    return int(resp["ContentLength"])


async def delete_key(key: str | None) -> bool:
    """Anahtarla doğrudan silme (best-effort). Sınıfsız anahtar dokunulmaz."""
    if not key:
        return False
    try:
        bucket = bucket_for_key(key)
    except ValueError:
        logger.warning("sınıfsız anahtar silinmedi: %s", key)
        return False
    try:
        async with _s3_client() as s3:
            await s3.delete_object(Bucket=bucket, Key=key)
        return True
    except Exception:
        logger.warning("nesne silinemedi: %s", key, exc_info=True)
        return False


async def download_to_path(key: str, path: str) -> None:
    """Nesneyi diske akıtarak indirir (belleğe almaz)."""
    async with _s3_client() as s3:
        await s3.download_file(bucket_for_key(key), key, path)


async def upload_public_file(
    key: str, path: str, *, content_type: str, cache_control: str
) -> None:
    """Diskteki dosyayı public whitelist'li anahtara yükler (multipart, akış).

    ``upload_file`` (private, bellekten) yerine: büyük MP4 belleğe alınmaz ve
    ``CacheControl`` set edilir (anahtar uuid'li ve değişmez → immutable güvenli).
    """
    if not key.startswith(PUBLIC_PREFIXES):
        raise ValueError(f"public anahtar bekleniyordu: {key!r}")
    async with _s3_client() as s3:
        await s3.upload_file(
            path,
            bucket_for_key(key),
            key,
            ExtraArgs={"ContentType": content_type, "CacheControl": cache_control},
        )
