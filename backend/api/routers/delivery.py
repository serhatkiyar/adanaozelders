"""Kendi-filo teslimat uçları — tümü ADMIN (dağıtım ekibi platform ekibidir).

Planlama: tur CRUD + durak ekle/çıkar/sırala + uygun siparişler.
Saha (dağıtıcı ekranı): QR tarama, OTP gönder/doğrula, teslim edilemedi, override.
"""
from __future__ import annotations

import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_roles
from core import courier_position, storage
from core.database import get_db
from models.role import RoleType
from schemas.delivery import (
    CourierCreate,
    CourierOut,
    CourierUpdate,
    DeliveryRunCreate,
    DeliveryRunOut,
    DeliveryRunUpdate,
    DeliveryStopOut,
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
from services import delivery_service

_MAX_PHOTO_BYTES = 12 * 1024 * 1024

router = APIRouter(
    prefix="/delivery",
    tags=["delivery"],
    dependencies=[Depends(require_roles(RoleType.ADMIN))],
)


# ── Planlama ─────────────────────────────────────────────────────────────────────


@router.get("/eligible-orders", response_model=list[EligibleOrderOut])
async def eligible_orders(db: AsyncSession = Depends(get_db)):
    return await delivery_service.eligible_orders(db)


@router.get("/outsourced-orders", response_model=list[EligibleOrderOut])
async def outsourced_orders(db: AsyncSession = Depends(get_db)):
    """Bölge dışı ödenmiş fiziksel siparişler — dış kargo bekleyen kuyruk."""
    return await delivery_service.outsourced_orders(db)


@router.get("/runs", response_model=list[DeliveryRunOut])
async def list_runs(
    run_date: datetime.date | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    return await delivery_service.list_runs(db, run_date=run_date)


@router.post("/runs", response_model=DeliveryRunOut, status_code=status.HTTP_201_CREATED)
async def create_run(payload: DeliveryRunCreate, db: AsyncSession = Depends(get_db)):
    return await delivery_service.create_run(db, payload)


@router.get("/runs/{run_id}", response_model=DeliveryRunOut)
async def get_run(run_id: int, db: AsyncSession = Depends(get_db)):
    return await delivery_service.get_run(db, run_id)


@router.patch("/runs/{run_id}", response_model=DeliveryRunOut)
async def update_run(
    run_id: int, payload: DeliveryRunUpdate, db: AsyncSession = Depends(get_db)
):
    """Tur meta güncellemesi (kurye ataması)."""
    return await delivery_service.update_run(db, run_id, payload)


# ── Kurye profilleri ─────────────────────────────────────────────────────────────


@router.get("/couriers", response_model=list[CourierOut])
async def list_couriers(db: AsyncSession = Depends(get_db)):
    return await delivery_service.list_couriers(db)


@router.post("/couriers", response_model=CourierOut, status_code=status.HTTP_201_CREATED)
async def create_courier(payload: CourierCreate, db: AsyncSession = Depends(get_db)):
    return await delivery_service.create_courier(db, payload)


@router.patch("/couriers/{courier_id}", response_model=CourierOut)
async def update_courier(
    courier_id: int, payload: CourierUpdate, db: AsyncSession = Depends(get_db)
):
    return await delivery_service.update_courier(db, courier_id, payload)


@router.delete("/couriers/{courier_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_courier(courier_id: int, db: AsyncSession = Depends(get_db)):
    await delivery_service.delete_courier(db, courier_id)


@router.post("/couriers/{courier_id}/photo", response_model=CourierOut)
async def upload_courier_photo(
    courier_id: int,
    file: UploadFile = File(...),
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
    return await delivery_service.set_courier_photo(db, courier_id, url)


@router.post("/runs/{run_id}/stops", response_model=DeliveryRunOut)
async def add_stops(
    run_id: int, payload: StopsAddIn, db: AsyncSession = Depends(get_db)
):
    return await delivery_service.add_stops(db, run_id, payload.order_ids)


@router.put("/runs/{run_id}/reorder", response_model=DeliveryRunOut)
async def reorder_stops(
    run_id: int, payload: StopsReorderIn, db: AsyncSession = Depends(get_db)
):
    return await delivery_service.reorder_stops(db, run_id, payload.stop_ids)


@router.post("/runs/{run_id}/optimize", response_model=DeliveryRunOut)
async def optimize_run(run_id: int, db: AsyncSession = Depends(get_db)):
    """Bekleyen durakları optimal sıraya dizer (VROOM; yoksa haversine fallback)."""
    return await delivery_service.optimize_run(db, run_id)


@router.post("/runs/{run_id}/start", response_model=DeliveryRunOut)
async def start_run(run_id: int, db: AsyncSession = Depends(get_db)):
    return await delivery_service.start_run(db, run_id)


@router.post("/runs/{run_id}/complete", response_model=DeliveryRunOut)
async def complete_run(run_id: int, db: AsyncSession = Depends(get_db)):
    return await delivery_service.complete_run(db, run_id)


@router.post("/runs/{run_id}/cancel", response_model=DeliveryRunOut)
async def cancel_run(run_id: int, db: AsyncSession = Depends(get_db)):
    return await delivery_service.cancel_run(db, run_id)


@router.delete("/stops/{stop_id}", response_model=DeliveryRunOut)
async def remove_stop(stop_id: int, db: AsyncSession = Depends(get_db)):
    return await delivery_service.remove_stop(db, stop_id)


@router.post("/stops/{stop_id}/photo", response_model=DeliveryStopOut)
async def upload_stop_photo(
    stop_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Teslim kanıtı fotoğrafı (PoD) — kapıya/komşuya bırakmada zorunlu kanıt,
    normal teslimde opsiyonel ek. Yeniden çekimde eskisinin yerine geçer."""
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Yalnızca görsel yüklenebilir.")
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Boş dosya.")
    if len(data) > _MAX_PHOTO_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Görsel 12MB sınırını aşıyor.")
    url = await storage.upload_delivery_photo(data)
    return await delivery_service.set_stop_photo(db, stop_id, url)


# ── Saha (dağıtıcı ekranı) ───────────────────────────────────────────────────────


@router.post("/runs/{run_id}/track", status_code=status.HTTP_204_NO_CONTENT)
async def track_run(run_id: int, payload: TrackIn, db: AsyncSession = Depends(get_db)):
    """Dağıtıcı telefonunun konum ping'i (~10 sn'de bir; Redis, kalıcı iz yok)."""
    await delivery_service.track_run(db, run_id, lat=payload.lat, lng=payload.lng)


@router.get("/runs/{run_id}/position")
async def run_position(run_id: int):
    """Kuryenin son bilinen konumu (admin rota haritası) — yoksa null alanlar."""
    pos = await courier_position.get_position(run_id)
    return pos or {"lat": None, "lng": None, "age_seconds": None}


@router.post("/scan", response_model=ScanOut)
async def scan(payload: ScanIn, db: AsyncSession = Depends(get_db)):
    stop, run_status = await delivery_service.scan(db, payload.payload)
    return ScanOut(stop=stop, run_status=run_status)


@router.post("/stops/{stop_id}/send-otp", response_model=OtpSendOut)
async def send_otp(stop_id: int, db: AsyncSession = Depends(get_db)):
    masked = await delivery_service.send_otp(db, stop_id)
    return OtpSendOut(masked_phone=masked, sent=True)


@router.post("/stops/{stop_id}/verify", response_model=DeliveryStopOut)
async def verify_delivery(
    stop_id: int, payload: OtpVerifyIn, db: AsyncSession = Depends(get_db)
):
    return await delivery_service.verify_delivery(
        db, stop_id, code=payload.code, lat=payload.lat, lng=payload.lng
    )


@router.post("/stops/{stop_id}/override-deliver", response_model=DeliveryStopOut)
async def override_deliver(
    stop_id: int, payload: OverrideDeliverIn, db: AsyncSession = Depends(get_db)
):
    return await delivery_service.override_deliver(db, stop_id, note=payload.note)


@router.post("/stops/{stop_id}/fail", response_model=DeliveryStopOut)
async def fail_stop(
    stop_id: int, payload: StopFailIn, db: AsyncSession = Depends(get_db)
):
    return await delivery_service.fail_stop(db, stop_id, reason=payload.reason)
