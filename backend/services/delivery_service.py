"""Kendi-filo teslimat iş mantığı (Faz A).

Günlük tur FSM'i: PLANNED (durak ekle/çıkar/sırala) → ACTIVE (sahada; siparişler
SHIPPED) → DONE. Teslim: paket QR'ı doğru paketi, müşteriye SMS'lenen OTP doğru
alıcıyı kanıtlar; kod ulaşmazsa notlu yönetici teslimi (ADMIN proof) kaçış yoludur.
Teslim edilemeyen durak FAILED olur ve sipariş PAID'e döner — ertesi günün turuna
yeniden eklenebilir. Rota sırası Faz A'da elle; Faz B'de VROOM yazacak.

Saf yardımcılar (``parse_qr_token``/``hash_otp``/``validate_reorder``) pytest'lidir.
"""
from __future__ import annotations

import datetime
import hashlib
import secrets

from fastapi import HTTPException, status
from sqlalchemy import func, select, true as sa_true, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core import courier_position, outbox, routing, sms
from core.config import settings
from core.routing.haversine import haversine_km
from models.admin import Admin
from models.courier import Courier
from models.delivery import (
    DeliveryProof,
    DeliveryRun,
    DeliveryRunStatus,
    DeliveryStop,
    DeliveryStopStatus,
    FailReason,
)
from models.role import ROLE_IDS, RoleType
from models.store import DeliveryPref, Order, OrderStatusHistory
from schemas.delivery import (
    CourierCreate,
    CourierOut,
    CourierUpdate,
    DeliveryRunCreate,
    DeliveryRunOut,
    DeliveryRunUpdate,
    DeliveryStopOut,
    CapacityDayOut,
    EligibleOrderOut,
    OrderTrackingOut,
    StopItemOut,
    TimelineEventOut,
)
from services import (
    delivery_calendar,
    delivery_promise,
    notification_service,
    order_fsm,
    order_service,
)
from services.delivery_timeline import eta_window, mask_recipient, project_customer_timeline

_ACTIVE_RUN_STATUSES = (DeliveryRunStatus.PLANNED.value, DeliveryRunStatus.ACTIVE.value)


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


# ── Saf yardımcılar (pytest) ──────────────────────────────────────────────────────


def parse_qr_token(payload: str) -> str:
    """QR içeriğinden token'ı çıkarır — deneme bileti deseniyle aynı:
    "{stop_id}:{token}" ya da salt token kabul edilir."""
    token = payload.strip()
    if ":" in token:
        token = token.split(":", 1)[1]
    return token


def new_qr_token() -> str:
    return secrets.token_urlsafe(24)


def gen_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_otp(code: str) -> str:
    return hashlib.sha256(code.strip().encode("utf-8")).hexdigest()


def validate_reorder(current_ids: list[int], new_ids: list[int]) -> bool:
    """Yeni sıra mevcut durakların tam bir permütasyonu mu? (saf)"""
    return len(new_ids) == len(set(new_ids)) and set(new_ids) == set(current_ids)


def otp_expired(sent_at: datetime.datetime | None, now: datetime.datetime) -> bool:
    """OTP süresi doldu mu? Hiç gönderilmemişse de 'geçersiz' sayılır (saf)."""
    if sent_at is None:
        return True
    return sent_at + datetime.timedelta(minutes=settings.DELIVERY_OTP_TTL_MINUTES) <= now


def compute_detours(
    depot: tuple[float, float], ordered: list[tuple[float, float]]
) -> list[float]:
    """Sıralı rotada her durağın 'rotaya kattığı ek yol' (km, kuş uçuşu) — saf.

    detour_i = d(önceki, i) + d(i, sonraki) − d(önceki, sonraki). Son durakta
    sonraki yoktur; ek yol = d(önceki, i). Eşiği aşanlar panelde "rotayı bozan"
    (dış kuryeye devretme adayı) olarak işaretlenir.
    """
    out: list[float] = []
    for i, cur in enumerate(ordered):
        prev = depot if i == 0 else ordered[i - 1]
        nxt = ordered[i + 1] if i + 1 < len(ordered) else None
        if nxt is None:
            detour = haversine_km(prev[0], prev[1], cur[0], cur[1])
        else:
            detour = (
                haversine_km(prev[0], prev[1], cur[0], cur[1])
                + haversine_km(cur[0], cur[1], nxt[0], nxt[1])
                - haversine_km(prev[0], prev[1], nxt[0], nxt[1])
            )
        out.append(round(max(detour, 0.0), 1))
    return out


# ── Dönüştürme ────────────────────────────────────────────────────────────────────


def _stop_to_out(stop: DeliveryStop) -> DeliveryStopOut:
    order = stop.order
    return DeliveryStopOut(
        id=stop.id,
        run_id=stop.run_id,
        order_id=stop.order_id,
        sequence=stop.sequence,
        status=stop.status,
        qr_payload=f"{stop.id}:{stop.qr_token}",
        recipient=order.ship_recipient,
        phone=order.ship_phone,
        address=order.ship_address,
        lat=float(order.ship_lat) if order.ship_lat is not None else None,
        lng=float(order.ship_lng) if order.ship_lng is not None else None,
        items=[
            StopItemOut(title=it.title, quantity=it.quantity)
            for it in order.items
            if it.kind == "PHYSICAL"
        ],
        order_total=str(order.total),
        delivery_pref=order.delivery_pref,
        delivery_pref_note=order.delivery_pref_note,
        eta=stop.eta,
        detour_km=float(stop.detour_km) if stop.detour_km is not None else None,
        is_outlier=(
            stop.detour_km is not None
            and float(stop.detour_km) >= settings.DELIVERY_DETOUR_KM
        ),
        otp_sent_at=stop.otp_sent_at,
        delivered_at=stop.delivered_at,
        proof=stop.proof,
        photo_url=stop.photo_url,
        courier_note=stop.courier_note,
        promised_delivery_date=order.promised_delivery_date,
        failed_attempts=order.failed_delivery_count,
        fail_reason=stop.fail_reason,
    )


def _courier_to_out(c: Courier) -> CourierOut:
    return CourierOut(
        id=c.id,
        name=c.name,
        phone=c.phone,
        photo_url=c.photo_url,
        vehicle_plate=c.vehicle_plate,
        is_active=c.is_active,
    )


def _run_to_out(run: DeliveryRun) -> DeliveryRunOut:
    return DeliveryRunOut(
        courier=_courier_to_out(run.courier) if run.courier is not None else None,
        id=run.id,
        run_date=run.run_date,
        vehicle=run.vehicle,
        status=run.status,
        notes=run.notes,
        started_at=run.started_at,
        completed_at=run.completed_at,
        created_at=run.created_at,
        depot_lat=settings.DELIVERY_DEPOT_LAT,
        depot_lng=settings.DELIVERY_DEPOT_LNG,
        optimized_at=run.optimized_at,
        optimize_provider=run.optimize_provider,
        total_distance_km=(
            float(run.total_distance_km) if run.total_distance_km is not None else None
        ),
        total_duration_seconds=run.total_duration_seconds,
        route_geometry=run.route_geometry,
        stops=[_stop_to_out(s) for s in run.stops],
    )


_RUN_LOAD = (
    selectinload(DeliveryRun.stops)
    .selectinload(DeliveryStop.order)
    .selectinload(Order.items),
    selectinload(DeliveryRun.courier),
)


async def _load_run(db: AsyncSession, run_id: int) -> DeliveryRun:
    run = (
        await db.execute(
            select(DeliveryRun)
            .options(*_RUN_LOAD)
            .where(DeliveryRun.id == run_id, DeliveryRun.deleted_at.is_(None))
        )
    ).scalars().first()
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dağıtım turu bulunamadı")
    return run


async def _load_stop(db: AsyncSession, stop_id: int) -> DeliveryStop:
    stop = (
        await db.execute(
            select(DeliveryStop)
            .options(
                selectinload(DeliveryStop.run),
                selectinload(DeliveryStop.order).selectinload(Order.items),
            )
            .where(DeliveryStop.id == stop_id)
        )
    ).scalars().first()
    if stop is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Durak bulunamadı")
    return stop


# ── Tur CRUD / FSM ────────────────────────────────────────────────────────────────


async def _require_courier(db: AsyncSession, courier_id: int) -> Courier:
    c = await db.get(Courier, courier_id)
    if c is None or c.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kurye bulunamadı")
    if not c.is_active:
        raise HTTPException(status.HTTP_409_CONFLICT, "Kurye pasif — tura atanamaz")
    return c


