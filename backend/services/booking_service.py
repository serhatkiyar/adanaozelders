from __future__ import annotations

import datetime
import secrets
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException, status
from sqlalchemy import exists, func, select, update
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import set_committed_value
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core import ders_onay_hatirlatma
from core.moderation import mask_contact_info
from core import storage
from models.booking import (
    PAYMENT_CHANNEL_DIRECT,
    PAYMENT_CHANNEL_ESCROW,
    Booking,
    BookingStatus,
)
from models.client import Client
from models.payment import PaymentStatus
from models.review import Review
from models.role import ROLE_IDS, RoleType, role_name
from models.tutor import Tutor, TutorAvailability, TutorStatus
from models.tutor_time_off import TutorTimeOff
from models.tutor_extra_availability import TutorExtraAvailability
from models.booking_resource import BookingResource
from models.booking_comment import BookingComment
from models.booking_private_note import BookingPrivateNote
from models.lesson_series import LessonSeries, LessonSeriesStatus
from schemas.booking import BookingCreate, BookingResourceCreate, BookingCommentCreate, BookingLocationUpdate, BookingPrivateNoteCreate
from services import (
    messaging_service,
    notification_service,
    payment_gates,
    payment_service,
    review_service,
)
from core import ws_outbox

CurrentUser = "Admin | Tutor | Client"


def _notify_booking_update(db: AsyncSession, booking: Booking) -> None:
    """Rezervasyon durumu değiştiğinde her iki tarafın (eğitmen + öğrenci)
    rezervasyon listesi/detayı sayfa yenilemeden canlı tazelensin diye WS olayı
    kuyruğa alır. Commit sonrası gönderilir (bkz. core/ws_outbox)."""
    payload = {"type": "BOOKING_UPDATE", "booking_id": booking.id}
    ws_outbox.enqueue(
        db, payload, user_id=booking.tutor_id, role_id=ROLE_IDS[RoleType.TUTOR]
    )
    ws_outbox.enqueue(
        db, payload, user_id=booking.client_id, role_id=ROLE_IDS[RoleType.CLIENT]
    )


def _set_private_notes_view(booking: Booking, notes: list) -> None:
    """Yanıt için görünen not listesini ORM değişikliği SAYILMADAN yazar.

    `Booking.private_notes` ilişkisi `delete-orphan` cascade taşır; koleksiyona
    düz atama yapılırsa listeden düşen (karşı tarafın) notları istek sonundaki
    commit veritabanından SİLER. `set_committed_value` değeri "yüklenmiş" kabul
    ettirir, flush'a hiçbir silme yansımaz."""
    set_committed_value(booking, "private_notes", notes)


def _filter_private_notes(booking: Booking, *, role_id: int, user_id: int) -> None:
    """Booking üzerindeki özel notları yalnızca sahibi görebilsin diye in-place
    filtreler. Özel notlar gizlilik açısından karşı tarafa asla sızmamalı."""
    _set_private_notes_view(
        booking,
        [
            n
            for n in booking.private_notes
            if n.owner_role == role_id and n.owner_id == user_id
        ],
    )

#: Booking FSM'inin **tek** doğruluk kaynağı. `_transition` (saf, birim testli)
#: ve `_claim_transition` (atomik, üretim) izinli kaynak durumları buradan okur;
#: paralel bir geçiş tablosu YOKTUR.
#:
#: `→ PENDING` geçişleri **reschedule** içindir ve bilinçli olarak eklenmiştir
#: (nihai audit P1-B): reschedule daha önce `booking.status = PENDING` biçiminde
#: doğrudan ORM ataması yapıyordu, yani FSM'i ve atomik claim'i atlıyordu.
#: Gerçek PostgreSQL'de ölçülen sonucu: `complete` claim'ini kazanıp parayı
#: RELEASED yaptıktan sonra reschedule onun üzerine PENDING yazabiliyor ve
#: geriye "tamamlanmamış görünen ders + dağıtılmış para" kalıyordu — iade de
#: `released_at` yüzünden kalıcı kapalı. Geçiş tabloya girince aynı yol
#: `_claim_transition` ile korunur.
_TRANSITIONS: dict[BookingStatus, set[BookingStatus]] = {
    BookingStatus.PENDING: {
        BookingStatus.ACCEPTED,
        BookingStatus.REJECTED,
        BookingStatus.CANCELLED,
        # reschedule: PENDING bir ders yeni saate taşınıp yine onay bekler.
        BookingStatus.PENDING,
    },
    BookingStatus.ACCEPTED: {
        BookingStatus.COMPLETED,
        BookingStatus.CANCELLED,
        # reschedule: onaylı ders yeni saate taşınınca yeniden onaya düşer.
        BookingStatus.PENDING,
    },
    BookingStatus.REJECTED: set(),
    BookingStatus.CANCELLED: set(),
    BookingStatus.COMPLETED: set(),
}


def _transition(booking: Booking, target: BookingStatus) -> None:
    """Geçiş tablosunun **saf** ifadesi (birim testi: `tests/test_booking_fsm.py`).

    ⚠️ Üretim yollarında KULLANILMAZ. Bellekteki nesneye bakan bir kontrol,
    başka bir transaction'ın commit'lediği terminal durumu göremez ve onun
    üzerine yazar (kayıp güncelleme).

    **Kapsam iddiası (nihai audit P1-B sonrası yeniden doğrulandı):** bu serviste
    `Booking.status` yazan **sekiz** üretim yolunun tamamı `_claim_transition`
    kullanır — `accept`, `reject`, `complete`, `auto_complete_past_bookings`,
    `cancel`, `cancel_by_admin`, `reschedule`, `withdraw_offer`. Haftalık
    serinin bitişi (`lesson_series_service.end_series`) bekleyen teklifleri
    `withdraw_offer` ile aynı `_teklifi_geri_cek_yaz` yardımcısıyla, yani yine
    `_claim_transition` ile geri çeker. Servis dışında booking durumu
    yazan başka yol yoktur (`admin_service` bu servise devreder;
    `account_deletion_service` yalnız okur). `booking.status = ...` biçimindeki
    tek atamalar bu fonksiyonun ve `_claim_transition`'ın kendi içindedir:
    ilki saf tablo ifadesi, ikincisi koşullu UPDATE **kazanıldıktan sonra**
    bellekteki nesneyi eşitler.

    İzinli kaynak durumlar her iki yolda da aynı `_TRANSITIONS` tablosundan
    okunur; paralel bir geçiş tablosu yoktur.
    """
    if target not in _TRANSITIONS[booking.status]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Invalid transition: {booking.status.value} -> {target.value}",
        )
    booking.status = target


async def _claim_transition(
    db: AsyncSession,
    booking: Booking,
    target: BookingStatus,
    *,
    extra_where: tuple = (),
) -> bool:
    """FSM geçişini DB'de atomik claim eder (koşullu UPDATE, tek kazanan).

    Para hareketi tetikleyen geçişlerde (COMPLETED→release, CANCELLED→refund,
    REJECTED→refund) bellekteki ``_transition`` yeterli değildir: iki eşzamanlı
    istek (ya da arka plan döngüsü + manuel istek) aynı ACCEPTED'ı okuyup ikisi
    de geçiş yapabilir — hatta biri terminal duruma yazdıktan SONRA diğeri onun
    üzerine yazabilir (kayıp güncelleme). True dönerse geçiş bu çağrıya aittir;
    False'ta kayıt yarışta kaybetmiştir ve çağıran **hiçbir para hareketi
    yapmamalıdır**.

    ``extra_where``: geçişe özel ek koşullar (ör. COMPLETED için "ihtilaflı
    değil"). Koşul WHERE'e girdiği için karar bellekte değil **satırın kendisinde**
    verilir: eşzamanlı bir ihtilaf açma isteğiyle yarışırsa yalnız biri kazanır.
    """
    allowed_from = [s for s, targets in _TRANSITIONS.items() if target in targets]
    result = await db.execute(
        update(Booking)
        .where(
            Booking.id == booking.id,
            Booking.status.in_(allowed_from),
            Booking.deleted_at.is_(None),
            *extra_where,
        )
        .values(status=target)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 1:
        booking.status = target
        return True
    await db.refresh(booking)
    return False


def _claim_hatasi(booking: Booking, target: BookingStatus) -> HTTPException:
    """Claim kaybedildiğinde kullanıcıya dönen 409 — sessiz başarı YOKTUR.

    Tekrarlanan istek 200 alırsa kullanıcı işlemin ikinci kez yapıldığını sanır
    ve (admin yolunda) ilk gerekçe sessizce ezilir; sözleşme §5/3 bunu yasaklar.
    """
    return HTTPException(
        status.HTTP_409_CONFLICT,
        f"Invalid transition: {booking.status.value} -> {target.value}",
    )


def _utc(dt: datetime.datetime) -> datetime.datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=datetime.timezone.utc)


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def is_late_for_changes(booking: Booking, now: datetime.datetime | None = None) -> bool:
    """Kabul edilmiş derse ``LESSON_LATE_CANCEL_HOURS``'tan az mı kaldı?

    Kural yalnız ACCEPTED derste işler: onay bekleyen talepte ödeme de yükümlülük
    de yoktur. Başlamış ders de "geç" sayılır.
    """
    if booking.status != BookingStatus.ACCEPTED:
        return False
    now = now or _utcnow()
    return _utc(booking.start_at) - now < datetime.timedelta(
        hours=settings.LESSON_LATE_CANCEL_HOURS
    )


def issue_report_deadline(booking: Booking) -> datetime.datetime:
    """Öğrencinin sorun bildirebileceği son an (ders bitişi + onay penceresi)."""
    return _utc(booking.end_at) + datetime.timedelta(
        hours=settings.LESSON_CONFIRM_WINDOW_HOURS
    )


async def _lock_booking(
    db: AsyncSession, booking: Booking, *, skip_locked: bool = False
) -> Booking | None:
    """Ders satırını ``FOR UPDATE`` ile kilitleyip güncel hâlini döndürür.

    Onay, sorun bildirimi, otomatik onay ve admin kararı aynı satırda sıraya
    girer: "sorun bildirilmiş ders + öğretmene geçmiş para" hiç oluşamaz.
    """
    stmt = (
        select(Booking)
        .where(Booking.id == booking.id, Booking.deleted_at.is_(None))
        # `populate_existing` nesneyi yeniden doldurur; varsayılan (lazy) yüklenen
        # `resources` ilişkisi boşalırsa yanıt serileştirilirken async ortamda
        # tembel yükleme patlar (MissingGreenlet). Kilit sorgusunda birlikte yüklenir.
        .options(selectinload(Booking.resources))
        .with_for_update(skip_locked=skip_locked)
        .execution_options(populate_existing=True)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def _para_egitmene_gecti_mi(db: AsyncSession, booking: Booking) -> bool:
    payment = await payment_service.get_for_booking(db, booking.id)
    return payment is not None and (
        payment.status is PaymentStatus.RELEASED or payment.released_at is not None
    )


ERR_NO_AVAILABILITY = "Eğitmen henüz ders saati açmadı."


def _yerel_tz() -> datetime.timezone:
    return datetime.timezone(datetime.timedelta(hours=settings.APP_UTC_OFFSET_HOURS))


def booking_window_end(now: datetime.datetime) -> datetime.datetime:
    """Talep edilebilecek son anın hemen sonrası (dahil değil).

    İstanbul'da bugünden ``BOOKING_WINDOW_DAYS`` gün sonrasının gece yarısı:
    bugün dahil tam ``BOOKING_WINDOW_DAYS`` takvim günü açıktır. Slot listesi ve
    talep kuralı aynı ucu kullanır.
    """
    tz = _yerel_tz()
    son_gun = now.astimezone(tz).date() + datetime.timedelta(
        days=settings.BOOKING_WINDOW_DAYS
    )
    return datetime.datetime.combine(son_gun, datetime.time(0), tzinfo=tz).astimezone(
        datetime.timezone.utc
    )


def _assert_booking_rules(
    start_at: datetime.datetime,
    now: datetime.datetime,
    *,
    past_message: str = "Cannot book a time slot in the past",
) -> None:
    """Talep ve erteleme için zaman kuralları (Modül 3).

    Geçmiş saat 400 olarak kalır (mevcut sözleşme); 24 saat bildirim süresi ve
    14 günlük pencere 422'dir. Kurallar sunucuda zorunludur; slot listesi
    yalnız aynı kuralı önceden gösterir.
    """
    if start_at <= now:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, past_message)
    if start_at < now + datetime.timedelta(hours=settings.BOOKING_MIN_NOTICE_HOURS):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Ders en az {settings.BOOKING_MIN_NOTICE_HOURS} saat önceden talep edilmeli.",
        )
    if start_at >= booking_window_end(now):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Ders en fazla {settings.BOOKING_WINDOW_DAYS} gün sonrası için talep edilebilir.",
        )


