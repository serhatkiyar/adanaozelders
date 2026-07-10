import io
import logging
import os
import uuid

import aioboto3
from PIL import Image

from core.config import settings

logger = logging.getLogger(__name__)

# Ders materyali olarak kabul edilen uzantılar (public bucket'a keyfi yürütülebilir
# dosya konmasın diye whitelist). Üretimde private bucket + signed URL önerilir.
ALLOWED_RESOURCE_EXTS: frozenset[str] = frozenset(
    {
        ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif",
        ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx",
        ".txt", ".csv", ".zip",
    }
)


def resource_ext(filename: str | None) -> str:
    return os.path.splitext(filename or "")[1].lower()


def is_allowed_resource(filename: str | None) -> bool:
    return resource_ext(filename) in ALLOWED_RESOURCE_EXTS


def optimize_image(file_bytes: bytes, size: tuple[int, int] = (256, 256)) -> bytes:
    """Görseli kare şeklinde kırpar (crop) ve WebP formatında küçültür."""
    img = Image.open(io.BytesIO(file_bytes))
    
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
    img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
    if img.mode != "RGB":
        img = img.convert("RGB")
    out_io = io.BytesIO()
    img.save(out_io, format="WebP", quality=quality)
    return out_io.getvalue()


async def _put_webp(data: bytes, *, prefix: str) -> str:
    """Optimize edilmiş WebP'yi bucket'a koyar ve public URL döner (ortak yol)."""
    key = f"{prefix}/{uuid.uuid4().hex}.webp"
    body_kwargs = {
        "Bucket": settings.AWS_BUCKET_NAME,
        "Key": key,
        "Body": data,
        "ContentType": "image/webp",
    }
    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=settings.AWS_ENDPOINT_URL,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_REGION_NAME,
    ) as s3:
        try:
            await s3.put_object(**body_kwargs, ACL="public-read")
        except Exception:
            await s3.put_object(**body_kwargs)
    if settings.AWS_ENDPOINT_URL:
        return f"{settings.AWS_ENDPOINT_URL.rstrip('/')}/{settings.AWS_BUCKET_NAME}/{key}"
    return (
        f"https://{settings.AWS_BUCKET_NAME}.s3."
        f"{settings.AWS_REGION_NAME}.amazonaws.com/{key}"
    )


async def upload_library_photo(file_bytes: bytes, *, square: bool = False) -> str:
    """Kütüphane görseli yükler. ``square=True`` → logo (512×512 kare crop);
    aksi halde banner/galeri (en-boy korunur, max 1600px). Public URL döner."""
    if square:
        data = optimize_image(file_bytes, size=(512, 512))
    else:
        data = optimize_photo(file_bytes)
    return await _put_webp(data, prefix="library-photos")


async def upload_delivery_photo(file_bytes: bytes) -> str:
    """Teslim kanıtı fotoğrafı (PoD) — en-boy korunur, max 1600px WebP,
    `delivery-proof/` öneki (uuid'li anahtar; müşteri takip sayfasında gösterilir)."""
    return await _put_webp(optimize_photo(file_bytes), prefix="delivery-proof")


async def upload_courier_photo(file_bytes: bytes) -> str:
    """Kurye vesikalık fotoğrafı (müşteri takip sayfasında kimlik kartı) —
    512×512 kare crop + WebP, `couriers/` öneki."""
    return await _put_webp(optimize_image(file_bytes, size=(512, 512)), prefix="couriers")


async def upload_avatar(file_bytes: bytes) -> str:
    """Optimize edilmiş resmi S3/MinIO bucket'ına yükler ve Public URL döner."""
    optimized_bytes = optimize_image(file_bytes)
    filename = f"{uuid.uuid4().hex}.webp"
    
    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=settings.AWS_ENDPOINT_URL,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_REGION_NAME
    ) as s3:
        # Note: ACL="public-read" is often blocked by default in new S3 buckets unless configured.
        # MinIO supports it. If strict AWS S3 is used, Bucket Policies are preferred over ACLs.
        try:
            await s3.put_object(
                Bucket=settings.AWS_BUCKET_NAME,
                Key=filename,
                Body=optimized_bytes,
                ContentType="image/webp",
                ACL="public-read"
            )
        except Exception:
            # Fallback if ACL is disabled in bucket settings
            await s3.put_object(
                Bucket=settings.AWS_BUCKET_NAME,
                Key=filename,
                Body=optimized_bytes,
                ContentType="image/webp"
            )
    
    # Build public URL
    if settings.AWS_ENDPOINT_URL:
        # e.g. http://localhost:9000/avatars/123.webp
        url = f"{settings.AWS_ENDPOINT_URL.rstrip('/')}/{settings.AWS_BUCKET_NAME}/{filename}"
    else:
        url = f"https://{settings.AWS_BUCKET_NAME}.s3.{settings.AWS_REGION_NAME}.amazonaws.com/{filename}"
    return url


async def delete_avatar(avatar_url: str) -> None:
    """Verilen URL'den S3 objesini siler."""
    if not avatar_url:
        return
        
    try:
        bucket_marker = f"/{settings.AWS_BUCKET_NAME}/"
        if bucket_marker in avatar_url:
            key = avatar_url.split(bucket_marker)[1]
        else:
            key = avatar_url.split(".com/")[1]
            
        session = aioboto3.Session()
        async with session.client(
            "s3",
            endpoint_url=settings.AWS_ENDPOINT_URL,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
            region_name=settings.AWS_REGION_NAME
        ) as s3:
            await s3.delete_object(Bucket=settings.AWS_BUCKET_NAME, Key=key)
    except Exception:
        # best-effort silme; başarısızlık akışı bozmaz ama iz bırakırız.
        logger.warning("avatar delete failed for %s", avatar_url, exc_info=True)


async def upload_file(
    file_bytes: bytes, *, original_name: str | None, content_type: str | None
) -> str:
    """Genel dosyayı (ders materyali) S3/MinIO'ya yükler ve public URL döner.

    Avatar'dan farkı: görsel optimizasyonu YAPMAZ (PDF/doc dahil her türü olduğu
    gibi saklar). Anahtar `lesson-resources/<uuid><ext>` (uuid → tahmin edilemez).
    NOT: Avatar bucket'ı public-read olduğundan dosya da public erişilebilir olur;
    üretimde private bucket + presigned/proxied indirme önerilir.
    """
    ext = resource_ext(original_name)
    key = f"lesson-resources/{uuid.uuid4().hex}{ext}"
    body_kwargs = {"Bucket": settings.AWS_BUCKET_NAME, "Key": key, "Body": file_bytes}
    if content_type:
        body_kwargs["ContentType"] = content_type

    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=settings.AWS_ENDPOINT_URL,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_REGION_NAME,
    ) as s3:
        try:
            await s3.put_object(**body_kwargs, ACL="public-read")
        except Exception:
            # ACL kapalıysa (bucket policy ile public) ACL'siz dene.
            await s3.put_object(**body_kwargs)

    if settings.AWS_ENDPOINT_URL:
        return f"{settings.AWS_ENDPOINT_URL.rstrip('/')}/{settings.AWS_BUCKET_NAME}/{key}"
    return (
        f"https://{settings.AWS_BUCKET_NAME}.s3."
        f"{settings.AWS_REGION_NAME}.amazonaws.com/{key}"
    )


async def delete_file(url: str) -> None:
    """Genel obje silme (ders materyali). delete_avatar ile aynı bucket mantığı."""
    await delete_avatar(url)
