"""Kendi-filo teslimat uçları — tümü ADMIN (dağıtım ekibi platform ekibidir).

Planlama: tur CRUD + durak ekle/çıkar/sırala + uygun siparişler.
Saha (dağıtıcı ekranı): QR tarama, OTP gönder/doğrula, teslim edilemedi, override.
"""
from __future__ import annotations

import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import (
    get_current_active_user,
    require_admin_method_permission,
    require_admin_permission,
    require_roles,
    require_roles_or_admin_permission,
    user_rate_limit,
)
from core import courier_position, storage
from core.config import settings
from core.database import get_db
from models.role import RoleType
from schemas.delivery import (
    DeliveryBoardOut,
    DeliveryMetricsOut,
    PickupPointCreate,
    PickupPointOut,
    PickupPointUpdate,
    VehicleCreate,
    VehicleOut,
    VehicleUpdate,
    CapacityDayOut,
    ClosedDayIn,
    ClosedDayOut,
    CourierAccountCreate,
    CourierAccountOut,
    CourierCreate,
    CourierPasswordResetIn,
    CourierWorkspaceOut,
    DeliveryFeedbackOut,
    DeliveryKpiOut,
    CourierOut,
    CourierUpdate,
    DeliveryRunCreate,
    DeliveryRunOut,
    DeliveryRunUpdate,
    DeliveryStopOut,
    DispatchDayIn,
    EligibleOrderOut,
    OtpSendOut,
    OtpVerifyIn,
    OverrideDeliverIn,
    ScanIn,
    ScanOut,
    StopFailIn,
    StopsAddIn,
    StopsReorderIn,
    TrackIn,
)
from schemas.packing import HandoverManifestOut, HandoverScanIn, PackageOut
from api.routers.packing import _paket as _paket_out
from services import (
    audit_service,
    courier_account_service,
    delivery_calendar,
    delivery_feedback_service,
    delivery_service,
)

_MAX_PHOTO_BYTES = 12 * 1024 * 1024

router = APIRouter(
    prefix="/delivery",
    tags=["delivery"],
    dependencies=[Depends(require_admin_method_permission("delivery.view", "delivery.manage"))],
)

# İP-19 §3.4 / denetim B-10: filo yazma uçları kullanıcı bazlı limitlenir.
# Uçlar zaten ADMIN + `delivery.manage` ister; limit, döngüye girmiş bir
# panel/betiğin filoyu ya da rota servisini boğmasına karşıdır. Redis yoksa
# fail-open (mevcut desen).
_filo_limit = user_rate_limit(
    key="fleet_write",
    limit=settings.RATE_LIMIT_FLEET,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)

# Saha router'ı: ADMIN + KURYE. Kurye yalnız KENDİ atanmış turunun uçlarına
# erişir (courier_account_service.ensure_*_access → yabancı tur/durak 404).
# Yönetim/planlama uçları yukarıdaki ADMIN-only router'da kalır; override-deliver
# bilinçli ADMIN'dedir (OTP'siz teslim = yetki yükseltme yolu).
field_router = APIRouter(prefix="/delivery", tags=["delivery-field"])
_field_user = require_roles_or_admin_permission("delivery.manage", RoleType.COURIER)
_field_viewer = require_roles_or_admin_permission("delivery.view", RoleType.COURIER)


# ── Planlama ─────────────────────────────────────────────────────────────────────


@router.get("/eligible-orders", response_model=list[EligibleOrderOut])
async def eligible_orders(db: AsyncSession = Depends(get_db)):
    return await delivery_service.eligible_orders(db)


@router.get("/outsourced-orders", response_model=list[EligibleOrderOut])
async def outsourced_orders(db: AsyncSession = Depends(get_db)):
    """Bölge dışı ödenmiş fiziksel siparişler — dış kargo bekleyen kuyruk."""
    return await delivery_service.outsourced_orders(db)


