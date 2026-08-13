"""Mağaza katalog + ürün/kategori/değerlendirme iş mantığı.

Eğitmen aramasının/kütüphane servisinin kardeşi: pg_trgm + TSVECTOR full-text,
Bayesian average sıralama. Ödeme/sipariş mantığı ``order_service``'tedir.
Satıcı kuralı: PLATFORM yalnız fiziksel, TUTOR yalnız dijital ürün satar.
"""
from __future__ import annotations

import datetime
import re
import unicodedata
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import Float, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core import mail, storage
from core.config import settings
from core.stock_policy import stok_kovasi_yuklemi
from core.search_text import (
    normalize_tr,
    normalized,
    tsquery as search_tsquery,
)
from core.moderation import mask_contact_info
from models.admin import Admin
from models.client import Client
from models.product_bookmark import ProductBookmark
from models.store import (
    Order,
    OrderItem,
    Product,
    ProductCategory,
    ProductPriceHistory,
    ProductImage,
    ProductKind,
    ProductReview,
    ProductStatus,
    SellerType,
    StockNotification,
)
from models.tutor import Tutor
from schemas.review import RatingDistributionOut
from schemas.store import (
    ProductCategoryCreate,
    ProductCategoryOut,
    ProductCategoryUpdate,
    ProductCreate,
    ProductDetailOut,
    ProductImageOut,
    ProductReviewCreate,
    ProductReviewOut,
    ProductSearchOut,
    ProductUpdate,
    SellerEarningsOut,
    SellerProductCreate,
    SellerProductStat,
)
from services import stock_ledger
from services.ranking import bayesian_average


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


# ── Slug ─────────────────────────────────────────────────────────────────────────


def _slugify(value: str) -> str:
    table = str.maketrans("çğıİöşüÇĞÖŞÜ", "cgiiosucgosu")
    value = value.translate(table)
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return value or "urun"


async def _unique_product_slug(
    db: AsyncSession, base: str, *, exclude_id: int | None = None
) -> str:
    slug = base
    n = 1
    while True:
        stmt = select(Product.id).where(
            Product.slug == slug, Product.deleted_at.is_(None)
        )
        if exclude_id is not None:
            stmt = stmt.where(Product.id != exclude_id)
        if (await db.execute(stmt)).first() is None:
            return slug
        n += 1
        slug = f"{base}-{n}"


async def _unique_category_slug(
    db: AsyncSession, base: str, *, exclude_id: int | None = None
) -> str:
    slug = base
    n = 1
    while True:
        stmt = select(ProductCategory.id).where(
            ProductCategory.slug == slug, ProductCategory.deleted_at.is_(None)
        )
        if exclude_id is not None:
            stmt = stmt.where(ProductCategory.id != exclude_id)
        if (await db.execute(stmt)).first() is None:
            return slug
        n += 1
        slug = f"{base}-{n}"


# ── Bayesian ──────────────────────────────────────────────────────────────────────


async def _compute_global_mean(db: AsyncSession) -> float:
    stmt = select(
        func.coalesce(func.sum(Product.rating_sum), 0),
        func.coalesce(func.sum(Product.rating_count), 0),
    ).where(Product.deleted_at.is_(None))
    total_sum, total_count = (await db.execute(stmt)).one()
    if not total_count:
        return settings.BAYESIAN_PRIOR_MEAN
    return float(total_sum) / float(total_count)


def _bayesian_score_expr(prior_mean: float, confidence: float):
    return (
        (Product.rating_sum + confidence * prior_mean)
        / (cast(Product.rating_count, Float) + confidence)
    ).label("bayesian_score")


def _in_stock(p: Product) -> bool:
    """Dijital → her zaman stokta; fiziksel → stock > 0 (NULL = sınırsız sayılmaz)."""
    if p.kind == ProductKind.DIGITAL.value:
        return True
    return (p.stock or 0) > 0


def _to_search_out(
    p: Product, prior_mean: float, confidence: float, *, tutor_name: str | None = None
) -> ProductSearchOut:
    return ProductSearchOut(
        id=p.id,
        slug=p.slug,
        title=p.title,
        kind=p.kind,
        seller_type=p.seller_type,
        tutor_id=p.tutor_id,
        tutor_name=tutor_name,
        price=str(p.price),
        compare_at_price=(
            str(p.compare_at_price) if p.compare_at_price is not None else None
        ),
        # Oran yanıtta döner: admin düzenleme formu mevcut değeri buradan okur.
        # Dönmezse form her açılışta alanı boş gösterir ve kaydeden kullanıcı
        # oranı farkında olmadan değiştirmiş olur.
        tax_rate=(Decimal(str(p.tax_rate)) if p.tax_rate is not None else None),
        currency=p.currency,
        cover_url=p.cover_url,
        in_stock=_in_stock(p),
        # Fiziksel üründe kalan adet; dijitalde None (bkz. şema yorumu).
        stock=(p.stock if p.kind == ProductKind.PHYSICAL.value else None),
        category_id=p.category_id,
        rating_count=p.rating_count,
        rating_average=(p.rating_sum / p.rating_count if p.rating_count else None),
        bayesian_score=bayesian_average(
            p.rating_sum, p.rating_count, prior_mean, confidence
        ),
        status=p.status,
        author=p.author,
        publisher=p.publisher,
        isbn=p.isbn,
        sku=p.sku,
    )


# ── Arama: kimlik mi, metin mi? ─────────────────────────────────────────────────
#
# Katalogda ÜÇ AYRI kimlik var ve karıştırılmamaları gerekiyor:
#
#   `isbn`    kitabın yayıncılık kimliği (insan girdisi, 10 veya 13 hane)
#   `barcode` ELİMİZDEKİ fiziksel kalemin üzerinde OKUNAN dizgi (EAN-13/UPC).
#             `isbn`'den ayrıdır ve ondan ASLA kopyalanmaz (bkz. models/store.py):
#             kitap olmayan üründe EAN var ISBN yok, set ürünün kendi barkodu
#             içindekilerden farklı, bazı baskılar promosyon barkodu taşır.
#   `sku`     BİZİM stok kalemi kimliğimiz (`FZK-000042`), BEFORE INSERT
#             trigger'ı yazar, taklit edilemez.
#
# Arama kutusu üçünü de kabul eder çünkü kullanıcı hangisini elinde tuttuğunu
# ayırt etmek zorunda değil: barkod okuyucu ISBN'i de EAN'ı de klavye girdisi
# olarak yazar. Ayrı bir "barkod modu" gerekmez.

#: Saf rakam dizisi (barkod okuyucunun ürettiği girdi).
_RAKAM_DIZISI = re.compile(r"^\d+$")
#: SKU deseni: iki-üç harfli önek + tire + rakamlar (`FZK-000042`).
_SKU_DESENI = re.compile(r"^[A-Za-z]{2,4}-?\d{3,}$")
#: Önek aramasının açıldığı en kısa uzunluk. 4'ün altında ("978") sonuç kümesi
#: kataloğun tamamına yakın olur ve arama hiçbir şey daraltmaz.
_ONEK_EN_AZ = 4


