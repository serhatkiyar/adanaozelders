"""Ödeme kolu kapıları — GERÇEK PostgreSQL üzerinde.

Kabul testleri (`tests/acceptance/test_payment_branch_gates.py`) kapının
mantığını DB'siz doğrular. Burada DB'ye bağlı olan üç şey doğrulanır:

1. Bayrak satırı gerçekten okunuyor mu (katalog varsayılanı yalnız satır
   yokken kullanılıyor mu),
2. Admin bayrağı değiştirdiğinde **denetim kaydı** önceki/sonraki değerle
   yazılıyor mu,
3. Kapı **gerçek bir uçta** etkili mi (servis katmanı atlanamıyor mu).

Postgres erişilemezse SKIP (bkz. conftest).
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text

from core import flags
from core.database import AsyncSessionLocal
from models.admin import Admin
from models.audit_log import AuditLog
from models.feature_flag import FeatureFlag
from services import feature_flag_service, payment_gates


@pytest.fixture(autouse=True)
def _temiz_onbellek():
    flags.reset_cache()
    yield
    flags.reset_cache()


async def _cleanup(keys: list[str], admin_ids: list[int]) -> None:
    async with AsyncSessionLocal() as s:
        if keys:
            await s.execute(
                text("DELETE FROM feature_flags WHERE key = ANY(:k)"), {"k": keys}
            )
        if admin_ids:
            await s.execute(
                text("DELETE FROM audit_logs WHERE actor_id = ANY(:a) AND actor_role = 1"),
                {"a": admin_ids},
            )
            await s.execute(
                text("DELETE FROM admins WHERE id = ANY(:a)"), {"a": admin_ids}
            )
        await s.commit()


@pytest.mark.asyncio
async def test_bayrak_satiri_katalog_varsayilanini_ezer(pg):
    """Satır yokken katalog varsayılanı, satır varken DB değeri geçerli."""
    key = flags.FLAG_TUTOR_MARKETPLACE_PAYMENTS_LIVE
    try:
        async with AsyncSessionLocal() as s:
            await s.execute(text("DELETE FROM feature_flags WHERE key = :k"), {"k": key})
            await s.commit()

        flags.reset_cache()
        async with AsyncSessionLocal() as s:
            assert await flags.is_enabled(s, key) is False  # katalog varsayılanı

        async with AsyncSessionLocal() as s:
            s.add(FeatureFlag(key=key, enabled=True))
            await s.commit()

        flags.reset_cache()
        async with AsyncSessionLocal() as s:
            assert await flags.is_enabled(s, key) is True  # DB satırı
    finally:
        await _cleanup([key], [])


@pytest.mark.asyncio
async def test_bayrak_degisikligi_audit_e_onceki_ve_sonraki_degerle_yazilir(pg):
    suffix = uuid.uuid4().hex[:10]
    key = flags.FLAG_LIBRARY_MARKETPLACE_PAYMENTS_LIVE
    admin_id = 0
    try:
        async with AsyncSessionLocal() as s:
            admin = Admin(
                email=f"flag-{suffix}@test.local",
                hashed_password="test-only",
                first_name="Bayrak",
                last_name="Testi",
                username=f"flag{suffix}",
                role_id=1,
            )
            s.add(admin)
            await s.flush()
            admin_id = admin.id

            out, previous = await feature_flag_service.set_flag(
                s, key=key, enabled=True, admin_id=admin_id, note="sandbox denemesi"
            )
            assert out.enabled is True
            assert previous is False  # katalog varsayılanı önceki değer sayılır

            from services import audit_service

            await audit_service.record(
                s,
                actor=admin,
                action="feature_flag.update",
                target_type="feature_flag",
                details=key,
                reason="sandbox denemesi",
                before={"enabled": previous},
                after={"enabled": True},
            )
            await s.commit()

        async with AsyncSessionLocal() as s:
            row = (
                await s.execute(
                    select(AuditLog)
                    .where(AuditLog.actor_id == admin_id)
                    .where(AuditLog.action == "feature_flag.update")
                )
            ).scalars().first()
            assert row is not None
            assert row.details == key
            assert row.before_values == {"enabled": False}
            assert row.after_values == {"enabled": True}
            assert row.reason == "sandbox denemesi"

            # Satır gerçekten yazıldı ve kim değiştirdiği duruyor.
            flag_row = (
                await s.execute(select(FeatureFlag).where(FeatureFlag.key == key))
            ).scalars().first()
            assert flag_row.enabled is True
            assert flag_row.updated_by_admin_id == admin_id
    finally:
        await _cleanup([key], [admin_id] if admin_id else [])


@pytest.mark.asyncio
async def test_elle_havale_ucu_bayrak_kapaliyken_reddeder(pg, monkeypatch):
    """Kapı servis katmanında: `record_payout` bakiye sorgusuna bile gitmeden
    reddedilir (üretim dışı ortamda bayrak kapalıyken)."""
    from core.config import settings

    monkeypatch.setattr(type(settings), "is_production", property(lambda _s: False))
    key = flags.FLAG_MANUAL_PAYOUT_ENABLED
    try:
        async with AsyncSessionLocal() as s:
            await s.execute(text("DELETE FROM feature_flags WHERE key = :k"), {"k": key})
            await s.commit()
        flags.reset_cache()

        async with AsyncSessionLocal() as s:
            with pytest.raises(HTTPException) as exc:
                await payment_gates.assert_manual_payout_open(s)
            assert exc.value.status_code == 403
            assert exc.value.detail["code"] == "MANUAL_PAYOUT_DISABLED"

        # Bayrak açılınca geçer (geliştirme/staging'de defter test edilebilir).
        async with AsyncSessionLocal() as s:
            s.add(FeatureFlag(key=key, enabled=True))
            await s.commit()
        flags.reset_cache()
        async with AsyncSessionLocal() as s:
            await payment_gates.assert_manual_payout_open(s)
    finally:
        await _cleanup([key], [])


@pytest.mark.asyncio
async def test_uretimde_elle_havale_bayrak_acik_olsa_bile_reddedilir(pg, monkeypatch):
    from core.config import settings

    monkeypatch.setattr(type(settings), "is_production", property(lambda _s: True))
    key = flags.FLAG_MANUAL_PAYOUT_ENABLED
    try:
        async with AsyncSessionLocal() as s:
            await s.execute(text("DELETE FROM feature_flags WHERE key = :k"), {"k": key})
            s.add(FeatureFlag(key=key, enabled=True))
            await s.commit()
        flags.reset_cache()

        async with AsyncSessionLocal() as s:
            with pytest.raises(HTTPException) as exc:
                await payment_gates.assert_manual_payout_open(s)
            # Gövde iç bilgi taşımaz (güvenlik denetimi bulgusu): engelleyici
            # adları yalnız loga gider. Sebep, kodla ayırt edilir.
            assert exc.value.status_code == 403
            assert exc.value.detail["code"] == "MANUAL_PAYOUT_DISABLED"
            assert "blockers" not in exc.value.detail
    finally:
        await _cleanup([key], [])


@pytest.mark.asyncio
async def test_durum_raporu_public_modda_teshis_alanlarini_gizler(pg):
    """`/health` ve müşteri ucu iç yapılandırmayı sızdırmamalı."""
    async with AsyncSessionLocal() as s:
        admin_view = await payment_gates.branches_status(s, include_diagnostics=True)
        public_view = await payment_gates.branches_status(s, include_diagnostics=False)

    assert "blockers" in admin_view[0] and "flag_enabled" in admin_view[0]
    assert "blockers" not in public_view[0] and "flag_enabled" not in public_view[0]
    # Müşteriye gösterilecek metin public görünümde de kalır.
    assert set(public_view[0]) == {"branch", "label", "open", "message"}