async def create_run(db: AsyncSession, payload: DeliveryRunCreate) -> DeliveryRunOut:
    if payload.courier_id is not None:
        await _require_courier(db, payload.courier_id)
    # Gün+araç başına tek PLANLI tur (uq_delivery_run_planned otorite; bu
    # kontrol dostça Türkçe mesaj için). Önceki tur ACTIVE/DONE ise yenisi serbest.
    existing = (
        await db.execute(
            select(DeliveryRun.id).where(
                DeliveryRun.run_date == payload.run_date,
                DeliveryRun.vehicle == payload.vehicle,
                DeliveryRun.status == DeliveryRunStatus.PLANNED.value,
                DeliveryRun.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Bu gün için {payload.vehicle} aracında zaten planlı bir tur var (#{existing})",
        )
    run = DeliveryRun(
        run_date=payload.run_date,
        vehicle=payload.vehicle,
        notes=payload.notes,
        courier_id=payload.courier_id,
        status=DeliveryRunStatus.PLANNED.value,
    )
    db.add(run)
    await db.commit()
    return await get_run(db, run.id)


async def update_run(
    db: AsyncSession, run_id: int, payload: DeliveryRunUpdate
) -> DeliveryRunOut:
    """Tur meta güncellemesi — şimdilik yalnız kurye ataması (DONE/CANCELLED'da
    da serbest: geçmiş tura kayıt düzeltmesi zararsız)."""
    run = await _load_run(db, run_id)
    if payload.courier_id is not None:
        await _require_courier(db, payload.courier_id)
    run.courier_id = payload.courier_id
    await db.commit()
    return await get_run(db, run_id)


# ── Kurye profili CRUD ────────────────────────────────────────────────────────────


async def list_couriers(db: AsyncSession, *, include_inactive: bool = True) -> list[CourierOut]:
    stmt = select(Courier).where(Courier.deleted_at.is_(None)).order_by(Courier.id)
    if not include_inactive:
        stmt = stmt.where(Courier.is_active.is_(True))
    rows = (await db.execute(stmt)).scalars().all()
    return [_courier_to_out(c) for c in rows]


async def create_courier(db: AsyncSession, payload: CourierCreate) -> CourierOut:
    c = Courier(name=payload.name, phone=payload.phone, vehicle_plate=payload.vehicle_plate)
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return _courier_to_out(c)


async def update_courier(
    db: AsyncSession, courier_id: int, payload: CourierUpdate
) -> CourierOut:
    c = await db.get(Courier, courier_id)
    if c is None or c.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kurye bulunamadı")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(c, field, value)
    await db.commit()
    await db.refresh(c)
    return _courier_to_out(c)


async def set_courier_photo(db: AsyncSession, courier_id: int, photo_url: str) -> CourierOut:
    c = await db.get(Courier, courier_id)
    if c is None or c.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kurye bulunamadı")
    c.photo_url = photo_url
    await db.commit()
    await db.refresh(c)
    return _courier_to_out(c)


async def delete_courier(db: AsyncSession, courier_id: int) -> None:
    c = await db.get(Courier, courier_id)
    if c is None or c.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kurye bulunamadı")
    c.deleted_at = _now()
    await db.commit()


async def list_runs(
    db: AsyncSession, *, run_date: datetime.date | None = None, limit: int = 30
) -> list[DeliveryRunOut]:
    stmt = (
        select(DeliveryRun)
        .options(*_RUN_LOAD)
        .where(DeliveryRun.deleted_at.is_(None))
        .order_by(DeliveryRun.run_date.desc(), DeliveryRun.id.desc())
        .limit(limit)
    )
    if run_date is not None:
        stmt = stmt.where(DeliveryRun.run_date == run_date)
    runs = (await db.execute(stmt)).scalars().all()
    return [_run_to_out(r) for r in runs]


async def get_run(db: AsyncSession, run_id: int) -> DeliveryRunOut:
    return _run_to_out(await _load_run(db, run_id))


async def cancel_run(db: AsyncSession, run_id: int) -> DeliveryRunOut:
    """Turu iptal et: bekleyen durakların siparişleri PAID'e döner (yeniden
    planlanabilir); teslim edilmişler olduğu gibi kalır."""
    run = await _load_run(db, run_id)
    if run.status not in _ACTIVE_RUN_STATUSES:
        raise HTTPException(status.HTTP_409_CONFLICT, "Yalnız planlı/aktif tur iptal edilebilir")
    for stop in run.stops:
        if stop.status != DeliveryStopStatus.PENDING.value:
            continue
        # Kilit + taze durum: kurye tam bu anda teslim etmiş olabilir —
        # sonuçlanmış durak/sipariş iptal geri sarımıyla EZİLMEZ.
        await _lock_stop_and_order(db, stop)
        if stop.status != DeliveryStopStatus.PENDING.value:
            continue
        if stop.order.status == "SHIPPED":
            await order_fsm.transition_order(
                db, stop.order, "PAID", changed_by="admin", reason="Tur iptal edildi"
            )
            stop.order.tracking_no = None
        stop.status = DeliveryStopStatus.FAILED.value
        stop.courier_note = stop.courier_note or "Tur iptal edildi"
    run.status = DeliveryRunStatus.CANCELLED.value
    await db.commit()
    await courier_position.clear_position(run_id)
    return await get_run(db, run_id)


async def start_run(db: AsyncSession, run_id: int) -> DeliveryRunOut:
    """PLANNED → ACTIVE: siparişler 'dağıtımda' (SHIPPED) olur, müşteriler bilgilenir.

    Savunma: dağıtıma uygun olmayan (ör. bu arada iptal/iade edilmiş) siparişin
    durağı turu BLOKLAMAZ — durak CANCELLED'a kapanır, kalanlarla devam edilir.
    SMS'ler outbox'ta aynı transaction'a yazılır: tur geri alınırsa "kurye yola
    çıktı" SMS'i de gitmez. ETA'lar optimize anına göre hesaplanmıştı — tur
    fiilen şimdi başladığından aradaki gecikme kadar ileri kaydırılır (müşteriye
    bayat pencere sözü verilmez)."""
    run = await _load_run(db, run_id)
    if run.status != DeliveryRunStatus.PLANNED.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Yalnız planlı tur başlatılabilir")
    if not run.stops:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Turda hiç durak yok")

    shipped = 0
    for stop in run.stops:
        if stop.status != DeliveryStopStatus.PENDING.value:
            continue
        order = stop.order
        if not order_fsm.can_transition(order.status, "SHIPPED"):
            # order_fsm iptal/iadede durağı kapatır; yine de kaçak kaldıysa
            # (eski veri) tek durak tüm turu düşürmesin.
            stop.status = DeliveryStopStatus.CANCELLED.value
            stop.courier_note = (
                stop.courier_note or f"Dağıtıma uygun değil (sipariş {order.status})"
            )
            continue
        await order_fsm.transition_order(db, order, "SHIPPED", changed_by="courier")
        order.tracking_no = f"ELDEN-R{run.id}-S{stop.id}"
        await notification_service.notify(
            db,
            user_id=order.client_id,
            role_id=ROLE_IDS[RoleType.CLIENT],
            message=f"Siparişin #{order.id} bugün dağıtımda — kuryemiz yola çıktı.",
            link="/siparislerim",
        )
        _enqueue_tracking_link(db, order)
        shipped += 1

    if shipped == 0:
        # Kapanan kaçak duraklar kalıcı olsun; tur PLANNED kalır.
        await db.commit()
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Turda dağıtıma uygun durak kalmadı"
        )
    run.status = DeliveryRunStatus.ACTIVE.value
    run.started_at = _now()
    if run.optimized_at is not None:
        # ETA'lar "depo çıkışı = optimize anı" varsayımıyla yazılmıştı;
        # gerçek çıkış anına taşı (offset'ler korunur).
        delta = run.started_at - run.optimized_at
        for stop in run.stops:
            if stop.status == DeliveryStopStatus.PENDING.value and stop.eta is not None:
                stop.eta = stop.eta + delta
    await db.commit()
    return await get_run(db, run_id)


async def complete_run(db: AsyncSession, run_id: int) -> DeliveryRunOut:
    run = await _load_run(db, run_id)
    if run.status != DeliveryRunStatus.ACTIVE.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Yalnız aktif tur tamamlanabilir")
    if any(s.status == DeliveryStopStatus.PENDING.value for s in run.stops):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Bekleyen durak var — önce teslim et ya da 'teslim edilemedi' işaretle.",
        )
    run.status = DeliveryRunStatus.DONE.value
    run.completed_at = _now()
    await db.commit()
    await courier_position.clear_position(run_id)
    return await get_run(db, run_id)


async def expire_stale_runs(db: AsyncSession) -> int:
    """Watchdog (main.py arka plan döngüsü): ``DELIVERY_STALE_RUN_HOURS``'tan
    uzun süredir ACTIVE kalan turları kapatır — kurye telefonu öldü ya da tur
    tamamlanmadı; siparişler SHIPPED'de süresiz asılı kalmasın.

    Bekleyen duraklar FAILED olur, siparişler PAID'e döner (yeniden planlanır),
    müşteriye bildirim + SMS (outbox) gider, adminlere alarm düşer. Kapatılan
    tur sayısını döner. 0 = kapalı."""
    hours = settings.DELIVERY_STALE_RUN_HOURS
    if hours <= 0:
        return 0
    cutoff = _now() - datetime.timedelta(hours=hours)
    runs = (
        await db.execute(
            select(DeliveryRun)
            .options(*_RUN_LOAD)
            .where(
                DeliveryRun.status == DeliveryRunStatus.ACTIVE.value,
                DeliveryRun.started_at.is_not(None),
                DeliveryRun.started_at < cutoff,
                DeliveryRun.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    if not runs:
        return 0
    admin_ids = (
        await db.execute(select(Admin.id).where(Admin.deleted_at.is_(None)))
    ).scalars().all()
    closed_dates = await _closed_dates_now(db)
    for run in runs:
        for stop in run.stops:
            if stop.status != DeliveryStopStatus.PENDING.value:
                continue
            await _lock_stop_and_order(db, stop)
            if stop.status != DeliveryStopStatus.PENDING.value:
                continue
            order = stop.order
            if order.status == "SHIPPED":
                await order_fsm.transition_order(
                    db, order, "PAID",
                    changed_by="system:watchdog",
                    reason="Tur zaman aşımıyla kapatıldı",
                )
                order.tracking_no = None
                # Sistem kaynaklı başarısızlık da söz borcudur (kurye FAILED ile aynı);
                # tavana ulaşırsa yeniden kuyruğa girmez → istisna kuyruğu.
                requeued = order_service.roll_promise_after_failed_attempt(
                    order, closed_dates
                )
            else:
                requeued = True
            stop.status = DeliveryStopStatus.FAILED.value
            stop.courier_note = stop.courier_note or "Tur zaman aşımıyla kapatıldı"
            if requeued:
                await notification_service.notify(
                    db,
                    user_id=order.client_id,
                    role_id=ROLE_IDS[RoleType.CLIENT],
                    message=f"Siparişin #{order.id} bugün teslim edilemedi; yeniden planlanacak.",
                    link="/siparislerim",
                )
                if order.ship_phone:
                    outbox.enqueue(
                        db, "sms:failed", {"to": order.ship_phone, "order_id": order.id}
                    )
            else:
                await _notify_admins_attention(db, order)
        run.status = DeliveryRunStatus.CANCELLED.value
        run.completed_at = _now()
        stamp = f"Watchdog: {hours} saati aşan aktif tur otomatik kapatıldı."
        run.notes = f"{run.notes}\n{stamp}" if run.notes else stamp
        for admin_id in admin_ids:
            await notification_service.notify(
                db,
                user_id=admin_id,
                role_id=ROLE_IDS[RoleType.ADMIN],
                message=(
                    f"Dağıtım turu #{run.id} {hours} saattir açıktı — otomatik "
                    "kapatıldı; teslim edilemeyen siparişler yeniden planlanmalı."
                ),
                link="/",
            )
        await db.commit()
        await courier_position.clear_position(run.id)
    return len(runs)


# ── Durak yönetimi ────────────────────────────────────────────────────────────────


async def _has_open_stop(db: AsyncSession, order_id: int) -> bool:
    """Siparişin planlı/aktif bir turda bekleyen durağı var mı?"""
    row = (
        await db.execute(
            select(DeliveryStop.id)
            .join(DeliveryRun, DeliveryStop.run_id == DeliveryRun.id)
            .where(
                DeliveryStop.order_id == order_id,
                DeliveryStop.status == DeliveryStopStatus.PENDING.value,
                DeliveryRun.status.in_(_ACTIVE_RUN_STATUSES),
                DeliveryRun.deleted_at.is_(None),
            )
        )
    ).first()
    return row is not None


def _eligible_out(o: Order) -> EligibleOrderOut:
    return EligibleOrderOut(
        order_id=o.id,
        recipient=o.ship_recipient,
        phone=o.ship_phone,
        address=o.ship_address,
        city=o.ship_city,
        district=o.ship_district,
        lat=float(o.ship_lat) if o.ship_lat is not None else None,
        lng=float(o.ship_lng) if o.ship_lng is not None else None,
        total=str(o.total),
        item_count=sum(it.quantity for it in o.items if it.kind == "PHYSICAL"),
        created_at=o.created_at,
        promised_delivery_date=o.promised_delivery_date,
        in_zone=o.ship_in_zone,
        prepared_at=o.prepared_at,
    )


def _within_attempt_cap():
    """Deneme hakkı DOLMAMIŞ siparişler için SQL koşulu (üç-deneme kuralı).
    Tavan 0 ise kural kapalı → hep True. Prep/eligible bunu paylaşır; tavanı
    aşanlar otomatik kuyruklardan düşer, istisna kuyruğunda görünür."""
    cap = settings.DELIVERY_MAX_DELIVERY_ATTEMPTS
    if cap <= 0:
        return sa_true()
    return Order.failed_delivery_count < cap


async def prep_queue(db: AsyncSession) -> list[EligibleOrderOut]:
    """Hazırlama istasyonu kuyruğu (PDS O1): ödenmiş + fiziksel + Adana-içi ama
    HENÜZ hazırlanmamış + deneme hakkı DOLMAMIŞ siparişler. Depo görevlisi
    paketi toplayıp etiketi basınca ``mark_prepared`` ile hazır işaretlenir."""
    orders = (
        await db.execute(
            select(Order)
            .options(selectinload(Order.items))
            .where(
                Order.deleted_at.is_(None),
                Order.has_physical.is_(True),
                Order.payment_status == "PAID",
                Order.status == "PAID",
                Order.ship_in_zone.is_(True),
                Order.prepared_at.is_(None),
                _within_attempt_cap(),
            )
            .order_by(
                Order.promised_delivery_date.asc().nulls_last(),
                Order.failed_delivery_count.desc(),
                Order.created_at.asc(),
            )
        )
    ).scalars().all()
    return [_eligible_out(o) for o in orders]


async def _closed_dates_now(db: AsyncSession) -> frozenset[datetime.date]:
    """Bugünden ileri kapalı günler (yeniden söz veren yollar için)."""
    today = (
        _now() + datetime.timedelta(hours=settings.APP_UTC_OFFSET_HOURS)
    ).date()
    return await delivery_calendar.load_closed_dates(
        db, start=today, end=today + datetime.timedelta(days=45)
    )


async def attention_orders(db: AsyncSession) -> list[EligibleOrderOut]:
    """İstisna kuyruğu (PDS O3 çekirdeği): deneme hakkı DOLMUŞ siparişler —
    otomatik yeniden kuyruğa girmezler, operatör kararı bekler (teslim-alma
    noktası / iptal+iade). Sonsuz PAID↔FAILED döngüsünün kırıldığı yer."""
    cap = settings.DELIVERY_MAX_DELIVERY_ATTEMPTS
    if cap <= 0:
        return []
    orders = (
        await db.execute(
            select(Order)
            .options(selectinload(Order.items))
            .where(
                Order.deleted_at.is_(None),
                Order.has_physical.is_(True),
                Order.payment_status == "PAID",
                Order.status == "PAID",
                Order.ship_in_zone.is_(True),
                Order.failed_delivery_count >= cap,
            )
            .order_by(Order.promised_delivery_date.asc().nulls_last())
        )
    ).scalars().all()
    return [_eligible_out(o) for o in orders]


async def retry_exhausted_order(db: AsyncSession, order_id: int) -> EligibleOrderOut:
    """Operatör kararı: deneme hakkı dolmuş siparişe BİR tur daha hak tanı
    (müşteriyle görüşüldü, yeni randevu). Sayaç bir azaltılır (tavanın altına
    iner → yeniden kuyruğa girer) ve söz günü ertesi çalışma gününe alınır.
    İptal/iade isteniyorsa ayrı akış (store admin refund) kullanılır."""
    order = await db.get(Order, order_id)
    if order is None or order.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Sipariş #{order_id} bulunamadı")
    if not order_service.attempts_exhausted(order.failed_delivery_count):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Bu siparişin deneme hakkı zaten var"
        )
    # Tavanın hemen altına indir → tek tur daha; sonraki başarısızlıkta yeniden düşer.
    order.failed_delivery_count = settings.DELIVERY_MAX_DELIVERY_ATTEMPTS - 1
    order.promised_delivery_date = delivery_promise.next_delivery_day(
        _now(),
        non_working_weekdays=settings.DELIVERY_NON_WORKING_WEEKDAYS,
        utc_offset_hours=settings.APP_UTC_OFFSET_HOURS,
        closed_dates=await _closed_dates_now(db),
    )
    await db.commit()
    await db.refresh(order, ["items"])
    return _eligible_out(order)


async def mark_prepared(
    db: AsyncSession, order_id: int, *, prepared: bool, actor: str = "admin"
) -> EligibleOrderOut:
    """Siparişi hazır/hazır-değil işaretler. Hazır ederken sipariş gerçekten
    dağıtıma uygun olmalı (ödenmiş, fiziksel, bölge-içi, açık); değilse 409.
    Geri alma yalnız henüz TURA GİRMEMİŞ siparişte serbest (durak varsa paket
    zaten araçta/sahada)."""
    order = await db.get(Order, order_id)
    if order is None or order.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Sipariş #{order_id} bulunamadı")
    if prepared:
        if not order.has_physical or order.ship_in_zone is not True:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Sipariş #{order_id} kendi-filo teslimatına uygun değil",
            )
        if order.payment_status != "PAID" or order.status != "PAID":
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Sipariş #{order_id} ödenmiş ve açıkta olmalı",
            )
        if order.prepared_at is None:
            order.prepared_at = _now()
            order.prepared_by = actor
    else:
        if await _has_open_stop(db, order_id):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Sipariş #{order_id} zaten bir turda — hazırlık geri alınamaz",
            )
        order.prepared_at = None
        order.prepared_by = None
    await db.commit()
    await db.refresh(order, ["items"])
    return _eligible_out(order)


