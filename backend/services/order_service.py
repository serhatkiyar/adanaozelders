"""Mağaza sipariş + ödeme iş mantığı (doğrudan satış — escrow DEĞİL).

Akış: sepet → sunucu fiyat/stok doğrular → PENDING sipariş + charge → fake'te anında
PAID, iyzico'da redirect_url + callback ``complete_checkout``. PAID olunca: dijital
teslim açılır, fiziksel stok düşer, eğitmen dijital kalemlerinin payı (komisyon
düşülerek) hesaplanıp kazanca yazılır (Balance sayfası ``payment_service`` ile birleştirir).

``compute_totals`` saf fonksiyondur (pytest'li).
"""
from __future__ import annotations

import dataclasses
import datetime
import logging
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core import outbox, payments
from core.config import settings
from models.admin import Admin
from models.client import Client, ClientAddress
from models.delivery import (
    DeliveryRun,
    DeliveryRunStatus,
    DeliveryStop,
    DeliveryStopStatus,
)
from models.store import (
    DeliveryPref,
    Order,
    OrderItem,
    OrderPaymentStatus,
    OrderReturn,
    OrderReturnItem,
    Product,
    ProductKind,
    ProductStatus,
    ReturnRefundStatus,
    ReturnStatus,
    SellerType,
)
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from schemas.store import (
    CartValidateOut,
    OrderCreate,
    OrderItemOut,
    OrderOut,
    OrderReturnItemOut,
    OrderReturnOut,
)
from services import (
    audit_service,
    commission,
    coupon_service,
    delivery_calendar,
    delivery_promise,
    escrow,
    notification_service,
    order_fsm,
    packing_events,
    payment_gates,
    returns,
    stock_ledger,
    tax,
)

logger = logging.getLogger("adana.order")


@dataclasses.dataclass(frozen=True, slots=True)
class _SistemAktoru:
    """Aktörü insan olmayan denetim satırları için (`audit_service.record`
    yalnız `id` ve `role_id` okur).

    Otomatik telafi/mutabakat kararlarının da denetim izi olmalıdır; aksi hâlde
    "bu iade neden böyle sonuçlandı" sorusunun cevabı yalnız log satırında kalır.
    `actor_id=0` bilinçli: hiçbir gerçek admin satırıyla çakışmaz.
    """

    id: int = 0
    role_id: int = ROLE_IDS[RoleType.ADMIN]


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


#: Söz motoru en çok kaç gün ileriye bakar (cutoff + kapasite max_days + tatil
#: tamponu). Kapalı gün penceresi bu genişlikte yüklenir.
_PROMISE_LOOKAHEAD_DAYS = 45


async def _closed_dates_from(
    db: AsyncSession, start: datetime.date
) -> frozenset[datetime.date]:
    """Söz penceresi için kapalı günleri yükle (admin takvimi)."""
    return await delivery_calendar.load_closed_dates(
        db, start=start, end=start + datetime.timedelta(days=_PROMISE_LOOKAHEAD_DAYS)
    )


# Teslimden sonra iade talebi penceresi (mesafeli satış cayma hakkı — 14 gün).
RETURN_WINDOW_DAYS = 14


def _return_deadline(order: Order) -> datetime.datetime | None:
    """Teslim edilmiş siparişin son iade tarihi (teslim + pencere). Teslim
    damgası yoksa (dijital/eski sipariş) None."""
    if order.delivered_at is None:
        return None
    return order.delivered_at + datetime.timedelta(days=RETURN_WINDOW_DAYS)


async def _email_order(db: AsyncSession, order: Order, status: str) -> None:
    """Sipariş durumu e-postasını outbox'lar (çağıranın transaction'ında —
    gönderim + retry worker'da; durum değişikliğiyle atomik)."""
    client = await db.get(Client, order.client_id)
    if client is None or not getattr(client, "email", None):
        return
    outbox.enqueue(
        db,
        "email:order_status",
        {
            "to": client.email,
            "name": client.full_name,
            "order_id": order.id,
            "status": status,
            "total": str(order.total),
            "currency": order.currency,
            "orders_url": f"{settings.FRONTEND_BASE_URL.rstrip('/')}/siparislerim",
        },
    )


#: pg_advisory_xact_lock anahtarı — söz kontenjanı SAYIMI + ATAMASI bu kilit
#: altında yapılır ki eşzamanlı ödemeler serileşsin: son slotu iki sipariş aynı
#: anda sayıp ikisi de aynı güne söz alamaz (overbooking). Kilit transaction
#: sonunda (commit/rollback) otomatik bırakılır; salt-okur rozet ucu KİLİTSİZDİR.
PROMISE_LOCK_KEY = 0x5AD001


async def _lock_promise_counter(db: AsyncSession) -> None:
    await db.execute(
        text("SELECT pg_advisory_xact_lock(:k)"), {"k": PROMISE_LOCK_KEY}
    )


def attempts_exhausted(failed_count: int) -> bool:
    """Üç-deneme kuralı: bu başarısızlık sayısı tavana ulaştı mı? Ulaştıysa
    sipariş otomatik yeniden kuyruğa GİRMEZ, operatör istisna kuyruğuna düşer
    (sonsuz PAID↔FAILED engeli). Tavan 0 ise kural kapalı (sınırsız)."""
    cap = settings.DELIVERY_MAX_DELIVERY_ATTEMPTS
    return cap > 0 and failed_count >= cap


def roll_promise_after_failed_attempt(
    order: Order,
    closed_dates: frozenset[datetime.date] = frozenset(),
) -> bool:
    """Teslim denemesi KURYE/SİSTEM kaynaklı başarısız oldu: söz borcu yeni
    satıştan önce gelir (PDS B7) — söz, ertesi çalışma gününe KAPASİTE
    KONTROLSÜZ yazılır (retry dolu günle ötelenmez; sayımda görünür ve yeni
    satışın kontenjanını daraltır) ve başarısızlık sayacı artar (üç-deneme
    kuralı [Faz 5] + ilk-denemede-teslim KPI'ı bu sayaçtan beslenir).
    Müşteri ertelemesi (RESCHEDULED) bu yoldan GEÇMEZ.

    Dönüş: yeniden kuyruğa girdi mi (True) yoksa deneme hakkı bitip istisna
    kuyruğuna mı düştü (False). Tavana ulaşınca söz günü İLERLEMEZ (son söz
    günü işaretli kalır) ve paket depoda kalır ama hazırlanmamış — operatör
    kararına (teslim-alma / iptal+iade) kadar eligible olmaz."""
    order.failed_delivery_count += 1
    # Paket depoya geri döndü: hazırlık damgası düşer.
    order.prepared_at = None
    order.prepared_by = None
    if attempts_exhausted(order.failed_delivery_count):
        # Deneme hakkı bitti — otomatik yeniden söz VERİLMEZ; istisna kuyruğu
        # (eligible/prep sorguları failed_delivery_count tavanını hariç tutar).
        return False
    order.promised_delivery_date = delivery_promise.next_delivery_day(
        _now(),
        non_working_weekdays=settings.DELIVERY_NON_WORKING_WEEKDAYS,
        utc_offset_hours=settings.APP_UTC_OFFSET_HOURS,
        closed_dates=closed_dates,
    )
    return True


async def _first_capacity_day(db: AsyncSession, candidate: datetime.date) -> datetime.date:
    """``candidate``'tan ileri, günlük söz kontenjanı (DELIVERY_DAILY_CAPACITY)
    dolmamış ilk çalışma günü. Kontenjanı yalnız bölge-içi, açık (PAID/SHIPPED)
    fiziksel siparişlerin söz günleri tüketir."""
    if settings.DELIVERY_DAILY_CAPACITY <= 0:
        return candidate
    rows = (
        await db.execute(
            select(Order.promised_delivery_date, func.count())
            .where(
                Order.deleted_at.is_(None),
                Order.has_physical.is_(True),
                Order.ship_in_zone.is_(True),
                Order.status.in_(("PAID", "SHIPPED")),
                Order.promised_delivery_date >= candidate,
            )
            .group_by(Order.promised_delivery_date)
        )
    ).all()
    booked = {day: int(count) for day, count in rows}
    return delivery_promise.first_day_with_capacity(
        candidate,
        booked,
        capacity=settings.DELIVERY_DAILY_CAPACITY,
        non_working_weekdays=settings.DELIVERY_NON_WORKING_WEEKDAYS,
        closed_dates=await _closed_dates_from(db, candidate),
    )


async def promised_date_for(db: AsyncSession, paid_at_utc: datetime.datetime) -> datetime.date:
    """Ödeme anına göre söz günü — cutoff kuralı + kapasite kontrolü birlikte.
    Hem sipariş kesinleşmesi (_finalize_paid) hem public /store/delivery-info
    rozeti bunu kullanır (rozet dolu günü 'bugün gelir' diye satamaz)."""
    local_today = (paid_at_utc + datetime.timedelta(hours=settings.APP_UTC_OFFSET_HOURS)).date()
    candidate = delivery_promise.compute_promised_date(
        paid_at_utc,
        cutoff_hour=settings.DELIVERY_CUTOFF_HOUR,
        non_working_weekdays=settings.DELIVERY_NON_WORKING_WEEKDAYS,
        utc_offset_hours=settings.APP_UTC_OFFSET_HOURS,
        closed_dates=await _closed_dates_from(db, local_today),
    )
    return await _first_capacity_day(db, candidate)


def compute_shipping(subtotal: Decimal, has_physical: bool) -> Decimal:
    """Eşikli ücretsiz kargo: dijital-yalnız → 0; fiziksel + eşik üstü → 0; aksi sabit ücret."""
    if not has_physical:
        return Decimal("0.00")
    if subtotal >= Decimal(str(settings.SHIPPING_FREE_THRESHOLD)):
        return Decimal("0.00")
    return Decimal(str(settings.SHIPPING_FLAT_FEE)).quantize(Decimal("0.01"))


def compute_totals(
    lines: list[dict],
) -> tuple[Decimal, Decimal, Decimal, bool]:
    """(subtotal, shipping_fee, total, has_physical) — saf, test edilebilir.

    Her satır: ``{"unit_price": Decimal, "quantity": int, "kind": str}``.
    Fiziksel kalem varsa eşikli kargo (``compute_shipping``) eklenir.
    """
    subtotal = Decimal("0.00")
    has_physical = False
    for ln in lines:
        subtotal += Decimal(str(ln["unit_price"])) * int(ln["quantity"])
        if ln["kind"] == ProductKind.PHYSICAL.value:
            has_physical = True
    subtotal = subtotal.quantize(Decimal("0.01"))
    shipping = compute_shipping(subtotal, has_physical)
    total = (subtotal + shipping).quantize(Decimal("0.01"))
    return subtotal, shipping, total, has_physical


# ── Sepet doğrulama / sipariş kurulumu ───────────────────────────────────────────


