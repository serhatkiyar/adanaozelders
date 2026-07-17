from __future__ import annotations

import csv
import datetime
import io
from decimal import Decimal

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_roles, user_rate_limit
from core import storage
from core.config import settings
from core.ratelimit import rate_limit
from core.database import get_db
from models.admin import Admin
from models.client import Client
from models.role import RoleType
from models.tutor import Tutor
from schemas.review import RatingDistributionOut
from schemas.store import (
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
)
from schemas.delivery import (
    DeliveryInfoOut,
    DeliveryPrefIn,
    OrderTrackingOut,
    ShipAddressChangeIn,
)
from services import (
    collection_service,
    coupon_service,
    delivery_promise,
    delivery_service,
    order_service,
    phone_service,
    store_service,
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


@router.get("/categories", response_model=list[ProductCategoryOut])
async def list_categories(db: AsyncSession = Depends(get_db)):
    return await store_service.list_categories(db)


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
    sort: str | None = Query(
        default=None, pattern="^(price_asc|price_desc|newest|rating)$"
    ),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    return await store_service.search_products(
        db,
        q=q,
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
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await store_service.list_products_admin(db, limit=limit, offset=offset)


@router.post("/admin/products/bulk", response_model=BulkImportResultOut)
async def bulk_import_products(
    file: UploadFile = File(...),
    admin: Admin = Depends(require_roles(RoleType.ADMIN)),
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
    return await store_service.bulk_import_products(db, admin, rows)


@router.get("/admin/products/{product_id}", response_model=ProductDetailOut)
async def get_product_admin(
    product_id: int,
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await store_service.get_product_admin(db, product_id)


@router.post(
    "/admin/products", response_model=ProductDetailOut, status_code=status.HTTP_201_CREATED
)
async def create_product(
    payload: ProductCreate,
    admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await store_service.create_product(db, admin, payload)


@router.patch("/admin/products/{product_id}", response_model=ProductDetailOut)
async def update_product(
    product_id: int,
    payload: ProductUpdate,
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await store_service.update_product(db, product_id, payload)


@router.delete("/admin/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(
    product_id: int,
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    await store_service.delete_product(db, product_id)


@router.post("/admin/products/{product_id}/cover", response_model=ProductDetailOut)
async def upload_product_cover(
    product_id: int,
    file: UploadFile = File(...),
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await store_service.set_cover(db, product_id, await _read_image(file))


@router.post("/admin/products/{product_id}/images", response_model=ProductDetailOut)
async def upload_product_images(
    product_id: int,
    files: list[UploadFile] = File(...),
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    if not files:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "En az bir görsel seçin.")
    blobs = [await _read_image(f) for f in files]
    return await store_service.add_images(db, product_id, blobs)


@router.delete(
    "/admin/products/{product_id}/images/{image_id}", response_model=ProductDetailOut
)
async def delete_product_image(
    product_id: int,
    image_id: int,
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await store_service.delete_image(db, product_id, image_id)


@router.post(
    "/admin/categories",
    response_model=ProductCategoryOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_category(
    payload: ProductCategoryCreate,
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await store_service.create_category(db, payload)


@router.patch("/admin/categories/{category_id}", response_model=ProductCategoryOut)
async def update_category(
    category_id: int,
    payload: ProductCategoryUpdate,
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await store_service.update_category(db, category_id, payload)


@router.delete(
    "/admin/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_category(
    category_id: int,
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    await store_service.delete_category(db, category_id)


# ── Admin: sipariş yönetimi ──────────────────────────────────────────────────────


@router.get("/admin/orders", response_model=list[OrderOut])
async def list_orders_admin(
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await order_service.list_orders_admin(
        db, status_filter=status_filter, limit=limit, offset=offset
    )


@router.post("/admin/orders/{order_id}/ship", response_model=OrderOut)
async def ship_order(
    order_id: int,
    payload: OrderShipIn,
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await order_service.mark_shipped(db, order_id, tracking_no=payload.tracking_no)


@router.post("/admin/orders/{order_id}/deliver", response_model=OrderOut)
async def deliver_order(
    order_id: int,
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await order_service.mark_delivered(db, order_id)


@router.post("/admin/orders/{order_id}/refund", response_model=OrderOut)
async def refund_order(
    order_id: int,
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await order_service.refund_order(db, order_id)


# ── İade talepleri (RMA) yönetimi (ADMIN) ────────────────────────────────────────


@router.get("/admin/returns", response_model=list[OrderReturnOut])
async def list_returns_admin(
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await order_service.list_returns_admin(
        db, status_filter=status_filter, limit=limit, offset=offset
    )


@router.post("/admin/returns/{return_id}/approve", response_model=OrderReturnOut)
async def approve_return(
    return_id: int,
    payload: OrderReturnResolve,
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await order_service.approve_return(db, return_id, admin_note=payload.admin_note)


@router.post("/admin/returns/{return_id}/reject", response_model=OrderReturnOut)
async def reject_return(
    return_id: int,
    payload: OrderReturnResolve,
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await order_service.reject_return(db, return_id, admin_note=payload.admin_note)


# ── Kupon yönetimi (ADMIN) ───────────────────────────────────────────────────────


@router.get("/admin/coupons", response_model=list[CouponOut])
async def list_coupons(
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await coupon_service.list_coupons(db)


@router.post(
    "/admin/coupons", response_model=CouponOut, status_code=status.HTTP_201_CREATED
)
async def create_coupon(
    payload: CouponCreate,
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await coupon_service.create_coupon(db, payload)


@router.patch("/admin/coupons/{coupon_id}", response_model=CouponOut)
async def update_coupon(
    coupon_id: int,
    payload: CouponUpdate,
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await coupon_service.update_coupon(db, coupon_id, payload)


@router.delete("/admin/coupons/{coupon_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_coupon(
    coupon_id: int,
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    await coupon_service.delete_coupon(db, coupon_id)


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
    """Oturumsuz teslimat talimatı (token'lı takip sayfası). Davranışsal tercihler
    serbest — mal aynı adrese gider; ADRES DEĞİŞİKLİĞİ burada YOK (oturum gerekir)."""
    order = await order_service.get_order_by_track_token(db, token)
    await order_service.set_delivery_pref(db, order, pref=payload.pref, note=payload.note)


@router.post("/orders/track/{token}/postpone", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(_track_limit)])
async def public_postpone(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    order = await order_service.get_order_by_track_token(db, token)
    await order_service.postpone_delivery(db, order)


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
):
    order = await order_service.get_order_for_pay(db, order_id, client.id)
    return await order_service.request_return(db, order, payload.reason)


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
