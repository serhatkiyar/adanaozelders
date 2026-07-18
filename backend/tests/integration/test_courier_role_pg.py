"""KURYE rolü (5) — hesap yaşam döngüsü + IDOR — GERÇEK Postgres.

1) Hesap kapatma auth_version'ı artırır + TÜM refresh'leri revoke eder.
2) Kurye yalnız KENDİ turuna erişir; yabancı tur/durak 404 (varlık sızmaz).
3) Admin her tura erişir; profil başına ikinci aktif hesap 409.
"""
from __future__ import annotations

import datetime
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text

from core.database import AsyncSessionLocal
from models.admin import Admin
from models.courier import Courier
from models.courier_account import CourierAccount
from models.delivery import DeliveryRun
from models.refresh_token import RefreshToken
from models.role import ROLE_IDS, RoleType
from schemas.delivery import CourierAccountCreate
from services import courier_account_service as cas
from services import refresh_token_service


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


class CourierFactory:
    def __init__(self) -> None:
        self.courier_ids: list[int] = []
        self.account_ids: list[int] = []
        self.run_ids: list[int] = []
        self.admin_id: int | None = None

    async def admin(self, s) -> Admin:
        a = (
            await s.execute(select(Admin).where(Admin.deleted_at.is_(None)).limit(1))
        ).scalars().first()
        assert a is not None, "seed admin yok"
        self.admin_id = a.id
        return a

    async def courier_with_account(self) -> tuple[int, int]:
        """(courier_id, account_id)"""
        async with AsyncSessionLocal() as s:
            u = _uniq()
            c = Courier(name=f"Kurye {u}", is_active=True)
            s.add(c)
            await s.flush()
            cid = c.id
            self.courier_ids.append(cid)
            admin = await self.admin(s)
            out = await cas.create_account(
                s,
                cid,
                CourierAccountCreate(
                    email=f"k-{u}@kurye.test",
                    password="gizli-sifre-123",
                    first_name="Kurye",
                    last_name="Testi",
                ),
                actor=admin,
            )
            self.account_ids.append(out.id)
        return cid, out.id

    async def run_for(self, courier_id: int | None, status: str = "ACTIVE") -> int:
        async with AsyncSessionLocal() as s:
            r = DeliveryRun(
                run_date=datetime.date.today(), status=status, courier_id=courier_id
            )
            s.add(r)
            await s.flush()
            rid = r.id
            self.run_ids.append(rid)
            await s.commit()
        return rid

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("DELETE FROM refresh_tokens WHERE role_id = 5 AND user_id = ANY(:a)"),
                {"a": self.account_ids or [0]},
            )
            await s.execute(
                text(
                    "DELETE FROM audit_logs WHERE target_type = 'courier_account' "
                    "AND target_id = ANY(:a)"
                ),
                {"a": self.account_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM delivery_runs WHERE id = ANY(:r)"),
                {"r": self.run_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM courier_accounts WHERE id = ANY(:a)"),
                {"a": self.account_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM couriers WHERE id = ANY(:c)"),
                {"c": self.courier_ids or [0]},
            )
            await s.commit()


@pytest.fixture
async def cf(pg) -> CourierFactory:
    f = CourierFactory()
    yield f
    await f.cleanup()


@pytest.mark.asyncio
async def test_hesap_kapatma_surum_ve_refresh_keser(cf):
    cid, aid = await cf.courier_with_account()
    async with AsyncSessionLocal() as s:
        raw = await refresh_token_service.issue(
            s, role_id=ROLE_IDS[RoleType.COURIER], user_id=aid
        )
        await s.commit()
        acc = await s.get(CourierAccount, aid)
        v0 = acc.auth_version
        admin = await cf.admin(s)
        await cas.close_account(s, aid, actor=admin)

    async with AsyncSessionLocal() as s:
        acc = await s.get(CourierAccount, aid)
        assert acc.deleted_at is not None and acc.is_active is False
        assert acc.auth_version == v0 + 1  # eski access token'lar anında ölür
        tok = (
            await s.execute(
                select(RefreshToken).where(
                    RefreshToken.role_id == ROLE_IDS[RoleType.COURIER],
                    RefreshToken.user_id == aid,
                )
            )
        ).scalars().first()
        assert tok is not None and tok.revoked_at is not None
        # Rotate de reddeder (revoked).
        assert await refresh_token_service.rotate(s, raw_token=raw) is None


@pytest.mark.asyncio
async def test_idor_yabanci_tur_404_kendi_tur_serbest(cf):
    cid_a, aid_a = await cf.courier_with_account()
    cid_b, _ = await cf.courier_with_account()
    run_a = await cf.run_for(cid_a)
    run_b = await cf.run_for(cid_b)

    async with AsyncSessionLocal() as s:
        acc_a = await s.get(CourierAccount, aid_a)
        # Kendi turu — erişir.
        await cas.ensure_run_access(s, acc_a, run_a)
        # Yabancı tur — 404 (403 değil; varlık bilgisi sızmaz).
        with pytest.raises(HTTPException) as exc:
            await cas.ensure_run_access(s, acc_a, run_b)
        assert exc.value.status_code == 404
        # Admin her tura erişir.
        admin = await cf.admin(s)
        await cas.ensure_run_access(s, admin, run_b)


@pytest.mark.asyncio
async def test_profil_basina_tek_aktif_hesap(cf):
    cid, _ = await cf.courier_with_account()
    async with AsyncSessionLocal() as s:
        admin = await cf.admin(s)
        with pytest.raises(HTTPException) as exc:
            await cas.create_account(
                s,
                cid,
                CourierAccountCreate(
                    email=f"k2-{_uniq()}@kurye.test",
                    password="gizli-sifre-123",
                    first_name="İkinci",
                    last_name="Hesap",
                ),
                actor=admin,
            )
        assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_current_run_secimi(cf):
    cid, aid = await cf.courier_with_account()
    async with AsyncSessionLocal() as s:
        acc = await s.get(CourierAccount, aid)
        assert await cas.current_run_id(s, acc) is None  # atanmamış
    rid = await cf.run_for(cid, status="ACTIVE")
    async with AsyncSessionLocal() as s:
        acc = await s.get(CourierAccount, aid)
        assert await cas.current_run_id(s, acc) == rid
