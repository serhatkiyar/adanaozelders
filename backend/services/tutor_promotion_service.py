"""İlan öne çıkarma — satın alma, kesinleştirme, yürürlük ve iptal.

Sözleşme: `docs/one-cikarma-sozlesmesi.md`. Özet:

* Fiyat **sunucuda** katalogdan gelir (`core/promotion_packages.py`), kayda
  snapshot yazılır.
* Yürürlük bir **SQL yüklemidir** (`aktif_kosul`), zamanlanmış iş değil.
* Aktif kayıt varken alınan paket **kuyruğa** girer: süre eklenir, reddedilmez.
* İade yalnız admin işidir; kısmi iade yoktur.
"""
from __future__ import annotations

import datetime
import logging
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core import payments
from core.promotion_packages import (
    MAX_OPEN_PER_TUTOR,
    PROMOTION_PACKAGES,
    package_for,
)
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor, TutorStatus
from models.tutor_promotion import PromotionPaymentStatus, TutorPromotion
from services import escrow, notification_service, payment_gates

logger = logging.getLogger("adana.promotions")

_BRANCH = payment_gates.PaymentBranch.TUTOR_PROMOTION


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


# ── Yürürlük yüklemi ─────────────────────────────────────────────────────────


def aktif_kosul():
    """"Şu anda yürürlükte" SQL yüklemi — tek doğruluk kaynağı.

    Hem öne çıkarma sorgusu hem panel hem de kuyruk hesabı bunu kullanır;
    ikizlenirse biri diğerinden ayrışır ve para ile görünürlük çelişir.
    `func.now()` bilinçli: karşılaştırma **DB saatiyle** yapılır, uygulama
    sunucusunun saatiyle değil.
    """
    return and_(
        TutorPromotion.payment_status == PromotionPaymentStatus.PAID.value,
        TutorPromotion.cancelled_at.is_(None),
        TutorPromotion.starts_at.isnot(None),
        TutorPromotion.ends_at.isnot(None),
        TutorPromotion.starts_at <= func.now(),
        TutorPromotion.ends_at > func.now(),
    )


def acik_kosul():
    """Aktif VEYA gelecekte başlayacak (kuyruktaki) ödenmiş kayıtlar.

    Kuyruk sayımı burada yapılır: kontenjan "şu an görünen" değil, "satın
    alınmış ve henüz tükenmemiş" haklar üzerinden sayılmalıdır.
    """
    return and_(
        TutorPromotion.payment_status == PromotionPaymentStatus.PAID.value,
        TutorPromotion.cancelled_at.is_(None),
        TutorPromotion.ends_at.isnot(None),
        TutorPromotion.ends_at > func.now(),
    )


async def list_for_tutor(
    db: AsyncSession, tutor_id: int, *, limit: int = 50
) -> list[TutorPromotion]:
    """Eğitmenin satın alma geçmişi — yenisi üstte."""
    rows = await db.execute(
        select(TutorPromotion)
        .where(TutorPromotion.tutor_id == tutor_id)
        .order_by(TutorPromotion.id.desc())
        .limit(limit)
    )
    return list(rows.scalars().all())


async def acik_kayitlar(db: AsyncSession, tutor_id: int) -> list[TutorPromotion]:
    rows = await db.execute(
        select(TutorPromotion)
        .where(TutorPromotion.tutor_id == tutor_id, acik_kosul())
        .order_by(TutorPromotion.ends_at.asc())
    )
    return list(rows.scalars().all())


# ── Katalog ──────────────────────────────────────────────────────────────────


def list_packages() -> list[dict]:
    return [
        {"days": p.days, "price": p.price, "label": p.label}
        for p in PROMOTION_PACKAGES
    ]


# ── Satın alma ───────────────────────────────────────────────────────────────