async def eligible_orders(db: AsyncSession) -> list[EligibleOrderOut]:
    """Tura eklenebilir siparişler: ödenmiş + fiziksel + Adana-içi (Cıncık bölgesi)
    + HAZIRLANMIŞ + henüz açık durağı yok. Söz verilen günü yaklaşan/geçen en önde.

    Açık-durak elemesi tek sorguda anti-join (NOT EXISTS) ile yapılır — sipariş
    başına ayrı ``_has_open_stop`` sorgusu (N+1) 500 siparişte 501 sorgu demekti."""
    open_stop_exists = (
        select(DeliveryStop.id)
        .join(DeliveryRun, DeliveryStop.run_id == DeliveryRun.id)
        .where(
            DeliveryStop.order_id == Order.id,
            DeliveryStop.status == DeliveryStopStatus.PENDING.value,
            DeliveryRun.status.in_(_ACTIVE_RUN_STATUSES),
            DeliveryRun.deleted_at.is_(None),
        )
        .exists()
    )
    orders = (
        await db.execute(
            select(Order)
            .options(selectinload(Order.items))
            .where(
                Order.deleted_at.is_(None),
                Order.has_physical.is_(True),
                Order.payment_status == "PAID",
                Order.status == "PAID",
                Order.ship_in_zone.is_(True),
                # Yalnız hazırlanmış (etiketi basılmış) paket tura eklenebilir.
                Order.prepared_at.is_not(None),
                # Deneme hakkı dolanlar istisna kuyruğunda — otomatik dağıtılmaz.
                _within_attempt_cap(),
                ~open_stop_exists,
            )
            .order_by(
                Order.promised_delivery_date.asc().nulls_last(),
                # Aynı söz gününde yeniden denemeler önce: söz borcu yeni satıştan
                # önce gelir (PDS B7) — dispatch kuyruğu da bu sırayla dolar.
                Order.failed_delivery_count.desc(),
                Order.created_at.asc(),
            )
        )
    ).scalars().all()
    return [_eligible_out(o) for o in orders]


