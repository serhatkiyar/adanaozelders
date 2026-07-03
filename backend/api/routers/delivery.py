"""Kendi-filo teslimat uçları — tümü ADMIN (dağıtım ekibi platform ekibidir).

Planlama: tur CRUD + durak ekle/çıkar/sırala + uygun siparişler.
Saha (dağıtıcı ekranı): QR tarama, OTP gönder/doğrula, teslim edilemedi, override.
"""
from __future__ import annotations

import datetime

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_roles
from core.database import get_db
from models.role import RoleType
from schemas.delivery import (
    DeliveryRunCreate,
    DeliveryRunOut,
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
)
from services import delivery_service

router = APIRouter(
    prefix="/delivery",
    tags=["delivery"],
    dependencies=[Depends(require_roles(RoleType.ADMIN))],
)


# ── Planlama ─────────────────────────────────────────────────────────────────────


@router.get("/eligible-orders", response_model=list[EligibleOrderOut])
async def eligible_orders(db: AsyncSession = Depends(get_db)):
    return await delivery_service.eligible_orders(db)


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


# ── Saha (dağıtıcı ekranı) ───────────────────────────────────────────────────────


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
