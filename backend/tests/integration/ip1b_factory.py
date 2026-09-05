"""İP-1b kütüphane kolu test fabrikası — kontenjan, canlılık, bilet kodu, claim.

## Neden ayrı bir fabrika

`conftest.py::MoneyFactory` deneme kaydını **elle INSERT eder** ve tek bir
kayıt üretir; İP-1b'nin sorusu ise çoğuldur:

> "N kişilik bir oturuma eşzamanlı M kişi girdiğinde kaç koltuk satıldı, ve o
> koltukları **üretim kodu** mu dağıttı?"

Bu yüzden kayıtlar mümkün olan her yerde **gerçek servis yolundan**
(`library_exam_service.register`, `study_reservation_service.reserve`) üretilir.
Yalnız iki istisna vardır ve ikisi de bilinçlidir:

1. `ham_kayit()` / `ham_rezervasyon()` — `pay()`'in kontenjan ve claim
   davranışını ölçen testler için ön-durum kurar. Burada sahtelenen bir **para
   durumu yoktur** (satırlar `PENDING_PAYMENT`'tır, hiçbir emanet
   uydurulmamıştır); yalnız "aynı oturumda iki ödeme bekleyen kayıt var"
   ön-koşulu kurulur. Bu durum üretimde de doğar (süresi dolmuş tutmalar,
   sürüm öncesi satırlar), dolayısıyla `pay()` ona karşı doğru davranmak
   zorundadır.
2. `hold_bitir()` — koltuk tutmasını süresiz kılmayan TTL'i geçmişe çeker.

## `hold_bitir` neden sürüm toleranslı

Kırmızı matris **üretim kodundan ÖNCE** commit edilir (CLAUDE.md §D, teslimat
kapıları). O turda `hold_expires_at` kolonu HENÜZ YOKTUR. Yardımcı bu yüzden
kolonun varlığını sorar ve yoksa sessizce hiçbir şey yapmaz: kırmızı turda
senaryo "tutma zaten koltuk tutmuyor" hâliyle koşar ve testin ölçtüğü invariant
(**kontenjan aşılmadı**) yine geçerlidir. Yeşil turda aynı test gerçek TTL
yolunu sürer. Test her iki turda da AYNI şeyi iddia eder; yalnız oraya giden
yol farklıdır.

## Temizlik sözleşmesi

Fabrika YALNIZ kendi ürettiği ID'leri siler. `conftest.py::_KRITIK_TABLOLAR`
hijyen nöbetçisi `libraries`, `clients` ve `refresh_tokens` SAYAR — buradaki
tek bir sızıntı bütün suite'i kırar (bilinçli).
"""
from __future__ import annotations

import asyncio
import datetime
import uuid
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from core.payments.base import ChargeResult
from core.payments.fake import FakePaymentProvider
from core.security import create_access_token
from models.client import Client
from models.library import Library, LibraryHours, LibraryStatus
from models.library_exam import (
    ExamRegistration,
    ExamSessionStatus,
    LibraryExamSession,
    RegistrationStatus,
)
from models.study_reservation import StudyReservation


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


def auth_header(user_id: int, role: str, role_id: int, auth_version: int) -> dict[str, str]:
    """Gerçek imzalı JWT (`core.security`). `auth_version` gerçek satırdan gelir —
    varsayılan bilinçli olarak YOK (bkz. `ip1a_factory.auth_header`)."""
    token = create_access_token(
        subject=user_id, role=role, role_id=role_id, auth_version=auth_version
    )
    return {"Authorization": f"Bearer {token}"}


# ── Sağlayıcı: charge SAYAR ─────────────────────────────────────────────────────