async def _resolve_lines(db: AsyncSession, items: list) -> tuple[list[dict], list[str]]:
    """Sepet kalemlerini DB'deki güncel ürünlerle eşler; fiyat/stok/uygunluğu
    sunucuda doğrular. (satırlar, sorunlar) döner — fiyat istemciye GÜVENİLMEZ."""
    issues: list[str] = []
    lines: list[dict] = []
    # Aynı ürün birden çok satırda gelirse miktarları birleştir.
    wanted: dict[int, int] = {}
    for it in items:
        wanted[it.product_id] = wanted.get(it.product_id, 0) + it.quantity

    if not wanted:
        return lines, ["Sepet boş"]

    products = (
        await db.execute(
            select(Product).where(
                Product.id.in_(list(wanted.keys())),
                Product.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    by_id = {p.id: p for p in products}

    for pid, qty in wanted.items():
        p = by_id.get(pid)
        if p is None or p.status != ProductStatus.ACTIVE.value:
            issues.append("Bir ürün artık satışta değil")
            continue
        if p.kind == ProductKind.PHYSICAL.value and (p.stock or 0) < qty:
            issues.append(f"'{p.title}' için yeterli stok yok")
            continue
        lines.append(
            {
                "product": p,
                "product_id": p.id,
                "title": p.title,
                "unit_price": Decimal(str(p.price)),
                "quantity": qty,
                "kind": p.kind,
                "seller_type": p.seller_type,
                "tutor_id": p.tutor_id,
                # KDV oranı sipariş anında snapshot'lanır: ürünün oranı sonradan
                # değişse bile fatura sipariş anındaki oranla kesilmelidir.
                "tax_rate": Decimal(str(p.tax_rate or 0)),
                "digital_asset_key": p.digital_asset_key,
                "digital_asset_name": p.digital_asset_name,
            }
        )
    return lines, issues


async def validate_cart(
    db: AsyncSession,
    items: list,
    *,
    coupon_code: str | None = None,
    client_id: int | None = None,
) -> CartValidateOut:
    lines, issues = await _resolve_lines(db, items)
    subtotal, shipping, _total, has_physical = compute_totals(lines)

    # Kupon (varsa): geçersizse sepeti bozma — coupon_error ile bildir, indirim 0.
    discount = Decimal("0.00")
    applied_code: str | None = None
    coupon_error: str | None = None
    if coupon_code and lines and client_id is not None:
        try:
            coupon, discount = await coupon_service.evaluate(
                db, code=coupon_code, subtotal=subtotal, client_id=client_id
            )
            applied_code = coupon.code
        except HTTPException as exc:
            discount = Decimal("0.00")
            coupon_error = str(exc.detail)

    total = (subtotal - discount + shipping).quantize(Decimal("0.01"))

    # Kapalı ödeme kolları: checkout'ta 503 görmek yerine sepette öğrenilsin.
    blocked = await payment_gates.blocked_branches_for_seller_types(
        db, [ln["seller_type"] for ln in lines]
    )
    if blocked:
        issues = list(issues) + [
            payment_gates.BRANCH_CLOSED_MESSAGE[payment_gates.PaymentBranch(b)]
            for b in blocked
        ]

    return CartValidateOut(
        items=[
            OrderItemOut(
                id=0,
                product_id=ln["product_id"],
                title=ln["title"],
                cover_url=ln["product"].cover_url,
                unit_price=str(ln["unit_price"]),
                quantity=ln["quantity"],
                kind=ln["kind"],
                seller_type=ln["seller_type"],
            )
            for ln in lines
        ],
        subtotal=str(subtotal),
        shipping_fee=str(shipping),
        discount=str(discount),
        coupon_code=applied_code,
        coupon_error=coupon_error,
        total=str(total),
        currency=settings.PAYMENT_CURRENCY,
        has_physical=has_physical,
        issues=issues,
        blocked_payment_branches=blocked,
    )


async def create_order(
    db: AsyncSession, client: Client, payload: OrderCreate, *, client_ip: str | None = None
) -> tuple[OrderOut, str | None]:
    """Sipariş oluştur + charge. (OrderOut, redirect_url) döner; fake sağlayıcıda
    redirect_url None ve sipariş PAID'dir."""
    lines, issues = await _resolve_lines(db, payload.items)
    if issues:
        raise HTTPException(status.HTTP_409_CONFLICT, "; ".join(issues))
    if not lines:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Sepet boş")

    # Ödeme kolu kapısı: karışık sepet (platform malı + eğitmen dijital ürünü)
    # HER İKİ kolun da açık olmasını ister. `validate_cart` bunu ödeme
    # denemesinden önce zaten raporlar; burası son savunma.
    await payment_gates.assert_cart_branches_open(
        db, [ln["seller_type"] for ln in lines]
    )

    subtotal, shipping, _total, has_physical = compute_totals(lines)

    # Kupon (varsa): geçersizse 4xx — sipariş kurulmaz (validate önceden uyarır).
    discount = Decimal("0.00")
    coupon_id: int | None = None
    coupon_code: str | None = None
    if payload.coupon_code:
        coupon, discount = await coupon_service.evaluate(
            db, code=payload.coupon_code, subtotal=subtotal, client_id=client.id
        )
        coupon_id = coupon.id
        coupon_code = coupon.code

    total = (subtotal - discount + shipping).quantize(Decimal("0.01"))

    order = Order(
        client_id=client.id,
        status="PENDING",
        payment_status="PENDING",
        subtotal=subtotal,
        shipping_fee=shipping,
        discount=discount,
        coupon_id=coupon_id,
        coupon_code=coupon_code,
        total=total,
        currency=settings.PAYMENT_CURRENCY,
        has_physical=has_physical,
    )

    if has_physical:
        if payload.address_id is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Fiziksel ürün için teslimat adresi gerekli"
            )
        addr = await db.get(ClientAddress, payload.address_id)
        if addr is None or addr.deleted_at is not None or addr.client_id != client.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Adres bulunamadı")
        # Adresteki alıcı/telefon öncelikli (adres başkası adına olabilir);
        # boşsa hesap sahibine düşülür.
        order.ship_recipient = addr.recipient_name or client.full_name
        order.ship_phone = addr.phone or client.phone
        order.ship_address = addr.address_line
        if addr.directions:
            order.ship_address = f"{addr.address_line}\n{addr.directions}"
        order.ship_city = addr.city
        order.ship_district = addr.district
        # Harita pin'i teslimat rotasının otoritesidir (adres metni tarif).
        order.ship_lat = addr.location_lat
        order.ship_lng = addr.location_lng
        order.ship_in_zone = delivery_promise.in_delivery_zone(
            addr.location_lat,
            addr.location_lng,
            addr.city,
            addr.district,
            depot_lat=settings.DELIVERY_DEPOT_LAT,
            depot_lng=settings.DELIVERY_DEPOT_LNG,
            radius_km=settings.DELIVERY_ZONE_RADIUS_KM,
            districts=settings.DELIVERY_ZONE_DISTRICTS,
        )

    for ln in lines:
        order.items.append(
            OrderItem(
                product_id=ln["product_id"],
                title=ln["title"],
                cover_url=ln["product"].cover_url,
                unit_price=ln["unit_price"],
                quantity=ln["quantity"],
                kind=ln["kind"],
                seller_type=ln["seller_type"],
                tutor_id=ln["tutor_id"],
                # Fatura için vergi snapshot'ı (fiyat KDV dahildir; tax_amount
                # o tutarın İÇİNDEKİ vergidir — bkz. services/tax.py).
                tax_rate=ln.get("tax_rate") or Decimal("0"),
                tax_amount=tax.line_tax(
                    ln["unit_price"], ln["quantity"], ln.get("tax_rate") or Decimal("0")
                ),
                digital_asset_key=ln["digital_asset_key"],
                digital_asset_name=ln["digital_asset_name"],
            )
        )
    db.add(order)
    await db.flush()  # order.id

    redirect_url = await _charge(db, order, client, client_ip=client_ip)
    await db.commit()
    return await get_order(db, order.id, client_id=client.id), redirect_url


async def _charge(
    db: AsyncSession, order: Order, client: Client, *, client_ip: str | None
) -> str | None:
    provider = payments.get_payment_provider()
    result = await provider.charge(
        amount=Decimal(str(order.total)),
        currency=order.currency,
        booking_id=order.id,
        description=f"Adana Ozel Ders Magaza #{order.id}",
        reference=f"order:{order.id}",
        buyer=payments.buyer_from_client(client, ip=client_ip),
    )
    order.provider = provider.name
    if result.redirect_url:
        order.provider_ref = result.provider_ref
        return result.redirect_url
    if not result.success:
        order.payment_status = "FAILED"
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED, result.error or "Ödeme başarısız"
        )
    await _finalize_paid(db, order, provider_ref=result.provider_ref)
    return None


async def pay(
    db: AsyncSession, order: Order, *, client_ip: str | None = None
) -> tuple[Order, str | None]:
    """Ödenmemiş siparişi yeniden ödemeye çalış (idempotent)."""
    if order.payment_status == "PAID":
        return order, None
    if order.payment_status == "REFUNDED":
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu sipariş iade edilmiş")
    if order.status == "CANCELLED":
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu sipariş iptal edilmiş")
    # Sipariş kurulduktan sonra kol kapanmış olabilir — yeniden ödeme denemesi de
    # kapıdan geçer (kalemler siparişte snapshot'lı).
    await payment_gates.assert_cart_branches_open(
        db, [it.seller_type for it in (order.items or [])]
    )
    client = await db.get(Client, order.client_id)
    redirect_url = await _charge(db, order, client, client_ip=client_ip)
    await db.commit()
    return order, redirect_url


async def complete_checkout(
    db: AsyncSession,
    *,
    order_id: int,
    success: bool,
    provider_ref: str | None,
    token: str | None = None,
    paid_price: Decimal | None = None,
) -> Order | None:
    """iyzico callback'i sunucuda doğrulandıktan sonra siparişi kesinleştirir.

    Ders/bilet/rezervasyon yollarıyla AYNI sertleştirmelere tabidir
    (bkz. ``payment_service.complete_checkout``):

    C3 doğrulamaları (yalnız verildiğinde):
    - ``token`` saklı CF token'ı ile eşleşmeli — eşleşmiyorsa bu başka (eski ya da
      ikinci) bir checkout oturumunun tahsilatıdır: siparişe DOKUNULMAZ, para
      aynen iade edilir. Önceden bu para sessizce yutuluyordu: müşteri iki kez
      ödeyebiliyor, ikinci tahsilat ne emanete alınıyor ne iade ediliyordu.
    - ``paid_price`` sipariş toplamına eşit olmalı — değilse kesinleştirilmez.

    PENDING/FAILED → PAID geçişi ``_finalize_paid`` içinde **atomik claim** ile
    yapılır; eşzamanlı iki callback'ten yalnız biri stok düşer ve kupon harcar.
    """
    order = await _load_full(db, order_id)
    if order is None:
        return None
    # İdempotent: replay'ler token kontrolünden ÖNCE düşer (yeniden iade denenmesin).
    if order.payment_status in ("PAID", "REFUNDING", "REFUNDED"):
        return order

    order_total = Decimal(str(order.total))
    if success and token and order.provider_ref and token != order.provider_ref:
        await escrow.refund_unexpected_charge(
            provider_ref=provider_ref,
            amount=paid_price if paid_price is not None else order_total,
            context=f"token uyuşmazlığı order={order_id}",
        )
        return order
    if success and paid_price is not None and paid_price != order_total:
        await escrow.refund_unexpected_charge(
            provider_ref=provider_ref,
            amount=paid_price,
            context=(
                f"paidPrice uyuşmazlığı order={order_id} "
                f"(beklenen {order_total}, tahsil {paid_price})"
            ),
        )
        return order

    # ── Ölü varlık: sipariş bu arada iptal/iade edildi (İP-2b R10) ──
    #
    # `complete_checkout` sipariş YAŞAM DÖNGÜSÜNE hiç bakmıyordu: müşteri iyzico
    # sayfasındayken siparişi iptal ederse, doğrulanmış tahsilat yine
    # `_finalize_paid`'e giriyor, atomik PAID claim'i başarılı oluyor ve FSM
    # `CANCELLED→PAID` geçişini 409 ile reddediyordu. İstisna callback/reconciler
    # katmanında yakalanmadığı için: para tahsil edilmiş, iade YOK, kayıt
    # sonsuza dek PENDING. Deneme bileti yüzeyinde emsal çözüm zaten vardı
    # (`library_exam_service`: ölü varlık → otomatik iade).
    #
    # Sözleşme: tahsilat varlığa BAĞLANAMIYORSA aynen iade edilir; sipariş
    # CANCELLED kalır, ödeme kaydı askıda kalmaz. `refund_unexpected_charge`
    # satır durumu tutmaz — replay idempotency'si sağlayıcının aşırı-iade
    # reddine yaslanır (aynı işlemin ikinci tam iadesi reddedilir).
    if success and order.status in ("CANCELLED", "REFUNDED"):
        # Kaydı ÖNCE claim et: ikinci bir callback/reconciler turu aynı tahsilatı
        # yeniden iade etmeye kalkmasın. Claim başarısızsa (başka bir akış
        # kazandı) para hareketi YAPILMAZ — çift iade yasağı buradan gelir.
        claimed = await escrow.claim(
            db,
            Order,
            order.id,
            from_statuses=["PENDING", "FAILED"],
            values={
                "payment_status": OrderPaymentStatus.REFUNDED.value,
                "refunded_at": _now(),
                "refunded_amount": order_total,
            },
            status_attr="payment_status",
        )
        if not claimed:
            logger.info(
                "order %s: ölü varlık tahsilatı zaten sonuçlandırılmış — "
                "ikinci iade yapılmadı", order_id,
            )
            return order
        await db.commit()
        await db.refresh(order)
        await escrow.refund_unexpected_charge(
            provider_ref=provider_ref,
            amount=paid_price if paid_price is not None else order_total,
            context=f"iptal edilmiş siparişin geç tahsilatı order={order_id}",
        )
        await audit_service.record(
            db,
            actor=_SistemAktoru(),
            action="order.late_charge_refunded",
            target_type="order",
            target_id=order_id,
            reason="İptal edilmiş siparişin doğrulanmış tahsilatı iade edildi",
            after={"status": order.status, "amount": str(order_total)},
        )
        await db.commit()
        return order

    if not success:
        if token and order.provider_ref and token != order.provider_ref:
            # Bayat oturumun başarısızlığı aktif oturumu FAILED'lamasın.
            return order
        await escrow.claim(
            db,
            Order,
            order.id,
            from_statuses=["PENDING"],
            values={"payment_status": "FAILED"},
            status_attr="payment_status",
        )
        await db.commit()
        await db.refresh(order)
        return order

    await _finalize_paid(db, order, provider_ref=provider_ref)
    await db.commit()
    return order


async def _finalize_paid(
    db: AsyncSession, order: Order, *, provider_ref: str | None
) -> None:
    """Ödeme başarılı: PAID'e geç, stok düş, eğitmen kazançlarını hesapla, bildir.
    İdempotent değildir — yalnız PENDING→PAID geçişinde çağrılır.

    **Oversell koruması**: Fiziksel ürün satırlarını kilit altında (SELECT FOR UPDATE)
    okuyup, PAID'e KESİNLEŞMEDEN ÖNCE stok yeterliliğini doğrular. Ödeme alındıktan
    sonra (ör. son 1 stoğu iki müşteri aynı anda ödeyince) stok yetmiyorsa hayalet
    sipariş yerine tam iade + iptal edilir."""
    if provider_ref:
        order.provider_ref = provider_ref

    # ── Oversell guard: fiziksel ürünleri kilitle, stoğu kilit altında doğrula ──
    #
    # Kilit `stock_ledger.lock_products` ile alınır (ürün kilidi alan TEK yer):
    # artan `id` sırası + `populate_existing`. Önceden burada kendi döngüsü
    # vardı ve iki kusur taşıyordu: (1) sıra `order.items` sırasıydı, yani
    # çapraz ürünlü iki eşzamanlı sipariş deadlock üretebiliyordu; (2)
    # `populate_existing` yoktu — ürün kimlik haritasındaysa `FOR UPDATE` satırı
    # kilitliyor ama ORM BAYAT nesneyi döndürüyordu ve eksik hesabı bayat
    # bakiyeyle yapılıyordu.
    #
    # Eksik hesabı da defterle AYNI saf yardımcıya (`has_shortage`) bağlandı;
    # ayrışırlarsa biri "yeter" derken diğeri `InsufficientStock` atardı.
    physical = _physical_items(order)
    needed: dict[int, int] = {}
    for item in physical:
        needed[item.product_id] = needed.get(item.product_id, 0) + item.quantity
    locked = await stock_ledger.lock_products(db, list(needed))
    # Başlıklar DÜZ DİZGİ olarak alınır: aşağıdaki yetersiz-stok dalında
    # `db.rollback()` çağrılıyor ve rollback ORM nesnelerini expire ediyor;
    # expire edilmiş bir nesnenin alanına erişmek async oturumda lazy-load →
    # `MissingGreenlet` (500) demektir.
    basliklar = {pid: p.title for pid, p in locked.items()}
    # Aynı sebeple sipariş kimliği de şimdiden yakalanır: `rollback` `order`
    # nesnesini de expire eder ve `order.id` okumak lazy-load tetikler.
    order_id = order.id
    shortages = [
        locked[pid].title
        for pid, qty in sorted(needed.items())
        if stock_ledger.has_shortage(locked[pid].stock, qty)
    ]
    if shortages:
        await _out_of_stock_refund(db, order, shortages)
        return

    # ── Atomik PAID claim'i ──
    # Önceden burada düz atama vardı ve tek koruma çağıranın "zaten PAID mi?"
    # kontrolüydü (check-then-act). Eşzamanlı iki callback (tarayıcı çift POST,
    # reconciler + callback yarışı) ikisi de kontrolden geçip stoğu İKİ KEZ
    # düşürebiliyor ve kuponu iki kez harcayabiliyordu. Koşullu UPDATE ile
    # yalnız tek transaction kazanır; kaybeden hiçbir yan etki uygulamaz.
    paid_at = _now()
    claimed = await escrow.claim(
        db,
        Order,
        order.id,
        from_statuses=["PENDING", "FAILED"],
        values={"payment_status": "PAID", "paid_at": paid_at},
        status_attr="payment_status",
    )
    if not claimed:
        logger.info(
            "order %s PAID claim edilemedi (eşzamanlı callback kazandı) — "
            "yan etki uygulanmadı",
            order.id,
        )
        return
    order.payment_status = "PAID"
    order.paid_at = paid_at
    await order_fsm.transition_order(db, order, "PAID", changed_by="system:payment")
    # Cıncık Teslimat sözü: ödeme anına göre bugün/yarın (16:00 cutoff, Pazar
    # sarması). Bölge-içi siparişte günlük kapasite de sayılır — dolu güne söz
    # verilmez (kampanya günü toplu söz ihlali yerine dürüst ileri tarih).
    if order.has_physical:
        if order.ship_in_zone is True:
            # Atomik rezervasyon: sayım+atama advisory kilit altında — eşzamanlı
            # ödemeler serileşir, son slota iki söz verilemez (overbooking yok).
            await _lock_promise_counter(db)
            order.promised_delivery_date = await promised_date_for(db, order.paid_at)
        else:
            # Bölge dışı: dış kargoyla gider, kendi-filo kontenjanını tüketmez.
            order.promised_delivery_date = delivery_promise.compute_promised_date(
                order.paid_at,
                cutoff_hour=settings.DELIVERY_CUTOFF_HOUR,
                non_working_weekdays=settings.DELIVERY_NON_WORKING_WEEKDAYS,
                utc_offset_hours=settings.APP_UTC_OFFSET_HOURS,
            )

    # Kupon kullanımını PAID'de say (PENDING siparişler kontenjan tüketmez).
    # redeem limitleri kilit altında yeniden doğrular; reddederse müşteri parayı
    # zaten ödemiştir — siparişi indirimsiz fiyata çekmek yerine kuponun izini
    # düşürüp admin'e bırakıyoruz (tahsil edilen tutar sipariş toplamıdır ve
    # değişmemelidir; aksi halde ödenen ile kayıt tutmaz).
    if order.coupon_id is not None:
        counted = await coupon_service.redeem(
            db, coupon_id=order.coupon_id, client_id=order.client_id, order_id=order.id
        )
        if not counted:
            logger.error(
                "order %s: kupon %s limitte — indirim %s TL uygulanmış ama kullanım "
                "sayılamadı (sipariş tutarı değiştirilmedi)",
                order.id, order.coupon_code, order.discount,
            )

    # ── Stok düşümü: DEFTER üzerinden, sipariş kalemi bazlı ──
    #
    # Eskiden burada `p.stock = max(0, p.stock - qty)` vardı: kırpma oversell'i
    # sessizce yutuyor ve hiçbir iz bırakmıyordu. Artık her fiziksel kalem için
    # bir `SALE` hareketi yazılır (anahtar `order_item:{id}:SALE`) ve
    # `products.stock` yalnız defter tarafından güncellenir.
    if physical:
        try:
            await stock_ledger.apply_many(
                db,
                [
                    {
                        "product_id": item.product_id,
                        "qty_delta": -item.quantity,
                        # Satış SATILABİLİR kovadan düşer; kitap fiziksel olarak
                        # hâlâ işletmededir (F29 §3 olay etkisi tablosu).
                        "bucket": stock_ledger.StockBucket.SALEABLE,
                        "movement_type": stock_ledger.StockMovementType.SALE,
                        "reason_code": "ORDER_PAID",
                        "ref_type": "order",
                        "ref_id": order.id,
                        "ref_line_id": item.id,
                        "idempotency_key": stock_ledger.idempotency_key_for(
                            stock_ledger.StockMovementType.SALE, order_item_id=item.id
                        ),
                    }
                    for item in physical
                ],
            )
        except stock_ledger.InsufficientStock as exc:
            # Ön kontrol (yukarıda, AYNI kilitler altında) eksiği görmediği hâlde
            # defter reddetti → beklenmeyen bir yarış. 500 DÖNMEZ:
            #   • tüm transaction geri alınır (PAID claim'i dâhil) → kısmi durum
            #     kalmaz, hiçbir SALE hareketi yazılmış olmaz;
            #   • sipariş taze okunup MEVCUT out-of-stock/iade akışına verilir.
            #     `escrow.begin_refund` atomik claim yaptığı için o akış
            #     idempotenttir (ikinci eşzamanlı çağrı claim edemez).
            logger.error(
                "order %s: ön kontrol yeterli dedi ama defter reddetti "
                "(ürün %s, mevcut %s, istenen %s) — transaction geri alınıyor ve "
                "stok yetersizliği iade akışına yönlendiriliyor",
                order.id, exc.product_id, exc.current, exc.qty_delta,
            )
            await db.rollback()
            taze = await _load_full(db, order_id)
            if taze is None:
                return
            await _out_of_stock_refund(
                db, taze, [basliklar.get(exc.product_id, str(exc.product_id))]
            )
            return

    for item in order.items:
        # Eğitmen dijital kalemi → komisyon bölüşümü kazanca yaz.
        if item.seller_type == SellerType.TUTOR.value and item.tutor_id is not None:
            tutor = await db.get(Tutor, item.tutor_id)
            line_total = Decimal(str(item.unit_price)) * item.quantity
            rate = commission.rate_for(tutor) if tutor else commission.effective_commission_rate(None, None)
            comm, earning = commission.split(line_total, rate)
            item.commission_rate = rate
            item.commission_amount = comm
            item.tutor_earning = earning

    # Eğitmenlere satış bildirimi (kalem başına tutor → tek bildirim).
    notified: set[int] = set()
    for item in order.items:
        if (
            item.seller_type == SellerType.TUTOR.value
            and item.tutor_id is not None
            and item.tutor_id not in notified
        ):
            notified.add(item.tutor_id)
            await notification_service.notify(
                db,
                user_id=item.tutor_id,
                role_id=ROLE_IDS[RoleType.TUTOR],
                message="Mağazada dijital ürünün satıldı; kazancına eklendi.",
                link="/bakiyem",
            )

    await _email_order(db, order, "PAID")


async def _out_of_stock_refund(
    db: AsyncSession, order: Order, shortages: list[str]
) -> None:
    """Ödeme alındı ama stok (kilit altında) yetersiz → tam iade + iptal.

    Bu noktada henüz PAID'e geçilmedi: kupon tüketilmedi, stok düşülmedi — bu yüzden
    geri-yükleme/kupon-serbest gerekmez, yalnız sağlayıcı iadesi + CANCELLED.

    İade yine iki fazlıdır (niyet önce commit edilir): tahsil edilmiş paranın
    iadesi süreç ölürse kaybolmamalı. Kaynak durum PAID değil PENDING/FAILED'dır.
    """
    if not await escrow.begin_refund(
        db, order, escrow.ORDER_SPEC, from_statuses=["PENDING", "FAILED"]
    ):
        logger.error(
            "order %s: oversell iadesi claim edilemedi (durum=%s) — para hareketi "
            "yapılmadı, elle inceleyin",
            order.id, order.payment_status,
        )
        return
    if not await escrow.perform_refund(db, order, escrow.ORDER_SPEC):
        # REFUNDING'de bırakıldı; reconciler devralır. Sipariş yine iptal edilir.
        logger.error(
            "order %s: oversell iadesi sağlayıcıda tamamlanamadı — REFUNDING",
            order.id,
        )
    await order_fsm.transition_order(
        db,
        order,
        "CANCELLED",
        changed_by="system:oversell",
        reason="Stok yetersiz: " + ", ".join(shortages),
    )
    await notification_service.notify(
        db,
        user_id=order.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message=(
            f"Siparişin #{order.id} için bazı ürünlerde stok kalmadığından "
            "ödemen iade edildi."
        ),
        link="/siparislerim",
    )
    await _email_order(db, order, "REFUNDED")


# ── Sorgu / dönüştürme ───────────────────────────────────────────────────────────


async def _load_full(db: AsyncSession, order_id: int) -> Order | None:
    stmt = (
        select(Order)
        .options(selectinload(Order.items), selectinload(Order.returns))
        .where(Order.id == order_id, Order.deleted_at.is_(None))
    )
    return (await db.execute(stmt)).scalars().first()


def _to_out(order: Order) -> OrderOut:
    paid = order.payment_status == "PAID"
    items: list[OrderItemOut] = []
    for it in order.items:
        download = None
        if paid and it.kind == ProductKind.DIGITAL.value and it.digital_asset_key:
            download = it.digital_asset_key
        items.append(
            OrderItemOut(
                id=it.id,
                product_id=it.product_id,
                title=it.title,
                cover_url=it.cover_url,
                unit_price=str(it.unit_price),
                quantity=it.quantity,
                kind=it.kind,
                seller_type=it.seller_type,
                download_url=download,
            )
        )
    # En güncel iade talebinin durumu (returns id'ye göre sıralı).
    return_status = order.returns[-1].status if order.returns else None
    return OrderOut(
        id=order.id,
        status=order.status,
        payment_status=order.payment_status,
        subtotal=str(order.subtotal),
        shipping_fee=str(order.shipping_fee),
        discount=str(order.discount),
        coupon_code=order.coupon_code,
        total=str(order.total),
        currency=order.currency,
        has_physical=order.has_physical,
        ship_recipient=order.ship_recipient,
        ship_phone=order.ship_phone,
        ship_address=order.ship_address,
        ship_city=order.ship_city,
        ship_district=order.ship_district,
        ship_lat=float(order.ship_lat) if order.ship_lat is not None else None,
        ship_lng=float(order.ship_lng) if order.ship_lng is not None else None,
        promised_delivery_date=order.promised_delivery_date,
        ship_in_zone=order.ship_in_zone,
        delivery_pref=order.delivery_pref,
        delivery_pref_note=order.delivery_pref_note,
        postpone_count=order.postpone_count,
        tracking_no=order.tracking_no,
        track_token=order.track_token,
        return_status=return_status,
        delivered_at=order.delivered_at,
        return_deadline=_return_deadline(order),
        created_at=order.created_at,
        items=items,
    )


async def get_order(
    db: AsyncSession, order_id: int, *, client_id: int | None = None
) -> OrderOut:
    order = await _load_full(db, order_id)
    if order is None or (client_id is not None and order.client_id != client_id):
        # Yabancı sipariş, OLMAYAN siparişle AYNI yanıtı alır (404).
        # 403 "sizin siparişiniz değil" geçerli bir ID'yi doğrulardı: saldırgan
        # 403/404 farkından sipariş kimlik uzayını tarayabilir (IDOR keşfi).
        # Kurye tarafında aynı sınıf sızıntı zaten 404'e çekilmişti.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sipariş bulunamadı")
    return _to_out(order)


async def list_mine(
    db: AsyncSession, client: Client, *, limit: int = 50, offset: int = 0
) -> list[OrderOut]:
    orders = (
        await db.execute(
            select(Order)
            .options(selectinload(Order.items), selectinload(Order.returns))
            .where(Order.client_id == client.id, Order.deleted_at.is_(None))
            .order_by(Order.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    return [_to_out(o) for o in orders]


async def get_order_for_pay(db: AsyncSession, order_id: int, client_id: int) -> Order:
    order = await _load_full(db, order_id)
    if order is None or order.client_id != client_id:
        # Varlık sızdırmaz — bkz. `get_order` gerekçesi.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sipariş bulunamadı")
    return order


# ── Teslimat self-servisi (tercih / erteleme / adres değişikliği) ──────────────────
#
# Tercih SİPARİŞTE yaşar (durak "deneme"dir; fail/erteleme sonrası yeni durak
# açılır, talimat kaybolmaz). Oturumsuz (track_token'lı) yüzeyden yalnız
# davranışsal tercihler + erteleme yapılabilir; ADRES DEĞİŞİKLİĞİ yalnız oturumlu
# müşteri ucundan (link paylaşılabilir — adres PII+güvenlik sınırıdır).

POSTPONE_LIMIT = 2  # müşteri ertelemesi üst sınırı (sonsuz zincir engeli)


async def get_order_by_track_token(db: AsyncSession, token: str) -> Order:
    """Oturumsuz self-servis girişi: token sahipliği kanıttır (SMS'le telefona
    gitti; tahmin edilemez). IP rate-limit router'da."""
    order = (
        await db.execute(
            select(Order).where(Order.track_token == token, Order.deleted_at.is_(None))
        )
    ).scalars().first()
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sipariş bulunamadı")
    return order


async def _open_stop(db: AsyncSession, order_id: int) -> DeliveryStop | None:
    """Siparişin planlı/aktif turdaki BEKLEYEN durağı (turuyla birlikte)."""
    return (
        await db.execute(
            select(DeliveryStop)
            .options(selectinload(DeliveryStop.run))
            .join(DeliveryRun, DeliveryStop.run_id == DeliveryRun.id)
            .where(
                DeliveryStop.order_id == order_id,
                DeliveryStop.status == DeliveryStopStatus.PENDING.value,
                DeliveryRun.status.in_(
                    (DeliveryRunStatus.PLANNED.value, DeliveryRunStatus.ACTIVE.value)
                ),
                DeliveryRun.deleted_at.is_(None),
            )
            .order_by(DeliveryStop.id.desc())
            .limit(1)
        )
    ).scalars().first()


async def _lock_order(db: AsyncSession, order: Order) -> None:
    """Sipariş satırını FOR UPDATE ile kilitleyip TAZE durumunu yükler.

    Durum değiştiren yollar (erteleme, iptal, iade) bununla başlar — kurye tam
    o anda teslim etmiş olabilir; kilit + taze okuma olmadan buradaki yazım
    DELIVERED'ı ezerek siparişi PAID'e geri sarabilirdi (lost update).
    Kilit sırası delivery_service ile aynıdır: önce Order, sonra DeliveryStop."""
    await db.execute(select(Order.id).where(Order.id == order.id).with_for_update())
    await db.refresh(order)
    # `refresh` İLİŞKİLERİ de expire eder; bu fonksiyondan sonra `items`
    # (stok geri yükleme) ve `returns` (_to_out) okunuyor. Async oturumda
    # expire edilmiş ilişkiye erişim lazy-load → MissingGreenlet (500).
    await db.refresh(order, attribute_names=["items", "returns"])


def _require_self_service_order(order: Order) -> None:
    if not order.has_physical:
        raise HTTPException(status.HTTP_409_CONFLICT, "Dijital siparişte teslimat tercihi yok")
    if order.payment_status != "PAID" or order.status not in ("PAID", "SHIPPED"):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Bu sipariş için teslimat tercihi değiştirilemez"
        )


#: Paketi gözetimsiz bırakan tercihler. SMS takip linkini (public token) ele
#: geçiren biri paketi kapıya/komşuya yönlendirememeli — bu tercihlere geçiş
#: yalnız OTURUMLU sahibin hakkıdır; token yetkisi izleme+erteleme+beni-ara'dır.
DROP_PREFS = frozenset(
    {DeliveryPref.KAPIYA_BIRAK.value, DeliveryPref.KOMSUYA_BIRAK.value}
)


def is_drop_pref(pref: str) -> bool:
    """Saf: tercih paketi gözetimsiz bırakıyor mu?"""
    return pref in DROP_PREFS


async def set_delivery_pref(
    db: AsyncSession,
    order: Order,
    *,
    pref: str,
    note: str | None,
    from_public_token: bool = False,
) -> None:
    """Teslimat talimatını günceller — dağıtım sırasında da serbest (kurye ekranı
    15 sn poll ile talimatı canlı görür). KOMSUYA_BIRAK'ta not (komşu adı/daire)
    zorunludur; diğer tercihlerde not temizlenir. Public token yolunda bırakma
    tercihlerine YÜKSELTME yasaktır (hırsızlık vektörü)."""
    if from_public_token and is_drop_pref(pref):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Kapıya/komşuya bırakma yalnız hesabınla giriş yaparak seçilebilir",
        )
    _require_self_service_order(order)
    if pref == DeliveryPref.KOMSUYA_BIRAK.value:
        if not note or len(note.strip()) < 3:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Komşuya bırakma için komşu adı/daire bilgisi gerekli",
            )
        order.delivery_pref_note = note.strip()
    else:
        order.delivery_pref_note = None
    order.delivery_pref = pref
    await db.commit()


async def postpone_delivery(db: AsyncSession, order: Order) -> None:
    """"Yarına ertele": açık durak varsa RESCHEDULED'a kapanır (kurye suçu değil —
    FAILED'dan ayrı), dağıtımdaysa sipariş PAID'e geri sarılır; söz verilen gün
    sonraki çalışma gününe alınır. Üst sınır POSTPONE_LIMIT."""
    await _lock_order(db, order)
    _require_self_service_order(order)
    if order.postpone_count >= POSTPONE_LIMIT:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Erteleme hakkı doldu (en fazla {POSTPONE_LIMIT}) — bizimle iletişime geç",
        )

    stop = await _open_stop(db, order.id)
    if stop is not None:
        # Yarış: kurye tam bu anda teslim etmiş olabilir — durağı KİLİTLE,
        # taze durumla kontrol et (sipariş satırı yukarıda zaten kilitli).
        await db.execute(
            select(DeliveryStop.id).where(DeliveryStop.id == stop.id).with_for_update()
        )
        await db.refresh(stop)
        if stop.status != DeliveryStopStatus.PENDING.value:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Durak az önce sonuçlandı — sayfayı yenile"
            )
        stop.status = DeliveryStopStatus.RESCHEDULED.value
        if order.status == "SHIPPED":
            await order_fsm.transition_order(
                db, order, "PAID", changed_by="client", reason="Müşteri ertesi güne erteledi"
            )
            order.tracking_no = None
        # F30 §3.5: dört geri dönüş yolundan dördüncüsü. Müşteri erteledi ama
        # paket ARAÇTA kaldı — `RESCHEDULED` durak `FAILED`'dan ayrıdır (kurye
        # KPI'ına yazılmaz), paketin fiziksel yeri ise aynıdır. Erteleme
        # `prepared_at`'i sıfırlamadığı için bu işaret olmadan sipariş
        # `eligible_orders`'ta paketsiz görünmeye devam ederdi.
        await packing_events.on_package_returning(
            db, order.id, reason="Müşteri teslimatı erteledi"
        )

    # Hedef gün: sonraki çalışma günü — kontenjanı doluysa ondan da ileri.
    # (Müşteri isteği: kapasite kontrolü ADİLDİR; kurye kaynaklı FAILED'ın
    #  aksine öncelik almaz.) Sayım+atama atomik olsun diye advisory kilit.
    await _lock_promise_counter(db)
    _postpone_today = (_now() + datetime.timedelta(hours=settings.APP_UTC_OFFSET_HOURS)).date()
    order.promised_delivery_date = await _first_capacity_day(
        db,
        delivery_promise.next_delivery_day(
            _now(),
            non_working_weekdays=settings.DELIVERY_NON_WORKING_WEEKDAYS,
            utc_offset_hours=settings.APP_UTC_OFFSET_HOURS,
            closed_dates=await _closed_dates_from(db, _postpone_today),
        ),
    )
    order.postpone_count += 1
    new_date = order.promised_delivery_date.strftime("%d.%m.%Y")
    await notification_service.notify(
        db,
        user_id=order.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message=(
            f"Siparişin #{order.id} isteğinle ertelendi — yeni teslimat günü: {new_date}."
        ),
        link="/siparislerim",
    )
    if order.ship_phone:
        # Durum değişikliğiyle AYNI transaction'da outbox'a (tek commit).
        outbox.enqueue(
            db,
            "sms:postponed",
            {"to": order.ship_phone, "order_id": order.id, "new_date": new_date},
        )
    await db.commit()
    # Aktif turdan durak düştüyse sıradaki müşterilerin sırası bir öne kaydı.
    if stop is not None and stop.run.status == DeliveryRunStatus.ACTIVE.value:
        from services import delivery_service  # döngüsel import önlemi (yerel)

        await delivery_service._notify_upcoming(db, stop.run_id)


