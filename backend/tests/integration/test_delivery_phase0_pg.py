"""Faz 0 backend eklemeleri — GERÇEK Postgres.

1) **Kurye sil/pasifleştir → hesap kapatma zinciri.** `close_for_courier_profile`
   yazılmış ama hiç çağrılmıyordu: profil silinince/pasifleşince rol-5 giriş
   hesabı AÇIK kalıyor, işten ayrılan kuryenin telefonundaki oturum yaşamaya
   devam ediyordu. Artık `delete_courier` ve `update_courier(is_active=False)`
   aynı transaction'da hesabı kapatır (soft-delete + auth_version + refresh revoke).

2) **Saha audit.** verify/fail/deliver-drop/complete artık audit yazar — "kurye
   kim ne yaptı" sorusunun yapısal izi. Burada actor'lü `record` çağrısının
   CourierAccount ile çalıştığı (actor_role=5) doğrulanır.

3) **Tur arşivi sayfalaması.** `list_runs(offset=)` — sayfalar kesişmez,
   birleşimi tam listeyi verir.
"""
from __future__ import annotations

import datetime
import uuid

import pytest
from sqlalchemy import select, text

from core.database import AsyncSessionLocal
from models.admin import Admin
from models.courier import Courier
from models.courier_account import CourierAccount
from models.delivery import DeliveryRun
from models.refresh_token import RefreshToken
from models.role import ROLE_IDS, RoleType
from schemas.delivery import CourierAccountCreate, CourierUpdate
from services import audit_service
from services import courier_account_service as cas
from services import delivery_service, refresh_token_service
from tests.integration.filo_yardim import arac_id

pytestmark = pytest.mark.asyncio


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


class Phase0Factory:
    def __init__(self) -> None:
        self.courier_ids: list[int] = []
        self.account_ids: list[int] = []
        self.run_ids: list[int] = []

    async def admin(self, s) -> Admin:
        a = (
            await s.execute(select(Admin).where(Admin.deleted_at.is_(None)).limit(1))
        ).scalars().first()
        assert a is not None, "seed admin yok"
        return a

    async def courier_with_account(self) -> tuple[int, int]:
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
                    email=f"k-{u}@faz0.test", password="gizli-sifre-123",
                    first_name="Kurye", last_name="Faz0",
                ),
                actor=admin,
            )
            self.account_ids.append(out.id)
        return cid, out.id

    async def runs(self, n: int) -> list[int]:
        ids: list[int] = []
        async with AsyncSessionLocal() as s:
            for i in range(n):
                r = DeliveryRun(
                    # Geçmiş tarih: gün+araç başına tek PLANNED index'iyle ve
                    # gerçek verilerle çakışmasın diye her tur ayrı güne.
                    run_date=datetime.date(2031, 1, 1) + datetime.timedelta(days=i),
                    vehicle_id=await arac_id(),
                    status="DONE",
                )
                s.add(r)
                await s.flush()
                ids.append(r.id)
                self.run_ids.append(r.id)
            await s.commit()
        return ids

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            p = {
                "a": self.account_ids or [0],
                "c": self.courier_ids or [0],
                "r": self.run_ids or [0],
            }
            for q in (
                "DELETE FROM refresh_tokens WHERE role_id = 5 AND user_id = ANY(:a)",
                "DELETE FROM audit_logs WHERE target_type = 'courier_account' AND target_id = ANY(:a)",
                "DELETE FROM audit_logs WHERE target_type = 'courier' AND target_id = ANY(:c)",
                "DELETE FROM audit_logs WHERE target_type = 'delivery_run' AND target_id = ANY(:r)",
                "DELETE FROM delivery_runs WHERE id = ANY(:r)",
                "DELETE FROM courier_accounts WHERE id = ANY(:a)",
                "DELETE FROM couriers WHERE id = ANY(:c)",
            ):
                await s.execute(text(q), p)
            await s.commit()


@pytest.fixture
async def pf(pg) -> Phase0Factory:
    f = Phase0Factory()
    yield f
    await f.cleanup()


async def _account_state(aid: int) -> tuple[bool, bool, int, int]:
    """(is_active, deleted, auth_version, aktif refresh sayısı)"""
    async with AsyncSessionLocal() as s:
        acc = await s.get(CourierAccount, aid)
        active_tokens = (
            await s.execute(
                select(RefreshToken).where(
                    RefreshToken.role_id == ROLE_IDS[RoleType.COURIER],
                    RefreshToken.user_id == aid,
                    RefreshToken.revoked_at.is_(None),
                )
            )
        ).scalars().all()
        return (
            acc.is_active,
            acc.deleted_at is not None,
            acc.auth_version,
            len(active_tokens),
        )