class SayanSaglayici(FakePaymentProvider):
    """`charge` ve `refund` çağrılarını sayan sağlayıcı.

    `conftest.py::StubProvider` yalnız `refund` sayar. İP-1b'nin P-1/P-2
    düğümleri "eşzamanlı iki `pay()` **kaç kez tahsilat denedi**" sorusunu
    sorar; bu yalnız charge sayacıyla cevaplanabilir. Mevcut stub'ı değiştirmek
    İP-1a/İP-2a testlerinin zeminini oynatırdı, o yüzden ayrı sınıf.
    """

    def __init__(self) -> None:
        self.charge_calls: list[str] = []
        self.refund_calls: list[tuple[str | None, Decimal]] = []
        self.charge_gate: asyncio.Event | None = None
        #: İlk tahsilat kapıya girdi (yani o transaction sağlayıcıda ASILI).
        self.charge_entered: asyncio.Event = asyncio.Event()
        #: İKİNCİ tahsilat kapıya girdi = çift tahsilat gerçekten oldu. Testin
        #: `sleep` ile "herhâlde varmıştır" tahmini yapmasını gereksiz kılar.
        self.ikinci_charge: asyncio.Event = asyncio.Event()

    async def charge(self, **kw) -> ChargeResult:
        self.charge_calls.append(str(kw.get("reference")))
        if len(self.charge_calls) >= 2:
            self.ikinci_charge.set()
        self.charge_entered.set()
        if self.charge_gate is not None:
            await self.charge_gate.wait()
        return await super().charge(**kw)

    async def refund(self, *, provider_ref: str | None, amount: Decimal) -> bool:
        self.refund_calls.append((provider_ref, Decimal(str(amount))))
        return True


@pytest.fixture
def sayan_saglayici(monkeypatch) -> SayanSaglayici:
    stub = SayanSaglayici()
    from core import payments

    monkeypatch.setattr(payments, "get_payment_provider", lambda: stub)
    return stub


# ── Fabrika ─────────────────────────────────────────────────────────────────────