async def change_ship_address(
    db: AsyncSession, client: Client, order: Order, *, address_id: int, force: bool = False
) -> OrderOut:
    """Teslimat adresini değiştirir — yalnız dağıtıma çıkmadan (ACTIVE turda durağı
    yokken). Yeni adres bölge dışına düşerse 409 (code=OUT_OF_ZONE); müşteri
    ``force=true`` ile onaylarsa sipariş dış-kargo kuyruğuna geçer."""
    await _lock_order(db, order)
    _require_self_service_order(order)
    if order.status != "PAID":
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Kurye yola çıktı — adres değişikliği kapandı"
        )
    stop = await _open_stop(db, order.id)
    if stop is not None and stop.run.status == DeliveryRunStatus.ACTIVE.value:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Kurye yola çıktı — adres değişikliği kapandı"
        )

    addr = await db.get(ClientAddress, address_id)
    if addr is None or addr.deleted_at is not None or addr.client_id != client.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Adres bulunamadı")

    in_zone = delivery_promise.in_delivery_zone(
        addr.location_lat,
        addr.location_lng,
        addr.city,
        addr.district,
        depot_lat=settings.DELIVERY_DEPOT_LAT,
        depot_lng=settings.DELIVERY_DEPOT_LNG,
        radius_km=settings.DELIVERY_ZONE_RADIUS_KM,
        districts=settings.DELIVERY_ZONE_DISTRICTS,
    )
    if in_zone is not True and not force:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "code": "OUT_OF_ZONE",
                "message": (
                    "Yeni adres Cıncık Teslimat bölgesinin dışında — sipariş kargo "
                    "firmasıyla gönderilir. Onaylıyorsan devam et."
                ),
            },
        )

    order.ship_address = addr.address_line
    if addr.directions:
        order.ship_address = f"{addr.address_line}\n{addr.directions}"
    order.ship_city = addr.city
    order.ship_district = addr.district
    order.ship_lat = addr.location_lat
    order.ship_lng = addr.location_lng
    order.ship_in_zone = in_zone

    # Planlı turda durağı varsa: bölge dışına çıktıysa duraktan düşür (dış kargo
    # kuyruğuna geçer); bölge içindeyse durak kalır (koordinatı siparişten okur;
    # ETA bayatlar — admin yeniden optimize eder).
    if stop is not None and in_zone is not True:
        await db.delete(stop)
    await db.commit()
    return await get_order(db, order.id, client_id=client.id)