def _arama_kolu(q: str):
    """`q` için WHERE dalı — kimlik girdisi tam/önek, metin girdisi vektör+trigram.

    ## 13 hane kuralı

    Tam 13 haneli saf rakam dizisi **yalnız** `isbn`/`barcode` TAM eşleşmesine
    gider; trigram benzerliğine ASLA bırakılmaz. Sebep: ISBN'de "yakın
    eşleşme" diye bir şey yoktur — komşu ISBN BAŞKA bir kitaptır. Trigram ise
    rakam dizilerinde tam tersini yapar: "9786051234567" ile "9786051234568"
    üç-gram düzeyinde neredeyse aynıdır ve benzerlik kolu açık kalırsa okutulan
    barkod yanlış kitabı da getirir.

    ## Kısa rakam dizisi (kısmi ISBN)

    13 haneden kısa saf rakam dizisi **önek** olarak eşleşir. Gerekçe: yayınevi
    öneki (`978605...`) kitapçının gerçek bir daraltma ekseni ve barkod okuyucu
    bazen eksik okur. Önek, benzerlik DEĞİL: ISBN'in ortasından bir parça
    ("0512") anlam taşımaz ve eşleşmez.

    ## Metin girdisi

    Vektör (başlık + açıklama + yazar + yayınevi + ISBN + SKU) ile birlikte
    başlık trigram'ı; ikincisi yazım hatası toleransını sağlar ("matematık").
    """
    ham = q.strip()

    if _RAKAM_DIZISI.match(ham):
        if len(ham) == 13:
            return or_(Product.isbn == ham, Product.barcode == ham)
        if len(ham) >= _ONEK_EN_AZ:
            desen = ham + "%"
            return or_(Product.isbn.like(desen), Product.barcode.like(desen))
        # Çok kısa rakam: kimlik saymak için yetersiz, metin gibi ele alınır.

    if _SKU_DESENI.match(ham):
        # SKU tekildir; benzerliğe bırakmanın anlamı yok.
        return func.upper(Product.sku) == ham.upper()

    tsquery = search_tsquery(ham)
    return or_(
        Product.search_vector.op("@@")(tsquery),
        normalized(Product.title).op("%")(normalized(ham)),
    )


# ── Kategori ─────────────────────────────────────────────────────────────────────


def rollup_category_counts(
    rows: list[tuple[int | None, int]], parents: dict[int, int | None]
) -> dict[int, int]:
    """Yaprak ürün sayılarını üst kategorilere toplar (saf; pytest'li).

    Ürünler YAPRAK kategorilere atanır ("YKS Kitapları"), oysa gezinme üst
    kategoriden başlar ("Sınav Kitapları"). Toplama yapılmazsa üst kategoriler
    mega-menüde 0 görünür ve tıklanmaz.

    ``parents``: kategori id → üst id (kök için None). Döngüye karşı korumalı.
    """
    counts: dict[int, int] = {}
    for cat_id, n in rows:
        if cat_id is None:
            continue
        seen: set[int] = set()
        node: int | None = cat_id
        # Kendisi + tüm ataları: her seviyeye ekle.
        while node is not None and node not in seen:
            seen.add(node)
            counts[node] = counts.get(node, 0) + int(n)
            node = parents.get(node)
    return counts


async def _category_and_descendants(db: AsyncSession, category_id: int) -> list[int]:
    """Kategori + tüm alt kategorileri (recursive CTE).

    Model bugün iki seviyeli ama sorgu derinlikten bağımsız yazıldı: üçüncü
    seviye eklenirse filtre sessizce eksik sonuç vermeye başlamasın.
    """
    base = (
        select(ProductCategory.id)
        .where(
            ProductCategory.id == category_id,
            ProductCategory.deleted_at.is_(None),
        )
        .cte("cat_tree", recursive=True)
    )
    child = select(ProductCategory.id).where(
        ProductCategory.parent_id == base.c.id,
        ProductCategory.deleted_at.is_(None),
    )
    tree = base.union_all(child)
    ids = (await db.execute(select(tree.c.id))).scalars().all()
    return list(ids) or [category_id]


async def list_categories(db: AsyncSession) -> list[ProductCategoryOut]:
    """Kategori ağacı + her kategorideki aktif ürün sayısı (mega-menü).

    Sayılar alt kategorilerden yukarı TOPLANIR (bkz. rollup_category_counts).
    """
    cats = (
        await db.execute(
            select(ProductCategory)
            .where(ProductCategory.deleted_at.is_(None))
            .order_by(ProductCategory.sort_order, ProductCategory.name)
        )
    ).scalars().all()
    rows = (
        await db.execute(
            select(Product.category_id, func.count())
            .where(
                Product.deleted_at.is_(None),
                Product.status == ProductStatus.ACTIVE.value,
                Product.category_id.isnot(None),
            )
            .group_by(Product.category_id)
        )
    ).all()
    parents = {c.id: c.parent_id for c in cats}
    counts = rollup_category_counts([(cid, n) for cid, n in rows], parents)
    return [
        ProductCategoryOut(
            id=c.id,
            slug=c.slug,
            name=c.name,
            parent_id=c.parent_id,
            icon_url=c.icon_url,
            sort_order=c.sort_order,
            product_count=int(counts.get(c.id, 0)),
        )
        for c in cats
    ]


async def create_category(
    db: AsyncSession, payload: ProductCategoryCreate
) -> ProductCategoryOut:
    slug = await _unique_category_slug(db, _slugify(payload.name))
    cat = ProductCategory(
        slug=slug,
        name=payload.name,
        parent_id=payload.parent_id,
        icon_url=payload.icon_url,
        sort_order=payload.sort_order,
    )
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return ProductCategoryOut.model_validate(cat)


async def update_category(
    db: AsyncSession, category_id: int, payload: ProductCategoryUpdate
) -> ProductCategoryOut:
    cat = await db.get(ProductCategory, category_id)
    if cat is None or cat.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kategori bulunamadı")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"]:
        cat.name = data["name"]
        cat.slug = await _unique_category_slug(
            db, _slugify(data["name"]), exclude_id=cat.id
        )
    for field in ("parent_id", "icon_url", "sort_order"):
        if field in data:
            setattr(cat, field, data[field])
    await db.commit()
    await db.refresh(cat)
    return ProductCategoryOut.model_validate(cat)


async def delete_category(db: AsyncSession, category_id: int) -> None:
    cat = await db.get(ProductCategory, category_id)
    if cat is None or cat.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kategori bulunamadı")
    cat.deleted_at = _now()
    await db.commit()


# ── Public arama / detay ─────────────────────────────────────────────────────────


async def list_book_facets(
    db: AsyncSession, *, category_id: int | None = None, limit: int = 30
) -> dict[str, list[dict]]:
    """Kitap künyesi filtrelerinin seçilebilir değerleri (+ ürün sayısı).

    Kullanıcı "hangi yayınevleri var" sorusunu ancak listeyi görerek
    cevaplayabilir; serbest metin kutusu yazım hatasına açıktır ve boş sonuç
    üretir. Sayaçlar aynı zamanda hangi daraltmanın anlamlı olduğunu gösterir.

    Yalnız ACTIVE ürünler sayılır — gizli/taslak ürünün yayınevi filtrede
    görünüp sonuç getirmemesi kırık bir filtre izlenimi verirdi.
    """
    base_filters = [
        Product.status == ProductStatus.ACTIVE.value,
        Product.deleted_at.is_(None),
    ]
    if category_id is not None:
        base_filters.append(
            Product.category_id.in_(await _category_and_descendants(db, category_id))
        )

    out: dict[str, list[dict]] = {}
    for key, column in (
        ("publisher", Product.publisher),
        ("author", Product.author),
        ("cover_type", Product.cover_type),
    ):
        rows = (
            await db.execute(
                select(column, func.count())
                .where(*base_filters, column.isnot(None), column != "")
                .group_by(column)
                .order_by(func.count().desc(), column)
                .limit(limit)
            )
        ).all()
        out[key] = [{"value": value, "count": count} for value, count in rows]
    return out