@router.get("/prep-queue", response_model=list[EligibleOrderOut])
async def prep_queue(db: AsyncSession = Depends(get_db)):
    """Hazırlama istasyonu kuyruğu — henüz toplanmamış/etiketlenmemiş siparişler."""
    return await delivery_service.prep_queue(db)


# ── KALDIRILDI: elle hazırlama uçları (F30 commit 5) ─────────────────────────
#
# `POST /orders/{id}/prepare` ve `/unprepare` **bilinçli olarak silindi**
# (sözleşme §3.5, §7 S3). Gerekçe tek cümlede: iki kapı bırakmak "eksik kalem
# kabul edilmez" ilkesini boşa çıkarır. Elle "Hazır" butonu, kalem kalem
# doğrulanmamış bir paketi `eligible_orders` kuyruğuna sokabiliyordu — F30'un
# tamamı bu boşluğu (G1) kapatmak için yazıldı.
#
# Yerine geçen akış: `POST /packing/orders/{id}/open` → `/scan` → `/complete`.
# `prepared_at`'in TEK yazıcıları artık `packing_service.complete` ve
# `packing_service.repack`'tir; yapısal nöbetçi
# `test_f30_packing_contract.py::test_prepared_at_YAZICILARI_ALLOWLISTTE`
# yeni bir yazıcı eklenmesini kırmızıya çevirir.


@router.get("/attention-orders", response_model=list[EligibleOrderOut])
async def attention_orders(db: AsyncSession = Depends(get_db)):
    """İstisna kuyruğu — deneme hakkı dolmuş, operatör kararı bekleyen siparişler."""
    return await delivery_service.attention_orders(db)


