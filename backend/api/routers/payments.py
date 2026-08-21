from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import (
    CurrentUser,
    get_current_active_user,
    require_admin_permission,
    require_roles,
    user_rate_limit,
)
from core import payments
from core.config import settings
from core.ratelimit import rate_limit
from core.database import get_db
from core.payments.iyzico import IyzicoProvider, parse_reference
from models.booking import Booking
from models.client import Client
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from schemas.payment import (
    EarningsSummary,
    EarningTransaction,
    PaymentOut,
    PlatformSummary,
)
from schemas.feature_flag import PaymentAvailabilityOut
from services import (
    library_exam_service,
    order_service,
    payment_gates,
    payment_service,
    phone_service,
    study_reservation_service,
)

logger = logging.getLogger("adana.payments")

router = APIRouter(prefix="/payments", tags=["payments"])

# Callback sonrası kullanıcının döndürüleceği frontend sayfaları (lib/routes.ts).
_BOOKINGS_PAGE = "/ders-talepleri"
_TICKETS_PAGE = "/biletlerim"
_ORDERS_PAGE = "/siparislerim"

_pay_limit = user_rate_limit(
    key="payment_pay",
    limit=settings.RATE_LIMIT_PAYMENT,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)


async def _booking_or_404(db: AsyncSession, booking_id: int) -> Booking:
    booking = await db.get(Booking, booking_id)
    if booking is None or booking.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    return booking


async def _assert_party(db: AsyncSession, booking: Booking, user: CurrentUser) -> None:
    if user.role_id == ROLE_IDS[RoleType.CLIENT] and booking.client_id == user.id:
        return
    if user.role_id == ROLE_IDS[RoleType.TUTOR] and booking.tutor_id == user.id:
        return
    if user.role_id == ROLE_IDS[RoleType.ADMIN]:
        from services import admin_access_service

        _role_code, permissions = await admin_access_service.get_admin_access(db, user.id)
        if "bookings.view" in permissions:
            return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your booking")


@router.get(
    "/availability",
    response_model=PaymentAvailabilityOut,
    # Public + kimlik doğrulamasız: DB düşükken her istek başarısız okuma üretir,
    # bu da ucuz bir log-flood / bağlantı havuzu baskısı amplifikatörüdür.
    dependencies=[
        Depends(
            rate_limit(
                key="payment_availability",
                limit=settings.RATE_LIMIT_TRACKING,
                window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
            )
        )
    ],
    # Teşhis alanları public gövdede `null` olarak bile görünmesin: şema
    # admin yüzeyiyle paylaşıldığı için opsiyoneller None kalır ve
    # serileştirilirse sözleşme "bu alanlar var ama boş" der.
    response_model_exclude_none=True,
)
async def payment_availability(db: AsyncSession = Depends(get_db)):
    """Hangi ödeme kolları açık — **public**.

    İstemci bunu ödeme butonlarını göstermek/gizlemek ve "emanet" ifadesini
    kullanıp kullanmamak için okur. Teşhis alanları (hangi altyapının eksik
    olduğu) DÖNMEZ; yalnız `open` ve müşteriye gösterilecek `message`.

    Kimlik doğrulaması yok: bilgi zaten kullanıcıya gösterilecek olan şeydir ve
    anonim ziyaretçinin de ürün sayfasında doğru metni görmesi gerekir.
    """
    return PaymentAvailabilityOut(
        branches=await payment_gates.branches_status(db, include_diagnostics=False),
        # Kolların cevaplamadığı ayrı bir soru: dijital ürün satılabilir mi?
        # Admin ürün formu DIGITAL seçeneğini buna göre kapatır.
        digital_products_open=await payment_gates.digital_products_open(db),
    )


