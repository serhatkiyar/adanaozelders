"""Yapılandırılmış audit kaydı — GERÇEK Postgres: yeni alanlar yazılır ve
before/after redaction'dan geçer (hassas değer DB'ye ulaşmaz)."""
from __future__ import annotations

import pytest
from sqlalchemy import select, text

from core.database import AsyncSessionLocal
from models.admin import Admin
from models.audit_log import AuditLog
from services import audit_service


@pytest.mark.asyncio
async def test_structured_audit_yazimi_ve_redaction(pg):
    marker = "audit-structured-test"
    async with AsyncSessionLocal() as s:
        admin = (await s.execute(select(Admin).limit(1))).scalars().first()
        assert admin is not None, "seed admin bekleniyor"
        await audit_service.record(
            s,
            actor=admin,
            action="test.structured",
            target_type=marker,
            target_id=42,
            reason="test gerekçesi",
            before={"status": "PENDING", "hashed_password": "GIZLI"},
            after={"status": "APPROVED"},
            meta={"batch": 3, "refresh_token": "GIZLI"},
            ip_address="127.0.0.1",
        )
        await s.commit()

    try:
        async with AsyncSessionLocal() as s:
            row = (
                await s.execute(
                    select(AuditLog).where(AuditLog.target_type == marker)
                )
            ).scalars().first()
            assert row is not None
            assert row.reason == "test gerekçesi"
            assert row.before_values["status"] == "PENDING"
            # Hassas alanlar maskeli — ham değer DB'de YOK.
            assert row.before_values["hashed_password"] == "[gizlendi]"
            assert row.meta["refresh_token"] == "[gizlendi]"
            assert row.meta["batch"] == 3
            assert row.after_values == {"status": "APPROVED"}
            assert row.ip_address == "127.0.0.1"
    finally:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("DELETE FROM audit_logs WHERE target_type = :t"), {"t": marker}
            )
            await s.commit()
