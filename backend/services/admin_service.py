from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import String, asc, cast, desc, func, literal, or_, select, union_all, update
from sqlalchemy.ext.asyncio import AsyncSession

from models.admin import Admin
from models.audit_log import AuditLog
from models.booking import Booking, BookingStatus
from models.client import Client
from models.demand import Demand, DemandStatus
from models.delivery import DeliveryRun, DeliveryRunStatus
from models.library import Library, LibraryStatus
from models.payment import Payment, PaymentStatus
from models.report import Report, ReportStatus
from models.review import Review
from core.stock_policy import stok_kovasi_yuklemi
from models.store import Order, OrderReturn, OrderStatus, Product
from models.tutor import Tutor, TutorEducation, TutorStatus
from schemas.admin import (
    AdminBookingOut,
    AdminDashboardOut,
    AdminStats,
    AdminUserDetailOut,
    AdminUserOut,
)

# Admin yalnızca tutor/client şifresini sıfırlayabilir (admin'ler hariç).
_RESET_MODELS: dict[str, type] = {"tutor": Tutor, "client": Client}


def _mask_email(email: str) -> str:
    """kiyarserhat@gmail.com → k***t@gmail.com (admin ekranında teyit için)."""
    local, _, domain = email.partition("@")
    if len(local) <= 2:
        return f"{local[:1]}***@{domain}"
    return f"{local[0]}***{local[-1]}@{domain}"


