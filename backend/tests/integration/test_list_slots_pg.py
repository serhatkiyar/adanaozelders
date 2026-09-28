"""Slot ızgarasının `has_availability` bayrağı — GERÇEK PostgreSQL.

Şablonu olmayan, yalnız ileriki bir haftada ek aralık açmış eğitmen görünen
haftada "müsaitlik tanımlamamış" sayılmamalı: talep kapısı
(`_assert_within_availability`) böyle eğitmene talebe izin verir, ızgara da
aynı kararı vermeli. Görünen haftanın günleri yine boş kalır.
"""
from __future__ import annotations

import datetime

from sqlalchemy import delete

from core.database import AsyncSessionLocal
from models.tutor import Tutor, TutorAvailability
from models.tutor_extra_availability import TutorExtraAvailability
from services import booking_service
from tests.integration.ip1a_factory import pencere_ici_an


async def _slotlar(tutor_id: int) -> dict:
    now = booking_service._utcnow()
    bugun = now.astimezone(booking_service._yerel_tz()).date()
    async with AsyncSessionLocal() as s:
        tutor = await s.get(Tutor, tutor_id)
        return await booking_service.list_slots(
            s, tutor, day_from=bugun, days=7, duration_min=60, now=now
        )


async def test_yalniz_ileri_haftada_ek_araligi_olan_egitmen_musait_sayilir(ip1a):
    ders = await ip1a.ders()  # eğitmen + öğrenci; ders +30 gün, ızgaraya girmez
    async with AsyncSessionLocal() as s:
        await s.execute(
            delete(TutorAvailability).where(TutorAvailability.tutor_id == ders.tutor_id)
        )
        await s.commit()

    sonuc = await _slotlar(ders.tutor_id)
    assert sonuc["has_availability"] is False

    ek_bas = pencere_ici_an(10)  # 1. haftanın dışında, talep penceresinin içinde
    async with AsyncSessionLocal() as s:
        s.add(
            TutorExtraAvailability(
                tutor_id=ders.tutor_id,
                start_at=ek_bas,
                end_at=ek_bas + datetime.timedelta(hours=3),
            )
        )
        await s.commit()

    sonuc = await _slotlar(ders.tutor_id)
    assert sonuc["has_availability"] is True
    assert all(not gun["slots"] for gun in sonuc["days"])
