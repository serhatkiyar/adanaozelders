"""Mevcut mağaza görsellerini kanonik medya kütüphanesine kaydeder.

Tekrar çalıştırılabilir: ``image_url`` zaten kayıtlıysa dokunmaz. Dosyaları
yeniden yüklemez; MinIO/S3'teki mevcut objenin boyut ve tür bilgisini okur.
"""
from __future__ import annotations

import asyncio
import io
from collections.abc import Iterable

from PIL import Image
from sqlalchemy import select

from core import storage
from core.config import settings
from core.database import AsyncSessionLocal
from models import (
    StoreHeroSlide,
    StoreHomeSection,
    StoreLandingPageBlock,
    StoreMediaAsset,
    StoreShowcaseCard,
)


def _images(value: object) -> Iterable[tuple[str, str]]:
    if isinstance(value, dict):
        url = value.get("image_url")
        if isinstance(url, str) and url:
            yield url, str(value.get("alt_text") or value.get("label") or "")
        for nested in value.values():
            yield from _images(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from _images(nested)


async def main() -> None:
    async with AsyncSessionLocal() as db:
        candidates: dict[str, str] = {}

        heroes = (await db.execute(select(StoreHeroSlide).where(StoreHeroSlide.deleted_at.is_(None)))).scalars()
        for slide in heroes:
            candidates[slide.image_url] = slide.alt_text
            if slide.mobile_image_url:
                candidates[slide.mobile_image_url] = slide.alt_text

        cards = (await db.execute(select(StoreShowcaseCard).where(StoreShowcaseCard.deleted_at.is_(None)))).scalars()
        for card in cards:
            for url, alt in _images(card.custom_tiles):
                candidates.setdefault(url, alt or card.title)

        sections = (await db.execute(select(StoreHomeSection).where(StoreHomeSection.deleted_at.is_(None)))).scalars()
        for section in sections:
            for url, alt in _images(section.image_tiles):
                candidates.setdefault(url, alt or section.title)

        blocks = (await db.execute(select(StoreLandingPageBlock).where(StoreLandingPageBlock.deleted_at.is_(None)))).scalars()
        for block in blocks:
            for url, alt in _images(block.config):
                candidates.setdefault(url, alt or block.title)

        existing = set((await db.execute(select(StoreMediaAsset.image_url))).scalars())
        added = skipped = unreadable = 0
        async with storage._s3_client() as s3:  # aynı bucket; obje taşınmaz
            for url, alt in candidates.items():
                if url in existing:
                    skipped += 1
                    continue
                key = storage.key_from_url(url)
                if not key:
                    unreadable += 1
                    print(f"  atlandı (tanınmayan URL): {url}")
                    continue
                try:
                    response = await s3.get_object(Bucket=settings.AWS_BUCKET_NAME, Key=key)
                    data = await response["Body"].read()
                    with Image.open(io.BytesIO(data)) as image:
                        width, height = image.size
                        mime = Image.MIME.get(image.format or "", response.get("ContentType") or "application/octet-stream")
                    db.add(StoreMediaAsset(
                        image_url=url,
                        alt_text=alt[:180],
                        mime_type=mime,
                        width=width,
                        height=height,
                        file_size=len(data),
                    ))
                    existing.add(url)
                    added += 1
                except Exception as exc:
                    unreadable += 1
                    print(f"  atlandı (obje okunamadı): {url} ({exc})")

        await db.commit()
        print(f"Eklendi: {added}, zaten kayıtlı: {skipped}, okunamadı: {unreadable}")


if __name__ == "__main__":
    asyncio.run(main())