async def purchase(
    db: AsyncSession,
    tutor: Tutor,
    *,
    days: int,
    terms_accepted: bool = False,
    client_ip: str | None = None,
) -> tuple[TutorPromotion, str | None]:
    """Paket satın alır. `(kayıt, redirect_url)` döner.

    `redirect_url` doluysa tahsilat hosted checkout'ta sürüyordur ve kayıt
    PENDING'dir — kesinleştirme `complete_checkout` ile callback'te olur.
    """
    await payment_gates.assert_branch_open(db, _BRANCH)

    if not terms_accepted:
        # Onay kapısı SUNUCUDA da vardır: arayüzdeki kutu bir kolaylıktır,
        # hukuki kanıt olan kayıt buradan geçer. Onaysız istek tahsilat
        # başlatmaz.
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Hizmetin hemen başladığını ve cayma hakkı istisnasını onaylamanız "
            "gerekiyor.",
        )

    package = package_for(days)
    if package is None:
        # Fiyat gibi SÜRE de istemciden gelmez: katalog dışı gün sayısı
        # "1000 günlük paket 149 TL" denemesinin kapısıdır.
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Geçersiz öne çıkarma paketi."
        )

    if tutor.status != TutorStatus.APPROVED:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Öne çıkarma yalnız onaylanmış ilanlar için satın alınabilir.",
        )

    acik = await acik_kayitlar(db, tutor.id)
    if len(acik) >= MAX_OPEN_PER_TUTOR:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Sırada bekleyen bir öne çıkarmanız var. Süresi dolduğunda yeni "
            "paket satın alabilirsiniz.",
        )

    promo = TutorPromotion(
        tutor_id=tutor.id,
        package_days=package.days,
        price=package.price,
        payment_status=PromotionPaymentStatus.PENDING.value,
        terms_accepted_at=_now(),
    )
    db.add(promo)
    await db.flush()

    provider = payments.get_payment_provider()
    result = await provider.charge(
        amount=Decimal(str(promo.price)),
        currency=promo.currency,
        booking_id=promo.id,
        description=f"Ilan One Cikarma {package.days} gun #{promo.id}",
        reference=f"promo:{promo.id}",
        buyer=payments.buyer_from_tutor(tutor, ip=client_ip),
    )

    if result.redirect_url:
        promo.provider = provider.name
        promo.provider_ref = result.provider_ref
        await db.commit()
        await db.refresh(promo)
        return promo, result.redirect_url

    if not result.success:
        promo.payment_status = PromotionPaymentStatus.FAILED.value
        promo.provider = provider.name
        await db.commit()
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED, result.error or "Ödeme başarısız"
        )

    await _yururluge_al(db, promo, provider_name=provider.name,
                        provider_ref=result.provider_ref)
    await db.commit()
    await db.refresh(promo)
    return promo, None


async def _pencere_hesapla(
    db: AsyncSession, promo: TutorPromotion
) -> tuple[datetime.datetime, datetime.datetime]:
    """Yürürlük penceresi: aktif kayıt varsa ONUN BİTİŞİNDEN devam eder.

    Kuyruk kararı burada: eğitmen 7 günlüğün 3. gününde 30 günlük alırsa
    süreler ÜST ÜSTE BİNMEZ, arka arkaya eklenir. Aksi hâlde satın alınan
    sürenin bir kısmı hiç kullanılmadan yanardı.
    """
    now = _now()
    son_bitis = await db.scalar(
        select(func.max(TutorPromotion.ends_at)).where(
            TutorPromotion.tutor_id == promo.tutor_id,
            TutorPromotion.id != promo.id,
            acik_kosul(),
        )
    )
    starts = son_bitis if son_bitis is not None and son_bitis > now else now
    return starts, starts + datetime.timedelta(days=promo.package_days)


async def _yururluge_al(
    db: AsyncSession,
    promo: TutorPromotion,
    *,
    provider_name: str | None,
    provider_ref: str | None,
) -> bool:
    """PENDING/FAILED → PAID atomik geçişi + pencere damgası.

    Geçiş `escrow.claim` ile yapılır: çift callback ikinci kez süre EKLEYEMEZ
    (WHERE koşulu güncel satıra göre yeniden değerlendirilir, tek kazanan).
    """
    starts_at, ends_at = await _pencere_hesapla(db, promo)
    return await escrow.claim(
        db,
        TutorPromotion,
        promo.id,
        status_attr=escrow.PROMOTION_SPEC.status_attr,
        from_statuses=[
            PromotionPaymentStatus.PENDING.value,
            PromotionPaymentStatus.FAILED.value,
        ],
        # İptal edilmiş kayıt yürürlüğe ALINAMAZ. `complete_checkout` bunu ayrıca
        # kontrol ediyor ama karar UPDATE'in WHERE'inde de durmalı: iptal ile
        # callback yarışırsa kontrol ile yazma arasındaki pencere kapanır.
        extra_where=(TutorPromotion.cancelled_at.is_(None),),
        values={
            "payment_status": PromotionPaymentStatus.PAID.value,
            **({"provider": provider_name} if provider_name else {}),
            **({"provider_ref": provider_ref} if provider_ref else {}),
            "paid_at": _now(),
            "starts_at": starts_at,
            "ends_at": ends_at,
        },
    )