async def kpi_summary(db: AsyncSession, *, days: int = 30) -> dict:
    """Teslimat KPI özeti (PDS §14) — son ``days`` gün. Ham sayı + oran (hedef
    yok). Durak sonuçları stops'tan, söz-tutma/ilk-deneme sipariş bazından gelir."""
    from models.delivery import FAIL_REASONS_NOT_COURIER_FAULT
    from services import delivery_metrics

    since = _now() - datetime.timedelta(days=days)
    kpi = delivery_metrics.DeliveryKpi(window_days=days)

    # Durak sonuçları (bu pencerede güncellenmiş sonuçlanmış duraklar).
    status_rows = (
        await db.execute(
            select(DeliveryStop.status, func.count())
            .where(
                DeliveryStop.updated_at >= since,
                DeliveryStop.status.in_(
                    (
                        DeliveryStopStatus.DELIVERED.value,
                        DeliveryStopStatus.FAILED.value,
                        DeliveryStopStatus.RESCHEDULED.value,
                    )
                ),
            )
            .group_by(DeliveryStop.status)
        )
    ).all()
    by_status = {s: int(c) for s, c in status_rows}
    kpi.delivered = by_status.get(DeliveryStopStatus.DELIVERED.value, 0)
    kpi.failed = by_status.get(DeliveryStopStatus.FAILED.value, 0)
    kpi.rescheduled = by_status.get(DeliveryStopStatus.RESCHEDULED.value, 0)

    # FAILED neden dağılımı (Pareto) + kurye kusuru sayılmayanlar.
    reason_rows = (
        await db.execute(
            select(DeliveryStop.fail_reason, func.count())
            .where(
                DeliveryStop.updated_at >= since,
                DeliveryStop.status == DeliveryStopStatus.FAILED.value,
            )
            .group_by(DeliveryStop.fail_reason)
        )
    ).all()
    for reason, count in reason_rows:
        key = reason or "DIGER"
        kpi.fail_by_reason[key] = kpi.fail_by_reason.get(key, 0) + int(count)
        if key in FAIL_REASONS_NOT_COURIER_FAULT:
            kpi.failed_not_courier_fault += int(count)

    # Söz tutma + ilk denemede teslim — teslim edilmiş siparişler üzerinden.
    delivered_orders = (
        await db.execute(
            select(
                Order.delivered_at,
                Order.promised_delivery_date,
                Order.failed_delivery_count,
            ).where(
                Order.deleted_at.is_(None),
                Order.status == "DELIVERED",
                Order.has_physical.is_(True),
                Order.delivered_at >= since,
            )
        )
    ).all()
    for delivered_at, promised, failed_count in delivered_orders:
        kpi.delivered_count += 1
        if (failed_count or 0) == 0:
            kpi.first_attempt_delivered += 1
        on_time = delivery_metrics.is_on_time(
            delivered_at, promised, settings.APP_UTC_OFFSET_HOURS
        )
        if on_time is not None:
            kpi.promised_delivered += 1
            if on_time:
                kpi.on_time_delivered += 1

    # Teslim sonrası değerlendirme (Faz 7): 👍/👎 + sorun Pareto'su.
    from services import delivery_feedback_service

    kpi.feedback_up, kpi.feedback_down, kpi.feedback_problems = (
        await delivery_feedback_service.kpi_counts(db, since)
    )
    return kpi.to_dict()


async def capacity_overview(db: AsyncSession, *, days: int = 14) -> list[CapacityDayOut]:
    """Önümüzdeki ``days`` günün söz doluluğu (bugün dahil) — admin kapasite
    şeridi. Sayım filtresi ``_first_capacity_day`` ile birebir aynıdır (bölge-içi,
    açık PAID/SHIPPED, fiziksel); ayrışırlarsa şerit yalan söyler."""
    local_today = (
        _now() + datetime.timedelta(hours=settings.APP_UTC_OFFSET_HOURS)
    ).date()
    end = local_today + datetime.timedelta(days=days - 1)
    rows = (
        await db.execute(
            select(
                Order.promised_delivery_date,
                func.count(),
                func.count().filter(Order.failed_delivery_count > 0),
            )
            .where(
                Order.deleted_at.is_(None),
                Order.has_physical.is_(True),
                Order.ship_in_zone.is_(True),
                Order.status.in_(("PAID", "SHIPPED")),
                Order.promised_delivery_date >= local_today,
                Order.promised_delivery_date <= end,
            )
            .group_by(Order.promised_delivery_date)
        )
    ).all()
    by_day = {d: (int(total), int(retry)) for d, total, retry in rows}
    out: list[CapacityDayOut] = []
    for i in range(days):
        day = local_today + datetime.timedelta(days=i)
        booked, retry = by_day.get(day, (0, 0))
        out.append(
            CapacityDayOut(
                day=day,
                is_working_day=day.weekday()
                not in settings.DELIVERY_NON_WORKING_WEEKDAYS,
                capacity=settings.DELIVERY_DAILY_CAPACITY,
                booked=booked,
                retry_debt=retry,
            )
        )
    return out


