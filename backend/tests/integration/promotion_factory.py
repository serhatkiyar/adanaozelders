"""İlan öne çıkarma testleri için gerçek eğitmen + promosyon fabrikası.

Neden gerçek Postgres: yürürlük kararı bir SQL yüklemidir ve `func.now()` ile
**DB saatine** bakar (`services/tutor_promotion_service.aktif_kosul`). SQLite ya
da sahte oturum bu kararı hiç ölçemez — testin ölçtüğü şey tam olarak budur.
"""
from __future__ import annotations

import datetime
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.tutor import Tutor, TutorStatus
from models.tutor_promotion import PromotionPaymentStatus, TutorPromotion


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


class PromotionFabrika:
    def __init__(self) -> None:
        self.tutor_ids: list[int] = []
        self.promotion_ids: list[int] = []

    async def tutor(
        self,
        *,
        status: TutorStatus = TutorStatus.APPROVED,
        headline: str = "Matematik ozel ders veriyorum lise ve universite",
        district: str = "Seyhan",
        subjects: tuple[str, ...] = ("Matematik",),
        hourly_rate: Decimal = Decimal("300.00"),
    ) -> int:
        async with AsyncSessionLocal() as s:
            u = _uniq()
            tutor = Tutor(
                email=f"t-{u}@promo.test",
                hashed_password="x",
                first_name="Promo",
                last_name="Egitmen",
                username=f"p{u}",
                role_id=2,
                status=status,
                headline=headline,
                district=district,
                hourly_rate=hourly_rate,
                teaching_mode="BOTH",
            )
            s.add(tutor)
            await s.flush()
            for subject in subjects:
                await s.execute(
                    text(
                        "INSERT INTO tutor_subjects (tutor_id, subject)"
                        " VALUES (:t, :s) ON CONFLICT DO NOTHING"
                    ),
                    {"t": tutor.id, "s": subject},
                )
            tutor_id = tutor.id
            await s.commit()
        self.tutor_ids.append(tutor_id)
        return tutor_id

    async def promotion(
        self,
        tutor_id: int,
        *,
        payment_status: str = PromotionPaymentStatus.PAID.value,
        days: int = 7,
        starts_at: datetime.datetime | None = None,
        ends_at: datetime.datetime | None = None,
        cancelled_at: datetime.datetime | None = None,
        provider_ref: str | None = "cf-token",
        price: Decimal = Decimal("149.00"),
    ) -> int:
        """Pencere verilmezse "şu an yürürlükte" bir kayıt üretir."""
        now = _now()
        if payment_status == PromotionPaymentStatus.PAID.value:
            starts_at = starts_at or now - datetime.timedelta(hours=1)
            ends_at = ends_at or starts_at + datetime.timedelta(days=days)
        async with AsyncSessionLocal() as s:
            promo = TutorPromotion(
                tutor_id=tutor_id,
                package_days=days,
                price=price,
                payment_status=payment_status,
                provider="fake",
                provider_ref=provider_ref,
                paid_at=(
                    now
                    if payment_status == PromotionPaymentStatus.PAID.value
                    else None
                ),
                starts_at=starts_at,
                ends_at=ends_at,
                cancelled_at=cancelled_at,
                terms_accepted_at=now,
            )
            s.add(promo)
            await s.flush()
            promo_id = promo.id
            await s.commit()
        self.promotion_ids.append(promo_id)
        return promo_id

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("DELETE FROM notifications WHERE role_id = 2 AND user_id = ANY(:t)"),
                {"t": self.tutor_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM tutor_promotions WHERE tutor_id = ANY(:t)"),
                {"t": self.tutor_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM tutor_subjects WHERE tutor_id = ANY(:t)"),
                {"t": self.tutor_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM tutors WHERE id = ANY(:t)"),
                {"t": self.tutor_ids or [0]},
            )
            await s.commit()


@pytest.fixture
async def promo_fab(pg):
    f = PromotionFabrika()
    try:
        yield f
    finally:
        await f.cleanup()


@pytest.fixture
async def promo_kol_acik(monkeypatch):
    """Ödeme kolunu test süresince açar (varsayılanı KAPALI)."""
    from core import flags

    gercek = flags.is_enabled

    async def sahte(db, key):
        if key == flags.FLAG_TUTOR_PROMOTION_PAYMENTS_LIVE:
            return True
        return await gercek(db, key)

    monkeypatch.setattr(flags, "is_enabled", sahte)
    yield
