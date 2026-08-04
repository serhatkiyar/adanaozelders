"""İP-1a ders para yolu test fabrikası — GERÇEK üretim yolundan para üretir.

## Neden `MoneyFactory`'nin yanına ayrı bir fabrika

`tests/integration/conftest.py::MoneyFactory` `Payment` satırını **elle INSERT
eder**. Bu, escrow yarış testleri için yeterlidir (orada başlangıç durumu
verilidir, ilgi yarışın kendisindedir) ama İP-1a'nın sorduğu soru başkadır:

> "Emanetteki para gerçekten oraya **üretim kodunun koyduğu gibi** mi geldi,
> ve terminal geçişte oradan çıkabiliyor mu?"

Elle yazılmış bir `status=HELD` satırı bu soruyu **cevaplayamaz**: `accept`
hook'unu (`booking_service.py:427` → `create_for_booking`), komisyon oranının
eğitmene özel hesabını (`commission.rate_for`) ve `pay`'in atomik claim'ini
(`payment_service.py:170-180`) atlar. Bu fabrika o üç adımı **gerçekten koşturur**:

    Booking(PENDING)  ──booking_service.accept──►  Payment PENDING
                      ──payment_service.pay────►  Payment HELD (+paid_at, +provider_ref)

Yalnız `Booking` satırının kendisi modelden kurulur; sebebi zaman kontrolüdür:
`booking_service.create_booking` geçmişe rezervasyonu 400 ile reddeder
(`booking_service.py:191-194`) ve auto-complete senaryoları **geçmişte biten**
bir derse ihtiyaç duyar. Zamanı test kurulumu olarak açıkça vermek, para
durumunu sahtelemekten farklıdır: burada sahtelenen bir para durumu yoktur.

## Temizlik sözleşmesi

Fabrika YALNIZ kendi ürettiği ID'leri siler; global TRUNCATE, trigger devre
dışı bırakma veya append-only bypass yoktur. Teardown `try/finally` ile bağlanır
(bkz. `conftest.py::MoneyFactory`), böylece test kırmızıyken de koşar.

DİKKAT: `conftest.py::_KRITIK_TABLOLAR` hijyen nöbetçisi `bookings`/`payments`/
`tutors` saymaz — bu fabrikanın sızıntısı **otomatik yakalanmaz**. Bu yüzden
`cleanup` FK sırasına harfiyen uyar ve `sizinti_var_mi()` ile kendi kendini
doğrulayabilir hâle getirilmiştir (bkz. `test_ip1a_factory_hygiene_pg.py`).
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
from models.payment import Payment, PaymentStatus
from models.tutor import Tutor, TutorStatus
from schemas.admin_access import AdminRoleCreate
from services import admin_access_service, booking_service, payment_service


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


def auth_header(
    user_id: int, role: str, role_id: int, auth_version: int
) -> dict[str, str]:
    """Gerçek imzalı JWT ile Authorization başlığı (`core.security` üretir).

    `auth_version` İP-3 §6'dan sonra ZORUNLUDUR ve **gerçek satırdan** gelir:
    `get_current_user` claim'i bütün rollerde denetler, claim'siz token her uçta
    401 alır. Varsayılan değer bilinçli olarak YOK — varsayılan koymak, çağıranın
    gerçek sürümü geçirmeyi unutmasını sessiz bir yanlış-yeşile çevirirdi.
    """
    token = create_access_token(
        subject=user_id, role=role, role_id=role_id, auth_version=auth_version
    )
    return {"Authorization": f"Bearer {token}"}


# ── Fixture'lar (test modüllerine `from ... import ip1a, http` ile taşınır) ──


@pytest.fixture
async def ip1a(pg):
    """Fabrika + garantili teardown.

    `try/finally`: test KIRMIZIYKEN de temizlik koşmalıdır, aksi halde ilk
    kırmızı koşuda satırlar kalır ve sonraki koşumlar kirli zeminde başlar.
    `pg`'ye bağlı olduğu için teardown sırası doğrudur (önce fabrika, sonra
    `engine.dispose()`).
    """
    f = Ip1aFabrika()
    try:
        yield f
    finally:
        await f.cleanup()


@pytest.fixture
async def ip1a_http():
    """GERÇEK FastAPI uygulaması, gerçek yetki zinciri, gerçek `get_db`.

    `ASGITransport` uygulamayı testin event loop'unda koşturur (asyncpg
    bağlantıları loop'a bağlıdır) ve **lifespan çalıştırmaz** — yani arka plan
    döngüleri (hatırlatma, escrow mutabakatı) teste karışmaz. Testin ölçtüğü
    her şey isteğin kendi yaptığıdır.

    `app.dependency_overrides` bilinçli olarak KULLANILMAZ: yetki çözümü
    override edilirse ölçtüğümüz şey uygulamanın değil, kendi mock'umuzun
    davranışı olur.
    """
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class Ders:
    """Bir test dersinin kimlikleri + kolay HTTP başlıkları."""

    # Oturum sürümleri de taşınır: başlık üreten property'ler `async` olamaz,
    # dolayısıyla değeri istek anında DB'den okuyamazlar. Satırlar zaten bu
    # fabrikada yaratıldığı için sürüm ORADA yakalanır (bkz. `ders()`).
    __slots__ = (
        "tutor_id",
        "client_id",
        "booking_id",
        "amount",
        "tutor_auth_version",
        "client_auth_version",
    )

    def __init__(
        self,
        *,
        tutor_id: int,
        client_id: int,
        booking_id: int,
        amount: Decimal,
        tutor_auth_version: int,
        client_auth_version: int,
    ) -> None:
        self.tutor_id = tutor_id
        self.client_id = client_id
        self.booking_id = booking_id
        self.amount = amount
        self.tutor_auth_version = tutor_auth_version
        self.client_auth_version = client_auth_version

    @property
    def tutor_auth(self) -> dict[str, str]:
        return auth_header(self.tutor_id, "TUTOR", 2, self.tutor_auth_version)

    @property
    def client_auth(self) -> dict[str, str]:
        return auth_header(self.client_id, "CLIENT", 3, self.client_auth_version)


class Ip1aFabrika:
    """İP-1a ders para senaryolarının kurucu fabrikası."""

    def __init__(self) -> None:
        self.tutor_ids: list[int] = []
        self.client_ids: list[int] = []
        self.booking_ids: list[int] = []
        self.admin_ids: list[int] = []
        self.admin_role_ids: list[int] = []

    # ── Ders kurulumu ────────────────────────────────────────────────────────

    async def _taraflar(self, s) -> tuple[Tutor, Client]:
        u = _uniq()
        tutor = Tutor(
            email=f"t-{u}@ip1a.test",
            hashed_password="test-only",
            first_name="Ip1a",
            last_name="Egitmen",
            username=f"ip1at{u}",
            role_id=2,
            status=TutorStatus.APPROVED,
            hourly_rate=Decimal("500"),
        )
        client = Client(
            email=f"c-{u}@ip1a.test",
            hashed_password="test-only",
            first_name="Ip1a",
            last_name="Ogrenci",
            username=f"ip1ac{u}",
            role_id=3,
            # `POST /bookings` ve `/payments/.../pay` telefon doğrulaması ister
            # (phone_service.require_phone_verified). Doldurulmazsa HTTP testleri
            # 403 alır ve bu YANLIŞ bir kırmızı olurdu.
            phone=f"+90555{u[:7]}",
            phone_verified_at=_now(),
        )
        s.add_all([tutor, client])
        await s.flush()
        return tutor, client

    async def ders(
        self,
        *,
        start_at: datetime.datetime | None = None,
        hours: int = 1,
        hourly_rate: Decimal = Decimal("500"),
    ) -> Ders:
        """PENDING bir ders üretir (henüz ödeme kaydı yoktur — accept doğurur)."""
        start = start_at if start_at is not None else _now() + datetime.timedelta(days=30)
        amount = (hourly_rate * hours).quantize(Decimal("0.01"))
        async with AsyncSessionLocal() as s:
            tutor, client = await self._taraflar(s)
            tutor.hourly_rate = hourly_rate
            booking = Booking(
                tutor_id=tutor.id,
                client_id=client.id,
                status=BookingStatus.PENDING,
                start_at=start,
                end_at=start + datetime.timedelta(hours=hours),
                price=amount,
                mode="ONLINE",
            )
            s.add(booking)
            await s.flush()
            ders = Ders(
                tutor_id=tutor.id,
                client_id=client.id,
                booking_id=booking.id,
                amount=amount,
                # Sabit `1` YAZILMAZ: satır burada yaratıldığı için gerçek
                # sürüm elimizde; sabit yazmak sürüm artıran bir senaryo
                # eklendiği gün testi sessizce yanlış-yeşile çevirirdi.
                tutor_auth_version=tutor.auth_version,
                client_auth_version=client.auth_version,
            )
            await s.commit()
        self.tutor_ids.append(ders.tutor_id)
        self.client_ids.append(ders.client_id)
        self.booking_ids.append(ders.booking_id)
        return ders

    async def kabul_edilmis(self, **kw) -> Ders:
        """ACCEPTED ders + PENDING ödeme — `booking_service.accept` GERÇEKTEN koşar."""
        ders = await self.ders(**kw)
        async with AsyncSessionLocal() as s:
            booking = await s.get(Booking, ders.booking_id)
            await booking_service.accept(s, booking)
            await s.commit()
        return ders

    async def odenmis(self, **kw) -> Ders:
        """ACCEPTED ders + HELD ödeme — `payment_service.pay` GERÇEKTEN koşar.

        `pay` sağlayıcıyı `payments.get_payment_provider()` üzerinden çağırır;
        `provider` fixture'ı yamalıysa emanet o stub'ın `charge`'ıyla kurulur.
        """
        ders = await self.kabul_edilmis(**kw)
        async with AsyncSessionLocal() as s:
            booking = await s.get(Booking, ders.booking_id)
            await payment_service.pay(s, booking)
            await s.commit()
        return ders

    # ── Zaman kurulumu (para durumuna DOKUNMAZ) ──────────────────────────────

    async def zamani_kaydir(self, booking_id: int, *, delta: datetime.timedelta) -> None:
        """Dersin saatini kaydırır. Yalnız `start_at`/`end_at`; para alanlarına
        dokunmaz. Geçmişte biten ders kurmak için (auto-complete senaryoları)."""
        async with AsyncSessionLocal() as s:
            await s.execute(
                text(
                    "UPDATE bookings SET start_at = start_at + make_interval(secs => :s), "
                    "end_at = end_at + make_interval(secs => :s) WHERE id = :i"
                ),
                {"s": delta.total_seconds(), "i": booking_id},
            )
            await s.commit()

    async def terminal_yap(self, booking_id: int, status: BookingStatus) -> None:
        """Booking'i doğrudan terminal duruma çeker — ödemeye DOKUNMAZ.

        Bu bir para sahtelemesi DEĞİLDİR: emanet zaten üretim yolundan
        (`accept` + `pay`) gelmiştir; burada yalnız dersin kaderi kurulur.

        Neden doğrudan: sahipsiz emanetin reconciler tarafından görülmesi
        (P0-5), onu ÜRETEN yollardan (P0-1 red, P0-2 admin iptali) bağımsız bir
        güvenlik ağıdır. Kurulum o yollara bağlanırsa, onlar düzeltilir
        düzeltilmez bu ağ testsiz kalır — oysa geçmişte oluşmuş satırlar ve
        henüz bilinmeyen yollar için ağ hâlâ gereklidir.
        """
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("UPDATE bookings SET status = :s WHERE id = :i"),
                {"s": status.value, "i": booking_id},
            )
            await s.commit()

    async def eskit(self, booking_id: int, *, delta: datetime.timedelta) -> None:
        """Kaydı geçmişe taşır (karantina penceresi dolsun diye).

        `updated_at` hem ödemede hem booking'te geriye alınır; mutabakatın
        hangisini ölçüt aldığı bir uygulama ayrıntısıdır ve test onu
        sabitlemez.

        Aralık `make_interval(secs => ...)` ile verilir: `sütun - :param`
        biçiminde bir timedelta bağlanınca asyncpg parametreyi `timestamptz`
        çıkarsayabiliyor ve `timestamptz - timestamptz = interval` sonucu
        kolona yazılamıyor (`DatatypeMismatchError`). Bu tuzağa bir kez düşüldü.
        """
        saniye = delta.total_seconds()
        async with AsyncSessionLocal() as s:
            await s.execute(
                text(
                    "UPDATE payments SET "
                    "updated_at = updated_at - make_interval(secs => :s), "
                    "created_at = created_at - make_interval(secs => :s), "
                    "paid_at = paid_at - make_interval(secs => :s), "
                    # `escrow.next_refund_action` karantinayı `refund_requested_at`
                    # üzerinden ölçer (escrow.py:373); bunu kaydırmayan bir
                    # "eskitme" sarkan REFUNDING kayıtlarını asla uygun hâle
                    # getirmez ve test sessizce ACTION_WAIT'te takılır.
                    "refund_requested_at = "
                    "refund_requested_at - make_interval(secs => :s) "
                    "WHERE booking_id = :i"
                ),
                {"s": saniye, "i": booking_id},
            )
            await s.execute(
                text(
                    "UPDATE bookings SET "
                    "updated_at = updated_at - make_interval(secs => :s), "
                    "created_at = created_at - make_interval(secs => :s) "
                    "WHERE id = :i"
                ),
                {"s": saniye, "i": booking_id},
            )
            await s.commit()

    # ── Admin (gerçek rol + gerçek izin) ─────────────────────────────────────

    async def admin(self, *, izinler: list[str]) -> tuple[int, dict[str, str]]:
        """Gerçek admin + gerçek rol-izin satırları; token gerçek imzayla üretilir.

        İzin katalogdan okunur (`admin_access_service`); SUPER_ADMIN bypass'ı
        yoktur, yani izin listesi gerçekten belirleyicidir.
        """
        ek = _uniq()
        async with AsyncSessionLocal() as s:
            a = Admin(
                email=f"ip1a-{ek}@test.local",
                hashed_password="test-only",
                first_name="Ip1a",
                last_name="Yonetici",
                username=f"ip1aa{ek}",
                role_id=1,
            )
            s.add(a)
            await s.flush()
            rol = await admin_access_service.create_role(
                s,
                AdminRoleCreate(
                    code=f"IP1A_{ek.upper()}",
                    name="Ip1a Denetim",
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

    async def payment(self, booking_id: int) -> Payment | None:
        """Ödemeyi YENİ bir session ile okur.

        Aynı session'dan okumak `expire_on_commit=False` yüzünden bayat nesne
        döndürür ve `escrow.claim`'in koşullu UPDATE'i ORM'e yansımaz — testin
        gözlemi sessizce yalan olurdu.
        """
        async with AsyncSessionLocal() as s:
            return (
                await s.execute(
                    Payment.__table__.select().where(
                        Payment.__table__.c.booking_id == booking_id
                    )
                )
            ).mappings().first()

    async def durumlar(self, booking_id: int) -> tuple[BookingStatus, PaymentStatus | None]:
        """(booking.status, payment.status) — tek atışta, taze."""
        async with AsyncSessionLocal() as s:
            booking = await s.get(Booking, booking_id)
            row = (
                await s.execute(
                    text("SELECT status FROM payments WHERE booking_id = :i"),
                    {"i": booking_id},
                )
            ).scalar_one_or_none()
        return booking.status, (PaymentStatus(row) if row is not None else None)

    async def bildirim_sayisi(self, *, user_id: int, role_id: int) -> int:
        async with AsyncSessionLocal() as s:
            return int(
                (
                    await s.execute(
                        text(
                            "SELECT count(*) FROM notifications "
                            "WHERE user_id = :u AND role_id = :r"
                        ),
                        {"u": user_id, "r": role_id},
                    )
                ).scalar_one()
            )

    async def bildirimler(self, *, user_id: int, role_id: int) -> list[tuple[int, str]]:
        """Kullanıcıya yazılan bildirimler: (id, metin), eskiden yeniye.

        Sayı tek başına zayıf bir ölçüttür: "iki bildirim gitti" iddiası,
        birleşik tek bir mesajın da meşru olduğu yerlerde uygulamayı gereksiz
        yere kilitler. İçeriğe bakan invariant ("para/iade anlamı taşıyan en az
        bir bildirim doğru kullanıcıya gitti") hem daha güçlü hem daha adildir.

        `id` bilinçli olarak döner: "yeni gelenler"i metin kümesi farkıyla bulmak
        AYNI metnin ikinci kez yazıldığı hâlleri görünmez kılardı.
        """
        async with AsyncSessionLocal() as s:
            return [
                (int(r[0]), r[1])
                for r in (
                    await s.execute(
                        text(
                            "SELECT id, message FROM notifications "
                            "WHERE user_id = :u AND role_id = :r ORDER BY id"
                        ),
                        {"u": user_id, "r": role_id},
                    )
                ).all()
            ]

    async def audit_sayisi(self, *, target_id: int, action: str) -> int:
        async with AsyncSessionLocal() as s:
            return int(
                (
                    await s.execute(
                        text(
                            "SELECT count(*) FROM audit_logs WHERE target_type = 'booking'"
                            " AND target_id = :t AND action = :a"
                        ),
                        {"t": target_id, "a": action},
                    )
                ).scalar_one()
            )

    async def tutor_hakedisi(self, tutor_id: int) -> Decimal:
        """Eğitmenin HAK EDİLMİŞ (RELEASED) ders kazancı.

        `payout_ledger` yalnız `RELEASED` ödemeleri `earned` sayar
        (`services/payout_ledger.py:96-107`); `HELD` "pending"dir ve borca
        girmez. Yani bu değerin 0 olması "payout oluşmadı"nın gerçek ölçüsüdür —
        `payment.status` okumasının tekrarı değil, defterin kendi cevabıdır.
        """
        from services import payout_ledger

        async with AsyncSessionLocal() as s:
            bakiye = await payout_ledger.balance_for(
                s, payee_type="TUTOR", payee_id=tutor_id
            )
        # Defterde hiç görünmemek = hiç hak ediş yok. `balance_for` yalnız
        # RELEASED/HELD ödemesi olan tedarikçileri listeler, iade edilmiş bir
        # ders eğitmeni listeden tamamen düşürür (`payout_ledger.py:96`).
        return Decimal("0.00") if bakiye is None else bakiye.earned

    # ── Temizlik ─────────────────────────────────────────────────────────────

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            # Bildirimler: accept/pay/complete/cancel hook'ları her iki tarafa yazar.
            await s.execute(
                text(
                    "DELETE FROM notifications WHERE (role_id = 2 AND user_id = ANY(:t))"
                    " OR (role_id = 3 AND user_id = ANY(:c))"
                ),
                {"t": self.tutor_ids or [0], "c": self.client_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM payments WHERE booking_id = ANY(:i)"),
                {"i": self.booking_ids or [0]},
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
            # Admin zinciri: audit → atama → rol-izin → rol → admin.
            # `audit_logs` hijyen nöbetçisinde SAYILIR; burada bırakılan tek satır
            # bütün suite'i kırar (bilinçli — sessiz birikme F29'da yaşandı).
            if self.admin_ids:
                await s.execute(
                    text(
                        "DELETE FROM audit_logs WHERE actor_id = ANY(:i) AND actor_role = 1"
                    ),
                    {"i": self.admin_ids},
                )
                await s.execute(
                    text("DELETE FROM admin_role_assignments WHERE admin_id = ANY(:i)"),
                    {"i": self.admin_ids},
                )
            if self.admin_role_ids:
                await s.execute(
                    text(
                        "DELETE FROM admin_role_permissions WHERE admin_role_id = ANY(:i)"
                    ),
                    {"i": self.admin_role_ids},
                )
                await s.execute(
                    text("DELETE FROM admin_roles WHERE id = ANY(:i)"),
                    {"i": self.admin_role_ids},
                )
            if self.admin_ids:
                await s.execute(
                    text("DELETE FROM admins WHERE id = ANY(:i)"),
                    {"i": self.admin_ids},
                )
            await s.commit()

    async def sizinti_var_mi(self) -> dict[str, int]:
        """Temizlikten sonra bu fabrikanın ID'lerinden geriye kalan var mı?

        Hijyen nöbetçisi `bookings`/`payments`/`tutors` saymadığı için bu
        fabrikanın sızıntısı otomatik yakalanmaz; bu yöntem o boşluğu ID
        bazında kapatır.
        """
        sorgular = {
            "payments": ("SELECT count(*) FROM payments WHERE booking_id = ANY(:i)", self.booking_ids),
            "bookings": ("SELECT count(*) FROM bookings WHERE id = ANY(:i)", self.booking_ids),
            "tutors": ("SELECT count(*) FROM tutors WHERE id = ANY(:i)", self.tutor_ids),
            "clients": ("SELECT count(*) FROM clients WHERE id = ANY(:i)", self.client_ids),
            "admins": ("SELECT count(*) FROM admins WHERE id = ANY(:i)", self.admin_ids),
            "admin_roles": ("SELECT count(*) FROM admin_roles WHERE id = ANY(:i)", self.admin_role_ids),
        }
        kalan: dict[str, int] = {}
        async with AsyncSessionLocal() as s:
            for ad, (sql, ids) in sorgular.items():
                n = int((await s.execute(text(sql), {"i": ids or [0]})).scalar_one())
                if n:
                    kalan[ad] = n
        return kalan