async def search_products(
    db: AsyncSession,
    *,
    q: str | None = None,
    category_id: int | None = None,
    tutor_id: int | None = None,
    kind: str | None = None,
    min_price: Decimal | None = None,
    max_price: Decimal | None = None,
    in_stock: bool = False,
    min_rating: float | None = None,
    # Kitap künyesi filtreleri: kolonlar baştan beri doluydu ama hiçbir yerden
    # filtrelenemiyordu — "sadece Palme yayınları" ya da "ciltli olanlar"
    # kitapçı aramasının en sık iki daraltmasıdır.
    publisher: list[str] | None = None,
    author: list[str] | None = None,
    cover_type: list[str] | None = None,
    sort: str | None = None,
    limit: int = 30,
    offset: int = 0,
) -> list[ProductSearchOut]:
    prior_mean = await _compute_global_mean(db)
    confidence = settings.BAYESIAN_CONFIDENCE
    score = _bayesian_score_expr(prior_mean, confidence)

    stmt = (
        select(Product, Tutor.first_name, Tutor.last_name)
        .outerjoin(Tutor, Tutor.id == Product.tutor_id)
        .where(
            Product.status == ProductStatus.ACTIVE.value,
            Product.deleted_at.is_(None),
        )
    )
    if category_id is not None:
        # Üst kategori seçilince alt kategorilerdeki ürünler de gelmeli.
        # Tam eşitlik kullanıldığında ("Sınav Kitapları" gibi) hiçbir üst
        # kategori ürün göstermiyordu: ürünler yaprak kategorilere atanır
        # (seed_kitapsec.py) ama gezinme üst kategoriden başlar.
        stmt = stmt.where(
            Product.category_id.in_(await _category_and_descendants(db, category_id))
        )
    if tutor_id is not None:
        stmt = stmt.where(Product.tutor_id == tutor_id)
    if kind:
        stmt = stmt.where(Product.kind == kind)
    if min_price is not None:
        stmt = stmt.where(Product.price >= min_price)
    if max_price is not None:
        stmt = stmt.where(Product.price <= max_price)
    if in_stock:
        # Dijital her zaman stokta; fiziksel → stock > 0 (bkz. _in_stock).
        stmt = stmt.where(
            or_(Product.kind == ProductKind.DIGITAL.value, Product.stock > 0)
        )
    if min_rating is not None:
        # Ham ortalama >= min_rating (bölmesiz): rating_sum >= min_rating * count.
        stmt = stmt.where(
            Product.rating_count > 0,
            Product.rating_sum >= min_rating * Product.rating_count,
        )
    # Künye filtreleri normalize edilmiş karşılaştırma yapar: kullanıcı
    # "palme yayinlari" seçse de kayıt "Palme Yayınları" olarak durur.
    for column, values in (
        (Product.publisher, publisher),
        (Product.author, author),
        (Product.cover_type, cover_type),
    ):
        if values:
            stmt = stmt.where(
                normalized(column).in_([normalize_tr(v) for v in values])
            )

    relevance = None
    if q:
        # Diakritik-duyarsız: "matematık", "kitab", "cozumlu" sonuç getirmeli.
        # Yazar/yayınevi de aranır — kullanıcı çoğu zaman kitabın adını değil
        # yazarını hatırlar ("palme fizik", "tonguç").
        #
        # Kol ADMIN LİSTESİYLE PAYLAŞILIR (`_arama_kolu`): ISBN'i yalnız
        # yönetim tarafına eklemek iki arama yüzeyini ayırırdı ve müşteri
        # elindeki kitabın arkasındaki numarayı yazamazdı. Kimlik girdisinde
        # (ISBN/barkod/SKU) trigram devre dışı kalır — gerekçesi `_arama_kolu`.
        tsquery = search_tsquery(q)
        norm_title = normalized(Product.title)
        norm_q = normalized(q)
        stmt = stmt.where(_arama_kolu(q))
        relevance = func.ts_rank(Product.search_vector, tsquery) + func.similarity(
            norm_title, norm_q
        )

    if sort == "price_asc":
        stmt = stmt.order_by(Product.price.asc(), score.desc())
    elif sort == "price_desc":
        stmt = stmt.order_by(Product.price.desc(), score.desc())
    elif sort == "newest":
        stmt = stmt.order_by(Product.created_at.desc())
    elif sort == "rating":
        stmt = stmt.order_by(score.desc(), Product.created_at.desc())
    elif relevance is not None:
        stmt = stmt.order_by(score.desc(), relevance.desc())
    else:
        stmt = stmt.order_by(score.desc(), Product.created_at.desc())

    stmt = stmt.limit(limit).offset(offset)
    rows = (await db.execute(stmt)).all()
    out: list[ProductSearchOut] = []
    for p, fn, ln in rows:
        name = f"{fn} {ln}".strip() if fn else None
        out.append(_to_search_out(p, prior_mean, confidence, tutor_name=name))
    return out


async def _load_full(db: AsyncSession, product_id: int) -> Product | None:
    stmt = (
        select(Product)
        .options(selectinload(Product.images))
        .where(Product.id == product_id, Product.deleted_at.is_(None))
    )
    return (await db.execute(stmt)).scalars().first()


async def _tutor_name(db: AsyncSession, tutor_id: int | None) -> str | None:
    if tutor_id is None:
        return None
    t = await db.get(Tutor, tutor_id)
    return t.full_name if t is not None else None


async def _to_detail(db: AsyncSession, p: Product) -> ProductDetailOut:
    prior_mean = await _compute_global_mean(db)
    base = _to_search_out(
        p,
        prior_mean,
        settings.BAYESIAN_CONFIDENCE,
        tutor_name=await _tutor_name(db, p.tutor_id),
    )
    return ProductDetailOut(
        **base.model_dump(),
        description=p.description,
        # `stock`, `publisher`, `isbn` artık taban şemada (ProductSearchOut) ve
        # `model_dump()` ile buraya geliyor; ikinci kez geçirmek TypeError
        # üretirdi.
        weight_grams=p.weight_grams,
        digital_asset_name=p.digital_asset_name,
        page_count=p.page_count,
        dimensions=p.dimensions,
        publication_year=p.publication_year,
        edition=p.edition,
        language=p.language,
        cover_type=p.cover_type,
        images=[ProductImageOut.model_validate(im) for im in p.images],
        created_at=p.created_at,
    )


