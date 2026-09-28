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
from sqlalchemy import Float, cast, exists, func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core import mail, storage
from core.config import settings
from core.html_sanitize import sanitize_html
from core.stock_policy import (
    karsilanma_kaynagi,
    satilabilir_mi,
    satilabilir_yuklemi,
    stok_kovasi_yuklemi,
)
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
    VariantGroup,
)
from models.store_merchandising import (
    ProductAttributeAssignment,
    ProductAttributeDefinition,
    ProductAttributeValue,
)
from models.supplier import Supplier, SupplierProduct
from models.tutor import Tutor
from schemas.review import RatingDistributionOut
from schemas.store import (
    DeriveVariantIn,
    ProductAttributeChipOut,
    VariantMatrixCellOut,
    VariantMatrixCreateIn,
    VariantMatrixCreateOut,
    VariantMatrixPreviewIn,
    VariantMatrixPreviewOut,
    VariantSwatchOut,
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
    ProductVariantMemberPublicOut,
    ProductVariantsPublicOut,
    SellerEarningsOut,
    SellerProductCreate,
    SellerProductStat,
)
from services import payment_gates, stock_ledger, variant_service
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


def _in_stock(p: Product, supplier_qty: Decimal | None = None) -> bool:
    """Vitrinin "stokta" kararı — SQL yükleminin Python ikizi.

    Karar `core/stock_policy` içinde TEK yerde tanımlıdır: arama listesi aynı
    kuralı SQL'de uyguluyor ve ikisi ayrışırsa liste "stokta", detay "tükendi"
    der (ikisi de hata vermeden).

    `supplier_qty` çağıranın `availability_map` ile TOPLUCA topladığı değerdir;
    burada ilişki gezilmez — async oturumda lazy-load `MissingGreenlet` demektir.
    """
    return satilabilir_mi(
        p.kind,
        p.stock,
        supplier_backed=bool(getattr(p, "supplier_backed", False)),
        supplier_qty=supplier_qty,
    )


async def _tedarikci_stogu(db: AsyncSession, urunler) -> dict[int, Decimal]:
    """{product_id: tedarikçi stoğu} — tek sorgu.

    Tembel import: `supplier_sync_service` bu modülü (bildirim için) import
    ediyor; tepe seviyede karşılıklı import döngü kurardı.
    """
    from services import supplier_sync_service

    idler = [u.id for u in urunler if getattr(u, "supplier_backed", False)]
    if not idler:
        return {}
    return await supplier_sync_service.availability_map(db, idler)


async def _tedarikci_admin_bilgisi(db: AsyncSession, urunler) -> dict:
    """{product_id: ProductSupplierOut} — maliyet/marj bloğu.

    **YALNIZ yönetim yollarından çağrılır** (D-6). Public bir yüzeyden
    çağrılması, ticari sırrı rakibe açmak olur; bunu bir PG testi
    (`test_supplier_storefront_pg::test_public_yanit_maliyet_tasimaz`) public
    gövdeyi tarayarak korur.
    """
    from core.suppliers.pricing import margin as _marj
    from schemas.supplier import ProductSupplierOut
    from services import supplier_sync_service

    idler = [u.id for u in urunler]
    kayitlar = await supplier_sync_service.admin_info_map(db, idler)
    if not kayitlar:
        return {}
    fiyat = {u.id: u.price for u in urunler}
    out: dict[int, ProductSupplierOut] = {}
    for pid, sp in kayitlar.items():
        brut = Decimal(str(sp.cost_gross)) if sp.cost_gross is not None else None
        m = _marj(Decimal(str(fiyat.get(pid) or 0)), brut)
        out[pid] = ProductSupplierOut(
            supplier_product_id=sp.id,
            external_code=sp.external_code,
            unit_name=sp.unit_name,
            stock_qty=str(sp.stock_qty),
            cost_net=(str(sp.cost_net) if sp.cost_net is not None else None),
            cost_gross=(str(brut) if brut is not None else None),
            margin_absolute=(str(m.absolute) if m.absolute is not None else None),
            margin_percent=(str(m.percent) if m.percent is not None else None),
            below_cost=m.below_cost,
            link_source=sp.link_source,
            is_favorite=sp.is_favorite,
            quarantine_flags=list(sp.quarantine_flags or []),
            stock_synced_at=sp.stock_synced_at,
            price_synced_at=sp.price_synced_at,
        )
    return out


def _to_search_out(
    p: Product,
    prior_mean: float,
    confidence: float,
    *,
    tutor_name: str | None = None,
    # Faz 3b (grup kartı): kart grubu temsil ederken üye sayısı + "X TL'den
    # başlayan" fiyatı + grubun stok durumu buradan gelir. Tekil listelemelerde
    # (favoriler, satıcı listesi…) varsayılanlar geçerlidir.
    variant_count: int = 1,
    group_min_price: str | None = None,
    in_stock_override: bool | None = None,
    #: `supplier_sync_service.availability_map`'ten TOPLUCA gelen tedarikçi
    #: stoğu. `None` = "bu yüzey tedarikçiyi sormadı" (tekil listelemeler).
    supplier_qty: Decimal | None = None,
    #: YALNIZ ADMIN yollarında doldurulur (D-6). Public yanıtta maliyet ve
    #: marj görünmemeli — rakip de müşteri olabilir.
    supplier_info: "ProductSupplierOut | None" = None,
) -> ProductSearchOut:
    tedarikciden = bool(getattr(p, "supplier_backed", False))
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
        brand=p.brand,
        in_stock=(
            in_stock_override
            if in_stock_override is not None
            else _in_stock(p, supplier_qty)
        ),
        # "Bizde var" ile "tedarikçiden getirilir" teslim süresi açısından
        # FARKLI sözlerdir; ikincisini gizlemek tutulamayacak bir söz vermektir.
        # Maliyet ve tedarikçi kimliği ise burada YOK (D-6).
        fulfillment=karsilanma_kaynagi(
            p.kind, p.stock, supplier_backed=tedarikciden, supplier_qty=supplier_qty
        ),
        supplier=supplier_info,
        supplier_backed=tedarikciden,
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
        variant_group_id=p.variant_group_id,
        option1_value=p.option1_value,
        option2_value=p.option2_value,
        variant_sort=p.variant_sort or 0,
        barcode=p.barcode,
        variant_count=variant_count,
        group_min_price=group_min_price,
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


def inherited_default_tax_rate(
    category_id: int,
    parents: dict[int, int | None],
    rates: dict[int, Decimal | None],
) -> Decimal | None:
    """Miras çözülmüş varsayılan KDV oranı (saf; pytest'li).

    Karar: yaprağın `default_tax_rate`'i NULL ise ata zincirinden miras alır —
    yaprağa EN YAKIN dolu değer kazanır. Gerekçe: mali müşavir oranı kırılımın
    köküne verir; yaprak başına elle kopya, yeni yaprak açıldığında unutulur ve
    sessiz boşluk üretir. Zincir tamamen NULL ise None döner — oran UYDURULMAZ
    (bugünkü davranış birebir; ön-doldurma yapılmaz, admin elle girer).

    Bu değer yalnız SUNUM/ön-doldurma içindir: `Product.tax_rate` ürün başına
    zorunlu veridir ve sunucu bu koldan asla oran türetmez. Döngü korumalı.
    """
    seen: set[int] = set()
    node: int | None = category_id
    while node is not None and node not in seen:
        seen.add(node)
        oran = rates.get(node)
        if oran is not None:
            return Decimal(str(oran))
        node = parents.get(node)
    return None


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
    rates = {c.id: c.default_tax_rate for c in cats}
    return [
        ProductCategoryOut(
            id=c.id,
            slug=c.slug,
            name=c.name,
            parent_id=c.parent_id,
            icon_url=c.icon_url,
            sort_order=c.sort_order,
            is_active=c.is_active,
            product_count=int(counts.get(c.id, 0)),
            default_tax_rate=(
                Decimal(str(c.default_tax_rate))
                if c.default_tax_rate is not None
                else None
            ),
            effective_tax_rate=inherited_default_tax_rate(c.id, parents, rates),
        )
        for c in cats
    ]


