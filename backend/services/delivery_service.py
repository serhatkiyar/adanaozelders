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
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core import routing, sms
from core.config import settings
from core.routing.haversine import haversine_km
from models.delivery import (
    DeliveryProof,
    DeliveryRun,
    DeliveryRunStatus,
    DeliveryStop,
    DeliveryStopStatus,
)
from models.role import ROLE_IDS, RoleType
from models.store import Order
from schemas.delivery import (
    DeliveryRunCreate,
    DeliveryRunOut,
    DeliveryStopOut,
    EligibleOrderOut,
    StopItemOut,
)
from services import notification_service, order_service

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
        eta=stop.eta,
        detour_km=float(stop.detour_km) if stop.detour_km is not None else None,
        is_outlier=(
            stop.detour_km is not None
            and float(stop.detour_km) >= settings.DELIVERY_DETOUR_KM
        ),
        otp_sent_at=stop.otp_sent_at,
        delivered_at=stop.delivered_at,
        proof=stop.proof,
        courier_note=stop.courier_note,
    )


def _run_to_out(run: DeliveryRun) -> DeliveryRunOut:
    return DeliveryRunOut(
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


async def create_run(db: AsyncSession, payload: DeliveryRunCreate) -> DeliveryRunOut:
    run = DeliveryRun(
        run_date=payload.run_date,
        vehicle=payload.vehicle,
        notes=payload.notes,
        status=DeliveryRunStatus.PLANNED.value,
    )
    db.add(run)
    await db.commit()
    return await get_run(db, run.id)


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
        if stop.status == DeliveryStopStatus.PENDING.value:
            if stop.order.status == "SHIPPED":
                stop.order.status = "PAID"
                stop.order.tracking_no = None
            stop.status = DeliveryStopStatus.FAILED.value
            stop.courier_note = stop.courier_note or "Tur iptal edildi"
    run.status = DeliveryRunStatus.CANCELLED.value
    await db.commit()
    return await get_run(db, run_id)


async def start_run(db: AsyncSession, run_id: int) -> DeliveryRunOut:
    """PLANNED → ACTIVE: siparişler 'dağıtımda' (SHIPPED) olur, müşteriler bilgilenir."""
    run = await _load_run(db, run_id)
    if run.status != DeliveryRunStatus.PLANNED.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Yalnız planlı tur başlatılabilir")
    if not run.stops:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Turda hiç durak yok")
    run.status = DeliveryRunStatus.ACTIVE.value
    run.started_at = _now()
    for stop in run.stops:
        order = stop.order
        order.status = "SHIPPED"
        order.tracking_no = f"ELDEN-R{run.id}-S{stop.id}"
        await notification_service.notify(
            db,
            user_id=order.client_id,
            role_id=ROLE_IDS[RoleType.CLIENT],
            message=f"Siparişin #{order.id} bugün dağıtımda — kuryemiz yola çıktı.",
            link="/siparislerim",
        )
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
    return await get_run(db, run_id)


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


async def eligible_orders(db: AsyncSession) -> list[EligibleOrderOut]:
    """Tura eklenebilir siparişler: ödenmiş + fiziksel + henüz açık durağı yok."""
    orders = (
        await db.execute(
            select(Order)
            .options(selectinload(Order.items))
            .where(
                Order.deleted_at.is_(None),
                Order.has_physical.is_(True),
                Order.payment_status == "PAID",
                Order.status == "PAID",
            )
            .order_by(Order.created_at.asc())
        )
    ).scalars().all()
    out: list[EligibleOrderOut] = []
    for o in orders:
        if await _has_open_stop(db, o.id):
            continue
        out.append(
            EligibleOrderOut(
                order_id=o.id,
                recipient=o.ship_recipient,
                phone=o.ship_phone,
                address=o.ship_address,
                lat=float(o.ship_lat) if o.ship_lat is not None else None,
                lng=float(o.ship_lng) if o.ship_lng is not None else None,
                total=str(o.total),
                item_count=sum(it.quantity for it in o.items if it.kind == "PHYSICAL"),
                created_at=o.created_at,
            )
        )
    return out


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
        # Aktif turda eklenen durak da hemen 'dağıtımda' sayılır.
        if run.status == DeliveryRunStatus.ACTIVE.value:
            await db.flush()
            order.status = "SHIPPED"
            order.tracking_no = f"ELDEN-R{run.id}-S{stop.id}"
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
        stop.order.status = "PAID"
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
    for s, detour in zip(ordered_stops, detours):
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


# ── Teslim akışı (dağıtıcı) ───────────────────────────────────────────────────────


def _require_field_stop(stop: DeliveryStop) -> None:
    """Teslim aksiyonları yalnız AKTİF turdaki BEKLEYEN durakta anlamlıdır."""
    if stop.run.status != DeliveryRunStatus.ACTIVE.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Tur sahada (aktif) değil")
    if stop.status != DeliveryStopStatus.PENDING.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu durak zaten sonuçlanmış")


async def send_otp(db: AsyncSession, stop_id: int) -> str:
    """Müşteriye teslim OTP'si SMS'ler; maskeli numarayı döner."""
    stop = await _load_stop(db, stop_id)
    _require_field_stop(stop)
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
    await sms.send_delivery_otp_sms(to=phone, code=code, order_id=stop.order_id)
    # phone_service ile aynı maske biçimi
    return phone[:5] + "***" + phone[-2:] if len(phone) >= 6 else phone


async def _finalize_delivered(
    db: AsyncSession,
    stop: DeliveryStop,
    *,
    proof: DeliveryProof,
    lat: float | None = None,
    lng: float | None = None,
    note: str | None = None,
) -> None:
    stop.status = DeliveryStopStatus.DELIVERED.value
    stop.delivered_at = _now()
    stop.delivered_lat = lat
    stop.delivered_lng = lng
    stop.proof = proof.value
    if note:
        stop.courier_note = note
    order = stop.order
    order.status = "DELIVERED"
    await db.commit()
    await notification_service.notify(
        db,
        user_id=order.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message=f"Siparişin #{order.id} teslim edildi. İyi çalışmalar!",
        link="/siparislerim",
    )
    await db.commit()
    await order_service._email_order(db, order, "DELIVERED")


async def verify_delivery(
    db: AsyncSession,
    stop_id: int,
    *,
    code: str,
    lat: float | None = None,
    lng: float | None = None,
) -> DeliveryStopOut:
    """Kapıda müşterinin söylediği OTP'yi doğrular → durak DELIVERED, sipariş DELIVERED."""
    stop = await _load_stop(db, stop_id)
    _require_field_stop(stop)
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
    stop = await _load_stop(db, stop_id)
    _require_field_stop(stop)
    await _finalize_delivered(db, stop, proof=DeliveryProof.ADMIN, note=note)
    return _stop_to_out(await _load_stop(db, stop_id))


async def fail_stop(db: AsyncSession, stop_id: int, *, reason: str) -> DeliveryStopOut:
    """Teslim edilemedi: durak FAILED, sipariş PAID'e döner (ertesi tura eklenebilir)."""
    stop = await _load_stop(db, stop_id)
    _require_field_stop(stop)
    stop.status = DeliveryStopStatus.FAILED.value
    stop.courier_note = reason
    order = stop.order
    order.status = "PAID"
    order.tracking_no = None
    await db.commit()
    await notification_service.notify(
        db,
        user_id=order.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message=f"Siparişin #{order.id} bugün teslim edilemedi; yeniden planlanacak.",
        link="/siparislerim",
    )
    await db.commit()
    return _stop_to_out(await _load_stop(db, stop_id))


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
