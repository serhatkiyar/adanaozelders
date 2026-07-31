"""Para yolu entegrasyon testleri — GERÇEK Postgres (docker compose) gerektirir.

Üretimle AYNI engine/session fabrikası (core.database.AsyncSessionLocal) kullanılır;
engine isolation override etmez → testler üretimle birebir aynı seviyede
(READ COMMITTED) çalışır. Testler kendi satırlarını üretir ve teardown'da
FİZİKSEL siler; dev DB'de kalıcı iz bırakmaz.

Çalıştırma (backend/ içinden; kök conftest.py CI için sahte POSTGRES_* default'ları
koyduğundan gerçek değerler pytest'ten ÖNCE env ile verilmelidir):

    $env:POSTGRES_USER='postgres'; $env:POSTGRES_PASSWORD='...'
    $env:POSTGRES_DB='ceyhandb'; $env:POSTGRES_HOST='localhost'
    $env:POSTGRES_PORT='5433'   # docker compose host yayını (yerel 5432 çakışması!)
    python -m pytest tests/integration -q

DİKKAT: Hostta ayrıca yerel bir PostgreSQL servisi 5432'yi dinliyorsa loopback
bağlantıları sessizce ORAYA gider — compose postgres'i bu yüzden 5433'ten yayınlanır.

Postgres'e ulaşılamıyorsa testler FAIL değil SKIP olur.
"""
from __future__ import annotations

import asyncio
import dataclasses
import datetime
import os
import pathlib
import subprocess
import sys
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import exc as sa_exc
from sqlalchemy import text

from core.config import settings
from core.database import AsyncSessionLocal, engine
from tests.integration.db_guard import assert_test_database
from tests.service_guard import servis_yok
from core.payments.fake import FakePaymentProvider
from models.booking import Booking, BookingStatus
from models.client import Client
from models.library import Library
from models.library_exam import ExamRegistration, LibraryExamSession
from models.payment import Payment, PaymentStatus
from models.tutor import Tutor, TutorStatus
from services import commission


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


#: `pg` fixture'ının SKIP sebebi sayacağı hatalar — YALNIZ gerçekten "Postgres
#: yok/erişilemiyor" anlamına gelenler.
#:
#: Önceden burada çıplak `except Exception` vardı ve bu SESSİZ bir yalancı
#: yeşil kaynağıydı: `pg` fixture'ını istemeyi unutan bir test, havuzda kalan
#: bayat asyncpg bağlantısı yüzünden bir sonraki testte `AttributeError`
#: ürettiriyor ve o test "Postgres erişilemiyor" diye SKIP oluyordu. Tam olarak
#: bu yaşandı: yeni yazılan `bucket` NOT NULL testi hiç koşmadan SKIP göründü.
#: Beklenmeyen hata artık yükseltilir — koşmayan test kırmızıdır, yeşil değil.
_BAGLANTI_HATALARI = (
    ConnectionError,
    OSError,
    sa_exc.OperationalError,
    sa_exc.InterfaceError,
    sa_exc.DBAPIError,
)


@pytest.fixture
async def pg():
    """Gerçek Postgres erişilebilir mi? Değilse skip. Test sonunda engine havuzunu
    boşaltır (pytest-asyncio her testte yeni event loop kurar; asyncpg bağlantıları
    loop'a bağlıdır — dispose edilmezse sonraki test kırık bağlantı alır).

    ÖNCE güvenlik kilidi: bu testler fiziksel INSERT/DELETE yapar ve biri
    dağıtım kuyruğundaki siparişleri geçici olarak park eder. Yanlış
    veritabanına bağlanmış bir koşu canlı operasyonu bozar, o yüzden şüphe
    hâlinde SKIP değil HATA verilir (bkz. tests/integration/db_guard.py).
    """
    assert_test_database()
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except _BAGLANTI_HATALARI as exc:
        # Yerelde SKIP (docker compose kurmamış geliştirici bloklanmasın), ama
        # CI_REQUIRE_SERVICES=1 iken HATA: Postgres servisi düşmüş bir CI koşusu
        # "entegrasyon testleri geçti" diye okunamaz.
        servis_yok("Postgres", exc)
    yield engine
    await engine.dispose()


class StubProvider(FakePaymentProvider):
    """Çağrı sayan + kapı (gate) ile yarış penceresi genişletilebilen sağlayıcı.

    ``refund_gate`` verilirse refund çağrısı, event set edilene dek bekler — iki
    eşzamanlı transaction'ın "status okundu ama henüz yazılmadı" penceresinde
    buluşmasını DETERMİNİSTİK yapar.
    """

    def __init__(self) -> None:
        self.refund_calls: list[tuple[str | None, Decimal]] = []
        self.refund_gate: asyncio.Event | None = None
        self.refund_result: bool = True

    async def refund(self, *, provider_ref: str | None, amount: Decimal) -> bool:
        self.refund_calls.append((provider_ref, Decimal(str(amount))))
        if self.refund_gate is not None:
            await self.refund_gate.wait()
        return self.refund_result


