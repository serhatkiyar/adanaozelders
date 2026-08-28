"""Blog iş kuralları: sanitizasyon, slug/redirect, yaşam döngüsü.

XSS sınırı BURADADIR: `body_html` public tarafta dangerouslySetInnerHTML ile
basılır; DB'ye sanitize edilmemiş HTML asla yazılmaz. Temizlik okuma anında
değil KAYDETME anında yapılır — okuma yolu sıcak, yazma yolu nadirdir ve
temizlik bir kez yapılınca kolondaki veri her tüketici için güvenlidir.
"""
from __future__ import annotations

import datetime
import re

import nh3
from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.slug import slugify_tr
from models.blog import BlogPost, BlogPostRedirect
from schemas.blog import BlogPostWrite

#: TipTap StarterKit çıktısının karşılığı — allowlist DIŞI her şey atılır.
#: `script`, `iframe`, `style`, on* öznitelikleri ve javascript: şeması nh3'ün
#: varsayılan davranışıyla zaten temizlenir; burada kapsamı daha da daraltıyoruz.
_ALLOWED_TAGS = {
    "p", "br", "hr",
    "h2", "h3", "h4",
    "strong", "em", "s", "u", "mark",
    "a", "ul", "ol", "li",
    "blockquote", "code", "pre",
    "img", "figure", "figcaption",
    "table", "thead", "tbody", "tr", "th", "td",
}
_ALLOWED_ATTRIBUTES = {
    "a": {"href", "title"},
    "img": {"src", "alt", "title", "width", "height"},
    "th": {"colspan", "rowspan"},
    "td": {"colspan", "rowspan"},
    # `style` yalnız hizalama için: attribute_filter değeri süzer (aşağıda).
    "p": {"style"},
    "h2": {"style"},
    "h3": {"style"},
    "h4": {"style"},
}
_ALLOWED_URL_SCHEMES = {"http", "https", "mailto"}

#: TipTap TextAlign'ın ürettiği tek biçim. `style` genel bir CSS kapısı DEĞİL:
#: bu kalıba uymayan her style özniteliği bütünüyle atılır (color, font, url()
#: — hepsi). Bkz. test_blog_sanitize.py.
_HIZA_STILI = re.compile(r"^\s*text-align:\s*(left|center|right|justify)\s*;?\s*$")


def _oznitelik_suzgeci(element: str, attribute: str, value: str) -> str | None:
    if attribute != "style":
        return value
    m = _HIZA_STILI.match(value)
    return f"text-align: {m.group(1)}" if m else None


def sanitize_html(raw: str) -> str:
    """Editör HTML'ini allowlist'e indirger (saf; pytest'li)."""
    if not raw:
        return ""
    return nh3.clean(
        raw,
        tags=_ALLOWED_TAGS,
        attributes=_ALLOWED_ATTRIBUTES,
        attribute_filter=_oznitelik_suzgeci,
        url_schemes=_ALLOWED_URL_SCHEMES,
        link_rel="noopener noreferrer",
    )


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def _unique_slug(db: AsyncSession, raw: str, *, exclude_id: int | None = None) -> str:
    base = slugify_tr(raw)[:120]
    if not base:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Geçerli bir adres adı girin.")
    candidate = base
    counter = 2
    while True:
        conditions = [BlogPost.slug == candidate, BlogPost.deleted_at.is_(None)]
        if exclude_id is not None:
            conditions.append(BlogPost.id != exclude_id)
        exists = (await db.execute(select(BlogPost.id).where(*conditions))).scalar_one_or_none()
        if exists is None:
            return candidate
        candidate = f"{base}-{counter}"
        counter += 1


def _apply_payload(post: BlogPost, payload: BlogPostWrite) -> None:
    post.title = payload.title.strip()
    post.excerpt = payload.excerpt.strip()
    post.body_html = sanitize_html(payload.body_html)
    post.cover_image_url = payload.cover_image_url
    post.seo_title = payload.seo_title.strip()
    post.seo_description = payload.seo_description.strip()
    post.tags = [t.strip() for t in payload.tags if t.strip()]


