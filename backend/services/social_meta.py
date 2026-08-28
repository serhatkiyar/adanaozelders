"""Sosyal paylaşım önizlemesi için sunucu tarafı meta HTML'i.

Sorun: uygulama bir SPA ve `dist/index.html` HER rota için aynı jenerik
başlık/açıklamayı içeriyor; meta etiketleri ancak tarayıcıda JS çalışınca
(react-helmet) yerleşiyor. WhatsApp, Twitter, Facebook, LinkedIn ve Telegram
önizleme botları **JS ÇALIŞTIRMAZ** — bir eğitmen profili ya da ürün linki
paylaşıldığında önizlemede eğitmenin adı/fotoğrafı değil, jenerik site başlığı
ve logo çıkıyordu. Pazaryerinde paylaşım birincil edinim kanalıdır.

Çözüm: tam SSR/prerender altyapısı kurmak yerine (mimari değişiklik, sürekli
bakım), ters proxy yalnız BOT isteklerini buraya yönlendirir; burada veritabanı
sorgusuyla doldurulmuş küçük bir HTML iskeleti döner. Gerçek kullanıcılar
normal SPA'yı alır — hiçbir davranış değişmez.

Bot olmayan istekler buraya HİÇ gelmemeli (Caddy user-agent'a göre ayırır);
yine de gelirse sayfa `<noscript>` içeriğiyle birlikte SPA'ya yönlendirir.
"""
from __future__ import annotations

import re
from html import escape

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.blog import BlogPost
from models.library import Library, LibraryStatus
from models.store import Product, ProductStatus
from models.tutor import Tutor, TutorStatus

SITE_NAME = "Adana Özel Ders"
DEFAULT_TITLE = "Adana Özel Ders — Uzman Eğitmenle Öğren"
DEFAULT_DESCRIPTION = (
    "Adana'da alanında uzman eğitmenlerle birebir özel ders al, "
    "kütüphane ve etüt merkezlerini keşfet, kaynak kitaplarını kapına getirelim."
)
DEFAULT_IMAGE = "/logo.png"

#: Slug'ın sonundaki id ("ayse-yilmaz-12" → 12) — eğitmen profili için.
#: İsimsiz eğitmende slug SALT id olur ("7"); core/slug.py::tutor_slug
#: base boşsa tire koymadan id döndürür.
_TRAILING_ID = re.compile(r"(?:^|-)(\d+)$")


def _abs(url: str | None) -> str:
    base = settings.FRONTEND_BASE_URL.rstrip("/")
    if not url:
        return base + DEFAULT_IMAGE
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return base + "/" + url.lstrip("/")


def tutor_id_from_slug(slug: str) -> int | None:
    """`isim-soyisim-12` → 12. Kanonik slug id ile biter (bkz. core/slug.py)."""
    m = _TRAILING_ID.search(slug)
    return int(m.group(1)) if m else None


def truncate(text: str | None, limit: int = 200) -> str:
    """Açıklamayı önizleme sınırına indirger (kelime ortasından kesmez)."""
    if not text:
        return DEFAULT_DESCRIPTION
    clean = " ".join(text.split())
    if len(clean) <= limit:
        return clean
    cut = clean[:limit].rsplit(" ", 1)[0]
    return cut + "…"


def render_meta_html(
    *, title: str, description: str, image: str, url: str, kind: str = "website"
) -> str:
    """Bot'a sunulacak minimal HTML (saf; pytest'li).

    İçerik gövdede de tekrar edilir: bazı botlar yalnız meta okur, bazıları
    ilk paragrafı da kullanır.
    """
    t, d = escape(title), escape(description)
    return f"""<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>{t}</title>
<meta name="description" content="{d}">
<link rel="canonical" href="{escape(url)}">
<meta property="og:type" content="{escape(kind)}">
<meta property="og:site_name" content="{escape(SITE_NAME)}">
<meta property="og:title" content="{t}">
<meta property="og:description" content="{d}">
<meta property="og:image" content="{escape(image)}">
<meta property="og:url" content="{escape(url)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{t}">
<meta name="twitter:description" content="{d}">
<meta name="twitter:image" content="{escape(image)}">
</head>
<body>
<h1>{t}</h1>
<p>{d}</p>
<p><a href="{escape(url)}">{escape(SITE_NAME)}</a></p>
</body>
</html>
"""


async def meta_for_path(db: AsyncSession, path: str) -> str:
    """Verilen public yol için meta HTML'i üretir.

    Bilinmeyen/yetkisiz yolda jenerik site meta'sına düşer — bot'a 404 vermek
    paylaşımın tamamen önizlemesiz görünmesine yol açar.
    """
    clean = "/" + path.strip("/")
    url = settings.FRONTEND_BASE_URL.rstrip("/") + (clean if clean != "/" else "/")

    title, description, image, kind = (
        DEFAULT_TITLE,
        DEFAULT_DESCRIPTION,
        _abs(None),
        "website",
    )

    # ── Eğitmen profili ──
    if clean.startswith("/egitmenler/"):
        slug = clean.removeprefix("/egitmenler/").split("/")[0]
        tid = tutor_id_from_slug(slug)
        if tid is not None:
            tutor = (
                await db.execute(
                    select(Tutor).where(
                        Tutor.id == tid,
                        Tutor.status == TutorStatus.APPROVED,
                        Tutor.is_active.is_(True),
                        Tutor.deleted_at.is_(None),
                    )
                )
            ).scalars().first()
            if tutor is not None:
                name = f"{tutor.first_name or ''} {tutor.last_name or ''}".strip()
                title = f"{name} — Özel Ders | {SITE_NAME}"
                description = truncate(
                    getattr(tutor, "headline", None) or getattr(tutor, "about", None)
                )
                image = _abs(getattr(tutor, "avatar_url", None))
                kind = "profile"

    # ── Kütüphane ──
    elif clean.startswith("/kutuphaneler/"):
        slug = clean.removeprefix("/kutuphaneler/").split("/")[0]
        lib = (
            await db.execute(
                select(Library).where(
                    Library.slug == slug,
                    Library.status == LibraryStatus.ACTIVE.value,
                    Library.deleted_at.is_(None),
                )
            )
        ).scalars().first()
        if lib is not None:
            title = f"{lib.name} | {SITE_NAME}"
            description = truncate(lib.description)
            image = _abs(lib.cover_url)

    # ── Blog yazısı ──
    elif clean.startswith("/blog/"):
        slug = clean.removeprefix("/blog/").split("/")[0]
        post = (
            await db.execute(
                select(BlogPost).where(
                    BlogPost.slug == slug,
                    BlogPost.status == "PUBLISHED",
                    BlogPost.deleted_at.is_(None),
                )
            )
        ).scalars().first()
        if post is not None:
            title = (post.seo_title or post.title) + f" | {SITE_NAME}"
            description = truncate(post.seo_description or post.excerpt)
            image = _abs(post.cover_image_url)
            kind = "article"

    # ── Ürün ──
    elif clean.startswith("/magaza/urun/"):
        slug = clean.removeprefix("/magaza/urun/").split("/")[0]
        product = (
            await db.execute(
                select(Product).where(
                    Product.slug == slug,
                    Product.status == ProductStatus.ACTIVE.value,
                    Product.deleted_at.is_(None),
                )
            )
        ).scalars().first()
        if product is not None:
            title = f"{product.title} | {SITE_NAME}"
            description = truncate(product.description)
            image = _abs(product.cover_url)
            kind = "product"

    return render_meta_html(
        title=title, description=description, image=image, url=url, kind=kind
    )
