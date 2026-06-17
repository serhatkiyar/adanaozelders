from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_roles
from core.database import get_db
from models.role import RoleType
from models.tutor import Tutor
from schemas.payout import PayoutOut, PayoutSubmitIn
from services import payout_service

router = APIRouter(prefix="/me/payout", tags=["payout"])


@router.get("", response_model=PayoutOut)
async def get_my_payout(
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    return payout_service.to_out(tutor)


@router.post("", response_model=PayoutOut)
async def submit_my_payout(
    payload: PayoutSubmitIn,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    """IBAN + TCKN ile ödeme hesabını (alt üye işyeri) oluştur/güncelle.
    İsim hesaptan gelir (A6); kimlik doğrulama sağlayıcının sorumluluğu."""
    return await payout_service.submit(
        db,
        tutor,
        external_id=f"tutor:{tutor.id}",
        name=tutor.full_name,
        email=tutor.email,
        payload=payload,
    )