# ── Admin ─────────────────────────────────────────────────────────────────────────


async def list_orders_admin(
    db: AsyncSession, *, status_filter: str | None = None, limit: int = 100, offset: int = 0
) -> list[OrderOut]:
    stmt = (
        select(Order)
        .options(selectinload(Order.items), selectinload(Order.returns))
        .where(Order.deleted_at.is_(None))
    )
    if status_filter:
        stmt = stmt.where(Order.status == status_filter)
    stmt = stmt.order_by(Order.created_at.desc()).limit(limit).offset(offset)
    orders = (await db.execute(stmt)).scalars().all()
    return [_to_out(o) for o in orders]


async def mark_shipped(
    db: AsyncSession, order_id: int, *, tracking_no: str | None
) -> OrderOut:
    order = await _load_full(db, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sipariş bulunamadı")
    # ── Order satırı KİLİTLENİR — kontroller taze durumla çalışsın ──────────
    # Nihai denetim P1'i: paket kapısı kilitsiz okunuyordu. Eşzamanlı bir
    # `open_package` ile yarışta ikisi de kendi ön koşulunu geçiyor ve ortaya
    # **kurtarılamayan** bir çıkmaz çıkıyordu: sipariş `SHIPPED`, paket `OPEN`.
    # O hâlde paket tamamlanamaz (`complete` siparişin PAID olmasını arar),
    # zimmetlenemez, `uq_order_packages_live` yüzünden yeni paket açılamaz ve
    # sipariş dağıtım kuyruğuna hiç giremez.
    # `open_package` da ilk iş olarak aynı satırı `FOR UPDATE` ile alır
    # (`packing_service.open_package` → `_lock_order`), yani iki yol artık
    # Order satırında serileşir: hangisi önce girerse diğeri TAZE durumu görür
    # ve kendi 409'unu üretir.
    await _lock_order(db, order)
    if not order.has_physical:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Bu siparişte kargolanacak ürün yok"
        )
    if order.payment_status != "PAID":
        raise HTTPException(status.HTTP_409_CONFLICT, "Ödenmemiş sipariş kargolanamaz")
    # F30: kendi filomuzla giden (paketi olan) sipariş elle "kargolandı"
    # işaretlenemez — çıkışı kuryenin paketi okutması yazar. Gerekçe ve
    # legacy istisnası `packing_events.elle_sevkiyat_yasak` docstring'inde.
    await packing_events.elle_sevkiyat_yasak(db, order.id)
    await order_fsm.transition_order(db, order, "SHIPPED", changed_by="admin")
    order.tracking_no = tracking_no
    await db.commit()
    await notification_service.notify(
        db,
        user_id=order.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message=f"Siparişin #{order.id} kargoya verildi.",
        link="/siparislerim",
    )
    await db.commit()
    await _email_order(db, order, "SHIPPED")
    return _to_out(order)


