import asyncio
import io
import json
import logging
import os
import time
import uuid
from collections.abc import Sequence
from functools import lru_cache

import aioboto3
from botocore.config import Config as BotoConfig
from PIL import Image

from core.config import settings

logger = logging.getLogger(__name__)

# Büyük banner decode/encode işleri aynı anda sınırsız thread açmasın. Bu sınır
# yalnız mağaza vitrinine özeldir; avatar/ürün yüklemelerini birbirine kilitlemez.
_STORE_HERO_PROCESS_LIMIT = asyncio.Semaphore(2)

# ── Erişim sınıfları ────────────────────────────────────────────────────────────
#
# Bucket TEK, ama iki erişim sınıfı vardır ve ayrım ANAHTAR ÖNEKİYLE yapılır:
#
#   PUBLIC_PREFIXES  → anonim okumaya açık (bucket policy'de açıkça listelenir).
#                      Yalnız zaten herkese gösterilen görseller: avatar, kütüphane
#                      ve ürün fotoğrafları.
#   PRIVATE_PREFIX   → hiçbir Allow kapsamında DEĞİL → anonim GET 403 alır.
#                      Erişim yalnız kısa ömürlü presigned URL ile olur; URL'i
#                      yanıta koyan uç, yetkiyi kendi katmanında zaten doğrular.
#
# Neden whitelist-Allow, neden `private/*` üzerine Deny değil: Deny ifadesi
# `Principal: *` ile yazıldığında imzalı (kimlikli) isteği de kapsayabilir ve
# presigned URL'i sessizce kırar. Allow'u daraltmak aynı sonucu, sürpriz
# etkileşim olmadan verir.
PUBLIC_PREFIXES: tuple[str, ...] = (
    "avatars/",
    "library-photos/",
    "store-hero/",
    "store-showcase/",
)
PRIVATE_PREFIX = "private/"


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


async def ensure_bucket() -> None:
    """Açılışta bucket'ı ve anonim-okuma policy'sini garanti eder (best-effort).

    Yalnız self-hosted uçta (``AWS_ENDPOINT_URL`` dolu — MinIO) çalışır; gerçek
    AWS S3'te bucket/policy konsoldan yönetilir. Hata uygulamayı durdurmaz
    (loglanır) — compose'daki tek-seferlik ``minio-init`` konteynerine
    bağımlılığı kaldırır (volume sıfırlanınca fotoğraflar 403 vermesin).
    """
    if not settings.AWS_ENDPOINT_URL:
        return
    try:
        async with _s3_client() as s3:
            try:
                await s3.head_bucket(Bucket=settings.AWS_BUCKET_NAME)
            except Exception:
                await s3.create_bucket(Bucket=settings.AWS_BUCKET_NAME)
            await s3.put_bucket_policy(
                Bucket=settings.AWS_BUCKET_NAME,
                Policy=public_read_policy(settings.AWS_BUCKET_NAME),
            )
            logger.info("MinIO bucket hazır: %s (anonim okuma açık)", settings.AWS_BUCKET_NAME)
    except Exception:
        logger.warning(
            "MinIO bucket/policy garantilenemedi (storage kapalı olabilir)",
            exc_info=True,
        )


# ── Anahtar / URL dönüşümleri ───────────────────────────────────────────────────


def object_url(key: str) -> str:
    """Anahtardan kalıcı URL üretir (DB'de bu biçim saklanır).

    Private anahtarlar için bu URL tek başına ÇALIŞMAZ (anonim GET 403) —
    kullanıma sunulmadan önce :func:`presign` ile imzalanır.
    """
    endpoint = _public_endpoint()
    if endpoint:
        return f"{endpoint.rstrip('/')}/{settings.AWS_BUCKET_NAME}/{key}"
    return f"https://{settings.AWS_BUCKET_NAME}.s3.{settings.AWS_REGION_NAME}.amazonaws.com/{key}"