async def create_category(
    db: AsyncSession, payload: ProductCategoryCreate
) -> ProductCategoryOut:
    await _validate_category_parent(db, category_id=None, parent_id=payload.parent_id)
    slug = await _unique_category_slug(db, _slugify(payload.name))
    cat = ProductCategory(
        slug=slug,
        name=payload.name,
        parent_id=payload.parent_id,
        icon_url=payload.icon_url,
        sort_order=payload.sort_order,
        is_active=payload.is_active,
        # Değer admin girdisidir; kodda hiçbir varsayılan ORAN yoktur (mali
        # müşavir onayı bekleniyor) — gönderilmezse NULL kalır.
        default_tax_rate=payload.default_tax_rate,
    )
    db.add(cat)
    await db.flush()
    await db.refresh(cat)
    return ProductCategoryOut.model_validate(cat)


async def update_category(
    db: AsyncSession, category_id: int, payload: ProductCategoryUpdate
) -> ProductCategoryOut:
    cat = await db.get(ProductCategory, category_id)
    if cat is None or cat.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kategori bulunamadı")
    data = payload.model_dump(exclude_unset=True)
    if data.get("is_active") is False and cat.is_active:
        active_child = (await db.execute(select(ProductCategory.id).where(
            ProductCategory.parent_id == category_id,
            ProductCategory.deleted_at.is_(None),
            ProductCategory.is_active.is_(True),
        ).limit(1))).scalar_one_or_none()
        active_product = (await db.execute(select(Product.id).where(
            Product.category_id == category_id,
            Product.deleted_at.is_(None),
            Product.status == ProductStatus.ACTIVE.value,
        ).limit(1))).scalar_one_or_none()
        if active_child is not None or active_product is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Aktif alt kategori veya ürün içeren kategori pasife alınamaz.",
            )
    if "parent_id" in data:
        await _validate_category_parent(
            db, category_id=category_id, parent_id=data["parent_id"]
        )
    if "name" in data and data["name"]:
        # Kitap kökü nöbetçisi: `variant_service.BOOK_ROOT_SLUGS` bu slug'lara
        # bağlıdır. Ad (→ slug) değişirse "kitapta varyant kapalı" kuralı
        # hiçbir kategoriyle eşleşmez ve SESSİZCE devre dışı kalırdı.
        if cat.slug in variant_service.BOOK_ROOT_SLUGS:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"'{cat.slug}' kitap kökü kategorisidir ve yeniden "
                "adlandırılamaz: varyant kural sözlüğü bu slug'a bağlı. "
                "Gerekliyse önce koddaki BOOK_ROOT_SLUGS güncellenmeli.",
            )
        cat.name = data["name"]
        cat.slug = await _unique_category_slug(
            db, _slugify(data["name"]), exclude_id=cat.id
        )
    # `default_tax_rate: null` göndermek varsayılanı TEMİZLER (exclude_unset:
    # alan hiç gönderilmediyse dokunulmaz).
    for field in ("parent_id", "icon_url", "sort_order", "default_tax_rate", "is_active"):
        if field in data:
            setattr(cat, field, data[field])
    await db.flush()
    await db.refresh(cat)
    return ProductCategoryOut.model_validate(cat)


async def delete_category(db: AsyncSession, category_id: int) -> None:
    cat = await db.get(ProductCategory, category_id)
    if cat is None or cat.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kategori bulunamadı")
    # Kitap kökü nöbetçisi (gerekçe: update_category'deki not).
    if cat.slug in variant_service.BOOK_ROOT_SLUGS:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"'{cat.slug}' kitap kökü kategorisidir ve silinemez: varyant "
            "kural sözlüğü bu slug'a bağlı. Gerekliyse önce koddaki "
            "BOOK_ROOT_SLUGS güncellenmeli.",
        )
    child = (await db.execute(select(ProductCategory.id).where(
        ProductCategory.parent_id == category_id,
        ProductCategory.deleted_at.is_(None),
    ).limit(1))).scalar_one_or_none()
    if child is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Alt kategorileri bulunan kategori silinemez; önce alt kategorileri taşıyın.",
        )
    product = (await db.execute(select(Product.id).where(
        Product.category_id == category_id,
        Product.deleted_at.is_(None),
    ).limit(1))).scalar_one_or_none()
    if product is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Ürün bağlı kategori silinemez; önce ürünleri başka kategoriye taşıyın.",
        )
    cat.deleted_at = _now()
    await db.flush()


async def _validate_category_parent(
    db: AsyncSession, *, category_id: int | None, parent_id: int | None
) -> None:
    """Kategori ağacını döngüsüz ve en fazla dört seviyeli tutar."""
    categories = list((await db.execute(select(ProductCategory).where(
        ProductCategory.deleted_at.is_(None)
    ))).scalars().all())
    by_id = {category.id: category for category in categories}
    if parent_id is not None:
        parent = by_id.get(parent_id)
        if parent is None or not parent.is_active:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Üst kategori bulunamadı veya pasif.")
    if category_id is not None and parent_id == category_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Kategori kendisinin üst kategorisi olamaz.")

    parents = {category.id: category.parent_id for category in categories}
    if category_id is not None:
        parents[category_id] = parent_id
    synthetic_id = category_id if category_id is not None else -1
    if category_id is None:
        parents[synthetic_id] = parent_id

    def depth(node_id: int, trail: set[int] | None = None) -> int:
        trail = set() if trail is None else trail
        if node_id in trail:
            raise HTTPException(status.HTTP_409_CONFLICT, "Kategori ağacında döngü oluşamaz.")
        trail.add(node_id)
        parent = parents.get(node_id)
        return 1 if parent is None else 1 + depth(parent, trail)

    for node_id in parents:
        if depth(node_id) > 4:
            raise HTTPException(status.HTTP_409_CONFLICT, "Kategori ağacı en fazla dört seviye olabilir.")


async def _validate_product_category(
    db: AsyncSession, *, category_id: int | None, target_status: str
) -> None:
    if target_status == ProductStatus.ACTIVE.value and category_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Aktif ürün için kategori zorunludur.")
    if category_id is None:
        return
    category = await db.get(ProductCategory, category_id)
    if category is None or category.deleted_at is not None or not category.is_active:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Kategori bulunamadı veya pasif.")
    child = (await db.execute(select(ProductCategory.id).where(
        ProductCategory.parent_id == category_id,
        ProductCategory.deleted_at.is_(None),
        ProductCategory.is_active.is_(True),
    ).limit(1))).scalar_one_or_none()
    if child is not None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Ürün yalnız alt kategorisi olmayan bir yaprak kategoriye atanabilir.",
        )


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

    # ── Varyant eksenleri — EKSEN ADINA göre gruplanır, ham kolona göre DEĞİL ──
    #
    # `option1_value` gruba göre farklı anlam taşır: bir grupta "Kırmızı",
    # başkasında "A4". Ham kolon listesi bu değerleri tek kutuya döker ve facet
    # karışır. Değer bu yüzden grubun eksen ADI (VARIANT_AXES sözlüğü —
    # option1_name/option2_name) altında toplanır: iki grubun "Renk" değerleri
    # birleşir, "Ebat" değerleriyle karışmaz.
    axes: dict[str, dict[str, int]] = {}
    for name_col, value_col in (
        (VariantGroup.option1_name, Product.option1_value),
        (VariantGroup.option2_name, Product.option2_value),
    ):
        rows = (
            await db.execute(
                select(name_col, value_col, func.count())
                .join(VariantGroup, VariantGroup.id == Product.variant_group_id)
                .where(
                    *base_filters,
                    VariantGroup.deleted_at.is_(None),
                    name_col.isnot(None),
                    value_col.isnot(None),
                )
                .group_by(name_col, value_col)
            )
        ).all()
        for eksen, deger, adet in rows:
            kova = axes.setdefault(eksen, {})
            kova[deger] = kova.get(deger, 0) + int(adet)
    out["variant_axes"] = {  # type: ignore[assignment]
        eksen: [
            {"value": v, "count": n}
            for v, n in sorted(kova.items(), key=lambda x: (-x[1], x[0]))[:limit]
        ]
        for eksen, kova in sorted(axes.items())
    }
    return out