async def _assert_within_availability(
    db: AsyncSession,
    tutor_id: int,
    start_at: datetime.datetime,
    end_at: datetime.datetime,
) -> None:
    """İstenen saat eğitmenin müsaitliğine sığmalı. Sabit UTC+3.

    Modül 3 (kullanıcı kararı): hiç müsaitlik tanımlamamış eğitmene talep
    gönderilemez. Eskiden bu durumda kısıt yoktu; öğrenci her saati seçebiliyor
    ve eğitmen reddetmek zorunda kalıyordu.

    Müsaitlik o günün şablon pencereleri ile ek aralıklarının birleşimidir
    (`gun_araliklari`); ders aynı yerel günde bitmeli ve birleşik aralıklardan
    birine tamamen sığmalı. Slot listesi (`build_slots`) aynı kuralı kullanır.
    """
    availability = (
        await db.execute(
            select(TutorAvailability).where(TutorAvailability.tutor_id == tutor_id)
        )
    ).scalars().all()
    extras = await _ek_araliklar(db, tutor_id, start_at, end_at)
    if not availability and not extras:
        gelecekte_ek_var = await db.scalar(
            select(
                exists().where(
                    TutorExtraAvailability.tutor_id == tutor_id,
                    TutorExtraAvailability.end_at > _utcnow(),
                )
            )
        )
        if not gelecekte_ek_var:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, ERR_NO_AVAILABILITY
            )
    if not musaitlige_sigar_mi(availability, extras, start_at, end_at):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Selected time is outside the tutor's availability",
        )


async def _ek_araliklar(
    db: AsyncSession,
    tutor_id: int,
    start: datetime.datetime,
    end: datetime.datetime,
) -> list[tuple[datetime.datetime, datetime.datetime]]:
    """``[start, end)`` ile kesişen ek aralıklar (UTC çiftleri).

    Model doğrudan sorgulanır; `extra_availability_service` bu modülü içe
    aktardığı için buradan o servise gidilmez (döngüsel import).
    """
    rows = (
        await db.execute(
            select(TutorExtraAvailability.start_at, TutorExtraAvailability.end_at).where(
                TutorExtraAvailability.tutor_id == tutor_id,
                TutorExtraAvailability.start_at < end,
                TutorExtraAvailability.end_at > start,
            )
        )
    ).all()
    return [(_utc(a), _utc(b)) for a, b in rows]


async def _lock_tutor(db: AsyncSession, tutor_id: int) -> None:
    """Eğitmen satırını ``FOR UPDATE`` ile kilitler (Modül 7).

    İzin yazma ile ders ayırtma/onaylama/erteleme aynı kilitte sıraya girer:
    "izin kaydedildi ama arada o aralığa ders girdi" yarışı kapanır.

    Kilit sırası: **önce eğitmen, sonra ders satırı.** Bu fonksiyonu çağıran
    yollar ders satırını (`_claim_transition` / `_lock_booking`) bundan SONRA
    kilitler; ters sıra deadlock üretir.
    """
    await db.execute(select(Tutor.id).where(Tutor.id == tutor_id).with_for_update())


async def _assert_not_on_time_off(
    db: AsyncSession,
    tutor_id: int,
    start_at: datetime.datetime,
    end_at: datetime.datetime,
) -> None:
    """Ders aralığı eğitmenin bir izniyle çakışıyorsa 422."""
    overlap = await db.scalar(
        select(
            exists().where(
                TutorTimeOff.tutor_id == tutor_id,
                TutorTimeOff.start_at < end_at,
                TutorTimeOff.end_at > start_at,
            )
        )
    )
    if overlap:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Öğretmen bu tarihte izinde"
        )


def _compute_price(
    tutor: Tutor,
    start_at: datetime.datetime,
    end_at: datetime.datetime,
) -> Decimal | None:
    """Ders ücretini SUNUCUDA hesaplar: eğitmen saatlik ücreti × süre (saat).

    Fiyat asla istemciden alınmaz (manipülasyon önlenir). Eğitmen ücreti
    tanımlamamışsa None döner. 2 ondalığa yuvarlanır.
    """
    if tutor.hourly_rate is None:
        return None
    delta = end_at - start_at
    seconds = Decimal(delta.days * 86400 + delta.seconds)
    hours = seconds / Decimal(3600)
    rate = Decimal(str(tutor.hourly_rate))
    return (rate * hours).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


async def _is_eligible_for_free_lesson(
    db: AsyncSession, tutor_id: int, client_id: int
) -> bool:
    """Öğrenci bu eğitmenden ücretsiz ilk ders alabilir mi?

    Yalnızca daha önce bu eğitmenle (iptal/red dışı) hiç dersi yoksa uygundur.
    PENDING dahil sayılır; böylece arka arkaya ücretsiz talep oluşturulamaz.
    """
    stmt = (
        select(func.count())
        .select_from(Booking)
        .where(
            Booking.tutor_id == tutor_id,
            Booking.client_id == client_id,
            Booking.deleted_at.is_(None),
            Booking.status.notin_(
                [BookingStatus.REJECTED, BookingStatus.CANCELLED]
            ),
        )
    )
    return int((await db.scalar(stmt)) or 0) == 0


async def get_bookable_tutor(db: AsyncSession, tutor_id: int) -> Tutor:
    """Ders talep edilebilir (yayında) eğitmen; değilse 404."""
    tutor = await db.get(Tutor, tutor_id)
    if (
        tutor is None
        or tutor.deleted_at is not None
        or not tutor.is_active
        or tutor.status != TutorStatus.APPROVED
    ):
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Tutor not found or not available"
        )
    return tutor


def _part_of_day(hour: int) -> str:
    if hour < 6:
        return "night"
    if hour < 12:
        return "morning"
    if hour < 18:
        return "afternoon"
    return "evening"


def _cakisir(
    start: datetime.datetime,
    end: datetime.datetime,
    araliklar: list[tuple[datetime.datetime, datetime.datetime]],
) -> bool:
    return any(a < end and b > start for a, b in araliklar)


#: Ders aynı yerel günde bitmeli: gün 00:00–23:59 arasına kırpılır (24:00'te
#: biten ders ertesi güne sayılır).
_GUN_SON_DAKIKA = 1439


def gun_araliklari(
    windows,
    extras,
    gun: datetime.date,
) -> list[tuple[datetime.datetime, datetime.datetime]]:
    """O İstanbul gününün müsait aralıkları (UTC). Şablon pencereleri ve ek aralıklar
    gün içine ([00:00, 23:59]) kırpılır, çakışan/bitişikler birleştirilir. Saf.

    ``windows``: ``weekday``/``start_minute``/``end_minute`` taşıyan haftalık
    pencereler; ``extras``: ``(start_at, end_at)`` çiftleri ya da bu iki alanı
    taşıyan nesneler. Bitişik iki şablon penceresi de birleşir (10–12 ve
    12–14 ise 11:30 başlangıcı açılır) — bilinçli.
    """
    tz = _yerel_tz()
    gun_bas = datetime.datetime.combine(gun, datetime.time(0), tzinfo=tz)
    gun_son = gun_bas + datetime.timedelta(minutes=_GUN_SON_DAKIKA)
    parcalar: list[tuple[datetime.datetime, datetime.datetime]] = []
    for w in windows:
        if w.weekday != gun.weekday():
            continue
        a = gun_bas + datetime.timedelta(minutes=w.start_minute)
        b = min(gun_bas + datetime.timedelta(minutes=w.end_minute), gun_son)
        if b > a:
            parcalar.append((a, b))
    for e in extras:
        ea, eb = (e.start_at, e.end_at) if hasattr(e, "start_at") else e
        a = max(_utc(ea), gun_bas)
        b = min(_utc(eb), gun_son)
        if b > a:
            parcalar.append((a, b))
    parcalar.sort()
    birlesik: list[list[datetime.datetime]] = []
    for a, b in parcalar:
        if birlesik and a <= birlesik[-1][1]:
            birlesik[-1][1] = max(birlesik[-1][1], b)
        else:
            birlesik.append([a, b])
    utc = datetime.timezone.utc
    return [(a.astimezone(utc), b.astimezone(utc)) for a, b in birlesik]


def musaitlige_sigar_mi(
    windows,
    extras,
    start_at: datetime.datetime,
    end_at: datetime.datetime,
) -> bool:
    """Ders aynı yerel günde bitiyor ve o günün birleşik bir aralığına tamamen
    sığıyor mu? `_assert_within_availability` ve seri simülasyonu kullanır. Saf."""
    tz = _yerel_tz()
    yerel_bas = start_at.astimezone(tz)
    if yerel_bas.date() != end_at.astimezone(tz).date():
        return False
    return any(
        a <= start_at and end_at <= b
        for a, b in gun_araliklari(windows, extras, yerel_bas.date())
    )


def build_slots(
    windows,
    busy: list[tuple[datetime.datetime, datetime.datetime]],
    time_off: list[tuple[datetime.datetime, datetime.datetime]],
    *,
    extras=(),
    day_from: datetime.date,
    days: int,
    duration_min: int,
    now: datetime.datetime,
) -> list[dict]:
    """Saf slot üreticisi (DB'siz; birim testi `tests/test_slots.py`).

    ``windows``: ``weekday``/``start_minute``/``end_minute`` taşıyan haftalık
    müsaitlik pencereleri (İstanbul saati); ``extras``: ek aralıklar
    (``(start_at, end_at)``). İkisinin günlük birleşiminde (`gun_araliklari`)
    ``BOOKING_SLOT_STEP_MINUTES`` adımla, ders süresi aralığa tamamen sığan
    ve aynı günde biten başlangıçlar üretilir — `_assert_within_availability`
    ile aynı kural. Aktif ders, izin, 24 saat bildirim süresi ya da pencere
    sonu sonrası slot ``busy`` olur (dolu saat gizlenmez, soluk gösterilir).

    Günler İstanbul tarihidir; bugünden önceki ``day_from`` bugüne kırpılır,
    pencere dışına taşan günler listeye girmez.
    """
    tz = _yerel_tz()
    bugun = now.astimezone(tz).date()
    pencere_sonu = booking_window_end(now)
    en_erken = now + datetime.timedelta(hours=settings.BOOKING_MIN_NOTICE_HOURS)
    sure = datetime.timedelta(minutes=duration_min)
    adim = settings.BOOKING_SLOT_STEP_MINUTES
    ilk_gun = max(day_from, bugun)

    sonuc: list[dict] = []
    for i in range(days):
        gun = ilk_gun + datetime.timedelta(days=i)
        gece_yarisi = datetime.datetime.combine(gun, datetime.time(0), tzinfo=tz)
        if gece_yarisi >= pencere_sonu:
            break
        baslangiclar: set[datetime.datetime] = set()
        # Ders aynı gün bitmeli: aralıklar 23:59'a kırpılı gelir.
        for a, b in gun_araliklari(windows, extras, gun):
            start = a
            while start + sure <= b:
                baslangiclar.add(start)
                start += datetime.timedelta(minutes=adim)
        slots = []
        for start in sorted(baslangiclar):
            yerel = start.astimezone(tz)
            end = start + sure
            dolu = (
                start < en_erken
                or start >= pencere_sonu
                or _cakisir(start, end, busy)
                or _cakisir(start, end, time_off)
            )
            slots.append(
                {
                    "start_at": start,
                    "end_at": end,
                    "status": "busy" if dolu else "available",
                    "part_of_day": _part_of_day(yerel.hour),
                }
            )
        sonuc.append(
            {
                "date": gun,
                "has_available": any(x["status"] == "available" for x in slots),
                "slots": slots,
            }
        )
    return sonuc


