"""Koleksiyon (Listelerim) iş mantığı.

Müşteri koleksiyonları kalıcı DB kayıtlarıdır (favorilerden farkı). ``share_token``
ile public paylaşılır. Ürün serileştirme ``store_service`` yardımcılarını yeniden
kullanır (``_to_search_out`` + tutor-isim lookup + Bayesian prior).
"""
from __future__ import annotations

import datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.client import Client
from models.store import Collection, CollectionItem, Product, ProductStatus
from models.tutor import Tutor
from schemas.store import CollectionDetailOut, CollectionOut, ProductSearchOut
from services.store_service import _compute_global_mean, _to_search_out

PREVIEW_LIMIT = 6


def _items_query(collection_ids: list[int]):
    """Koleksiyon(lar)ın aktif ürünleri + tutor adı; öğe ekleme sırasına göre (yeni→eski)."""
    return (
        select(CollectionItem.collection_id, Product, Tutor.first_name, Tutor.last_name)
        .join(Product, Product.id == CollectionItem.product_id)
        .outerjoin(Tutor, Tutor.id == Product.tutor_id)
        .where(
            CollectionItem.collection_id.in_(collection_ids),
            Product.status == ProductStatus.ACTIVE.value,
            Product.deleted_at.is_(None),
        )
        .order_by(CollectionItem.created_at.desc())
    )


def _serialize(rows, prior_mean: float, confidence: float) -> list[ProductSearchOut]:
    out: list[ProductSearchOut] = []
    for p, fn, ln in rows:
        name = f"{fn} {ln}".strip() if fn else None
        out.append(_to_search_out(p, prior_mean, confidence, tutor_name=name))
    return out


async def _owned(db: AsyncSession, client: Client, collection_id: int) -> Collection:
    c = (
        await db.execute(
            select(Collection).where(
                Collection.id == collection_id,
                Collection.client_id == client.id,
                Collection.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if c is None:
        raise HTTPException(status_code=404, detail="Liste bulunamadı")
    return c


async def _collection_out(db: AsyncSession, c: Collection) -> CollectionOut:
    prior_mean = await _compute_global_mean(db)
    confidence = settings.BAYESIAN_CONFIDENCE
    rows = (await db.execute(_items_query([c.id]))).all()
    grp = [(p, fn, ln) for (_cid, p, fn, ln) in rows]
    return CollectionOut(
        id=c.id,
        name=c.name,
        share_token=c.share_token,
        product_ids=[p.id for (p, _, _) in grp],
        preview=_serialize(grp[:PREVIEW_LIMIT], prior_mean, confidence),
    )


async def _detail_out(db: AsyncSession, c: Collection) -> CollectionDetailOut:
    prior_mean = await _compute_global_mean(db)
    confidence = settings.BAYESIAN_CONFIDENCE
    rows = (await db.execute(_items_query([c.id]))).all()
    items = _serialize([(p, fn, ln) for (_cid, p, fn, ln) in rows], prior_mean, confidence)
    return CollectionDetailOut(
        id=c.id, name=c.name, share_token=c.share_token, items=items
    )


async def list_collections(db: AsyncSession, client: Client) -> list[CollectionOut]:
    collections = (
        await db.execute(
            select(Collection)
            .where(
                Collection.client_id == client.id,
                Collection.deleted_at.is_(None),
            )
            .order_by(Collection.created_at.desc())
        )
    ).scalars().all()
    if not collections:
        return []

    prior_mean = await _compute_global_mean(db)
    confidence = settings.BAYESIAN_CONFIDENCE
    ids = [c.id for c in collections]
    rows = (await db.execute(_items_query(ids))).all()

    by_coll: dict[int, list] = {cid: [] for cid in ids}
    for cid, p, fn, ln in rows:
        by_coll[cid].append((p, fn, ln))

    out: list[CollectionOut] = []
    for c in collections:
        grp = by_coll.get(c.id, [])
        out.append(
            CollectionOut(
                id=c.id,
                name=c.name,
                share_token=c.share_token,
                product_ids=[p.id for (p, _, _) in grp],
                preview=_serialize(grp[:PREVIEW_LIMIT], prior_mean, confidence),
            )
        )
    return out


async def create_collection(
    db: AsyncSession, client: Client, name: str
) -> CollectionOut:
    c = Collection(client_id=client.id, name=name)
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return CollectionOut(
        id=c.id, name=c.name, share_token=c.share_token, product_ids=[], preview=[]
    )


async def rename_collection(
    db: AsyncSession, client: Client, collection_id: int, name: str
) -> CollectionOut:
    c = await _owned(db, client, collection_id)
    c.name = name
    await db.commit()
    return await _collection_out(db, c)


async def delete_collection(
    db: AsyncSession, client: Client, collection_id: int
) -> None:
    c = await _owned(db, client, collection_id)
    c.deleted_at = datetime.datetime.now(datetime.timezone.utc)
    await db.commit()


async def add_item(
    db: AsyncSession, client: Client, collection_id: int, product_id: int
) -> CollectionOut:
    c = await _owned(db, client, collection_id)
    product = (
        await db.execute(
            select(Product).where(
                Product.id == product_id,
                Product.deleted_at.is_(None),
                Product.status == ProductStatus.ACTIVE.value,
            )
        )
    ).scalar_one_or_none()
    if product is None:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı")

    exists = (
        await db.execute(
            select(CollectionItem.id).where(
                CollectionItem.collection_id == c.id,
                CollectionItem.product_id == product_id,
            )
        )
    ).scalar_one_or_none()
    if exists is None:
        db.add(CollectionItem(collection_id=c.id, product_id=product_id))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()  # eşzamanlı duplicate → idempotent
    return await _collection_out(db, c)


async def remove_item(
    db: AsyncSession, client: Client, collection_id: int, product_id: int
) -> CollectionOut:
    c = await _owned(db, client, collection_id)
    item = (
        await db.execute(
            select(CollectionItem).where(
                CollectionItem.collection_id == c.id,
                CollectionItem.product_id == product_id,
            )
        )
    ).scalar_one_or_none()
    if item is not None:
        await db.delete(item)
        await db.commit()
    return await _collection_out(db, c)


async def get_collection(
    db: AsyncSession, client: Client, collection_id: int
) -> CollectionDetailOut:
    c = await _owned(db, client, collection_id)
    return await _detail_out(db, c)


async def get_shared(db: AsyncSession, share_token: str) -> CollectionDetailOut:
    c = (
        await db.execute(
            select(Collection).where(
                Collection.share_token == share_token,
                Collection.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if c is None:
        raise HTTPException(status_code=404, detail="Liste bulunamadı")
    return await _detail_out(db, c)
