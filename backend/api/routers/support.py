"""Destek / iletişim uçları (public)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_optional_user
from core.config import settings
from core.database import get_db
from core.ratelimit import rate_limit
from services import support_service

router = APIRouter(prefix="/support", tags=["support"])

# Public form → spam ve e-posta maliyeti hedefi. IP bazlı sıkı limit
# (RATE_LIMIT_EMAIL, varsayılan 5/dk) — aynı limiter şifre sıfırlama ve
# doğrulama maillerini de koruyor.
_contact_limit = rate_limit(
    key="contact",
    limit=settings.RATE_LIMIT_EMAIL,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)


class ContactRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    subject: str = Field(min_length=3, max_length=150)
    message: str = Field(min_length=10, max_length=4000)


class ContactResponse(BaseModel):
    detail: str


@router.post(
    "/contact",
    response_model=ContactResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(_contact_limit)],
)
async def submit_contact(
    payload: ContactRequest,
    request: Request,
    user=Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """İletişim formu — oturum gerektirmez.

    Oturumlu kullanıcıdan geliyorsa hesap referansı eklenir (destek tarafı
    kimin yazdığını görsün). Mesaj outbox'a yazılır: SMTP anlık erişilemezse
    kaybolmaz, worker yeniden dener.
    """
    user_ref = None
    if user is not None:
        user_ref = f"{getattr(user, 'email', '?')} (rol {user.role_id})"

    await support_service.submit_contact(
        db,
        name=payload.name,
        email=payload.email,
        subject=payload.subject,
        # Kullanıcı gövdeye telefon/e-posta yazabilir — bu KENDİ iletişim
        # bilgisidir ve destek için gereklidir, maskelenmez. Ancak başkasının
        # bilgisini paylaşma ihtimaline karşı platform maskesi uygulanmaz;
        # mesaj yalnız işletme kutusuna gider, üçüncü tarafa açılmaz.
        message=payload.message,
        user_ref=user_ref,
    )
    await db.commit()
    return ContactResponse(
        detail="Mesajın bize ulaştı. En kısa sürede dönüş yapacağız."
    )
