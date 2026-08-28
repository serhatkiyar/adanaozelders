"""Blog yazıları — SEO içerik yüzeyi.

Vitrin sayfalarının (store_merchandising) aksine tam revizyon zinciri YOK:
blog yazısı tek gövdedir, DRAFT/PUBLISHED yaşam döngüsü yeter. Slug
değişiminde eski URL `BlogPostRedirect` ile korunur (StoreLandingPageRedirect
deseni) — yayımlanmış bir yazının linki sosyal medyada dolaşımdadır, kırılamaz.

`body_html` SANİTİZE EDİLMİŞ HTML tutar: temizlik kaydetme anında
`services/blog_service.py::sanitize_html` ile yapılır; bu kolona ham kullanıcı
HTML'i asla yazılmaz (public taraf onu dangerouslySetInnerHTML ile basar).
"""
from __future__ import annotations

import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin


class BlogPost(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "blog_posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(140), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    excerpt: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    body_html: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    cover_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'DRAFT'"))
    published_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    seo_title: Mapped[str] = mapped_column(String(70), nullable=False, server_default=text("''"))
    seo_description: Mapped[str] = mapped_column(
        String(200), nullable=False, server_default=text("''")
    )
    tags: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    created_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        Index(
            "uq_blog_posts_slug_active",
            "slug",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        CheckConstraint("status IN ('DRAFT', 'PUBLISHED')", name="ck_blog_posts_status"),
        # Yayımlanmış yazının yayın tarihi olmak zorundadır — sitemap ve liste
        # sıralaması buna dayanır.
        CheckConstraint(
            "status != 'PUBLISHED' OR published_at IS NOT NULL",
            name="ck_blog_posts_published_at",
        ),
    )


class BlogPostRedirect(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "blog_post_redirects"

    id: Mapped[int] = mapped_column(primary_key=True)
    old_slug: Mapped[str] = mapped_column(String(140), nullable=False)
    post_id: Mapped[int] = mapped_column(
        ForeignKey("blog_posts.id", ondelete="CASCADE"), nullable=False
    )

    __table_args__ = (
        Index(
            "uq_blog_post_redirects_slug_active",
            "old_slug",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )
