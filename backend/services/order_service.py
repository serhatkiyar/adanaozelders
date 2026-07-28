"""Mağaza sipariş + ödeme iş mantığı (doğrudan satış — escrow DEĞİL).

Akış: sepet → sunucu fiyat/stok doğrular → PENDING sipariş + charge → fake'te anında
PAID, iyzico'da redirect_url + callback ``complete_checkout``. PAID olunca: dijital
teslim açılır, fiziksel stok düşer, eğitmen dijital kalemlerinin payı (komisyon
düşülerek) hesaplanıp kazanca yazılır (Balance sayfası ``payment_service`` ile birleştirir).

``compute_totals`` saf fonksiyondur (pytest'li).
"""
from __future__ import annotations

import datetime
import logging
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core import outbox, payments
from core.config import settings
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
    OrderReturn,
    Product,
    ProductKind,
    ProductStatus,
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
    OrderReturnOut,
)
from services import (
    commission,
    coupon_service,
    delivery_calendar,
    delivery_promise,
    escrow,
    notification_service,
    order_fsm,
)

logger = logging.getLogger("adana.order")


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
    needed: dict[int, int] = {}
    for item in order.items:
        if item.kind == ProductKind.PHYSICAL.value and item.product_id is not None:
            needed[item.product_id] = needed.get(item.product_id, 0) + item.quantity
    locked: dict[int, Product] = {}
    for pid in needed:
        p = (
            await db.execute(
                select(Product).where(Product.id == pid).with_for_update()
            )
        ).scalars().first()
        if p is not None:
            locked[pid] = p
    shortages = [
        locked[pid].title
        for pid, qty in needed.items()
        if pid in locked and locked[pid].stock is not None and locked[pid].stock < qty
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

    for item in order.items:
        # Fiziksel stok düş (yukarıda kilitlenen satırlar üzerinden; atomik).
        if item.kind == ProductKind.PHYSICAL.value and item.product_id is not None:
            p = locked.get(item.product_id)
            if p is not None and p.stock is not None:
                p.stock = max(0, p.stock - item.quantity)
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
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sipariş bulunamadı")
    if client_id is not None and order.client_id != client_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sizin siparişiniz değil")
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
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sipariş bulunamadı")
    if order.client_id != client_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sizin siparişiniz değil")
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
    if not order.has_physical:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Bu siparişte kargolanacak ürün yok"
        )
    if order.payment_status != "PAID":
        raise HTTPException(status.HTTP_409_CONFLICT, "Ödenmemiş sipariş kargolanamaz")
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
    order = await _load_full(db, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sipariş bulunamadı")
    # FSM: yalnız SHIPPED → DELIVERED (önceden ön-koşulsuzdu; PENDING'den bile olurdu).
    await order_fsm.transition_order(db, order, "DELIVERED", changed_by="admin")
    await db.commit()
    await _email_order(db, order, "DELIVERED")
    return _to_out(order)


async def _restock(db: AsyncSession, order: Order) -> None:
    """Fiziksel kalemlerin stoğunu satır kilidiyle geri yükle (iptal/iade)."""
    for item in order.items:
        if item.kind == ProductKind.PHYSICAL.value and item.product_id is not None:
            p = (
                await db.execute(
                    select(Product).where(Product.id == item.product_id).with_for_update()
                )
            ).scalars().first()
            if p is not None and p.stock is not None:
                p.stock += item.quantity


async def _refund_payment(db: AsyncSession, order: Order) -> None:
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

    # Yerel telafiler iadeyle AYNI transaction'da: sağlayıcı onayladıysa stok ve
    # kupon da geri döner; onaylamadıysa REFUNDING'de kalır ve reconciler retry'lar.
    await _restock(db, order)
    if order.coupon_id is not None:
        # Kupon kullanımı yalnız PAID'de sayılmıştı → geri sal.
        await coupon_service.release(db, coupon_id=order.coupon_id, order_id=order.id)

    if not await escrow.perform_refund(db, order, escrow.ORDER_SPEC):
        # Sağlayıcı reddetti/ulaşılamadı: REFUNDING'de bırakılır (HELD'e geri
        # dönüş YOK). Reconciler karantina penceresi sonrası devralır.
        await db.commit()
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Sağlayıcı iadesi şu an tamamlanamadı; iade kaydedildi ve "
            "otomatik olarak yeniden denenecek.",
        )