async def test_kurye_silinince_giris_hesabi_da_kapanir(pf):
    """delete_courier → hesap soft-delete + auth_version artışı + refresh revoke.
    Zincir olmadan işten çıkarılan kuryenin oturumu yaşamaya devam ediyordu."""
    cid, aid = await pf.courier_with_account()
    async with AsyncSessionLocal() as s:
        await refresh_token_service.issue(
            s, role_id=ROLE_IDS[RoleType.COURIER], user_id=aid
        )
        await s.commit()
    _, _, v0, tokens0 = await _account_state(aid)
    assert tokens0 == 1

    async with AsyncSessionLocal() as s:
        admin = await pf.admin(s)
        await delivery_service.delete_courier(s, cid, actor=admin)

    is_active, deleted, v1, tokens1 = await _account_state(aid)
    assert deleted and is_active is False
    assert v1 == v0 + 1, "auth_version artmalı — access token anında ölür"
    assert tokens1 == 0, "tüm refresh token'lar revoke edilmeli"

    # Zincirin audit izi de düşmeli (actor verildi).
    async with AsyncSessionLocal() as s:
        n = (
            await s.execute(
                text(
                    "SELECT count(*) FROM audit_logs WHERE action = 'courier_account_close' "
                    "AND target_id = :a"
                ),
                {"a": aid},
            )
        ).scalar()
    assert n == 1


async def test_kurye_pasiflestirilince_hesap_kapanir(pf):
    """update_courier(is_active=False) aynı zinciri tetikler; is_active=True
    kalan güncellemeler hesabı ELLEMEZ."""
    cid, aid = await pf.courier_with_account()

    # Zararsız güncelleme: hesap açık kalmalı.
    async with AsyncSessionLocal() as s:
        await delivery_service.update_courier(
            s, cid, CourierUpdate(phone="+905550001122")
        )
    is_active, deleted, _, _ = await _account_state(aid)
    assert is_active and not deleted

    # Pasifleştirme: hesap kapanmalı.
    async with AsyncSessionLocal() as s:
        admin = await pf.admin(s)
        await delivery_service.update_courier(
            s, cid, CourierUpdate(is_active=False), actor=admin
        )
    is_active, deleted, _, _ = await _account_state(aid)
    assert deleted and is_active is False


async def test_saha_audit_kaydi_kurye_aktoruyle_yazilir(pf):
    """audit_service.record CourierAccount actor'üyle çalışmalı (actor_role=5):
    saha uçlarındaki verify/fail/drop/complete audit'leri buna dayanır."""
    cid, aid = await pf.courier_with_account()
    run_ids = await pf.runs(1)
    async with AsyncSessionLocal() as s:
        acc = await s.get(CourierAccount, aid)
        await audit_service.record(
            s, actor=acc, action="delivery_run.complete",
            target_type="delivery_run", target_id=run_ids[0],
            after={"status": "DONE"},
        )
        await s.commit()
        row = (
            await s.execute(
                text(
                    "SELECT actor_id, actor_role FROM audit_logs "
                    "WHERE action = 'delivery_run.complete' AND target_id = :r"
                ),
                {"r": run_ids[0]},
            )
        ).first()
    assert row is not None
    assert row.actor_id == aid
    assert row.actor_role == ROLE_IDS[RoleType.COURIER]


async def test_runs_run_date_suzgeci_yalniz_o_gunun_turlarini_dondurur(pf):
    """Tarih süzgeci sözleşmesi: aynı ``run_date`` filtreli listede bulunur,
    farklı tarihte bulunmaz. (Turlar ekranı `?tarih=` → `run_date=` gönderir.)"""
    ids = await pf.runs(3)  # her tur ayrı güne: 2031-01-01, 01-02, 01-03
    hedef = ids[1]
    async with AsyncSessionLocal() as s:
        gun = datetime.date(2031, 1, 2)
        ayni = await delivery_service.list_runs(s, run_date=gun, limit=50)
        assert hedef in {r.id for r in ayni}
        assert all(r.run_date == gun for r in ayni)
        farkli = await delivery_service.list_runs(
            s, run_date=datetime.date(2031, 1, 3), limit=50
        )
        assert hedef not in {r.id for r in farkli}
        assert ids[2] in {r.id for r in farkli}
        assert await delivery_service.list_runs(
            s, run_date=datetime.date(2031, 6, 15), limit=50
        ) == []


async def test_runs_offset_sayfalari_kesismez(pf):
    """Arşiv sayfalaması: sayfalar kesişmez, birleşimleri tam listeyi verir,
    offset liste sonunu aşınca boş döner."""
    created = set(await pf.runs(7))

    async with AsyncSessionLocal() as s:
        page1 = await delivery_service.list_runs(s, limit=3, offset=0)
        page2 = await delivery_service.list_runs(s, limit=3, offset=3)
        ids1 = {r.id for r in page1}
        ids2 = {r.id for r in page2}
        assert not (ids1 & ids2), "sayfalar kesişmemeli"

        # Bizim turlarımızın tamamı sayfalar birleşince görünmeli (başka
        # verilerle karışmamak için yalnız kendi id'lerimizi sayıyoruz).
        seen: set[int] = set()
        offset = 0
        while True:
            page = await delivery_service.list_runs(s, limit=3, offset=offset)
            if not page:
                break
            seen.update(r.id for r in page)
            offset += 3
            assert offset < 500, "sonsuz döngü koruması"
        assert created <= seen

        # Uç nokta: devasa offset boş liste döner (hata değil).
        assert await delivery_service.list_runs(s, limit=3, offset=10_000) == []