async def outsourced_orders(db: AsyncSession) -> list[EligibleOrderOut]:
    """Bölge dışı (ya da bölgesi belirlenemeyen) ödenmiş fiziksel siparişler —
    "dış kargo bekliyor" kuyruğu. Aksiyon mevcut manuel kargolama akışıdır
    (`/store/admin/orders/{id}/ship`); kargo API entegrasyonu şirket kurulup
    sandbox alınınca yazılacak."""
    orders = (
        await db.execute(
            select(Order)
            .options(selectinload(Order.items))
            .where(
                Order.deleted_at.is_(None),
                Order.has_physical.is_(True),
                Order.payment_status == "PAID",
                Order.status == "PAID",
                Order.ship_in_zone.is_not(True),
            )
            .order_by(Order.created_at.asc())
        )
    ).scalars().all()
    return [_eligible_out(o) for o in orders]


async def add_stops(db: AsyncSession, run_id: int, order_ids: list[int]) -> DeliveryRunOut:
    """Siparişleri turun sonuna durak olarak ekler (PLANNED ya da ACTIVE turda —
    kampanya günü sahadayken araya sipariş eklenebilir)."""
    run = await _load_run(db, run_id)
    if run.status not in _ACTIVE_RUN_STATUSES:
        raise HTTPException(status.HTTP_409_CONFLICT, "Tamamlanmış/iptal tura durak eklenemez")

    next_seq = (
        (await db.execute(
            select(func.coalesce(func.max(DeliveryStop.sequence), 0)).where(
                DeliveryStop.run_id == run.id
            )
        )).scalar_one()
        + 1
    )
    existing = {s.order_id for s in run.stops}
    for order_id in dict.fromkeys(order_ids):  # sıra korunarak tekilleştir
        if order_id in existing:
            continue
        order = await db.get(Order, order_id)
        if order is None or order.deleted_at is not None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Sipariş #{order_id} bulunamadı")
        if not order.has_physical:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"Sipariş #{order_id} fiziksel ürün içermiyor"
            )
        if order.payment_status != "PAID" or order.status != "PAID":
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Sipariş #{order_id} dağıtıma uygun değil (ödenmiş ve açıkta olmalı)",
            )
        if order.prepared_at is None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Sipariş #{order_id} henüz hazırlanmadı — önce paketi hazırlayıp etiketle",
            )
        if await _has_open_stop(db, order_id):
            raise HTTPException(
                status.HTTP_409_CONFLICT, f"Sipariş #{order_id} zaten bir turda bekliyor"
            )
        stop = DeliveryStop(
            run_id=run.id,
            order_id=order_id,
            sequence=next_seq,
            qr_token=new_qr_token(),
            status=DeliveryStopStatus.PENDING.value,
        )
        next_seq += 1
        db.add(stop)
        # Aktif turda eklenen durak da hemen 'dağıtımda' sayılır; takip SMS'i
        # outbox'a aynı transaction'da yazılır (geri sarımda SMS de gitmez).
        if run.status == DeliveryRunStatus.ACTIVE.value:
            await db.flush()
            await order_fsm.transition_order(db, order, "SHIPPED", changed_by="courier")
            order.tracking_no = f"ELDEN-R{run.id}-S{stop.id}"
            _enqueue_tracking_link(db, order)
    # Yarışta (_has_open_stop iki istekte de geçtiyse) son sözü
    # uq_delivery_stop_open söyler → IntegrityError, global handler 409'lar.
    await db.commit()
    return await get_run(db, run_id)


async def remove_stop(db: AsyncSession, stop_id: int) -> DeliveryRunOut:
    stop = await _load_stop(db, stop_id)
    run = stop.run
    if run.status not in _ACTIVE_RUN_STATUSES:
        raise HTTPException(status.HTTP_409_CONFLICT, "Tamamlanmış/iptal turdan durak çıkarılamaz")
    if stop.status != DeliveryStopStatus.PENDING.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Sonuçlanmış durak çıkarılamaz")
    if stop.order.status == "SHIPPED":
        await order_fsm.transition_order(
            db, stop.order, "PAID", changed_by="courier", reason="Durak turdan çıkarıldı"
        )
        stop.order.tracking_no = None
    await db.delete(stop)
    await db.commit()
    return await get_run(db, run.id)


async def reorder_stops(db: AsyncSession, run_id: int, stop_ids: list[int]) -> DeliveryRunOut:
    run = await _load_run(db, run_id)
    if run.status not in _ACTIVE_RUN_STATUSES:
        raise HTTPException(status.HTTP_409_CONFLICT, "Tamamlanmış/iptal turda sıralama değişmez")
    current = [s.id for s in run.stops]
    if not validate_reorder(current, stop_ids):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Yeni sıra turun duraklarıyla birebir eşleşmiyor"
        )
    position = {stop_id: i + 1 for i, stop_id in enumerate(stop_ids)}
    for stop in run.stops:
        stop.sequence = position[stop.id]
    await db.commit()
    return await get_run(db, run_id)


# ── Rota optimizasyonu (Faz B) ────────────────────────────────────────────────────


async def optimize_run(db: AsyncSession, run_id: int) -> DeliveryRunOut:
    """Bekleyen durakları optimal sıraya dizer (VROOM; yoksa haversine fallback).

    Konumu olmayan duraklar optimize edilemez → rotanın SONUNA atılır (panelde
    "konumsuz" rozetiyle zaten görünürler). Sonuçlanmış duraklar baştaki
    sıralarını korur. ETA'lar depo çıkışı = şimdi varsayımıyla yazılır; sapma
    (detour_km) her bekleyen durak için hesaplanır.
    """
    run = await _load_run(db, run_id)
    if run.status not in _ACTIVE_RUN_STATUSES:
        raise HTTPException(status.HTTP_409_CONFLICT, "Yalnız planlı/aktif tur optimize edilir")

    resolved = [s for s in run.stops if s.status != DeliveryStopStatus.PENDING.value]
    pending = [s for s in run.stops if s.status == DeliveryStopStatus.PENDING.value]
    located = [s for s in pending if s.order.ship_lat is not None and s.order.ship_lng is not None]
    unlocated = [s for s in pending if s.order.ship_lat is None or s.order.ship_lng is None]
    if len(located) < 2:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Optimize edilecek en az 2 konumlu bekleyen durak gerekli",
        )

    depot = (settings.DELIVERY_DEPOT_LAT, settings.DELIVERY_DEPOT_LNG)
    points = [
        routing.RoutePoint(
            id=s.id, lat=float(s.order.ship_lat), lng=float(s.order.ship_lng)
        )
        for s in located
    ]
    plan = await routing.plan_route(depot_lat=depot[0], depot_lng=depot[1], points=points)

    by_id = {s.id: s for s in located}
    ordered_stops = [by_id[i] for i in plan.ordered_ids]
    ordered_coords = [
        (float(s.order.ship_lat), float(s.order.ship_lng)) for s in ordered_stops
    ]
    detours = compute_detours(depot, ordered_coords)

    now = _now()
    seq = 0
    # Sonuçlanmış duraklar geçmiş kaydıdır — sıraları başta sabit kalır.
    for s in sorted(resolved, key=lambda x: x.sequence):
        seq += 1
        s.sequence = seq
    # compute_detours girdisiyle birebir aynı uzunlukta döner; strict=True bu
    # sözleşme bozulursa sessizce kısa kesmek yerine hata versin.
    for s, detour in zip(ordered_stops, detours, strict=True):
        seq += 1
        s.sequence = seq
        s.detour_km = detour
        offset = plan.arrival_offsets.get(s.id)
        s.eta = now + datetime.timedelta(seconds=offset) if offset is not None else None
    for s in sorted(unlocated, key=lambda x: x.sequence):
        seq += 1
        s.sequence = seq
        s.eta = None
        s.detour_km = None

    run.optimized_at = now
    run.optimize_provider = plan.provider
    run.total_distance_km = plan.total_distance_km
    run.total_duration_seconds = plan.total_duration_seconds or None
    run.route_geometry = plan.geometry
    await db.commit()
    return await get_run(db, run_id)