async def get_product_admin(db: AsyncSession, product_id: int) -> ProductDetailOut:
    """Admin tekil ürün detayı (durum filtresiz — gizli/taslak da düzenlenebilsin)."""
    p = await _load_full(db, product_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ürün bulunamadı")
    return await _to_detail(db, p)


async def get_product_public(db: AsyncSession, id_or_slug: str) -> ProductDetailOut:
    stmt = (
        select(Product)
        .options(selectinload(Product.images))
        .where(
            Product.deleted_at.is_(None),
            Product.status == ProductStatus.ACTIVE.value,
        )
    )
    if id_or_slug.isdigit():
        stmt = stmt.where(Product.id == int(id_or_slug))
    else:
        stmt = stmt.where(Product.slug == id_or_slug)
    p = (await db.execute(stmt)).scalars().first()
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ürün bulunamadı")
    return await _to_detail(db, p)


# ── Ürün CRUD (admin) ─────────────────────────────────────────────────────────────

# Kitap künyesi alanları (admin formundan gelir; create + admin update'te işlenir).
_BOOK_SPEC_FIELDS = (
    "author",
    "publisher",
    "isbn",
    "page_count",
    "dimensions",
    "publication_year",
    "edition",
    "language",
    "cover_type",
)


async def create_product(
    db: AsyncSession, admin: Admin, payload: ProductCreate
) -> ProductDetailOut:
    slug = await _unique_product_slug(db, _slugify(payload.title))
    # Fiziksel ürün yalnız platform tarafından satılır.
    p = Product(
        slug=slug,
        title=payload.title,
        description=payload.description,
        kind=payload.kind,
        seller_type=SellerType.PLATFORM.value,
        price=payload.price,
        compare_at_price=payload.compare_at_price,
        # KDV oranı VERİDİR: şemadan gelir, burada türetilmez. Kategoriye ya da
        # `kind`'a bakarak oran seçmek bir mevzuat kararını koda gömmek olurdu.
        tax_rate=payload.tax_rate,
        # Fiziksel ürün **0 stokla** kurulur; ilk bakiye aşağıda bir `INITIAL`
        # hareketiyle deftere yazılır. Constructor'da yazmak, defterin
        # "mevcut + delta" aritmetiğiyle bakiyeyi ÇİFT sayardı. Dijital ürün
        # stok yönetimine tabi değildir → NULL (SKU'sunu yine alır).
        stock=0 if payload.kind == ProductKind.PHYSICAL.value else None,
        weight_grams=payload.weight_grams,
        category_id=payload.category_id,
        status=payload.status,
        cover_url=payload.cover_url,
        created_by_admin_id=admin.id,
    )
    for field in _BOOK_SPEC_FIELDS:
        setattr(p, field, getattr(payload, field))
    db.add(p)

    # ── İlk bakiye: ürünle AYNI transaction'da deftere ──
    #
    # `flush` id'yi atar (SKU'yu `products_sku_autofill` BEFORE INSERT trigger'ı
    # yazar); `INITIAL` hareketi aynı transaction'da eklenir. Hareket
    # yazılamazsa (ör. geçersiz gerekçe) commit hiç olmaz → **ürün de
    # oluşturulmuş kalmaz**. Dijital ürün SKU alır ama stok hareketi ALMAZ.
    await db.flush()
    if p.kind == ProductKind.PHYSICAL.value and (payload.stock or 0) > 0:
        await stock_ledger.apply_movement(
            db,
            p.id,
            qty_delta=int(payload.stock),
            bucket=stock_ledger.StockBucket.SALEABLE,
            movement_type=stock_ledger.StockMovementType.INITIAL,
            reason_code="PRODUCT_CREATE",
            ref_type="product",
            ref_id=p.id,
            idempotency_key=stock_ledger.idempotency_key_for(
                stock_ledger.StockMovementType.INITIAL, product_id=p.id
            ),
            actor_type="ADMIN",
            actor_id=admin.id,
        )
    await db.commit()
    full = await _load_full(db, p.id)
    return await _to_detail(db, full)


async def bulk_import_products(db: AsyncSession, admin: Admin, rows: list[dict]) -> dict:
    """CSV satırlarından platform fiziksel/dijital ürün toplu oluşturur. Her satır
    kendi savepoint'inde işlenir (biri patlarsa diğerleri etkilenmez). ISBN ile
    tekrar eklenmez (dedup). (created, skipped, errors[{row,message}]) döner."""
    cats = (
        await db.execute(
            select(ProductCategory).where(ProductCategory.deleted_at.is_(None))
        )
    ).scalars().all()
    cat_by_slug = {c.slug: c.id for c in cats}

    created = 0
    skipped = 0
    errors: list[dict] = []

    for i, raw in enumerate(rows, start=1):
        row = {
            (k or "").strip().lower(): (v.strip() if isinstance(v, str) else v)
            for k, v in raw.items()
        }

        def _g(key: str) -> str | None:
            v = row.get(key)
            return v or None

        def _int(key: str) -> int | None:
            v = row.get(key)
            return int(v) if v not in (None, "") else None

        def _dec(key: str):
            v = row.get(key)
            return Decimal(v.replace(",", ".")) if v not in (None, "") else None

        try:
            title = _g("title")
            if not title:
                raise ValueError("title (ürün adı) zorunlu")
            price = _dec("price")
            if price is None or price <= 0:
                raise ValueError("price (fiyat) 0'dan büyük olmalı")
            kind = (row.get("kind") or "PHYSICAL").upper()
            if kind not in ("PHYSICAL", "DIGITAL"):
                raise ValueError("kind PHYSICAL veya DIGITAL olmalı")
            status_v = (row.get("status") or "ACTIVE").upper()
            if status_v not in ("ACTIVE", "HIDDEN", "DRAFT"):
                raise ValueError("status ACTIVE/HIDDEN/DRAFT olmalı")
            compare = _dec("compare_at_price")
            if compare is not None and compare <= price:
                raise ValueError("compare_at_price fiyattan büyük olmalı")

            # KDV oranı ZORUNLU (S-5). Boş bırakılan satır SESSİZCE %0 ile
            # oluşturulmaz: yanlış oranla satılan ürün fark edilmeden fatura
            # üretir ve hata ancak muhasebede ortaya çıkar. Reddedilen satır
            # `errors` listesinde raporlanır — toplu içe aktarmada hangi
            # satırın neden atlandığı görünmezse kullanıcı eksiği fark etmez.
            tax_rate = _dec("tax_rate")
            if tax_rate is None:
                raise ValueError(
                    "tax_rate (KDV oranı) zorunlu — oran olarak yazın "
                    "(0.20 = %20), yüzde değil"
                )
            if tax_rate < 0 or tax_rate >= 1:
                raise ValueError(
                    f"tax_rate 0 ≤ oran < 1 olmalı (0.20 = %20): {tax_rate}"
                )

            isbn = _g("isbn")
            if isbn:
                dupe = (
                    await db.execute(
                        select(Product.id).where(
                            Product.isbn == isbn, Product.deleted_at.is_(None)
                        )
                    )
                ).first()
                if dupe:
                    skipped += 1
                    continue

            cat_slug = _g("category_slug")
            category_id = cat_by_slug.get(cat_slug) if cat_slug else None
            if cat_slug and category_id is None:
                raise ValueError(f"kategori bulunamadı: {cat_slug}")

            # Ürün + `INITIAL` hareketi AYNI savepoint'te: hareket yazılamazsa
            # o satırın ürünü de oluşmaz, diğer satırlar etkilenmez.
            async with db.begin_nested():
                slug = await _unique_product_slug(db, _slugify(title))
                yeni = Product(
                    slug=slug,
                    title=title,
                    description=_g("description"),
                    kind=kind,
                    seller_type=SellerType.PLATFORM.value,
                    price=price,
                    compare_at_price=compare,
                    tax_rate=tax_rate,
                    # 0 ile kurulur; ilk bakiye deftere yazılır (bkz.
                    # `create_product`). Dijital → NULL (stok takibi yok).
                    stock=0 if kind == "PHYSICAL" else None,
                    category_id=category_id,
                    status=status_v,
                    cover_url=_g("cover_url"),
                    created_by_admin_id=admin.id,
                    author=_g("author"),
                    publisher=_g("publisher"),
                    isbn=isbn,
                    page_count=_int("page_count"),
                    dimensions=_g("dimensions"),
                    publication_year=_int("publication_year"),
                    edition=_g("edition"),
                    language=_g("language"),
                    cover_type=_g("cover_type"),
                )
                db.add(yeni)
                await db.flush()
                ilk_stok = _int("stock") if kind == "PHYSICAL" else None
                if ilk_stok:
                    await stock_ledger.apply_movement(
                        db,
                        yeni.id,
                        qty_delta=int(ilk_stok),
                        bucket=stock_ledger.StockBucket.SALEABLE,
                        movement_type=stock_ledger.StockMovementType.INITIAL,
                        reason_code="CSV_IMPORT",
                        ref_type="product",
                        ref_id=yeni.id,
                        idempotency_key=stock_ledger.idempotency_key_for(
                            stock_ledger.StockMovementType.INITIAL,
                            product_id=yeni.id,
                        ),
                        actor_type="ADMIN",
                        actor_id=admin.id,
                    )
            created += 1
        except Exception as exc:  # noqa: BLE001 — satır hatası raporlanır, akış sürer
            errors.append({"row": i, "message": str(exc)})

    await db.commit()
    return {"created": created, "skipped": skipped, "errors": errors}


async def subscribe_back_in_stock(
    db: AsyncSession, product_id: int, *, email: str, client_id: int | None = None
) -> None:
    """Tükenen fiziksel ürüne stok-bitince bildirim aboneliği (idempotent)."""
    p = await db.get(Product, product_id)
    if p is None or p.deleted_at is not None or p.status != ProductStatus.ACTIVE.value:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ürün bulunamadı")
    if p.kind != ProductKind.PHYSICAL.value:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Yalnızca fiziksel ürün için stok bildirimi alınır"
        )
    if (p.stock or 0) > 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ürün zaten stokta")
    existing = (
        await db.execute(
            select(StockNotification.id).where(
                StockNotification.product_id == product_id,
                StockNotification.email == email,
                StockNotification.notified_at.is_(None),
            )
        )
    ).first()
    if existing:
        return  # zaten abone
    db.add(StockNotification(product_id=product_id, email=email, client_id=client_id))
    await db.commit()