async def mark_delivered(db: AsyncSession, order_id: int) -> OrderOut:
    """Yönetici teslim yolu (`POST /store/admin/orders/{id}/deliver`).

    **Zimmet kapısı burada da geçerlidir.** Commit 7 denetiminin P1'i tam olarak
    buydu: bu uç `delivery_service._finalize_delivered` hunisinden geçmiyor,
    yani F30 zimmet guard'ını miras almıyordu. Sonuç, kutu HÂLÂ RAFTAYKEN
    siparişin `DELIVERED` olmasıydı — üstelik zararı tek bir yanlış statüyle
    kalmıyordu:

    * müşteriye "teslim edildi" e-postası/outbox olayı gidiyor,
    * durak `PENDING` kalıyor (kurye hâlâ o adrese gidecek),
    * paket `PACKED` kaldığı için bir daha **zimmetlenemiyor** (`handover`
      yalnız `PACKED`→`HANDED_OVER`, ama sipariş artık `DELIVERED`),
    * `uq_order_packages_live` yüzünden yeni paket de açılamıyor.

    Guard `transition_order`'dan ÖNCE çağrılır: reddederse hiçbir yan etki
    (durum geçişi · geçmiş satırı · e-posta · bildirim · audit) doğmaz ve
    transaction tamamen temiz kalır.

    ## Kilit ve terminal bütünlük (nihai denetim P1'i)

    İlk düzeltme guard'ı ekledi ama iki eksiği vardı:

    1. **Kilitsiz okuma.** Guard canlı paketi `Order` satırını kilitlemeden
       okuyordu; eşzamanlı bir `cancel_run`/`fail_stop` ile yarışta paket
       `RETURN_PENDING`'e giderken sipariş `DELIVERED` olabiliyordu — yani
       "teslim edildi" ile "kutu araçta geri dönüyor" aynı anda doğru
       görünüyordu.
    2. **Yarım terminal.** Mutlu yolda bile YALNIZ sipariş durumu değişiyordu:
       paket `HANDED_OVER`, durak `PENDING`, QR geçerli kalıyordu. Kurye o
       durağı ekranında görmeye, etiket okutulmaya devam ediyordu.

    Artık ikisi de tek transaction'da: `Order` `FOR UPDATE` → guard → durum
    geçişi → paket ve durak terminale (`packing_events.teslim_terminali`) →
    bildirim → e-posta outbox'ı → commit. Router audit'i yanıttan sonra yazar,
    yani 409'da o da doğmaz.
    """
    order = await _load_full(db, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sipariş bulunamadı")
    # Kanonik sıranın ilk halkası. `zimmet_zorunlu` paketi kilitsiz OKUR
    # (kilit sırası gereği — bkz. docstring'i); o okumanın anlamlı olması için
    # Order satırının burada kilitli olması ZORUNLUDUR: paketi değiştiren her
    # yol (`handover_scan`, `cancel_run`, `fail_stop`, `open_package`, `void`,
    # `return_in`) da ilk halkada bu satırı alır.
    await _lock_order(db, order)
    # Aktör YÖNETİCİDİR: hangi kuryede olduğunu bilmez, yalnız "bir kuryede
    # olmalı" der. Kuryeyi bilen saha yolları `expected_courier_id` geçirir.
    await packing_events.zimmet_zorunlu(db, order.id)
    # FSM: yalnız SHIPPED → DELIVERED (önceden ön-koşulsuzdu; PENDING'den bile olurdu).
    await order_fsm.transition_order(db, order, "DELIVERED", changed_by="admin")
    # Paket ve durak da terminale gider — sipariş "teslim edildi" derken
    # operasyonun "yolda" demesi imkânsız olsun.
    await packing_events.teslim_terminali(
        db, order.id, note="Yönetici panelinden teslim edildi"
    )
    await notification_service.notify(
        db,
        user_id=order.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message=f"Siparişin #{order.id} teslim edildi. İyi çalışmalar!",
        link="/siparislerim",
    )
    # Outbox olayı commit'ten ÖNCE yazılır: durum değişikliğiyle atomik olsun
    # (eski hâlde commit'ten sonraydı ve kalıcılığı `get_db`'nin otomatik
    # commit'ine kalıyordu — TB-4'teki belirsiz sahiplik).
    await _email_order(db, order, "DELIVERED")
    await db.commit()
    return _to_out(order)


def _physical_items(order: Order) -> list:
    return [
        item
        for item in order.items
        if item.kind == ProductKind.PHYSICAL.value and item.product_id is not None
    ]


async def _lock_order_products(db: AsyncSession, order: Order) -> None:
    """Siparişin fiziksel ürünlerini kanonik sırada kilitler.

    Geri yükleme yollarında **sağlayıcı çağrısından önce** çağrılır: `Order`
    kilidi sağlayıcıdan sonra alındığı için, ürün kilidini de sonraya bırakmak
    bu yolu `Order → Product` yapar ve `_finalize_paid`'in `Product → Order`
    sırasıyla deadlock döngüsü kurar. Ayrıntı: plan §4e.
    """
    urunler = {item.product_id for item in _physical_items(order)}
    if urunler:
        await stock_ledger.lock_products(db, list(urunler))


async def _restock(db: AsyncSession, order: Order, *, reason_code: str) -> None:
    """İptal / tam iadede stoğu **deftere yazarak** geri yükler.

    Kalem başına bir `SALE_CANCEL` hareketi (`order_item:{id}:SALE_CANCEL`).

    **Fazla geri yükleme tavanı:** tam iptal ile kısmi iade FARKLI idempotency
    anahtarları kullanır; ikisi de kendi başına geçerlidir. 4 adetlik kalemden 2
    adet iade edildikten sonra sipariş tam iptal edilirse 4 daha eklenir ve stok
    satılandan fazla artardı. Bu yüzden geri yüklenecek adet
    `satılan − şimdiye kadar geri yüklenen` ile sınırlanır (defterden okunur).

    ⚠️ Yalnız **sağlayıcı iadesi başarılı olduktan sonra** çağrılmalıdır (iki
    fazlı iadenin ikinci fazı) — aksi hâlde para dönmemişken stok artar.
    """
    physical = _physical_items(order)
    if not physical:
        return
    # Tavan hesabı ÜRÜN KİLİDİ ALTINDA okunmalı: iki geri yükleme yolu
    # eşzamanlı koşarsa (tam iptal ⟂ kısmi iade) ikisi de "henüz geri yüklenen
    # yok" görüp tam adedi uygular ve stok satılandan fazla artar. Kilit ikisini
    # serileştirir; ikinci okuma birincinin commit'ini görür.
    # (`apply_many` zaten kilitliyor ama SONRA — okuma önce olduğu için burada
    # açıkça alınır; aynı transaction'da yeniden girişlidir, maliyeti yok.)
    await stock_ledger.lock_products(db, [item.product_id for item in physical])
    geri_yuklenen = await stock_ledger.restored_quantity_by_order_item(
        db, [item.id for item in physical]
    )
    specs: list[dict] = []
    for item in physical:
        kalan = int(item.quantity) - int(geri_yuklenen.get(item.id, 0))
        if kalan <= 0:
            # Bu kalem zaten (kısmen/tamamen iade yoluyla) geri yüklenmiş.
            logger.info(
                "order %s kalem %s: geri yüklenecek adet kalmadı "
                "(satılan %s, geri yüklenen %s)",
                order.id, item.id, item.quantity, geri_yuklenen.get(item.id, 0),
            )
            continue
        specs.append(
            {
                "product_id": item.product_id,
                "qty_delta": kalan,
                "bucket": stock_ledger.StockBucket.SALEABLE,
                "movement_type": stock_ledger.StockMovementType.SALE_CANCEL,
                "reason_code": reason_code,
                "ref_type": "order_item",
                "ref_id": order.id,
                "ref_line_id": item.id,
                "idempotency_key": stock_ledger.idempotency_key_for(
                    stock_ledger.StockMovementType.SALE_CANCEL, order_item_id=item.id
                ),
                "note": (
                    None
                    if kalan == item.quantity
                    else (
                        f"kısmi iade sonrası kalan: satılan {item.quantity}, "
                        f"önceden geri yüklenen {geri_yuklenen.get(item.id, 0)}"
                    )
                ),
            }
        )
    if specs:
        await stock_ledger.apply_many(db, specs)


def _bump_refunded_amount(order: Order) -> None:
    """Tam iadede ``orders.refunded_amount``'ı sipariş toplamına yükseltir.

    Ciro raporu (`revenue_service`) iade sütununu ve kısmi iade tavanı
    (`remaining_refundable`) BU kolondan okur. Eskiden yalnız RMA yolu yazıyordu;
    tam iptal/iade iadeleri raporda 0 TL görünüyordu.

    İdempotent ve kısmi iadelerle uyumlu: değer yalnız YÜKSELTİLİR, asla
    düşürülmez — daha önce kısmi iade yapılmışsa tam iade onu tamamlar, ikinci
    çağrı ise no-op'tur.
    """
    toplam = Decimal(str(order.total))
    mevcut = Decimal(str(order.refunded_amount or 0))
    if mevcut < toplam:
        order.refunded_amount = toplam


async def _manual_review_iade_teslim_sonrasi(db: AsyncSession, order: Order) -> None:
    """R17: sağlayıcı iadesi gitmişken kurye teslimi kazandı — GÖRÜNÜR bırak.

    Kanonik yarış sözleşmesi (İP-2b §6.6): teslim kesinleşmişse `DELIVERED`
    `CANCELLED` ile EZİLMEZ ve kitap müşteride olduğu için `SALE_CANCEL`
    YAZILMAZ. Sağlayıcıya giden iade çağrısı geri alınamaz; **otomatik ikinci
    finansal işlem yapılmaz** (ters tahsilat/otomatik RMA İP-2b kapsamı dışında,
    ayrı ürün kararıdır). Kayıt sessizce kaybolmasın diye üç yerde görünür olur:
    ERROR logu · `audit_logs` satırı · yöneticilere bildirim.
    """
    logger.error(
        "MANUAL_REVIEW order %s: iade sağlayıcıya gönderildikten SONRA kurye "
        "teslimi kesinleşti (status=DELIVERED). Stok geri yüklenmedi, sipariş "
        "durumu korundu; tahsilat/iade dengesi ELLE incelenmeli (tutar=%s, "
        "ref=%s)",
        order.id, order.total, order.provider_ref,
    )
    await audit_service.record(
        db,
        actor=_SistemAktoru(),
        action="order.refund_after_delivery",
        target_type="order",
        target_id=order.id,
        reason=(
            "Sağlayıcı iadesi gönderildikten sonra teslim kesinleşti — "
            "MANUAL_REVIEW"
        ),
        after={
            "status": order.status,
            "payment_status": order.payment_status,
            "total": str(order.total),
        },
    )
    admin_ids = (
        await db.execute(select(Admin.id).where(Admin.deleted_at.is_(None)))
    ).scalars().all()
    for admin_id in admin_ids:
        await notification_service.notify(
            db,
            user_id=admin_id,
            role_id=ROLE_IDS[RoleType.ADMIN],
            message=(
                f"Sipariş #{order.id}: iade gönderildikten sonra teslim edildi — "
                "para/mal dengesi elle incelenmeli (MANUAL_REVIEW)."
            ),
            link="/yonetim/magaza",
        )


async def settle_refunded_order(
    db: AsyncSession,
    order: Order,
    *,
    reason_code: str,
    terminal_status: str,
    changed_by: str,
    reason: str | None = None,
) -> None:
    """İade sağlayıcıda KESİNLEŞTİĞİNDE koşan **TEK** telafi kuyruğu.

    Üç çağıranı vardır ve üçü de AYNI sonucu üretmek zorundadır — eskiden
    yalnız birincisi telafi uyguluyordu:

    1. ``_refund_payment`` (müşteri iptali / yönetici iadesi — mutlu yol),
    2. ``escrow_reconciler.reconcile_refunding`` (sağlayıcı ilk denemede düştü,
       karantina sonrası tamamlandı) — burada stok, kupon, sipariş durumu ve
       bildirim HİÇ koşmuyordu (İP-2b R6/R7),
    3. 502 sonrası ikinci iptal denemesi (İP-2b R8).

    Tamamı idempotenttir: `SALE_CANCEL` defter anahtarı, `coupon release`'in
    satır şartı, `refunded_amount`'ın yalnız-yükselt kuralı ve FSM'in "aynı
    duruma geçiş no-op" kuralı ikinci uygulamayı engeller.

    **R17 istisnası:** sipariş bu arada `DELIVERED` olduysa telafi UYGULANMAZ
    (kitap müşteride) ve durum EZİLMEZ; kayıt MANUAL_REVIEW'a düşer.
    """
    if order.status == "DELIVERED":
        await _manual_review_iade_teslim_sonrasi(db, order)
        return

    await _restock(db, order, reason_code=reason_code)
    if order.coupon_id is not None:
        # Kupon kullanımı yalnız PAID'de sayılmıştı → geri sal (satır varsa).
        await coupon_service.release(db, coupon_id=order.coupon_id, order_id=order.id)
    _bump_refunded_amount(order)
    if order.status not in ("CANCELLED", "REFUNDED"):
        await order_fsm.transition_order(
            db, order, terminal_status, changed_by=changed_by, reason=reason
        )


async def _refund_payment(
    db: AsyncSession,
    order: Order,
    *,
    reason_code: str,
    terminal_status: str,
    changed_by: str,
    reason: str | None = None,
) -> None:
    """İki fazlı iade + stok geri yükleme + kupon serbest bırakma.

    Faz 1 (``escrow.begin_refund``): PAID→REFUNDING + niyet damgası atomik claim
    edilir ve HEMEN commit edilir. Faz 2 (``escrow.perform_refund``): sağlayıcı
    iadesi → başarıda REFUNDING→REFUNDED.

    Önceki tek fazlı akışta önce sağlayıcı çağrılıp sonra durum yazılıyordu:
    iade başarılı olup commit düşerse para gitmiş, sipariş PAID, stok geri
    yüklenmemiş ve hiçbir iz kalmamış oluyordu — yönetici tekrar denediğinde
    ikinci iade gönderiliyordu. Artık süreç nerede ölürse ölsün kayıt sarkan
    REFUNDING olarak kalır ve reconciler devralır.

    Sipariş ``status``'ünü ve bildirimi çağıran ayarlar (iptal=CANCELLED,
    iade=REFUNDED). Yalnız ``payment_status == 'PAID'`` iken çağrılmalıdır.
    """
    if not await escrow.begin_refund(db, order, escrow.ORDER_SPEC):
        # Başka bir transaction kazandı (eşzamanlı iptal/iade) — para hareketi YOK.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Bu siparişin iadesi zaten işleniyor veya tamamlanmış",
        )

    # ── Ürün kilitleri: sağlayıcı çağrısından ÖNCE (kilit sırası) ──
    #
    # Telafiler artık sağlayıcı BAŞARILI olduktan sonra uygulanıyor (aşağıda).
    # Ama `perform_refund` içindeki `finalize_refund` sipariş satırını UPDATE
    # eder, yani **Order kilidi** alır. Kilitleri o noktadan sonra almak bu yolu
    # `Order → Product` yapardı; `_finalize_paid` ise `Product → Order` alıyor
    # → gerçek bir deadlock döngüsü. Bu yüzden ürün satırları sağlayıcıya
    # gitmeden ÖNCE, kanonik sırada kilitlenir; `apply_many` sonra aynı satırları
    # yeniden girişli biçimde kilitler.
    #
    # Bedeli bilinçli: ürün satırları sağlayıcı HTTP çağrısı boyunca kilitli
    # kalır. Kabul edilme sebebi — iade nadir ve yönetici tetiklidir; alternatifler
    # ya kilit sırasını ters çevirir (deadlock) ya da telafiyi Faz 2 commit'inden
    # SONRAYA atıp süreç ölürse **kalıcı olarak kaybeder** (sipariş REFUNDED
    # olduğu için reconciler de devralmaz).
    await _lock_order_products(db, order)

    # ── Faz 2: sağlayıcı ──
    #
    # Sıra bilinçli olarak DEĞİŞTİ (commit 5): eskiden stok ve kupon telafisi
    # sağlayıcı çağrısından ÖNCE yapılıyordu, yani sağlayıcı reddettiğinde
    # (`REFUNDING`'de bırakılan kayıt) stok ARTMIŞ oluyordu — para dönmemişken
    # mal geri gelmiş sayılıyordu ve satılabilir görünüyordu.
    if not await escrow.perform_refund(db, order, escrow.ORDER_SPEC):
        # Sağlayıcı reddetti/ulaşılamadı: REFUNDING'de bırakılır (HELD'e geri
        # dönüş YOK) ve **STOK ARTMAZ**. Reconciler karantina penceresi sonrası
        # devralır; o da bu fonksiyonu tekrar çağırdığında telafiler
        # idempotency anahtarları sayesinde TEK KEZ uygulanır.
        await db.commit()
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Sağlayıcı iadesi şu an tamamlanamadı; iade kaydedildi ve "
            "otomatik olarak yeniden denenecek.",
        )

    # ── R17: sağlayıcı penceresinde kurye teslim etmiş olabilir ──
    #
    # `begin_refund` niyeti COMMIT ettiği için Order kilidi BIRAKILMIŞTI; o
    # pencerede tur başlayıp (PAID→SHIPPED) kurye OTP ile teslim edebilir
    # (SHIPPED→DELIVERED). Buradan sonrasını çağıranın BAYAT bellek kopyasıyla
    # sürdürmek DELIVERED'ı CANCELLED ile ezerdi (lost update) ve kitap
    # müşterideyken kör `SALE_CANCEL` yazardı. Bu yüzden kilit + TAZE okuma
    # sağlayıcı çağrısından SONRA yenilenir; kararı `settle_refunded_order`
    # taze duruma bakarak verir.
    await _lock_order(db, order)

    # ── Yerel telafiler (yalnız iade tamamlandıysa) ──
    #
    # Bu blok ile `perform_refund` arasında süreç ölürse: sağlayıcıda para
    # dönmüş, DB'de REFUNDED claim'i ve telafiler geri alınmış olur. Retry aynı
    # `order_item:{id}:SALE_CANCEL` anahtarını üretir → hareket TEK KEZ uygulanır.
    await settle_refunded_order(
        db,
        order,
        reason_code=reason_code,
        terminal_status=terminal_status,
        changed_by=changed_by,
        reason=reason,
    )