async def list_slots(
    db: AsyncSession,
    tutor: Tutor,
    *,
    day_from: datetime.date,
    days: int,
    duration_min: int,
    now: datetime.datetime,
) -> dict:
    """Eğitmen profilindeki ders talep ızgarası: slotlar, kurallar ve fiyat."""
    from services import time_off_service  # döngüsel import: o modül bizi içe aktarır

    windows = (
        await db.execute(
            select(TutorAvailability).where(TutorAvailability.tutor_id == tutor.id)
        )
    ).scalars().all()
    tz = _yerel_tz()
    bugun = now.astimezone(tz).date()
    # Pencere dışı "from" pencerenin son ucuna kırpılır: çok ileri tarihte
    # (ör. 9999-12-31) tarih aritmetiği taşmaz, sonuç boş gün listesidir.
    ilk_gun = min(
        max(day_from, bugun),
        bugun + datetime.timedelta(days=settings.BOOKING_WINDOW_DAYS),
    )
    aralik_bas = datetime.datetime.combine(ilk_gun, datetime.time(0), tzinfo=tz)
    aralik_son = min(
        aralik_bas + datetime.timedelta(days=days), booking_window_end(now)
    )

    busy: list[tuple[datetime.datetime, datetime.datetime]] = []
    time_off: list[tuple[datetime.datetime, datetime.datetime]] = []
    extras: list[tuple[datetime.datetime, datetime.datetime]] = []
    if aralik_son > aralik_bas:
        extras = await _ek_araliklar(db, tutor.id, aralik_bas, aralik_son)
    if (windows or extras) and aralik_son > aralik_bas:
        rows = (
            await db.execute(
                select(Booking.start_at, Booking.end_at).where(
                    Booking.tutor_id == tutor.id,
                    Booking.deleted_at.is_(None),
                    Booking.status.in_([BookingStatus.PENDING, BookingStatus.ACCEPTED]),
                    Booking.time_slot.op("&&")(
                        func.tstzrange(aralik_bas, aralik_son, "[)")
                    ),
                )
            )
        ).all()
        busy = [(_utc(a), _utc(b)) for a, b in rows]
        time_off = [
            (_utc(t.start_at), _utc(t.end_at))
            for t in await time_off_service.list_time_off(
                db, tutor, start=aralik_bas, end=aralik_son
            )
        ]

    price = _compute_price(
        tutor, aralik_bas, aralik_bas + datetime.timedelta(minutes=duration_min)
    )
    return {
        "days": build_slots(
            windows,
            busy,
            time_off,
            extras=extras,
            day_from=ilk_gun,
            days=days,
            duration_min=duration_min,
            now=now,
        ),
        "has_availability": bool(windows) or bool(extras),
        "window_end": booking_window_end(now),
        "policy": {
            "min_notice_hours": settings.BOOKING_MIN_NOTICE_HOURS,
            "window_days": settings.BOOKING_WINDOW_DAYS,
            "late_cancel_hours": settings.LESSON_LATE_CANCEL_HOURS,
        },
        "price": {
            "amount": str(price) if price is not None else None,
            "currency": "TRY",
        },
    }


async def create_booking(
    db: AsyncSession, client: Client, data: BookingCreate
) -> Booking:
    tutor = await get_bookable_tutor(db, data.tutor_id)
    # Engellenen öğrenci o eğitmene yeni ders talebi açamaz (Modül 5).
    await messaging_service.assert_booking_not_blocked(
        db, tutor_id=tutor.id, client_id=client.id
    )
    _assert_booking_rules(data.start_at, _utcnow())

    await _lock_tutor(db, tutor.id)
    # İzin önce: izinli günde öğrenci "pencere dışı" yerine asıl nedeni görür.
    await _assert_not_on_time_off(db, tutor.id, data.start_at, data.end_at)
    await _assert_within_availability(db, tutor.id, data.start_at, data.end_at)

    # Ücretsiz ilk ders: eğitmen sunuyor + öğrencinin bu eğitmenle geçmiş dersi yok.
    is_free_lesson = False
    if data.free_lesson:
        if not tutor.first_lesson_free:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Bu öğretmen ücretsiz ilk ders sunmuyor",
            )
        if not await _is_eligible_for_free_lesson(db, tutor.id, client.id):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Ücretsiz ilk ders hakkın bu öğretmen için kullanılmış",
            )
        is_free_lesson = True

    # Ders biçimi: eğitmen tek mod sunuyorsa o sabittir; BOTH/None ise istemci seçer.
    requested = data.mode.value if data.mode else None
    if tutor.teaching_mode in ("ONLINE", "IN_PERSON"):
        if requested and requested != tutor.teaching_mode:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "This tutor does not offer the selected lesson mode",
            )
        mode = tutor.teaching_mode
    else:
        mode = requested or "ONLINE"

    price = (
        Decimal("0.00")
        if is_free_lesson
        else _compute_price(tutor, data.start_at, data.end_at)
    )
    booking = Booking(
        client_id=client.id,
        tutor_id=data.tutor_id,
        start_at=data.start_at,
        end_at=data.end_at,
        price=price,
        is_free_lesson=is_free_lesson,
        notes=data.notes,
        mode=mode,
        location=data.location,
        location_lat=data.location_lat,
        location_lng=data.location_lng,
    )
    db.add(booking)
    await db.flush()  # GiST exclusion violation surfaces here -> IntegrityError -> 409
    await db.refresh(booking)
    await notification_service.notify(
        db,
        user_id=booking.tutor_id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message=f"{client.display_name} yeni bir ders talebi gönderdi.",
        link="/tutor",
    )
    _notify_booking_update(db, booking)
    # Sohbete gömülü ders talebi kartı enjekte et (Airbnb tarzı)
    await messaging_service.inject_system_message(
        db,
        client_id=client.id,
        tutor_id=booking.tutor_id,
        msg_type="booking_card",
        body=f"{client.display_name} yeni bir ders talebi gönderdi.",
        meta_data={
            "booking_id": booking.id,
            "status": booking.status.value,
            "start_at": booking.start_at.isoformat(),
            "end_at": booking.end_at.isoformat(),
            "price": str(booking.price) if booking.price else None,
            "is_free_lesson": booking.is_free_lesson,
            "mode": booking.mode,
            "notes": booking.notes,
            "client_name": client.display_name,
        },
    )
    return await get_booking(db, booking.id, viewer=client)


async def offer_lesson(db: AsyncSession, tutor: Tutor, data) -> Booking:
    """Eğitmen kendi öğrencisine ders TEKLİF eder (Modül 8).

    Teklif de `PENDING` bir rezervasyondur; farkı `offered_by_tutor` ile
    işaretlenir ve yanıtı ÖĞRENCİ verir: kabul edince `accept` çalışır, ödeme
    kaydı doğar. Böylece öğrencinin rızası ve emanet akışı korunur — eğitmen tek
    başına öğrenciye borç çıkaramaz.

    Kurallar öğrenci talebiyle AYNI yerden gelir: 24 saat kuralı, 14 günlük
    pencere, izin ve müsaitlik. Fark yalnız iki yerde:
      * yalnız daha önce ilişkisi olan öğrenciye teklif edilebilir,
      * fiyat indirilebilir ama ilan ücretinin üstüne çıkamaz.
    """
    _assert_booking_rules(data.start_at, _utcnow())
    if not await has_relationship(db, tutor_id=tutor.id, client_id=data.client_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Yalnız daha önce dersi olan öğrencine ders teklif edebilirsin.",
        )
    client = await db.get(Client, data.client_id)
    if client is None or getattr(client, "deleted_at", None) is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Öğrenci bulunamadı")

    await _lock_tutor(db, tutor.id)
    await _assert_not_on_time_off(db, tutor.id, data.start_at, data.end_at)
    await _assert_within_availability(db, tutor.id, data.start_at, data.end_at)

    mode, price = _teklif_modu_ve_ucreti(
        tutor,
        data.mode.value if data.mode else None,
        data.price,
        data.start_at,
        data.end_at,
    )
    booking = await _teklif_yaz(
        db,
        tutor,
        client,
        start_at=data.start_at,
        end_at=data.end_at,
        price=price,
        mode=mode,
        notes=data.notes,
        location=data.location,
        location_lat=data.location_lat,
        location_lng=data.location_lng,
    )
    return await get_booking(db, booking.id, viewer=tutor)


def _teklif_modu_ve_ucreti(
    tutor: Tutor,
    requested_mode: str | None,
    requested_price,
    start_at: datetime.datetime,
    end_at: datetime.datetime,
) -> tuple[str, Decimal | None]:
    """Teklifin ders biçimi ve ücreti (tek teklif ve haftalık seri ortak).

    Eğitmen tek mod sunuyorsa o sabittir; ücret indirilebilir ama ilan ücreti ×
    süreyi aşamaz (öğrenci ilanda gördüğünden fazla ödemez). Boş ücret ilan
    ücretidir.
    """
    if tutor.teaching_mode in ("ONLINE", "IN_PERSON"):
        if requested_mode and requested_mode != tutor.teaching_mode:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Bu ders biçimini sunmuyorsun.",
            )
        mode = tutor.teaching_mode
    else:
        mode = requested_mode or "ONLINE"

    ilan_ucreti = _compute_price(tutor, start_at, end_at)
    if requested_price is None:
        return mode, ilan_ucreti
    price = Decimal(str(requested_price))
    if ilan_ucreti is not None and price > ilan_ucreti:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Teklif ücreti ilanındaki ücretten yüksek olamaz.",
        )
    return mode, price


async def _teklif_yaz(
    db: AsyncSession,
    tutor: Tutor,
    client: Client,
    *,
    start_at: datetime.datetime,
    end_at: datetime.datetime,
    price: Decimal | None,
    mode: str,
    notes: str | None,
    location: str | None,
    location_lat,
    location_lng,
    series_id: int | None = None,
    bildir: bool = True,
) -> Booking:
    """Kuralları çağıranda doğrulanmış bir teklifi yazar (Modül 8 + haftalık seri).

    Booking ekler ve flush eder (çakışma → GiST exclusion → IntegrityError),
    sohbete `booking_card` bırakır; ``bildir`` açıksa öğrenciye bildirim gider.
    Seri kaydı toplu tek bildirim gönderdiği için ``bildir=False`` geçer.
    """
    booking = Booking(
        client_id=client.id,
        tutor_id=tutor.id,
        start_at=start_at,
        end_at=end_at,
        price=price,
        notes=notes,
        mode=mode,
        location=location,
        location_lat=location_lat,
        location_lng=location_lng,
        offered_by_tutor=True,
        series_id=series_id,
    )
    db.add(booking)
    await db.flush()  # çakışma → GiST exclusion → IntegrityError → 409
    await db.refresh(booking)
    if bildir:
        await notification_service.notify(
            db,
            user_id=booking.client_id,
            role_id=ROLE_IDS[RoleType.CLIENT],
            message=f"{tutor.display_name} sana ders teklif etti.",
            link=f"/ders-talepleri/{booking.id}",
        )
    _notify_booking_update(db, booking)
    meta = {
        "booking_id": booking.id,
        "status": booking.status.value,
        "start_at": booking.start_at.isoformat(),
        "end_at": booking.end_at.isoformat(),
        "price": str(booking.price) if booking.price else None,
        "is_free_lesson": booking.is_free_lesson,
        "mode": booking.mode,
        "notes": booking.notes,
        "offered_by_tutor": True,
        "client_name": client.display_name,
    }
    if series_id is not None:
        meta["series_id"] = series_id
    await messaging_service.inject_system_message(
        db,
        client_id=client.id,
        tutor_id=tutor.id,
        msg_type="booking_card",
        body=f"{tutor.display_name} sana ders teklif etti.",
        meta_data=meta,
    )
    return booking


async def _ogrenci_mesgul_mu(
    db: AsyncSession,
    client_id: int,
    start_at: datetime.datetime,
    end_at: datetime.datetime,
) -> bool:
    """Öğrencinin herhangi bir eğitmenle çakışan aktif (PENDING/ACCEPTED) dersi var mı?

    Yalnız haftalık seri kullanır; eğitmene hangi eğitmenle olduğu söylenmez.
    """
    return bool(
        await db.scalar(
            select(
                exists().where(
                    Booking.client_id == client_id,
                    Booking.deleted_at.is_(None),
                    Booking.status.in_([BookingStatus.PENDING, BookingStatus.ACCEPTED]),
                    Booking.start_at < end_at,
                    Booking.end_at > start_at,
                )
            )
        )
    )


ERR_WITHDRAW_OWNER = "Yalnız kendi teklifini geri çekebilirsin."
ERR_WITHDRAW_STATE = "Yalnız yanıt bekleyen teklif geri çekilebilir."


async def _teklifi_geri_cek_yaz(db: AsyncSession, booking: Booking, *, reason: str) -> bool:
    """Bekleyen, ödemesiz teklifi `REJECTED`'a atomik çeker.

    Durum `CANCELLED` değil `REJECTED`: iptal oranı metriği
    (`tutor_analytics_service._cancel_rate`) yalnız eğitmen iptallerini sayar;
    geri çekilen teklif bir iptal değildir. Ödemesi olan (kabul edilip
    ertelenmiş) ders WHERE koşuluyla dışarıda kalır — iade yolu gerektirir.
    False → claim kaybedildi, hiçbir alan yazılmadı.
    """
    from models.payment import Payment

    odemesiz = ~select(Payment.id).where(Payment.booking_id == Booking.id).exists()
    if not await _claim_transition(
        db,
        booking,
        BookingStatus.REJECTED,
        extra_where=(Booking.offered_by_tutor.is_(True), odemesiz),
    ):
        return False
    booking.cancel_reason = reason
    booking.cancelled_by_role = ROLE_IDS[RoleType.TUTOR]
    await db.flush()
    _notify_booking_update(db, booking)
    return True