async def complete_checkout(
    db: AsyncSession,
    *,
    promotion_id: int,
    success: bool,
    provider_ref: str | None,
    token: str | None = None,
    paid_price: Decimal | None = None,
) -> None:
    """iyzico callback'i doğrulandıktan sonra paketi yürürlüğe alır.

    Idempotent. Token ya da tahsil edilen tutar uyuşmazsa kesinleştirilmez ve
    tahsilat aynen iade edilir (C3 sözleşmesi).
    """
    if success:
        await payment_gates.warn_if_closed_completion(
            db, _BRANCH, reference=f"promo:{promotion_id}"
        )
    promo = await db.get(TutorPromotion, promotion_id)
    if promo is None or not success:
        return
    if promo.payment_status in (
        PromotionPaymentStatus.PAID.value,
        PromotionPaymentStatus.REFUNDING.value,
        PromotionPaymentStatus.REFUNDED.value,
    ):
        return  # idempotent

    if token and promo.provider_ref and token != promo.provider_ref:
        await escrow.refund_unexpected_charge(
            provider_ref=provider_ref,
            amount=paid_price if paid_price is not None else Decimal(str(promo.price)),
            context=f"token uyuşmazlığı promo={promotion_id}",
        )
        return
    if paid_price is not None and paid_price != Decimal(str(promo.price)):
        await escrow.refund_unexpected_charge(
            provider_ref=provider_ref,
            amount=paid_price,
            context=(
                f"paidPrice uyuşmazlığı promo={promotion_id} "
                f"(beklenen {promo.price}, tahsil {paid_price})"
            ),
        )
        return

    tutor = await db.get(Tutor, promo.tutor_id)
    olu = (
        promo.cancelled_at is not None
        or tutor is None
        or tutor.deleted_at is not None
    )
    if olu:
        # İptal edilmiş kayda ya da silinmiş eğitmene tahsilat geldi: para kara
        # delikte kalmasın (C2b). Kayıt PENDING'ken iade akışına claim edilir.
        outcome = await escrow.refund_escrow(
            db,
            promo,
            escrow.PROMOTION_SPEC,
            from_statuses=[PromotionPaymentStatus.PENDING.value],
            provider_ref=provider_ref,
        )
        logger.error(
            "iyzico callback: iptal edilmiş/ölü öne çıkarmaya tahsilat geldi; "
            "iade akışı=%s (promo=%s)",
            outcome,
            promotion_id,
        )
        return

    if await _yururluge_al(
        db, promo, provider_name=None, provider_ref=provider_ref
    ):
        await db.refresh(promo)


# ── Admin görünümü ───────────────────────────────────────────────────────────


async def to_admin_out(db: AsyncSession, promo: TutorPromotion) -> dict:
    tutor = await db.get(Tutor, promo.tutor_id)
    return {
        "id": promo.id,
        "tutor_id": promo.tutor_id,
        "tutor_name": tutor.full_name if tutor else None,
        "package_days": promo.package_days,
        "price": promo.price,
        "currency": promo.currency,
        "payment_status": promo.payment_status,
        "provider": promo.provider,
        "provider_ref": promo.provider_ref,
        "paid_at": promo.paid_at,
        "refunded_amount": promo.refunded_amount,
        "starts_at": promo.starts_at,
        "ends_at": promo.ends_at,
        "cancelled_at": promo.cancelled_at,
        "created_at": promo.created_at,
    }