async def refund_order(db: AsyncSession, order_id: int, *, reason: str) -> OrderOut:
    """Siparişi iade et (sağlayıcı refund + REFUNDED). Stok geri yüklenir.

    **Teslim edilmiş sipariş bu uçtan GEÇEMEZ** (İP-2b R4): eskiden yalnız
    `payment_status` bakılıyordu, dolayısıyla `DELIVERED` bir sipariş tek çağrıyla
    `REFUNDED` oluyor ve kitap MÜŞTERİDEYKEN satılabilir kovaya kör `SALE_CANCEL`
    yazılıyordu — defter fiziksel gerçekle ayrışıyor, telafisi yalnız sonraki
    sayımın STALE işareti oluyordu. Teslim sonrası para iadesi **İP-2a iade (RMA)**
    yolundan, fiziksel kabulle yürür.
    """
    order = await _load_full(db, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sipariş bulunamadı")
    await _lock_order(db, order)
    if order.status == "DELIVERED":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Teslim edilmiş sipariş doğrudan iade edilemez; iade talebi (RMA) "
            "üzerinden ilerleyin.",
        )
    if order.payment_status != "PAID":
        raise HTTPException(status.HTTP_409_CONFLICT, "Yalnızca ödenmiş sipariş iade edilebilir")
    await _refund_payment(
        db, order, reason_code="ORDER_REFUNDED",
        terminal_status="REFUNDED", changed_by="admin", reason=reason,
    )
    await db.commit()
    await notification_service.notify(
        db,
        user_id=order.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message=f"Siparişin #{order.id} için ödemen iade edildi.",
        link="/siparislerim",
    )
    await db.commit()
    await _email_order(db, order, "REFUNDED")
    return _to_out(order)