def parse_variant_filters(items: list[str] | None) -> dict[str, list[str]]:
    """`variant=Renk:Sarı` parametrelerini {eksen: [değerler]} sözlüğüne çevirir.

    Saf; pytest'li. Biçimsiz öğe SESSİZCE YUTULMAZ — ValueError yükseltilir ve
    router 400'e çevirir: yazım hatalı bir filtre "hiç filtre yok" gibi tüm
    kataloğu döndürseydi hata görünmez kalırdı.
    """
    out: dict[str, list[str]] = {}
    for ham in items or []:
        eksen, ayrac, deger = ham.partition(":")
        if not ayrac or not eksen.strip() or not deger.strip():
            raise ValueError(
                f"variant filtresi 'Eksen:Değer' biçiminde olmalı: {ham!r}"
            )
        out.setdefault(eksen.strip(), []).append(deger.strip())
    return out


async def _urun_filtre_kosullari(
    db: AsyncSession,
    *,
    q: str | None,
    category_id: int | None,
    tutor_id: int | None,
    kind: str | None,
    min_price: Decimal | None,
    max_price: Decimal | None,
    min_rating: float | None,
    publisher: list[str] | None,
    author: list[str] | None,
    cover_type: list[str] | None,
    variant_filters: dict[str, list[str]] | None,
) -> list:
    """Müşteri aramasının WHERE koşulları — `search_products` ile kategori
    facet'leri (`search_category_facets`) AYNI listeden beslenir; iki yüzeyin
    filtre semantiği birbirinden kayamaz. `in_stock` bilerek dışarıda: grup
    semantiği taşır ve yalnız arama sorgusunun DIŞ katmanında uygulanır."""
    kosullar = [
        Product.status == ProductStatus.ACTIVE.value,
        Product.deleted_at.is_(None),
    ]
    if category_id is not None:
        kosullar.append(
            Product.category_id.in_(await _category_and_descendants(db, category_id))
        )
    if tutor_id is not None:
        kosullar.append(Product.tutor_id == tutor_id)
    if kind:
        kosullar.append(Product.kind == kind)
    if min_price is not None:
        kosullar.append(Product.price >= min_price)
    if max_price is not None:
        kosullar.append(Product.price <= max_price)
    if min_rating is not None:
        kosullar.append(Product.rating_count > 0)
        kosullar.append(Product.rating_sum >= min_rating * Product.rating_count)
    for column, values in (
        (Product.publisher, publisher),
        (Product.author, author),
        (Product.cover_type, cover_type),
    ):
        if values:
            kosullar.append(
                normalized(column).in_([normalize_tr(v) for v in values])
            )
    for eksen, degerler in (variant_filters or {}).items():
        kosullar.append(
            select(VariantGroup.id)
            .where(
                VariantGroup.id == Product.variant_group_id,
                VariantGroup.deleted_at.is_(None),
                or_(
                    (VariantGroup.option1_name == eksen)
                    & Product.option1_value.in_(degerler),
                    (VariantGroup.option2_name == eksen)
                    & Product.option2_value.in_(degerler),
                ),
            )
            .exists()
        )
    if q:
        kosullar.append(_arama_kolu(q))
    return kosullar


async def search_category_facets(
    db: AsyncSession,
    *,
    q: str | None = None,
    kind: str | None = None,
    min_price: Decimal | None = None,
    max_price: Decimal | None = None,
    min_rating: float | None = None,
    publisher: list[str] | None = None,
    author: list[str] | None = None,
    cover_type: list[str] | None = None,
    variant_filters: dict[str, list[str]] | None = None,
) -> list[ProductCategoryOut]:
    """Aramaya KAPSAMLI kategori sayaçları (Trendyol/Amazon kenar çubuğu):
    yalnız eşleşme içeren kategoriler, sayılar alt-ağaç toplamıyla (rollup).
    `category_id` bilerek parametre DEĞİL: facet listesi her zaman tüm ağaca
    bakar; seçili kategori daraltması arayüzün gezinme hâlidir, kapsamı değil.
    """
    kosullar = await _urun_filtre_kosullari(
        db,
        q=q,
        category_id=None,
        tutor_id=None,
        kind=kind,
        min_price=min_price,
        max_price=max_price,
        min_rating=min_rating,
        publisher=publisher,
        author=author,
        cover_type=cover_type,
        variant_filters=variant_filters,
    )
    rows = (
        await db.execute(
            select(Product.category_id, func.count())
            .where(*kosullar, Product.category_id.isnot(None))
            .group_by(Product.category_id)
        )
    ).all()
    cats = (
        (
            await db.execute(
                select(ProductCategory).where(ProductCategory.deleted_at.is_(None))
            )
        )
        .scalars()
        .all()
    )
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
            is_active=c.is_active,
            product_count=int(counts[c.id]),
            default_tax_rate=None,
            effective_tax_rate=None,
        )
        for c in cats
        if counts.get(c.id)
    ]


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
    #: {eksen adı: [değerler]} — `parse_variant_filters` çıktısı. Eksenler
    #: arası AND, aynı eksenin değerleri arası OR (publisher deseniyle aynı).
    variant_filters: dict[str, list[str]] | None = None,
    sort: str | None = None,
    limit: int = 30,
    offset: int = 0,
) -> list[ProductSearchOut]:
    prior_mean = await _compute_global_mean(db)
    confidence = settings.BAYESIAN_CONFIDENCE
    score = _bayesian_score_expr(prior_mean, confidence)

    # ── Filtre koşulları (İÇ sorguya uygulanır) ──
    # Tek kaynak `_urun_filtre_kosullari` (facet'lerle paylaşılır). Buradaki
    # tarihsel gerekçeler (in_stock DIŞ katman, korele EXISTS/P2-6b, künye
    # normalizasyonu) o yardımcı fonksiyonun üstünde ve içinde yaşar.
    kosullar = await _urun_filtre_kosullari(
        db,
        q=q,
        category_id=category_id,
        tutor_id=tutor_id,
        kind=kind,
        min_price=min_price,
        max_price=max_price,
        min_rating=min_rating,
        publisher=publisher,
        author=author,
        cover_type=cover_type,
        variant_filters=variant_filters,
    )

    relevance = literal(0.0)
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
        # NOT: _arama_kolu koşulu yardımcıda eklendi; burada yalnız relevance.
        relevance = func.ts_rank(Product.search_vector, tsquery) + func.similarity(
            norm_title, norm_q
        )

    # ── Gruplama (Faz 3b): listede GRUP BAŞINA TEK KART ──
    #
    # DISTINCT ON dış sıralamayla çakışır; bunun yerine ROW_NUMBER() OVER
    # (PARTITION BY grup, ORDER BY <kipin temsilci sırası>) alt sorgusu kurulur
    # ve LIMIT/OFFSET **DIŞ** sorguda uygulanır — sayfalama böylece GRUP
    # (kart) sayısına göredir, üye sayısına göre değil. Tekil ürün kendi
    # başına bir gruptur: COALESCE(variant_group_id, -id) çakışmasız anahtar
    # (id'ler pozitif, negatifler tekilleri temsil eder).
    #
    # Temsilci = kipin "en iyi" üyesi (price_asc→en ucuz, newest→en yeni,
    # skor kiplerinde→en yüksek skor); dış sıralama temsilcinin değeriyle
    # yapılır, böylece kart doğru konuma oturur. Window'lar FİLTRELENMİŞ küme
    # üzerinde çalışır: "Sarı" filtresi varken kartı grubun sarı üyesi temsil
    # eder. `id` her sırada son bağlayıcıdır (deterministik sayfalama).
    grp = func.coalesce(Product.variant_group_id, -Product.id)
    # Tedarikçiden temin edilen ürün de "stokta"dır (D-2). Yüklem
    # `core/stock_policy`'de, `_in_stock` ile AYNI dosyada durur.
    stokta = satilabilir_yuklemi()

    if sort == "price_asc":
        temsilci_sirasi = [Product.price.asc(), Product.id.asc()]
    elif sort == "price_desc":
        temsilci_sirasi = [Product.price.desc(), Product.id.asc()]
    elif sort == "newest":
        temsilci_sirasi = [Product.created_at.desc(), Product.id.desc()]
    else:  # default / rating / relevance → skor temsil eder
        temsilci_sirasi = [
            score.desc(), Product.created_at.desc(), Product.id.desc()
        ]

    inner = select(
        Product.id.label("pid"),
        func.row_number()
        .over(partition_by=grp, order_by=temsilci_sirasi)
        .label("rn"),
        func.min(Product.price).over(partition_by=grp).label("grp_min"),
        func.count().over(partition_by=grp).label("grp_n"),
        func.bool_or(stokta).over(partition_by=grp).label("grp_stok"),
        score.label("skor"),
        relevance.label("relv"),
    ).where(*kosullar)
    sub = inner.subquery("grup_kartlari")

    stmt = (
        select(
            Product,
            Tutor.first_name,
            Tutor.last_name,
            sub.c.grp_min,
            sub.c.grp_n,
            sub.c.grp_stok,
            sub.c.skor,
            sub.c.relv,
        )
        .join(sub, sub.c.pid == Product.id)
        .outerjoin(Tutor, Tutor.id == Product.tutor_id)
        .where(sub.c.rn == 1)
    )
    if in_stock:
        stmt = stmt.where(sub.c.grp_stok)

    if sort == "price_asc":
        stmt = stmt.order_by(Product.price.asc(), sub.c.skor.desc(), Product.id.asc())
    elif sort == "price_desc":
        stmt = stmt.order_by(Product.price.desc(), sub.c.skor.desc(), Product.id.asc())
    elif sort == "newest":
        stmt = stmt.order_by(Product.created_at.desc(), Product.id.desc())
    elif sort == "rating":
        # TB-70: bu dal eskiden varsayılanla BİREBİR AYNI `ORDER BY`ı
        # üretiyordu. Katalogda puanlı ürün az olduğu için Bayesian skor
        # herkeste eşit çıkıyor, bağ `created_at`e düşüyor ve "En beğenilen"
        # fiilen "En yeni" oluyordu — iki menü seçeneği aynı SQL'i üretiyordu.
        #
        # Puanlanmış ürünler ÖNCE gelir; kendi aralarında Bayesian skor
        # sıralar (tek 5 yıldızlı bir ürün, 4.8'lik 500 oylu bir ürünü
        # geçmesin diye ham ortalama KULLANILMAZ), sonra oy sayısı.
        stmt = stmt.order_by(
            (Product.rating_count > 0).desc(),
            sub.c.skor.desc(),
            Product.rating_count.desc(),
            Product.id.desc(),
        )
    elif q:
        stmt = stmt.order_by(sub.c.skor.desc(), sub.c.relv.desc(), Product.id.desc())
    else:
        stmt = stmt.order_by(sub.c.skor.desc(), Product.created_at.desc(), Product.id.desc())

    stmt = stmt.limit(limit).offset(offset)
    rows = (await db.execute(stmt)).all()
    # Tedarikçi stoğu TEK sorguda toplanır: kart başına sorgu, 30 ürünlük bir
    # sayfada 30 gidiş-dönüş demekti (N+1).
    tedarikci = await _tedarikci_stogu(db, [r[0] for r in rows])
    out: list[ProductSearchOut] = []
    for p, fn, _ln, grp_min, grp_n, grp_stok, _skor, _relv in rows:
        # Yalnız AD (ÜK-9) — soyad public ürün listesinde görünmez.
        name = fn or None
        out.append(
            _to_search_out(
                p,
                prior_mean,
                confidence,
                tutor_name=name,
                supplier_qty=tedarikci.get(p.id),
                variant_count=int(grp_n),
                group_min_price=(str(grp_min) if grp_n > 1 else None),
                # Kartın stok durumu GRUBUN durumudur: temsilci tükenik olsa
                # da kardeşi satılabiliyorsa kart "Tükendi" diyemez.
                in_stock_override=(bool(grp_stok) if grp_n > 1 else None),
            )
        )
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
    # Yalnız AD (ÜK-9): ürün kartı ve satıcı mağazası public yüzeylerdir.
    return t.display_name if t is not None else None


