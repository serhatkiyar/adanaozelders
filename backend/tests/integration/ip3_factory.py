"""İP-3 (yetki / kişisel veri / hesap güvenliği) test fabrikası — GERÇEK Postgres.

Bu dosya SimpleNamespace veya stub KULLANMAZ. Her kullanıcı gerçek tabloya
yazılır, her token gerçek imzayla üretilir, her "ilişki" (rezervasyon, deneme
kaydı, çalışma rezervasyonu, değerlendirme) gerçek satırdır. Sebep somut: bu
işteki bulguların tamamı **yetki kararının hangi satıra baktığı** ile ilgili;
sahte nesnelerle kurulan bir kurulum tam da ölçmek istediğimiz şeyi atlar.

Teardown FİZİKSEL siler. `tests/integration/conftest.py::_hijyen_nobetcisi`
suite sonunda `clients`, `admins`, `audit_logs`, `admin_roles` sayılarını
karşılaştırdığı için eksik temizlik suite'i kırar — bu bilinçlidir.
"""
from __future__ import annotations

import datetime
import uuid
from decimal import Decimal

from sqlalchemy import text

from core.database import AsyncSessionLocal
from core.security import create_access_token, hash_password_async
from models.admin import Admin
from models.booking import Booking, BookingStatus
from models.client import Client
from models.courier import Courier
from models.courier_account import CourierAccount
from models.library import Library, LibraryStatus
from models.library_exam import ExamRegistration, LibraryExamSession
from models.library_operator import LibraryOperator
from models.review import Review
from models.role import ROLE_IDS, RoleType
from models.study_reservation import StudyReservation
from models.tutor import Tutor, TutorEducation, TutorStatus
from schemas.admin_access import AdminRoleCreate
from services import admin_access_service

#: ⚠️ E-posta alan adları `.test` DEĞİL: `pydantic.EmailStr` (email-validator)
#: `.test`/`.invalid`/`.localhost` gibi rezerve TLD'leri REDDEDER. Bu tuzağa
#: bir kez düşüldü — `/auth/password-reset/request` 422 dönüyordu ve test
#: üretim hatası sanılıyordu. `.example.com` hem rezerve (RFC 2606) hem geçerli.
#:
#: Fabrikanın kurduğu her hesabın parolası (gerçek bcrypt hash'i yazılır —
#: `/auth/me/password` ve `/auth/me/delete` parolayı GERÇEKTEN doğrular).
PAROLA = "ip3-gizli-sifre-123"

_ROLE_NAME = {
    ROLE_IDS[RoleType.ADMIN]: RoleType.ADMIN.value,
    ROLE_IDS[RoleType.TUTOR]: RoleType.TUTOR.value,
    ROLE_IDS[RoleType.CLIENT]: RoleType.CLIENT.value,
    ROLE_IDS[RoleType.LIBRARY_OPERATOR]: RoleType.LIBRARY_OPERATOR.value,
    ROLE_IDS[RoleType.COURIER]: RoleType.COURIER.value,
}


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


def yetki_basligi(user) -> dict[str, str]:
    """Kullanıcı için GERÇEK imzalı access token başlığı.

    ``auth_version`` taşıyan hesaplarda claim de konur; taşımayanlarda konmaz —
    yani token sözleşmesi üretimdeki `login` akışının birebir aynısıdır.
    """
    token = create_access_token(
        subject=user.id,
        role=_ROLE_NAME[user.role_id],
        role_id=user.role_id,
        auth_version=getattr(user, "auth_version", None),
    )
    return {"Authorization": f"Bearer {token}"}


