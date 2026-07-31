"""Şifreli IBAN gerçekten DB'ye yazılıp okunabiliyor mu? (GERÇEK Postgres)

Bu testin varlık sebebi somut bir hatadır: modeller `EncryptedString(255)`
tanımlarken baseline migration kolonları **VARCHAR(34)** açmıştı. Model
tanımını kontrol eden bir birim testi bunu YAKALAMAZ — model doğruydu, sapma
DB'deydi. Yakalayan tek şey gerçek bir yazma denemesidir.

Migration `2df064134f6c` kolonları genişletti. Bu test o düzeltmenin
nöbetçisidir: kolon bir gün yeniden daraltılırsa (ya da yeni bir şifreli kolon
dar açılırsa) burada patlar, sahada eğitmenin hakediş onboarding'inde değil.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, text

from core.database import AsyncSessionLocal
from models.tutor import Tutor, TutorStatus

_IBAN = "TR330006100519786457841326"


@pytest.mark.asyncio
async def test_sifreli_iban_yazilip_ayni_deger_okunur(pg):
    suffix = uuid.uuid4().hex[:10]
    tutor_id = 0
    try:
        async with AsyncSessionLocal() as s:
            tutor = Tutor(
                email=f"iban-{suffix}@test.local",
                hashed_password="test-only",
                first_name="IBAN",
                last_name="Testi",
                username=f"iban{suffix}",
                role_id=2,
                status=TutorStatus.DRAFT,
                iban=_IBAN,
            )
            s.add(tutor)
            # VARCHAR(34) döneminde bu commit
            # "value too long for type character varying(34)" ile patlıyordu.
            await s.commit()
            tutor_id = tutor.id

        async with AsyncSessionLocal() as s:
            okunan = (
                await s.execute(select(Tutor.iban).where(Tutor.id == tutor_id))
            ).scalar_one()
            assert okunan == _IBAN, "şifre çözme turu düz metni geri vermedi"

            # Ham sütunda düz IBAN DURMAMALI (at-rest şifreleme gerçekten çalışıyor).
            ham = (
                await s.execute(
                    text("SELECT iban FROM tutors WHERE id = :i"), {"i": tutor_id}
                )
            ).scalar_one()
            assert ham != _IBAN
            assert _IBAN not in ham
            assert len(ham) > 34
    finally:
        if tutor_id:
            async with AsyncSessionLocal() as s:
                await s.execute(text("DELETE FROM tutors WHERE id = :i"), {"i": tutor_id})
                await s.commit()