async def _variants_block(
    db: AsyncSession, p: Product
) -> ProductVariantsPublicOut | None:
    """Detay sayfası kardeş seçicisinin verisi (grupsuz üründe None).

    Yalnız PUBLIC görünür kardeşler listelenir (ACTIVE + silinmemiş): gizli
    kardeşe giden bir seçici düğmesi 404'e tıklatırdı. Tükenen kardeş ise
    LİSTEDE KALIR ve `in_stock=false` işaretlenir — "bu renk yok" ile "bu
    renk tükendi" farklı bilgilerdir.
    """
    if p.variant_group_id is None:
        return None
    g = await db.get(VariantGroup, p.variant_group_id)
    if g is None or g.deleted_at is not None:
        return None
    uyeler = (
        await db.execute(
            select(Product)
            .where(
                Product.variant_group_id == g.id,
                Product.deleted_at.is_(None),
                Product.status == ProductStatus.ACTIVE.value,
            )
            .order_by(Product.variant_sort, Product.id)
        )
    ).scalars().all()
    # Kardeşlerin tedarikçi stoğu da toplu okunur: tükenen kardeş listede
    # KALIR ve işaretlenir, ama tedarikçiden temin ediliyorsa "tükendi" demek
    # yanlış olur.
    tedarikci = await _tedarikci_stogu(db, uyeler)
    return ProductVariantsPublicOut(
        group_id=g.id,
        title=g.title,
        option1_name=g.option1_name,
        option2_name=g.option2_name,
        members=[
            ProductVariantMemberPublicOut(
                id=m.id,
                slug=m.slug,
                title=m.title,
                option1_value=m.option1_value,
                option2_value=m.option2_value,
                variant_sort=m.variant_sort or 0,
                in_stock=_in_stock(m, tedarikci.get(m.id)),
                price=str(m.price),
                cover_url=m.cover_url,
                sku=m.sku,
            )
            for m in uyeler
        ],
        swatches=await _eksen_swatchleri(db, g, uyeler),
    )


async def _eksen_swatchleri(
    db: AsyncSession, g: VariantGroup, uyeler: list[Product]
) -> list[VariantSwatchOut]:
    """Eksen değerlerinin renk örnekleri (yönetilen nitelik sözlüğünden).

    Eşleşme eksen ADI ↔ nitelik tanımı adı, değer ↔ nitelik değeri etiketi
    üzerinden kurulur ve Türkçe normalleştirmeye tabidir: sözlükte "Kırmızı",
    üründe "kırmızı" yazıyorsa örnek yine bulunmalıdır.

    Sözlük boşsa boş liste döner ve seçici metin butonuna DÜŞER — bu bir hata
    değil, sözlük doldurulmadan önceki normal hâldir.
    """
    eksen_adlari = [ad for ad in (g.option1_name, g.option2_name) if ad]
    if not eksen_adlari:
        return []

    rows = (
        await db.execute(
            select(
                ProductAttributeDefinition.name,
                ProductAttributeValue.label,
                ProductAttributeValue.swatch_hex,
                ProductAttributeValue.swatch_image_url,
            )
            .join(
                ProductAttributeValue,
                ProductAttributeValue.definition_id == ProductAttributeDefinition.id,
            )
            .where(
                ProductAttributeDefinition.name.in_(eksen_adlari),
                ProductAttributeDefinition.deleted_at.is_(None),
                ProductAttributeValue.deleted_at.is_(None),
                ProductAttributeValue.is_active.is_(True),
                or_(
                    ProductAttributeValue.swatch_hex.isnot(None),
                    ProductAttributeValue.swatch_image_url.isnot(None),
                ),
            )
        )
    ).all()
    if not rows:
        return []

    sozluk = {
        (variant_service.esdeger_anahtar(ad), variant_service.esdeger_anahtar(etiket)): (
            hex_,
            gorsel,
        )
        for ad, etiket, hex_, gorsel in rows
    }

    # Yalnız BU grupta gerçekten kullanılan değerler döner: sözlüğün tamamını
    # yollamak, on üründe kullanılmayan yüz rengi her ürün detayına eklerdi.
    sonuc: list[VariantSwatchOut] = []
    gorulen: set[tuple[str, str]] = set()
    for m in uyeler:
        for ad, deger in ((g.option1_name, m.option1_value), (g.option2_name, m.option2_value)):
            if not ad or not deger or (ad, deger) in gorulen:
                continue
            gorulen.add((ad, deger))
            bulunan = sozluk.get(
                (variant_service.esdeger_anahtar(ad), variant_service.esdeger_anahtar(deger))
            )
            if bulunan is None:
                continue
            sonuc.append(
                VariantSwatchOut(
                    axis_name=ad, value=deger, hex=bulunan[0], image_url=bulunan[1]
                )
            )
    return sonuc