@router.get("/booking/{booking_id}", response_model=PaymentOut | None)
async def get_booking_payment(
    booking_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    booking = await _booking_or_404(db, booking_id)
    await _assert_party(db, booking, user)
    return await payment_service.get_for_booking(db, booking_id)


@router.post(
    "/booking/{booking_id}/pay",
    response_model=PaymentOut,
    dependencies=[Depends(_pay_limit)],
)
async def pay_booking(
    booking_id: int,
    request: Request,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    await payment_gates.assert_branch_open(
        db, payment_gates.PaymentBranch.TUTOR_MARKETPLACE
    )
    phone_service.require_phone_verified(client)
    booking = await _booking_or_404(db, booking_id)
    if booking.client_id != client.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your booking")
    payment, redirect_url = await payment_service.pay(
        db, booking, client_ip=request.client.host if request.client else None
    )
    out = PaymentOut.model_validate(payment)
    out.redirect_url = redirect_url
    return out


def _checkout_redirect(page: str, *, ok: bool) -> RedirectResponse:
    """Kullanıcıyı ödeme sonucuyla frontend'e geri gönderir (303: POST→GET)."""
    base = settings.FRONTEND_BASE_URL.rstrip("/")
    result = "basarili" if ok else "basarisiz"
    return RedirectResponse(f"{base}{page}?odeme={result}", status_code=303)


@router.post("/iyzico/callback", include_in_schema=False)
async def iyzico_callback(request: Request, db: AsyncSession = Depends(get_db)):
    """iyzico Ödeme Formu dönüşü — kullanıcının TARAYICISI form-POST eder (auth YOK).

    Gelen ``token``'a güvenilmez: sonuç ``retrieve_checkout`` ile iyzico'dan sunucu
    tarafında doğrulanır; ``conversationId`` ("booking:12" vb.) hangi varlığın
    kesinleşeceğini söyler. Tamamlama fonksiyonları idempotent olduğundan çift
    POST/yenileme zararsızdır. Kullanıcı her durumda ilgili sayfaya yönlendirilir.
    """
    form = await request.form()
    token = str(form.get("token") or "").strip()
    provider = payments.get_payment_provider()
    if not token or not isinstance(provider, IyzicoProvider):
        return _checkout_redirect(_TICKETS_PAGE, ok=False)

    result = await provider.retrieve_checkout(token=token)
    parsed = parse_reference(result.reference)
    if parsed is None:
        logger.warning("iyzico callback: çözülemeyen referans %r", result.reference)
        return _checkout_redirect(_TICKETS_PAGE, ok=False)

    kind, entity_id = parsed
    if kind == "booking":
        await payment_service.complete_checkout(
            db, booking_id=entity_id, success=result.success,
            provider_ref=result.provider_ref,
            token=token, paid_price=result.paid_price,
        )
        return _checkout_redirect(_BOOKINGS_PAGE, ok=result.success)
    if kind == "order":
        await order_service.complete_checkout(
            db, order_id=entity_id, success=result.success,
            provider_ref=result.provider_ref,
            token=token, paid_price=result.paid_price,
        )
        return _checkout_redirect(_ORDERS_PAGE, ok=result.success)
    if kind == "examreg":
        await library_exam_service.complete_checkout(
            db, registration_id=entity_id, success=result.success,
            provider_ref=result.provider_ref,
            token=token, paid_price=result.paid_price,
        )
    else:  # studyres
        await study_reservation_service.complete_checkout(
            db, reservation_id=entity_id, success=result.success,
            provider_ref=result.provider_ref,
            token=token, paid_price=result.paid_price,
        )
    return _checkout_redirect(_TICKETS_PAGE, ok=result.success)


@router.get("/earnings", response_model=EarningsSummary)
async def my_earnings(
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    data = await payment_service.earnings_summary(db, tutor_id=tutor.id)
    return EarningsSummary(**data)


@router.get("/earnings/transactions", response_model=list[EarningTransaction])
async def my_earnings_transactions(
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    """Eğitmenin ödeme hareketleri dökümü (Bakiye sayfası)."""
    rows = await payment_service.earnings_transactions(db, tutor_id=tutor.id)
    return [EarningTransaction(**r) for r in rows]


@router.get("/admin/summary", response_model=PlatformSummary)
async def admin_platform_summary(
    _admin: CurrentUser = Depends(require_admin_permission("dashboard.view")),
    db: AsyncSession = Depends(get_db),
):
    data = await payment_service.platform_summary(db)
    return PlatformSummary(**data)