async def _notify_back_in_stock(db: AsyncSession, product: Product) -> None:
    """Ürün 0→>0 stoğa girince bekleyen abonelere e-posta atar (best-effort)."""
    subs = (
        await db.execute(
            select(StockNotification).where(
                StockNotification.product_id == product.id,
                StockNotification.notified_at.is_(None),
            )
        )
    ).scalars().all()
    if not subs:
        return
    url = f"{settings.FRONTEND_BASE_URL.rstrip('/')}/magaza/urun/{product.slug}"
    now = _now()
    for s in subs:
        await mail.send_back_in_stock_email(
            to=s.email, product_title=product.title, product_url=url
        )
        s.notified_at = now
    await db.commit()


async def update_product(
    db: AsyncSession,
    product_id: int,
    payload: ProductUpdate,
    *,
    owner_tutor_id: int | None = None,
    admin_id: int | None = None,
) -> ProductDetailOut:
    """``owner_tutor_id`` verilirse (eğitmen) yalnız kendi ürününü ve sınırlı alanları
    günceller; durumu PENDING/HIDDEN dışına çıkaramaz (yayın admin onayında)."""
    p = await _load_full(db, product_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ürün bulunamadı")
    if owner_tutor_id is not None and p.tutor_id != owner_tutor_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Bu ürün sizin değil")

    data = payload.model_dump(exclude_unset=True)

    # ── Stok değişikliği: kilit altında, delta tabanlı ──
    #
    # Önceki hâl iki kusur taşıyordu:
    #  1. Satır KİLİTLENMİYORDU ve gelen MUTLAK değer doğrudan atanıyordu.
    #     Admin "stok 50 olsun" derken eşzamanlı bir PAID 2 adet düşürürse
    #     `setattr` düşümü EZİYOR ve kayıp SESSİZ kalıyordu (defter olmadan
    #     tespiti de imkânsızdı).
    #  2. Dijital üründe `stock` alanı sessizce yutuluyordu (aşağıdaki
    #     `editable` listesine yalnız PHYSICAL'de ekleniyor) — admin
    #     "kaydettim" sanıyordu.
    #
    # Artık: DIGITAL'de açık ret; PHYSICAL'de satır `stock_ledger.lock_products`
    # ile (artan id + `populate_existing`) tazelenip kilitlenir ve delta KİLİT
    # ALTINDA hesaplanır.
    stok_gerekce = data.pop("stock_reason_code", None)
    stok_notu = data.pop("stock_note", None)
    stok_hedefi: int | None = None
    stok_delta = 0
    if "stock" in data and owner_tutor_id is None:
        if p.kind != ProductKind.PHYSICAL.value:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Dijital ürün stok yönetimine tabi değildir; stok değiştirilemez",
            )
        stok_hedefi = data.pop("stock")
        if stok_hedefi is not None:
            locked = await stock_ledger.lock_products(db, [p.id])
            p = locked[p.id]   # kilit altındaki TAZE satır
            stok_delta = int(stok_hedefi) - int(p.stock or 0)
            if stok_delta:
                # Gerekçe ZORUNLU — ama yalnız gerçekten bir değişiklik varsa.
                # Aynı hedefin tekrarı (delta 0) bir "işlem" değildir; gerekçe
                # istemek kullanıcıyı boşa zorlamak olurdu.
                if admin_id is None:
                    raise HTTPException(
                        status.HTTP_400_BAD_REQUEST,
                        "Stok düzeltmesi için yönetici kimliği gerekli",
                    )
                try:
                    stock_ledger.validate_reason(
                        stock_ledger.StockMovementType.ADMIN_ADJUSTMENT,
                        stok_gerekce,
                        note=stok_notu,
                    )
                except ValueError as exc:
                    raise HTTPException(
                        status.HTTP_400_BAD_REQUEST, str(exc)
                    ) from exc
    elif "stock" in data:
        # Eğitmen yolunda stok hiç düzenlenemez (bugün de öyleydi); alanı
        # sessizce taşımak yerine at.
        data.pop("stock")

    old_stock = p.stock
    old_price = Decimal(str(p.price))
    if "title" in data and data["title"]:
        p.title = data["title"]
        p.slug = await _unique_product_slug(
            db, _slugify(data["title"]), exclude_id=p.id
        )
    # DİKKAT: `stock` bu listede YOKTUR ve olmamalıdır. `setattr` döngüsü
    # DİNAMİK bir yazım yoludur; stok oraya girerse mutlak atama kilit ve delta
    # hesabını atlar ve hiçbir AST testi bunu "doğrudan mutasyon" olarak
    # göremez. Stok yukarıda, kilit altında, delta olarak ele alınır.
    editable = [
        "description",
        "price",
        "compare_at_price",
        "category_id",
        "cover_url",
        # Oran, satıcı kim olursa olsun düzenlenebilir: eğitmen de kendi dijital
        # ürününün faturasından sorumludur. Sınır şemada (0 ≤ oran < 1).
        "tax_rate",
    ]
    if owner_tutor_id is None:
        # Admin: ağırlık/durum + kitap künyesi (stok HARİÇ).
        editable += ["weight_grams", "status", *_BOOK_SPEC_FIELDS]
    for field in editable:
        if field in data:
            setattr(p, field, data[field])

    # Stok yazımı DEFTER üzerinden. Delta 0 ise ledger HİÇ çağrılmaz: aynı
    # hedefin tekrarı gürültü satırı üretmez (defter tarafı sıfır deltayı
    # zaten reddediyor).
    if stok_delta:
        await stock_ledger.apply_movement(
            db,
            p.id,
            qty_delta=stok_delta,
            # Admin ürün formu YALNIZ satılabilir kovaya dokunur; hasarlı kova
            # ancak hasar servisi üzerinden değişir (F29).
            bucket=stock_ledger.StockBucket.SALEABLE,
            movement_type=stock_ledger.StockMovementType.ADMIN_ADJUSTMENT,
            reason_code=stok_gerekce,
            actor_type="ADMIN",
            actor_id=admin_id,
            note=stok_notu,
        )
    # compare_at_price > price tutarlılığı (DB CHECK de korur ama erken 400 verelim).
    if p.compare_at_price is not None and Decimal(str(p.compare_at_price)) <= Decimal(
        str(p.price)
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "İndirimli fiyat eski fiyattan küçük olmalı"
        )

    # Fiyat değiştiyse iz bırak: indirim duyurusunda "son 30 günün en düşük
    # fiyatı" ancak geçmiş kayıtlıysa gösterilebilir (Fiyat Etiketi Yönetmeliği).
    # Önceden fiyat yerinde eziliyordu ve hiçbir kanıt kalmıyordu.
    if Decimal(str(p.price)) != old_price:
        db.add(
            ProductPriceHistory(
                product_id=p.id,
                price=p.price,
                changed_by_admin_id=None if owner_tutor_id is not None else admin_id,
            )
        )

    await db.commit()
    # Stok 0→>0 olduysa bekleyen stok-bildirim abonelerine haber ver.
    if (old_stock is None or old_stock <= 0) and (p.stock or 0) > 0:
        await _notify_back_in_stock(db, p)
    full = await _load_full(db, p.id)
    return await _to_detail(db, full)


