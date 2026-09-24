"""Öğretmen cüzdanı (Preply deseni — kullanıcı kararı, 23 Eyl 2026).

Ayrı bir kazançlar ekranı yok; üst bardaki cüzdan kutusu bu uçlardan beslenir:
  - ``GET  /me/wallet``            → ödenebilir bakiye, emanetteki tutar, açık talep
  - ``POST /me/wallet/withdrawals`` → "Para çek": bakiyenin TAMAMI için talep
  - ``GET  /me/wallet/export``      → "Geçmişi dosya olarak ver" (CSV)

Para öğretmen talep edene kadar gönderilmez; admin ödemeyi ancak açık talep
üzerine kaydedebilir (bkz. ``api/routers/payouts.py``).
"""
from __future__ import annotations

import csv
import datetime
import io
from decimal import Decimal

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_roles, user_rate_limit
from core import frontend_yollari
from core.database import get_db
from models.admin import Admin
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from services import audit_service, notification_service, payment_service, payout_ledger

router = APIRouter(prefix="/me/wallet", tags=["wallet"])

_talep_limit = user_rate_limit(key="wallet_withdraw", limit=5, window_seconds=3600)


class AcikTalepOut(BaseModel):
    amount: Decimal
    created_at: datetime.datetime


class WalletOut(BaseModel):
    #: Ödenebilir bakiye (hak edilmiş − ödenmiş), sunucuda hesaplanır.
    balance: Decimal
    #: Emanetteki (dersi henüz onaylanmamış) tutar — bilgi amaçlı.
    pending: Decimal
    currency: str = "TRY"
    #: IBAN hesabının durumu: NONE | PENDING | ACTIVE | REJECTED.
    payout_status: str
    open_request: AcikTalepOut | None = None
    #: "Para çek" açılamıyorsa gerekçe (düğme pasif + altında metin).
    withdraw_block_reason: str | None = None


async def _wallet(db: AsyncSession, tutor: Tutor) -> WalletOut:
    bakiye = await payout_ledger.tutor_balance(db, tutor)
    talep = await payout_ledger.open_request(db, tutor.id)
    return WalletOut(
        balance=bakiye.balance,
        pending=bakiye.pending,
        payout_status=tutor.payout_status,
        open_request=(
            AcikTalepOut(amount=talep.amount, created_at=talep.created_at)
            if talep
            else None
        ),
        withdraw_block_reason=payout_ledger.talep_engeli(
            payout_status=tutor.payout_status,
            balance=bakiye.balance,
            acik_talep_var=talep is not None,
        ),
    )


@router.get("", response_model=WalletOut)
async def my_wallet(
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    return await _wallet(db, tutor)


@router.post(
    "/withdrawals",
    response_model=WalletOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_talep_limit)],
)
async def request_withdrawal(
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    """Ödenebilir bakiyenin tamamı için para çekme talebi açar."""
    talep = await payout_ledger.create_request(db, tutor)
    await audit_service.record(
        db,
        actor=tutor,
        action="payout.request",
        target_type="tutor",
        target_id=tutor.id,
        details=f"{talep.amount} TL",
    )
    admin_ids = (
        await db.execute(select(Admin.id).where(Admin.deleted_at.is_(None)))
    ).scalars().all()
    for admin_id in admin_ids:
        await notification_service.notify(
            db,
            user_id=admin_id,
            role_id=ROLE_IDS[RoleType.ADMIN],
            message=f"{tutor.full_name} {talep.amount} TL para çekme talebi açtı.",
            link=frontend_yollari.ADMIN_HAKEDISLER,
        )
    out = await _wallet(db, tutor)
    # get_db commit'i yanıttan sonra çalışır; kutu hemen tazelenince yeni
    # talebi görsün diye commit yanıttan önce (reviews.py deseni).
    await db.commit()
    return out


_DURUM = {
    "PENDING": "Ödeme bekleniyor",
    "HELD": "Hesabına geçecek",
    "RELEASED": "Hesabına geçti",
    "PAID": "Hesabına geçti",
    "REFUNDED": "İade edildi",
    "REFUNDING": "İade ediliyor",
    "FAILED": "Başarısız",
    "CANCELLED": "İptal edildi",
}
_TALEP_DURUM = {
    "REQUESTED": "Talep edildi",
    "PAID": "Ödendi",
    "CANCELLED": "İptal edildi",
}
_KAYNAK = {"LESSON": "Ders", "STORE": "Mağaza satışı"}


def _tarih(value: datetime.datetime | None) -> str:
    return value.astimezone(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M") if value else ""


@router.get("/export")
async def export_wallet_history(
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    """Kazanç hareketleri + para çekme talepleri tek CSV'de.

    Başta UTF-8 BOM var: Excel onsuz dosyayı Latin-1 sanıp Türkçe harfleri
    bozuyor.
    """
    hareketler = await payment_service.earnings_transactions(
        db, tutor_id=tutor.id, limit=5000
    )
    talepler = await payout_ledger.tutor_payout_history(db, tutor.id)

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        ["Tarih (UTC)", "Tür", "Açıklama", "Karşı taraf", "Brüt", "Komisyon", "Net", "Durum"]
    )
    satirlar: list[tuple[datetime.datetime | None, list[str]]] = []
    for h in hareketler:
        zaman = h.get("occurred_at") or h.get("created_at")
        satirlar.append(
            (
                zaman,
                [
                    _tarih(zaman),
                    _KAYNAK.get(h.get("source", ""), h.get("source", "")),
                    h.get("title") or "",
                    h.get("counterparty") or "",
                    str(h.get("gross", "")),
                    str(h.get("commission", "")),
                    str(h.get("net", "")),
                    _DURUM.get(h.get("status", ""), h.get("status", "")),
                ],
            )
        )
    for t in talepler:
        zaman = t.paid_at or t.created_at
        satirlar.append(
            (
                zaman,
                [
                    _tarih(zaman),
                    "Para çekme",
                    "Para çekme talebi",
                    "",
                    "",
                    "",
                    f"-{t.amount}",
                    _TALEP_DURUM.get(t.status, t.status),
                ],
            )
        )
    en_eski = datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)
    satirlar.sort(key=lambda s: s[0] or en_eski, reverse=True)
    for _zaman, satir in satirlar:
        w.writerow(satir)

    bugun = datetime.date.today().isoformat()
    return Response(
        content="﻿" + buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="cuzdan-gecmisi-{bugun}.csv"'
        },
    )