# ── Günü optimize et: çoklu araç dispatch ─────────────────────────────────────────

# routing.plan_fleet araç anahtarları (VROOM vehicle id int ister).
_VEHICLE_IDS = {1: "LADA", 2: "COROLLA"}


async def dispatch_day(db: AsyncSession, run_date: datetime.date) -> list[DeliveryRunOut]:
    """Günün uygun siparişlerini araçlara bölüştürüp optimize turlar kurar.

    Konumlu + bölge-içi + söz günü ``run_date``'i geçmeyen siparişler alınır;
    sayı ``DELIVERY_SINGLE_VEHICLE_MAX_STOPS``'u aşarsa COROLLA da devreye girer.
    Araç başına o günün PLANNED turu bulunur ya da açılır (ACTIVE turlara
    dokunulmaz), bölüştürme sırasına göre duraklar eklenir ve her tur kendi
    başına optimize edilir (ETA + geometri + sapma). Konumsuz siparişler elle
    eklenmek üzere eligible listesinde kalır.
    """
    eligible = await eligible_orders(db)
    candidates = [
        o
        for o in eligible
        if o.lat is not None
        and o.lng is not None
        and (o.promised_delivery_date is None or o.promised_delivery_date <= run_date)
    ]
    if not candidates:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Dağıtılacak konumlu sipariş yok"
        )

    vehicle_ids = (
        [1]
        if len(candidates) <= settings.DELIVERY_SINGLE_VEHICLE_MAX_STOPS
        else [1, 2]
    )
    points = [
        routing.RoutePoint(id=o.order_id, lat=o.lat, lng=o.lng) for o in candidates
    ]
    fleet = await routing.plan_fleet(
        depot_lat=settings.DELIVERY_DEPOT_LAT,
        depot_lng=settings.DELIVERY_DEPOT_LNG,
        points=points,
        vehicle_ids=vehicle_ids,
    )

    out: list[DeliveryRunOut] = []
    for vid, plan in fleet.routes.items():
        if not plan.ordered_ids:
            continue
        vehicle = _VEHICLE_IDS[vid]

        async def _find_planned() -> DeliveryRun | None:
            return (
                await db.execute(
                    select(DeliveryRun).where(
                        DeliveryRun.run_date == run_date,
                        DeliveryRun.vehicle == vehicle,
                        DeliveryRun.status == DeliveryRunStatus.PLANNED.value,
                        DeliveryRun.deleted_at.is_(None),
                    )
                )
            ).scalars().first()

        run = await _find_planned()
        if run is None:
            run = DeliveryRun(
                run_date=run_date,
                vehicle=vehicle,
                status=DeliveryRunStatus.PLANNED.value,
            )
            db.add(run)
            try:
                await db.commit()
            except IntegrityError:
                # Yarış: eşzamanlı dispatch-day aynı turu az önce kurdu
                # (uq_delivery_run_planned) — onunkini kullan.
                await db.rollback()
                run = await _find_planned()
                if run is None:
                    raise
        await add_stops(db, run.id, plan.ordered_ids)
        # Tur kendi başına optimize edilir (test edilmiş yazım yolu: ETA +
        # geometri + detour); tek duraklı tur optimize edilemez — sade kalır.
        try:
            out.append(await optimize_run(db, run.id))
        except HTTPException:
            out.append(await get_run(db, run.id))
    return out


# ── Canlı takip (Faz C) ───────────────────────────────────────────────────────────


def resolve_tracking_status(
    *, order_status: str, stop_status: str | None, run_status: str | None
) -> str:
    """Müşteriye gösterilecek takip durumu (saf — pytest'li).

    Kurye ancak AKTİF turdaki BEKLEYEN durakta 'yolda'dır; diğer her kombinasyon
    siparişin kendi durumuna düşer. RESCHEDULED (müşteri erteledi) FAILED'dan
    ayrı kopya alır (POSTPONED).
    """
    if order_status == "DELIVERED" or stop_status == DeliveryStopStatus.DELIVERED.value:
        return "DELIVERED"
    if (
        stop_status == DeliveryStopStatus.PENDING.value
        and run_status == DeliveryRunStatus.ACTIVE.value
    ):
        return "EN_ROUTE"
    if stop_status == DeliveryStopStatus.FAILED.value:
        return "FAILED"
    if stop_status == DeliveryStopStatus.RESCHEDULED.value:
        return "POSTPONED"
    return "NOT_DISPATCHED"


async def track_run(db: AsyncSession, run_id: int, *, lat: float, lng: float) -> None:
    """Dağıtıcı konum ping'i → Redis (yalnız aktif turda; kalıcı iz tutulmaz)."""
    run = await _load_run(db, run_id)
    if run.status != DeliveryRunStatus.ACTIVE.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Tur sahada (aktif) değil")
    await courier_position.set_position(run_id, lat, lng)


def _enqueue_tracking_link(db: AsyncSession, order: Order) -> None:
    """Sipariş dağıtıma çıkarken oturumsuz kargo takip linki SMS'ini outbox'lar
    (SHIPPED geçişiyle AYNI transaction'da — tur geri alınırsa SMS de gitmez;
    gönderim + retry worker'da). Telefonsuz siparişte sessizce atlanır."""
    if not order.ship_phone or not order.track_token:
        return
    base = settings.PUBLIC_TRACKING_BASE_URL.rstrip("/")
    outbox.enqueue(
        db,
        "sms:tracking_link",
        {
            "to": order.ship_phone,
            "order_id": order.id,
            "url": f"{base}/{order.track_token}",
        },
    )


async def order_tracking(
    db: AsyncSession,
    *,
    order_id: int | None = None,
    client_id: int | None = None,
    track_token: str | None = None,
) -> OrderTrackingOut:
    """Sipariş takibi: durum + kurye konumu + sıra/ETA.

    İki giriş: (a) ``track_token`` verilirse **oturumsuz** public takip (SMS linki);
    (b) ``order_id`` + ``client_id`` verilirse giriş yapmış müşterinin sahiplik
    kontrollü takibi. Dönen ``OrderTrackingOut`` her iki yolda aynıdır."""
    if track_token is not None:
        order = (
            await db.execute(
                select(Order).where(
                    Order.track_token == track_token, Order.deleted_at.is_(None)
                )
            )
        ).scalars().first()
    else:
        order = await db.get(Order, order_id)
    if order is None or order.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sipariş bulunamadı")
    if track_token is None and order.client_id != client_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sizin siparişiniz değil")

    # Siparişin en güncel durağı (varsa) + turu.
    stop = (
        await db.execute(
            select(DeliveryStop)
            .options(selectinload(DeliveryStop.run))
            .where(DeliveryStop.order_id == order.id)
            .order_by(DeliveryStop.id.desc())
            .limit(1)
        )
    ).scalars().first()

    run = stop.run if stop is not None else None
    tracking_status = resolve_tracking_status(
        order_status=order.status,
        stop_status=stop.status if stop else None,
        run_status=run.status if run else None,
    )

    # Olay akışı: history satırları (tek sorgu) + sentetik "dağıtım planlandı".
    # Yalnız whitelist kodu + zaman sızar (reason/changed_by ASLA — iç not olabilir).
    history_rows = (
        await db.execute(
            select(
                OrderStatusHistory.old_status,
                OrderStatusHistory.new_status,
                OrderStatusHistory.created_at,
            )
            .where(OrderStatusHistory.order_id == order.id)
            .order_by(OrderStatusHistory.id)
        )
    ).all()
    timeline = project_customer_timeline(
        [(r[0], r[1], r[2]) for r in history_rows],
        planned_at=stop.created_at if stop is not None else None,
        last_stop_status=stop.status if stop is not None else None,
        postponed_at=(
            stop.updated_at
            if stop is not None
            and stop.status == DeliveryStopStatus.RESCHEDULED.value
            else None
        ),
    )

    out = OrderTrackingOut(
        status=tracking_status,
        ship_lat=float(order.ship_lat) if order.ship_lat is not None else None,
        ship_lng=float(order.ship_lng) if order.ship_lng is not None else None,
        tracking_no=order.tracking_no,
        recipient_masked=mask_recipient(order.ship_recipient),
        promised_delivery_date=order.promised_delivery_date,
        delivery_pref=order.delivery_pref,
        delivery_pref_note=order.delivery_pref_note,
        can_postpone=(
            order.payment_status == "PAID"
            and order.status in ("PAID", "SHIPPED")
            and order.postpone_count < order_service.POSTPONE_LIMIT
        ),
        timeline=[TimelineEventOut(code=e.code, at=e.at) for e in timeline],
    )

    if tracking_status == "DELIVERED" and stop is not None:
        out.delivered_at = stop.delivered_at
        out.proof = stop.proof
        # Kapı önü fotoğrafı PII'dır: yalnız oturumlu sahibe döner, SMS linkiyle
        # gezen public token'a ASLA (token sızarsa kanıt fotoğrafı da sızmasın).
        if track_token is None:
            out.proof_photo_url = stop.photo_url
        # Teslim sonrası değerlendirme (Faz 7) — verilmişse tekrar sorulmaz.
        from services import delivery_feedback_service

        existing_fb = await delivery_feedback_service.get_for_order(db, order.id)
        out.feedback_given = existing_fb is not None
        out.can_feedback = existing_fb is None
        return out

    if tracking_status != "EN_ROUTE" or stop is None or run is None:
        return out

    out.sequence = stop.sequence
    out.eta = stop.eta
    if stop.eta is not None:
        out.eta_window_start, out.eta_window_end = eta_window(
            stop.eta,
            early_minutes=settings.DELIVERY_ETA_WINDOW_EARLY_MINUTES,
            late_minutes=settings.DELIVERY_ETA_WINDOW_LATE_MINUTES,
        )
    ahead = (
        await db.execute(
            select(func.count())
            .select_from(DeliveryStop)
            .where(
                DeliveryStop.run_id == run.id,
                DeliveryStop.status == DeliveryStopStatus.PENDING.value,
                DeliveryStop.sequence < stop.sequence,
            )
        )
    ).scalar_one()
    out.stops_ahead = int(ahead)
    out.total_stops = (
        await db.execute(
            select(func.count())
            .select_from(DeliveryStop)
            .where(DeliveryStop.run_id == run.id)
        )
    ).scalar_one()

    # Kurye kimlik kartı (public kimlik: isim + foto + plaka).
    if run.courier_id is not None:
        c = await db.get(Courier, run.courier_id)
        if c is not None and c.deleted_at is None:
            out.courier_name = c.name
            out.courier_photo_url = c.photo_url
            out.courier_plate = c.vehicle_plate

    pos = await courier_position.get_position(run.id)
    if pos is not None:
        out.courier_lat = pos["lat"]
        out.courier_lng = pos["lng"]
        out.courier_age_seconds = pos["age_seconds"]
    return out