def key_from_url(url: str | None) -> str | None:
    """URL'den obje anahtarını çıkarır; tanınmayan adreste ``None``.

    Hem dahili (``minio:9000``) hem tarayıcı (``localhost:9000``) adresiyle
    yazılmış eski kayıtları tanır: ayrıştırma bucket adına göre yapılır.
    """
    if not url:
        return None
    marker = f"/{settings.AWS_BUCKET_NAME}/"
    if marker in url:
        return url.split(marker, 1)[1].split("?", 1)[0]
    if ".amazonaws.com/" in url:
        return url.split(".amazonaws.com/", 1)[1].split("?", 1)[0]
    return None


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

    return boto3.client(
        "s3",
        endpoint_url=_public_endpoint() or None,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_REGION_NAME,
        config=BotoConfig(signature_version="s3v4"),
    )


def presign(url: str | None, *, ttl: int | None = None) -> str | None:
    """Private URL'i kısa ömürlü imzalı URL'e çevirir; public URL'e dokunmaz.

    Çağrı yerlerinde koşul yazılmasın diye her iki sınıfı da kabul eder: public
    bir adres olduğu gibi geri döner. Böylece bir alan yanlışlıkla private'a
    taşındığında da yüzey çalışmaya devam eder.
    """
    return presign_many([url], ttl=ttl)[0]


# İmzalı adres önbelleği: anahtar → (adres, üretim anı).
#
# Sadece hız için değil, KARARLILIK için var. İmza her yanıtta yeniden
# üretilirse aynı fotoğrafın adresi her istekte değişir; canlı takip sayfası
# 15 sn'de bir yenilendiğinden tarayıcı kurye vesikalığını ve kanıt fotoğrafını
# her turda baştan indirir ve görsel gözle görülür biçimde titrer. Aynı anahtara
# aynı adresi vermek, tarayıcı önbelleğinin çalışmasını sağlar.
_presign_cache: dict[tuple[str, int], tuple[str, float]] = {}
_PRESIGN_CACHE_MAX = 4096


def presign_many(urls: Sequence[str | None], *, ttl: int | None = None) -> list[str | None]:
    """:func:`presign`'in toplu hâli (liste yanıtları için)."""
    seconds = ttl or settings.S3_PRESIGN_TTL_SECONDS
    now = time.monotonic()
    out: list[str | None] = list(urls)
    for i, u in enumerate(out):
        key = key_from_url(u)
        if not is_private_key(key):
            continue
        cache_key = (key, seconds)  # type: ignore[assignment]
        hit = _presign_cache.get(cache_key)
        # Ömrünün yarısını geçmiş imzayı yenile: dönen adres her zaman en az
        # TTL/2 kadar geçerli kalsın (istemci sayfayı hemen açmayabilir).
        if hit is not None and (now - hit[1]) < seconds / 2:
            out[i] = hit[0]
            continue
        try:
            signed = _presign_client().generate_presigned_url(
                "get_object",
                Params={"Bucket": settings.AWS_BUCKET_NAME, "Key": key},
                ExpiresIn=seconds,
            )
        except Exception:
            # İmzalanamayan adres ham hâliyle döner: anonim erişime kapalı
            # olduğu için sızıntı olmaz, yüzeyde kırık bağlantı görünür.
            logger.warning("presigned URL üretilemedi", exc_info=True)
            continue
        if len(_presign_cache) >= _PRESIGN_CACHE_MAX:
            _presign_cache.clear()  # basit tavan: sınırsız büyümesin
        _presign_cache[cache_key] = (signed, now)
        out[i] = signed
    return out


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


async def _put_webp(data: bytes, *, prefix: str) -> str:
    """Optimize edilmiş WebP'yi bucket'a koyar ve kalıcı URL döner (ortak yol).

    ``prefix`` erişim sınıfını belirler: ``PRIVATE_PREFIX`` ile başlıyorsa obje
    anonim okumaya kapalıdır. ACL denemesi yalnız public öneklerde yapılır —
    private objeye ``public-read`` ACL'i vermek, policy kapalı olsa bile
    (ACL'leri onurlandıran bir kurulumda) dosyayı açığa çıkarırdı.
    """
    key = f"{prefix}/{uuid.uuid4().hex}.webp"
    body_kwargs = {
        "Bucket": settings.AWS_BUCKET_NAME,
        "Key": key,
        "Body": data,
        "ContentType": "image/webp",
    }
    async with _s3_client() as s3:
        if is_private_key(key):
            await s3.put_object(**body_kwargs)
        else:
            try:
                await s3.put_object(**body_kwargs, ACL="public-read")
            except Exception:
                await s3.put_object(**body_kwargs)
    return object_url(key)


