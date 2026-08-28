"""Blog yazısı giriş/çıkış şemaları."""
from __future__ import annotations

import datetime

from pydantic import BaseModel, Field


class BlogPostWrite(BaseModel):
    """Admin oluşturma/güncelleme gövdesi.

    `body_html` HAM editör çıktısıdır; servis kaydetmeden önce sanitize eder.
    `slug` boş bırakılırsa başlıktan üretilir.
    """

    title: str = Field(min_length=1, max_length=160)
    slug: str | None = Field(default=None, max_length=140)
    excerpt: str = Field(default="", max_length=500)
    body_html: str = Field(default="", max_length=200_000)
    cover_image_url: str | None = Field(default=None, max_length=1000)
    seo_title: str = Field(default="", max_length=70)
    seo_description: str = Field(default="", max_length=200)
    tags: list[str] = Field(default_factory=list, max_length=10)


class BlogPostAdminOut(BaseModel):
    id: int
    slug: str
    title: str
    excerpt: str
    body_html: str
    cover_image_url: str | None
    status: str
    published_at: datetime.datetime | None
    seo_title: str
    seo_description: str
    tags: list[str]
    updated_at: datetime.datetime | None = None

    model_config = {"from_attributes": True}


class BlogPostSummaryOut(BaseModel):
    """Public liste kalemi — gövde taşımaz (liste hafif kalır)."""

    slug: str
    title: str
    excerpt: str
    cover_image_url: str | None
    published_at: datetime.datetime
    tags: list[str]

    model_config = {"from_attributes": True}


class BlogPostPublicOut(BaseModel):
    slug: str
    title: str
    excerpt: str
    body_html: str
    cover_image_url: str | None
    published_at: datetime.datetime
    updated_at: datetime.datetime | None
    seo_title: str
    seo_description: str
    tags: list[str]

    model_config = {"from_attributes": True}


class BlogPostListOut(BaseModel):
    items: list[BlogPostSummaryOut]
    total: int