async def _cancel_order(
    db: AsyncSession, order: Order, *, changed_by: str, reason: str | None = None
) -> OrderOut:
    """İptalin ortak gövdesi (müşteri ve yönetici yolları AYNI kuralları izler).

    Ödenmişse sağlayıcı iadesi + telafiler; kargolanmış/teslim sipariş iptal
    edilemez (iade talebi gerekir)."""
    await _lock_order(db, order)
    if order.status in ("SHIPPED", "DELIVERED"):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Kargolanmış sipariş iptal edilemez; iade talebi oluşturun.",
        )
    if order.status in ("CANCELLED", "REFUNDED"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu sipariş zaten iptal/iade edilmiş")
    if order.payment_status == OrderPaymentStatus.REFUNDING.value:
        # ── I8 (tek kazanan): iade BAŞLAMIŞ ama henüz bitmemiş ──
        #
        # `begin_refund` niyeti claim edip HEMEN commit ettiği için Order kilidi
        # sağlayıcı çağrısı boyunca BIRAKILIR. O pencerede ikinci bir iptal
        # kilidi alır ve taze durumu (`status=PAID`, `payment_status=REFUNDING`)
        # okur — ama burası eskiden yalnız `== 'PAID'` diye bakıp geri kalan her
        # şeyi "ödenmemiş sipariş" sayıyordu: kaybeden de `else` dalına düşüp
        # CANCELLED yazıyor, başarı dönüyor ve müşteriye İKİNCİ "iptal edildi"
        # bildirimi gidiyordu (I11 ihlali). Yani kusur bayat okuma değil, TAZE
        # okunan ara durumun yanlış sınıflandırılmasıydı.
        #
        # Sarkan REFUNDING (sağlayıcı reddetti → 502) kaydı da buraya düşer ve
        # bilinçlidir: iadesi havada olan sipariş elle CANCELLED'a çevrilemez,
        # reconciler devralır (docs/…-sozlesme.md §3 I4/I9).
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Bu siparişin iadesi zaten işleniyor veya tamamlanmış",
        )

    if order.payment_status == "PAID":
        await _refund_payment(
            db, order, reason_code="ORDER_CANCELLED",
            terminal_status="CANCELLED", changed_by=changed_by, reason=reason,
        )
    else:
        # Ödenmemiş sipariş (PENDING/FAILED): para hareketi yok.
        await order_fsm.transition_order(
            db, order, "CANCELLED", changed_by=changed_by, reason=reason
        )
    await db.commit()
    await notification_service.notify(
        db,
        user_id=order.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message=f"Siparişin #{order.id} iptal edildi"
        + (" ve ödemen iade edildi." if order.payment_status == "REFUNDED" else "."),
        link="/siparislerim",
    )
    await db.commit()
    if order.payment_status == "REFUNDED":
        await _email_order(db, order, "REFUNDED")
    return _to_out(order)


async def cancel_by_client(db: AsyncSession, order: Order) -> OrderOut:
    """Müşteri sipariş iptali."""
    return await _cancel_order(db, order, changed_by="client")


async def cancel_by_admin(db: AsyncSession, order_id: int, *, reason: str) -> OrderOut:
    """Yönetici sipariş iptali — ZORUNLU gerekçeyle (İP-2b R2).

    Booking tarafındaki `/admin/bookings/{id}/cancel` eşdeğeri. Eskiden yoktu:
    yöneticinin tek aracı `PAID` şartlı `refund` ucuydu, dolayısıyla **ödenmemiş
    ya da sorunlu bir siparişi kapatamıyordu**. Gerekçe `order_status_history`
    ve (router'da) `audit_logs` üzerinden izlenebilir kalır.
    """
    order = await _load_full(db, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sipariş bulunamadı")
    return await _cancel_order(db, order, changed_by="admin", reason=reason)


# ── İade talebi (RMA) ──────────────────────────────────────────────────────────────


def _return_to_out(ret: OrderReturn, *, order: Order | None) -> OrderReturnOut:
    titles: dict[int, str] = {}
    if order is not None:
        titles = {it.id: it.title for it in order.items}
    return OrderReturnOut(
        id=ret.id,
        order_id=ret.order_id,
        type=ret.type,
        status=ret.status,
        reason=ret.reason,
        admin_note=ret.admin_note,
        created_at=ret.created_at,
        resolved_at=ret.resolved_at,
        refund_status=ret.refund_status,
        refund_amount=str(ret.refund_amount),
        refunded_at=ret.refunded_at,
        is_partial=ret.is_partial,
        items=[
            OrderReturnItemOut(
                order_item_id=ri.order_item_id,
                title=titles.get(ri.order_item_id),
                quantity=ri.quantity,
                amount=str(ri.amount),
            )
            for ri in (ret.items or [])
        ],
        order=_to_out(order) if order is not None else None,
    )


async def _load_return(db: AsyncSession, return_id: int) -> OrderReturn | None:
    stmt = (
        select(OrderReturn)
        .options(
            # `items` ŞART: _return_to_out onu okur; async oturumda lazy-load
            # MissingGreenlet (500) üretir.
            selectinload(OrderReturn.items),
            selectinload(OrderReturn.order).selectinload(Order.items),
            selectinload(OrderReturn.order).selectinload(Order.returns),
        )
        .where(OrderReturn.id == return_id)
    )
    return (await db.execute(stmt)).scalars().first()


async def request_return(
    db: AsyncSession,
    order: Order,
    reason: str,
    *,
    return_type: str = "DIGER",
    items: list | None = None,
) -> OrderReturnOut:
    """Müşteri iade talebi oluştur.

    ``return_type=CAYMA`` ise talep otomatik onaylanır ve iade hemen başlatılır
    (m.9 koşulsuz cayma hakkı). Diğer türlerde admin incelemesi beklenir.
    ``items`` boşsa siparişin tamamı iade edilir.
    """
    if not order.has_physical:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Dijital ürünlerde iade talebi oluşturulamaz.",
        )
    if order.status not in ("SHIPPED", "DELIVERED"):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Yalnızca kargolanmış veya teslim edilmiş sipariş için iade talebi oluşturulabilir.",
        )
    if order.payment_status != "PAID":
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu siparişte iade edilecek ödeme yok.")
    if any(r.status == ReturnStatus.PENDING.value for r in order.returns):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Bu sipariş için zaten bekleyen bir iade talebin var."
        )
    # Tamamı iade edilmiş sipariş için yeni talep açılamaz; kısmen iade
    # edilmişse kalan tutar için açılabilir.
    if returns.remaining_refundable(
        Decimal(str(order.total)), Decimal(str(order.refunded_amount or 0))
    ) <= 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu sipariş zaten iade edildi.")
    # Cayma hakkında gerekçe İSTENMEZ (koşulsuzdur); diğer türlerde zorunlu.
    if not returns.auto_approved(return_type) and len((reason or "").strip()) < 3:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Bu iade türü için gerekçe yazman gerekiyor.",
        )
    # Teslim edilmişse iade penceresi (RETURN_WINDOW_DAYS) geçmiş olmamalı. Teslim
    # damgası olmayan eski/dijital siparişlerde pencere uygulanmaz.
    deadline = _return_deadline(order)
    if order.status == "DELIVERED" and deadline is not None and _now() > deadline:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"İade süresi doldu (teslimden sonra {RETURN_WINDOW_DAYS} gün).",
        )

    ret = await _build_return(db, order, return_type=return_type, reason=reason, items=items)
    db.add(ret)
    await db.commit()
    # Yalnız sunucu-varsayılanlı skaler alanlar; parametresiz `refresh`
    # `items` ilişkisini expire eder (bkz. _lock_order notu).
    await db.refresh(
        ret, attribute_names=["created_at", "refund_status", "refund_attempts"]
    )

    # Cayma hakkı KOŞULSUZDUR (Mesafeli Sözleşmeler Yönetmeliği m.9): satıcının
    # ret yetkisi olmadığı için admin onayı beklemek hukuken savunulamaz —
    # talep anında onaylanır ve iade süreci başlar.
    if returns.auto_approved(ret.type):
        await _settle_return(db, ret, order, admin_note=None)

    full = await _load_return(db, ret.id)
    return _return_to_out(full or ret, order=order)


async def list_returns_admin(
    db: AsyncSession, *, status_filter: str | None = None, limit: int = 100, offset: int = 0
) -> list[OrderReturnOut]:
    stmt = select(OrderReturn).options(
        selectinload(OrderReturn.items),
        selectinload(OrderReturn.order).selectinload(Order.items),
        selectinload(OrderReturn.order).selectinload(Order.returns),
    )
    if status_filter:
        stmt = stmt.where(OrderReturn.status == status_filter)
    stmt = stmt.order_by(OrderReturn.created_at.desc()).limit(limit).offset(offset)
    rows = (await db.execute(stmt)).scalars().all()
    return [_return_to_out(r, order=r.order) for r in rows]


async def approve_return(
    db: AsyncSession, return_id: int, *, admin_note: str | None = None
) -> OrderReturnOut:
    """Admin iade talebini onaylar → sağlayıcı iadesi + stok geri + sipariş REFUNDED."""
    ret = await _load_return(db, return_id)
    if ret is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "İade talebi bulunamadı")
    if ret.status != ReturnStatus.PENDING.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu talep zaten sonuçlandırılmış")
    order = ret.order
    await _settle_return(db, ret, order, admin_note=admin_note)
    await notification_service.notify(
        db,
        user_id=order.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message=f"#{order.id} siparişin için iade talebin onaylandı; ödemen iade edildi.",
        link="/siparislerim",
    )
    await db.commit()
    await _email_order(db, order, "REFUNDED")
    return _return_to_out(ret, order=order)