async def _urun_nitelikleri(
    db: AsyncSession, product_id: int
) -> list[ProductAttributeChipOut]:
    """Ürüne atanmış yönetilen nitelikler ("Kağıt Cinsi: 80 gr").

    Admin bunları uzun süredir YAZABİLİYORDU (`ProductManagedAttributes`) ama
    public detay yanıtına hiç girmiyorlardı: kırtasiye ürününde künye tablosu
    yalnız kitap alanlarından besleniyor ve boş çıkıyordu.

    Tek sorgu; sıralama tanımın ve değerin kendi sırasından gelir ki künye
    tablosu her üründe aynı düzende okunsun.
    """
    rows = (
        await db.execute(
            select(
                ProductAttributeDefinition.name,
                ProductAttributeValue.label,
                ProductAttributeDefinition.sort_order,
                ProductAttributeValue.sort_order,
            )
            .join(
                ProductAttributeValue,
                ProductAttributeValue.definition_id == ProductAttributeDefinition.id,
            )
            .join(
                ProductAttributeAssignment,
                ProductAttributeAssignment.value_id == ProductAttributeValue.id,
            )
            .where(
                ProductAttributeAssignment.product_id == product_id,
                ProductAttributeAssignment.deleted_at.is_(None),
                ProductAttributeValue.deleted_at.is_(None),
                ProductAttributeDefinition.deleted_at.is_(None),
                ProductAttributeDefinition.is_active.is_(True),
                ProductAttributeValue.is_active.is_(True),
            )
            .order_by(
                ProductAttributeDefinition.sort_order,
                ProductAttributeDefinition.name,
                ProductAttributeValue.sort_order,
            )
        )
    ).all()
    return [
        ProductAttributeChipOut(definition_name=ad, label=etiket, sort_order=tanim_sira)
        for ad, etiket, tanim_sira, _deger_sira in rows
    ]


def _temiz_aciklama(raw: str | None) -> str | None:
    """Ürün açıklamasını allowlist'e indirger.

    Açıklama artık zengin metin (TipTap) olabiliyor ve vitrinde
    `dangerouslySetInnerHTML` ile basılıyor. Yüzey blogdan GENİŞTİR: dijital
    ürün açıklamasını EĞİTMEN de yazabiliyor. Bu yüzden temizlik yazma anında
    ve tek allowlist'ten (`core/html_sanitize`) yapılır.

    Düz metin girdisi zarar görmez: allowlist'te olmayan bir etiket yoksa
    metin olduğu gibi kalır.
    """
    if raw is None:
        return None
    temiz = sanitize_html(raw)
    return temiz or None


async def _to_detail(db: AsyncSession, p: Product) -> ProductDetailOut:
    prior_mean = await _compute_global_mean(db)
    tedarikci = await _tedarikci_stogu(db, [p])
    yasal_referans = legal_compare_price(
        p.price, await lowest_price_in_window(db, p.id)
    )
    base = _to_search_out(
        p,
        prior_mean,
        settings.BAYESIAN_CONFIDENCE,
        tutor_name=await _tutor_name(db, p.tutor_id),
        supplier_qty=tedarikci.get(p.id),
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
        variants=await _variants_block(db, p),
        # Yasal referans fiyat YALNIZ detay yolunda hesaplanır: liste yolunda
        # ürün başına bir sorgu daha demek olurdu (30 kartlık sayfada N+1).
        # Serbest `compare_at_price` artık vitrinde ÜSTÜ ÇİZİLİ GÖSTERİLMEZ;
        # dayanağı olmayan indirim iddiası ceza konusudur.
        legal_compare_price=(
            str(yasal_referans) if yasal_referans is not None else None
        ),
        price_reference_days=PRICE_REFERENCE_WINDOW_DAYS,
        attributes=await _urun_nitelikleri(db, p.id),
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
    await _validate_product_category(
        db, category_id=payload.category_id, target_status=payload.status
    )
    # Dijital ürün kapısı EN BAŞTA: bayrak kapalıyken oluşturulan dijital ürün
    # satılamaz ve `kind` trigger'ı yüzünden düzeltilemez (bkz. payment_gates).
    await payment_gates.assert_digital_product_creatable(db, payload.kind)
    # Varyant üyeliği: kitap kapısı + eksen/barkod doğrulaması ürün
    # yazılmadan ÖNCE (opak IntegrityError yerine anlamlı 400/409).
    if payload.variant_group_id is not None:
        await variant_service.validate_membership(
            db,
            group_id=payload.variant_group_id,
            category_id=payload.category_id,
            option1_value=payload.option1_value,
            option2_value=payload.option2_value,
            barcode=payload.barcode,
        )
    elif payload.option1_value is not None or payload.option2_value is not None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Eksen değeri yalnız bir varyant grubuyla birlikte gönderilebilir.",
        )
    slug = await _unique_product_slug(db, _slugify(payload.title))
    # Fiziksel ürün yalnız platform tarafından satılır.
    p = Product(
        slug=slug,
        title=payload.title,
        description=_temiz_aciklama(payload.description),
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
        brand=payload.brand,
        category_id=payload.category_id,
        status=payload.status,
        cover_url=payload.cover_url,
        created_by_admin_id=admin.id,
        variant_group_id=payload.variant_group_id,
        option1_value=payload.option1_value,
        option2_value=payload.option2_value,
        variant_sort=payload.variant_sort or 0,
        barcode=payload.barcode,
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
    await db.flush()
    full = await _load_full(db, p.id)
    return await _to_detail(db, full)


async def derive_variant(
    db: AsyncSession, admin: Admin, source_id: int, payload: DeriveVariantIn
) -> ProductDetailOut:
    """Mevcut üründen yeni varyant türetir (künye/fiyat/görsel kopyalanır).

    Kaynak bir grupta OLMAK ZORUNDA (409): türetme "kardeş ekleme"dir, grup
    kurma değil — grup kurmayı ayrı ve bilinçli bir adım olarak bırakmak,
    yanlışlıkla tek üyelik hayalet gruplar üretilmesini engeller.

    ISBN bilinçli KOPYALANMAZ: her fiziksel kalem kendi yayın kimliğini taşır;
    kopyalansaydı "okuttum, eşleşti" güveni yanlış ürüne bağlanırdı (barkod↔ISBN
    ayrımıyla aynı ilke). `sku` zaten trigger'ındır, kopyalanamaz.
    """
    kaynak = await _load_full(db, source_id)
    if kaynak is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ürün bulunamadı")
    # Türetme `kind`'ı KAYNAKTAN kopyalar (aşağıda `kind=kaynak.kind`): bayrak
    # kapalıyken eski bir dijital üründen yeni dijital ürün doğurmak, kapıyı
    # üçüncü bir kapıdan atlatmak olurdu.
    await payment_gates.assert_digital_product_creatable(db, kaynak.kind)
    if kaynak.variant_group_id is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Kaynak ürün bir varyant grubunda değil. Önce grubu oluşturup "
            "kaynağı gruba bağlayın; türetme kardeş ekler.",
        )
    grup = await variant_service.validate_membership(
        db,
        group_id=kaynak.variant_group_id,
        category_id=kaynak.category_id,
        option1_value=payload.option1_value,
        option2_value=payload.option2_value,
        barcode=payload.barcode,
    )

    yeni = await _varyant_kardesi_olustur(
        db,
        admin,
        kaynak=kaynak,
        grup=grup,
        payload=payload,
    )
    full = await _load_full(db, yeni.id)
    return await _to_detail(db, full)