@router.post("/orders/{order_id}/retry", response_model=EligibleOrderOut)
async def retry_exhausted_order(
    order_id: int,
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Deneme hakkı dolmuş siparişe bir tur daha hak tanı (müşteriyle görüşüldü)."""
    result = await delivery_service.retry_exhausted_order(db, order_id)
    await audit_service.record(
        db, actor=actor, action="delivery_order.retry_grant", target_type="order",
        target_id=order_id,
    )
    return result


@router.get("/calendar", response_model=list[ClosedDayOut])
async def list_closed_days(db: AsyncSession = Depends(get_db)):
    """Teslimata kapalı günler (yaklaşanlar) — admin takvimi."""
    return await delivery_calendar.list_closed_days(db)


@router.post("/calendar", response_model=ClosedDayOut, status_code=status.HTTP_201_CREATED)
async def add_closed_day(
    payload: ClosedDayIn,
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Bir günü teslimata kapalı işaretle (özel gün / elle tatil)."""
    closed = await delivery_calendar.add_closed_day(
        db, day=payload.day, label=payload.label
    )
    await audit_service.record(
        db, actor=actor, action="delivery_calendar.close", target_type="closed_day",
        target_id=closed.id, details=payload.label, meta={"day": payload.day},
    )
    return closed


@router.delete("/calendar/{closed_day_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_closed_day(
    closed_day_id: int,
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Kapalı gün işaretini kaldır (o gün yeniden teslimata açılır)."""
    await delivery_calendar.remove_closed_day(db, closed_day_id)
    await audit_service.record(
        db, actor=actor, action="delivery_calendar.reopen", target_type="closed_day",
        target_id=closed_day_id,
    )


@router.post("/calendar/seed-holidays", response_model=list[ClosedDayOut])
async def seed_holidays(
    year: int = Query(default=2026, ge=2025, le=2030),
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Yılın resmî tatillerini yükle (idempotent). Admin tetikler; istemediğini siler."""
    days = await delivery_calendar.seed_holidays(db, year)
    await audit_service.record(
        db, actor=actor, action="delivery_calendar.seed_holidays", target_type="closed_day",
        meta={"year": year, "count": len(days)},
    )
    return days


@router.get("/kpi", response_model=DeliveryKpiOut)
async def kpi_summary(
    days: int = Query(default=30, ge=1, le=180),
    db: AsyncSession = Depends(get_db),
):
    """Teslimat KPI özeti — söz tutma, ilk denemede teslim, başarısızlık nedenleri.
    İlk 90 gün hedefsiz baseline (PDS §14); oranlar yön verir, yargı üretmez."""
    return await delivery_service.kpi_summary(db, days=days)


@router.get("/feedback", response_model=list[DeliveryFeedbackOut])
async def recent_feedback(
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Son teslimat değerlendirmeleri (Faz 7) — 👎 yorumlarını okumak için."""
    return await delivery_feedback_service.list_recent(db, limit=limit)


@router.get("/capacity", response_model=list[CapacityDayOut])
async def capacity_overview(
    days: int = Query(default=14, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
):
    """Önümüzdeki günlerin söz doluluğu — kapasite şeridi (booked/capacity +
    söz borcu). Sayım, söz motoruyla aynı filtreyi kullanır."""
    return await delivery_service.capacity_overview(db, days=days)


@router.post("/dispatch-day", response_model=list[DeliveryRunOut])
async def dispatch_day(
    payload: DispatchDayIn,
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Günü Optimize Et: uygun siparişleri araçlara bölüştürüp optimize turlar kurar."""
    runs = await delivery_service.dispatch_day(db, payload.run_date)
    await audit_service.record(
        db, actor=actor, action="delivery.dispatch_day", target_type="delivery_run",
        meta={"run_date": payload.run_date, "run_ids": [r.id for r in runs]},
    )
    return runs


@router.get("/runs", response_model=list[DeliveryRunOut])
async def list_runs(
    run_date: datetime.date | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """Tur listesi/arşivi. Dönen liste ``limit``'ten kısaysa son sayfadır."""
    return await delivery_service.list_runs(
        db, run_date=run_date, limit=limit, offset=offset
    )


@router.post("/runs", response_model=DeliveryRunOut, status_code=status.HTTP_201_CREATED)
async def create_run(
    payload: DeliveryRunCreate,
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    run = await delivery_service.create_run(db, payload)
    await audit_service.record(
        db, actor=actor, action="delivery_run.create", target_type="delivery_run",
        target_id=run.id, after=payload.model_dump(exclude_unset=True),
    )
    return run


@field_router.get("/runs/{run_id}", response_model=DeliveryRunOut)
async def get_run(
    run_id: int,
    user=Depends(_field_viewer),
    db: AsyncSession = Depends(get_db),
):
    await courier_account_service.ensure_run_access(db, user, run_id)
    return await delivery_service.get_run(db, run_id)


@router.patch("/runs/{run_id}", response_model=DeliveryRunOut)
async def update_run(
    run_id: int,
    payload: DeliveryRunUpdate,
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Tur meta güncellemesi (kurye ataması)."""
    run = await delivery_service.update_run(db, run_id, payload)
    await audit_service.record(
        db, actor=actor, action="delivery_run.update", target_type="delivery_run",
        target_id=run_id, after=payload.model_dump(exclude_unset=True),
    )
    return run


# ── Filo (İP-19): araç + başlangıç noktası + gün tahtası + metrikler ─────────────
# Yetki router seviyesinde: GET → delivery.view, mutasyon → delivery.manage
# (`require_admin_method_permission`). Yetkisiz admin 403 alır (D-2).


@router.get("/vehicles", response_model=list[VehicleOut])
async def list_vehicles(db: AsyncSession = Depends(get_db)):
    return await delivery_service.list_vehicles(db)


@router.post(
    "/vehicles",
    response_model=VehicleOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_filo_limit)],
)
async def create_vehicle(
    payload: VehicleCreate,
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    out = await delivery_service.create_vehicle(db, payload)
    await audit_service.record(
        db, actor=actor, action="vehicle.create", target_type="vehicle",
        target_id=out.id, details=out.label,
    )
    return out


@router.patch(
    "/vehicles/{vehicle_id}",
    response_model=VehicleOut,
    dependencies=[Depends(_filo_limit)],
)
async def update_vehicle(
    vehicle_id: int,
    payload: VehicleUpdate,
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    out = await delivery_service.update_vehicle(db, vehicle_id, payload)
    await audit_service.record(
        db, actor=actor, action="vehicle.update", target_type="vehicle",
        target_id=vehicle_id, after=payload.model_dump(exclude_unset=True, mode="json"),
    )
    return out


@router.delete(
    "/vehicles/{vehicle_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(_filo_limit)],
)
async def delete_vehicle(
    vehicle_id: int,
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete; AÇIK turu olan araç silinemez → 409 (D-8)."""
    await delivery_service.delete_vehicle(db, vehicle_id)
    await audit_service.record(
        db, actor=actor, action="vehicle.delete", target_type="vehicle",
        target_id=vehicle_id,
    )


@router.get("/pickup-points", response_model=list[PickupPointOut])
async def list_pickup_points(db: AsyncSession = Depends(get_db)):
    return await delivery_service.list_pickup_points(db)


@router.post(
    "/pickup-points",
    response_model=PickupPointOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_filo_limit)],
)
async def create_pickup_point(
    payload: PickupPointCreate,
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """K-9 gereği başlangıç/toplama noktaları veridir — deploy'suz düzenlenir.
    (Sözleşme uç tablosunda yoktu; K-9'un doğal sonucu olarak eklendi ve
    kapanış raporunda ek olarak bildirilecek.)"""
    out = await delivery_service.create_pickup_point(db, payload)
    await audit_service.record(
        db, actor=actor, action="pickup_point.create", target_type="pickup_point",
        target_id=out.id, details=out.name,
    )
    return out


@router.patch(
    "/pickup-points/{point_id}",
    response_model=PickupPointOut,
    dependencies=[Depends(_filo_limit)],
)
async def update_pickup_point(
    point_id: int,
    payload: PickupPointUpdate,
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Nokta düzenleme (denetim B-9): K-9'un "deploy'suz düzenlenir" iddiası
    yalnız GET+POST ile karşılanmıyordu — yanlış girilmiş bir koordinat
    müşteriye gösterilen varış penceresini bozar."""
    out = await delivery_service.update_pickup_point(db, point_id, payload)
    await audit_service.record(
        db, actor=actor, action="pickup_point.update", target_type="pickup_point",
        target_id=point_id, after=payload.model_dump(exclude_unset=True, mode="json"),
    )
    return out


@router.get("/board", response_model=DeliveryBoardOut)
async def delivery_board(
    date: datetime.date = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Gün tahtası (§4.2): atanmamış havuz + araç bazlı turlar (D-11/D-13)."""
    return await delivery_service.board(db, date)


@router.get("/metrics", response_model=DeliveryMetricsOut)
async def delivery_metrics(
    from_date: datetime.date = Query(...),
    to_date: datetime.date = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Beş operasyon metriği (§4.3, D-14)."""
    return await delivery_service.delivery_metrics(
        db, from_date=from_date, to_date=to_date
    )


# ── Kurye profilleri ─────────────────────────────────────────────────────────────


@router.get("/couriers", response_model=list[CourierOut])
async def list_couriers(db: AsyncSession = Depends(get_db)):
    return await delivery_service.list_couriers(db)


@router.post("/couriers", response_model=CourierOut, status_code=status.HTTP_201_CREATED)
async def create_courier(
    payload: CourierCreate,
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    courier = await delivery_service.create_courier(db, payload)
    await audit_service.record(
        db, actor=actor, action="courier.create", target_type="courier",
        target_id=courier.id, details=courier.name,
    )
    return courier


@router.patch("/couriers/{courier_id}", response_model=CourierOut)
async def update_courier(
    courier_id: int,
    payload: CourierUpdate,
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Pasifleştirme (is_active=False) bağlı giriş hesabını da kapatır —
    servis katmanı zinciri (actor audit için geçirilir)."""
    courier = await delivery_service.update_courier(db, courier_id, payload, actor=actor)
    await audit_service.record(
        db, actor=actor, action="courier.update", target_type="courier",
        target_id=courier_id, after=payload.model_dump(exclude_unset=True),
    )
    return courier


@router.delete("/couriers/{courier_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_courier(
    courier_id: int,
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Kurye silme bağlı rol-5 giriş hesabını da kapatır (oturumlar düşer)."""
    await delivery_service.delete_courier(db, courier_id, actor=actor)
    await audit_service.record(
        db, actor=actor, action="courier.delete", target_type="courier", target_id=courier_id
    )


@router.post("/couriers/{courier_id}/photo", response_model=CourierOut)
async def upload_courier_photo(
    courier_id: int,
    file: UploadFile = File(...),
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Kurye vesikalık fotoğrafı (müşteri takip sayfasındaki kimlik kartı)."""
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Yalnızca görsel yüklenebilir.")
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Boş dosya.")
    if len(data) > _MAX_PHOTO_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Görsel 12MB sınırını aşıyor.")
    url = await storage.upload_courier_photo(data)
    courier = await delivery_service.set_courier_photo(db, courier_id, url)
    await audit_service.record(
        db, actor=actor, action="courier.photo_update", target_type="courier",
        target_id=courier_id, meta={"filename": file.filename},
    )
    return courier


@router.post("/runs/{run_id}/stops", response_model=DeliveryRunOut)
async def add_stops(
    run_id: int,
    payload: StopsAddIn,
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    run = await delivery_service.add_stops(db, run_id, payload.order_ids)
    await audit_service.record(
        db, actor=actor, action="delivery_run.add_stops", target_type="delivery_run",
        target_id=run_id, meta={"order_ids": payload.order_ids},
    )
    return run


@router.put("/runs/{run_id}/reorder", response_model=DeliveryRunOut)
async def reorder_stops(
    run_id: int,
    payload: StopsReorderIn,
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    run = await delivery_service.reorder_stops(db, run_id, payload.stop_ids)
    await audit_service.record(
        db, actor=actor, action="delivery_run.reorder", target_type="delivery_run",
        target_id=run_id, meta={"stop_ids": payload.stop_ids},
    )
    return run


@router.post("/runs/{run_id}/optimize", response_model=DeliveryRunOut)
async def optimize_run(
    run_id: int,
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Bekleyen durakları optimal sıraya dizer (VROOM; yoksa haversine fallback)."""
    run = await delivery_service.optimize_run(db, run_id)
    await audit_service.record(
        db, actor=actor, action="delivery_run.optimize", target_type="delivery_run",
        target_id=run_id,
        meta={
            "provider": run.optimize_provider,
            "total_distance_km": run.total_distance_km,
        },
    )
    return run


@router.post("/runs/{run_id}/start", response_model=DeliveryRunOut)
async def start_run(
    run_id: int,
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    run = await delivery_service.start_run(db, run_id)
    await audit_service.record(
        db, actor=actor, action="delivery_run.start", target_type="delivery_run",
        target_id=run_id, after={"status": run.status},
    )
    return run


@field_router.post("/runs/{run_id}/complete", response_model=DeliveryRunOut)
async def complete_run(
    run_id: int,
    user=Depends(_field_user),
    db: AsyncSession = Depends(get_db),
):
    """Kurye kendi ACTIVE turunu son durak bitince kapatır; admin her turu."""
    await courier_account_service.ensure_run_access(db, user, run_id)
    run = await delivery_service.complete_run(db, run_id)
    # Saha aksiyonları da audit'e yazılır (actor_role=5 kurye olabilir):
    # "turu kim, ne zaman kapattı" sorusunun tek yapısal izi budur.
    await audit_service.record(
        db, actor=user, action="delivery_run.complete", target_type="delivery_run",
        target_id=run_id, after={"status": run.status},
    )
    return run


@router.post("/runs/{run_id}/cancel", response_model=DeliveryRunOut)
async def cancel_run(
    run_id: int,
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    run = await delivery_service.cancel_run(db, run_id)
    await audit_service.record(
        db, actor=actor, action="delivery_run.cancel", target_type="delivery_run",
        target_id=run_id, after={"status": run.status},
    )
    return run


@router.delete("/stops/{stop_id}", response_model=DeliveryRunOut)
async def remove_stop(
    stop_id: int,
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    run = await delivery_service.remove_stop(db, stop_id)
    await audit_service.record(
        db, actor=actor, action="delivery_stop.remove", target_type="delivery_stop",
        target_id=stop_id, meta={"run_id": run.id},
    )
    return run


@field_router.post("/stops/{stop_id}/photo", response_model=DeliveryStopOut)
async def upload_stop_photo(
    stop_id: int,
    file: UploadFile = File(...),
    user=Depends(_field_user),
    db: AsyncSession = Depends(get_db),
):
    """Teslim kanıtı fotoğrafı (PoD) — kapıya/komşuya bırakmada zorunlu kanıt,
    normal teslimde opsiyonel ek. Yeniden çekimde eskisinin yerine geçer.
    Sahiplik STORAGE YAZIMINDAN ÖNCE doğrulanır (orphan upload önlenir)."""
    await courier_account_service.ensure_stop_access(db, user, stop_id)
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Yalnızca görsel yüklenebilir.")
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Boş dosya.")
    if len(data) > _MAX_PHOTO_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Görsel 12MB sınırını aşıyor.")
    url = await storage.upload_delivery_photo(data)
    return await delivery_service.set_stop_photo(db, stop_id, url)


# ── Saha (dağıtıcı ekranı — ADMIN + sahip KURYE) ─────────────────────────────────


@field_router.get("/me", response_model=CourierWorkspaceOut)
async def courier_me(
    user=Depends(require_roles(RoleType.COURIER)),
    db: AsyncSession = Depends(get_db),
):
    """Kurye açılış ekranı: hesabım + profilim + güncel turum (ACTIVE, yoksa
    bugünün PLANNED'ı, yoksa null). Kuryeye tur LİSTESİ verilmez."""
    from models.courier import Courier as CourierModel

    run_id = await courier_account_service.current_run_id(db, user)
    run = await delivery_service.get_run(db, run_id) if run_id else None
    profile = await db.get(CourierModel, user.courier_id)
    return CourierWorkspaceOut(
        account=courier_account_service._to_out(user),
        courier=delivery_service._courier_to_out(profile) if profile else None,
        run=run,
    )


@field_router.post("/runs/{run_id}/track", status_code=status.HTTP_204_NO_CONTENT)
async def track_run(
    run_id: int,
    payload: TrackIn,
    user=Depends(_field_user),
    db: AsyncSession = Depends(get_db),
):
    """Dağıtıcı telefonunun konum ping'i (~10 sn'de bir; Redis, kalıcı iz yok)."""
    await courier_account_service.ensure_run_access(db, user, run_id)
    await delivery_service.track_run(db, run_id, lat=payload.lat, lng=payload.lng)


@field_router.get("/runs/{run_id}/position")
async def run_position(
    run_id: int,
    user=Depends(_field_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Kuryenin son bilinen konumu (admin rota haritası) — yoksa null alanlar."""
    await courier_account_service.ensure_run_access(db, user, run_id)
    pos = await courier_position.get_position(run_id)
    return pos or {"lat": None, "lng": None, "age_seconds": None}


def _saha_kurye_id(user) -> int | None:
    """Saha kullanıcısının kurye kimliği; ADMIN ise `None` (süzgeç uygulanmaz).

    Sahiplik süzgeci **servise** verilir, yalnız sonradan doğrulanmaz: paket
    QR'ı ile gelen istekte durak, siparişin turlarından bulunur ve yabancı
    kuryenin turu hiç eşleşmemelidir. Sonradan kontrol, arada durağın
    alıcı bilgisini okumuş olmak demekti.
    """
    return user.courier_id if courier_account_service.is_courier_user(user) else None


@field_router.post("/scan", response_model=ScanOut)
async def scan(
    payload: ScanIn,
    user=Depends(_field_user),
    db: AsyncSession = Depends(get_db),
):
    """Kapıda etiket okutma. **İki QR uzayı** kabul edilir (sözleşme §3.3):
    `PKG1:{paket}:{token}` (F30, kalıcı) ve `{durak}:{token}` (mevcut, basılmış
    eski etiketler için geriye uyum). Paket QR'ında paket ZİMMETLİ olmalıdır —
    depoda duran ya da geri beklenen paket teslim akışını açmaz (409)."""
    stop, run_status = await delivery_service.scan(
        db, payload.payload, courier_id=_saha_kurye_id(user)
    )
    # İkinci savunma hattı: QR başka kuryenin paketiyse varlık sızdırma — 404.
    await courier_account_service.ensure_stop_access(db, user, stop.id)
    return ScanOut(stop=stop, run_status=run_status)


@field_router.post("/handover/scan", response_model=PackageOut)
async def handover_scan(
    payload: HandoverScanIn,
    user=Depends(_field_user),
    db: AsyncSession = Depends(get_db),
):
    """Kurye zimmeti: paket QR'ı → paket `HANDED_OVER`, sipariş `SHIPPED`.

    Sözleşme §3.4: işletmeden çıkış artık bir butona değil, kuryenin elindeki
    paketi okutmasına bağlıdır. Aynı etiketin tekrar okutulması ikinci bir
    `SHIPPED` geçişi, ikinci takip numarası ya da ikinci bildirim ÜRETMEZ.
    Yabancı paket 404 (IDOR deseni); eksik/geri beklenen paket 409.
    """
    gorunum = await delivery_service.handover_scan(
        db,
        payload.payload,
        courier_id=_saha_kurye_id(user),
        actor=f"{'courier' if courier_account_service.is_courier_user(user) else 'admin'}:{user.id}",
        actor_role=user.role_id,
        actor_id=user.id,
    )
    return _paket_out(gorunum)


@field_router.get("/handover/manifest/{run_id}", response_model=HandoverManifestOut)
async def handover_manifest(
    run_id: int,
    user=Depends(_field_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Zimmet listesi: kaç paket alındı / kaç paket var + EKSİK olanlar.

    Eksik paketi ancak turu başlatırken (409) öğrenmek, onu depoda değil yolda
    fark etmek demektir.
    """
    await courier_account_service.ensure_run_access(db, user, run_id)
    return await delivery_service.handover_manifest(db, run_id)


@field_router.post("/stops/{stop_id}/send-otp", response_model=OtpSendOut)
async def send_otp(
    stop_id: int,
    user=Depends(_field_user),
    db: AsyncSession = Depends(get_db),
):
    """``sent`` GERÇEK gönderim sonucudur — SMS sağlayıcısı düşükken kuryeye
    "gönderildi" denmez (müşteri kapıda hiç gelmeyecek kodu beklemesin)."""
    await courier_account_service.ensure_stop_access(db, user, stop_id)
    masked, sent = await delivery_service.send_otp(db, stop_id)
    return OtpSendOut(masked_phone=masked, sent=sent)


@field_router.post("/stops/{stop_id}/verify", response_model=DeliveryStopOut)
async def verify_delivery(
    stop_id: int,
    payload: OtpVerifyIn,
    user=Depends(_field_user),
    db: AsyncSession = Depends(get_db),
):
    await courier_account_service.ensure_stop_access(db, user, stop_id)
    stop = await delivery_service.verify_delivery(
        db, stop_id, code=payload.code, lat=payload.lat, lng=payload.lng
    )
    await audit_service.record(
        db, actor=user, action="delivery_stop.deliver", target_type="delivery_stop",
        target_id=stop_id, meta={"order_id": stop.order_id, "proof": stop.proof},
    )
    return stop


@field_router.post("/stops/{stop_id}/deliver-drop", response_model=DeliveryStopOut)
async def deliver_drop(
    stop_id: int,
    user=Depends(_field_user),
    db: AsyncSession = Depends(get_db),
):
    """Kapıya/komşuya bırakma teslimi (müşteri talimatlıysa; foto kanıt zorunlu)."""
    await courier_account_service.ensure_stop_access(db, user, stop_id)
    stop = await delivery_service.deliver_drop(db, stop_id)
    await audit_service.record(
        db, actor=user, action="delivery_stop.deliver_drop", target_type="delivery_stop",
        target_id=stop_id, meta={"order_id": stop.order_id, "proof": stop.proof},
    )
    return stop


@router.post("/stops/{stop_id}/override-deliver", response_model=DeliveryStopOut)
async def override_deliver(
    stop_id: int,
    payload: OverrideDeliverIn,
    actor=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Notlu YÖNETİCİ teslimi — OTP bypass'ı olduğundan bilinçli ADMIN-only;
    kurye kod ulaşmadığında yöneticiyle iletişime geçer (UI yönlendirir)."""
    stop = await delivery_service.override_deliver(db, stop_id, note=payload.note)
    await audit_service.record(
        db, actor=actor, action="delivery_stop.override_deliver", target_type="delivery_stop",
        target_id=stop_id, reason=payload.note, meta={"order_id": stop.order_id},
    )
    return stop


@field_router.post("/stops/{stop_id}/fail", response_model=DeliveryStopOut)
async def fail_stop(
    stop_id: int,
    payload: StopFailIn,
    user=Depends(_field_user),
    db: AsyncSession = Depends(get_db),
):
    await courier_account_service.ensure_stop_access(db, user, stop_id)
    stop = await delivery_service.fail_stop(
        db, stop_id, reason=payload.reason, reason_code=payload.reason_code
    )
    await audit_service.record(
        db, actor=user, action="delivery_stop.fail", target_type="delivery_stop",
        target_id=stop_id, reason=payload.reason,
        meta={"order_id": stop.order_id, "reason_code": payload.reason_code},
    )
    return stop


# ── Kurye hesabı yaşam döngüsü (ADMIN) ───────────────────────────────────────────


@router.get("/couriers/{courier_id}/account", response_model=CourierAccountOut | None)
async def courier_account(courier_id: int, db: AsyncSession = Depends(get_db)):
    return await courier_account_service.account_for_courier(db, courier_id)


@router.post(
    "/couriers/{courier_id}/account",
    response_model=CourierAccountOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_courier_account(
    courier_id: int,
    payload: CourierAccountCreate,
    admin=Depends(require_admin_permission("delivery.manage")),
    db: AsyncSession = Depends(get_db),
):
    return await courier_account_service.create_account(
        db, courier_id, payload, actor=admin
    )


@router.post("/accounts/{account_id}/close", status_code=status.HTTP_204_NO_CONTENT)
async def close_courier_account(
    account_id: int,
    admin=Depends(require_admin_permission("delivery.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Kurye işten ayrıldı: hesap kapanır, telefonundaki oturum ANINDA düşer."""
    await courier_account_service.close_account(db, account_id, actor=admin)


@router.post(
    "/accounts/{account_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT
)
async def reset_courier_password(
    account_id: int,
    payload: CourierPasswordResetIn,
    admin=Depends(require_admin_permission("delivery.manage")),
    db: AsyncSession = Depends(get_db),
):
    await courier_account_service.reset_password(
        db, account_id, payload.new_password, actor=admin
    )