async def delete_product(
    db: AsyncSession, product_id: int, *, owner_tutor_id: int | None = None
) -> None:
    p = await db.get(Product, product_id)
    if p is None or p.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ürün bulunamadı")
    if owner_tutor_id is not None and p.tutor_id != owner_tutor_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Bu ürün sizin değil")
    p.deleted_at = _now()
    await db.commit()


#: Admin listesinin sıralanabilir kolonları → gerçek model kolonu.
#: Beyaz liste: sıralama anahtarı istemciden geliyor ve doğrudan kolon adı
#: olarak kullanılsaydı istemci şemadaki herhangi bir kolona göre sıralayabilirdi.
_ADMIN_SORT = {
    "title": Product.title,
    "price": Product.price,
    "stock": Product.stock,
    "created_at": Product.created_at,
}


def _admin_filtreleri(
    stmt,
    *,
    q: str | None,
    stok: str | None,
    publisher: list[str] | None,
    author: list[str] | None,
):
    """Admin ürün listesinin WHERE dalları — sayım ve sayfa sorgusu PAYLAŞIR.

    Ortak olmaları şart: toplam sayı ile sayfa farklı filtre uygularsa
    "120 kayıt" yazıp 3 satır gösteren bir liste ortaya çıkar ve kimse fark
    etmez.
    """
    if stok is not None:
        # Yüklem `core.stock_policy`'den gelir; dashboard sayacı da AYNI
        # yardımcıyı kullanır. Burada elle yazılması, sayaç ile listenin
        # birbirinden ayrışmasının kökeniydi (P1-1): sayaç `status == ACTIVE`
        # filtreliyordu, liste filtrelemiyordu ve kart 5 derken liste 7
        # gösteriyordu.
        stmt = stmt.where(stok_kovasi_yuklemi(stok))

    for column, values in ((Product.publisher, publisher), (Product.author, author)):
        if values:
            stmt = stmt.where(
                normalized(column).in_([normalize_tr(v) for v in values])
            )

    if q:
        stmt = stmt.where(_arama_kolu(q))
    return stmt


async def list_products_admin(
    db: AsyncSession,
    *,
    q: str | None = None,
    stok: str | None = None,
    publisher: list[str] | None = None,
    author: list[str] | None = None,
    sort: str = "created_at",
    order: str = "desc",
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[ProductSearchOut], int]:
    """Admin listesi — gizli/taslak/bekleyen dahil. ``(kayıtlar, toplam)`` döner.

    Public ``search_products``'a YÖNLENDİRİLEMEZ: o `status == ACTIVE`
    zorluyor, admin listesi ise katalogun tamamını (taslak/gizli dahil)
    göstermek zorunda. Bu yüzden künye filtreleri burada ayrıca kurulur —
    "uç zaten destekliyor, bağlamak yeter" ölçümde doğru çıkmadı.

    Toplam sayı ayrı bir COUNT ile hesaplanır: sayfalanan bir listede dönen
    satır sayısı toplamı vermez ve kullanıcı son sayfada olup olmadığını
    bilemez.
    """
    prior_mean = await _compute_global_mean(db)
    confidence = settings.BAYESIAN_CONFIDENCE

    taban = (
        select(Product, Tutor.first_name, Tutor.last_name)
        .outerjoin(Tutor, Tutor.id == Product.tutor_id)
        .where(Product.deleted_at.is_(None))
    )
    taban = _admin_filtreleri(
        taban, q=q, stok=stok, publisher=publisher, author=author
    )

    sayim = select(func.count()).select_from(Product).where(Product.deleted_at.is_(None))
    sayim = _admin_filtreleri(
        sayim, q=q, stok=stok, publisher=publisher, author=author
    )
    toplam = int((await db.execute(sayim)).scalar_one())

    kolon = _ADMIN_SORT.get(sort, Product.created_at)
    yon = kolon.asc() if order == "asc" else kolon.desc()
    # İkincil anahtar `id`: sıralama alanı eşit olan satırlarda (aynı fiyat,
    # aynı stok) sıra deterministik olmalı, yoksa sayfa 1 ile sayfa 2 aynı
    # kaydı gösterebilir ya da bir kayıt hiç görünmeyebilir.
    stmt = taban.order_by(yon, Product.id.desc()).limit(limit).offset(offset)

    rows = (await db.execute(stmt)).all()
    return [
        _to_search_out(
            p,
            prior_mean,
            confidence,
            tutor_name=(f"{fn} {ln}".strip() if fn else None),
        )
        for p, fn, ln in rows
    ], toplam


