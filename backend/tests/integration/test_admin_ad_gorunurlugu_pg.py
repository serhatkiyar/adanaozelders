"""Admin ad değişikliği kuyruğu ve ödeme geçmişi kişiyi ADIYLA döner.

Önceden iki uç yalnız kimlik numarası taşıyordu; yönetici bir ad değişikliğini
kimin istediğini, bir havalenin kime yapıldığını adıyla göremiyordu.
"""
from __future__ import annotations

import datetime
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text

from api.routers.admin import list_name_change_requests
from core.database import AsyncSessionLocal
from models.library import Library
from models.name_change_request import NameChangeRequest
from models.payout import PayeeType, PayoutRecord
from models.tutor import Tutor, TutorStatus
from services import payout_ledger


@pytest.mark.asyncio
async def test_ad_degisikligi_ve_odeme_gecmisi_adi_tasir(pg):
    u = uuid.uuid4().hex[:10]
    tutor_id = library_id = req_id = 0
    kayit_ids: list[int] = []
    try:
        async with AsyncSessionLocal() as session:
            tutor = Tutor(
                email=f"ad-{u}@admin-ad.test",
                hashed_password="test-only",
                first_name="Mevcut",
                last_name="Egitmen",
                role_id=2,
                status=TutorStatus.APPROVED,
            )
            library = Library(name=f"Ad Kutuphane {u}", slug=f"ad-kutuphane-{u}")
            session.add_all([tutor, library])
            await session.flush()
            tutor_id, library_id = tutor.id, library.id
            req = NameChangeRequest(
                user_id=tutor.id,
                role_id=2,
                kind="NAME",
                new_first_name="Yeni",
                new_last_name="Ad",
                reason="test",
                status="PENDING",
            )
            simdi = datetime.datetime.now(datetime.timezone.utc)
            kayitlar = [
                PayoutRecord(
                    payee_type=PayeeType.TUTOR.value,
                    payee_id=tutor.id,
                    amount=Decimal("10.00"),
                    paid_at=simdi,
                ),
                PayoutRecord(
                    payee_type=PayeeType.LIBRARY.value,
                    payee_id=library.id,
                    amount=Decimal("20.00"),
                    paid_at=simdi,
                ),
            ]
            session.add_all([req, *kayitlar])
            await session.flush()
            req_id = req.id
            kayit_ids = [k.id for k in kayitlar]
            await session.commit()

        async with AsyncSessionLocal() as session:
            talepler = await list_name_change_requests(
                status_filter="PENDING", limit=200, db=session
            )
            bizim = next(t for t in talepler if t.id == req_id)
            assert (bizim.current_first_name, bizim.current_last_name) == (
                "Mevcut",
                "Egitmen",
            )

            kayitlar = [await session.get(PayoutRecord, i) for i in kayit_ids]
            adlar = await payout_ledger.payee_names(session, kayitlar)
            assert adlar[(PayeeType.TUTOR.value, tutor_id)] == "Mevcut Egitmen"
            assert adlar[(PayeeType.LIBRARY.value, library_id)] == f"Ad Kutuphane {u}"
    finally:
        async with AsyncSessionLocal() as session:
            await session.execute(
                text("DELETE FROM payout_records WHERE id = ANY(:ids)"), {"ids": kayit_ids}
            )
            await session.execute(
                text("DELETE FROM name_change_requests WHERE id = :id"), {"id": req_id}
            )
            await session.execute(text("DELETE FROM tutors WHERE id = :id"), {"id": tutor_id})
            await session.execute(
                text("DELETE FROM libraries WHERE id = :id"), {"id": library_id}
            )
            await session.commit()