async def withdraw_offer(db: AsyncSession, booking: Booking, tutor: Tutor) -> Booking:
    """Eğitmen yanıt bekleyen teklifini geri çeker (`REJECTED`, iptal sayılmaz)."""
    if booking.tutor_id != tutor.id or not booking.offered_by_tutor:
        raise HTTPException(status.HTTP_403_FORBIDDEN, ERR_WITHDRAW_OWNER)
    if await payment_service.get_for_booking(db, booking.id) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, ERR_WITHDRAW_STATE)
    if not await _teklifi_geri_cek_yaz(
        db, booking, reason="Öğretmen teklifi geri çekti."
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, ERR_WITHDRAW_STATE)
    await notification_service.notify(
        db,
        user_id=booking.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message=f"{tutor.display_name} ders teklifini geri çekti.",
        link=f"/ders-talepleri/{booking.id}",
    )
    return await get_booking(db, booking.id, viewer=tutor)


#: "Önerilen eylem" öncelik sırası: ilk eşleşen gösterilir. Hepsinin arkasında
#: eğitmenin gerçekten kullanabileceği bir uç vardır; "onaylamasını hatırlat"
#: ya da "değerlendirme iste" gibi ucu OLMAYAN öneriler bilerek yoktur.
_ONERILEN_EYLEM_SIRASI = (
    # (anahtar, sayaç alanı) — sırası karardır.
    ("RESPOND_REQUEST", "bekleyen_talep"),
    ("COMPLETE_LESSON", "tamamlanacak"),
    ("OFFER_PENDING", "bekleyen_teklif"),
)


def ogrenci_turu(*, haftalik: bool, deneme_var: bool, ucretli_var: bool) -> str | None:
    """Öğrenci ilişkisinin türü (Öğrenciler sayfasındaki rozet).

    Preply'daki abonelik/paket/kurumsal türlerinin bizde karşılığı yok; üç
    değer gerçek veriden gelir. Yalnız iptal/red kaydı olan öğrenci türsüzdür.
    """
    if haftalik:
        return "WEEKLY"
    if ucretli_var:
        return "SINGLE"
    if deneme_var:
        return "TRIAL"
    return None


def onerilen_eylem(
    *,
    bekleyen_talep: int | None,
    tamamlanacak: int | None,
    bekleyen_teklif: int | None,
    sonraki_ders,
) -> dict | None:
    """Sıradaki eylem; yoksa ders planlama önerisi, o da yoksa ``None``."""
    adaylar = {
        "bekleyen_talep": bekleyen_talep,
        "tamamlanacak": tamamlanacak,
        "bekleyen_teklif": bekleyen_teklif,
    }
    for anahtar, alan in _ONERILEN_EYLEM_SIRASI:
        if adaylar[alan]:
            return {"kind": anahtar, "booking_id": int(adaylar[alan])}
    if sonraki_ders is None:
        return {"kind": "PLAN_LESSON", "booking_id": None}
    return None


