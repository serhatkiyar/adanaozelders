from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from core import payments
from core.payments import SubMerchantInfo
from schemas.payout import PayoutOut, PayoutSubmitIn, mask_iban


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def to_out(entity) -> PayoutOut:
    """PayoutMixin'li bir varlıktan (Tutor/Library) durum çıktısı (IBAN maskeli)."""
    return PayoutOut(
        payout_status=entity.payout_status or "NONE",
        iban_masked=mask_iban(entity.iban),
        identity_last4=entity.identity_last4,
        payout_updated_at=entity.payout_updated_at,
    )


async def submit(
    db: AsyncSession,
    entity,
    *,
    external_id: str,
    name: str,
    email: str,
    payload: PayoutSubmitIn,
) -> PayoutOut:
    """IBAN+TCKN'yi sağlayıcıya alt üye işyeri olarak iletir, sonucu varlığa yazar.

    Kimlik doğrulama (MERNIS/IBAN/MASAK) sağlayıcının işidir; fake'te anında ACTIVE,
    gerçek iyzico'da PENDING→onay. TCKN KALICI SAKLANMAZ — yalnız son4 tutulur.
    İsim hizalaması (A6): ``name`` her zaman hesap adından gelir, ayrışık yazım yok.
    """
    provider = payments.get_payment_provider()
    info = SubMerchantInfo(
        external_id=external_id,
        name=name,
        email=email,
        gsm=(payload.gsm or "5000000000").strip(),
        iban=payload.iban,
        identity_number=payload.tckn,
    )
    if entity.sub_merchant_key:
        result = await provider.update_submerchant(entity.sub_merchant_key, info)
    else:
        result = await provider.create_submerchant(info)

    if not result.success:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            result.error or "Ödeme hesabı oluşturulamadı; lütfen sonra tekrar dene.",
        )

    entity.iban = payload.iban
    entity.sub_merchant_key = result.sub_merchant_key
    entity.payout_status = result.status  # ACTIVE (fake) | PENDING (gerçek iyzico)
    entity.identity_last4 = payload.tckn[-4:]
    entity.payout_updated_at = _now()
    await db.flush()
    await db.refresh(entity)
    return to_out(entity)
