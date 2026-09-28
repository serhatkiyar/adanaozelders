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
from models.blog import BlogPost
from models.library import Library, LibraryStatus
from models.seo_slug import SeoSlug
from models.store import Product, ProductStatus
from models.tutor import Tutor, TutorStatus
from services import seo_sayfa_service

#: Statik public sayfalar — (yol, değişim sıklığı, öncelik).
STATIC_PATHS: tuple[tuple[str, str, str], ...] = (
    ("/", "daily", "1.0"),
    ("/egitmenler", "daily", "0.9"),
    ("/kutuphaneler", "weekly", "0.8"),
    ("/magaza", "daily", "0.9"),
    # Manuel vitrin: kampanya sayfaları kodda yaşar, sabit yol olarak girer.
    ("/magaza/okula-donus", "weekly", "0.8"),
    ("/blog", "daily", "0.7"),
    ("/sss", "monthly", "0.5"),
    ("/iletisim", "yearly", "0.4"),
    ("/hakkimizda", "yearly", "0.4"),
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
    """ESKİ eğitmen adresi — frontend `/egitmenler/:slug` (artık yönlendirme)."""
    return f"/egitmenler/{slug}"


def library_path(slug: str) -> str:
    return f"/kutuphaneler/{slug}"


def product_path(slug: str) -> str:
    return f"/magaza/urun/{slug}"


def blog_path(slug: str) -> str:
    return f"/blog/{slug}"


async def build_sitemap(db: AsyncSession) -> str:
    """Tüm public URL'leri toplayıp sitemap XML'i üretir."""
    entries: list[str] = [
        _url_entry(path, changefreq=freq, priority=prio)
        for path, freq, prio in STATIC_PATHS
    ]

    # ── İlanlar (yalnız yayındaki eğitmenler) — KÖK ilan adresi (Modül 6) ──
    # Eski `/egitmenler/<slug>` adresi artık kalıcı yönlendirmedir; sitemap'e
    # yönlenen adres DEĞİL hedefi girer (Search Console "yönlendirmeli sayfa"
    # uyarısı biriktirmesin). Adresi henüz verilmemiş yayındaki eğitmen (ör.
    # komut koşmadan önce) eski adresle kalır — o adres sayfayı açar.
    ilanlar = await seo_sayfa_service.ilan_adresleri(db)
    entries += [
        _url_entry(yol, lastmod=guncel, changefreq="weekly", priority="0.8")
        for yol, guncel in ilanlar
    ]
    tutors = (
        await db.execute(
            select(Tutor.id, Tutor.first_name, Tutor.updated_at)
            .where(
                Tutor.status == TutorStatus.APPROVED,
                Tutor.is_active.is_(True),
                Tutor.deleted_at.is_(None),
                ~Tutor.id.in_(
                    select(SeoSlug.tutor_id).where(
                        SeoSlug.kind == "ilan", SeoSlug.is_current.is_(True)
                    )
                ),
            )
            .limit(MAX_URLS)
        )
    ).all()
    entries += [
        _url_entry(
            # Yalnız AD (ÜK-9): sitemap slug'ları doğrudan arama motorlarına
            # veriyor, yani soyad buraya girerse arayüzden kaldırılmış olması
            # hiçbir şey ifade etmez.
            tutor_path(tutor_slug(tid, first or "")),
            lastmod=updated,
            changefreq="weekly",
            priority="0.8",
        )
        for tid, first, updated in tutors
    ]

    # ── Ders ve ilçe+ders sayfaları — yalnız en az bir yayındaki öğretmen
    # varsa (boş sayfa sitemap'e girmez; açılma kuralı seo_sayfa_service'te).
    entries += [
        _url_entry(yol, changefreq="daily", priority="0.9" if yol.count("/") == 1 else "0.8")
        for yol in await seo_sayfa_service.acik_sayfa_yollari(db)
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


    # ── Blog yazıları (yalnız PUBLISHED — taslak sitemap'e sızmaz) ──
    posts = (
        await db.execute(
            select(BlogPost.slug, BlogPost.updated_at)
            .where(
                BlogPost.status == "PUBLISHED",
                BlogPost.deleted_at.is_(None),
            )
            .limit(MAX_URLS)
        )
    ).all()
    entries += [
        _url_entry(blog_path(slug), lastmod=updated, changefreq="weekly", priority="0.7")
        for slug, updated in posts
        if slug
    ]

    return render_sitemap(entries)