async def list_tutor_students(
    db: AsyncSession,
    tutor: Tutor,
    *,
    now: datetime.datetime,
    limit: int = 100,
):
    """Eğitmenin ders ilişkisi olan öğrencileri (ders teklifi + Öğrenciler sayfası).

    Liste üyeliği `has_relationship` ile AYNI: silinmemiş herhangi bir
    rezervasyon (status filtresi YOK). Sıra en son rezervasyonu yeni olana
    göre; ad ve avatar dışında öğrenci verisi dönmez.

    - ``son_ders``: başlamış ACCEPTED/COMPLETED ders; iptal/red sayılmaz.
      ACCEPTED dahil, çünkü ders ancak onay penceresinden sonra COMPLETED olur.
    - ``sonraki_ders``: kabul edilmiş ilk gelecek ders; PENDING teklif/talep
      planlanmış bir ders değildir.
    - ``tamamlanan``: yalnız COMPLETED (onaylı) dersler (kullanıcı kararı,
      22 Eyl 2026) — Öğrenciler sayfasındaki "Toplam ders".
    - ``kind``: ilişkinin türü — aktif haftalık serisi varsa WEEKLY, yalnız
      ücretsiz ilk dersi varsa TRIAL, ücretli dersi varsa SINGLE.
    - ``suggested_action``: "Önerilen eylem" kolonu; yalnız eğitmenin GERÇEKTEN
      yapabileceği bir uç varsa doldurulur (`_ONERILEN_EYLEM_SIRASI`).
    - ``ders_sayisi``: tüm rezervasyon kaydı (talep/teklif dahil); ders teklifi
      penceresi bunu gösterir, anlamı değişmez.
    """
    baslamis = Booking.start_at <= now
    yasayan = Booking.status.in_(
        [BookingStatus.PENDING, BookingStatus.ACCEPTED, BookingStatus.COMPLETED]
    )
    stmt = (
        select(
            Client.id,
            Client.first_name.label("full_name"),
            Client.avatar_url,
            func.max(Booking.start_at)
            .filter(
                Booking.status.in_(
                    [BookingStatus.ACCEPTED, BookingStatus.COMPLETED]
                ),
                baslamis,
            )
            .label("son_ders"),
            func.min(Booking.start_at)
            .filter(
                Booking.status == BookingStatus.ACCEPTED,
                Booking.start_at > now,
            )
            .label("sonraki_ders"),
            func.count(Booking.id)
            .filter(Booking.status == BookingStatus.COMPLETED)
            .label("tamamlanan"),
            func.count(Booking.id).label("ders_sayisi"),
            func.bool_or(Booking.is_free_lesson).filter(yasayan).label("deneme_var"),
            func.bool_or(~Booking.is_free_lesson).filter(yasayan).label("ucretli_var"),
            func.min(Booking.start_at)
            .filter(Booking.is_free_lesson, yasayan)
            .label("deneme_tarihi"),
            func.min(Booking.start_at)
            .filter(
                Booking.status.in_([BookingStatus.ACCEPTED, BookingStatus.COMPLETED])
            )
            .label("ilk_ders"),
            # Öğrencinin YANIT BEKLEYEN talebi (eğitmen kabul/ret verecek).
            func.min(Booking.id)
            .filter(
                Booking.status == BookingStatus.PENDING,
                Booking.offered_by_tutor.is_(False),
                Booking.start_at > now,
            )
            .label("bekleyen_talep"),
            # Eğitmenin gönderdiği, öğrencinin yanıtlamadığı teklif (bilgi).
            func.min(Booking.id)
            .filter(
                Booking.status == BookingStatus.PENDING,
                Booking.offered_by_tutor.is_(True),
                Booking.start_at > now,
            )
            .label("bekleyen_teklif"),
            # Saati geçmiş ama hâlâ tamamlanmamış ders.
            func.min(Booking.id)
            .filter(Booking.status == BookingStatus.ACCEPTED, Booking.end_at <= now)
            .label("tamamlanacak"),
            # Aktif haftalık seri. `Client.id` GROUP BY'da olduğu için gruplu
            # sorguda geçerli; JOIN'e çevrilirse satırlar çoğalır ve
            # count/min alanları bozulur.
            exists()
            .where(
                LessonSeries.tutor_id == tutor.id,
                LessonSeries.client_id == Client.id,
                LessonSeries.status == LessonSeriesStatus.ACTIVE.value,
            )
            .label("haftalik"),
        )
        .join(Booking, Booking.client_id == Client.id)
        .where(Booking.tutor_id == tutor.id, Booking.deleted_at.is_(None))
        .group_by(Client.id, Client.first_name, Client.avatar_url)
        .order_by(func.max(Booking.start_at).desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()
    return [
        {
            "client_id": r.id,
            "full_name": r.full_name,
            "avatar_url": r.avatar_url,
            "last_lesson_at": r.son_ders,
            "next_lesson_at": r.sonraki_ders,
            "completed_lesson_count": int(r.tamamlanan or 0),
            "lesson_count": int(r.ders_sayisi),
            "kind": ogrenci_turu(
                haftalik=bool(r.haftalik),
                deneme_var=bool(r.deneme_var),
                ucretli_var=bool(r.ucretli_var),
            ),
            "trial_at": r.deneme_tarihi,
            "first_lesson_at": r.ilk_ders,
            "suggested_action": onerilen_eylem(
                bekleyen_talep=r.bekleyen_talep,
                tamamlanacak=r.tamamlanacak,
                bekleyen_teklif=r.bekleyen_teklif,
                sonraki_ders=r.sonraki_ders,
            ),
        }
        for r in rows
    ]


async def list_client_tutors(
    db: AsyncSession,
    client: Client,
    *,
    now: datetime.datetime,
    limit: int = 100,
):
    """Öğrencinin ders ilişkisi olan öğretmenleri ("Derslerim → Öğretmenlerim").

    `list_tutor_students`in aynadaki eşi; ölçütler birebir aynı tutulur:
    - Liste üyeliği: silinmemiş herhangi bir rezervasyon (deneme dersi dahil).
    - ``son_ders``: başlamış ACCEPTED/COMPLETED ders; iptal/red sayılmaz.
    - ``sonraki_ders``: kabul edilmiş ilk gelecek ders.
    - ``tamamlanan``: yalnız COMPLETED (onaylı) dersler.
    - ``deneme_var``: ücretsiz ilk ders alınmış mı.

    Öğretmenden yalnız ilan yüzeyinde ZATEN herkese açık alanlar döner (ad,
    avatar, adres, saatlik ücret) — yeni bir PII yüzeyi açılmaz.
    """
    baslamis = Booking.start_at <= now
    yasayan = Booking.status.in_(
        [BookingStatus.PENDING, BookingStatus.ACCEPTED, BookingStatus.COMPLETED]
    )
    stmt = (
        select(
            Tutor.id,
            Tutor.first_name,
            Tutor.last_name,
            Tutor.avatar_url,
            Tutor.hourly_rate,
            func.max(Booking.start_at)
            .filter(
                Booking.status.in_(
                    [BookingStatus.ACCEPTED, BookingStatus.COMPLETED]
                ),
                baslamis,
            )
            .label("son_ders"),
            func.min(Booking.start_at)
            .filter(
                Booking.status == BookingStatus.ACCEPTED,
                Booking.start_at > now,
            )
            .label("sonraki_ders"),
            func.count(Booking.id)
            .filter(Booking.status == BookingStatus.COMPLETED)
            .label("tamamlanan"),
            func.bool_or(Booking.is_free_lesson).filter(yasayan).label("deneme_var"),
        )
        .join(Booking, Booking.tutor_id == Tutor.id)
        .where(Booking.client_id == client.id, Booking.deleted_at.is_(None))
        .group_by(
            Tutor.id,
            Tutor.first_name,
            Tutor.last_name,
            Tutor.avatar_url,
            Tutor.hourly_rate,
        )
        .order_by(func.max(Booking.start_at).desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()
    return [
        {
            "tutor_id": r.id,
            "full_name": r.first_name or None,
            "avatar_url": r.avatar_url,
            "hourly_rate": r.hourly_rate,
            "last_lesson_at": r.son_ders,
            "next_lesson_at": r.sonraki_ders,
            "completed_lesson_count": int(r.tamamlanan or 0),
            "trial_only": bool(r.deneme_var) and int(r.tamamlanan or 0) == 0,
        }
        for r in rows
    ]


async def count_completed(db: AsyncSession, *, role_id: int, user_id: int) -> int:
    column = (
        Booking.tutor_id
        if role_id == ROLE_IDS[RoleType.TUTOR]
        else Booking.client_id
    )
    stmt = (
        select(func.count())
        .select_from(Booking)
        .where(
            Booking.status == BookingStatus.COMPLETED,
            Booking.deleted_at.is_(None),
            column == user_id,
        )
    )
    return int((await db.scalar(stmt)) or 0)


async def has_relationship(
    db: AsyncSession, *, tutor_id: int, client_id: int
) -> bool:
    """Eğitmen ↔ öğrenci arasında herhangi bir rezervasyon kaydı var mı?

    İP-3 §4.2: eğitmen yalnız meşru rezervasyon ilişkisi olan öğrencinin
    profilini görür. PENDING talep dahildir (eğitmen kabul etmeden önce
    değerlendirebilmeli) ve geçmiş/sonuçlanmış dersler ilişkiyi DÜŞÜRMEZ —
    ilişki bir kez kurulduysa kalır.
    """
    stmt = select(
        exists().where(
            Booking.tutor_id == tutor_id,
            Booking.client_id == client_id,
            Booking.deleted_at.is_(None),
        )
    )
    return bool(await db.scalar(stmt))


async def get_booking(
    db: AsyncSession, booking_id: int, *, viewer=None
) -> Booking | None:
    # Tutor/Client adı+avatarı ayrı db.get yerine tek sorguda join ile çekilir.
    stmt = (
        select(
            Booking,
            Tutor.first_name,
            Tutor.avatar_url,
            Client.first_name,
            Client.avatar_url,
        )
        .options(
            selectinload(Booking.resources),
            selectinload(Booking.comments),
        )
        .join(Tutor, Booking.tutor_id == Tutor.id)
        .join(Client, Booking.client_id == Client.id)
        .where(Booking.id == booking_id)
    )
    row = (await db.execute(stmt)).first()
    if row is None:
        return None
    booking, tutor_name, tutor_avatar, client_name, client_avatar = row
    if booking.deleted_at is not None:
        return None
    booking.tutor_name = tutor_name
    booking.tutor_avatar_url = tutor_avatar
    booking.client_name = client_name
    booking.client_avatar_url = client_avatar
    # Değerlendirme dersin değil (client, tutor) çiftinindir.
    review_anonim = await db.scalar(
        select(Review.is_anonymous).where(
            Review.client_id == booking.client_id,
            Review.tutor_id == booking.tutor_id,
            Review.deleted_at.is_(None),
        )
    )
    booking.reviewed = _reviewed_bayragi(
        review_anonim,
        ogretmen_bakiyor=viewer is not None
        and viewer.role_id == ROLE_IDS[RoleType.TUTOR],
    )
    # Yalnız öğrenciye hesaplanır (liste ucuyla aynı): öğretmene dönseydi
    # "bu öğrenci beni değerlendirdi" bilgisini anonim yorumda da ele verirdi.
    booking.can_review = (
        viewer is not None
        and viewer.role_id == ROLE_IDS[RoleType.CLIENT]
        and await review_service.degerlendirilebilir_mi(db, booking)
    )
    # Özel notlar yalnızca sahibine döner. viewer verilmezse (örn. dahili çağrı)
    # güvenli tarafta kalıp tüm notları gizleriz.
    if viewer is not None:
        _filter_private_notes(booking, role_id=viewer.role_id, user_id=viewer.id)
    else:
        _set_private_notes_view(booking, [])
    return booking


async def resolve_signal_target(
    db: AsyncSession,
    booking_id: int,
    sender_user_id: int,
    sender_role_id: int,
) -> tuple[int, int] | None:
    """WebRTC (P2P dosya aktarımı) sinyal relay'i için karşı tarafı çözer.

    Gönderen, booking'in katılımcısı (tutoru ya da clientı) ise karşı tarafın
    ``(user_id, role_id)`` ikilisini döndürür; aksi halde ``None`` (yetkisiz).
    Yalnız aktif (PENDING/ACCEPTED) derslerde relay yapılır.
    """
    booking = await db.get(Booking, booking_id)
    if booking is None or booking.deleted_at is not None:
        return None
    if booking.status not in (BookingStatus.PENDING, BookingStatus.ACCEPTED):
        return None
    tutor_role = ROLE_IDS[RoleType.TUTOR]
    client_role = ROLE_IDS[RoleType.CLIENT]
    if sender_role_id == tutor_role and booking.tutor_id == sender_user_id:
        return booking.client_id, client_role
    if sender_role_id == client_role and booking.client_id == sender_user_id:
        return booking.tutor_id, tutor_role
    return None


def _reviewed_bayragi(review_anonim: bool | None, *, ogretmen_bakiyor: bool) -> bool:
    """Ders çıktısındaki ``reviewed``: öğrenci bu öğretmeni değerlendirdi mi?

    Anonim değerlendirme öğretmene "değerlendirildi" olarak görünmez; aksi
    halde ders listesinden yazarın kim olduğu okunurdu.
    """
    if review_anonim is None:
        return False
    return not (review_anonim and ogretmen_bakiyor)


def _hydrated_booking_select():
    """Ad/avatar ve ``reviewed`` bayrağıyla birlikte ders satırı seçer.

    Listeleme ve eğitmen panosu aynı zenginleştirmeyi kullanır; sahiplik ve
    durum filtreleri çağıran tarafta eklenir.
    """
    # Çiftin değerlendirmesinin anonimlik bayrağı; değerlendirme yoksa NULL.
    reviewed_col = (
        select(Review.is_anonymous)
        .where(
            Review.client_id == Booking.client_id,
            Review.tutor_id == Booking.tutor_id,
            Review.deleted_at.is_(None),
        )
        .limit(1)
        .scalar_subquery()
        .label("review_anonim")
    )
    return (
        select(Booking, Tutor.first_name, Tutor.avatar_url, Client.first_name, Client.avatar_url, reviewed_col)
        .options(
            selectinload(Booking.resources),
            selectinload(Booking.comments)
        )
        .join(Tutor, Booking.tutor_id == Tutor.id)
        .join(Client, Booking.client_id == Client.id)
        .where(Booking.deleted_at.is_(None))
    )


async def _hydrate_booking_rows(
    db: AsyncSession, rows, *, role_id: int, user_id: int
) -> list[Booking]:
    bookings: list[Booking] = []
    for booking, tutor_name, tutor_avatar, client_name, client_avatar, review_anonim in rows:
        booking.tutor_name = tutor_name
        booking.tutor_avatar_url = tutor_avatar
        booking.client_name = client_name
        booking.client_avatar_url = client_avatar
        booking.reviewed = _reviewed_bayragi(
            review_anonim, ogretmen_bakiyor=role_id == ROLE_IDS[RoleType.TUTOR]
        )
        # Yalnız öğrencinin tamamlanmış dersleri için sorgu; ötekilerde bayrak
        # zaten False ve her satıra ek sorgu atmak gereksiz.
        booking.can_review = (
            role_id == ROLE_IDS[RoleType.CLIENT]
            and booking.status == BookingStatus.COMPLETED
            and await review_service.degerlendirilebilir_mi(db, booking)
        )
        # Özel notlar yalnızca isteği yapan tarafa döner.
        _filter_private_notes(booking, role_id=role_id, user_id=user_id)
        bookings.append(booking)
    return bookings


async def list_bookings(
    db: AsyncSession,
    *,
    role_id: int,
    user_id: int,
    status_filter: BookingStatus | None = None,
    limit: int = 20,
    offset: int = 0,
    start_from: datetime.datetime | None = None,
    start_to: datetime.datetime | None = None,
    client_id: int | None = None,
) -> list[Booking]:
    """``start_from``/``start_to`` verilirse `[start_from, start_to)` ile kesişen
    dersler döner (takvim haftası). Aralık sınırı router'da denetlenir.

    ``client_id`` yalnız TUTOR'da uygulanır: eğitmenin zaten gördüğü kümeyi tek
    öğrenciye daraltır (Öğrenciler panelindeki "Dersler" sekmesi). Öğrenci ve
    diğer roller kendi kayıtlarını görür, parametre yok sayılır."""
    stmt = _hydrated_booking_select()
    if role_id == ROLE_IDS[RoleType.CLIENT]:
        stmt = stmt.where(Booking.client_id == user_id)
    elif role_id == ROLE_IDS[RoleType.TUTOR]:
        stmt = stmt.where(Booking.tutor_id == user_id)
        if client_id is not None:
            stmt = stmt.where(Booking.client_id == client_id)
    else:
        return []
    if status_filter is not None:
        stmt = stmt.where(Booking.status == status_filter)
    if start_from is not None and start_to is not None:
        stmt = stmt.where(
            Booking.time_slot.op("&&")(func.tstzrange(start_from, start_to, "[)"))
        )
    stmt = stmt.order_by(Booking.start_at.desc()).limit(limit).offset(offset)
    rows = (await db.execute(stmt)).all()
    return await _hydrate_booking_rows(db, rows, role_id=role_id, user_id=user_id)


async def _ilk_kabul_kanali(db: AsyncSession) -> str:
    """İlk kabulde derse yazılacak ödeme kanalı: pazaryeri kolu açıksa emanetli
    (ESCROW), kapalıysa eğitmene doğrudan ödeme (DIRECT, "takvim randevusu")."""
    kol_acik = await payment_gates.branch_open(
        db, payment_gates.PaymentBranch.TUTOR_MARKETPLACE
    )
    return PAYMENT_CHANNEL_ESCROW if kol_acik else PAYMENT_CHANNEL_DIRECT


async def accept(db: AsyncSession, booking: Booking) -> Booking:
    # Atomik claim: eşzamanlı bir iptal/red ile yarışırsa yalnız biri kazanır.
    # Bellek içi `_transition` burada YETMEZ — kabul, `create_for_booking` ile
    # ödeme YÜKÜMLÜLÜĞÜ doğurur; iptal edilmiş bir dersin üzerine yazan bir
    # accept, öğrenciye artık var olmayan bir ders için ödeme borcu çıkarır.
    # Saati geçmiş teklif kabul edilemez: geçmiş bir ders için ödeme borcu
    # doğmasın. Yalnız teklif yolunda (öğrenci talebinde yanıtı eğitmen verir).
    if booking.offered_by_tutor and _utc(booking.start_at) <= _utcnow():
        raise HTTPException(status.HTTP_409_CONFLICT, "Teklifin saati geçti.")
    # Eğitmen kilidi claim'den ÖNCE: izin ekleme ile aynı sırada beklenir.
    await _lock_tutor(db, booking.tutor_id)
    await _assert_not_on_time_off(db, booking.tutor_id, booking.start_at, booking.end_at)
    if not await _claim_transition(db, booking, BookingStatus.ACCEPTED):
        raise _claim_hatasi(booking, BookingStatus.ACCEPTED)
    # Ödeme kanalı claim KAZANILDIKTAN sonra ve yalnız İLK kabulde yazılır;
    # ertelemeden dönen yeniden kabul kanalı değiştirmez (bkz. model yorumu).
    if booking.payment_channel is None:
        booking.payment_channel = await _ilk_kabul_kanali(db)
    dogrudan = booking.payment_channel == PAYMENT_CHANNEL_DIRECT
    # Canlı ders odası yalnızca uzaktan (ONLINE) derslerde üretilir.
    if booking.mode != "IN_PERSON" and not booking.meeting_room:
        booking.meeting_room = f"adana-{booking.id}-{secrets.token_urlsafe(6)}"
    await db.flush()
    if booking.offered_by_tutor:
        await notification_service.notify(
            db,
            user_id=booking.tutor_id,
            role_id=ROLE_IDS[RoleType.TUTOR],
            message=(
                "Ders teklifin kabul edildi; ders takvimine eklendi."
                if dogrudan
                else "Ders teklifin kabul edildi; öğrenci ödeme adımında."
            ),
            link=f"/ders-talepleri/{booking.id}",
        )
    else:
        await notification_service.notify(
            db,
            user_id=booking.client_id,
            role_id=ROLE_IDS[RoleType.CLIENT],
            message=(
                "Rezervasyon talebin kabul edildi; ders takvimine eklendi. "
                "Ders ücretini öğretmenine doğrudan ödersin."
                if dogrudan
                else "Rezervasyon talebin kabul edildi."
            ),
            link="/student/bookings",
        )
    # Emanetli kanalda ödeme kaydı (PENDING) açılır, öğrenci ödemeye
    # yönlendirilir. Doğrudan kanalda platform para tutmaz: kayıt açılmaz;
    # release/refund/reconciler ödeme kaydı yokken zaten dokunmaz.
    if not dogrudan:
        await payment_service.create_for_booking(db, booking)
    _notify_booking_update(db, booking)
    return booking


async def reject(
    db: AsyncSession, booking: Booking, *, reason: str | None = None
) -> Booking:
    """Eğitmen dersi reddeder — emanette para varsa öğrenciye iade edilir.

    İade neden BURADA: `reschedule` ödemesi alınmış (HELD) bir dersi yeniden
    `PENDING`'e alır ve `PENDING → REJECTED` meşru bir geçiştir. Red parayı
    çözmezse ders terminal olur ama emanet HELD'de kalır — ne öğrenciye döner ne
    eğitmene geçer, üstelik hiçbir arka plan tarayıcısı ACCEPTED olmayan bir
    dersin HELD'ini görmez. Sözleşme §3: **HELD yalnız ACCEPTED ile birlikte
    durabilir** (P0-1).
    """
    if not await _claim_transition(db, booking, BookingStatus.REJECTED):
        raise _claim_hatasi(booking, BookingStatus.REJECTED)
    if reason:
        booking.cancel_reason = reason
    await db.flush()
    # Haber, YANITI BEKLEYEN tarafa değil, teklifi/talebi YAPAN tarafa gider.
    if booking.offered_by_tutor:
        message = "Ders teklifin öğrenci tarafından reddedildi."
        if reason:
            message += f" Neden: {reason}"
        await notification_service.notify(
            db,
            user_id=booking.tutor_id,
            role_id=ROLE_IDS[RoleType.TUTOR],
            message=message,
            link=f"/ders-talepleri/{booking.id}",
        )
    else:
        message = "Rezervasyon talebin reddedildi."
        if reason:
            message += f" Neden: {reason}"
        await notification_service.notify(
            db,
            user_id=booking.client_id,
            role_id=ROLE_IDS[RoleType.CLIENT],
            message=message,
            link="/student/bookings",
        )
    # Emanette ödeme varsa öğrenciye iade et (yoksa no-op). Taraf iptaliyle AYNI
    # yol: `escrow.refund_escrow` (claim + iki faz) — paralel bir iade uygulaması
    # yazılmaz, idempotency ve sağlayıcı-başarısızlığı davranışı devralınır.
    await payment_service.refund(db, booking)
    _notify_booking_update(db, booking)
    return booking


def _assert_completable(booking: Booking) -> None:
    """`complete` ön koşulları: ders başlamış olmalı ve ihtilaflı olmamalı.

    Bu bir konfor kontrolü değildir. `complete`, emanetteki parayı eğitmene
    `RELEASED` yapan tek kapıdır; `released_at` damgalandığı anda
    `escrow.begin_refund`'ın `released_at IS NULL` guard'ı iadeyi **kalıcı
    olarak** kapatır (`services/escrow.py`). Yani tek yönlü bir para hareketinin
    ön koşuludur (P0-3 / P0-4).

    Eşik `start_at`'tir, `end_at` değil: öğretmenin ders bitiş saatini beklemeden
    tamamlaması meşrudur (sözleşme §10/3). Karar değişirse burası ve sözleşme
    birlikte güncellenir.
    """
    if booking.is_disputed:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "İhtilaflı bir ders tamamlanamaz; önce ihtilafın çözülmesi gerekir.",
        )
    start = booking.start_at
    if start is None:
        return
    if start.tzinfo is None:
        start = start.replace(tzinfo=datetime.timezone.utc)
    if start > datetime.datetime.now(datetime.timezone.utc):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Henüz başlamamış bir ders tamamlanamaz.",
        )


#: COMPLETED claim'inin ek koşulu: ihtilaflı ders otomatik/elle tamamlanamaz.
#: Bellekteki `_assert_completable` kullanıcıya AÇIKLAYICI hata verir; bu koşul
#: ise kararı satırın kendisinde verir — eşzamanlı "ihtilaf aç" isteğiyle
#: yarışıldığında yalnız biri kazanır (P0-4).
_IHTILAFSIZ = (Booking.is_disputed.is_(False),)


async def complete(db: AsyncSession, booking: Booking) -> Booking:
    _assert_completable(booking)
    if not await _claim_transition(
        db, booking, BookingStatus.COMPLETED, extra_where=_IHTILAFSIZ
    ):
        raise _claim_hatasi(booking, BookingStatus.COMPLETED)
    # Para burada SERBEST BIRAKILMAZ (Modül 2): öğrenci onaylayınca ya da onay
    # penceresi (LESSON_CONFIRM_WINDOW_HOURS) sorunsuz dolunca eğitmene geçer.
    await notification_service.notify(
        db,
        user_id=booking.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message=(
            "Eğitmenin dersi tamamlandı olarak işaretledi. Ders gerçekleştiyse onayla; "
            f"sorun varsa {settings.LESSON_CONFIRM_WINDOW_HOURS} saat içinde bildir."
        ),
        link=f"/ders-talepleri/{booking.id}",
    )
    _notify_booking_update(db, booking)
    return booking


ISSUE_REASONS = frozenset({"TUTOR_ABSENT", "LESSON_NOT_HELD", "OTHER"})


async def confirm_by_student(db: AsyncSession, booking: Booking) -> Booking:
    """Öğrenci "ders gerçekleşti" der: ders tamamlanır, emanet eğitmene geçer."""
    if booking.status not in (BookingStatus.ACCEPTED, BookingStatus.COMPLETED):
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu ders onaylanamaz.")
    now = _utcnow()
    if _utc(booking.start_at) > now:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ders başlamadan onaylanamaz.")
    locked = await _lock_booking(db, booking)
    if locked is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    if locked.student_confirmed_at is not None:
        return locked
    if locked.is_disputed:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Bu ders için sorun bildirdin; yönetici incelemesi sürüyor.",
        )
    if locked.status == BookingStatus.ACCEPTED:
        if not await _claim_transition(
            db, locked, BookingStatus.COMPLETED, extra_where=_IHTILAFSIZ
        ):
            raise _claim_hatasi(locked, BookingStatus.COMPLETED)
    elif locked.status != BookingStatus.COMPLETED:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu ders onaylanamaz.")
    locked.student_confirmed_at = now
    await db.flush()
    await notification_service.notify(
        db,
        user_id=locked.tutor_id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message="Öğrencin dersi onayladı.",
        link=f"/ders-talepleri/{locked.id}",
    )
    await payment_service.release(db, locked)
    _notify_booking_update(db, locked)
    return locked


async def report_issue(
    db: AsyncSession, booking: Booking, *, reason: str, note: str | None
) -> Booking:
    """Öğrenci ders sonrası sorun bildirir; para admin kararına kadar emanette kalır."""
    if reason not in ISSUE_REASONS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Geçersiz sorun nedeni."
        )
    if booking.status not in (BookingStatus.ACCEPTED, BookingStatus.COMPLETED):
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu ders için sorun bildirilemez.")
    now = _utcnow()
    if _utc(booking.start_at) > now:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Ders başlamadan sorun bildirilemez; gerekirse dersi iptal edebilirsin.",
        )
    locked = await _lock_booking(db, booking)
    if locked is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    if locked.student_confirmed_at is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Onayladığın bir ders için sorun bildirilemez."
        )
    if locked.is_disputed:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu ders için zaten sorun bildirdin.")
    if now > issue_report_deadline(locked):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Sorun bildirme süresi ({settings.LESSON_CONFIRM_WINDOW_HOURS} saat) doldu.",
        )
    if await _para_egitmene_gecti_mi(db, locked):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Bu dersin ücreti eğitmene aktarıldı; destek ekibiyle iletişime geç.",
        )
    locked.is_disputed = True
    locked.issue_reported_at = now
    locked.issue_reason = reason
    locked.issue_note = mask_contact_info(note.strip()) if note and note.strip() else None
    await db.flush()
    await notification_service.notify(
        db,
        user_id=locked.tutor_id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message="Öğrencin bir ders için sorun bildirdi; ekibimiz inceleyecek.",
        link=f"/ders-talepleri/{locked.id}",
    )
    _notify_booking_update(db, locked)
    return locked


