from __future__ import annotations

import csv
import dataclasses
import datetime
import io
from decimal import Decimal
from typing import Literal

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_admin_permission, require_roles, user_rate_limit
from core import storage
from core.config import settings
from core.ratelimit import rate_limit
from core.database import get_db
from core.stock_policy import LOW_STOCK_THRESHOLD
from models.admin import Admin
from models.client import Client
from models.role import RoleType
from models.store import ReturnRefundStatus, ReturnStatus
from models.tutor import Tutor
from schemas.review import RatingDistributionOut
from schemas.stock import (
    LedgerAuditOut,
    LedgerProblemOut,
    LedgerVerificationOut,
    StockMovementOut,
    StockMovementPageOut,
)
from schemas.store import (
    AdminOrderActionIn,
    BulkImportResultOut,
    CartValidateOut,
    CollectionCreate,
    CollectionDetailOut,
    CollectionItemAdd,
    CollectionOut,
    CollectionUpdate,
    CouponCreate,
    CouponOut,
    CouponUpdate,
    OrderCreate,
    OrderOut,
    OrderReturnCreate,
    OrderReturnOut,
    OrderReturnReceiveIn,
    OrderReturnResolve,
    OrderShipIn,
    ProductCategoryCreate,
    ProductCategoryOut,
    ProductCategoryUpdate,
    ProductCreate,
    ProductDetailOut,
    ProductReviewCreate,
    ProductReviewOut,
    ProductSearchOut,
    ProductUpdate,
    SellerEarningsOut,
    SellerProductCreate,
    StockNotifyIn,
    DeriveVariantIn,
    VariantConfigOut,
    VariantGroupCreate,
    VariantGroupDetailOut,
    VariantGroupOut,
    VariantGroupUpdate,
)
from schemas.delivery import (
    DeliveryFeedbackIn,
    DeliveryFeedbackOut,
    DeliveryInfoOut,
    DeliveryPrefIn,
    OrderTrackingOut,
    ShipAddressChangeIn,
)
from services import (
    audit_service,
    collection_service,
    coupon_service,
    delivery_feedback_service,
    delivery_promise,
    delivery_service,
    invoice_service,
    order_service,
    phone_service,
    stock_ledger,
    store_service,
    variant_service,
)

router = APIRouter(prefix="/store", tags=["store"])

_MAX_IMAGE_BYTES = 12 * 1024 * 1024
_MAX_ASSET_BYTES = 50 * 1024 * 1024

_review_limit = user_rate_limit(
    key="product_review",
    limit=settings.RATE_LIMIT_REVIEW,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)
_pay_limit = user_rate_limit(
    key="store_pay",
    limit=settings.RATE_LIMIT_PAYMENT,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)
# CAYMA iade talebi admin'siz PARA HAREKETİ başlatır (m.9 koşulsuz onay) —
# diğer para yazma uçları gibi kullanıcı bazlı limite tabidir (İP2A-11).
_return_limit = user_rate_limit(
    key="return_create",
    limit=settings.RATE_LIMIT_RETURN,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)
# Oturumsuz kargo takibi IP bazlı (token brute-force koruması; auth yok).
_track_limit = rate_limit(
    key="order_track",
    limit=settings.RATE_LIMIT_TRACKING,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)


async def _read_image(file: UploadFile) -> bytes:
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Yalnızca görsel yüklenebilir.")
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Boş dosya.")
    if len(data) > _MAX_IMAGE_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Görsel 12MB sınırını aşıyor.")
    return data


# ── Public katalog ───────────────────────────────────────────────────────────────


@router.get("/config")
async def store_config():
    """Mağaza yüzeylerinin paylaştığı sabitler.

    Düşük stok eşiği burada döner çünkü istemcinin kendi kopyasını taşıması
    tam da bu paketin düzelttiği sorundu: değer üç yerde ayrı ayrı gömülüydü
    ve biri kaydığında alarm kartı ile ürün listesi farklı küme gösteriyordu.
    Tek kaynak `core.stock_policy`; istemci onu OKUR, tekrarlamaz.
    """
    return {"low_stock_threshold": LOW_STOCK_THRESHOLD}


@router.get("/categories", response_model=list[ProductCategoryOut])
async def list_categories(db: AsyncSession = Depends(get_db)):
    return await store_service.list_categories(db)


