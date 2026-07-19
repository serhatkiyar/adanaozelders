"""Audit kapsam kablolaması (devir belgesi Öncelik 1 kuyruğu) — GERÇEK Postgres.

Router'lar payload dump'ını (Decimal/date içerebilir) doğrudan record'a verir;
JSONB'ye güvenli yazılmalı. request_id filtresi log korelasyonu için çalışmalı.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import pytest
from sqlalchemy import select, text

from core.database import AsyncSessionLocal
from core.observability import request_id_ctx
from models.admin import Admin
from models.audit_log import AuditLog
from services import audit_service


@pytest.mark.asyncio
async def test_record_pydantic_dump_jsonb_guvenli(pg):
    """Decimal + date içeren after (kupon/ürün payload'ı gibi) hatasız yazılır."""
    marker = "audit-scope-jsonb-test"
    async with AsyncSessionLocal() as s:
        admin = (await s.execute(select(Admin).limit(1))).scalars().first()
        assert admin is not None, "seed admin bekleniyor"
        await audit_service.record(
            s,
            actor=admin,
            action="coupon.update",
            target_type=marker,
            target_id=1,
            after={
                "discount_value": Decimal("25.50"),
                "valid_until": datetime.datetime(2026, 8, 1, 12, 0),
                "is_active": True,
            },
        )
        await s.commit()

    try:
        async with AsyncSessionLocal() as s:
            row = (
                await s.execute(select(AuditLog).where(AuditLog.target_type == marker))
            ).scalars().first()
            assert row is not None
            assert row.after_values["discount_value"] == "25.50"
            assert row.after_values["valid_until"].startswith("2026-08-01T12:00")
            assert row.after_values["is_active"] is True
    finally:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("DELETE FROM audit_logs WHERE target_type = :t"), {"t": marker}
            )
            await s.commit()


@pytest.mark.asyncio
async def test_list_logs_request_id_filtresi(pg):
    """Aktif isteğin request-id'si kayda otomatik düşer; listede kısmi eşleşmeyle bulunur."""
    marker = "audit-scope-rid-test"
    rid = "rid-abc123-test"
    token = request_id_ctx.set(rid)
    try:
        async with AsyncSessionLocal() as s:
            admin = (await s.execute(select(Admin).limit(1))).scalars().first()
            assert admin is not None
            await audit_service.record(
                s, actor=admin, action="delivery_run.cancel", target_type=marker
            )
            await s.commit()
    finally:
        request_id_ctx.reset(token)

    try:
        async with AsyncSessionLocal() as s:
            items, total = await audit_service.list_logs(
                db=s, request_id="abc123", target_type=marker
            )
            assert total == 1
            assert items[0].request_id == rid

            # Eşleşmeyen request-id boş döner (filtre gerçekten daraltıyor).
            _, none_total = await audit_service.list_logs(
                db=s, request_id="olmayan-rid", target_type=marker
            )
            assert none_total == 0
    finally:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("DELETE FROM audit_logs WHERE target_type = :t"), {"t": marker}
            )
            await s.commit()