async def _optimize_in_thread(fn, *args, **kwargs) -> bytes:
    """Pillow işini iş parçacığına taşır.

    Görsel dönüştürme saf CPU'dur ve GIL'i bırakmayan uzun bir işlemdir: event
    loop üzerinde çalıştırıldığında, 1600px'lik bir fotoğraf işlenirken TÜM
    isteklerin yanıtı durur. Aynı anda birkaç yükleme, sunucuyu yanıt veremez
    hale getirir.
    """
    return await asyncio.to_thread(fn, *args, **kwargs)


async def upload_library_photo(file_bytes: bytes, *, square: bool = False) -> str:
    """Kütüphane görseli yükler. ``square=True`` → logo (512×512 kare crop);
    aksi halde banner/galeri (en-boy korunur, max 1600px). Public URL döner."""
    if square:
        data = await _optimize_in_thread(optimize_image, file_bytes, size=(512, 512))
    else:
        data = await _optimize_in_thread(optimize_photo, file_bytes)
    return await _put_webp(data, prefix="library-photos")


async def upload_product_photo(file_bytes: bytes) -> str:
    """Mağaza ürün görseli: beyaz zeminli kare tuval (bkz. :func:`pad_to_square`).

    Önek bilerek ``library-photos`` olarak BIRAKILDI. Mevcut ürün görsellerinin
    tamamı zaten bu önekte duruyor ve önek ``PUBLIC_PREFIXES`` içinde anonim
    okumaya açık. Yeni bir önek açmak, bucket policy'nin elle yönetildiği gerçek
    S3 kurulumunda tüm ürün görsellerini sessizce 403'e düşürürdü.
    """
    data = await _optimize_in_thread(pad_to_square, file_bytes)
    return await _put_webp(data, prefix="library-photos")


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
    """Profil fotoğrafını optimize edip yükler ve public URL döner.

    Anahtar ``avatars/`` öneklidir (eskiden bucket kökündeydi): anonim okuma
    izni artık önek listesine dayandığı için köke yazılan obje erişilemez olur.
    """
    optimized_bytes = await _optimize_in_thread(optimize_image, file_bytes)
    return await _put_webp(optimized_bytes, prefix="avatars")


async def delete_avatar(avatar_url: str) -> None:
    """Verilen URL'den S3 objesini siler."""
    key = key_from_url(avatar_url)
    if not key:
        return
    try:
        async with _s3_client() as s3:
            await s3.delete_object(Bucket=settings.AWS_BUCKET_NAME, Key=key)
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
    yükler ve kalıcı URL döner.

    Avatar'dan farkı: görsel optimizasyonu YAPMAZ (PDF/doc dahil her türü olduğu
    gibi saklar). Anahtar ``private/<prefix>/<uuid><ext>`` biçimindedir:
    **bu fonksiyonun ürettiği hiçbir dosya anonim okunamaz.** Kullanıcıya
    gösterilmeden önce :func:`presign` ile imzalanmalıdır — çağıran uç, imzayı
    koymadan önce sahiplik/rol kontrolünü yapan taraftır.
    """
    ext = resource_ext(original_name)
    key = f"{PRIVATE_PREFIX}{prefix.strip('/')}/{uuid.uuid4().hex}{ext}"
    body_kwargs = {"Bucket": settings.AWS_BUCKET_NAME, "Key": key, "Body": file_bytes}
    if content_type:
        body_kwargs["ContentType"] = content_type

    async with _s3_client() as s3:
        await s3.put_object(**body_kwargs)
    return object_url(key)


async def delete_file(url: str) -> None:
    """Genel obje silme (ders materyali). delete_avatar ile aynı bucket mantığı."""
    await delete_avatar(url)
