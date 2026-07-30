"""Hakediş defteri uçları (ADMIN).

"Kime ne kadar borçluyuz" listesi + yapılan havalenin kaydı. Ödeme banka
üzerinden ELLE yapılır; burada yalnız defter tutulur.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_admin_permission
from core.database import get_db
from models.admin import Admin
from services import audit_service, payment_gates, payout_ledger

router = APIRouter(prefix="/payouts", tags=["payouts"])


class PayeeBalanceOut(BaseModel):
    payee_type: str
    payee_id: int
    name: str
    iban: str | None = None
    #: Hak edilmiş net toplam (komisyon düşülmüş).
    earned: str
    #: Şimdiye dek ödenen.
    paid: str
    #: Ödenmemiş bakiye = earned − paid.
    balance: str
    #: Emanetteki (henüz hak edilmemiş) tutar — borç DEĞİL, bilgi amaçlı.
    pending: str


class PayoutCreate(BaseModel):
    payee_type: str = Field(pattern="^(TUTOR|LIBRARY)$")
    payee_id: int
    amount: Decimal = Field(gt=0)
    reference: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=1000)


class PayoutRecordOut(BaseModel):
    id: int
    payee_type: str
    payee_id: int
    amount: str
    currency: str
    iban_snapshot: str | None = None
    reference: str | None = None
    note: str | None = None
    paid_at: datetime.datetime


@router.get("/pending", response_model=list[PayeeBalanceOut])
async def list_pending(
    only_owed: bool = Query(default=True),
    _admin: Admin = Depends(require_admin_permission("payments.view")),
    db: AsyncSession = Depends(get_db),
):
    """Ödeme günü bakılacak liste: kime ne kadar borçluyuz."""
    rows = await payout_ledger.list_balances(db, only_owed=only_owed)
    return [
        PayeeBalanceOut(
            payee_type=b.payee_type,
            payee_id=b.payee_id,
            name=b.name,
            iban=b.iban,
            earned=str(b.earned),
            paid=str(b.paid),
            balance=str(b.balance),
            pending=str(b.pending),
        )
        for b in rows
    ]


@router.get("", response_model=list[PayoutRecordOut])
async def list_history(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    _admin: Admin = Depends(require_admin_permission("payments.view")),
    db: AsyncSession = Depends(get_db),
):
    """Yapılmış ödemelerin geçmişi."""
    rows = await payout_ledger.history(db, limit=limit, offset=offset)
    return [
        PayoutRecordOut(
            id=r.id,
            payee_type=r.payee_type,
            payee_id=r.payee_id,
            amount=str(r.amount),
            currency=r.currency,
            iban_snapshot=r.iban_snapshot,
            reference=r.reference,
            note=r.note,
            paid_at=r.paid_at,
        )
        for r in rows
    ]


@router.post("", response_model=PayoutRecordOut, status_code=status.HTTP_201_CREATED)
async def record_payout(
    payload: PayoutCreate,
    admin: Admin = Depends(require_admin_permission("payments.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Yapılan havaleyi deftere işler.

    Kısmi ödeme meşrudur; borçtan FAZLASI reddedilir — aksi halde bakiye
    negatife düşer ve mutabakat bozulur.
    """
    await payment_gates.assert_manual_payout_open(db)
    balance = await payout_ledger.balance_for(
        db, payee_type=payload.payee_type, payee_id=payload.payee_id
    )
    if balance is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alıcı bulunamadı")
    if payload.amount > balance.balance:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Ödenmemiş bakiye {balance.balance} {balance.payee_type == 'TUTOR' and 'TL' or 'TL'}; "
            f"bundan fazlası ({payload.amount}) kaydedilemez.",
        )

    row = await payout_ledger.record_payment(
        db,
        payee_type=payload.payee_type,
        payee_id=payload.payee_id,
        amount=payload.amount,
        admin_id=admin.id,
        reference=payload.reference,
        note=payload.note,
    )
    await db.flush()
    await audit_service.record(
        db,
        actor=admin,
        action="payout.record",
        target_type=payload.payee_type.lower(),
        target_id=payload.payee_id,
        details=f"{payload.amount} TL",
        meta={"reference": payload.reference},
    )
    await db.commit()
    await db.refresh(row)
    return PayoutRecordOut(
        id=row.id,
        payee_type=row.payee_type,
        payee_id=row.payee_id,
        amount=str(row.amount),
        currency=row.currency,
        iban_snapshot=row.iban_snapshot,
        reference=row.reference,
        note=row.note,
        paid_at=row.paid_at,
    )