async def _varyant_kardesi_olustur(
    db: AsyncSession,
    admin: Admin,
    *,
    kaynak: Product,
    grup: VariantGroup,
    payload: DeriveVariantIn,
) -> Product:
    """Kaynak üründen TEK bir varyant kardeşi doğurur (ORM nesnesi döner).

    Detay şeması ÜRETMEZ: toplu matris üretiminde satır başına `_to_detail`
    çağırmak (global ortalama + tedarikçi stoğu + eğitmen adı + varyant bloğu)
    200 satırda dört katına çıkan bir N+1 turu demekti. Çağıran ihtiyacı varsa
    detayı kendisi üretir.

    `derive_variant` (tek tek türetme) ve `create_variant_matrix` (toplu
    üretim) bu gövdeyi PAYLAŞIR. Ayrı yazılsalardı zamanla ayrışırlardı ve
    "matristen üretilen varyant, elle türetilenden farklı davranıyor" sınıfı
    bir hata doğardı: kopyalanan künye alanları, ISBN'in KOPYALANMAMASI,
    taslak durumu ve açılış stok hareketi tek yerde tanımlı kalmalı.

    Çağıran, kaynağın gruplu olduğunu ve `validate_membership` kapısından
    geçtiğini garanti eder.
    """
    if payload.title:
        baslik = payload.title
    else:
        # Grup başlığı ortak köktür; değerler ayırt eder ("Trendyol deseni":
        # varyant adı title'da yaşar, ayrı kolonda değil.
        degerler = " / ".join(
            v for v in (payload.option1_value, payload.option2_value) if v
        )
        baslik = f"{grup.title} - {degerler}"

    p = Product(
        slug=await _unique_product_slug(db, _slugify(baslik)),
        title=baslik,
        # Kaynağın açıklaması DB'den geliyor ve yazma anında zaten
        # temizlenmişti; yine de geçiriyoruz. Maliyeti sıfıra yakın ve
        # bu turdan ÖNCE yazılmış ya da seed/CSV gibi başka bir yoldan
        # gelmiş bir satırın ham HTML'ini kardeşe kopyalamayı engelliyor.
        description=_temiz_aciklama(kaynak.description),
        kind=kaynak.kind,
        seller_type=kaynak.seller_type,
        tutor_id=kaynak.tutor_id,
        price=payload.price if payload.price is not None else kaynak.price,
        compare_at_price=None,   # indirim rozeti kopyalanmaz; bilinçli karar ister
        tax_rate=kaynak.tax_rate,
        stock=0 if kaynak.kind == ProductKind.PHYSICAL.value else None,
        weight_grams=kaynak.weight_grams,
        brand=kaynak.brand,
        category_id=kaynak.category_id,
        # Taslak doğar: fiyat/görsel gözden geçirilmeden vitrine çıkmasın.
        status=ProductStatus.DRAFT.value,
        cover_url=kaynak.cover_url,
        created_by_admin_id=admin.id,
        variant_group_id=kaynak.variant_group_id,
        option1_value=payload.option1_value,
        option2_value=payload.option2_value,
        variant_sort=(
            payload.variant_sort
            if payload.variant_sort is not None
            else (kaynak.variant_sort or 0) + 1
        ),
        barcode=payload.barcode,
    )
    for field in _BOOK_SPEC_FIELDS:
        if field == "isbn":
            continue
        setattr(p, field, getattr(kaynak, field))
    db.add(p)
    await db.flush()
    # Galeri görselleri: aynı URL'lere işaret eden yeni satırlar (dosya ortak).
    for im in kaynak.images:
        db.add(
            ProductImage(
                product_id=p.id, url=im.url, caption=im.caption,
                sort_order=im.sort_order,
            )
        )
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
    await db.flush()
    return p


# ── Varyant matrisi (toplu kardeş üretimi) ───────────────────────────────────


async def _matris_baglami(db: AsyncSession, source_id: int):
    """Matris uçlarının ortak ön hazırlığı: kaynak, grup ve MEVCUT kombinasyonlar.

    İki uç (önizleme ve üretim) aynı bağlamı okumak ZORUNDA: ayrı okusalardı
    önizlemede "yeni" görünen bir hücre üretimde çakışabilirdi.
    """
    kaynak = await _load_full(db, source_id)
    if kaynak is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ürün bulunamadı")
    if kaynak.variant_group_id is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Kaynak ürün bir varyant grubunda değil. Önce grubu oluşturup "
            "kaynağı gruba bağlayın; matris kardeş ekler.",
        )
    grup = await db.get(VariantGroup, kaynak.variant_group_id)
    if grup is None or grup.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Varyant grubu bulunamadı")

    rows = (
        await db.execute(
            select(Product.option1_value, Product.option2_value, Product.id).where(
                Product.variant_group_id == grup.id,
                Product.deleted_at.is_(None),
            )
        )
    ).all()
    mevcut = {(o1, o2): pid for o1, o2, pid in rows}
    return kaynak, grup, mevcut


def _eksen_girdisi_dogrula(grup: VariantGroup, option2_values: list[str] | None) -> None:
    """Grubun eksen sayısıyla gelen girdinin uyumu.

    DB CHECK'leri son savunmadır; buradaki erken kontrol aynı kuralı admin
    diline çevirir (opak IntegrityError yerine 400).
    """
    ikinci_var = bool([v for v in (option2_values or []) if (v or "").strip()])
    if grup.option2_name is None and ikinci_var:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Bu grup tek eksenli; 2. eksen değeri gönderilemez.",
        )
    if grup.option2_name is not None and not ikinci_var:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"'{grup.option2_name}' ekseni için en az bir değer girin.",
        )


async def preview_variant_matrix(
    db: AsyncSession, source_id: int, payload: VariantMatrixPreviewIn
) -> VariantMatrixPreviewOut:
    """Kuru çalıştırma: ne üretilecek, ne zaten var. HİÇBİR ŞEY YAZMAZ."""
    kaynak, grup, mevcut = await _matris_baglami(db, source_id)
    await variant_service.ensure_variants_allowed(db, kaynak.category_id)
    _eksen_girdisi_dogrula(grup, payload.option2_values)

    hucreler = variant_service.matris_hucreleri(
        payload.option1_values, payload.option2_values, mevcut
    )
    if len(hucreler) > variant_service.MATRIS_UST_SINIRI:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"{len(hucreler)} kombinasyon, tek seferlik "
            f"{variant_service.MATRIS_UST_SINIRI} sınırını aşıyor. Bir ekseni "
            "ayrı bir ürüne bölün.",
        )

    yeni = sum(1 for h in hucreler if h["mevcut_urun_id"] is None)
    return VariantMatrixPreviewOut(
        group_id=grup.id,
        option1_name=grup.option1_name,
        option2_name=grup.option2_name,
        cells=[
            VariantMatrixCellOut(
                option1_value=h["option1_value"],
                option2_value=h["option2_value"],
                existing_product_id=h["mevcut_urun_id"],
            )
            for h in hucreler
        ],
        new_count=yeni,
        existing_count=len(hucreler) - yeni,
        limit=variant_service.MATRIS_UST_SINIRI,
    )