@pytest.fixture
def provider(monkeypatch) -> StubProvider:
    stub = StubProvider()
    from core import payments

    monkeypatch.setattr(payments, "get_payment_provider", lambda: stub)
    return stub


@dataclasses.dataclass
class SeededBooking:
    tutor_id: int
    client_id: int
    booking_id: int
    payment_id: int
    amount: Decimal


@dataclasses.dataclass
class SeededExamReg:
    client_id: int
    library_id: int
    session_id: int
    reg_id: int
    amount: Decimal


class MoneyFactory:
    """Test verisi üretir ve ürettiklerini kaydeder; teardown fiziksel siler."""

    def __init__(self) -> None:
        self.tutor_ids: list[int] = []
        self.client_ids: list[int] = []
        self.booking_ids: list[int] = []
        self.library_ids: list[int] = []
        self.session_ids: list[int] = []

    async def booking_with_payment(
        self,
        *,
        booking_status: BookingStatus = BookingStatus.ACCEPTED,
        payment_status: PaymentStatus = PaymentStatus.HELD,
        provider_ref: str | None = "cf-token",
        amount: Decimal = Decimal("500.00"),
    ) -> SeededBooking:
        rate = Decimal("0.1000")
        commission_amount, earning = commission.split(amount, rate)
        async with AsyncSessionLocal() as s:
            u = _uniq()
            tutor = Tutor(
                email=f"t-{u}@money.test", hashed_password="x",
                first_name="Para", last_name="Testi", username=f"t{u}",
                role_id=2, status=TutorStatus.APPROVED, hourly_rate=Decimal("500"),
            )
            client = Client(
                email=f"c-{u}@money.test", hashed_password="x",
                first_name="Para", last_name="Ogrenci", username=f"c{u}", role_id=3,
            )
            s.add_all([tutor, client])
            await s.flush()
            start = _now() + datetime.timedelta(days=30)
            booking = Booking(
                tutor_id=tutor.id, client_id=client.id, status=booking_status,
                start_at=start, end_at=start + datetime.timedelta(hours=1),
                price=amount, mode="ONLINE",
            )
            s.add(booking)
            await s.flush()
            payment = Payment(
                booking_id=booking.id, amount=amount,
                commission_amount=commission_amount, tutor_earning=earning,
                commission_rate=rate, currency="TRY", status=payment_status,
                provider="fake", provider_ref=provider_ref,
                paid_at=_now() if payment_status == PaymentStatus.HELD else None,
            )
            s.add(payment)
            await s.flush()
            seeded = SeededBooking(
                tutor_id=tutor.id, client_id=client.id,
                booking_id=booking.id, payment_id=payment.id, amount=amount,
            )
            await s.commit()
        self.tutor_ids.append(seeded.tutor_id)
        self.client_ids.append(seeded.client_id)
        self.booking_ids.append(seeded.booking_id)
        return seeded

    async def exam_registration(
        self,
        *,
        reg_status: str,
        provider_ref: str | None = "cf-token",
        amount: Decimal = Decimal("100.00"),
        released_at: datetime.datetime | None = None,
        paid_at: datetime.datetime | None = None,
    ) -> SeededExamReg:
        rate = Decimal("0.1000")
        commission_amount, earning = commission.split(amount, rate)
        async with AsyncSessionLocal() as s:
            u = _uniq()
            client = Client(
                email=f"c-{u}@money.test", hashed_password="x",
                first_name="Para", last_name="Ogrenci", username=f"c{u}", role_id=3,
            )
            library = Library(name=f"Test Kutuphane {u}", slug=f"test-kutuphane-{u}")
            s.add_all([client, library])
            await s.flush()
            session = LibraryExamSession(
                library_id=library.id, exam_type="TYT", title=f"Deneme {u}",
                starts_at=_now() + datetime.timedelta(days=30),
                duration_minutes=120, capacity=50, price=amount, currency="TRY",
                status="SCHEDULED",
            )
            s.add(session)
            await s.flush()
            reg = ExamRegistration(
                session_id=session.id, client_id=client.id, status=reg_status,
                amount=amount, commission_amount=commission_amount,
                library_earning=earning, commission_rate=rate, currency="TRY",
                provider="fake", provider_ref=provider_ref,
                paid_at=paid_at, released_at=released_at,
            )
            s.add(reg)
            await s.flush()
            seeded = SeededExamReg(
                client_id=client.id, library_id=library.id,
                session_id=session.id, reg_id=reg.id, amount=amount,
            )
            await s.commit()
        self.client_ids.append(seeded.client_id)
        self.library_ids.append(seeded.library_id)
        self.session_ids.append(seeded.session_id)
        return seeded

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text(
                    "DELETE FROM notifications WHERE (role_id = 2 AND user_id = ANY(:t))"
                    " OR (role_id = 3 AND user_id = ANY(:c))"
                ),
                {"t": self.tutor_ids or [0], "c": self.client_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM payments WHERE booking_id = ANY(:ids)"),
                {"ids": self.booking_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM bookings WHERE id = ANY(:ids)"),
                {"ids": self.booking_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM exam_registrations WHERE session_id = ANY(:ids)"),
                {"ids": self.session_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM library_exam_sessions WHERE id = ANY(:ids)"),
                {"ids": self.session_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM libraries WHERE id = ANY(:ids)"),
                {"ids": self.library_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM tutors WHERE id = ANY(:ids)"),
                {"ids": self.tutor_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM clients WHERE id = ANY(:ids)"),
                {"ids": self.client_ids or [0]},
            )
            await s.commit()


@pytest.fixture
async def factory(pg) -> MoneyFactory:
    f = MoneyFactory()
    yield f
    await f.cleanup()

# ═════════════ Tek kullanımlık test veritabanı + hijyen nöbetçisi ═════════════
#
# 30 Tem 2026'ya kadar bu testler geliştirme veritabanına (`ceyhandb`) karşı
# koşuyordu. İki somut zarar oluştu:
#   1. Katalogda **1841 test ürünü** birikti (defter satırları append-only
#      olduğu için ürünler yalnız soft-delete edilebiliyordu),
#   2. Bir mutasyon provası denetim işine `UPDATE products SET stock = 0`
#      enjekte edince **gerçek katalog ürünlerinin stoğu sıfırlandı**.
#
# Artık suite adı `test` içeren bir veritabanı ister; yoksa oluşturulur ve
# `alembic upgrade head` ile hazırlanır.

#: Suite öncesi/sonrası sayısı DEĞİŞMEMESİ gereken tablolar.
#:
#: Buradaki liste **otomatik** nöbetçidir; elle yapılan tek seferlik ölçümler
#: onun yerine geçmez. F29 denetiminde tam olarak bu ayrım kaçmıştı:
#: `audit_logs` elle ölçülüyor ama nöbetçide olmadığı için 619 satır sessizce
#: birikmişti. "Ayrı karar" diyerek korumasız bırakmak, korumasız bırakmaktır.
_KRITIK_TABLOLAR = (
    "products",
    "stock_movements",
    "stock_count_sessions",
    "stock_count_lines",
    "stock_count_line_events",
    "stock_damage_events",
    "orders",
    "order_items",
    "order_status_history",
    "order_returns",
    "order_return_items",
    "clients",
    "admins",
    # Servisler audit yazabildiği için testler de yazar; korumasız bırakılmaz.
    "audit_logs",
    # Testler kendi admin rollerini yaratiyor; birikirlerse /yonetim rol
    # yonetimi ekrani yuzlerce E7_XXXX / EO_XXXX rolüyle dolar.
    "admin_roles",
    "admin_role_permissions",
    "admin_role_assignments",
)


def _bakim_url() -> str:
    return (
        f"postgresql+asyncpg://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}"
        f"@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/postgres"
    )


async def _veritabani_var_mi(bakim, ad: str) -> bool:
    async with bakim.connect() as conn:
        return bool(
            (
                await conn.execute(
                    text("SELECT 1 FROM pg_database WHERE datname = :a"), {"a": ad}
                )
            ).first()
        )


@pytest.fixture(scope="session", autouse=True)
async def _test_veritabani():
    """Tek kullanımlık test veritabanını hazırlar (yoksa oluşturur + migrate)."""
    from sqlalchemy.ext.asyncio import create_async_engine

    assert_test_database()   # ad `test` içermiyorsa suite BAŞLAMAZ
    ad = settings.POSTGRES_DB

    bakim = create_async_engine(_bakim_url(), isolation_level="AUTOCOMMIT")
    try:
        async with bakim.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except _BAGLANTI_HATALARI as exc:
        await bakim.dispose()
        # Session kapsamlı ve autouse: buradaki bir SKIP BÜTÜN entegrasyon
        # paketini sessizce atlatır. CI'da bu, "gerçek Postgres'te doğrulandı"
        # iddiasını kanıtsız bırakır — o yüzden CI_REQUIRE_SERVICES=1 iken kırar.
        servis_yok("Postgres (bakım bağlantısı)", exc)
    except Exception as exc:  # noqa: BLE001
        # Yapılandırma hatası "altyapı yok" DEĞİLDİR. Session kapsamlı ve
        # autouse olduğu için buradaki bir SKIP bütün entegrasyon suite'ini
        # sessizce atlatırdı.
        await bakim.dispose()
        pytest.fail(
            "Postgres bakım bağlantısı kurulamadı (bağlantı hatası değil, "
            f"yapılandırma sorunu): {exc.__class__.__name__}: {exc}"
        )

    try:
        if not await _veritabani_var_mi(bakim, ad):
            async with bakim.connect() as conn:
                await conn.execute(text(f'CREATE DATABASE "{ad}"'))

        # Migration ve seed KOŞULSUZ koşar (ikisi de idempotent). Yalnız
        # "yeni oluşturuldu" dalında koşmak, bir önceki koşumda yarıda kalmış
        # bir veritabanını sonsuza dek eksik bırakır — bu tuzağa bir kez düşüldü
        # (şema vardı, `roles` boştu, 120 test FK ihlaliyle kırıldı).
        res = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=str(pathlib.Path(__file__).resolve().parents[2]),
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            env={**os.environ, "POSTGRES_DB": ad, "AUTO_CREATE_DB": "false"},
        )
        if res.returncode != 0:
            raise RuntimeError(
                f"test veritabani migrate edilemedi: {res.stdout} {res.stderr}"
            )
        from core.seed import seed_admin, seed_roles

        # `seed_admin`, ADMIN_EMAIL/ADMIN_PASSWORD boşsa SESSİZCE hiçbir şey
        # yapmaz. Bu iki ayarın varsayılanı `None` olduğundan (ve CI'da .env
        # yoktur) paket, yönetici satırı bekleyen 157 testte "seed admin yok"
        # ile toptan kırılıyordu — yerelde `.env`'i olan geliştiricide ise
        # geçiyordu, yani sorun ancak CI'da görülecekti.
        #
        # Testin fikstürü bir dağıtım ayarına bağlı olmamalı: değer yoksa
        # test değeri konur. Ayarlı bir ortam (yerel .env) ezilmez.
        if not (settings.ADMIN_EMAIL and settings.ADMIN_PASSWORD):
            settings.ADMIN_EMAIL = "ci-admin@test.local"
            settings.ADMIN_PASSWORD = "ci-admin-parola"

        async with AsyncSessionLocal() as sess:
            await seed_roles(sess)
            await seed_admin(sess)
            await sess.commit()
        await engine.dispose()
    finally:
        await bakim.dispose()
    yield ad


async def _tablo_sayilari() -> dict[str, int]:
    """Kritik tablo sayıları.

    Sonunda `engine.dispose()` ZORUNLU: pytest-asyncio her teste yeni event loop
    kurar ve asyncpg bağlantıları loop'a bağlıdır. Session kapsamlı bir fixture
    havuzda bağlantı bırakırsa sonraki test kırık bağlantı alır ve `pg` fixture'ı
    "Postgres erişilemiyor" diye SKIP eder (bu tuzağa bir kez düşüldü — 120 test
    sessizce atlandı).
    """
    async with AsyncSessionLocal() as s:
        sayilar = {
            t: (await s.execute(text(f"SELECT count(*) FROM {t}"))).scalar_one()
            for t in _KRITIK_TABLOLAR
        }
    await engine.dispose()
    return sayilar


@pytest.fixture(scope="session", autouse=True)
async def _hijyen_nobetcisi(_test_veritabani):
    """Suite öncesi/sonrası kritik tablo sayıları AYNI kalmalı.

    Bir test teardown'ı unutur/başarısız olursa satır birikir ve bu zamanla
    admin ekranlarını, genel denetimi ve performans ölçümlerini şişirir. Sayaç,
    "temizlik çalıştı" iddiasını her koşumda yeniden kanıtlar.
    """
    once = await _tablo_sayilari()
    yield
    try:
        sonra = await _tablo_sayilari()
    except Exception as exc:  # noqa: BLE001
        # SESSİZCE GEÇMEZ. "suite temiz" ile "nöbetçi hiç ölçmedi" birbirinden
        # ayırt edilemezse bütün izolasyon garantisi kanıtsız kalır — F29'da
        # audit_logs birikmesi tam olarak bunun yüzünden geç fark edildi.
        pytest.fail(
            "hijyen nöbetçisi ÖLÇEMEDİ; suite temiz sayılamaz: "
            f"{exc.__class__.__name__}: {exc}"
        )
    artan = {t: (once[t], sonra[t]) for t in once if sonra[t] != once[t]}
    if artan:
        ayrinti = ", ".join(f"{t}: {a}→{b}" for t, (a, b) in sorted(artan.items()))
        pytest.fail(
            "TEST İZOLASYONU BOZUK — suite kalıcı satır bıraktı: " + ayrinti,
            pytrace=False,
        )