class Ip1bFabrika:
    """Kütüphane / oturum / kayıt / rezervasyon üretir; teardown fiziksel siler."""

    def __init__(self) -> None:
        self.client_ids: list[int] = []
        self.library_ids: list[int] = []
        self.session_ids: list[int] = []

    # ── Taraflar ────────────────────────────────────────────────────────────

    async def ogrenci(self) -> Client:
        u = _uniq()
        async with AsyncSessionLocal() as s:
            c = Client(
                email=f"c-{u}@ip1b.test",
                hashed_password="test-only",
                first_name="Ip1b",
                last_name="Ogrenci",
                role_id=3,
                # Ödeme uçları telefon doğrulaması ister; doldurulmazsa HTTP
                # testleri 403 alır ve bu YANLIŞ bir kırmızı olurdu.
                phone=f"+90555{u[:7]}",
                phone_verified_at=_now(),
            )
            s.add(c)
            await s.flush()
            self.client_ids.append(c.id)
            await s.commit()
            await s.refresh(c)
            s.expunge(c)
        return c

    async def kutuphane(
        self,
        *,
        status: str = LibraryStatus.ACTIVE.value,
        capacity: int | None = None,
        study_hourly_price: Decimal | None = None,
        saatler: bool = False,
    ) -> Library:
        u = _uniq()
        async with AsyncSessionLocal() as s:
            lib = Library(
                name=f"Ip1b Kutuphane {u}",
                slug=f"ip1b-kutuphane-{u}",
                status=status,
                capacity=capacity,
                study_hourly_price=study_hourly_price,
            )
            s.add(lib)
            await s.flush()
            if saatler:
                for gun in range(7):
                    s.add(
                        LibraryHours(
                            library_id=lib.id,
                            weekday=gun,
                            is_closed=False,
                            open_minute=0,
                            close_minute=1440,
                        )
                    )
            self.library_ids.append(lib.id)
            await s.commit()
            await s.refresh(lib)
            s.expunge(lib)
        return lib

    async def oturum(
        self,
        library_id: int,
        *,
        capacity: int = 1,
        price: Decimal = Decimal("100.00"),
        starts_at: datetime.datetime | None = None,
        status: str = ExamSessionStatus.SCHEDULED.value,
    ) -> LibraryExamSession:
        u = _uniq()
        async with AsyncSessionLocal() as s:
            sess = LibraryExamSession(
                library_id=library_id,
                exam_type="TYT",
                title=f"Ip1b Deneme {u}",
                starts_at=starts_at or (_now() + datetime.timedelta(days=30)),
                duration_minutes=120,
                capacity=capacity,
                price=price,
                currency="TRY",
                status=status,
            )
            s.add(sess)
            await s.flush()
            self.session_ids.append(sess.id)
            await s.commit()
            await s.refresh(sess)
            s.expunge(sess)
        return sess

    # ── Gerçek üretim yolu ──────────────────────────────────────────────────

    async def kaydol(self, client: Client, session_id: int):
        """`library_exam_service.register` GERÇEKTEN koşar (kendi session'ında)."""
        from services import library_exam_service

        async with AsyncSessionLocal() as s:
            db_client = await s.get(Client, client.id)
            out = await library_exam_service.register(s, db_client, session_id)
            await s.commit()
        return out

    async def ode(self, client: Client, registration_id: int):
        from services import library_exam_service

        async with AsyncSessionLocal() as s:
            db_client = await s.get(Client, client.id)
            out = await library_exam_service.pay(s, db_client, registration_id)
            await s.commit()
        return out

    async def rezerve_et(
        self, client: Client, library_id: int, starts, ends
    ):
        from services import study_reservation_service

        async with AsyncSessionLocal() as s:
            db_client = await s.get(Client, client.id)
            out = await study_reservation_service.reserve(
                s, db_client, library_id=library_id, starts=starts, ends=ends
            )
            await s.commit()
        return out

    async def study_ode(self, client: Client, reservation_id: int):
        from services import study_reservation_service

        async with AsyncSessionLocal() as s:
            db_client = await s.get(Client, client.id)
            out = await study_reservation_service.pay(s, db_client, reservation_id)
            await s.commit()
        return out

    # ── Ön-durum kurulumu (para durumu SAHTELENMEZ) ──────────────────────────

    async def ham_kayit(
        self,
        *,
        session_id: int,
        client_id: int,
        status: str = RegistrationStatus.PENDING_PAYMENT.value,
        amount: Decimal = Decimal("100.00"),
        short_code: str | None = None,
        qr_token: str | None = None,
    ) -> int:
        """Doğrudan model INSERT ile kayıt (yalnız `pay()` ön-koşulu için)."""
        from services import commission

        rate = Decimal("0.1000")
        komisyon, kazanc = commission.split(amount, rate)
        async with AsyncSessionLocal() as s:
            reg = ExamRegistration(
                session_id=session_id,
                client_id=client_id,
                status=status,
                amount=amount,
                commission_amount=komisyon,
                library_earning=kazanc,
                commission_rate=rate,
                currency="TRY",
                short_code=short_code,
                qr_token=qr_token,
                paid_at=_now() if status == RegistrationStatus.PAID.value else None,
            )
            s.add(reg)
            await s.flush()
            rid = reg.id
            await s.commit()
        return rid

    async def ham_rezervasyon(
        self,
        *,
        library_id: int,
        client_id: int,
        starts: datetime.datetime,
        ends: datetime.datetime,
        status: str = RegistrationStatus.PENDING_PAYMENT.value,
        amount: Decimal = Decimal("50.00"),
    ) -> int:
        from services import commission

        rate = Decimal("0.1000")
        komisyon, kazanc = commission.split(amount, rate)
        async with AsyncSessionLocal() as s:
            res = StudyReservation(
                library_id=library_id,
                client_id=client_id,
                starts_at=starts,
                ends_at=ends,
                status=status,
                hourly_price=Decimal("25.00"),
                amount=amount,
                commission_amount=komisyon,
                library_earning=kazanc,
                commission_rate=rate,
                currency="TRY",
                paid_at=_now() if status == RegistrationStatus.PAID.value else None,
            )
            s.add(res)
            await s.flush()
            rid = res.id
            await s.commit()
        return rid

    # ── Zaman / durum kurulumu ──────────────────────────────────────────────

    async def _kolon_var(self, tablo: str, kolon: str) -> bool:
        async with AsyncSessionLocal() as s:
            return bool(
                (
                    await s.execute(
                        text(
                            "SELECT 1 FROM information_schema.columns "
                            "WHERE table_name = :t AND column_name = :c"
                        ),
                        {"t": tablo, "c": kolon},
                    )
                ).first()
            )

    async def hold_bitir(self, tablo: str, row_id: int) -> bool:
        """Ödeme bekleyen kaydın koltuk tutmasını sonlandırır (TTL'i geçmişe çeker).

        Kolon henüz yoksa (kırmızı matris turu) sessizce `False` döner — bkz.
        modül docstring'i "sürüm toleransı".
        """
        if not await self._kolon_var(tablo, "hold_expires_at"):
            return False
        async with AsyncSessionLocal() as s:
            await s.execute(
                text(
                    f"UPDATE {tablo} SET hold_expires_at = now() - interval '1 hour' "  # noqa: S608
                    "WHERE id = :i"
                ),
                {"i": row_id},
            )
            await s.commit()
        return True

    async def kutuphaneyi_sil(self, library_id: int) -> None:
        """Kütüphaneyi guard'ı ATLAYARAK soft-delete eder (ham SQL).

        Canlılık düğümleri (S-1…S-4) "silinmiş kütüphane satış yapamaz"ı ölçer;
        bunu `delete_library` üzerinden kurmak, silme guard'ı (D-1) eklendiği
        gün senaryoyu KURULAMAZ hâle getirirdi ve iki ayrı sözleşme birbirine
        bağlanırdı. Ayrıca üretimde de bu durum doğar: geçmişte silinmiş
        kayıtlar ve doğrudan veri müdahaleleri.
        """
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("UPDATE libraries SET deleted_at = now() WHERE id = :i"),
                {"i": library_id},
            )
            await s.commit()

    async def oturumu_gecmise_al(self, session_id: int, *, delta: datetime.timedelta) -> None:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text(
                    "UPDATE library_exam_sessions "
                    "SET starts_at = starts_at - make_interval(secs => :s) WHERE id = :i"
                ),
                {"s": delta.total_seconds(), "i": session_id},
            )
            await s.commit()

    async def rezervasyonu_gecmise_al(
        self, reservation_id: int, *, delta: datetime.timedelta
    ) -> None:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text(
                    "UPDATE study_reservations SET "
                    "starts_at = starts_at - make_interval(secs => :s), "
                    "ends_at = ends_at - make_interval(secs => :s) WHERE id = :i"
                ),
                {"s": delta.total_seconds(), "i": reservation_id},
            )
            await s.commit()

    # ── Gözlem (hep TAZE session — bayat identity map yok) ───────────────────

    async def kayitlar(self, session_id: int) -> list[dict]:
        async with AsyncSessionLocal() as s:
            return [
                dict(r)
                for r in (
                    await s.execute(
                        text(
                            "SELECT id, client_id, status, qr_token, short_code, "
                            "paid_at, released_at FROM exam_registrations "
                            "WHERE session_id = :i AND deleted_at IS NULL ORDER BY id"
                        ),
                        {"i": session_id},
                    )
                ).mappings()
            ]

    async def rezervasyonlar(self, library_id: int) -> list[dict]:
        async with AsyncSessionLocal() as s:
            return [
                dict(r)
                for r in (
                    await s.execute(
                        text(
                            "SELECT id, client_id, status, starts_at, ends_at, "
                            "qr_token, short_code, released_at FROM study_reservations "
                            "WHERE library_id = :i AND deleted_at IS NULL ORDER BY id"
                        ),
                        {"i": library_id},
                    )
                ).mappings()
            ]

    @staticmethod
    def koltuk_tutanlar(satirlar: list[dict]) -> list[dict]:
        """Kontenjandan gerçekten koltuk YİYEN satırlar.

        Ödenmiş (`PAID`) ve katılmış (`ATTENDED`) kayıtlar. Ödeme bekleyen
        tutmalar bilinçli olarak SAYILMAZ: onların koltuk tutması geçicidir ve
        testin ölçtüğü zarar "kaç kişiden PARA ALINDI"dır — kalıcı aşım budur.
        """
        return [
            r
            for r in satirlar
            if r["status"]
            in (RegistrationStatus.PAID.value, RegistrationStatus.ATTENDED.value)
        ]

    async def cakisan_aktif(
        self, library_id: int, starts: datetime.datetime, ends: datetime.datetime
    ) -> int:
        async with AsyncSessionLocal() as s:
            return int(
                (
                    await s.execute(
                        text(
                            "SELECT count(*) FROM study_reservations "
                            "WHERE library_id = :i AND deleted_at IS NULL "
                            "AND status IN ('PAID','ATTENDED') "
                            "AND starts_at < :e AND ends_at > :s"
                        ),
                        {"i": library_id, "s": starts, "e": ends},
                    )
                ).scalar_one()
            )

    # ── Temizlik ────────────────────────────────────────────────────────────

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("DELETE FROM notifications WHERE role_id = 3 AND user_id = ANY(:c)"),
                {"c": self.client_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM exam_registrations WHERE session_id = ANY(:i)"),
                {"i": self.session_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM exam_registrations WHERE client_id = ANY(:c)"),
                {"c": self.client_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM study_reservations WHERE library_id = ANY(:l)"),
                {"l": self.library_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM library_exam_sessions WHERE id = ANY(:i)"),
                {"i": self.session_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM library_exam_sessions WHERE library_id = ANY(:l)"),
                {"l": self.library_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM library_reviews WHERE library_id = ANY(:l)"),
                {"l": self.library_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM library_hours WHERE library_id = ANY(:l)"),
                {"l": self.library_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM library_amenities WHERE library_id = ANY(:l)"),
                {"l": self.library_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM libraries WHERE id = ANY(:l)"),
                {"l": self.library_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM clients WHERE id = ANY(:c)"),
                {"c": self.client_ids or [0]},
            )
            await s.commit()

    async def sizinti_var_mi(self) -> dict[str, int]:
        sorgular = {
            "exam_registrations": (
                "SELECT count(*) FROM exam_registrations WHERE client_id = ANY(:i)",
                self.client_ids,
            ),
            "study_reservations": (
                "SELECT count(*) FROM study_reservations WHERE client_id = ANY(:i)",
                self.client_ids,
            ),
            "library_exam_sessions": (
                "SELECT count(*) FROM library_exam_sessions WHERE library_id = ANY(:i)",
                self.library_ids,
            ),
            "libraries": ("SELECT count(*) FROM libraries WHERE id = ANY(:i)", self.library_ids),
            "clients": ("SELECT count(*) FROM clients WHERE id = ANY(:i)", self.client_ids),
        }
        kalan: dict[str, int] = {}
        async with AsyncSessionLocal() as s:
            for ad, (sql, ids) in sorgular.items():
                n = int((await s.execute(text(sql), {"i": ids or [0]})).scalar_one())
                if n:
                    kalan[ad] = n
        return kalan


@pytest.fixture
async def ip1b(pg):
    """Fabrika + garantili teardown (test kırmızıyken de koşar)."""
    f = Ip1bFabrika()
    try:
        yield f
    finally:
        await f.cleanup()


@pytest.fixture
async def ip1b_http():
    """GERÇEK FastAPI uygulaması — dependency override YOK, lifespan YOK."""
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://ip1b.test"
    ) as c:
        yield c