async def refund_order(db: AsyncSession, order_id: int) -> OrderOut:
    """Siparişi iade et (sağlayıcı refund + REFUNDED). Stok geri yüklenir."""
    order = await _load_full(db, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sipariş bulunamadı")
    await _lock_order(db, order)
    if order.payment_status != "PAID":
        raise HTTPException(status.HTTP_409_CONFLICT, "Yalnızca ödenmiş sipariş iade edilebilir")
    await _refund_payment(db, order)
    await order_fsm.transition_order(db, order, "REFUNDED", changed_by="admin")
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


async def cancel_by_client(db: AsyncSession, order: Order) -> OrderOut:
    """Müşteri sipariş iptali: yalnız kargolanmadan. Ödenmişse sağlayıcı iadesi + stok
    geri yükleme. Kargolanmış/teslim sipariş iptal edilemez (iade talebi gerekir)."""
    await _lock_order(db, order)
    if order.status in ("SHIPPED", "DELIVERED"):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Kargolanmış sipariş iptal edilemez; iade talebi oluşturun.",
        )
    if order.status in ("CANCELLED", "REFUNDED"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu sipariş zaten iptal/iade edilmiş")

    if order.payment_status == "PAID":
        await _refund_payment(db, order)
    await order_fsm.transition_order(db, order, "CANCELLED", changed_by="client")
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


# ── İade talebi (RMA) ──────────────────────────────────────────────────────────────


def _return_to_out(ret: OrderReturn, *, order: Order | None) -> OrderReturnOut:
    return OrderReturnOut(
        id=ret.id,
        order_id=ret.order_id,
        status=ret.status,
        reason=ret.reason,
        admin_note=ret.admin_note,
        created_at=ret.created_at,
        resolved_at=ret.resolved_at,
        order=_to_out(order) if order is not None else None,
    )


async def _load_return(db: AsyncSession, return_id: int) -> OrderReturn | None:
    stmt = (
        select(OrderReturn)
        .options(
            selectinload(OrderReturn.order).selectinload(Order.items),
            selectinload(OrderReturn.order).selectinload(Order.returns),
        )
        .where(OrderReturn.id == return_id)
    )
    return (await db.execute(stmt)).scalars().first()


async def request_return(db: AsyncSession, order: Order, reason: str) -> OrderReturnOut:
    """Müşteri iade talebi oluştur. Yalnız kargolanmış/teslim edilmiş, ödenmiş fiziksel
    sipariş için; sipariş başına tek açık talep (DB kısmi unique index de korur)."""
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
    if any(r.status == ReturnStatus.APPROVED.value for r in order.returns):
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu sipariş zaten iade edildi.")
    # Teslim edilmişse iade penceresi (RETURN_WINDOW_DAYS) geçmiş olmamalı. Teslim
    # damgası olmayan eski/dijital siparişlerde pencere uygulanmaz.
    deadline = _return_deadline(order)
    if order.status == "DELIVERED" and deadline is not None and _now() > deadline:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"İade süresi doldu (teslimden sonra {RETURN_WINDOW_DAYS} gün).",
        )

    ret = OrderReturn(
        order_id=order.id,
        client_id=order.client_id,
        reason=reason,
        status=ReturnStatus.PENDING.value,
    )
    db.add(ret)
    await db.commit()
    await db.refresh(ret)
    return _return_to_out(ret, order=None)


async def list_returns_admin(
    db: AsyncSession, *, status_filter: str | None = None, limit: int = 100, offset: int = 0
) -> list[OrderReturnOut]:
    stmt = select(OrderReturn).options(
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
    await _lock_order(db, order)
    if order.payment_status == "PAID":
        await _refund_payment(db, order)
        await order_fsm.transition_order(db, order, "REFUNDED", changed_by="admin")
    ret.status = ReturnStatus.APPROVED.value
    ret.admin_note = admin_note
    ret.resolved_at = _now()
    await db.commit()
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