async def resolve_dispute(
    db: AsyncSession,
    booking: Booking,
    *,
    decision: str,
    note: str | None = None,
) -> Booking:
    """Admin kararı: ihtilaflı derste parayı öğrenciye iade et ya da eğitmene öde.

    ``refund``: ders iptal sayılır ve emanet iade edilir. COMPLETED→CANCELLED
    geçişi `_TRANSITIONS` tablosunda **bilerek yok** — tabloya girerse kullanıcı
    `cancel` yolu tamamlanmış dersi iptal edip iade alabilirdi. Bu geçiş yalnız
    burada, ihtilaflı ve parası dağıtılmamış satıra koşullu UPDATE ile yapılır.
    ``release``: ihtilaf kapanır, ders tamamlanır ve emanet eğitmene geçer.
    """
    if decision not in ("refund", "release"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Geçersiz karar.")
    locked = await _lock_booking(db, booking)
    if locked is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    if not locked.is_disputed:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu derste açık bir ihtilaf yok.")
    if await _para_egitmene_gecti_mi(db, locked):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Kazancı eğitmene serbest bırakılmış bir derste karar verilemez.",
        )
    etiket = "iade" if decision == "refund" else "eğitmene ödeme"
    not_satiri = f"İhtilaf kararı ({etiket})" + (f": {note}" if note else "")
    locked.admin_notes = (
        f"{locked.admin_notes}\n{not_satiri}" if locked.admin_notes else not_satiri
    )

    if decision == "release":
        locked.is_disputed = False
        await db.flush()
        if locked.status == BookingStatus.ACCEPTED:
            if not await _claim_transition(
                db, locked, BookingStatus.COMPLETED, extra_where=_IHTILAFSIZ
            ):
                raise _claim_hatasi(locked, BookingStatus.COMPLETED)
        elif locked.status != BookingStatus.COMPLETED:
            raise HTTPException(status.HTTP_409_CONFLICT, "Bu derste ödeme yapılamaz.")
        mesajlar = (
            (locked.tutor_id, RoleType.TUTOR,
             "Sorun bildirimi incelendi; ders ücreti kazancına eklendi."),
            (locked.client_id, RoleType.CLIENT,
             "Bildirdiğin sorun incelendi; ders gerçekleşmiş kabul edildi."),
        )
        for user_id, role, mesaj in mesajlar:
            await notification_service.notify(
                db, user_id=user_id, role_id=ROLE_IDS[role], message=mesaj,
                link=f"/ders-talepleri/{locked.id}",
            )
        await payment_service.release(db, locked)
    else:
        if locked.status == BookingStatus.ACCEPTED:
            if not await _claim_transition(db, locked, BookingStatus.CANCELLED):
                raise _claim_hatasi(locked, BookingStatus.CANCELLED)
        elif locked.status == BookingStatus.COMPLETED:
            result = await db.execute(
                update(Booking)
                .where(
                    Booking.id == locked.id,
                    Booking.status == BookingStatus.COMPLETED,
                    Booking.is_disputed.is_(True),
                    Booking.deleted_at.is_(None),
                )
                .values(status=BookingStatus.CANCELLED)
                .execution_options(synchronize_session=False)
            )
            if result.rowcount != 1:
                await db.refresh(locked)
                raise _claim_hatasi(locked, BookingStatus.CANCELLED)
            locked.status = BookingStatus.CANCELLED
        else:
            raise HTTPException(status.HTTP_409_CONFLICT, "Bu derste iade yapılamaz.")
        locked.is_disputed = False
        locked.cancel_reason = "Sorun bildirimi sonucu iade"
        locked.cancelled_by_role = ROLE_IDS[RoleType.ADMIN]
        locked.cancelled_at = _utcnow()
        await db.flush()
        mesajlar = (
            (locked.tutor_id, RoleType.TUTOR,
             "Öğrencinin bildirdiği sorun incelendi; ders iptal edildi ve ücret iade edildi."),
            (locked.client_id, RoleType.CLIENT,
             "Bildirdiğin sorun incelendi; ders ücretin iade ediliyor."),
        )
        for user_id, role, mesaj in mesajlar:
            await notification_service.notify(
                db, user_id=user_id, role_id=ROLE_IDS[role], message=mesaj,
                link=f"/ders-talepleri/{locked.id}",
            )
        await payment_service.refund(db, locked)
    _notify_booking_update(db, locked)
    return locked


async def reschedule(
    db: AsyncSession,
    booking: Booking,
    *,
    start_at: datetime.datetime,
    end_at: datetime.datetime,
) -> Booking:
    if booking.status not in (BookingStatus.PENDING, BookingStatus.ACCEPTED):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Only pending or accepted bookings can be rescheduled",
        )
    if is_late_for_changes(booking):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Derse {settings.LESSON_LATE_CANCEL_HOURS} saatten az kaldığı için ders ertelenemez.",
        )
    _assert_booking_rules(
        start_at, _utcnow(), past_message="Cannot reschedule to the past"
    )
    # Eğitmen kilidi claim'den (ders satırı kilidi) ÖNCE alınır.
    await _lock_tutor(db, booking.tutor_id)
    await _assert_not_on_time_off(db, booking.tutor_id, start_at, end_at)
    await _assert_within_availability(db, booking.tutor_id, start_at, end_at)
    # ── Atomik claim: yeni saati YAZMADAN ÖNCE geçişi kazan (P1-B) ──
    #
    # Buradaki yazım eskiden `booking.status = PENDING` biçiminde koşulsuz bir
    # ORM atamasıydı ve bellekteki bayat duruma güveniyordu. Gerçek PG'de
    # ölçülen sonucu: eğitmen `complete` claim'ini kazanıp para RELEASED
    # olduktan SONRA gelen reschedule onun üzerine PENDING yazıyordu →
    # "tamamlanmamış görünen ders + eğitmene dağıtılmış para" ve `released_at`
    # yüzünden kalıcı kapanmış iade yolu.
    #
    # Claim'in kaybedilmesi hâlinde AŞAĞIDAKİ HİÇBİR ALAN yazılmaz: saat, fiyat,
    # ödeme senkronu, oda/hatırlatma sıfırlaması ve bildirim bu satırdan
    # sonradır. Kazanıldığında ise satır kilidi commit'e kadar bizde kalır, yani
    # araya giren bir `complete` artık ACCEPTED bulamaz ve 409 alır.
    if not await _claim_transition(db, booking, BookingStatus.PENDING):
        raise _claim_hatasi(booking, BookingStatus.PENDING)
    booking.start_at = start_at
    booking.end_at = end_at
    # Öğrencinin yeni saat seçmesi, öğretmenin bekleyen saat değişikliğine
    # verilmiş yanıttır: bayrak kalırsa sonraki geç iptal tam iade alırdı.
    booking.tutor_rescheduled_from = None
    # Süre değişmiş olabilir; ücreti güncel saatlik ücretle yeniden hesapla.
    tutor = await db.get(Tutor, booking.tutor_id)
    if tutor is not None:
        booking.price = _compute_price(tutor, start_at, end_at)
    # Mevcut ödemeyi yeni fiyata eşitle (PENDING) ya da HELD + fiyat değişimini
    # reddet (409) — Payment.amount ile booking.price sessizce ayrışamaz.
    await payment_service.sync_amount_with_booking(db, booking)
    # Yeni saat eğitmenin yeniden onayına sunulur; oda/hatırlatma sıfırlanır.
    booking.meeting_room = None
    booking.reminder_sent = False
    await db.flush()  # GiST çakışması -> 409 (global handler)
    await notification_service.notify(
        db,
        user_id=booking.tutor_id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message="Bir rezervasyon yeni bir saate taşındı ve onayını bekliyor.",
        link="/tutor",
    )
    _notify_booking_update(db, booking)
    return booking