async def initiate_password_reset(db: AsyncSession, *, role: str, user_id: int) -> str:
    """Güvenli admin şifre sıfırlama: geçici parola ÜRETİLMEZ ve ekrana DÖNMEZ.

    Kullanıcıya tek kullanımlık, süreli self-service sıfırlama linki e-postalanır
    (verification_tokens — hash'li, tek kullanımlık) ve TÜM aktif refresh
    token'ları iptal edilir (çalıntı oturum şifreyle birlikte ölür; kısa ömürlü
    access token doğal süresinde düşer). Maskeli e-posta döner."""
    from models.role import ROLE_IDS, RoleType
    from services import refresh_token_service, verification_service

    model = _RESET_MODELS.get(role)
    if model is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid role")
    user = await db.get(model, user_id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    # Gölgeye şifre sıfırlama linki GÖNDERİLEMEZ: link tamamlanırsa gölgeye
    # gerçek bir parola yazılır ve giriş öznesi olmadığı kuralı (§1.2) çöker.
    # Eğitmenin sıfırlaması kendi TUTOR kaydından yapılır.
    if getattr(user, "shadow_of_tutor_id", None) is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    role_id = ROLE_IDS[RoleType.TUTOR if role == "tutor" else RoleType.CLIENT]
    await refresh_token_service.revoke_all_for_user(
        db, role_id=role_id, user_id=user.id
    )
    await verification_service.send_password_reset(db, user)
    return _mask_email(user.email)


async def _count(db: AsyncSession, model, *conditions) -> int:
    stmt = (
        select(func.count())
        .select_from(model)
        .where(model.deleted_at.is_(None), *conditions)
    )
    return int((await db.scalar(stmt)) or 0)


async def get_stats(db: AsyncSession) -> AdminStats:
    """Yönetim özeti — dokuz sayaç TEK sorguda.

    Önceden her sayaç ayrı bir gidiş-dönüştü: dokuz sorgu, dokuz ağ turu ve
    `bookings` tablosunun üç kez taranması. `get_dashboard` zaten scalar
    subquery deseniyle yazılmış; bu fonksiyon aynı desene getirildi.
    """
    row = (
        await db.execute(
            select(
                _count_scalar(Client).label("total_clients"),
                _count_scalar(Tutor).label("total_tutors"),
                _count_scalar(Admin).label("total_admins"),
                _count_scalar(Tutor, Tutor.status == TutorStatus.APPROVED).label(
                    "approved_tutors"
                ),
                _count_scalar(
                    Tutor, Tutor.status == TutorStatus.PENDING_APPROVAL
                ).label("pending_tutors"),
                _count_scalar(Booking).label("total_bookings"),
                _count_scalar(
                    Booking,
                    Booking.status.in_(
                        [BookingStatus.PENDING, BookingStatus.ACCEPTED]
                    ),
                ).label("active_bookings"),
                _count_scalar(Booking, Booking.status == BookingStatus.COMPLETED).label(
                    "completed_bookings"
                ),
                _count_scalar(Review).label("total_reviews"),
            )
        )
    ).one()
    return AdminStats(**row._mapping)


def _count_scalar(model, *conditions, soft_delete: bool = True):
    filters = list(conditions)
    if soft_delete and hasattr(model, "deleted_at"):
        filters.insert(0, model.deleted_at.is_(None))
    # Eğitmenin alışveriş gölgesi bir kullanıcı DEĞİLDİR: müşteri sayacını
    # şişirmemeli (docs/egitmen-alici-sozlesme.md §5.1). Filtre bilinçli olarak
    # çağrı yerlerine değil BURAYA konuldu — ileride eklenecek yeni bir Client
    # sayacı da onu unutamasın (fail-closed).
    if model is Client:
        filters.insert(0, Client.shadow_of_tutor_id.is_(None))
    return select(func.count()).select_from(model).where(*filters).scalar_subquery()


async def get_dashboard(db: AsyncSession, *, range_name: str) -> AdminDashboardOut:
    days = {"day": 1, "week": 7, "month": 30}[range_name]
    now = datetime.datetime.now(datetime.timezone.utc)
    period_start = now - datetime.timedelta(days=days)
    previous_start = period_start - datetime.timedelta(days=days)

    stmt = select(
        _count_scalar(Client, Client.created_at >= period_start).label("new_clients"),
        _count_scalar(
            Client,
            Client.created_at >= previous_start,
            Client.created_at < period_start,
        ).label("previous_new_clients"),
        _count_scalar(Tutor, Tutor.created_at >= period_start).label("new_tutors"),
        _count_scalar(
            Tutor,
            Tutor.created_at >= previous_start,
            Tutor.created_at < period_start,
        ).label("previous_new_tutors"),
        _count_scalar(Order, Order.created_at >= period_start).label("new_orders"),
        _count_scalar(
            Order,
            Order.created_at >= previous_start,
            Order.created_at < period_start,
        ).label("previous_new_orders"),
        _count_scalar(Tutor, Tutor.status == TutorStatus.PENDING_APPROVAL).label(
            "pending_tutors"
        ),
        _count_scalar(
            TutorEducation, TutorEducation.verification_status == "PENDING"
        ).label("pending_diplomas"),
        _count_scalar(
            Booking,
            Booking.status.in_([BookingStatus.PENDING, BookingStatus.ACCEPTED]),
        ).label("active_bookings"),
        _count_scalar(Demand, Demand.status == DemandStatus.OPEN).label("open_demands"),
        _count_scalar(Booking, Booking.is_disputed.is_(True)).label(
            "disputed_bookings"
        ),
        _count_scalar(Report, Report.status == ReportStatus.OPEN, soft_delete=False).label(
            "open_reports"
        ),
        _count_scalar(
            Order,
            Order.status == OrderStatus.PAID,
            Order.has_physical.is_(True),
        ).label("paid_orders"),
        _count_scalar(
            OrderReturn, OrderReturn.status == "PENDING", soft_delete=False
        ).label("pending_returns"),
        # Sayaç ile kartın AÇTIĞI liste (`?stok=kritik`) tek bir yüklemi
        # paylaşır: eşik de kapsam da `core.stock_policy`'de. Burada elle
        # yazmak, ikisinin ayrı ayrı kaymasına izin verirdi — nitekim P1-1'de
        # tam olarak bu oldu: sayaç `ACTIVE` filtreliyordu, liste
        # filtrelemiyordu; kart 5 derken liste 7 kayıt gösteriyordu.
        _count_scalar(
            Product,
            stok_kovasi_yuklemi("kritik"),
        ).label("low_stock_products"),
        _count_scalar(Library, Library.status == LibraryStatus.PENDING).label(
            "pending_libraries"
        ),
        _count_scalar(
            DeliveryRun, DeliveryRun.status == DeliveryRunStatus.ACTIVE
        ).label("active_delivery_runs"),
        _count_scalar(
            AuditLog, AuditLog.created_at >= period_start, soft_delete=False
        ).label("period_audit_logs"),
    )
    row = (await db.execute(stmt)).mappings().one()
    return AdminDashboardOut(
        range=range_name,
        period_start=period_start,
        previous_period_start=previous_start,
        **{key: int(value or 0) for key, value in row.items()},
    )


_ROLE_TABLES = ((Admin, "ADMIN"), (Tutor, "TUTOR"), (Client, "CLIENT"))


def _user_directory_selects(*, role: str | None, q: str | None):
    statements = []
    for model, role_name in _ROLE_TABLES:
        if role is not None and role_name != role:
            continue
        stmt = select(
            model.id.label("id"),
            model.first_name.label("first_name"),
            model.last_name.label("last_name"),
            model.full_name.label("full_name"),
            model.email.label("email"),
            cast(literal(role_name), String).label("role"),
            model.is_active.label("is_active"),
            model.created_at.label("created_at"),
        ).where(model.deleted_at.is_(None))
        if model is Client:
            # Gölge satırlar kullanıcı dizininde görünmez (§5.1).
            stmt = stmt.where(Client.shadow_of_tutor_id.is_(None))
        if q:
            pattern = f"%{q}%"
            stmt = stmt.where(
                or_(
                    model.first_name.ilike(pattern),
                    model.last_name.ilike(pattern),
                    model.email.ilike(pattern),
                    model.full_name.ilike(pattern),
                )
            )
        statements.append(stmt)
    return statements


async def list_users(
    db: AsyncSession,
    *,
    limit: int = 50,
    offset: int = 0,
    q: str | None = None,
    role: str | None = None,
    is_active: bool | None = None,
    sort: str = "created_at",
    order: str = "desc",
) -> tuple[list[AdminUserOut], int]:
    """Ayrı kullanıcı tablolarını SQL UNION ALL ile birleştirip DB'de sayfalar."""
    normalized_q = q.strip() if q and q.strip() else None
    statements = _user_directory_selects(role=role, q=normalized_q)
    directory = (
        statements[0].subquery("admin_user_directory")
        if len(statements) == 1
        else union_all(*statements).subquery("admin_user_directory")
    )

    filters = []
    if is_active is not None:
        filters.append(directory.c.is_active.is_(is_active))

    total_stmt = select(func.count()).select_from(directory).where(*filters)
    total = int((await db.scalar(total_stmt)) or 0)

    sort_columns = {
        "created_at": directory.c.created_at,
        "full_name": directory.c.full_name,
        "email": directory.c.email,
        "role": directory.c.role,
    }
    sort_column = sort_columns[sort]
    order_by = asc(sort_column) if order == "asc" else desc(sort_column)
    stmt = (
        select(directory)
        .where(*filters)
        .order_by(order_by, desc(directory.c.id))
        .limit(limit)
        .offset(offset)
    )
    rows = (await db.execute(stmt)).mappings().all()
    return [AdminUserOut(**dict(row)) for row in rows], total


_USER_DETAIL_MODELS = {
    "admin": (Admin, "ADMIN"),
    "tutor": (Tutor, "TUTOR"),
    "client": (Client, "CLIENT"),
}


async def get_user_detail(
    db: AsyncSession, *, role: str, user_id: int
) -> AdminUserDetailOut:
    model, role_name = _USER_DETAIL_MODELS[role]
    user = await db.get(model, user_id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    # Gölge kimliği dizinde yok; detayı da yok (§5.2). Eğitmenin alışverişi
    # kendi TUTOR kaydına aittir, ayrı bir "müşteri" kaydına değil.
    if role == "client" and user.shadow_of_tutor_id is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    booking_count = 0
    review_count = 0
    demand_count = 0
    order_count = 0
    tutor_status: str | None = None

    if role == "tutor":
        booking_count = await _count(db, Booking, Booking.tutor_id == user_id)
        review_count = await _count(db, Review, Review.tutor_id == user_id)
        tutor_status = user.status.value
    elif role == "client":
        booking_count = await _count(db, Booking, Booking.client_id == user_id)
        review_count = await _count(db, Review, Review.client_id == user_id)
        demand_count = await _count(db, Demand, Demand.client_id == user_id)
        order_count = await _count(db, Order, Order.client_id == user_id)

    return AdminUserDetailOut(
        id=user.id,
        first_name=user.first_name,
        last_name=user.last_name,
        full_name=user.full_name,
        email=user.email,
        role=role_name,
        is_active=user.is_active,
        created_at=user.created_at,
        updated_at=user.updated_at,
        last_seen_at=user.last_seen_at,
        email_verified=user.email_verified,
        tutor_status=tutor_status,
        booking_count=booking_count,
        review_count=review_count,
        demand_count=demand_count,
        order_count=order_count,
    )


async def delete_tutor(db: AsyncSession, tutor: Tutor) -> None:
    """Soft delete: ilan listelerden ve aramadan düşer, veri korunur.

    Açık emanet varken SİLİNMEZ (denetim P1-22). Eski gövde iki satırdı
    (`deleted_at` + `flush`) ve emanetteki parayı hiç sorgulamıyordu; sonuç
    yetim emanetti — `payout_ledger` parayı "hak edilmiş" saymaya devam ediyor
    ama karşılığında hesap yok.

    Kapsam bilinçli olarak **paradır**: HELD/REFUNDING ödeme ya da henüz
    sonuçlanmamış (PENDING/ACCEPTED) ders. Kapanmış para (RELEASED/REFUNDED) ve
    terminal dersler engellemez — aksi halde hiçbir eğitmen hiçbir zaman
    silinemezdi. Ders kolunun İŞ MANTIĞINA dokunulmaz; burada yalnız okuma var.
    """
    acik_odeme = int(
        (
            await db.execute(
                select(func.count())
                .select_from(Payment)
                .join(Booking, Booking.id == Payment.booking_id)
                .where(
                    Booking.tutor_id == tutor.id,
                    Booking.deleted_at.is_(None),
                    Payment.deleted_at.is_(None),
                    Payment.status.in_(
                        [PaymentStatus.HELD, PaymentStatus.REFUNDING]
                    ),
                )
            )
        ).scalar_one()
    )
    if acik_odeme:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Eğitmen silinemez: {acik_odeme} adet ders ödemesi emanette "
            "(para henüz kapanmadı).",
        )

    acik_ders = int(
        (
            await db.execute(
                select(func.count()).where(
                    Booking.tutor_id == tutor.id,
                    Booking.deleted_at.is_(None),
                    Booking.status.in_(
                        [BookingStatus.PENDING, BookingStatus.ACCEPTED]
                    ),
                )
            )
        ).scalar_one()
    )
    if acik_ders:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Eğitmen silinemez: {acik_ders} adet sonuçlanmamış ders var; önce "
            "dersleri iptal edin.",
        )

    tutor.deleted_at = datetime.datetime.now(datetime.timezone.utc)
    await db.flush()


