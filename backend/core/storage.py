import io
import logging
import uuid

import aioboto3
from PIL import Image

from core.config import settings

logger = logging.getLogger(__name__)


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