# ── Mağaza favorileri (client→product; hesapla senkron kalp) ────────────────────


async def list_favorites(db: AsyncSession, client_id: int) -> list[ProductSearchOut]:
    """Kullanıcının favori ürünleri (yeni eklenen önce). Silinmiş/pasif ürünler
    listeden düşer (kayıt durur, ürün geri gelirse yeniden görünür)."""
    prior_mean = await _compute_global_mean(db)
    confidence = settings.BAYESIAN_CONFIDENCE
    rows = (
        await db.execute(
            select(Product, Tutor.first_name, Tutor.last_name)
            .join(ProductBookmark, ProductBookmark.product_id == Product.id)
            .outerjoin(Tutor, Tutor.id == Product.tutor_id)
            .where(
                ProductBookmark.client_id == client_id,
                Product.deleted_at.is_(None),
                Product.status == ProductStatus.ACTIVE.value,
            )
            .order_by(ProductBookmark.created_at.desc())
        )
    ).all()
    return [
        _to_search_out(
            p,
            prior_mean,
            confidence,
            tutor_name=(f"{fn} {ln}".strip() if fn else None),
        )
        for p, fn, ln in rows
    ]


async def add_favorite(db: AsyncSession, client_id: int, product_id: int) -> None:
    """Favoriye ekle — idempotent (PUT; zaten ekliyse sessizce geçer)."""
    p = (
        await db.execute(
            select(Product.id).where(
                Product.id == product_id, Product.deleted_at.is_(None)
            )
        )
    ).scalar_one_or_none()
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ürün bulunamadı")
    existing = await db.get(ProductBookmark, (client_id, product_id))
    if existing is None:
        db.add(ProductBookmark(client_id=client_id, product_id=product_id))
        await db.commit()


async def remove_favorite(db: AsyncSession, client_id: int, product_id: int) -> None:
    """Favoriden çıkar — idempotent (yoksa da 204)."""
    existing = await db.get(ProductBookmark, (client_id, product_id))
    if existing is not None:
        await db.delete(existing)
        await db.commit()


# ── Eğitmen dijital ürün ─────────────────────────────────────────────────────────


async def create_seller_product(
    db: AsyncSession, tutor: Tutor, payload: SellerProductCreate
) -> ProductDetailOut:
    """Eğitmen dijital ürün oluşturur: kind=DIGITAL, seller=TUTOR, status=PENDING
    (admin onayı — lansman kalite kapısı). Dosya ayrı uçtan yüklenir."""
    slug = await _unique_product_slug(db, _slugify(payload.title))
    p = Product(
        slug=slug,
        title=payload.title,
        description=payload.description,
        kind=ProductKind.DIGITAL.value,
        seller_type=SellerType.TUTOR.value,
        tutor_id=tutor.id,
        price=payload.price,
        compare_at_price=payload.compare_at_price,
        tax_rate=payload.tax_rate,
        category_id=payload.category_id,
        status=ProductStatus.PENDING.value,
        cover_url=payload.cover_url,
    )
    db.add(p)
    await db.commit()
    full = await _load_full(db, p.id)
    return await _to_detail(db, full)


async def list_seller_products(
    db: AsyncSession, tutor: Tutor
) -> list[ProductSearchOut]:
    prior_mean = await _compute_global_mean(db)
    confidence = settings.BAYESIAN_CONFIDENCE
    products = (
        await db.execute(
            select(Product)
            .where(
                Product.tutor_id == tutor.id,
                Product.deleted_at.is_(None),
            )
            .order_by(Product.created_at.desc())
        )
    ).scalars().all()
    return [
        _to_search_out(p, prior_mean, confidence, tutor_name=tutor.full_name)
        for p in products
    ]


async def seller_earnings(db: AsyncSession, tutor: Tutor) -> SellerEarningsOut:
    """Eğitmenin mağaza satış özeti: ürün başına adet/ciro/net kazanç + toplamlar.
    Yalnız ödenmiş (PAID) siparişler sayılır; iade edilen (REFUNDED) hariç tutulur
    (REFUNDED'da payment_status PAID olmaktan çıkar)."""
    base_where = (
        OrderItem.seller_type == SellerType.TUTOR.value,
        OrderItem.tutor_id == tutor.id,
        Order.payment_status == "PAID",
        Order.deleted_at.is_(None),
    )
    rows = (
        await db.execute(
            select(
                OrderItem.product_id,
                func.max(OrderItem.title).label("title"),
                func.sum(OrderItem.quantity).label("units"),
                func.sum(OrderItem.unit_price * OrderItem.quantity).label("gross"),
                func.coalesce(func.sum(OrderItem.tutor_earning), 0).label("earnings"),
            )
            .join(Order, Order.id == OrderItem.order_id)
            .where(*base_where)
            .group_by(OrderItem.product_id)
            .order_by(func.sum(OrderItem.unit_price * OrderItem.quantity).desc())
        )
    ).all()

    total_orders = (
        await db.execute(
            select(func.count(func.distinct(OrderItem.order_id)))
            .join(Order, Order.id == OrderItem.order_id)
            .where(*base_where)
        )
    ).scalar_one()

    products: list[SellerProductStat] = []
    total_units = 0
    total_gross = Decimal("0.00")
    total_earnings = Decimal("0.00")
    for r in rows:
        units = int(r.units or 0)
        gross = Decimal(str(r.gross or 0)).quantize(Decimal("0.01"))
        earnings = Decimal(str(r.earnings or 0)).quantize(Decimal("0.01"))
        total_units += units
        total_gross += gross
        total_earnings += earnings
        products.append(
            SellerProductStat(
                product_id=r.product_id,
                title=r.title,
                units_sold=units,
                gross=str(gross),
                earnings=str(earnings),
            )
        )
    return SellerEarningsOut(
        total_units=total_units,
        total_orders=int(total_orders or 0),
        total_gross=str(total_gross),
        total_earnings=str(total_earnings),
        products=products,
    )


# ── Görsel / dijital dosya ───────────────────────────────────────────────────────


async def _require_product(
    db: AsyncSession, product_id: int, *, owner_tutor_id: int | None = None
) -> Product:
    p = await db.get(Product, product_id)
    if p is None or p.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ürün bulunamadı")
    if owner_tutor_id is not None and p.tutor_id != owner_tutor_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Bu ürün sizin değil")
    return p


async def set_cover(
    db: AsyncSession, product_id: int, file_bytes: bytes, *, owner_tutor_id: int | None = None
) -> ProductDetailOut:
    p = await _require_product(db, product_id, owner_tutor_id=owner_tutor_id)
    old = p.cover_url
    p.cover_url = await storage.upload_library_photo(file_bytes, square=False)
    await db.commit()
    if old:
        await storage.delete_file(old)
    full = await _load_full(db, product_id)
    return await _to_detail(db, full)


async def add_images(
    db: AsyncSession, product_id: int, files: list[bytes], *, owner_tutor_id: int | None = None
) -> ProductDetailOut:
    await _require_product(db, product_id, owner_tutor_id=owner_tutor_id)
    start = (
        await db.execute(
            select(func.coalesce(func.max(ProductImage.sort_order), -1) + 1).where(
                ProductImage.product_id == product_id
            )
        )
    ).scalar_one()
    for i, raw in enumerate(files):
        url = await storage.upload_library_photo(raw, square=False)
        db.add(ProductImage(product_id=product_id, url=url, sort_order=start + i))
    await db.commit()
    full = await _load_full(db, product_id)
    return await _to_detail(db, full)