# ── Teslim akışı (dağıtıcı) ───────────────────────────────────────────────────────


def _require_field_stop(stop: DeliveryStop) -> None:
    """Teslim aksiyonları yalnız AKTİF turdaki BEKLEYEN durakta anlamlıdır."""
    if stop.run.status != DeliveryRunStatus.ACTIVE.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Tur sahada (aktif) değil")
    if stop.status != DeliveryStopStatus.PENDING.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu durak zaten sonuçlanmış")


async def _lock_stop_and_order(db: AsyncSession, stop: DeliveryStop) -> None:
    """Durağın siparişini + durağın kendisini FOR UPDATE ile kilitler ve TAZE
    durumlarını yükler. Durum değiştiren her yol (verify/fail/override/drop,
    postpone, iptal temizliği) bu kilitten geçer — eşzamanlı iki akış birbirinin
    sonucunu EZEMEZ (ör. teslim edilmiş sipariş ertelemeyle PAID'e geri sarılamaz).
    Kilit sırası her yerde aynıdır: önce Order, sonra DeliveryStop (deadlock önlemi)."""
    await db.execute(
        select(Order.id).where(Order.id == stop.order_id).with_for_update()
    )
    await db.execute(
        select(DeliveryStop.id).where(DeliveryStop.id == stop.id).with_for_update()
    )
    await db.refresh(stop)
    await db.refresh(stop.order)


async def _lock_field_stop(db: AsyncSession, stop_id: int) -> DeliveryStop:
    """Saha aksiyonu girişi: durağı yükle, kilitle, taze durumla guard'ı çalıştır."""
    stop = await _load_stop(db, stop_id)
    await _lock_stop_and_order(db, stop)
    _require_field_stop(stop)
    return stop


#: Art arda OTP SMS'i arasındaki asgari süre — resend throttle. Amaç: her
#: yeniden gönderimin deneme sayacını sıfırlaması (otp_attempts=0) suistimal
#: edilip brute-force penceresi sonsuz tazelenemesin.
OTP_RESEND_INTERVAL_SECONDS = 60


def otp_resend_blocked(
    sent_at: datetime.datetime | None,
    now: datetime.datetime,
    interval_seconds: int = OTP_RESEND_INTERVAL_SECONDS,
) -> bool:
    """Saf: son gönderimden bu yana asgari süre geçmediyse True."""
    if sent_at is None:
        return False
    return (now - sent_at).total_seconds() < interval_seconds


async def send_otp(db: AsyncSession, stop_id: int) -> tuple[str, bool]:
    """Müşteriye teslim OTP'si SMS'ler; (maskeli numara, gerçekten gönderildi mi)
    döner. OTP bilinçli olarak outbox'a girmez — kurye kapıda saniyeler içinde
    sonuç bekler; gönderim başarısızsa kurye DÜRÜSTÇE uyarılır (yeniden dener
    ya da notlu teslime geçer), 'gönderildi' yalanı söylenmez."""
    stop = await _lock_field_stop(db, stop_id)
    if otp_resend_blocked(stop.otp_sent_at, _now()):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Kod az önce gönderildi — 1 dakika sonra yeniden dene",
        )
    phone = stop.order.ship_phone
    if not phone:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Siparişte telefon yok — notlu yönetici teslimi kullan"
        )
    code = gen_otp()
    stop.otp_hash = hash_otp(code)
    stop.otp_sent_at = _now()
    stop.otp_attempts = 0
    await db.commit()
    sent = await sms.send_delivery_otp_sms(to=phone, code=code, order_id=stop.order_id)
    # phone_service ile aynı maske biçimi
    masked = phone[:5] + "***" + phone[-2:] if len(phone) >= 6 else phone
    return masked, sent


async def set_stop_photo(db: AsyncSession, stop_id: int, photo_url: str) -> DeliveryStopOut:
    """Teslim kanıtı fotoğrafını durağa bağlar (PENDING'ken; yeniden çekimde
    eskisi best-effort silinir). Yükleme router'da (multipart) yapılır."""
    from core import storage  # döngüsel importu önlemek için yerel

    stop = await _load_stop(db, stop_id)
    _require_field_stop(stop)
    old = stop.photo_url
    stop.photo_url = photo_url
    await db.commit()
    if old:
        await storage.delete_file(old)
    return _stop_to_out(stop)


async def _notify_upcoming(db: AsyncSession, run_id: int) -> None:
    """Bir durak sonuçlanınca sıradaki 1-2 müşteriye "kuryen yaklaşıyor"
    SMS+bildirimi (durak başına TEK sefer — ``approach_notified_at`` damgası).
    Best-effort: hata teslim akışını bozmaz."""
    stops = (
        (
            await db.execute(
                select(DeliveryStop)
                .options(selectinload(DeliveryStop.order))
                .where(
                    DeliveryStop.run_id == run_id,
                    DeliveryStop.status == DeliveryStopStatus.PENDING.value,
                )
                .order_by(DeliveryStop.sequence)
                .limit(settings.DELIVERY_NEXT_NOTIFY_COUNT)
            )
        )
        .scalars()
        .all()
    )
    base = settings.PUBLIC_TRACKING_BASE_URL.rstrip("/")
    for ahead, stop in enumerate(stops):
        if stop.approach_notified_at is not None:
            continue
        stop.approach_notified_at = _now()
        order = stop.order
        await notification_service.notify(
            db,
            user_id=order.client_id,
            role_id=ROLE_IDS[RoleType.CLIENT],
            message=(
                f"Siparişin #{order.id}: kuryen yaklaşıyor — "
                + ("sıradaki teslimat sensin!" if ahead == 0 else f"önünde {ahead} durak var.")
            ),
            link="/siparislerim",
        )
        if order.ship_phone and order.track_token:
            # Damga (approach_notified_at) ile AYNI transaction'da outbox'a —
            # damga var ama SMS yok / SMS var ama damga yok durumu olamaz.
            outbox.enqueue(
                db,
                "sms:approach",
                {
                    "to": order.ship_phone,
                    "order_id": order.id,
                    "stops_ahead": ahead,
                    "url": f"{base}/{order.track_token}",
                },
            )
    await db.commit()


