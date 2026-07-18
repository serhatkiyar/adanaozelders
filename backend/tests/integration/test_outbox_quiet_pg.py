"""Sessiz saat (PDS §3.8) — outbox ertelemesi — GERÇEK Postgres.

Gece bekleyen müşteri SMS'i GÖNDERİLMEZ; ertesi sabaha ertelenir (deneme
sayılmaz, hata değil). Gündüz aynı olay normal gönderilir.
"""
from __future__ import annotations

import datetime

import pytest
from sqlalchemy import text

from core import outbox
from core.config import settings
from core.database import AsyncSessionLocal
from models.outbox import OutboxEvent, OutboxStatus


def _utc(h: int, mi: int = 0) -> datetime.datetime:
    # Sabit bir tarih; yalnız saat sessiz-saat penceresini belirler.
    return datetime.datetime(2026, 7, 18, h, mi, tzinfo=datetime.timezone.utc)


@pytest.fixture
async def clean_outbox(pg):
    ids: list[int] = []
    yield ids
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("DELETE FROM outbox_events WHERE id = ANY(:ids)"), {"ids": ids or [0]}
        )
        await s.commit()


async def _make_sms_event(when: datetime.datetime) -> int:
    async with AsyncSessionLocal() as s:
        ev = OutboxEvent(
            kind="sms:failed",
            payload={"to": "+905551112233", "order_id": 999999},
            status=OutboxStatus.PENDING.value,
            next_attempt_at=when,
        )
        s.add(ev)
        await s.flush()
        eid = ev.id
        await s.commit()
    return eid


@pytest.mark.asyncio
async def test_gece_sms_ertelenir(clean_outbox, monkeypatch):
    # Yerel 22:00 (UTC 19:00 + APP_UTC_OFFSET 3) → sessiz saat.
    night = _utc(19, 0)
    eid = await _make_sms_event(night - datetime.timedelta(minutes=5))
    clean_outbox.append(eid)
    monkeypatch.setattr(outbox, "_now", lambda: night)

    async with AsyncSessionLocal() as s:
        sent = await outbox.dispatch_pending(s)

    async with AsyncSessionLocal() as s:
        ev = await s.get(OutboxEvent, eid)
    assert ev.status == OutboxStatus.PENDING.value  # gönderilmedi
    assert ev.attempts == 0  # deneme sayılmadı
    # Ertesi sabah 08:30 yerel = UTC 05:30 ertesi gün.
    assert ev.next_attempt_at.replace(tzinfo=datetime.timezone.utc) == _utc(
        19, 0
    ).replace(hour=5, minute=30) + datetime.timedelta(days=1)
    assert sent == 0


@pytest.mark.asyncio
async def test_gunduz_sms_gonderilir(clean_outbox, monkeypatch):
    # Yerel 14:00 (UTC 11:00 + 3) → sessiz değil; fake sağlayıcı gönderir.
    day = _utc(11, 0)
    eid = await _make_sms_event(day - datetime.timedelta(minutes=5))
    clean_outbox.append(eid)
    monkeypatch.setattr(outbox, "_now", lambda: day)

    async with AsyncSessionLocal() as s:
        await outbox.dispatch_pending(s)

    async with AsyncSessionLocal() as s:
        ev = await s.get(OutboxEvent, eid)
    # Console SMS sağlayıcısı başarır → SENT (attempts artmış).
    assert ev.status == OutboxStatus.SENT.value
    assert ev.attempts == 1
