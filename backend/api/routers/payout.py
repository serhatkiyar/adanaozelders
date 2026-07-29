from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_roles
from core.database import get_db
from models.role import RoleType
from models.tutor import Tutor
from schemas.payout import PayoutOut, PayoutSubmitIn
from services import audit_service, payout_service

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
    result = await payout_service.submit(
        db,
        tutor,
        external_id=f"tutor:{tutor.id}",
        name=tutor.full_name,
        email=tutor.email,
        payload=payload,
    )
    # Para hedefinin değişmesi denetlenebilir olmalı: bir hesap ele geçirilirse
    # "ne zaman, hangi IP'den değişti" sorusunun cevabı burada kalır. Kütüphane
    # yolunda bu kayıt zaten vardı, eğitmen yolunda YOKTU.
    # IBAN/TCKN audit redaction'ından geçer; kayıtta yalnız "değişti" bilgisi kalır.
    await audit_service.record(
        db,
        actor=tutor,
        action="payout.submit",
        target_type="tutor",
        target_id=tutor.id,
        after=payload.model_dump(exclude_unset=True),
    )
    return result