async def _shift_pending_etas(
    db: AsyncSession, run_id: int, drift: datetime.timedelta, *, exclude_stop_id: int
) -> None:
    """Gerçekleşen ile planlanan varış arasındaki sapmayı kalan bekleyen
    durakların ETA'larına yansıtır (kurye erken → pencereler öne, geç → geriye).
    Müşteri pencereleri (eta_window) canlı kalır — optimize anına çakılı değil.
    1 dk altı sapma gürültüdür, dokunulmaz."""
    if abs(drift.total_seconds()) < 60:
        return
    await db.execute(
        update(DeliveryStop)
        .where(
            DeliveryStop.run_id == run_id,
            DeliveryStop.id != exclude_stop_id,
            DeliveryStop.status == DeliveryStopStatus.PENDING.value,
            DeliveryStop.eta.is_not(None),
        )
        .values(eta=DeliveryStop.eta + drift)
    )


async def _finalize_delivered(
    db: AsyncSession,
    stop: DeliveryStop,
    *,
    proof: DeliveryProof,
    lat: float | None = None,
    lng: float | None = None,
    note: str | None = None,
) -> None:
    """Tek transaction: durak DELIVERED + sipariş DELIVERED + bildirim + e-posta
    outbox olayı + kalan ETA'ların drift'i — ya hepsi kalıcı olur ya hiçbiri
    (eski hali üç ayrı commit'ti; ara adım patlarsa yan etkiler kayıp kalıyordu)."""
    now = _now()
    eta_drift = (now - stop.eta) if stop.eta is not None else None
    stop.status = DeliveryStopStatus.DELIVERED.value
    stop.delivered_at = now
    stop.delivered_lat = lat
    stop.delivered_lng = lng
    stop.proof = proof.value
    if note:
        stop.courier_note = note
    order = stop.order
    await order_fsm.transition_order(db, order, "DELIVERED", changed_by="courier")
    await notification_service.notify(
        db,
        user_id=order.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message=f"Siparişin #{order.id} teslim edildi. İyi çalışmalar!",
        link="/siparislerim",
    )
    await order_service._email_order(db, order, "DELIVERED")
    if eta_drift is not None:
        await _shift_pending_etas(db, stop.run_id, eta_drift, exclude_stop_id=stop.id)
    await db.commit()
    await _notify_upcoming(db, stop.run_id)


async def verify_delivery(
    db: AsyncSession,
    stop_id: int,
    *,
    code: str,
    lat: float | None = None,
    lng: float | None = None,
) -> DeliveryStopOut:
    """Kapıda müşterinin söylediği OTP'yi doğrular → durak DELIVERED, sipariş DELIVERED."""
    stop = await _lock_field_stop(db, stop_id)
    now = _now()
    if stop.otp_hash is None or otp_expired(stop.otp_sent_at, now):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Kod yok ya da süresi doldu — yeni kod gönder"
        )
    if stop.otp_attempts >= settings.DELIVERY_OTP_MAX_ATTEMPTS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Çok fazla hatalı deneme — yeni kod gönder"
        )
    if hash_otp(code) != stop.otp_hash:
        stop.otp_attempts += 1
        await db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Kod hatalı")
    await _finalize_delivered(db, stop, proof=DeliveryProof.OTP, lat=lat, lng=lng)
    return _stop_to_out(await _load_stop(db, stop_id))


async def override_deliver(db: AsyncSession, stop_id: int, *, note: str) -> DeliveryStopOut:
    """OTP ulaşmadığında kaçış yolu: notlu yönetici teslimi (proof=ADMIN)."""
    stop = await _lock_field_stop(db, stop_id)
    await _finalize_delivered(db, stop, proof=DeliveryProof.ADMIN, note=note)
    return _stop_to_out(await _load_stop(db, stop_id))


async def deliver_drop(db: AsyncSession, stop_id: int) -> DeliveryStopOut:
    """Kapıya/komşuya bırakma teslimi: müşteri talimatı varsa OTP alınmaz —
    kanıt zorunlu paket fotoğrafıdır (proof=PHOTO)."""
    stop = await _lock_field_stop(db, stop_id)
    pref = stop.order.delivery_pref
    if pref not in (DeliveryPref.KAPIYA_BIRAK.value, DeliveryPref.KOMSUYA_BIRAK.value):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Müşterinin bırakma talimatı yok — OTP ile teslim et",
        )
    if not stop.photo_url:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Önce kanıt fotoğrafı çek — bırakma tesliminde zorunlu"
        )
    note = (
        f"Komşuya bırakıldı: {stop.order.delivery_pref_note}"
        if pref == DeliveryPref.KOMSUYA_BIRAK.value
        else "Kapıya bırakıldı (müşteri talimatı)"
    )
    await _finalize_delivered(db, stop, proof=DeliveryProof.PHOTO, note=note)
    return _stop_to_out(await _load_stop(db, stop_id))


async def fail_stop(
    db: AsyncSession,
    stop_id: int,
    *,
    reason: str,
    reason_code: str = FailReason.DIGER.value,
) -> DeliveryStopOut:
    """Teslim edilemedi: durak FAILED, sipariş PAID'e döner (ertesi tura eklenebilir).
    Tek transaction; SMS outbox'a aynı tx'te yazılır, kalan ETA'lar drift'lenir.
    ``reason_code`` yapısal neden (FailReason) — raporlama/KPI için; ``reason``
    serbest metin kurye notu (müşteriye sızmaz)."""
    if reason_code not in {r.value for r in FailReason}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Geçersiz neden kodu")
    stop = await _lock_field_stop(db, stop_id)
    eta_drift = (_now() - stop.eta) if stop.eta is not None else None
    stop.status = DeliveryStopStatus.FAILED.value
    stop.courier_note = reason
    stop.fail_reason = reason_code
    order = stop.order
    await order_fsm.transition_order(
        db, order, "PAID", changed_by="courier", reason=f"Teslim edilemedi: {reason}"
    )
    order.tracking_no = None
    # Söz borcu: yarına öncelikli yeniden deneme + başarısızlık sayacı (PDS B7).
    # Tavana ulaşırsa (üç-deneme) yeniden kuyruğa GİRMEZ → operatör istisna kuyruğu.
    requeued = order_service.roll_promise_after_failed_attempt(
        order, await _closed_dates_now(db)
    )
    if requeued:
        await notification_service.notify(
            db,
            user_id=order.client_id,
            role_id=ROLE_IDS[RoleType.CLIENT],
            message=f"Siparişin #{order.id} bugün teslim edilemedi; yeniden planlanacak.",
            link="/siparislerim",
        )
        if order.ship_phone:
            outbox.enqueue(db, "sms:failed", {"to": order.ship_phone, "order_id": order.id})
    else:
        # Deneme hakkı bitti — müşteriye dürüst, operatöre eyleme çağıran bildirim.
        await notification_service.notify(
            db,
            user_id=order.client_id,
            role_id=ROLE_IDS[RoleType.CLIENT],
            message=(
                f"Siparişin #{order.id} birkaç kez teslim edilemedi; "
                "ekibimiz seninle iletişime geçecek."
            ),
            link="/siparislerim",
        )
        await _notify_admins_attention(db, order)
    if eta_drift is not None:
        await _shift_pending_etas(db, stop.run_id, eta_drift, exclude_stop_id=stop.id)
    await db.commit()
    await _notify_upcoming(db, stop.run_id)
    return _stop_to_out(await _load_stop(db, stop_id))


async def _notify_admins_attention(db: AsyncSession, order: Order) -> None:
    """Deneme hakkı biten sipariş için tüm adminlere istisna kuyruğu bildirimi."""
    admin_ids = (
        await db.execute(select(Admin.id).where(Admin.deleted_at.is_(None)))
    ).scalars().all()
    for admin_id in admin_ids:
        await notification_service.notify(
            db,
            user_id=admin_id,
            role_id=ROLE_IDS[RoleType.ADMIN],
            message=(
                f"Sipariş #{order.id} {order.failed_delivery_count} kez teslim "
                "edilemedi — istisna kuyruğunda karar bekliyor (yeniden dene / iade)."
            ),
            link="/",
        )


async def scan(db: AsyncSession, payload: str) -> tuple[DeliveryStopOut, str]:
    """Paket etiketi QR'ından durağı bulur (doğru paket kontrolü)."""
    token = parse_qr_token(payload)
    stop = (
        await db.execute(
            select(DeliveryStop)
            .options(
                selectinload(DeliveryStop.run),
                selectinload(DeliveryStop.order).selectinload(Order.items),
            )
            .where(DeliveryStop.qr_token == token)
        )
    ).scalars().first()
    if stop is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bu etikete ait durak bulunamadı")
    return _stop_to_out(stop), stop.run.status
