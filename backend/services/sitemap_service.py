"""Dinamik sitemap üretimi.

Arama motoru, SPA'nın "Daha fazla göster" butonuyla sayfalanan listelerini
takip edemez: `/egitmenler`, `/kutuphaneler` ve `/magaza` sayfalarının yalnız
İLK sayfası taranıyordu, sonraki her eğitmen/kütüphane/ürün organik olarak
erişilemez durumdaydı. Bir pazaryerinin değeri uzun kuyruk sorgularındadır
("adana matematik özel ders") — sitemap o kuyruğu görünür kılar.

Tasarım:
- URL'ler frontend rotalarıyla BİREBİR aynı olmalı; sapma 404 üretir ve
  Search Console'da "tarama hatası" olarak birikir.
- Yalnız public ve indekslenebilir kayıtlar: onaylı eğitmen, ACTIVE kütüphane,
  ACTIVE ürün. Taslak/gizli kayıt sitemap'e girerse crawler bütçesi çöpe gider.
- `lastmod` varsa verilir (crawler'ın yeniden ziyaret sıklığını ayarlar).
"""
from __future__ import annotations

import datetime
from xml.sax.saxutils import escape

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.slug import tutor_slug
from models.library import Library, LibraryStatus
from models.store import Product, ProductStatus
from models.tutor import Tutor, TutorStatus
from models.store_merchandising import StoreLandingPage, StoreLandingPagePublication

#: Statik public sayfalar — (yol, değişim sıklığı, öncelik).
STATIC_PATHS: tuple[tuple[str, str, str], ...] = (
    ("/", "daily", "1.0"),
    ("/egitmenler", "daily", "0.9"),
    ("/kutuphaneler", "weekly", "0.8"),
    ("/magaza", "daily", "0.9"),
    ("/sss", "monthly", "0.5"),
    ("/iletisim", "yearly", "0.4"),
    ("/kvkk", "yearly", "0.3"),
    ("/gizlilik-politikasi", "yearly", "0.3"),
    ("/kullanim-kosullari", "yearly", "0.3"),
    ("/mesafeli-satis-sozlesmesi", "yearly", "0.3"),
    ("/iptal-ve-iade-politikasi", "yearly", "0.3"),
    ("/cerez-politikasi", "yearly", "0.3"),
)

#: Tek sitemap'te en çok kaç URL (protokol sınırı 50.000; erken bölmek için).
MAX_URLS = 10_000


def _base_url() -> str:
    return settings.FRONTEND_BASE_URL.rstrip("/")


def _url_entry(
    path: str,
    *,
    lastmod: datetime.datetime | None = None,
    changefreq: str | None = None,
    priority: str | None = None,
) -> str:
    parts = [f"    <loc>{escape(_base_url() + path)}</loc>"]
    if lastmod is not None:
        parts.append(f"    <lastmod>{lastmod.date().isoformat()}</lastmod>")
    if changefreq:
        parts.append(f"    <changefreq>{changefreq}</changefreq>")
    if priority:
        parts.append(f"    <priority>{priority}</priority>")
    return "  <url>\n" + "\n".join(parts) + "\n  </url>"


def render_sitemap(entries: list[str]) -> str:
    """URL girdilerinden sitemap XML'i (saf; pytest'li)."""
    body = "\n".join(entries)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{body}\n"
        "</urlset>\n"
    )


def tutor_path(slug: str) -> str:
    """Eğitmen profili — frontend `/egitmenler/:slug` ile birebir."""
    return f"/egitmenler/{slug}"


def library_path(slug: str) -> str:
    return f"/kutuphaneler/{slug}"


def product_path(slug: str) -> str:
    return f"/magaza/urun/{slug}"


async def build_sitemap(db: AsyncSession) -> str:
    """Tüm public URL'leri toplayıp sitemap XML'i üretir."""
    entries: list[str] = [
        _url_entry(path, changefreq=freq, priority=prio)
        for path, freq, prio in STATIC_PATHS
    ]

    # ── Eğitmenler (yalnız onaylı ve aktif) ──
    # Eğitmen slug'ı DB'de tutulmaz, `id + ad`dan hesaplanır (schemas/tutor.py
    # ile AYNI fonksiyon) — sapma olursa sitemap 404'e işaret eder.
    tutors = (
        await db.execute(
            select(Tutor.id, Tutor.first_name, Tutor.last_name, Tutor.updated_at)
            .where(
                Tutor.status == TutorStatus.APPROVED,
                Tutor.is_active.is_(True),
                Tutor.deleted_at.is_(None),
            )
            .limit(MAX_URLS)
        )
    ).all()
    entries += [
        _url_entry(
            tutor_path(tutor_slug(tid, f"{first or ''} {last or ''}".strip())),
            lastmod=updated,
            changefreq="weekly",
            priority="0.8",
        )
        for tid, first, last, updated in tutors
    ]

    # ── Kütüphaneler (yalnız ACTIVE) ──
    libraries = (
        await db.execute(
            select(Library.slug, Library.updated_at)
            .where(
                Library.status == LibraryStatus.ACTIVE.value,
                Library.deleted_at.is_(None),
            )
            .limit(MAX_URLS)
        )
    ).all()
    entries += [
        _url_entry(library_path(slug), lastmod=updated, changefreq="weekly", priority="0.7")
        for slug, updated in libraries
        if slug
    ]

    # ── Ürünler (yalnız ACTIVE) ──
    products = (
        await db.execute(
            select(Product.slug, Product.updated_at)
            .where(
                Product.status == ProductStatus.ACTIVE.value,
                Product.deleted_at.is_(None),
            )
            .limit(MAX_URLS)
        )
    ).all()
    entries += [
        _url_entry(product_path(slug), lastmod=updated, changefreq="weekly", priority="0.7")
        for slug, updated in products
        if slug
    ]

    # ── Kalıcı mağaza vitrinleri (yayına en az bir kez çıkmış; HOME kök URL'de) ──
    now = datetime.datetime.now(datetime.timezone.utc)
    pages = (
        await db.execute(
            select(StoreLandingPage.slug, StoreLandingPage.updated_at)
            .join(StoreLandingPagePublication, StoreLandingPagePublication.page_id == StoreLandingPage.id)
            .where(
                StoreLandingPage.deleted_at.is_(None),
                StoreLandingPage.is_archived.is_(False),
                StoreLandingPage.page_type != "HOME",
                StoreLandingPagePublication.deleted_at.is_(None),
                StoreLandingPagePublication.starts_at <= now,
            )
            .distinct()
            .limit(MAX_URLS)
        )
    ).all()
    entries += [
        _url_entry(f"/magaza/{slug}", lastmod=updated, changefreq="weekly", priority="0.8")
        for slug, updated in pages
        if slug
    ]

    return render_sitemap(entries)