async def list_bookings(
    db: AsyncSession,
    *,
    limit: int = 50,
    offset: int = 0,
    booking_id: int | None = None,
    q: str | None = None,
    status_filter: BookingStatus | None = None,
    is_disputed: bool | None = None,
    sort: str = "created_at",
    order: str = "desc",
) -> tuple[list[AdminBookingOut], int]:
    filters = [Booking.deleted_at.is_(None)]
    normalized_q = q.strip() if q and q.strip() else None
    if normalized_q:
        pattern = f"%{normalized_q}%"
        filters.append(
            or_(
                Tutor.full_name.ilike(pattern),
                Tutor.email.ilike(pattern),
                Client.full_name.ilike(pattern),
                Client.email.ilike(pattern),
            )
        )
    if booking_id is not None:
        filters.append(Booking.id == booking_id)
    if status_filter is not None:
        filters.append(Booking.status == status_filter)
    if is_disputed is not None:
        filters.append(Booking.is_disputed.is_(is_disputed))

    stmt = (
        select(Booking, Tutor.full_name.label("tutor_name"), Client.full_name.label("client_name"))
        .join(Tutor, Booking.tutor_id == Tutor.id)
        .join(Client, Booking.client_id == Client.id)
        .where(*filters)
    )
    total = int(
        (
            await db.scalar(
                select(func.count())
                .select_from(Booking)
                .join(Tutor, Booking.tutor_id == Tutor.id)
                .join(Client, Booking.client_id == Client.id)
                .where(*filters)
            )
        )
        or 0
    )
    sort_columns = {
        "created_at": Booking.created_at,
        "start_at": Booking.start_at,
        "status": Booking.status,
        "price": Booking.price,
    }
    sort_column = sort_columns[sort]
    order_by = asc(sort_column) if order == "asc" else desc(sort_column)
    stmt = stmt.order_by(order_by, Booking.id.desc()).limit(limit).offset(offset)
    rows = (await db.execute(stmt)).all()
    out: list[AdminBookingOut] = []
    for b, t_name, c_name in rows:
        bo = AdminBookingOut.model_validate(b)
        bo.tutor_name = t_name
        bo.client_name = c_name
        out.append(bo)
    return out, total