async def reject_return(
    db: AsyncSession, return_id: int, *, admin_note: str | None = None
) -> OrderReturnOut:
    """Admin iade talebini reddeder (sipariş durumu değişmez)."""
    ret = await _load_return(db, return_id)
    if ret is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "İade talebi bulunamadı")
    if ret.status != ReturnStatus.PENDING.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu talep zaten sonuçlandırılmış")
    if returns.auto_approved(ret.type):
        # m.9: cayma hakkı koşulsuzdur, satıcı reddedemez. Bu durum normalde
        # oluşmaz (cayma talepleri otomatik onaylanır) ama veri elle
        # değiştirilirse yasal ihlali kod düzeyinde engelliyoruz.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Cayma hakkı kapsamındaki talep reddedilemez (14 gün koşulsuzdur).",
        )
    ret.status = ReturnStatus.REJECTED.value
    ret.admin_note = admin_note
    ret.resolved_at = _now()
    order = ret.order
    await db.commit()
    await notification_service.notify(
        db,
        user_id=order.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message=f"#{order.id} siparişin için iade talebin reddedildi."
        + (f" Not: {admin_note}" if admin_note else ""),
        link="/siparislerim",
    )
    await db.commit()
    return _return_to_out(ret, order=order)


# ── İade talebi kurulumu ve yürütülmesi ──────────────────────────────────────


class _Selection:
    """Kalem seçimi (istemci göndermezse siparişin tamamı için üretilir)."""

    __slots__ = ("order_item_id", "quantity")

    def __init__(self, order_item_id: int, quantity: int) -> None:
        self.order_item_id = order_item_id
        self.quantity = quantity


async def _build_return(
    db: AsyncSession,
    order: Order,
    *,
    return_type: str,
    reason: str,
    items: list | None,
) -> OrderReturn:
    """Talebi ve kalemlerini kurar; tutarı SUNUCUDA hesaplar.

    İstemci tutar göndermez — yalnız hangi kalemden kaç adet istediğini söyler.
    Tutar sipariş anındaki fiyatlardan, kupon payı düşülerek hesaplanır.
    """
    by_id = {it.id: it for it in order.items}
    selection = items or [_Selection(it.id, it.quantity) for it in order.items]

    lines: list[dict] = []
    for sel in selection:
        item = by_id.get(sel.order_item_id)
        if item is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Bu siparişte olmayan bir kalem seçildi."
            )
        if sel.quantity > item.quantity:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"'{item.title}' için en fazla {item.quantity} adet iade edilebilir.",
            )
        lines.append(
            {
                "item": item,
                "unit_price": Decimal(str(item.unit_price)),
                "quantity": item.quantity,
                "refund_quantity": int(sel.quantity),
            }
        )

    is_full = returns.is_full_return(lines)
    amount = returns.compute_refund(
        lines=lines,
        order_subtotal=Decimal(str(order.subtotal)),
        order_discount=Decimal(str(order.discount or 0)),
        order_shipping=Decimal(str(order.shipping_fee or 0)),
        is_full_order=is_full,
    )
    # Kümülatif tavan: birden çok kısmi iadenin toplamı sipariş tutarını aşamaz
    # (aşırı iade sağlayıcıda reddedilir ve mutabakatı bozar).
    cap = returns.remaining_refundable(
        Decimal(str(order.total)), Decimal(str(order.refunded_amount or 0))
    )
    amount = min(amount, cap)

    ret = OrderReturn(
        order_id=order.id,
        client_id=order.client_id,
        type=return_type,
        reason=(reason or "").strip(),
        status=(
            ReturnStatus.APPROVED.value
            if returns.auto_approved(return_type)
            else ReturnStatus.PENDING.value
        ),
        refund_amount=amount,
        is_partial=not is_full,
    )
    for ln in lines:
        ret.items.append(
            OrderReturnItem(
                order_item_id=ln["item"].id,
                quantity=ln["refund_quantity"],
                amount=returns.line_refund_amount(
                    ln["unit_price"],
                    ln["quantity"],
                    refund_quantity=ln["refund_quantity"],
                ),
            )
        )
    return ret


async def _restock_items(db: AsyncSession, order: Order, ret: OrderReturn) -> None:
    """İade edilen FİZİKSEL kalemlerin stoğunu **deftere yazarak** geri yükler.

    İade SATIRI başına bir `RETURN` hareketi (`return_line:{id}:RETURN`) —
    aynı üründen iki iade satırı iki geçerli harekettir.

    ⚠️ Yalnız **sağlayıcı iadesi başarılı olduktan sonra** çağrılmalıdır.
    """
    by_id = {it.id: it for it in order.items}
    lines = []
    for ri in ret.items:
        item = by_id.get(ri.order_item_id)
        if item is None or item.kind != ProductKind.PHYSICAL.value:
            continue
        if item.product_id is None:
            continue
        lines.append((ri, item))
    if not lines:
        return

    # Fazla geri yükleme tavanı: `satılan − şimdiye kadar geri yüklenen`
    # (bkz. `_restock` docstring'i). Bir iade satırı bu tavanı aşıyorsa —
    # sipariş önce tam iptal edilmiş ve sonra iade onaylanmış olabilir —
    # kırpılan miktar HAREKETİN kendisine ve loga yazılır; sessiz kalmaz.
    await stock_ledger.lock_products(db, [item.product_id for _, item in lines])
    geri_yuklenen = await stock_ledger.restored_quantity_by_order_item(
        db, [item.id for _, item in lines]
    )
    specs: list[dict] = []
    for ri, item in lines:
        tavan = int(item.quantity) - int(geri_yuklenen.get(item.id, 0))
        adet = min(int(ri.quantity), max(tavan, 0))
        if adet <= 0:
            logger.error(
                "iade satırı %s: geri yüklenecek adet kalmadı (kalem %s satılan %s, "
                "önceden geri yüklenen %s) — stok artırılmadı",
                ri.id, item.id, item.quantity, geri_yuklenen.get(item.id, 0),
            )
            continue
        specs.append(
            {
                "product_id": item.product_id,
                "qty_delta": adet,
                # İade satılabilir kovaya geri yüklenir. Hasarlı gelen iadenin
                # hasarlı kovaya alınması F29 hasar servisinin işidir.
                "bucket": stock_ledger.StockBucket.SALEABLE,
                "movement_type": stock_ledger.StockMovementType.RETURN,
                "reason_code": "RETURN_ACCEPTED",
                "ref_type": "order_return",
                "ref_id": ret.id,
                "ref_line_id": ri.id,
                "idempotency_key": stock_ledger.idempotency_key_for(
                    stock_ledger.StockMovementType.RETURN, return_item_id=ri.id
                ),
                "note": (
                    None
                    if adet == int(ri.quantity)
                    else (
                        f"tavan uygulandı: talep {ri.quantity}, uygulanan {adet} "
                        f"(kalem {item.id} satılan {item.quantity})"
                    )
                ),
            }
        )
    if specs:
        await stock_ledger.apply_many(db, specs)


async def _settle_return(
    db: AsyncSession,
    ret: OrderReturn,
    order: Order,
    *,
    admin_note: str | None,
) -> None:
    """Onaylanmış talebin parasını iade eder (iki fazlı) ve stoğu geri yükler.

    Para durumu TALEP üzerinde izlenir: bir siparişte birden çok kısmi iade
    olabileceğinden ``order.payment_status`` tek başına yeterli değildir. Kısmi
    iadede sipariş PAID kalır (mal kısmen müşterededir); yalnız kalan iade
    edilebilir tutar sıfırlanınca REFUNDED'a geçer.
    """
    await _lock_order(db, order)

    amount = Decimal(str(ret.refund_amount or 0))
    if order.payment_status not in ("PAID", "REFUNDING") or amount <= 0:
        # Ödeme yok ya da iade edilecek tutar kalmadı → yalnız talebi kapat.
        ret.status = ReturnStatus.APPROVED.value
        ret.admin_note = admin_note
        ret.resolved_at = _now()
        await db.commit()
        return

    # ── Faz 1: niyet (talep bazında) ──
    # Kısmi iade, "sağlayıcı ikinci TAM iadeyi reddeder" idempotency'sini
    # geçersiz kılar; bu yüzden her iade kendi durumu ve deneme sayacıyla
    # izlenir.
    claimed = await escrow.claim(
        db,
        OrderReturn,
        ret.id,
        from_statuses=[ReturnRefundStatus.NONE.value],
        values={
            "refund_status": ReturnRefundStatus.REFUNDING.value,
            "refund_requested_at": _now(),
            "refund_attempts": OrderReturn.refund_attempts + 1,
        },
        status_attr="refund_status",
    )
    if not claimed:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Bu talebin iadesi zaten işleniyor."
        )
    ret.status = ReturnStatus.APPROVED.value
    ret.admin_note = admin_note
    ret.resolved_at = _now()
    await db.commit()  # niyet kalıcı — süreç burada ölse kayıt REFUNDING kalır
    await db.refresh(
        ret, attribute_names=["refund_status", "refund_attempts", "refund_requested_at"]
    )

    # ── Ürün kilitleri: sağlayıcıdan ÖNCE (kanonik sıra; bkz. `_refund_payment`) ──
    # Aşağıdaki `ret`/`order` yazımları Return ve Order kilidi alır; ürün kilidini
    # onlardan sonra almak bu yolu `Return/Order → Product` yapar ve
    # `_finalize_paid` ile deadlock döngüsü kurar.
    await _lock_order_products(db, order)

    # ── Faz 2: sağlayıcı ──
    #
    # Sıra bilinçli olarak DEĞİŞTİ (commit 5): stok ve kupon telafisi eskiden
    # sağlayıcı çağrısından ÖNCE yapılıyordu; sağlayıcı reddettiğinde para
    # dönmemişken mal geri gelmiş sayılıyor ve satılabilir görünüyordu.
    provider = payments.get_payment_provider()
    ok = await provider.refund(provider_ref=order.provider_ref, amount=amount)
    if not ok:
        # **STOK ARTMAZ.** Reconciler devralır; tekrar denemede telafiler
        # `return_line:{id}:RETURN` anahtarı sayesinde TEK KEZ uygulanır.
        await db.commit()
        logger.error(
            "iade talebi %s: sağlayıcı reddetti — REFUNDING'de bırakıldı (order=%s)",
            ret.id,
            order.id,
        )
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "İade şu an tamamlanamadı; kaydedildi ve yeniden denenecek.",
        )

    # ── Yerel telafiler (yalnız iade tamamlandıysa) ──
    await _restock_items(db, order, ret)
    if not ret.is_partial and order.coupon_id is not None:
        # Kupon yalnız TAM iadede serbest bırakılır; kısmi iadede sipariş
        # ayaktadır ve kupon tüketilmiş sayılır.
        await coupon_service.release(db, coupon_id=order.coupon_id, order_id=order.id)

    ret.refund_status = ReturnRefundStatus.REFUNDED.value
    ret.refunded_at = _now()
    order.refunded_amount = Decimal(str(order.refunded_amount or 0)) + amount

    # Sipariş tamamen iade edildiyse durumunu da güncelle.
    if (
        returns.remaining_refundable(
            Decimal(str(order.total)), Decimal(str(order.refunded_amount))
        )
        <= 0
    ):
        order.payment_status = OrderPaymentStatus.REFUNDED.value
        order.refunded_at = _now()
        await order_fsm.transition_order(db, order, "REFUNDED", changed_by="admin")

    await db.commit()
    await notification_service.notify(
        db,
        user_id=order.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message=(
            f"#{order.id} siparişin için {amount} {order.currency} iade edildi."
            if ret.is_partial
            else f"#{order.id} siparişin için ödemen iade edildi."
        ),
        link="/siparislerim",
    )
    await db.commit()
