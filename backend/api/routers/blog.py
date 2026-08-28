"""Blog yazıları — public okuma + admin CRUD.

Public uçlar kimlik doğrulaması istemez ve kişisel veri taşımaz; yanıtlar
`Cache-Control: public` alır (store_merchandising ile aynı desen). Admin
uçları `content.*` iznine bağlıdır — blog da vitrin sayfaları gibi bir
İÇERİK yüzeyidir, ürün kataloğu değil.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_admin_permission, user_rate_limit
from core.database import get_db
from models.admin import Admin
from schemas.blog import (
    BlogPostAdminOut,
    BlogPostListOut,
    BlogPostPublicOut,
    BlogPostSummaryOut,
    BlogPostWrite,
)
from services import audit_service, blog_service

public_router = APIRouter(prefix="/blog", tags=["blog"])
admin_router = APIRouter(prefix="/admin/blog", tags=["admin-blog"])
_write_limit = user_rate_limit(key="blog-write", limit=120, window_seconds=3600)

_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300"


@public_router.get("/posts", response_model=BlogPostListOut)
async def list_posts(
    response: Response,
    limit: int = Query(default=12, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    rows, total = await blog_service.list_public(db, limit=limit, offset=offset)
    response.headers["Cache-Control"] = _CACHE_CONTROL
    return BlogPostListOut(
        items=[BlogPostSummaryOut.model_validate(row) for row in rows], total=total
    )


@public_router.get("/posts/{slug}", response_model=BlogPostPublicOut)
async def get_post(slug: str, response: Response, db: AsyncSession = Depends(get_db)):
    post = await blog_service.get_public(db, slug)
    response.headers["Cache-Control"] = _CACHE_CONTROL
    return post


@admin_router.get("/posts", response_model=list[BlogPostAdminOut])
async def admin_list_posts(
    _admin: Admin = Depends(require_admin_permission("content.view")),
    db: AsyncSession = Depends(get_db),
):
    return await blog_service.list_admin(db)


@admin_router.get("/posts/{post_id}", response_model=BlogPostAdminOut)
async def admin_get_post(
    post_id: int,
    _admin: Admin = Depends(require_admin_permission("content.view")),
    db: AsyncSession = Depends(get_db),
):
    return await blog_service.get_post_or_404(db, post_id)


@admin_router.post("/posts", response_model=BlogPostAdminOut, status_code=201)
async def create_post(
    payload: BlogPostWrite,
    admin: Admin = Depends(require_admin_permission("content.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    post = await blog_service.create_post(db, payload, admin.id)
    await audit_service.record(db, actor=admin, action="blog_post.create", target_type="blog_post", target_id=post.id)
    # Yanıt commit'ten ÖNCE kurulur: commit sonrası expire olan ORM objesini
    # serialize etmek async dışı lazy-load (MissingGreenlet) patlatır. refresh
    # şart: updated_at server tarafında yazılır, flush objeyi expire bırakır.
    await db.refresh(post)
    out = BlogPostAdminOut.model_validate(post)
    await db.commit()
    return out


@admin_router.put("/posts/{post_id}", response_model=BlogPostAdminOut)
async def update_post(
    post_id: int,
    payload: BlogPostWrite,
    admin: Admin = Depends(require_admin_permission("content.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    post = await blog_service.update_post(db, post_id, payload)
    await audit_service.record(db, actor=admin, action="blog_post.update", target_type="blog_post", target_id=post.id)
    await db.refresh(post)
    out = BlogPostAdminOut.model_validate(post)
    await db.commit()
    return out


@admin_router.post("/posts/{post_id}/publish", response_model=BlogPostAdminOut)
async def publish_post(
    post_id: int,
    admin: Admin = Depends(require_admin_permission("content.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    post = await blog_service.publish_post(db, post_id)
    await audit_service.record(db, actor=admin, action="blog_post.publish", target_type="blog_post", target_id=post.id)
    await db.refresh(post)
    out = BlogPostAdminOut.model_validate(post)
    await db.commit()
    return out


@admin_router.post("/posts/{post_id}/unpublish", response_model=BlogPostAdminOut)
async def unpublish_post(
    post_id: int,
    admin: Admin = Depends(require_admin_permission("content.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    post = await blog_service.unpublish_post(db, post_id)
    await audit_service.record(db, actor=admin, action="blog_post.unpublish", target_type="blog_post", target_id=post.id)
    await db.refresh(post)
    out = BlogPostAdminOut.model_validate(post)
    await db.commit()
    return out


@admin_router.delete("/posts/{post_id}", status_code=204)
async def delete_post(
    post_id: int,
    admin: Admin = Depends(require_admin_permission("content.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    await blog_service.delete_post(db, post_id)
    await audit_service.record(db, actor=admin, action="blog_post.delete", target_type="blog_post", target_id=post_id)
    await db.commit()
