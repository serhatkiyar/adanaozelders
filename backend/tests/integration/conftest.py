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
from tests.integration.redis_guard import assert_test_redis
from tests.integration.db_guard import (
    assert_fake_payment_provider,
    assert_test_database,
)
from tests.service_guard import servis_yok
from core.payments.fake import FakePaymentProvider
from models.booking import Booking, BookingStatus
from models.client import Client
from models.library import Library
from models.library_exam import ExamRegistration, LibraryExamSession
from models.payment import Payment, PaymentStatus
from models.tutor import Tutor, TutorStatus
from services import commission

# İP-2b fixture'ları (fab/http/sms_kayit) burada kayda geçer — test dosyaları
# import etmez (fixture parametresi import edilen adı gölgeleyip F811 üretiyordu).
from tests.integration.ip2b_factory import fab, http, sms_kayit  # noqa: F401,E402
# İP-5 fabrikası (fab5) da burada kayda geçer: test dosyasında import
# etmek, fixture parametresi aynı adı gölgelediği için F811 üretiyordu.
from tests.integration.ip5_factory import fab5  # noqa: F401,E402
# İP-12 fabrikası (fab12) — aynı gerekçe: fixture parametresi import edilen adı
# gölgeleyip F811 üretiyor.
from tests.integration.ip12_factory import fab12  # noqa: F401,E402
# İP-C2 duyuru şeridi fabrikası (fab_duyuru) — aynı gerekçe.
from tests.integration.duyuru_factory import fab_duyuru  # noqa: F401,E402


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

    ``refund_entered`` bunun ters yönüdür: kapıya GİRİLDİĞİ anda set edilir, yani
    "iade faz-1'i commit'lendi ve akış sağlayıcıda asılı" olayını test tarafına
    bildirir. Test bunu beklediğinde `asyncio.sleep(...)` ile "herhâlde oraya
    varmıştır" tahmininde bulunmak zorunda kalmaz — ardışıklık ölçülür, tahmin
    edilmez (zamanlamaya bahis oynanmaz). Bir testte birden çok iade
    olabileceği için event `refund_calls` sayacının yerine geçmez; "en az bir
    iade kapıya ulaştı" anlamındadır.

    Beklerken **süre koyun**: kapıyı açacak yol bozulduğunda (ör. iade çağrısı
    hiç yapılmadığında) çıplak `await provider.refund_entered.wait()` testi
    kırmızıya değil sonsuz beklemeye çevirir. İP-1a yarış dosyası bu yüzden
    sonlu bariyerden geçer (`test_ip1a_races_pg.py::_event_bekle`); yeni test
    yazarken aynı deseni kullanın.
    """

    def __init__(self) -> None:
        self.refund_calls: list[tuple[str | None, Decimal]] = []
        self.refund_gate: asyncio.Event | None = None
        self.refund_entered: asyncio.Event = asyncio.Event()
        self.refund_result: bool = True

    async def refund(self, *, provider_ref: str | None, amount: Decimal) -> bool:
        self.refund_calls.append((provider_ref, Decimal(str(amount))))
        self.refund_entered.set()
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


# İP-1a ders para yolu fabrikası ve HTTP istemcisi. Fixture'lar tanımları
# `ip1a_factory.py`'de durur ama pytest'in onları bulabilmesi için conftest
# ad alanında olmaları gerekir. Test modüllerine tek tek import edilselerdi,
# aynı adı test parametresi olarak da kullanmak F811 (gölgeleme) üretirdi.
from tests.integration.ip1a_factory import ip1a, ip1a_http  # noqa: E402,F401

# İP-1b kütüphane kolu (kontenjan / canlılık / bilet kodu / claim) fixture'ları.
# Aynı gerekçe: fixture adları conftest ad alanında olmalı, test modülüne
# import edilirlerse aynı adı parametre olarak kullanmak F811 üretir.
from tests.integration.ip1b_factory import (  # noqa: E402,F401
    ip1b,
    ip1b_http,
    sayan_saglayici,
)

# İP-16 aralıklı tekrar (FSRS) fixture'ları — aynı F811 gerekçesi.
from tests.integration.ip16_factory import (  # noqa: E402,F401
    ip16,
    ip16_http,
    ip16_saat,
)

# ═══════════════ İP-3: yetki / kişisel veri / hesap güvenliği ═══════════════


@pytest.fixture
async def ip3(pg):
    """Gerçek roller + gerçek ilişkiler fabrikası (bkz. `ip3_factory.py`)."""
    from tests.integration.ip3_factory import IP3Fabrika

    f = IP3Fabrika()
    try:
        yield f
    finally:
        await f.cleanup()


# NOT (main birleştirmesi): İP-3 burada kendi `http` fixture'ını tanımlıyordu;
# güncel main ise aynı adı `ip2b_factory`'den import ediyor (yukarıdaki satır).
# İkisi bir arada kaldığında SESSİZ bir sorun doğuyordu: sonra tanımlanan İP-3
# sürümü import'u gölgeliyor ve İP-2b testleri `pg` bağımlılığını KAYBEDİYORDU
# (o fixture her testten sonra engine havuzunu boşaltır; asyncpg bağlantıları
# event loop'a bağlı olduğu için bu, "Event loop is closed" sınıfı flaky'nin
# bilinen panzehiridir). Bu yüzden tek bir fixture bırakıldı: `pg` alan ve daha
# güçlü olan ortak sürüm. İkisi de aynı şeyi yapıyordu — gerçek uygulamayı
# `httpx.ASGITransport` ile, dependency override OLMADAN sürmek; tek fark
# İP-3'ün `base_url`'ünün `http://ip3.test` olmasıydı ve hiçbir test buna
# bakmıyor (İP-3'ün WS testi kendi ASGI scope'unu elle kuruyor).


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
    # Varyant grupları (Faz 1): grup satırı sızarsa admin grup listesi ve
    # gelecekteki varyant seçici test artıklarıyla dolar.
    "variant_groups",
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
    # F30 — paketleme. `package_scan_events` append-only'dir: sizan bir satır
    # teardown'da SİLİNEMEZ, o yüzden nöbetçide olması şart (aksi hâlde iz
    # tablosu sessizce ve geri dönülemez biçimde şişer).
    "order_packages",
    "order_package_items",
    "package_scan_events",
    "clients",
    "admins",
    # Servisler audit yazabildiği için testler de yazar; korumasız bırakılmaz.
    "audit_logs",
    # Testler kendi admin rollerini yaratiyor; birikirlerse /yonetim rol
    # yonetimi ekrani yuzlerce E7_XXXX / EO_XXXX rolüyle dolar.
    "admin_roles",
    "admin_role_permissions",
    "admin_role_assignments",
    # İP-3: `POST /libraries/register` tek istekte kütüphane + operatör +
    # refresh token satırı üretir. Bu üçü nöbetçide YOKTU — kayıt akışını
    # süren bir test teardown'ı unutsa sızıntı SESSİZ kalırdı (F29'da
    # `audit_logs` ile yaşanan hatanın aynısı). Kayıt yüzeyi artık
    # korumasız değil.
    "libraries",
    "library_operators",
    "refresh_tokens",
    # Tedarikçi senkronu: `supplier_products` her turda favori listesi kadar
    # satır upsert eder. Sızan bir test satırı yalnız tabloyu şişirmez —
    # `supplier_backed` bir üründe açıksa VİTRİNDE "stokta" gösterir. Bu yüzden
    # nöbetçide. (`suppliers` tek satırlık bir ayar tablosu ama fabrika seed
    # satırını soft-delete edip geri açıyor; sayı sabit kalmalı.)
    "suppliers",
    "supplier_products",
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
    # TB-21: gerçek ödeme sağlayıcısıyla koşulmaz. Session kapsamlı + autouse
    # olduğu için bu kontrol BÜTÜN entegrasyon suite'ini kapsar; tek tek
    # testlere güvenmek, sağlayıcıyı fixture'dan almayan yolları açıkta
    # bırakırdı (boşluğun ölçüldüğü yer tam olarak orasıydı).
    assert_fake_payment_provider()
    # TB-28: Redis'in de `db_guard` karşılığı olur. Aynı yerde ve aynı
    # kapsamda: geliştirme Redis'i yalnız önbellek değildir — presence,
    # rate-limit sayaçları ve token denylist'i oradadır; testin yazdığı bir
    # satır gerçek bir oturumu geri açabilir ya da gerçek kullanıcıya 429
    # yedirebilir.
    assert_test_redis()
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


def _nobetci_duyur(mesaj: str) -> None:
    """Nöbetçinin kararını stderr'e de yazar — özet satırında KAYBOLMASIN.

    Neden gerekli (1 Ağu 2026'da bizzat yaşandı): bir testin KENDİ teardown'ı da
    hata verirse pytest, session nöbetçisinin `Failed`'ini o hatayla birlikte bir
    ``BaseExceptionGroup`` içine sarar ve `-q` özet satırında yalnız

        ERROR ... - BaseExceptionGroup: errors during test teardown (2 sub-exceptions)

    görünür. Karar gövdede durur ama özete bakan (ve çıktıyı tarayan) gözden
    kaçar: bu yüzden bir denetim turunda "nöbetçi sızıntıyı kaçırdı" diye YANLIŞ
    rapor edildi — oysa nöbetçi doğru çalışıyordu. Karar artık ayrıca ham
    stderr'e basılır; hiçbir sarmalayıcı onu gizleyemez.
    """
    sys.stderr.write(f"\n[HİJYEN NÖBETÇİSİ] {mesaj}\n")
    sys.stderr.flush()


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
        mesaj = (
            "hijyen nöbetçisi ÖLÇEMEDİ; suite temiz sayılamaz: "
            f"{exc.__class__.__name__}: {exc}"
        )
        _nobetci_duyur(mesaj)
        pytest.fail(mesaj)
    artan = {t: (once[t], sonra[t]) for t in once if sonra[t] != once[t]}
    if artan:
        ayrinti = ", ".join(f"{t}: {a}→{b}" for t, (a, b) in sorted(artan.items()))
        mesaj = "TEST İZOLASYONU BOZUK — suite kalıcı satır bıraktı: " + ayrinti
        _nobetci_duyur(mesaj)
        pytest.fail(mesaj, pytrace=False)