async def create_post(db: AsyncSession, payload: BlogPostWrite, admin_id: int) -> BlogPost:
    post = BlogPost(
        slug=await _unique_slug(db, payload.slug or payload.title),
        created_by_admin_id=admin_id,
    )
    _apply_payload(post, payload)
    db.add(post)
    await db.flush()
    return post


async def get_post_or_404(db: AsyncSession, post_id: int) -> BlogPost:
    post = await db.get(BlogPost, post_id)
    if post is None or post.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Blog yazısı bulunamadı.")
    return post


async def update_post(db: AsyncSession, post_id: int, payload: BlogPostWrite) -> BlogPost:
    post = await get_post_or_404(db, post_id)
    if payload.slug and slugify_tr(payload.slug) != post.slug:
        new_slug = await _unique_slug(db, payload.slug, exclude_id=post.id)
        if new_slug != post.slug:
            # Yayımlanmış yazının eski linki kırılamaz; taslakta redirect gereksiz.
            if post.status == "PUBLISHED":
                db.add(BlogPostRedirect(old_slug=post.slug, post_id=post.id))
            post.slug = new_slug
    _apply_payload(post, payload)
    await db.flush()
    return post


async def publish_post(db: AsyncSession, post_id: int) -> BlogPost:
    post = await get_post_or_404(db, post_id)
    if not post.body_html.strip():
        raise HTTPException(status.HTTP_409_CONFLICT, "Boş gövdeli yazı yayımlanamaz.")
    post.status = "PUBLISHED"
    # İlk yayın tarihi korunur: tekrar yayımlamak yazıyı listede öne taşımaz.
    if post.published_at is None:
        post.published_at = _now()
    await db.flush()
    return post


async def unpublish_post(db: AsyncSession, post_id: int) -> BlogPost:
    post = await get_post_or_404(db, post_id)
    post.status = "DRAFT"
    await db.flush()
    return post


async def delete_post(db: AsyncSession, post_id: int) -> None:
    post = await get_post_or_404(db, post_id)
    post.deleted_at = _now()
    await db.flush()


async def list_admin(db: AsyncSession) -> list[BlogPost]:
    rows = (
        await db.execute(
            select(BlogPost)
            .where(BlogPost.deleted_at.is_(None))
            .order_by(BlogPost.updated_at.desc().nulls_last(), BlogPost.id.desc())
        )
    ).scalars().all()
    return list(rows)


async def list_public(db: AsyncSession, *, limit: int, offset: int) -> tuple[list[BlogPost], int]:
    conditions = [BlogPost.deleted_at.is_(None), BlogPost.status == "PUBLISHED"]
    total = (
        await db.execute(select(func.count()).select_from(BlogPost).where(*conditions))
    ).scalar_one()
    rows = (
        await db.execute(
            select(BlogPost)
            .where(*conditions)
            .order_by(BlogPost.published_at.desc(), BlogPost.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    return list(rows), int(total)


async def get_public(db: AsyncSession, slug: str) -> BlogPost:
    """Yayımlanmış yazıyı döndürür; eski slug'da redirect hedefini 404 detayında verir."""
    post = (
        await db.execute(
            select(BlogPost).where(
                BlogPost.slug == slug,
                BlogPost.deleted_at.is_(None),
                BlogPost.status == "PUBLISHED",
            )
        )
    ).scalars().first()
    if post is not None:
        return post
    redirect = (
        await db.execute(
            select(BlogPostRedirect).where(
                BlogPostRedirect.old_slug == slug,
                BlogPostRedirect.deleted_at.is_(None),
            )
        )
    ).scalars().first()
    if redirect is not None:
        target = await db.get(BlogPost, redirect.post_id)
        if target is not None and target.deleted_at is None and target.status == "PUBLISHED":
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                detail={"redirect_slug": target.slug},
            )
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Blog yazısı bulunamadı.")
