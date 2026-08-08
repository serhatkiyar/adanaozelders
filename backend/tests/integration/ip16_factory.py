"""İP-16 (aralıklı tekrar / FSRS) test fabrikası.

Kimlikleri (öğrenci/eğitmen/admin) doğrudan modelden kurar; deste/not/kart
kurulumu ise GERÇEK `/srs` uçlarıyla yapılır (`deste`, `not_ekle` yardımcıları)
— davranış testinin ölçtüğü şey uygulamanın kendisidir, elle INSERT edilmiş
bir kart kümesi kart türetim kurallarını (T-1..T-4) atlar.

Zaman kontrolü sözleşmesi: `services/srs_service.py` bütün zaman okumalarını
modül-düzeyi `_now()` üzerinden yapar; testler `monkeypatch.setattr` ile bu
fonksiyonu sabitler (İP-1a'nın "zamanı test kurulumu olarak açıkça ver"
ilkesinin saat-hassasiyetli karşılığı — rollover 04:00 testleri dakika ister).

Temizlik sözleşmesi (kök CLAUDE.md → Test Kalitesi §G): yalnız bu fabrikanın
ürettiği kimliklerin satırları silinir; global TRUNCATE yok. `srs_*` tabloları
kırmızı fazda henüz yokken teardown patlamasın diye `to_regclass` ile korunur.
"""
from __future__ import annotations

import datetime
import uuid
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from core.security import create_access_token
from models.admin import Admin
from models.booking import Booking, BookingStatus
from models.client import Client
from models.tutor import Tutor, TutorStatus
from schemas.admin_access import AdminRoleCreate
from services import admin_access_service


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def auth_header(
    user_id: int, role: str, role_id: int, auth_version: int
) -> dict[str, str]:
    """Gerçek imzalı JWT (`auth_ver` claim'i gerçek satırdan — İP-3 §6)."""
    token = create_access_token(
        subject=user_id, role=role, role_id=role_id, auth_version=auth_version
    )
    return {"Authorization": f"Bearer {token}"}