async def delete_image(
    db: AsyncSession, product_id: int, image_id: int, *, owner_tutor_id: int | None = None
) -> ProductDetailOut:
    await _require_product(db, product_id, owner_tutor_id=owner_tutor_id)
    img = await db.get(ProductImage, image_id)
    if img is None or img.product_id != product_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Görsel bulunamadı")
    url = img.url
    await db.delete(img)
    await db.commit()
    if url:
        await storage.delete_file(url)
    full = await _load_full(db, product_id)
    return await _to_detail(db, full)


async def set_digital_asset(
    db: AsyncSession,
    product_id: int,
    file_bytes: bytes,
    *,
    original_name: str | None,
    content_type: str | None,
    owner_tutor_id: int | None = None,
) -> ProductDetailOut:
    """DIGITAL ürünün teslim dosyasını yükler (MinIO). Eskisini temizler."""
    p = await _require_product(db, product_id, owner_tutor_id=owner_tutor_id)
    if p.kind != ProductKind.DIGITAL.value:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Yalnızca dijital ürüne dosya yüklenebilir"
        )
    old = p.digital_asset_key
    p.digital_asset_key = await storage.upload_file(
        file_bytes,
        original_name=original_name,
        content_type=content_type,
        prefix="digital-assets",
    )
    p.digital_asset_name = original_name
    await db.commit()
    if old:
        await storage.delete_file(old)
    full = await _load_full(db, product_id)
    return await _to_detail(db, full)


# ── Değerlendirme (satın-alma-gated) ─────────────────────────────────────────────


async def _has_purchased(db: AsyncSession, client_id: int, product_id: int) -> bool:
    """Müşterinin bu ürünü içeren ödenmiş (PAID+) bir siparişi var mı."""
    stmt = (
        select(OrderItem.id)
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            OrderItem.product_id == product_id,
            Order.client_id == client_id,
            Order.payment_status == "PAID",
            Order.deleted_at.is_(None),
        )
        .limit(1)
    )
    return (await db.execute(stmt)).first() is not None


async def list_reviews(
    db: AsyncSession, *, product_id: int, limit: int = 20, offset: int = 0
) -> list[ProductReviewOut]:
    rows = (
        await db.execute(
            select(ProductReview, Client)
            .join(Client, Client.id == ProductReview.client_id)
            .where(
                ProductReview.product_id == product_id,
                ProductReview.deleted_at.is_(None),
                # Moderasyonla gizlenenler public listede görünmez.
                ProductReview.hidden_at.is_(None),
            )
            .order_by(ProductReview.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    out: list[ProductReviewOut] = []
    for review, client in rows:
        item = ProductReviewOut.model_validate(review)
        item.client_name = client.full_name
        item.client_avatar_url = client.avatar_url
        out.append(item)
    return out


async def rating_distribution(
    db: AsyncSession, product_id: int
) -> RatingDistributionOut:
    rows = (
        await db.execute(
            select(ProductReview.rating, func.count())
            .where(
                ProductReview.product_id == product_id,
                ProductReview.deleted_at.is_(None),
                ProductReview.hidden_at.is_(None),
            )
            .group_by(ProductReview.rating)
        )
    ).all()
    counts = {star: 0 for star in range(1, 6)}
    total = 0
    weighted = 0
    for rating, count in rows:
        r, c = int(rating), int(count)
        counts[r] = c
        total += c
        weighted += r * c
    average = (weighted / total) if total else None
    return RatingDistributionOut(count=total, average=average, distribution=counts)


async def create_review(
    db: AsyncSession, client: Client, product_id: int, payload: ProductReviewCreate
) -> ProductReviewOut:
    p = await db.get(Product, product_id)
    if p is None or p.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ürün bulunamadı")
    if not await _has_purchased(db, client.id, product_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Yalnızca satın aldığınız ürünü değerlendirebilirsiniz",
        )
    existing = (
        await db.execute(
            select(ProductReview).where(
                ProductReview.product_id == product_id,
                ProductReview.client_id == client.id,
                ProductReview.deleted_at.is_(None),
            )
        )
    ).scalars().first()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu ürünü zaten değerlendirdiniz")

    review = ProductReview(
        product_id=product_id,
        client_id=client.id,
        rating=payload.rating,
        comment_text=mask_contact_info(payload.comment_text),
    )
    db.add(review)
    p.rating_count += 1
    p.rating_sum += payload.rating
    await db.commit()
    await db.refresh(review)
    item = ProductReviewOut.model_validate(review)
    item.client_name = client.full_name
    item.client_avatar_url = client.avatar_url
    return item


async def delete_review(db: AsyncSession, client: Client, review_id: int) -> None:
    review = await db.get(ProductReview, review_id)
    if review is None or review.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Değerlendirme bulunamadı")
    if review.client_id != client.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sizin değerlendirmeniz değil")
    p = await db.get(Product, review.product_id)
    review.deleted_at = _now()
    if p is not None:
        p.rating_count = max(0, p.rating_count - 1)
        p.rating_sum = max(0, p.rating_sum - review.rating)
    await db.commit()


# ── Fiyat geçmişi (Fiyat Etiketi Yönetmeliği) ────────────────────────────────

#: İndirim duyurusunda referans alınacak geçmiş pencere (gün).
PRICE_REFERENCE_WINDOW_DAYS = 30


async def lowest_price_in_window(
    db: AsyncSession, product_id: int, *, days: int = PRICE_REFERENCE_WINDOW_DAYS
) -> Decimal | None:
    """Ürünün son ``days`` gündeki EN DÜŞÜK fiyatı.

    İndirim duyurusu yapılırken üzeri çizili gösterilecek referans budur.
    Serbestçe girilen ``compare_at_price`` denetimde kabul edilmez: yönetmelik
    indirimden önceki 30 gün içindeki en düşük fiyatın esas alınmasını ister.

    Kayıt yoksa None (ürün hiç fiyat değiştirmemiş ve migration öncesi
    oluşmuş olabilir) — çağıran bu durumda indirim rozeti göstermemelidir.
    """
    since = _now() - datetime.timedelta(days=days)
    value = (
        await db.execute(
            select(func.min(ProductPriceHistory.price)).where(
                ProductPriceHistory.product_id == product_id,
                ProductPriceHistory.changed_at >= since,
            )
        )
    ).scalar()
    return Decimal(str(value)) if value is not None else None


def legal_compare_price(
    current_price: Decimal, lowest_30d: Decimal | None
) -> Decimal | None:
    """Gösterilebilir "eski fiyat" (saf; pytest'li).

    Kural: referans, son 30 günün en düşük fiyatıdır ve ancak GÜNCEL fiyattan
    yüksekse indirim vardır. Aksi halde (fiyat düşmemiş ya da geçmiş yok)
    üzeri çizili fiyat gösterilmez — dayanaksız indirim iddiası ceza konusudur.
    """
    if lowest_30d is None:
        return None
    current = Decimal(str(current_price))
    lowest = Decimal(str(lowest_30d))
    return lowest if lowest > current else None