# ── Öğretmenin dersi başka zamana alması (24 Eyl 2026, Preply deseni) ─────
#
# Öğrencinin ertelemesinden (yukarıda `reschedule`) farkı: ders BEKLEYEN
# isteğe dönmez, hemen yeni saate taşınır ve ACCEPTED kalır; öğrenciye "yeni
# saat uygun mu" sorulur. Süre ve ücret DEĞİŞMEZ (bitiş eski süreden
# hesaplanır) — emanetteki tutar olduğu gibi kalır. Oda (`meeting_room`)
# korunur: ders kabul edilmiş kalır ve oda yalnız kabulde üretilir. 12 saat
# kuralı öğretmenin ertelemesini ENGELLEMEZ: son dakikada dersi kurtarmanın
# yolu budur (iptal ise kapalıdır). 24 saat bildirim süresi ve müsaitlik
# penceresi aranmaz (öğretmenin kendi takvimi); izin ve çakışma aranır.


def _ogretmen_ertelemesi_bekliyor(booking: Booking) -> bool:
    return booking.tutor_rescheduled_from is not None


async def reschedule_by_tutor(
    db: AsyncSession, booking: Booking, *, start_at: datetime.datetime
) -> Booking:
    start_at = _utc(start_at)
    now = _utcnow()
    if start_at <= now:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ders geçmiş bir saate alınamaz.")
    if start_at >= booking_window_end(now):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Ders en fazla {settings.BOOKING_WINDOW_DAYS} gün sonrasına alınabilir.",
        )
    await _lock_tutor(db, booking.tutor_id)
    locked = await _lock_booking(db, booking)
    if locked is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    if locked.status != BookingStatus.ACCEPTED:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Yalnız onaylanmış bir ders başka zamana alınabilir."
        )
    if _utc(locked.start_at) <= now:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Başlamış bir ders başka zamana alınamaz."
        )
    sure = _utc(locked.end_at) - _utc(locked.start_at)
    end_at = start_at + sure
    await _assert_not_on_time_off(db, locked.tutor_id, start_at, end_at)
    if locked.tutor_rescheduled_from is None:
        locked.tutor_rescheduled_from = locked.start_at
    locked.start_at = start_at
    locked.end_at = end_at
    # Yeni saat için 1 saat önceki hatırlatma yeniden gitsin.
    locked.reminder_sent = False
    await db.flush()  # GiST çakışması -> 409 (global handler)
    await notification_service.notify(
        db,
        user_id=locked.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message=(
            "Öğretmenin dersini başka bir saate aldı. Yeni saat sana uygun mu? "
            "Uygun değilse dersi iptal edebilirsin; ücretin iade edilir."
        ),
        link=f"/ders-talepleri/{locked.id}",
    )
    _notify_booking_update(db, locked)
    return locked


async def accept_tutor_reschedule(db: AsyncSession, booking: Booking) -> Booking:
    """Öğrenci öğretmenin önerdiği yeni saati kabul eder."""
    locked = await _lock_booking(db, booking)
    if locked is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    if not _ogretmen_ertelemesi_bekliyor(locked) or locked.status != BookingStatus.ACCEPTED:
        raise HTTPException(status.HTTP_409_CONFLICT, "Yanıt bekleyen bir saat değişikliği yok.")
    locked.tutor_rescheduled_from = None
    await db.flush()
    await notification_service.notify(
        db,
        user_id=locked.tutor_id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message="Öğrencin dersin yeni saatini onayladı.",
        link=f"/ders-talepleri/{locked.id}",
    )
    _notify_booking_update(db, locked)
    return locked


async def decline_tutor_reschedule(db: AsyncSession, booking: Booking) -> Booking:
    """Öğrenci yeni saati kabul etmez: ders iptal edilir, ücret HER ZAMAN iade.

    `cancel(cancelled_by=öğrenci)` yolu KULLANILMAZ: 12 saatten az kaldıysa o
    yol geç iptal sayıp parayı öğretmene geçirirdi — öğretmen dersi şimdiye
    yakın bir saate alarak bunu kendisi tetikleyebilirdi. İptal öğretmenin
    hanesine yazılır (iptal oranı metriği), `late_cancel` yazılmaz.
    """
    now = _utcnow()
    locked = await _lock_booking(db, booking)
    if locked is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    if not _ogretmen_ertelemesi_bekliyor(locked) or locked.status != BookingStatus.ACCEPTED:
        raise HTTPException(status.HTTP_409_CONFLICT, "Yanıt bekleyen bir saat değişikliği yok.")
    if _utc(locked.start_at) <= now:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Ders başladı; ders yapılmadıysa sorun bildir.",
        )
    if not await _claim_transition(db, locked, BookingStatus.CANCELLED):
        raise _claim_hatasi(locked, BookingStatus.CANCELLED)
    locked.cancel_reason = "Öğretmenin önerdiği yeni saat öğrenciye uymadı."
    locked.cancelled_by_role = ROLE_IDS[RoleType.TUTOR]
    locked.cancelled_at = now
    locked.late_cancel = False
    locked.tutor_rescheduled_from = None
    await db.flush()
    await notification_service.notify(
        db,
        user_id=locked.tutor_id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message="Öğrencine yeni saat uymadı; ders iptal edildi ve ücret öğrenciye iade edildi.",
        link=f"/ders-talepleri/{locked.id}",
    )
    await payment_service.refund(db, locked)
    _notify_booking_update(db, locked)
    return locked


# ── "Onaylamayı hatırlat" (24 Eyl 2026, Preply deseni) ───────────────────


can_remind_confirm = ders_onay_hatirlatma.can_remind_confirm


async def remind_confirm(db: AsyncSession, booking: Booking) -> Booking:
    now = _utcnow()
    if not can_remind_confirm(booking, now):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Bu ders için şu an hatırlatma gönderilemez."
        )
    booking.confirm_reminded_at = now
    await db.flush()
    await notification_service.notify(
        db,
        user_id=booking.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message=(
            "Öğretmenin dersi onaylamanı rica ediyor. Ders gerçekleştiyse onayla; "
            "sorun varsa bildir."
        ),
        link=f"/ders-talepleri/{booking.id}",
    )
    _notify_booking_update(db, booking)
    return booking


async def set_location(
    db: AsyncSession, booking: Booking, *, actor: "Client | Tutor", data: BookingLocationUpdate
) -> Booking:
    booking.location = data.location
    booking.location_lat = data.location_lat
    booking.location_lng = data.location_lng
    await db.flush()
    if actor.role_id == ROLE_IDS[RoleType.CLIENT]:
        rid, rrole, link = booking.tutor_id, ROLE_IDS[RoleType.TUTOR], "/tutor"
    else:
        rid, rrole, link = (
            booking.client_id,
            ROLE_IDS[RoleType.CLIENT],
            "/student/bookings",
        )
    await notification_service.notify(
        db,
        user_id=rid,
        role_id=rrole,
        message="Yüzyüze ders için buluşma yeri güncellendi.",
        link=link,
    )
    _notify_booking_update(db, booking)
    return booking


async def send_due_reminders(db: AsyncSession) -> int:
    now = datetime.datetime.now(datetime.timezone.utc)
    soon = now + datetime.timedelta(hours=1)
    rows = (
        await db.execute(
            select(Booking).where(
                Booking.status == BookingStatus.ACCEPTED,
                Booking.deleted_at.is_(None),
                Booking.reminder_sent.is_(False),
                Booking.start_at > now,
                Booking.start_at <= soon,
            )
        )
    ).scalars().all()
    for b in rows:
        await notification_service.notify(
            db,
            user_id=b.client_id,
            role_id=ROLE_IDS[RoleType.CLIENT],
            message="Dersin yaklaşıyor — yakında başlıyor.",
            link="/student/bookings",
        )
        await notification_service.notify(
            db,
            user_id=b.tutor_id,
            role_id=ROLE_IDS[RoleType.TUTOR],
            message="Yaklaşan dersin var — yakında başlıyor.",
            link="/tutor",
        )
        b.reminder_sent = True
    return len(rows)


async def auto_complete_past_bookings(db: AsyncSession) -> int:
    """Bitişinden AUTO_COMPLETE_GRACE_HOURS saat geçmiş ama hâlâ ACCEPTED olan
    dersleri otomatik COMPLETED'a geçirir. Böylece öğretmen elle işaretlemese de
    öğrencinin değerlendirme ve soru (QA) hakkı açılır.

    **İhtilaflı dersler kapsam dışıdır** (P0-4): `is_disputed`, "bu derste bir
    sorun var, para hareketi beklesin" demenin tek yoludur. Otomatik tamamlama
    parayı `RELEASED` yapar ve `released_at` damgası iadeyi kalıcı olarak
    kapatır — admin ihtilafı çözmeye kalktığında elinde hiçbir araç kalmaz.
    Filtre hem sorguda (gereksiz satır okunmasın) hem claim'in WHERE'inde
    (eşzamanlı ihtilaf açmayla yarış) durur — ikisi de **aynı** `_IHTILAFSIZ`
    koşulundan gelir, yani kural tek yerde tanımlıdır ve biri güncellenip diğeri
    unutulamaz.
    """
    # Modül 2 (17 Eyl 2026): pencere artık LESSON_CONFIRM_WINDOW_HOURS (72 sa).
    # Eğitmenin "Tamamla"sı parayı serbest bırakmadığı için COMPLETED + HELD
    # dersler de burada öğrenci onayı gibi sonuçlanır. Parası dağıtılmış ya da
    # ödemesiz tamamlanmış ders sorguya girmez (her dakika yeniden seçilmesin).
    # Satır FOR UPDATE SKIP LOCKED ile kilitlenir: eşzamanlı sorun bildirimi
    # aynı kilide girer, "sorun bildirilmiş ders + serbest para" oluşamaz.
    from models.payment import Payment

    now = datetime.datetime.now(datetime.timezone.utc)
    cutoff = now - datetime.timedelta(hours=settings.LESSON_CONFIRM_WINDOW_HOURS)
    held_payment = (
        select(Payment.id)
        .where(Payment.booking_id == Booking.id, Payment.status == PaymentStatus.HELD)
        .exists()
    )
    rows = (
        await db.execute(
            select(Booking).where(
                Booking.deleted_at.is_(None),
                Booking.end_at <= cutoff,
                Booking.student_confirmed_at.is_(None),
                *_IHTILAFSIZ,
                (Booking.status == BookingStatus.ACCEPTED)
                | ((Booking.status == BookingStatus.COMPLETED) & held_payment),
            )
        )
    ).scalars().all()
    count = 0
    for booking in rows:
        locked = await _lock_booking(db, booking, skip_locked=True)
        if locked is None or locked.is_disputed or locked.student_confirmed_at is not None:
            continue
        if locked.status == BookingStatus.ACCEPTED:
            # Atomik claim: eşzamanlı cancel ile yarışırsa yalnız biri kazanır.
            if not await _claim_transition(
                db, locked, BookingStatus.COMPLETED, extra_where=_IHTILAFSIZ
            ):
                continue
            await notification_service.notify(
                db,
                user_id=locked.client_id,
                role_id=ROLE_IDS[RoleType.CLIENT],
                # Doğrudan ödemeli derste yorum hakkı yok (yalnız kartla
                # ödenmiş ders değerlendirilir); o hâlde bu vaat verilmez.
                message=(
                    "Dersin tamamlandı. Eğitmene soru sorabilirsin."
                    if locked.payment_channel == PAYMENT_CHANNEL_DIRECT
                    else "Dersin tamamlandı. Değerlendirme yapabilir ve "
                    "eğitmene soru sorabilirsin."
                ),
                link=f"/ders-talepleri/{locked.id}",
            )
        elif locked.status != BookingStatus.COMPLETED:
            continue
        count += 1
        await payment_service.release(db, locked)
        _notify_booking_update(db, locked)
    return count