async def create_variant_matrix(
    db: AsyncSession, admin: Admin, source_id: int, payload: VariantMatrixCreateIn
) -> VariantMatrixCreateOut:
    """Verilen satırlardan kardeş varyantlar üretir — hepsi ya da hiçbiri.

    İstek tek transaction'dır (`get_db` istek sonunda commit eder): bir satır
    patlarsa hiçbiri yazılmaz. Yarım kalmış bir matris, yöneticinin hangi
    satırların geçtiğini elle ayıklamasını gerektirirdi.

    Zaten var olan kombinasyon SESSİZCE ATLANMAZ, 409 döner: önizlemeden sonra
    başka biri aynı varyantı eklemişse yönetici bunu bilmelidir.
    """
    kaynak, grup, mevcut = await _matris_baglami(db, source_id)
    await payment_gates.assert_digital_product_creatable(db, kaynak.kind)
    await variant_service.ensure_variants_allowed(db, kaynak.category_id)

    if len(payload.rows) > variant_service.MATRIS_UST_SINIRI:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"{len(payload.rows)} satır, tek seferlik "
            f"{variant_service.MATRIS_UST_SINIRI} sınırını aşıyor.",
        )

    # İstek İÇİNDEKİ tekrarlar: aynı kombinasyon iki satırda gelirse ikincisi
    # DB'nin unique kısıtına çarpardı; hata mesajı satırı göstermezdi.
    gorulen: set[tuple[str | None, str | None]] = set()
    barkodlar: set[str] = set()
    for r in payload.rows:
        anahtar = (
            variant_service.esdeger_anahtar(r.option1_value),
            variant_service.esdeger_anahtar(r.option2_value),
        )
        if anahtar in gorulen:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Aynı kombinasyon iki kez gönderildi: {r.option1_value}"
                + (f" / {r.option2_value}" if r.option2_value else ""),
            )
        gorulen.add(anahtar)
        if r.barcode in barkodlar:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Aynı barkod iki satırda kullanıldı: {r.barcode}",
            )
        barkodlar.add(r.barcode)

    mevcut_ci = {
        (
            variant_service.esdeger_anahtar(a),
            variant_service.esdeger_anahtar(b),
        )
        for (a, b) in mevcut
    }
    uretilen: list[int] = []
    for r in payload.rows:
        anahtar = (
            variant_service.esdeger_anahtar(r.option1_value),
            variant_service.esdeger_anahtar(r.option2_value),
        )
        if anahtar in mevcut_ci:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Bu kombinasyon zaten var: {r.option1_value}"
                + (f" / {r.option2_value}" if r.option2_value else "")
                + ". Önizlemeyi yenileyin.",
            )
        variant_service.validate_membership_fields(grup, r.option1_value, r.option2_value)
        urun = await _varyant_kardesi_olustur(
            db,
            admin,
            kaynak=kaynak,
            grup=grup,
            payload=DeriveVariantIn(
                option1_value=r.option1_value,
                option2_value=r.option2_value,
                barcode=r.barcode,
                price=r.price,
                stock=r.stock,
                variant_sort=len(mevcut) + len(uretilen),
            ),
        )
        uretilen.append(urun.id)

    return VariantMatrixCreateOut(created=len(uretilen), product_ids=uretilen)


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

    # Dijital ürün kapısı (bkz. `payment_gates.assert_digital_product_creatable`).
    # Toplu içe aktarma AYNI admin ekranının ikinci kapısıdır: açık kalırsa
    # `create_product`'a konan kapı tiyatro olur. Bayrak satır başına değil BİR
    # KEZ okunur; satır bazlı ret `ValueError` ile verilir ki dosyanın geri
    # kalanı işlenmeye devam etsin ve atlanan satır `errors`'ta raporlansın.
    dijital_acik = await payment_gates.digital_products_open(db)

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
            if kind == "DIGITAL" and not dijital_acik:
                raise ValueError(
                    "dijital ürün satışı kapalı — bu satır atlandı "
                    "(bayrak: digital_products_live)"
                )
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
            try:
                await _validate_product_category(
                    db, category_id=category_id, target_status=status_v
                )
            except HTTPException as exc:
                raise ValueError(str(exc.detail)) from exc

            # Ürün + `INITIAL` hareketi AYNI savepoint'te: hareket yazılamazsa
            # o satırın ürünü de oluşmaz, diğer satırlar etkilenmez.
            async with db.begin_nested():
                slug = await _unique_product_slug(db, _slugify(title))
                yeni = Product(
                    slug=slug,
                    title=title,
                    description=_temiz_aciklama(_g("description")),
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
                    # Şema dışı girdi: aynı kural (private → satır hatası).
                    cover_url=storage.normalize_public_input(_g("cover_url")),
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

    await db.flush()
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


async def notify_back_in_stock(db: AsyncSession, product: Product) -> None:
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
    await db.flush()


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
    await _validate_product_category(
        db,
        category_id=data.get("category_id", p.category_id),
        target_status=data.get("status", p.status),
    )

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

    # ── Varyant üyeliği (yalnız admin yolu; eğitmen dijital ürünü gruplanmaz) ──
    _VARYANT_ALANLARI = (
        "variant_group_id", "option1_value", "option2_value",
        "variant_sort", "barcode",
    )
    # `variant_sort: null` anlamsızdır (kolon NOT NULL); "gönderilmedi" say.
    if data.get("variant_sort", 0) is None:
        data.pop("variant_sort")
    if owner_tutor_id is not None:
        for f in _VARYANT_ALANLARI:
            data.pop(f, None)
    else:
        hedef_grup = (
            data["variant_group_id"]
            if "variant_group_id" in data
            else p.variant_group_id
        )
        hedef_kategori = data.get("category_id", p.category_id)
        # Kapı yalnız VARYANT alanlarına ya da kategoriye DOKUNULDUĞUNDA çalışır
        # (P2-2): kategori ağacı sonradan kitap kökü altına taşınmış gruplu
        # üründe fiyat/stok/başlık düzenlemesi bile 409 alıyordu — varyantla
        # ilgisiz bakım, mevcut (artık kural dışı kalmış) üyeliği yeniden
        # yargılamaz. Ürünün kategorisini DEĞİŞTİRMEK ise kapıdan geçer: gruplu
        # ürün kitaba taşınamaz (mevcut davranış korunur).
        varyanta_dokunuldu = bool(
            set(data) & set(_VARYANT_ALANLARI)
        ) or "category_id" in data
        if hedef_grup is not None and varyanta_dokunuldu:
            await variant_service.validate_membership(
                db,
                group_id=hedef_grup,
                category_id=hedef_kategori,
                option1_value=data.get("option1_value", p.option1_value),
                option2_value=data.get("option2_value", p.option2_value),
                barcode=data.get("barcode", p.barcode),
            )
        elif hedef_grup is None:
            if "variant_group_id" in data:
                # Gruptan çıkış: eksen değerleri de temizlenir — orphan
                # CHECK'ine çarpmadan, bayat "Kırmızı" etiketi bırakmadan.
                data["option1_value"] = None
                data["option2_value"] = None
            if data.get("option1_value") or data.get("option2_value"):
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "Eksen değeri yalnız bir varyant grubuyla birlikte "
                    "gönderilebilir.",
                )

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
        # Oran, satıcı kim olursa olsun düzenlenebilir: eğitmen de kendi dijital
        # ürününün faturasından sorumludur. Sınır şemada (0 ≤ oran < 1).
        "tax_rate",
    ]
    if owner_tutor_id is None:
        # Admin: ağırlık/durum + kitap künyesi + varyant üyeliği (stok HARİÇ).
        # Kapak adresi de yalnız admin yolunda elle yazılır. Eğitmen kapağı
        # yalnız yükleme ucundan (`set_cover`) değiştirir: `set_cover` ESKİ
        # değeri depodan sildiği için alana başkasının public anahtarını
        # (ör. `profiles/...`) yazıp kapak yüklemek o nesneyi sildirirdi.
        editable += [
            "cover_url",
            "weight_grams", "brand", "status", *_BOOK_SPEC_FIELDS, *_VARYANT_ALANLARI,
        ]
    # Açıklama HTML taşıyabilir ve `dangerouslySetInnerHTML` ile basılır: ham
    # değer DB'ye ASLA girmez. Temizlik `setattr` döngüsünden ÖNCE, çünkü döngü
    # dinamik bir yazım yoludur ve oraya güvenmek sessiz bir XSS kapısı olurdu.
    if "description" in data:
        data = {**data, "description": _temiz_aciklama(data["description"])}

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

    await db.flush()
    # Stok 0→>0 olduysa bekleyen stok-bildirim abonelerine haber ver.
    if (old_stock is None or old_stock <= 0) and (p.stock or 0) > 0:
        await notify_back_in_stock(db, p)
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
    supplier: str | None = None,
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

    if supplier is not None:
        # Üç ayrı soru, üç ayrı filtre:
        #   linked     — bu ürünün bir tedarikçi karşılığı var mı? (eşleştirme
        #                işini takip etmek için)
        #   backed     — "tedarikçiden temin" anahtarı açık mı? (bağ olmadan da
        #                açık olabilir; o hâl bir UYARIDIR ve görünmeli)
        #   below_cost — satış fiyatı maliyetin altında mı? (para kaybı)
        bagli = exists().where(
            SupplierProduct.product_id == Product.id,
            Supplier.id == SupplierProduct.supplier_id,
            Supplier.deleted_at.is_(None),
        )
        if supplier == "linked":
            stmt = stmt.where(bagli)
        elif supplier == "backed":
            stmt = stmt.where(Product.supplier_backed.is_(True))
        elif supplier == "below_cost":
            stmt = stmt.where(
                exists().where(
                    SupplierProduct.product_id == Product.id,
                    SupplierProduct.cost_gross.isnot(None),
                    SupplierProduct.cost_gross >= Product.price,
                    Supplier.id == SupplierProduct.supplier_id,
                    Supplier.deleted_at.is_(None),
                )
            )

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
    #: `linked` | `backed` | `below_cost` — bkz. `_admin_filtreleri`.
    supplier: str | None = None,
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
        taban, q=q, stok=stok, publisher=publisher, author=author, supplier=supplier
    )

    sayim = select(func.count()).select_from(Product).where(Product.deleted_at.is_(None))
    sayim = _admin_filtreleri(
        sayim, q=q, stok=stok, publisher=publisher, author=author, supplier=supplier
    )
    toplam = int((await db.execute(sayim)).scalar_one())

    kolon = _ADMIN_SORT.get(sort, Product.created_at)
    yon = kolon.asc() if order == "asc" else kolon.desc()
    # İkincil anahtar `id`: sıralama alanı eşit olan satırlarda (aynı fiyat,
    # aynı stok) sıra deterministik olmalı, yoksa sayfa 1 ile sayfa 2 aynı
    # kaydı gösterebilir ya da bir kayıt hiç görünmeyebilir.
    stmt = taban.order_by(yon, Product.id.desc()).limit(limit).offset(offset)

    rows = (await db.execute(stmt)).all()
    # Maliyet ve marj YALNIZ burada doldurulur (D-6): bu uç
    # `require_admin_permission("products.view")` arkasında.
    tedarikci_bilgi = await _tedarikci_admin_bilgisi(db, [r[0] for r in rows])
    return [
        _to_search_out(
            p,
            prior_mean,
            confidence,
            tutor_name=(fn or None),  # yalnız AD (ÜK-9)
            supplier_qty=(
                Decimal(tedarikci_bilgi[p.id].stock_qty)
                if p.id in tedarikci_bilgi
                else None
            ),
            supplier_info=tedarikci_bilgi.get(p.id),
        )
        for p, fn, _ln in rows
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
    tedarikci = await _tedarikci_stogu(db, [r[0] for r in rows])
    return [
        _to_search_out(
            p,
            prior_mean,
            confidence,
            tutor_name=(fn or None),  # yalnız AD (ÜK-9)
            supplier_qty=tedarikci.get(p.id),
        )
        for p, fn, _ln in rows
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
        description=_temiz_aciklama(payload.description),
        kind=ProductKind.DIGITAL.value,
        seller_type=SellerType.TUTOR.value,
        tutor_id=tutor.id,
        price=payload.price,
        compare_at_price=payload.compare_at_price,
        tax_rate=payload.tax_rate,
        category_id=payload.category_id,
        status=ProductStatus.PENDING.value,
        # `payload.cover_url` bilinçli olarak YAZILMAZ: kapak yalnız yükleme
        # ucundan gelir (bkz. `update_product` — sonraki yükleme eski değeri
        # depodan siler, istemci anahtarı başkasının nesnesi olabilir).
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
        # Eğitmen ürünleri DİJİTALDİR; tedarikçi katmanı onları hiç kapsamaz.
        _to_search_out(p, prior_mean, confidence, tutor_name=tutor.display_name)
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
    p.cover_url = await storage.upload_product_photo(file_bytes)
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
        url = await storage.upload_product_photo(raw)
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


def yeni_gorsel_sirasi(
    mevcut: list[tuple[int, int]], istenen: list[int]
) -> dict[int, int]:
    """Galerinin yeni ``{gorsel_id: sort_order}`` eşlemesi. Saf fonksiyon.

    ``mevcut``: ürünün bugünkü ``(id, sort_order)`` çiftleri.
    ``istenen``: yöneticinin sürükleyerek oluşturduğu sıra.

    İki kural:

    1. ``istenen`` dizisindeki görseller 0'dan başlayarak o sırayla numaralanır.
    2. Dizide GEÇMEYEN görseller SİLİNMEZ; mevcut göreli sıralarını koruyarak
       sona eklenir. İki yönetici aynı anda çalışırken biri sürüklerken diğeri
       yeni görsel yüklediyse, sürükleyenin eski listesi yeni görseli sessizce
       düşürmemelidir.

    Doğrulama (yabancı/tekrar eden id) çağıranın işidir; burası yalnız sırayı
    hesaplar.
    """
    istenen_kume = set(istenen)
    sira: dict[int, int] = {}
    for i, iid in enumerate(istenen):
        sira[iid] = i
    sonraki = len(istenen)
    for gid, _ in sorted(mevcut, key=lambda x: (x[1], x[0])):
        if gid not in istenen_kume:
            sira[gid] = sonraki
            sonraki += 1
    return sira


async def reorder_images(
    db: AsyncSession,
    product_id: int,
    image_ids: list[int],
    *,
    owner_tutor_id: int | None = None,
) -> ProductDetailOut:
    """Galeri sırasını verilen id dizisine göre yeniden numaralar.

    Yabancı id (başka ürünün ya da hiç olmayan görselin id'si) 400 döndürür:
    sessizce atlamak, yanlış ürünün galerisini düzenlediğini sanan yöneticiye
    "oldu" demek olurdu. Sıra hesabı `yeni_gorsel_sirasi`de, testli.
    """
    await _require_product(db, product_id, owner_tutor_id=owner_tutor_id)
    imgs = (
        (
            await db.execute(
                select(ProductImage).where(ProductImage.product_id == product_id)
            )
        )
        .scalars()
        .all()
    )
    by_id = {im.id: im for im in imgs}

    yabanci = [i for i in image_ids if i not in by_id]
    if yabanci:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Bu ürüne ait olmayan görsel: {', '.join(map(str, yabanci))}",
        )
    if len(set(image_ids)) != len(image_ids):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Sırada tekrar eden görsel var")

    sira = yeni_gorsel_sirasi([(im.id, im.sort_order) for im in imgs], image_ids)
    for im in imgs:
        im.sort_order = sira[im.id]

    await db.commit()
    full = await _load_full(db, product_id)
    return await _to_detail(db, full)


async def update_image_meta(
    db: AsyncSession,
    product_id: int,
    image_id: int,
    *,
    fields: dict[str, str | None],
    owner_tutor_id: int | None = None,
) -> ProductDetailOut:
    """Görselin alt metnini/başlığını günceller.

    ``fields`` yalnız İSTEKTE GÖNDERİLEN alanları taşır (``exclude_unset``);
    gönderilmeyen alana dokunulmaz. Boş dize NULL'a çevrilir — "sil" demenin
    yolu budur, aksi hâlde alan asla temizlenemezdi.
    """
    await _require_product(db, product_id, owner_tutor_id=owner_tutor_id)
    img = await db.get(ProductImage, image_id)
    if img is None or img.product_id != product_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Görsel bulunamadı")

    for alan in ("alt_text", "caption"):
        if alan in fields:
            deger = (fields[alan] or "").strip()
            setattr(img, alan, deger or None)

    await db.commit()
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
        item.client_name = client.display_name
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
                # Moderasyonla gizlenen yorum silinse de hakkı tüketir: sil +
                # yeniden yaz gizleme kararını geri almasın.
                or_(ProductReview.deleted_at.is_(None), ProductReview.hidden_at.is_not(None)),
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
    item.client_name = client.display_name
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
#:
#: Tek kaynak `settings.PRICE_REFERENCE_WINDOW_DAYS`; burada yalnız okunur.
#: Mevzuat 1 Ağustos 2026'da 30 günden 10 güne indi ve bir daha değişebilir —
#: iki ayrı yerde sabit tutmak, birinin geride kalmasıyla sonuçlanırdı.
PRICE_REFERENCE_WINDOW_DAYS = settings.PRICE_REFERENCE_WINDOW_DAYS


async def lowest_price_in_window(
    db: AsyncSession, product_id: int, *, days: int = PRICE_REFERENCE_WINDOW_DAYS
) -> Decimal | None:
    """Ürünün son ``days`` gündeki EN DÜŞÜK fiyatı.

    İndirim duyurusu yapılırken üzeri çizili gösterilecek referans budur.
    Serbestçe girilen ``compare_at_price`` denetimde kabul edilmez: yönetmelik
    indirimden önceki pencere içindeki EN DÜŞÜK fiyatın esas alınmasını ister
    (pencere `settings.PRICE_REFERENCE_WINDOW_DAYS`).

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

    Kural: referans, pencere içindeki en düşük fiyattır ve ancak GÜNCEL fiyattan
    yüksekse indirim vardır. Aksi halde (fiyat düşmemiş ya da geçmiş yok)
    üzeri çizili fiyat gösterilmez — dayanaksız indirim iddiası ceza konusudur.
    """
    if lowest_30d is None:
        return None
    current = Decimal(str(current_price))
    lowest = Decimal(str(lowest_30d))
    return lowest if lowest > current else None