@router.get("/book-facets")
async def list_book_facets(
    category_id: int | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Kitap filtrelerinin seçenekleri (yayınevi / yazar / kapak) + sayıları."""
    return await store_service.list_book_facets(db, category_id=category_id)


@router.get("/products", response_model=list[ProductSearchOut])
async def search_products(
    q: str | None = Query(default=None, max_length=200),
    category_id: int | None = Query(default=None),
    tutor_id: int | None = Query(default=None),
    kind: str | None = Query(default=None, pattern="^(PHYSICAL|DIGITAL)$"),
    min_price: Decimal | None = Query(default=None, ge=0),
    max_price: Decimal | None = Query(default=None, ge=0),
    in_stock: bool = Query(default=False),
    min_rating: float | None = Query(default=None, ge=0, le=5),
    # Kitap künyesi daraltmaları (çoklu seçim): /store/book-facets listeler.
    publisher: list[str] | None = Query(default=None),
    author: list[str] | None = Query(default=None),
    cover_type: list[str] | None = Query(default=None),
    # Varyant eksen daraltması: "Eksen:Değer" (ör. Renk:Sarı). Eksen adları
    # /store/book-facets → variant_axes'ten gelir.
    variant: list[str] | None = Query(default=None),
    sort: str | None = Query(
        default=None, pattern="^(price_asc|price_desc|newest|rating)$"
    ),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    try:
        variant_filters = store_service.parse_variant_filters(variant)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return await store_service.search_products(
        db,
        q=q,
        publisher=publisher,
        author=author,
        cover_type=cover_type,
        variant_filters=variant_filters or None,
        category_id=category_id,
        tutor_id=tutor_id,
        kind=kind,
        min_price=min_price,
        max_price=max_price,
        in_stock=in_stock,
        min_rating=min_rating,
        sort=sort,
        limit=limit,
        offset=offset,
    )


# ── Admin: kategori CRUD (—/{id_or_slug}'tan ÖNCE) ───────────────────────────────


@router.get("/admin/products", response_model=list[ProductSearchOut])
async def list_products_admin(
    response: Response,
    q: str | None = Query(default=None, max_length=200),
    # Tip `str` DEĞİL `Literal`: yazım hatalı bir filtre 422 döner, sessizce
    # boş liste değil. ([[TB-19]]/1 bu sınıfı kayda geçirmişti: `str` tipli
    # filtre parametresi yanlış yazıldığında admin "hiç ürün yok" sanıyor.)
    # Doğrulama şemada olduğu için router içinde elle `if` yok.
    stok: Literal["tukendi", "azalan", "var", "kritik"] | None = Query(default=None),
    publisher: list[str] | None = Query(default=None),
    author: list[str] | None = Query(default=None),
    sort: Literal["title", "price", "stock", "created_at"] = Query(
        default="created_at"
    ),
    order: Literal["asc", "desc"] = Query(default="desc"),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _admin: Admin = Depends(require_admin_permission("products.view")),
    db: AsyncSession = Depends(get_db),
):
    """Yönetim ürün listesi — taslak/gizli dahil, filtreli ve sayfalı.

    Toplam kayıt `X-Total-Count` başlığıyla döner. Gövde geriye uyumluluk için
    dizi olarak kalır; panelin diğer listeleri de (kullanıcı/booking/demand/
    audit) aynı sözleşmeyi kullanıyor.
    """
    kayitlar, toplam = await store_service.list_products_admin(
        db,
        q=q,
        stok=stok,
        publisher=publisher,
        author=author,
        sort=sort,
        order=order,
        limit=limit,
        offset=offset,
    )
    response.headers["X-Total-Count"] = str(toplam)
    return kayitlar


@router.post("/admin/products/bulk", response_model=BulkImportResultOut)
async def bulk_import_products(
    file: UploadFile = File(...),
    admin: Admin = Depends(require_admin_permission("products.manage")),
    db: AsyncSession = Depends(get_db),
):
    if file.filename and not file.filename.lower().endswith(".csv"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Yalnızca .csv dosyası yükleyin.")
    content = await file.read()
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Boş dosya.")
    # utf-8-sig: Excel'in eklediği BOM'u yutar.
    text = content.decode("utf-8-sig", errors="replace")
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "CSV boş (başlık satırı + en az bir ürün gerekli)."
        )
    result = await store_service.bulk_import_products(db, admin, rows)
    # `bulk_import_products` SÖZLÜK döner (`-> dict`), nesne değil. Burada
    # eskiden `result.created` yazıyordu ve uç, dosya geçerli olsa bile
    # **500** veriyordu: audit satırı yazılmadan önce `AttributeError`.
    # `response_model` bunu gizliyordu — hata dönüşümden ÖNCE oluşuyor.
    # (İP-5 V-3 node'u ortaya çıkardı; denetim raporunda yoktu.)
    await audit_service.record(
        db, actor=admin, action="product.bulk_import", target_type="product",
        details=file.filename,
        meta={
            "created": result["created"],
            "skipped": result["skipped"],
            "errors": len(result["errors"]),
        },
    )
    return result


@router.get("/admin/products/{product_id}", response_model=ProductDetailOut)
async def get_product_admin(
    product_id: int,
    _admin: Admin = Depends(require_admin_permission("products.view")),
    db: AsyncSession = Depends(get_db),
):
    return await store_service.get_product_admin(db, product_id)


@router.post(
    "/admin/products", response_model=ProductDetailOut, status_code=status.HTTP_201_CREATED
)
async def create_product(
    payload: ProductCreate,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    db: AsyncSession = Depends(get_db),
):
    product = await store_service.create_product(db, admin, payload)
    await audit_service.record(
        db, actor=admin, action="product.create", target_type="product",
        target_id=product.id, details=product.title,
        after=payload.model_dump(exclude_unset=True),
    )
    return product


@router.patch("/admin/products/{product_id}", response_model=ProductDetailOut)
async def update_product(
    product_id: int,
    payload: ProductUpdate,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    db: AsyncSession = Depends(get_db),
):
    product = await store_service.update_product(
        db, product_id, payload, admin_id=admin.id
    )
    await audit_service.record(
        db, actor=admin, action="product.update", target_type="product",
        target_id=product_id, after=payload.model_dump(exclude_unset=True),
    )
    return product


@router.delete("/admin/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(
    product_id: int,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    db: AsyncSession = Depends(get_db),
):
    await store_service.delete_product(db, product_id)
    await audit_service.record(
        db, actor=admin, action="product.delete", target_type="product", target_id=product_id
    )


@router.post("/admin/products/{product_id}/cover", response_model=ProductDetailOut)
async def upload_product_cover(
    product_id: int,
    file: UploadFile = File(...),
    admin: Admin = Depends(require_admin_permission("products.manage")),
    db: AsyncSession = Depends(get_db),
):
    product = await store_service.set_cover(db, product_id, await _read_image(file))
    await audit_service.record(
        db, actor=admin, action="product.media_update", target_type="product",
        target_id=product_id, meta={"op": "cover", "filename": file.filename},
    )
    return product


@router.post("/admin/products/{product_id}/images", response_model=ProductDetailOut)
async def upload_product_images(
    product_id: int,
    files: list[UploadFile] = File(...),
    admin: Admin = Depends(require_admin_permission("products.manage")),
    db: AsyncSession = Depends(get_db),
):
    if not files:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "En az bir görsel seçin.")
    blobs = [await _read_image(f) for f in files]
    product = await store_service.add_images(db, product_id, blobs)
    await audit_service.record(
        db, actor=admin, action="product.media_update", target_type="product",
        target_id=product_id, meta={"op": "images_add", "count": len(files)},
    )
    return product


@router.delete(
    "/admin/products/{product_id}/images/{image_id}", response_model=ProductDetailOut
)
async def delete_product_image(
    product_id: int,
    image_id: int,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    db: AsyncSession = Depends(get_db),
):
    product = await store_service.delete_image(db, product_id, image_id)
    await audit_service.record(
        db, actor=admin, action="product.media_update", target_type="product",
        target_id=product_id, meta={"op": "image_delete", "image_id": image_id},
    )
    return product


@router.post(
    "/admin/categories",
    response_model=ProductCategoryOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_category(
    payload: ProductCategoryCreate,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    db: AsyncSession = Depends(get_db),
):
    category = await store_service.create_category(db, payload)
    await audit_service.record(
        db, actor=admin, action="category.create", target_type="product_category",
        target_id=category.id, details=category.name,
    )
    return category


@router.patch("/admin/categories/{category_id}", response_model=ProductCategoryOut)
async def update_category(
    category_id: int,
    payload: ProductCategoryUpdate,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    db: AsyncSession = Depends(get_db),
):
    category = await store_service.update_category(db, category_id, payload)
    await audit_service.record(
        db, actor=admin, action="category.update", target_type="product_category",
        target_id=category_id, after=payload.model_dump(exclude_unset=True),
    )
    return category


@router.delete(
    "/admin/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_category(
    category_id: int,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    db: AsyncSession = Depends(get_db),
):
    await store_service.delete_category(db, category_id)
    await audit_service.record(
        db, actor=admin, action="category.delete", target_type="product_category",
        target_id=category_id,
    )


# ── Admin: varyant grupları (Faz 2) ──────────────────────────────────────────────


@router.get("/admin/variant-config", response_model=VariantConfigOut)
async def get_variant_config(
    _admin: Admin = Depends(require_admin_permission("products.view")),
):
    """Varyant sözlükleri — frontend açılır menüleri buradan doldurur (kopya
    sabit tutulmaz; tek kaynak backend)."""
    from models.store import VARIANT_AXES

    return VariantConfigOut(
        axes=list(VARIANT_AXES),
        book_root_slugs=sorted(variant_service.BOOK_ROOT_SLUGS),
    )


@router.get("/admin/variant-groups", response_model=list[VariantGroupOut])
async def list_variant_groups(
    _admin: Admin = Depends(require_admin_permission("products.view")),
    db: AsyncSession = Depends(get_db),
):
    return await variant_service.list_groups(db)


@router.post(
    "/admin/variant-groups",
    response_model=VariantGroupOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_variant_group(
    payload: VariantGroupCreate,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    db: AsyncSession = Depends(get_db),
):
    group = await variant_service.create_group(db, payload)
    await audit_service.record(
        db, actor=admin, action="variant_group.create", target_type="variant_group",
        target_id=group.id, details=group.title,
        after=payload.model_dump(exclude_unset=True),
    )
    return group


@router.get("/admin/variant-groups/{group_id}", response_model=VariantGroupDetailOut)
async def get_variant_group(
    group_id: int,
    _admin: Admin = Depends(require_admin_permission("products.view")),
    db: AsyncSession = Depends(get_db),
):
    return await variant_service.get_group_detail(db, group_id)


@router.patch("/admin/variant-groups/{group_id}", response_model=VariantGroupOut)
async def update_variant_group(
    group_id: int,
    payload: VariantGroupUpdate,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    db: AsyncSession = Depends(get_db),
):
    group = await variant_service.update_group(db, group_id, payload)
    await audit_service.record(
        db, actor=admin, action="variant_group.update", target_type="variant_group",
        target_id=group_id, after=payload.model_dump(exclude_unset=True),
    )
    return group


@router.delete(
    "/admin/variant-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_variant_group(
    group_id: int,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    db: AsyncSession = Depends(get_db),
):
    await variant_service.delete_group(db, group_id)
    await audit_service.record(
        db, actor=admin, action="variant_group.delete", target_type="variant_group",
        target_id=group_id,
    )


@router.post(
    "/admin/products/{product_id}/derive-variant",
    response_model=ProductDetailOut,
    status_code=status.HTTP_201_CREATED,
)
async def derive_variant(
    product_id: int,
    payload: DeriveVariantIn,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    db: AsyncSession = Depends(get_db),
):
    product = await store_service.derive_variant(db, admin, product_id, payload)
    await audit_service.record(
        db, actor=admin, action="product.derive_variant", target_type="product",
        target_id=product.id, details=product.title,
        meta={"source_product_id": product_id},
    )
    return product


# ── Admin: sipariş yönetimi ──────────────────────────────────────────────────────


@router.get("/admin/orders", response_model=list[OrderOut])
async def list_orders_admin(
    response: Response,
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _admin: Admin = Depends(require_admin_permission("orders.view")),
    db: AsyncSession = Depends(get_db),
):
    """Yönetim sipariş listesi. Toplam kayıt `X-Total-Count` başlığında.

    Başlık olmadan istemci listenin kesilip kesilmediğini bilemiyordu: uç
    varsayılan `limit=100` uyguluyor, istemci `limit` göndermiyordu ve
    "yalnızca ilk N gösteriliyor" uyarısı hiçbir koşulda tetiklenemiyordu
    (P1-5 — 130 siparişten 100'ü dönüyor, kullanıcıya söylenmiyordu).
    """
    kayitlar, toplam = await order_service.list_orders_admin(
        db, status_filter=status_filter, limit=limit, offset=offset
    )
    response.headers["X-Total-Count"] = str(toplam)
    return kayitlar


@router.post("/admin/orders/{order_id}/ship", response_model=OrderOut)
async def ship_order(
    order_id: int,
    payload: OrderShipIn,
    admin: Admin = Depends(require_admin_permission("orders.manage")),
    db: AsyncSession = Depends(get_db),
):
    order = await order_service.mark_shipped(db, order_id, tracking_no=payload.tracking_no)
    await audit_service.record(
        db, actor=admin, action="order.ship", target_type="order", target_id=order_id,
        after={"status": order.status, "tracking_no": payload.tracking_no},
    )
    return order


@router.post("/admin/orders/{order_id}/deliver", response_model=OrderOut)
async def deliver_order(
    order_id: int,
    admin: Admin = Depends(require_admin_permission("orders.manage")),
    db: AsyncSession = Depends(get_db),
):
    order = await order_service.mark_delivered(db, order_id)
    await audit_service.record(
        db, actor=admin, action="order.deliver", target_type="order", target_id=order_id,
        after={"status": order.status},
    )
    return order


@router.post("/admin/orders/{order_id}/refund", response_model=OrderOut)
async def refund_order(
    order_id: int,
    payload: AdminOrderActionIn,
    admin: Admin = Depends(require_admin_permission("orders.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Yönetici tam iadesi — **zorunlu gerekçeyle** (İP-2b R3).

    Uç eskiden gövdesizdi: audit satırı yazılıyor ama `reason=NULL` kalıyordu,
    yani "bu iade neden yapıldı" sorusunun yapısal cevabı yoktu. Para hareketi
    başlatan yönetici aksiyonu gerekçesiz kaydedilemez.
    """
    order = await order_service.refund_order(db, order_id, reason=payload.reason)
    await audit_service.record(
        db, actor=admin, action="order.refund", target_type="order", target_id=order_id,
        reason=payload.reason,
        after={"status": order.status, "total": order.total},
    )
    return order


@router.post("/admin/orders/{order_id}/cancel", response_model=OrderOut)
async def cancel_order_by_admin(
    order_id: int,
    payload: AdminOrderActionIn,
    admin: Admin = Depends(require_admin_permission("orders.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Yönetici sipariş iptali — **zorunlu gerekçeyle** (İP-2b R2/R2b).

    Booking tarafındaki `/admin/bookings/{id}/cancel` eşdeğeri; yönetici
    ödenmemiş/sorunlu siparişi kapatabilsin diye eklendi. Ödenmiş siparişte
    müşteri iptaliyle AYNI telafi kuyruğu koşar (iade + stok + kupon + durak).
    """
    order = await order_service.cancel_by_admin(db, order_id, reason=payload.reason)
    await audit_service.record(
        db, actor=admin, action="order.cancel", target_type="order", target_id=order_id,
        reason=payload.reason,
        after={"status": order.status, "payment_status": order.payment_status},
    )
    return order


# ── İade talepleri (RMA) yönetimi (ADMIN) ────────────────────────────────────────


@router.get("/admin/returns", response_model=list[OrderReturnOut])
async def list_returns_admin(
    # TB-14/1 — İki filtre de ENUM'a bağlıdır. Eskiden ham `str` idi ve yanlış
    # yazılmış bir değer 422 yerine **boş liste** döndürüyordu: yönetici "iade
    # kuyruğu boş" sanıyor, bekleyen iade gözden kaçıyordu. Doğrulama şema
    # seviyesindedir (router gövdesinde elle `if` YOK) — böylece OpenAPI da
    # geçerli değerleri yayımlar ve istemci tarafı sessizce sapamaz.
    status_filter: ReturnStatus | None = Query(default=None, alias="status"),
    refund_status: ReturnRefundStatus | None = Query(
        default=None,
        description=(
            "Para durumu filtresi. 'MANUAL_REVIEW' otomatik denemeleri tükenmiş, "
            "parası askıda kalmış iadelerin kuyruğudur (PK-δ)."
        ),
    ),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _admin: Admin = Depends(require_admin_permission("returns.view")),
    db: AsyncSession = Depends(get_db),
):
    return await order_service.list_returns_admin(
        db,
        status_filter=status_filter,
        refund_status_filter=refund_status,
        limit=limit,
        offset=offset,
    )


# NOT: approve/reject/receive uçları `audit_service.record` ÇAĞIRMAZ — denetim
# satırını servis katmanı, kararı taşıyan transaction'ın İÇİNDE yazar
# (`order_service._audit_return`). Router'da yazmak iki kusur üretiyordu
# (İP2A-08): sağlayıcı 502'sinde karar COMMIT'lenmiş olmasına rağmen audit'e
# hiç ulaşılmıyordu, ve müşteri tetikli CAYMA otomatik onayı hiç iz bırakmıyordu.
# İkisini birden yazmak ise aynı kararı iki kez kaydederdi.


@router.post("/admin/returns/{return_id}/approve", response_model=OrderReturnOut)
async def approve_return(
    return_id: int,
    payload: OrderReturnResolve,
    admin: Admin = Depends(require_admin_permission("returns.manage")),
    db: AsyncSession = Depends(get_db),
):
    return await order_service.approve_return(
        db, return_id, admin_note=payload.admin_note, actor=admin
    )


@router.post("/admin/returns/{return_id}/reject", response_model=OrderReturnOut)
async def reject_return(
    return_id: int,
    payload: OrderReturnResolve,
    admin: Admin = Depends(require_admin_permission("returns.manage")),
    db: AsyncSession = Depends(get_db),
):
    return await order_service.reject_return(
        db, return_id, admin_note=payload.admin_note, actor=admin
    )


@router.post("/admin/returns/{return_id}/receive", response_model=OrderReturnOut)
async def receive_return(
    return_id: int,
    payload: OrderReturnReceiveIn,
    admin: Admin = Depends(require_admin_permission("returns.manage")),
    db: AsyncSession = Depends(get_db),
):
    """İade edilen malın depoda teslim alınması ve muayenesi (PK-α).

    Stoğun geri döndüğü **tek** yer burasıdır: para iadesi tek başına stok
    üretmez, çünkü kitap o an hâlâ müşterinin elinde olabilir.
    """
    return await order_service.receive_return(
        db,
        return_id,
        lines=[
            order_service.ReceiveLine(
                ln.return_item_id, ln.accepted_quantity, ln.damaged_quantity
            )
            for ln in payload.lines
        ],
        actor=admin,
    )


# ── Kupon yönetimi (ADMIN) ───────────────────────────────────────────────────────


@router.get("/admin/coupons", response_model=list[CouponOut])
async def list_coupons(
    _admin: Admin = Depends(require_admin_permission("coupons.view")),
    db: AsyncSession = Depends(get_db),
):
    return await coupon_service.list_coupons(db)


@router.post(
    "/admin/coupons", response_model=CouponOut, status_code=status.HTTP_201_CREATED
)
async def create_coupon(
    payload: CouponCreate,
    admin: Admin = Depends(require_admin_permission("coupons.manage")),
    db: AsyncSession = Depends(get_db),
):
    coupon = await coupon_service.create_coupon(db, payload)
    await audit_service.record(
        db, actor=admin, action="coupon.create", target_type="coupon",
        target_id=coupon.id, details=coupon.code,
        after=payload.model_dump(exclude_unset=True),
    )
    return coupon


@router.patch("/admin/coupons/{coupon_id}", response_model=CouponOut)
async def update_coupon(
    coupon_id: int,
    payload: CouponUpdate,
    admin: Admin = Depends(require_admin_permission("coupons.manage")),
    db: AsyncSession = Depends(get_db),
):
    coupon = await coupon_service.update_coupon(db, coupon_id, payload)
    await audit_service.record(
        db, actor=admin, action="coupon.update", target_type="coupon",
        target_id=coupon_id, after=payload.model_dump(exclude_unset=True),
    )
    return coupon


@router.delete("/admin/coupons/{coupon_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_coupon(
    coupon_id: int,
    admin: Admin = Depends(require_admin_permission("coupons.manage")),
    db: AsyncSession = Depends(get_db),
):
    await coupon_service.delete_coupon(db, coupon_id)
    await audit_service.record(
        db, actor=admin, action="coupon.delete", target_type="coupon", target_id=coupon_id
    )


# ── Eğitmen dijital ürünleri ─────────────────────────────────────────────────────


@router.get("/seller/products", response_model=list[ProductSearchOut])
async def list_seller_products(
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    return await store_service.list_seller_products(db, tutor)


@router.get("/seller/earnings", response_model=SellerEarningsOut)
async def seller_earnings(
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    return await store_service.seller_earnings(db, tutor)


@router.post(
    "/seller/products",
    response_model=ProductDetailOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_seller_product(
    payload: SellerProductCreate,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    return await store_service.create_seller_product(db, tutor, payload)


@router.patch("/seller/products/{product_id}", response_model=ProductDetailOut)
async def update_seller_product(
    product_id: int,
    payload: ProductUpdate,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    return await store_service.update_product(
        db, product_id, payload, owner_tutor_id=tutor.id
    )


@router.delete("/seller/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_seller_product(
    product_id: int,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    await store_service.delete_product(db, product_id, owner_tutor_id=tutor.id)


@router.post("/seller/products/{product_id}/cover", response_model=ProductDetailOut)
async def upload_seller_cover(
    product_id: int,
    file: UploadFile = File(...),
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    return await store_service.set_cover(
        db, product_id, await _read_image(file), owner_tutor_id=tutor.id
    )


@router.post("/seller/products/{product_id}/asset", response_model=ProductDetailOut)
async def upload_seller_asset(
    product_id: int,
    file: UploadFile = File(...),
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    if not storage.is_allowed_resource(file.filename):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Dosya türü desteklenmiyor.")
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Boş dosya.")
    if len(data) > _MAX_ASSET_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Dosya 50MB sınırını aşıyor.")
    return await store_service.set_digital_asset(
        db,
        product_id,
        data,
        original_name=file.filename,
        content_type=file.content_type,
        owner_tutor_id=tutor.id,
    )


# ── Sepet / sipariş (CLIENT) ─────────────────────────────────────────────────────


@router.post("/cart/validate", response_model=CartValidateOut)
async def validate_cart(
    payload: OrderCreate,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await order_service.validate_cart(
        db, payload.items, coupon_code=payload.coupon_code, client_id=client.id
    )


@router.post(
    "/orders",
    response_model=OrderOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_pay_limit)],
)
async def create_order(
    payload: OrderCreate,
    request: Request,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    phone_service.require_phone_verified(client)
    order, redirect_url = await order_service.create_order(
        db, client, payload, client_ip=request.client.host if request.client else None
    )
    order.redirect_url = redirect_url
    return order


@router.get("/orders/mine", response_model=list[OrderOut])
async def list_my_orders(
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await order_service.list_mine(db, client)


@router.get("/delivery-info", response_model=DeliveryInfoOut)
async def delivery_info(db: AsyncSession = Depends(get_db)):
    """Cıncık Teslimat sözü (public): şimdi sipariş verilirse teslim günü +
    bugünkü cutoff'a geri sayım. Söz günü KAPASİTE dahil hesaplanır
    (order_service.promised_date_for) — dolu gün 'bugün gelir' diye satılmaz;
    kapasite günü ileri attıysa geri sayım da gösterilmez (cutoff anlamsız)."""
    now = datetime.datetime.now(datetime.timezone.utc)
    cutoff_candidate = delivery_promise.compute_promised_date(
        now,
        cutoff_hour=settings.DELIVERY_CUTOFF_HOUR,
        non_working_weekdays=settings.DELIVERY_NON_WORKING_WEEKDAYS,
        utc_offset_hours=settings.APP_UTC_OFFSET_HOURS,
    )
    promised = await order_service.promised_date_for(db, now)
    countdown = (
        delivery_promise.cutoff_countdown_seconds(
            now,
            cutoff_hour=settings.DELIVERY_CUTOFF_HOUR,
            utc_offset_hours=settings.APP_UTC_OFFSET_HOURS,
        )
        if promised == cutoff_candidate
        else None
    )
    return DeliveryInfoOut(
        cutoff_hour=settings.DELIVERY_CUTOFF_HOUR,
        promised_date_now=promised,
        countdown_seconds=countdown,
        districts=settings.DELIVERY_ZONE_DISTRICTS,
    )


@router.get(
    "/orders/track/{token}",
    response_model=OrderTrackingOut,
    dependencies=[Depends(_track_limit)],
)
async def public_order_tracking(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Oturumsuz kargo takibi (SMS'le paylaşılan token). Kimlik doğrulama YOK —
    token tahmin edilemez; IP bazlı rate-limit brute-force'a karşı korur. Not:
    `/orders/{order_id}` (int) route'undan ÖNCE tanımlı (segment çakışması yok ama
    açık tutulur)."""
    return await delivery_service.order_tracking(db, track_token=token)


@router.post("/orders/track/{token}/delivery-pref", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(_track_limit)])
async def public_set_delivery_pref(
    token: str,
    payload: DeliveryPrefIn,
    db: AsyncSession = Depends(get_db),
):
    """Oturumsuz teslimat talimatı (token'lı takip sayfası). Token yetkisi
    sınırlıdır: bırakma tercihleri (KAPIYA/KOMSUYA) 403 — link sızarsa paket
    kapıya yönlendirilemesin; ADRES DEĞİŞİKLİĞİ de burada YOK (oturum gerekir)."""
    order = await order_service.get_order_by_track_token(db, token)
    await order_service.set_delivery_pref(
        db, order, pref=payload.pref, note=payload.note, from_public_token=True
    )


@router.post("/orders/track/{token}/postpone", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(_track_limit)])
async def public_postpone(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    order = await order_service.get_order_by_track_token(db, token)
    await order_service.postpone_delivery(db, order)


@router.post(
    "/orders/track/{token}/feedback",
    response_model=DeliveryFeedbackOut,
    dependencies=[Depends(_track_limit)],
)
async def public_delivery_feedback(
    token: str,
    payload: DeliveryFeedbackIn,
    db: AsyncSession = Depends(get_db),
):
    """Token'lı takip sayfasından teslim sonrası değerlendirme (Faz 7). Durum
    değiştirmez — yetki yükseltme değil; sipariş başına tek, IP rate-limit'li."""
    order = await order_service.get_order_by_track_token(db, token)
    return await delivery_feedback_service.create_feedback(
        db, order, payload, source="PUBLIC"
    )


@router.post("/orders/{order_id}/delivery-pref", response_model=OrderOut)
async def set_delivery_pref(
    order_id: int,
    payload: DeliveryPrefIn,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    order = await order_service.get_order_for_pay(db, order_id, client.id)
    await order_service.set_delivery_pref(db, order, pref=payload.pref, note=payload.note)
    return await order_service.get_order(db, order_id, client_id=client.id)


@router.post("/orders/{order_id}/postpone", response_model=OrderOut)
async def postpone_order(
    order_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    """"Yarına ertele" — açık durak RESCHEDULED olur, söz günü ileri alınır."""
    order = await order_service.get_order_for_pay(db, order_id, client.id)
    await order_service.postpone_delivery(db, order)
    return await order_service.get_order(db, order_id, client_id=client.id)


@router.post("/orders/{order_id}/ship-address", response_model=OrderOut)
async def change_order_address(
    order_id: int,
    payload: ShipAddressChangeIn,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    """Teslimat adresi değişikliği — yalnız dağıtıma çıkmadan; bölge dışına
    düşerse 409 OUT_OF_ZONE (force ile onay)."""
    order = await order_service.get_order_for_pay(db, order_id, client.id)
    return await order_service.change_ship_address(
        db, client, order, address_id=payload.address_id, force=payload.force
    )


@router.post("/orders/{order_id}/feedback", response_model=DeliveryFeedbackOut)
async def delivery_feedback(
    order_id: int,
    payload: DeliveryFeedbackIn,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    """Teslim sonrası değerlendirme (👍/👎 + yapısal sorun) — sipariş başına tek."""
    order = await order_service.get_order_for_pay(db, order_id, client.id)
    return await delivery_feedback_service.create_feedback(
        db, order, payload, source="CLIENT"
    )


@router.get("/orders/{order_id}/feedback", response_model=DeliveryFeedbackOut | None)
async def get_delivery_feedback(
    order_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    order = await order_service.get_order_for_pay(db, order_id, client.id)
    return await delivery_feedback_service.get_feedback_out(db, order.id)


@router.get("/orders/{order_id}/tracking", response_model=OrderTrackingOut)
async def order_tracking(
    order_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    """Kendi-filo teslimat canlı takibi: kurye konumu + sıra + tahmini varış."""
    return await delivery_service.order_tracking(
        db, order_id=order_id, client_id=client.id
    )


@router.get("/orders/{order_id}/invoice")
async def get_order_invoice(
    order_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    """Sipariş faturası — sunucu tarafı, e-Arşiv formatına HAZIR.

    Hiçbir dış servise (entegratöre) BAĞLI DEĞİLDİR ve resmî fatura numarası
    üretmez; ikisi de ayrı işlerdir. Belge, sipariş anında SAKLANMIŞ vergi
    kırılımından üretilir — ürünün bugünkü oranına bakmaz.

    `INVOICE_ENABLED` kapalıyken (üretim varsayılanı) 404 döner: uç, metinler
    mali müşavir onayından geçene kadar yok gibi davranır.

    `response_model` bilinçli olarak YOK: gövde saklanan kırılımın birebir
    aynasıdır ve araya bir şema koymak, kolonla şema arasında sessiz bir
    sapma penceresi açardı (F-4 node'u eşitliği kolon kolon ölçüyor).
    """
    return await invoice_service.build_invoice(db, order_id, client_id=client.id)


@router.get("/admin/tax-health")
async def tax_health(
    _admin: Admin = Depends(require_admin_permission("orders.view")),
    db: AsyncSession = Depends(get_db),
):
    """Vergi kırılımı EKSİK sipariş sayacı.

    `SHIPPING_TAX_RATE` girildikten sonra "kaç siparişte kırılım eksik kaldı"
    sorusunun cevabı gerekir; sayaç olmazsa bu küme sessizce birikir. İki
    eksiklik türü ayrı sayılır çünkü çareleri farklıdır: `missing_breakdown`
    tarihseldir (S-4 gereği düzeltilmez), `shipping_rate_undefined` ise ayar
    girilince YENİ siparişlerde kendiliğinden kapanır.
    """
    return await invoice_service.eksik_kirilim_sayisi(db)


@router.get("/orders/{order_id}", response_model=OrderOut)
async def get_my_order(
    order_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await order_service.get_order(db, order_id, client_id=client.id)


@router.post(
    "/orders/{order_id}/pay",
    response_model=OrderOut,
    dependencies=[Depends(_pay_limit)],
)
async def pay_order(
    order_id: int,
    request: Request,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    phone_service.require_phone_verified(client)
    order = await order_service.get_order_for_pay(db, order_id, client.id)
    _, redirect_url = await order_service.pay(
        db, order, client_ip=request.client.host if request.client else None
    )
    out = await order_service.get_order(db, order_id, client_id=client.id)
    out.redirect_url = redirect_url
    return out


@router.post("/orders/{order_id}/cancel", response_model=OrderOut)
async def cancel_my_order(
    order_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    order = await order_service.get_order_for_pay(db, order_id, client.id)
    return await order_service.cancel_by_client(db, order)


@router.post(
    "/orders/{order_id}/return",
    response_model=OrderReturnOut,
    status_code=status.HTTP_201_CREATED,
)
async def request_order_return(
    order_id: int,
    payload: OrderReturnCreate,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
    _rl: None = Depends(_return_limit),
):
    order = await order_service.get_order_for_pay(db, order_id, client.id)
    return await order_service.request_return(
        db,
        order,
        payload.reason,
        return_type=payload.type,
        items=payload.items,
        actor=client,
    )


# ── Ürün detayı + değerlendirme (en sonda — /{id_or_slug} catch-all) ─────────────


@router.get("/products/{id_or_slug}", response_model=ProductDetailOut)
async def get_product(id_or_slug: str, db: AsyncSession = Depends(get_db)):
    return await store_service.get_product_public(db, id_or_slug)


@router.get(
    "/products/{product_id}/reviews/distribution", response_model=RatingDistributionOut
)
async def product_review_distribution(
    product_id: int, db: AsyncSession = Depends(get_db)
):
    return await store_service.rating_distribution(db, product_id)


@router.get("/products/{product_id}/reviews", response_model=list[ProductReviewOut])
async def list_product_reviews(
    product_id: int,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    return await store_service.list_reviews(
        db, product_id=product_id, limit=limit, offset=offset
    )


@router.post(
    "/products/{product_id}/reviews",
    response_model=ProductReviewOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_review_limit)],
)
async def create_product_review(
    product_id: int,
    payload: ProductReviewCreate,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await store_service.create_review(db, client, product_id, payload)


@router.delete("/reviews/{review_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product_review(
    review_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    await store_service.delete_review(db, client, review_id)


@router.post(
    "/products/{product_id}/notify-me", status_code=status.HTTP_204_NO_CONTENT
)
async def notify_when_in_stock(
    product_id: int,
    payload: StockNotifyIn,
    db: AsyncSession = Depends(get_db),
):
    """Tükenen ürün için stok-bitince e-posta bildirimi aboneliği (public)."""
    await store_service.subscribe_back_in_stock(db, product_id, email=payload.email)


# ── Mağaza favorileri (kalp) — hesapla senkron ──────────────────────────────────


@router.get("/favorites", response_model=list[ProductSearchOut])
async def list_favorites(
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await store_service.list_favorites(db, client.id)


@router.put("/favorites/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def add_favorite(
    product_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    await store_service.add_favorite(db, client.id, product_id)


@router.delete("/favorites/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_favorite(
    product_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    await store_service.remove_favorite(db, client.id, product_id)


# ── Koleksiyon (Listelerim) ──────────────────────────────────────────────────────
# Not: /collections/shared/{token} public; /{collection_id} int olduğundan çakışma yok.


@router.get("/collections", response_model=list[CollectionOut])
async def list_collections(
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await collection_service.list_collections(db, client)


@router.post(
    "/collections",
    response_model=CollectionOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_collection(
    payload: CollectionCreate,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await collection_service.create_collection(db, client, payload.name)


@router.get("/collections/shared/{share_token}", response_model=CollectionDetailOut)
async def get_shared_collection(
    share_token: str,
    db: AsyncSession = Depends(get_db),
):
    """Public paylaşım görünümü (auth yok)."""
    return await collection_service.get_shared(db, share_token)


@router.get("/collections/{collection_id}", response_model=CollectionDetailOut)
async def get_collection(
    collection_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await collection_service.get_collection(db, client, collection_id)


@router.patch("/collections/{collection_id}", response_model=CollectionOut)
async def rename_collection(
    collection_id: int,
    payload: CollectionUpdate,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await collection_service.rename_collection(
        db, client, collection_id, payload.name
    )


@router.delete(
    "/collections/{collection_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_collection(
    collection_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    await collection_service.delete_collection(db, client, collection_id)


@router.post("/collections/{collection_id}/items", response_model=CollectionOut)
async def add_collection_item(
    collection_id: int,
    payload: CollectionItemAdd,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await collection_service.add_item(
        db, client, collection_id, payload.product_id
    )


@router.delete(
    "/collections/{collection_id}/items/{product_id}",
    response_model=CollectionOut,
)
async def remove_collection_item(
    collection_id: int,
    product_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await collection_service.remove_item(
        db, client, collection_id, product_id
    )


# ══════════════════ Stok hareket defteri — SALT OKUNUR ══════════════════
#
# Defter append-only'dir: hareket oluşturma/düzenleme/silme ucu YOKTUR ve
# yazılmamalıdır. Hareketler yalnız iş akışlarının (ödeme, iptal, iade, ürün
# oluşturma, admin düzeltmesi) yan etkisi olarak doğar; DB trigger'ı UPDATE ve
# DELETE'i zaten reddeder. Buradaki uçlar teşhis ve görünürlük içindir —
# **hiçbiri veriyi düzeltmez**.
#
# İzin: mevcut `products.view`. Bu pakette `inventory.*` izinleri EKLENMEZ —
# kimseye verilmemiş bir izin kodu bu kod tabanında sessiz 403 üretir; envanter
# izinleri tam envanter modülüyle, rollerle birlikte gelecek.


def _movement_out(row) -> StockMovementOut:
    m = row.movement
    return StockMovementOut(
        id=m.id,
        product_id=m.product_id,
        sku=row.sku,
        product_title=row.product_title,
        qty_delta=m.qty_delta,
        qty_after=m.qty_after,
        movement_type=m.movement_type,
        reason_code=m.reason_code,
        ref_type=m.ref_type,
        ref_id=m.ref_id,
        ref_line_id=m.ref_line_id,
        actor_type=m.actor_type,
        actor_id=m.actor_id,
        note=m.note,
        created_at=m.created_at,
    )


def _verification_out(v) -> LedgerVerificationOut:
    return LedgerVerificationOut(
        consistent=v.consistent,
        product_id=v.product_id,
        sku=v.sku,
        product_title=v.product_title,
        current_stock=v.current_stock,
        ledger_stock=v.ledger_stock,
        movement_count=v.movement_count,
        first_divergent_id=v.first_divergent_id,
        problems=[LedgerProblemOut(**dataclasses.asdict(pr)) for pr in v.problems],
        tracked=v.current_stock is not None,
    )


@router.get("/admin/products/{product_id}/stock-movements", response_model=StockMovementPageOut)
async def product_stock_movements(
    product_id: int,
    _admin: Admin = Depends(require_admin_permission("products.view")),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(50, ge=1, le=stock_ledger.LIST_MAX_LIMIT),
    offset: int = Query(0, ge=0),
    movement_type: str | None = Query(None, max_length=20),
    reason_code: str | None = Query(None, max_length=30),
    actor_type: str | None = Query(None, max_length=10),
    actor_id: int | None = Query(None, ge=1),
    ref_type: str | None = Query(None, max_length=20),
    ref_id: int | None = Query(None, ge=1),
    date_from: datetime.datetime | None = Query(None),
    date_to: datetime.datetime | None = Query(None),
):
    """Bir ürünün defter geçmişi (en yeni önce, sayfalı)."""
    sayfa = await stock_ledger.list_movements(
        db,
        product_id=product_id,
        movement_type=movement_type,
        reason_code=reason_code,
        actor_type=actor_type,
        actor_id=actor_id,
        ref_type=ref_type,
        ref_id=ref_id,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
    )
    return StockMovementPageOut(
        rows=[_movement_out(r) for r in sayfa.rows],
        total=sayfa.total,
        limit=limit,
        offset=offset,
    )


@router.get("/admin/stock-movements", response_model=StockMovementPageOut)
async def all_stock_movements(
    _admin: Admin = Depends(require_admin_permission("products.view")),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(50, ge=1, le=stock_ledger.LIST_MAX_LIMIT),
    offset: int = Query(0, ge=0),
    product_id: int | None = Query(None, ge=1),
    sku: str | None = Query(None, max_length=20),
    movement_type: str | None = Query(None, max_length=20),
    reason_code: str | None = Query(None, max_length=30),
    actor_type: str | None = Query(None, max_length=10),
    actor_id: int | None = Query(None, ge=1),
    ref_type: str | None = Query(None, max_length=20),
    ref_id: int | None = Query(None, ge=1),
    date_from: datetime.datetime | None = Query(None),
    date_to: datetime.datetime | None = Query(None),
):
    """Tüm defter (envanter hareketleri tablosu) — sayfalı ve filtreli."""
    sayfa = await stock_ledger.list_movements(
        db,
        product_id=product_id,
        sku=sku,
        movement_type=movement_type,
        reason_code=reason_code,
        actor_type=actor_type,
        actor_id=actor_id,
        ref_type=ref_type,
        ref_id=ref_id,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
    )
    return StockMovementPageOut(
        rows=[_movement_out(r) for r in sayfa.rows],
        total=sayfa.total,
        limit=limit,
        offset=offset,
    )


@router.get("/admin/products/{product_id}/stock-verify", response_model=LedgerVerificationOut)
async def product_stock_verify(
    product_id: int,
    _admin: Admin = Depends(require_admin_permission("products.view")),
    db: AsyncSession = Depends(get_db),
):
    """Tek ürünün defter doğrulaması. **Hiçbir şeyi düzeltmez.**"""
    try:
        sonuc = await stock_ledger.verify_ledger(db, product_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return _verification_out(sonuc)


@router.get("/admin/stock-verify", response_model=LedgerAuditOut)
async def ledger_verify(
    _admin: Admin = Depends(require_admin_permission("products.view")),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(50, ge=1, le=stock_ledger.AUDIT_MAX_LIMIT),
    offset: int = Query(0, ge=0),
):
    """Defterin SAYFALI genel doğrulaması.

    Sınırsız tam tarama yoktur: her istek en fazla `AUDIT_MAX_LIMIT` ürüne
    bakar ve `next_offset` ile sonraki sayfayı söyler. Sayfa içi denetim sabit
    sayıda toplu sorguya indirgenmiştir (ürün başına sorgu YOK).

    **Hiçbir şeyi düzeltmez** — bulgu, düzeltme butonuna dönüştürülmez; sayım
    ve düzeltme ayrı bir pakettir.
    """
    sonuc = await stock_ledger.audit_ledger(db, limit=limit, offset=offset)
    return LedgerAuditOut(
        checked=sonuc.checked,
        inconsistent=sonuc.inconsistent,
        problems=[LedgerProblemOut(**dataclasses.asdict(pr)) for pr in sonuc.problems],
        next_offset=sonuc.next_offset,
        limit=limit,
        offset=offset,
    )
