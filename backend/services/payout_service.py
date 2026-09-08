from __future__ import annotations

from core import frontend_yollari

import datetime
import logging

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from core import payments
from core.payments import SubMerchantInfo
from schemas.payout import PayoutOut, PayoutSubmitIn, mask_iban

logger = logging.getLogger(__name__)


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

    previous_iban = entity.iban
    entity.iban = payload.iban
    entity.sub_merchant_key = result.sub_merchant_key
    entity.payout_status = result.status  # ACTIVE (fake) | PENDING (gerçek iyzico)
    entity.identity_last4 = payload.tckn[-4:]
    entity.payout_updated_at = _now()
    await db.flush()
    await db.refresh(entity)

    if previous_iban and previous_iban != payload.iban:
        await _warn_iban_changed(db, entity, email=email, name=name)

    return to_out(entity)


async def _warn_iban_changed(db: AsyncSession, entity, *, email: str, name: str) -> None:
    """Para hedefi DEĞİŞTİ — sahibini uyar.

    Ele geçirilmiş bir hesapta saldırganın ilk hamlesi IBAN'ı kendi hesabına
    çevirmektir; sessiz yapılırsa ilk hakediş ödemesine kadar (haftalar) fark
    edilmez. Bildirim best-effort'tur: uyarı gönderilemedi diye kullanıcının
    meşru güncellemesi başarısız SAYILMAZ.

    E-posta uygulama içi bildirimden daha önemlidir: hesabı ele geçiren kişi
    uygulama içi bildirimi görüp okundu işaretleyebilir, gerçek sahibin
    posta kutusuna erişemez.
    """
    from core import mail

    masked = mask_iban(entity.iban)
    try:
        await mail.send_payout_changed_email(to=email, name=name, iban_masked=masked)
    except Exception:  # noqa: BLE001 - uyarı akışı bozmamalı
        logger.warning("IBAN değişikliği e-postası gönderilemedi", exc_info=True)

    role_id = getattr(entity, "role_id", None)
    if role_id is None:
        # Kütüphane bir kullanıcı hesabı değildir (operatörler ayrı tabloda);
        # uygulama içi bildirim yolu yok, e-posta + audit yeterli.
        return
    try:
        from services import notification_service

        await notification_service.notify(
            db,
            user_id=entity.id,
            role_id=role_id,
            message=(
                f"Ödeme hesabın güncellendi ({masked}). "
                "Bu işlemi sen yapmadıysan hemen şifreni değiştir."
            ),
            # `/panel/odeme-hesabi` diye bir yol HİÇ olmadı ve yönlendirmesi de
            # yoktu: bu güvenlik bildirimi ("sen yapmadıysan şifreni değiştir")
            # 404 açıyordu. Ödeme bilgileri Ayarlar sekmesindedir.
            link=frontend_yollari.AYARLAR,
        )
    except Exception:  # noqa: BLE001
        logger.warning("IBAN değişikliği bildirimi yazılamadı", exc_info=True)