class Ip16Fabrika:
    """Kimlik kurucu + garantili teardown."""

    def __init__(self) -> None:
        self.client_ids: list[int] = []
        self.tutor_ids: list[int] = []
        self.booking_ids: list[int] = []
        self.admin_ids: list[int] = []
        self.admin_role_ids: list[int] = []

    async def ogrenci(self) -> tuple[int, dict[str, str]]:
        u = _uniq()
        async with AsyncSessionLocal() as s:
            c = Client(
                email=f"c-{u}@ip16.test",
                hashed_password="test-only",
                first_name="Ip16",
                last_name="Ogrenci",
                username=f"ip16c{u}",
                role_id=3,
            )
            s.add(c)
            await s.flush()
            hdr = auth_header(c.id, "CLIENT", 3, c.auth_version)
            cid = c.id
            await s.commit()
        self.client_ids.append(cid)
        return cid, hdr

    async def egitmen(self) -> tuple[int, dict[str, str]]:
        u = _uniq()
        async with AsyncSessionLocal() as s:
            t = Tutor(
                email=f"t-{u}@ip16.test",
                hashed_password="test-only",
                first_name="Ip16",
                last_name="Egitmen",
                username=f"ip16t{u}",
                role_id=2,
                status=TutorStatus.APPROVED,
                hourly_rate=Decimal("500"),
            )
            s.add(t)
            await s.flush()
            hdr = auth_header(t.id, "TUTOR", 2, t.auth_version)
            tid = t.id
            await s.commit()
        self.tutor_ids.append(tid)
        return tid, hdr

    async def ders_bagi(self, tutor_id: int, client_id: int) -> int:
        """Eğitmen↔öğrenci arasında ACCEPTED bir ders — atama kapısının anahtarı.

        Deste atama (D-1) yalnız aralarında iptal-edilmemiş rezervasyon olan
        çifte açıktır (sözleşme §7.1); bu yardımcı o bağı kurar.
        """
        start = _now() + datetime.timedelta(days=7)
        async with AsyncSessionLocal() as s:
            b = Booking(
                tutor_id=tutor_id,
                client_id=client_id,
                status=BookingStatus.ACCEPTED,
                start_at=start,
                end_at=start + datetime.timedelta(hours=1),
                price=Decimal("500.00"),
                mode="ONLINE",
            )
            s.add(b)
            await s.flush()
            bid = b.id
            await s.commit()
        self.booking_ids.append(bid)
        return bid

    async def admin(self, *, izinler: list[str]) -> tuple[int, dict[str, str]]:
        """Gerçek admin + gerçek rol-izin satırları (SUPER_ADMIN bypass'ı yok)."""
        ek = _uniq()
        async with AsyncSessionLocal() as s:
            a = Admin(
                email=f"ip16-{ek}@test.local",
                hashed_password="test-only",
                first_name="Ip16",
                last_name="Yonetici",
                username=f"ip16a{ek}",
                role_id=1,
            )
            s.add(a)
            await s.flush()
            rol = await admin_access_service.create_role(
                s,
                AdminRoleCreate(
                    code=f"IP16_{ek.upper()}",
                    name="Ip16 Denetim",
                    permission_codes=izinler,
                ),
            )
            await admin_access_service.assign_role(
                s, admin_id=a.id, role_id=rol.id, assigned_by_admin_id=a.id
            )
            await s.commit()
            self.admin_ids.append(a.id)
            self.admin_role_ids.append(rol.id)
            return a.id, auth_header(a.id, "ADMIN", 1, a.auth_version)

    # ── Gözlem yardımcıları (hep TAZE session — bayat identity map yok) ──────

    async def sql(self, sorgu: str, **p):
        async with AsyncSessionLocal() as s:
            return (await s.execute(text(sorgu), p)).all()

    async def sql_exec(self, sorgu: str, **p) -> None:
        async with AsyncSessionLocal() as s:
            await s.execute(text(sorgu), p)
            await s.commit()

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            # Kırmızı fazda srs_ tabloları henüz yok — to_regclass nöbeti.
            var = (
                await s.execute(text("SELECT to_regclass('srs_decks')"))
            ).scalar_one()
            if var is not None:
                sahipler = (
                    "((owner_user_id = ANY(:c) AND owner_role_id = 3)"
                    " OR (owner_user_id = ANY(:t) AND owner_role_id = 2)"
                    " OR (owner_user_id = ANY(:a) AND owner_role_id = 1))"
                )
                p = {
                    "c": self.client_ids or [0],
                    "t": self.tutor_ids or [0],
                    "a": self.admin_ids or [0],
                }
                await s.execute(
                    text(
                        "DELETE FROM srs_review_logs WHERE (user_id = ANY(:c) AND"
                        " role_id = 3) OR (user_id = ANY(:t) AND role_id = 2)"
                    ),
                    p,
                )
                await s.execute(
                    text(
                        "DELETE FROM srs_progress WHERE (user_id = ANY(:c) AND"
                        " role_id = 3) OR (user_id = ANY(:t) AND role_id = 2)"
                    ),
                    p,
                )
                await s.execute(
                    text(
                        "DELETE FROM srs_deck_assignments WHERE deck_id IN"
                        f" (SELECT id FROM srs_decks WHERE {sahipler})"
                        " OR client_id = ANY(:c)"
                    ),
                    p,
                )
                for tablo in ("srs_note_tags", ):
                    await s.execute(
                        text(
                            f"DELETE FROM {tablo} WHERE note_id IN (SELECT n.id"
                            " FROM srs_notes n JOIN srs_decks d ON n.deck_id ="
                            f" d.id WHERE {sahipler})"
                        ),
                        p,
                    )
                await s.execute(
                    text(
                        "DELETE FROM srs_cards WHERE deck_id IN"
                        f" (SELECT id FROM srs_decks WHERE {sahipler})"
                    ),
                    p,
                )
                await s.execute(
                    text(
                        "DELETE FROM srs_notes WHERE deck_id IN"
                        f" (SELECT id FROM srs_decks WHERE {sahipler})"
                    ),
                    p,
                )
                await s.execute(
                    text(
                        "DELETE FROM srs_tags WHERE (owner_user_id = ANY(:c) AND"
                        " owner_role_id = 3) OR (owner_user_id = ANY(:t) AND"
                        " owner_role_id = 2)"
                    ),
                    p,
                )
                await s.execute(
                    text(f"DELETE FROM srs_decks WHERE {sahipler}"), p
                )
            await s.execute(
                text("DELETE FROM bookings WHERE id = ANY(:i)"),
                {"i": self.booking_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM tutors WHERE id = ANY(:i)"),
                {"i": self.tutor_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM clients WHERE id = ANY(:i)"),
                {"i": self.client_ids or [0]},
            )
            # Admin zinciri: audit → atama → rol-izin → rol → admin
            # (audit_logs hijyen nöbetçisinde SAYILIR — satır bırakmak yasak).
            if self.admin_ids:
                await s.execute(
                    text("DELETE FROM audit_logs WHERE admin_id = ANY(:i)"),
                    {"i": self.admin_ids},
                )
                await s.execute(
                    text(
                        "DELETE FROM admin_role_assignments WHERE admin_id ="
                        " ANY(:i) OR assigned_by_admin_id = ANY(:i)"
                    ),
                    {"i": self.admin_ids},
                )
                await s.execute(
                    text(
                        "DELETE FROM admin_role_permissions WHERE role_id = ANY(:i)"
                    ),
                    {"i": self.admin_role_ids or [0]},
                )
                await s.execute(
                    text("DELETE FROM admin_roles WHERE id = ANY(:i)"),
                    {"i": self.admin_role_ids or [0]},
                )
                await s.execute(
                    text("DELETE FROM admins WHERE id = ANY(:i)"),
                    {"i": self.admin_ids},
                )
            await s.commit()


# ── HTTP kurulum yardımcıları (gerçek uçlar — sözleşme §8) ───────────────────


async def deste(
    http: httpx.AsyncClient, hdr: dict[str, str], *, name: str | None = None, **kw
) -> dict:
    r = await http.post(
        "/api/v1/srs/decks", headers=hdr, json={"name": name or f"D{_uniq()}", **kw}
    )
    assert r.status_code == 201, f"deste kurulamadı: {r.status_code} {r.text[:200]}"
    return r.json()


async def not_ekle(
    http: httpx.AsyncClient,
    hdr: dict[str, str],
    deck_id: int,
    *,
    note_type: str = "BASIC",
    front: str = "soru",
    back: str = "cevap",
    tags: list[str] | None = None,
) -> dict:
    r = await http.post(
        f"/api/v1/srs/decks/{deck_id}/notes",
        headers=hdr,
        json={
            "note_type": note_type,
            "front": front,
            "back": back,
            "tags": tags or [],
        },
    )
    assert r.status_code == 201, f"not eklenemedi: {r.status_code} {r.text[:200]}"
    return r.json()


async def kartlar(
    http: httpx.AsyncClient, hdr: dict[str, str], deck_id: int, **params
) -> dict:
    r = await http.get(
        "/api/v1/srs/cards",
        headers=hdr,
        params={"deck_id": deck_id, **params},
    )
    assert r.status_code == 200, f"kart listesi: {r.status_code} {r.text[:200]}"
    return r.json()


async def kuyruk(
    http: httpx.AsyncClient, hdr: dict[str, str], deck_id: int
) -> dict:
    r = await http.get(
        "/api/v1/srs/study/queue", headers=hdr, params={"deck_id": deck_id}
    )
    assert r.status_code == 200, f"kuyruk: {r.status_code} {r.text[:200]}"
    return r.json()


async def cevapla(
    http: httpx.AsyncClient,
    hdr: dict[str, str],
    card_id: int,
    rating: int,
    *,
    token: str | None = None,
    beklenen: int = 200,
) -> dict:
    r = await http.post(
        "/api/v1/srs/study/answer",
        headers=hdr,
        json={
            "card_id": card_id,
            "rating": rating,
            "client_token": token or str(uuid.uuid4()),
        },
    )
    assert r.status_code == beklenen, f"cevap: {r.status_code} {r.text[:200]}"
    return r.json() if r.status_code == 200 else {}


# ── Fixture'lar (conftest.py kayda geçirir) ──────────────────────────────────


@pytest.fixture
async def ip16(pg):
    f = Ip16Fabrika()
    try:
        yield f
    finally:
        await f.cleanup()


@pytest.fixture
async def ip16_http():
    """Gerçek FastAPI uygulaması — dependency override YOK (İP-1a deseni)."""
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


@pytest.fixture
def ip16_saat(monkeypatch):
    """`srs_service._now`'ı sabitleyen saat enjektörü.

    Kullanım: `ip16_saat(datetime(..., tz=utc))` — sonraki bütün servis
    çağrıları o anı "şimdi" görür. Servis henüz yokken (kırmızı faz) çağrı
    ImportError ile KIRMIZI düşer; sessiz atlama yok.
    """

    def ayarla(an: datetime.datetime) -> None:
        from services import srs_service

        monkeypatch.setattr(srs_service, "_now", lambda: an)

    return ayarla