async def cancel_booking(db: AsyncSession, booking: Booking, reason: str | None = None) -> Booking:
    """Admin booking iptali — FSM claim'i + emanet iadesi + bildirim.

    Gövde bilinçli olarak `booking_service.cancel_by_admin`'e devreder: para
    hareketi tetikleyen geçişin **tek** bir uygulaması olmalıdır. Buraya ikinci
    bir iade/FSM kopyası yazmak, iki uygulamanın zamanla ayrışmasıyla sonuçlanır
    (P0-2'nin kökeni tam olarak budur: admin yolu kullanıcı yolundan ayrı yazıldı
    ve iade bacağı hiç eklenmedi).
    """
    from services import booking_service

    return await booking_service.cancel_by_admin(db, booking, reason=reason)


#: İhtilaf yalnız **canlı** bir derste açılabilir.
_DISPUTE_ACILABILIR = (BookingStatus.PENDING, BookingStatus.ACCEPTED)


async def toggle_dispute(db: AsyncSession, booking: Booking, is_disputed: bool, admin_notes: str | None = None) -> Booking:
    """İhtilaf bayrağını açar/kapatır.

    Açma **atomik koşullu UPDATE**'tir (P0-4): auto-complete ile aynı satır
    üzerinde yarışır ve yalnız biri kazanır. Kritik invariant, "ihtilaflı ders +
    öğretmene serbest bırakılmış para" kombinasyonunun HİÇ oluşmamasıdır — o
    kombinasyonda `escrow.begin_refund`'ın `released_at IS NULL` guard'ı iadeyi
    kalıcı olarak kapatmıştır ve admin ihtilafı çözecek hiçbir araç bulamaz.
    Bu yüzden tamamlanmış/iptal edilmiş derste ihtilaf açılmaz (409); kapatma
    her durumda serbesttir (admin çözümü kilit bırakmamalı).
    """
    if is_disputed:
        from models.payment import Payment, PaymentStatus

        # Modül 2: eğitmen "Tamamla" dedikten sonra para öğrenci onayına kadar
        # emanette bekler; o aralıkta (COMPLETED + dağıtılmamış para) ihtilaf
        # hâlâ açılabilir. Parası dağıtılmış ders yine reddedilir.
        dagitilmis = (
            select(Payment.id)
            .where(
                Payment.booking_id == Booking.id,
                (Payment.status == PaymentStatus.RELEASED) | Payment.released_at.is_not(None),
            )
            .exists()
        )
        # Önce satır kilidi: auto-complete kilidi tutarken UPDATE bekleyip
        # yeniden denerse PostgreSQL WHERE'i eski anlık görüntüyle değerlendirir
        # ve yeni serbest bırakılmış ödemeyi göremez. Kilit alındıktan sonra
        # UPDATE yeni bir deyimdir; taze görüntüyle `dagitilmis`'i görür.
        await db.execute(
            select(Booking.id).where(Booking.id == booking.id).with_for_update()
        )
        result = await db.execute(
            update(Booking)
            .where(
                Booking.id == booking.id,
                Booking.status.in_(_DISPUTE_ACILABILIR)
                | ((Booking.status == BookingStatus.COMPLETED) & ~dagitilmis),
                Booking.deleted_at.is_(None),
            )
            .values(is_disputed=True)
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            await db.refresh(booking)
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Yalnızca devam eden bir derste ihtilaf açılabilir; tamamlanmış "
                "ya da iptal edilmiş dersin para hareketi sonuçlanmıştır.",
            )
        booking.is_disputed = True
    else:
        booking.is_disputed = False
    if admin_notes is not None:
        booking.admin_notes = admin_notes
    await db.flush()
    return booking