class IP3Fabrika:
    """Gerçek roller + gerçek ilişkiler + gerçek kısıtlar."""

    def __init__(self) -> None:
        self.client_ids: list[int] = []
        self.tutor_ids: list[int] = []
        self.admin_ids: list[int] = []
        self.admin_role_ids: list[int] = []
        self.library_ids: list[int] = []
        self.operator_ids: list[int] = []
        self.courier_ids: list[int] = []
        self.courier_account_ids: list[int] = []
        self.booking_ids: list[int] = []
        self.exam_session_ids: list[int] = []

    # ── Kullanıcılar ────────────────────────────────────────────────────────

    async def client(
        self,
        *,
        phone_verified: bool = True,
        birth_date: datetime.date | None = datetime.date(2008, 5, 17),
    ) -> Client:
        u = _uniq()
        async with AsyncSessionLocal() as s:
            c = Client(
                email=f"ip3c-{u}@ip3ogrenci.example.com",
                hashed_password=await hash_password_async(PAROLA),
                first_name="Ogrenci",
                last_name=f"IP3{u[:4]}",
                username=f"ip3c{u}",
                role_id=ROLE_IDS[RoleType.CLIENT],
                birth_date=birth_date,
                phone="+905321112233" if phone_verified else None,
                phone_verified_at=_now() if phone_verified else None,
            )
            s.add(c)
            await s.commit()
            await s.refresh(c)
            s.expunge(c)
        self.client_ids.append(c.id)
        return c

    async def tutor(
        self,
        *,
        status: TutorStatus = TutorStatus.APPROVED,
        phone_verified: bool = True,
        with_identity: bool = False,
    ) -> Tutor:
        """`with_identity=True`: KVKK silme testinin aradığı kimlik verisini de yazar
        (IBAN, kimlik son4, ödeme durumu, diploma + e-Devlet TCKN'si)."""
        u = _uniq()
        async with AsyncSessionLocal() as s:
            t = Tutor(
                email=f"ip3t-{u}@ip3egitmen.example.com",
                hashed_password=await hash_password_async(PAROLA),
                first_name="Egitmen",
                last_name=f"IP3{u[:4]}",
                username=f"ip3t{u}",
                role_id=ROLE_IDS[RoleType.TUTOR],
                status=status,
                hourly_rate=Decimal("400"),
                phone="+905331112233" if phone_verified else None,
                phone_verified_at=_now() if phone_verified else None,
            )
            if with_identity:
                t.iban = "TR330006100519786457841326"
                t.identity_last4 = "1234"
                t.payout_status = "ACTIVE"
                t.sub_merchant_key = f"submerchant-{u}"
            s.add(t)
            await s.flush()
            if with_identity:
                s.add(
                    TutorEducation(
                        tutor_id=t.id,
                        school_name="IP3 Universitesi",
                        degree="Lisans",
                        document_url="private/diplomas/ip3-diploma.pdf",
                        document_name="diploma.pdf",
                        document_type="DIPLOMA",
                        verification_code="ABC123XYZ",
                        verification_tckn="12345678901",
                        verification_status="VERIFIED",
                    )
                )
            await s.commit()
            await s.refresh(t)
            s.expunge(t)
        self.tutor_ids.append(t.id)
        return t

    async def admin(self, *, permissions: list[str] | None = None) -> Admin:
        """Gerçek admin + gerçek görev rolü + gerçek izin satırları."""
        u = _uniq()
        async with AsyncSessionLocal() as s:
            a = Admin(
                email=f"ip3a-{u}@ip3yonetim.example.com",
                hashed_password=await hash_password_async(PAROLA),
                first_name="Yonetici",
                last_name=f"IP3{u[:4]}",
                username=f"ip3a{u}",
                role_id=ROLE_IDS[RoleType.ADMIN],
            )
            s.add(a)
            await s.flush()
            rol = await admin_access_service.create_role(
                s,
                AdminRoleCreate(
                    code=f"IP3_{u.upper()}",
                    name="IP3 Denetim",
                    permission_codes=permissions or [],
                ),
            )
            await admin_access_service.assign_role(
                s, admin_id=a.id, role_id=rol.id, assigned_by_admin_id=a.id
            )
            await s.commit()
            await s.refresh(a)
            s.expunge(a)
            self.admin_role_ids.append(rol.id)
        self.admin_ids.append(a.id)
        return a

    async def library(self, *, status: str = LibraryStatus.ACTIVE.value) -> Library:
        u = _uniq()
        async with AsyncSessionLocal() as s:
            lib = Library(
                name=f"IP3 Kutuphane {u}",
                slug=f"ip3-kutuphane-{u}",
                status=status,
                capacity=20,
                study_hourly_price=Decimal("50"),
            )
            s.add(lib)
            await s.commit()
            await s.refresh(lib)
            s.expunge(lib)
        self.library_ids.append(lib.id)
        return lib

    async def operator(
        self, library: Library, *, phone_verified: bool = True
    ) -> LibraryOperator:
        u = _uniq()
        async with AsyncSessionLocal() as s:
            op = LibraryOperator(
                email=f"ip3o-{u}@ip3kutuphane.example.com",
                hashed_password=await hash_password_async(PAROLA),
                first_name="Operator",
                last_name=f"IP3{u[:4]}",
                username=f"ip3o{u}",
                role_id=ROLE_IDS[RoleType.LIBRARY_OPERATOR],
                library_id=library.id,
                phone="+905341112233" if phone_verified else None,
                phone_verified_at=_now() if phone_verified else None,
            )
            s.add(op)
            await s.commit()
            await s.refresh(op)
            s.expunge(op)
        self.operator_ids.append(op.id)
        return op

    async def courier_account(self) -> CourierAccount:
        u = _uniq()
        async with AsyncSessionLocal() as s:
            c = Courier(name=f"IP3 Kurye {u}", is_active=True)
            s.add(c)
            await s.flush()
            self.courier_ids.append(c.id)
            acc = CourierAccount(
                email=f"ip3k-{u}@ip3kurye.example.com",
                hashed_password=await hash_password_async(PAROLA),
                first_name="Kurye",
                last_name=f"IP3{u[:4]}",
                username=f"ip3k{u}",
                role_id=ROLE_IDS[RoleType.COURIER],
                courier_id=c.id,
            )
            s.add(acc)
            await s.commit()
            await s.refresh(acc)
            s.expunge(acc)
        self.courier_account_ids.append(acc.id)
        return acc

    # ── İlişkiler ───────────────────────────────────────────────────────────

    async def booking(
        self,
        tutor: Tutor,
        client: Client,
        *,
        status: BookingStatus = BookingStatus.COMPLETED,
        gecmis: bool = True,
    ) -> Booking:
        async with AsyncSessionLocal() as s:
            start = _now() + datetime.timedelta(days=-7 if gecmis else 7)
            b = Booking(
                tutor_id=tutor.id,
                client_id=client.id,
                status=status,
                start_at=start,
                end_at=start + datetime.timedelta(hours=1),
                price=Decimal("400.00"),
                mode="ONLINE",
            )
            s.add(b)
            await s.commit()
            await s.refresh(b)
            s.expunge(b)
        self.booking_ids.append(b.id)
        return b

    async def review(self, booking: Booking, *, rating: int = 5) -> Review:
        async with AsyncSessionLocal() as s:
            r = Review(
                booking_id=booking.id,
                client_id=booking.client_id,
                tutor_id=booking.tutor_id,
                rating=rating,
                comment_text="IP3 test yorumu",
            )
            s.add(r)
            await s.commit()
            await s.refresh(r)
            s.expunge(r)
        return r

    async def exam_session(
        self,
        library: Library,
        *,
        answer_key_url: str | None = "private/answer-keys/ip3-cevap-anahtari.pdf",
        results_published: bool = True,
        gelecek: bool = True,
    ) -> LibraryExamSession:
        """`gelecek=True` oturumu public listeye sokar (`starts_at >= now` filtresi).

        Sonuçları yayınlanmış bir oturumun ileri tarihe alınması gerçek bir
        operasyon durumudur (erteleme); public sızıntı yüzeyi tam olarak budur.
        """
        u = _uniq()
        async with AsyncSessionLocal() as s:
            sess = LibraryExamSession(
                library_id=library.id,
                exam_type="TYT",
                title=f"IP3 Deneme {u}",
                starts_at=_now() + datetime.timedelta(days=3 if gelecek else -3),
                duration_minutes=120,
                capacity=50,
                price=Decimal("100.00"),
                currency="TRY",
                status="SCHEDULED",
                answer_key_url=answer_key_url,
                results_published_at=_now() if results_published else None,
            )
            s.add(sess)
            await s.commit()
            await s.refresh(sess)
            s.expunge(sess)
        self.exam_session_ids.append(sess.id)
        return sess

    async def exam_registration(
        self,
        session: LibraryExamSession,
        client: Client,
        *,
        status: str = "PAID",
    ) -> ExamRegistration:
        async with AsyncSessionLocal() as s:
            reg = ExamRegistration(
                session_id=session.id,
                client_id=client.id,
                status=status,
                amount=Decimal("100.00"),
                commission_amount=Decimal("10.00"),
                library_earning=Decimal("90.00"),
                commission_rate=Decimal("0.1000"),
                currency="TRY",
                provider="fake",
                paid_at=_now() if status in {"PAID", "ATTENDED"} else None,
            )
            s.add(reg)
            await s.commit()
            await s.refresh(reg)
            s.expunge(reg)
        return reg

    async def study_reservation(
        self, library: Library, client: Client, *, status: str = "PAID"
    ) -> StudyReservation:
        async with AsyncSessionLocal() as s:
            start = _now() + datetime.timedelta(days=3)
            res = StudyReservation(
                library_id=library.id,
                client_id=client.id,
                status=status,
                starts_at=start,
                ends_at=start + datetime.timedelta(hours=2),
                hourly_price=Decimal("50.00"),
                amount=Decimal("100.00"),
                commission_amount=Decimal("10.00"),
                library_earning=Decimal("90.00"),
                commission_rate=Decimal("0.1000"),
                currency="TRY",
                provider="fake",
                paid_at=_now() if status == "PAID" else None,
            )
            s.add(res)
            await s.commit()
            await s.refresh(res)
            s.expunge(res)
        return res

    # ── Teardown ────────────────────────────────────────────────────────────

    async def cleanup(self) -> None:
        """FİZİKSEL silme. Sıra FK bağımlılığına göre: yaprak → kök."""
        c = self.client_ids or [0]
        t = self.tutor_ids or [0]
        a = self.admin_ids or [0]
        lib = self.library_ids or [0]
        op = self.operator_ids or [0]
        ka = self.courier_account_ids or [0]
        ku = self.courier_ids or [0]
        sess = self.exam_session_ids or [0]
        rol = self.admin_role_ids or [0]

        async with AsyncSessionLocal() as s:
            await s.execute(
                text("DELETE FROM messages WHERE conversation_id IN ("
                     "SELECT id FROM conversations WHERE client_id = ANY(:c) "
                     "OR tutor_id = ANY(:t) OR library_id = ANY(:l))"),
                {"c": c, "t": t, "l": lib},
            )
            await s.execute(
                text("DELETE FROM conversations WHERE client_id = ANY(:c) "
                     "OR tutor_id = ANY(:t) OR library_id = ANY(:l)"),
                {"c": c, "t": t, "l": lib},
            )
            await s.execute(
                text("DELETE FROM notifications WHERE (role_id = 2 AND user_id = ANY(:t))"
                     " OR (role_id = 3 AND user_id = ANY(:c))"
                     " OR (role_id = 4 AND user_id = ANY(:o))"),
                {"t": t, "c": c, "o": op},
            )
            await s.execute(
                text("DELETE FROM study_reservations WHERE library_id = ANY(:l) "
                     "OR client_id = ANY(:c)"),
                {"l": lib, "c": c},
            )
            await s.execute(
                text("DELETE FROM exam_registrations WHERE session_id = ANY(:s) "
                     "OR client_id = ANY(:c)"),
                {"s": sess, "c": c},
            )
            await s.execute(
                text("DELETE FROM library_exam_sessions WHERE id = ANY(:s) "
                     "OR library_id = ANY(:l)"),
                {"s": sess, "l": lib},
            )
            await s.execute(
                text("DELETE FROM library_reviews WHERE library_id = ANY(:l) "
                     "OR client_id = ANY(:c)"),
                {"l": lib, "c": c},
            )
            await s.execute(
                text("DELETE FROM reviews WHERE client_id = ANY(:c) OR tutor_id = ANY(:t)"),
                {"c": c, "t": t},
            )
            await s.execute(
                text("DELETE FROM bookings WHERE client_id = ANY(:c) OR tutor_id = ANY(:t)"),
                {"c": c, "t": t},
            )
            await s.execute(
                text("DELETE FROM tutor_educations WHERE tutor_id = ANY(:t)"), {"t": t}
            )
            await s.execute(
                text("DELETE FROM verification_tokens WHERE (role_id = 2 AND user_id = ANY(:t))"
                     " OR (role_id = 3 AND user_id = ANY(:c))"
                     " OR (role_id = 4 AND user_id = ANY(:o))"
                     " OR (role_id = 5 AND user_id = ANY(:k))"
                     " OR (role_id = 1 AND user_id = ANY(:a))"),
                {"t": t, "c": c, "o": op, "k": ka, "a": a},
            )
            await s.execute(
                text("DELETE FROM refresh_tokens WHERE (role_id = 2 AND user_id = ANY(:t))"
                     " OR (role_id = 3 AND user_id = ANY(:c))"
                     " OR (role_id = 4 AND user_id = ANY(:o))"
                     " OR (role_id = 5 AND user_id = ANY(:k))"
                     " OR (role_id = 1 AND user_id = ANY(:a))"),
                {"t": t, "c": c, "o": op, "k": ka, "a": a},
            )
            await s.execute(
                text("DELETE FROM user_consents WHERE (role_id = 2 AND user_id = ANY(:t))"
                     " OR (role_id = 3 AND user_id = ANY(:c))"
                     " OR (role_id = 4 AND user_id = ANY(:o))"
                     " OR (role_id = 5 AND user_id = ANY(:k))"),
                {"t": t, "c": c, "o": op, "k": ka},
            )
            # Testlerin ürettiği denetim izleri (hijyen nöbetçisi audit_logs'u sayar).
            await s.execute(
                text("DELETE FROM audit_logs WHERE actor_id = ANY(:a) AND actor_role = 1"),
                {"a": a},
            )
            await s.execute(
                text("DELETE FROM audit_logs WHERE actor_role = 4 AND actor_id = ANY(:o)"),
                {"o": op},
            )
            await s.execute(
                text("DELETE FROM courier_accounts WHERE id = ANY(:k)"), {"k": ka}
            )
            await s.execute(text("DELETE FROM couriers WHERE id = ANY(:u)"), {"u": ku})
            await s.execute(
                text("DELETE FROM library_operators WHERE id = ANY(:o)"), {"o": op}
            )
            await s.execute(text("DELETE FROM libraries WHERE id = ANY(:l)"), {"l": lib})
            await s.execute(text("DELETE FROM tutors WHERE id = ANY(:t)"), {"t": t})
            await s.execute(text("DELETE FROM clients WHERE id = ANY(:c)"), {"c": c})
            await s.execute(
                text("DELETE FROM admin_role_assignments WHERE admin_id = ANY(:a)"),
                {"a": a},
            )
            await s.execute(
                text("DELETE FROM admin_role_permissions WHERE admin_role_id = ANY(:r)"),
                {"r": rol},
            )
            await s.execute(text("DELETE FROM admin_roles WHERE id = ANY(:r)"), {"r": rol})
            await s.execute(text("DELETE FROM admins WHERE id = ANY(:a)"), {"a": a})
            await s.commit()