async def list_for_admin(
    db: AsyncSession,
    *,
    status_filter: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    """Satışlar + eğitmen adı. `status_filter="active"` yalnız yürürlüktekiler."""
    stmt = (
        select(TutorPromotion, Tutor.first_name, Tutor.last_name)
        .join(Tutor, Tutor.id == TutorPromotion.tutor_id)
        .order_by(TutorPromotion.id.desc())
        .limit(limit)
        .offset(offset)
    )
    if status_filter == "active":
        stmt = stmt.where(aktif_kosul())
    elif status_filter:
        stmt = stmt.where(TutorPromotion.payment_status == status_filter.upper())

    rows = (await db.execute(stmt)).all()
    out: list[dict] = []
    for promo, first, last in rows:
        out.append(
            {
                "id": promo.id,
                "tutor_id": promo.tutor_id,
                "tutor_name": " ".join(p for p in (first, last) if p) or None,
                "package_days": promo.package_days,
                "price": promo.price,
                "currency": promo.currency,
                "payment_status": promo.payment_status,
                "provider": promo.provider,
                "provider_ref": promo.provider_ref,
                "paid_at": promo.paid_at,
                "refunded_amount": promo.refunded_amount,
                "starts_at": promo.starts_at,
                "ends_at": promo.ends_at,
                "cancelled_at": promo.cancelled_at,
                "created_at": promo.created_at,
            }
        )
    return out


# ── Admin iptali ─────────────────────────────────────────────────────────────


async def cancel_by_admin(
    db: AsyncSession, promotion_id: int, *, reason: str | None = None
) -> TutorPromotion:
    """Yürürlükteki paketi anında durdurur ve iade sürecini başlatır.

    `cancelled_at` damgası iade sağlayıcıdan dönmeden ÖNCE yazılır: eğitmenin
    parası iade sürecindeyken görünürlüğü sürmemelidir.
    """
    promo = await db.get(TutorPromotion, promotion_id)
    if promo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kayıt bulunamadı.")
    if promo.cancelled_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu kayıt zaten iptal edilmiş.")
    if promo.payment_status not in (
        PromotionPaymentStatus.PAID.value,
        PromotionPaymentStatus.PENDING.value,
        PromotionPaymentStatus.FAILED.value,
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Bu kaydın para durumu iptale uygun değil."
        )

    odenmis = promo.payment_status == PromotionPaymentStatus.PAID.value
    promo.cancelled_at = _now()
    await db.commit()

    if odenmis:
        await escrow.refund_escrow(
            db,
            promo,
            escrow.PROMOTION_SPEC,
            from_statuses=[PromotionPaymentStatus.PAID.value],
            provider_ref=promo.provider_ref,
        )
        await notification_service.notify(
            db,
            user_id=promo.tutor_id,
            role_id=ROLE_IDS[RoleType.TUTOR],
            message=(
                "İlan öne çıkarma paketiniz iptal edildi ve ücreti iade ediliyor."
                + (f" Gerekçe: {reason}" if reason else "")
            ),
            link="/ilanimi-one-cikar",
        )
        await db.commit()

    await db.refresh(promo)
    return promo


# ── Bitiş bildirimi (yalnız bildirim; görünürlük yükleme bağlı) ──────────────


async def notify_expired(db: AsyncSession, *, limit: int = 100) -> int:
    """Süresi dolmuş paketler için bir kez "süreniz doldu" bildirimi gönderir.

    Bu iş **görünürlüğü etkilemez**: paket zaten `aktif_kosul()` dışına düşmüş
    durumdadır. İş hiç çalışmasa da hiçbir ilan bedava öne çıkmaz — yalnız
    eğitmen bilgilendirilmemiş olur.
    """
    rows = await db.execute(
        select(TutorPromotion)
        .where(
            TutorPromotion.payment_status == PromotionPaymentStatus.PAID.value,
            TutorPromotion.cancelled_at.is_(None),
            TutorPromotion.expiry_notified_at.is_(None),
            TutorPromotion.ends_at.isnot(None),
            TutorPromotion.ends_at <= func.now(),
        )
        .limit(limit)
    )
    promos = list(rows.scalars().all())
    for promo in promos:
        # Kuyrukta bir sonraki paket varsa "süreniz doldu" demek yanlış olur.
        devam = await db.scalar(
            select(func.count())
            .select_from(TutorPromotion)
            .where(
                TutorPromotion.tutor_id == promo.tutor_id,
                TutorPromotion.id != promo.id,
                acik_kosul(),
            )
        )
        promo.expiry_notified_at = _now()
        if devam:
            continue
        await notification_service.notify(
            db,
            user_id=promo.tutor_id,
            role_id=ROLE_IDS[RoleType.TUTOR],
            message=(
                "İlan öne çıkarma süreniz doldu. Yeniden öne çıkarmak için "
                "panelinizden paket satın alabilirsiniz."
            ),
            link="/ilanimi-one-cikar",
        )
    if promos:
        await db.commit()
    return len(promos)


__all__ = [
    "aktif_kosul",
    "list_for_tutor",
    "list_for_admin",
    "to_admin_out",
    "acik_kosul",
    "acik_kayitlar",
    "list_packages",
    "purchase",
    "complete_checkout",
    "cancel_by_admin",
    "notify_expired",
]