async def cancel(
    db: AsyncSession,
    booking: Booking,
    *,
    cancelled_by: "Client | Tutor",
    reason: str | None = None,
) -> Booking:
    # 12 saat kuralı (Modül 2, 17 Eyl 2026). Karar claim'den önce verilir; ders
    # saati eşzamanlı değişemez (erteleme de aynı kurala bağlı).
    is_client = cancelled_by.role_id == ROLE_IDS[RoleType.CLIENT]
    now = _utcnow()
    late = is_late_for_changes(booking, now)
    # Öğretmen dersi başka saate aldı ve öğrenci henüz yanıtlamadıysa öğrencinin
    # iptali geç iptal SAYILMAZ: saati değiştiren öğretmen, ücret iade edilir.
    if is_client and _ogretmen_ertelemesi_bekliyor(booking) and _utc(booking.start_at) > now:
        late = False
    if late and not is_client:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Derse {settings.LESSON_LATE_CANCEL_HOURS} saatten az kala dersi iptal "
            "edemezsin; dersi başka zamana alabilirsin.",
        )
    # Başlamış ders hiçbir yoldan iptal edilemez (bekleyen saat değişikliği
    # `late`i düşürse bile) — ders yapılmadıysa sorun bildirilir.
    if booking.status == BookingStatus.ACCEPTED and _utc(booking.start_at) <= now:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Başlamış bir ders iptal edilemez; ders yapılmadıysa sorun bildir.",
        )
    if not await _claim_transition(db, booking, BookingStatus.CANCELLED):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Invalid transition: {booking.status.value} -> {BookingStatus.CANCELLED.value}",
        )
    if reason:
        booking.cancel_reason = reason
    booking.cancelled_by_role = cancelled_by.role_id
    booking.cancelled_at = now
    if late:
        booking.late_cancel = True
    await db.flush()

    # Karşı tarafı bilgilendir (iptal eden client ise tutor'a, tutor ise client'a).
    if cancelled_by.role_id == ROLE_IDS[RoleType.CLIENT]:
        recipient_id, recipient_role, link = (
            booking.tutor_id,
            ROLE_IDS[RoleType.TUTOR],
            "/tutor",
        )
    else:
        recipient_id, recipient_role, link = (
            booking.client_id,
            ROLE_IDS[RoleType.CLIENT],
            "/student/bookings",
        )
    message = f"{cancelled_by.display_name} bir rezervasyonu iptal etti."
    if reason:
        message += f" Neden: {reason}"
    await notification_service.notify(
        db,
        user_id=recipient_id,
        role_id=recipient_role,
        message=message,
        link=link,
    )
    if late:
        # Öğrencinin geç iptali: emanetteki ücret iade edilmez, eğitmene geçer
        # (ödenmemişse para hareketi yoktur).
        await payment_service.release(db, booking)
    else:
        # Emanette ödeme varsa öğrenciye iade et (yoksa no-op).
        await payment_service.refund(db, booking)
    _notify_booking_update(db, booking)
    return booking


async def cancel_by_admin(
    db: AsyncSession, booking: Booking, *, reason: str | None = None
) -> Booking:
    """Admin iptali — kullanıcı yolundaki claim + iade disiplininin AYNISI.

    Admin yetkisi "FSM'i ve iadeyi atlama yetkisi" değildir: admin daha fazla
    derse erişebilir, daha az kural uygulayamaz (P0-2). Kullanıcı yolundan tek
    farkı, iptali yapanın taraflardan biri OLMAMASIDIR — bu yüzden bildirim
    **her iki tarafa** gider.

    Kural burada, `admin_service`'te veya router'da değil: para hareketi
    tetikleyen geçişin tek bir uygulaması olsun ki ileride eklenecek her çağıran
    (arka plan işi, toplu işlem, yeni uç) boşluğu miras almasın.

    **Hakedişi dağıtılmış ders iptal edilemez (409).** Üç ölçüt de reddeder:
    booking `COMPLETED`, ödeme `RELEASED`, ya da `released_at` dolu. Üçüncüsü
    fazlalık değildir: "HELD + `released_at` dolu" gibi kısmi/bozuk bir satır
    (elle müdahale, eksik yazım) FSM'e takılmaz ama parası zaten dağıtılmıştır.
    İptal edilirse `escrow.begin_refund`'ın `released_at IS NULL` guard'ı iadeyi
    reddeder ve geriye "iptal edilmiş ders + öğretmene ödenmiş para" çelişkisi
    kalır. Ters hakediş/reverse payout bu paketin kapsamı DIŞINDADIR
    (sözleşme §10/2), bu yüzden tek güvenli cevap iptali hiç yapmamaktır.

    Kontrolün claim'den ÖNCE olması yarışı açmaz: `release` yalnız başarılı bir
    `COMPLETED` claim'inin ardından çağrılır; iptal claim'i booking satırını
    kazandıysa artık yeni bir release başlayamaz, kaybettiyse zaten 409 alır.
    """
    payment = await payment_service.get_for_booking(db, booking.id)
    if payment is not None and (
        payment.status is PaymentStatus.RELEASED or payment.released_at is not None
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Kazancı eğitmene serbest bırakılmış bir ders iptal edilemez; "
            "iade yolu kalıcı olarak kapanmıştır.",
        )
    if not await _claim_transition(db, booking, BookingStatus.CANCELLED):
        raise _claim_hatasi(booking, BookingStatus.CANCELLED)
    booking.cancel_reason = (
        f"Admin İptali: {reason}" if reason else "Admin tarafından iptal edildi."
    )
    booking.cancelled_by_role = ROLE_IDS[RoleType.ADMIN]
    booking.cancelled_at = _utcnow()
    await db.flush()
    mesaj = "Bir dersin yönetici tarafından iptal edildi."
    if reason:
        mesaj += f" Neden: {reason}"
    for user_id, role, link in (
        (booking.tutor_id, RoleType.TUTOR, "/tutor"),
        (booking.client_id, RoleType.CLIENT, "/student/bookings"),
    ):
        await notification_service.notify(
            db,
            user_id=user_id,
            role_id=ROLE_IDS[role],
            message=mesaj,
            link=link,
        )
    # Emanetteki para öğrenciye iade edilir (yoksa no-op) — taraf iptaliyle aynı
    # `escrow.refund_escrow` yolu; iade bildirimi de oradan gider.
    await payment_service.refund(db, booking)
    _notify_booking_update(db, booking)
    return booking


async def add_resource(
    db: AsyncSession,
    booking: Booking,
    actor: "Client | Tutor",
    data: BookingResourceCreate,
) -> Booking:
    resource = BookingResource(
        booking_id=booking.id,
        uploader_role=role_name(actor.role_id),
        uploader_id=actor.id,
        title=mask_contact_info(data.title),
        url=data.url,
    )
    db.add(resource)
    await db.flush()
    # Bildirim
    if actor.role_id == ROLE_IDS[RoleType.CLIENT]:
        recipient_id, recipient_role, link = (
            booking.tutor_id,
            ROLE_IDS[RoleType.TUTOR],
            "/tutor",
        )
    else:
        recipient_id, recipient_role, link = (
            booking.client_id,
            ROLE_IDS[RoleType.CLIENT],
            f"/lesson/{booking.id}",
        )
    await notification_service.notify(
        db,
        user_id=recipient_id,
        role_id=recipient_role,
        message=f"Ders için yeni bir kaynak paylaşıldı: {data.title}",
        link=link,
    )
    return await get_booking(db, booking.id, viewer=actor)


async def delete_resource(
    db: AsyncSession,
    booking: Booking,
    actor: "Client | Tutor",
    resource_id: int,
) -> Booking:
    stmt = select(BookingResource).where(BookingResource.id == resource_id, BookingResource.booking_id == booking.id)
    resource = await db.scalar(stmt)
    if not resource:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resource not found")

    actor_role_name = role_name(actor.role_id)
    if resource.uploader_id != actor.id or resource.uploader_role != actor_role_name:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your resource")

    # Yüklenmiş dosyaysa S3/MinIO objesini de sil (best-effort).
    if getattr(resource, "kind", "link") == "file" and resource.url:
        await storage.delete_file(resource.url)
    await db.delete(resource)
    await db.flush()
    return await get_booking(db, booking.id, viewer=actor)


async def add_uploaded_resource(
    db: AsyncSession,
    booking: Booking,
    actor: "Client | Tutor",
    *,
    url: str,
    file_name: str,
    content_type: str | None,
    size_bytes: int,
) -> Booking:
    """Yüklenmiş bir dosyayı ders kaynağı olarak kaydeder (kind='file')."""
    resource = BookingResource(
        booking_id=booking.id,
        uploader_role=role_name(actor.role_id),
        uploader_id=actor.id,
        title=mask_contact_info(file_name),
        kind="file",
        url=url,
        file_name=file_name,
        content_type=content_type,
        size_bytes=size_bytes,
    )
    db.add(resource)
    await db.flush()
    if actor.role_id == ROLE_IDS[RoleType.CLIENT]:
        recipient_id, recipient_role, link = (
            booking.tutor_id, ROLE_IDS[RoleType.TUTOR], "/tutor",
        )
    else:
        recipient_id, recipient_role, link = (
            booking.client_id, ROLE_IDS[RoleType.CLIENT], f"/lesson/{booking.id}",
        )
    await notification_service.notify(
        db,
        user_id=recipient_id,
        role_id=recipient_role,
        message=f"Ders için yeni bir dosya paylaşıldı: {file_name}",
        link=link,
    )
    return await get_booking(db, booking.id, viewer=actor)


async def add_comment(
    db: AsyncSession,
    booking: Booking,
    actor: "Client | Tutor",
    data: BookingCommentCreate,
) -> Booking:
    if actor.role_id == ROLE_IDS[RoleType.CLIENT]:
        await messaging_service.assert_client_not_blocked(
            db, tutor_id=booking.tutor_id, client_id=booking.client_id
        )
    comment = BookingComment(
        booking_id=booking.id,
        sender_role=role_name(actor.role_id),
        sender_id=actor.id,
        body=mask_contact_info(data.body),
    )
    db.add(comment)
    await db.flush()

    if actor.role_id == ROLE_IDS[RoleType.CLIENT]:
        recipient_id, recipient_role, link = (
            booking.tutor_id,
            ROLE_IDS[RoleType.TUTOR],
            "/tutor",
        )
    else:
        recipient_id, recipient_role, link = (
            booking.client_id,
            ROLE_IDS[RoleType.CLIENT],
            f"/lesson/{booking.id}",
        )
    await notification_service.notify(
        db,
        user_id=recipient_id,
        role_id=recipient_role,
        message=f"{actor.display_name} ders detayına yeni bir not bıraktı.",
        link=link,
    )
    
    ws_outbox.enqueue(
        db,
        {"type": "NEW_BOOKING_COMMENT", "booking_id": booking.id},
        user_id=recipient_id,
        role_id=recipient_role,
    )

    return await get_booking(db, booking.id, viewer=actor)


async def delete_comment(
    db: AsyncSession,
    booking: Booking,
    actor: "Client | Tutor",
    comment_id: int,
) -> Booking:
    stmt = select(BookingComment).where(BookingComment.id == comment_id, BookingComment.booking_id == booking.id)
    comment = await db.scalar(stmt)
    if not comment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comment not found")

    actor_role_name = role_name(actor.role_id)
    if comment.sender_id != actor.id or comment.sender_role != actor_role_name:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your comment")
    
    await db.delete(comment)
    await db.flush()
    return await get_booking(db, booking.id, viewer=actor)

async def add_private_note(
    db: AsyncSession, booking: Booking, actor: "Client | Tutor", note_in: BookingPrivateNoteCreate
) -> Booking:
    note = BookingPrivateNote(
        booking_id=booking.id,
        owner_role=actor.role_id,
        owner_id=actor.id,
        body=note_in.body,
    )
    db.add(note)
    await db.flush()
    return await get_booking(db, booking.id, viewer=actor)

async def delete_private_note(
    db: AsyncSession, booking: Booking, actor: "Client | Tutor", note_id: int
) -> Booking:
    # booking.private_notes get_booking tarafından zaten aktöre filtrelenmiştir;
    # başkasının notu bu listede olmadığı için "yok" sayılır (varlık ifşa edilmez).
    note = next((n for n in booking.private_notes if n.id == note_id), None)
    if not note:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Private note not found")
    if note.owner_role != actor.role_id or note.owner_id != actor.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot delete someone else's note")

    await db.delete(note)
    await db.flush()
    return await get_booking(db, booking.id, viewer=actor)
