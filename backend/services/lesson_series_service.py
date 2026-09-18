"""Haftalık ders teklifi serisi (takvim).

Seri = seri kaydı + haftalık otomatik teklif. Her hafta, tek ders teklifiyle
(`booking_service.offer_lesson`) AYNI kurallarla bir `PENDING` +
`offered_by_tutor` rezervasyon doğar; para yükümlülüğü yalnız öğrenci o dersi
kabul edince (`accept` → `payment_service.create_for_booking`) ders başına
doğar. Toplu kabul/ödeme yoktur.

* Kayıtta 14 günlük pencereye düşen haftalar hemen teklif olur; sonrakiler
  pencere açıldıkça `generate_due` (arka plan işi) ile üretilir.
* Çakışan hafta atlanır ve eğitmene bildirilir; her hafta yalnız bir kez
  denenir (`generated_until`).
* Seriden gelen son iki teklif kabul edilmediyse seri kendiliğinden biter.
* İki taraf da seriyi bitirebilir: gelecekteki bekleyen teklifler geri
  çekilir, kabul edilmiş dersler kalır.

Kilit sırası: **seri → eğitmen → ders.**
"""
from __future__ import annotations

import datetime
import logging
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import exists, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.booking import Booking, BookingStatus
from models.client import Client
from models.lesson_series import LessonSeries, LessonSeriesStatus
from models.role import ROLE_IDS, RoleType
from models.payment import Payment
from models.tutor import Tutor, TutorAvailability, TutorStatus
from models.tutor_time_off import TutorTimeOff
from services import booking_service, notification_service

logger = logging.getLogger(__name__)

SERIES_MIN_WEEKS = 2
SERIES_MAX_WEEKS = 12

ERR_NONE_PLANNABLE = "Serideki derslerin hiçbiri planlanamıyor."
ERR_NONE_NOW = "İlk iki haftada planlanabilir ders yok; seriyi başka bir tarihle başlat."
ERR_ENDED = "Seri zaten sona ermiş."
ERR_NOT_FOUND = "Seri bulunamadı."
ERR_RELATIONSHIP = "Yalnız daha önce dersi olan öğrencine ders teklif edebilirsin."

#: Atlanan haftanın eğitmene giden bildirimindeki neden metinleri.
NEDEN_METNI = {
    "TOO_SOON": "24 saatten yakın",
    "TIME_OFF": "iznin var",
    "OUTSIDE_AVAILABILITY": "müsaitliğin dışında",
    "TUTOR_BUSY": "o saatte dersin var",
    "STUDENT_BUSY": "öğrencinin başka dersi var",
}

_AKTIF = (BookingStatus.PENDING, BookingStatus.ACCEPTED)

Aralik = tuple[datetime.datetime, datetime.datetime]


# ── Saf fonksiyonlar (DB'siz; `tests/test_ek_aralik_ve_seri.py`) ─────────────


def seri_tarihleri(
    first_start_at: datetime.datetime, duration_min: int, weeks: int
) -> list[Aralik]:
    """Serinin haftalık ders anları. Sabit UTC+3 olduğu için 7 gün eklemek
    İstanbul'da aynı gün ve saati verir."""
    sure = datetime.timedelta(minutes=duration_min)
    return [
        (first_start_at + datetime.timedelta(weeks=i), first_start_at + datetime.timedelta(weeks=i) + sure)
        for i in range(weeks)
    ]


def seri_simulasyonu(
    occ: list[Aralik],
    *,
    now: datetime.datetime,
    window_end: datetime.datetime,
    tutor_busy: list[Aralik],
    client_busy: list[Aralik],
    time_off: list[Aralik],
    windows,
    extras,
) -> list[dict]:
    """Her hafta için OFFER_NOW / LATER / CONFLICT ve neden.

    Neden önceliği: TOO_SOON > TIME_OFF > OUTSIDE_AVAILABILITY > TUTOR_BUSY >
    STUDENT_BUSY. Pencere dışındaki (``start >= window_end``) haftada yalnız
    izin ve müsaitliğe bakılır; temizse LATER (meşguliyet üretim anında
    yeniden denetlenir).
    """
    en_erken = now + datetime.timedelta(hours=settings.BOOKING_MIN_NOTICE_HOURS)
    sonuc: list[dict] = []
    for i, (s, e) in enumerate(occ):
        pencere_disi = s >= window_end
        if s < en_erken:
            reason = "TOO_SOON"
        elif booking_service._cakisir(s, e, time_off):
            reason = "TIME_OFF"
        elif not booking_service.musaitlige_sigar_mi(windows, extras, s, e):
            reason = "OUTSIDE_AVAILABILITY"
        elif pencere_disi:
            reason = None
        elif booking_service._cakisir(s, e, tutor_busy):
            reason = "TUTOR_BUSY"
        elif booking_service._cakisir(s, e, client_busy):
            reason = "STUDENT_BUSY"
        else:
            reason = None
        if reason is not None:
            durum = "CONFLICT"
        else:
            durum = "LATER" if pencere_disi else "OFFER_NOW"
        sonuc.append(
            {"index": i, "start_at": s, "end_at": e, "status": durum, "reason": reason}
        )
    return sonuc


def seri_fiyati(series_price: Decimal | None, ilan: Decimal | None) -> Decimal | None:
    """Ders başı ücret: ``min(seri ücreti, güncel ilan ücreti × süre)``.

    Öğrenci ilanda gördüğünden fazla ödemez; eğitmen ilan ücretini düşürürse
    öğrenci lehine yansır. Seri ücreti boşsa ilan ücreti, ilan ücreti yoksa
    seri ücreti kullanılır.
    """
    if series_price is None:
        return ilan
    fiyat = Decimal(str(series_price))
    if ilan is None:
        return fiyat
    return min(fiyat, Decimal(str(ilan)))


# ── Yardımcılar ──────────────────────────────────────────────────────────────


def _ilk_baslangic(series: LessonSeries) -> datetime.datetime:
    tz = booking_service._yerel_tz()
    yerel = datetime.datetime.combine(
        series.first_date, datetime.time(0), tzinfo=tz
    ) + datetime.timedelta(minutes=series.start_minute)
    return yerel.astimezone(datetime.timezone.utc)


def _yerel_tarih(an: datetime.datetime) -> datetime.date:
    return an.astimezone(booking_service._yerel_tz()).date()


def _taraf_mi(series: LessonSeries, user) -> bool:
    if user.role_id == ROLE_IDS[RoleType.TUTOR]:
        return series.tutor_id == user.id
    if user.role_id == ROLE_IDS[RoleType.CLIENT]:
        return series.client_id == user.id
    return False


def _bitir(series: LessonSeries, now: datetime.datetime, role_id: int | None) -> None:
    series.status = LessonSeriesStatus.ENDED.value
    series.ended_at = now
    series.ended_by_role = role_id


async def _mesgul_araliklar(db: AsyncSession, kosul, bas, son) -> list[Aralik]:
    rows = (
        await db.execute(
            select(Booking.start_at, Booking.end_at).where(
                kosul,
                Booking.deleted_at.is_(None),
                Booking.status.in_(_AKTIF),
                Booking.start_at < son,
                Booking.end_at > bas,
            )
        )
    ).all()
    return [(booking_service._utc(a), booking_service._utc(b)) for a, b in rows]


async def _simule_et(
    db: AsyncSession,
    tutor_id: int,
    client_id: int,
    occ: list[Aralik],
    *,
    now: datetime.datetime,
) -> tuple[list[dict], datetime.datetime]:
    """Veriyi okuyup simülasyonu çalıştırır. Meşguliyet yalnız pencere içinde."""
    window_end = booking_service.booking_window_end(now)
    bas, son = occ[0][0], occ[-1][1]
    tutor_busy = await _mesgul_araliklar(db, Booking.tutor_id == tutor_id, bas, window_end)
    client_busy = await _mesgul_araliklar(db, Booking.client_id == client_id, bas, window_end)
    time_off = [
        (booking_service._utc(a), booking_service._utc(b))
        for a, b in (
            await db.execute(
                select(TutorTimeOff.start_at, TutorTimeOff.end_at).where(
                    TutorTimeOff.tutor_id == tutor_id,
                    TutorTimeOff.start_at < son,
                    TutorTimeOff.end_at > bas,
                )
            )
        ).all()
    ]
    windows = (
        await db.execute(
            select(TutorAvailability).where(TutorAvailability.tutor_id == tutor_id)
        )
    ).scalars().all()
    extras = await booking_service._ek_araliklar(db, tutor_id, bas, son)
    sonuc = seri_simulasyonu(
        occ,
        now=now,
        window_end=window_end,
        tutor_busy=tutor_busy,
        client_busy=client_busy,
        time_off=time_off,
        windows=windows,
        extras=extras,
    )
    return sonuc, window_end


async def _hazirla(db: AsyncSession, tutor: Tutor, data, *, now: datetime.datetime):
    """Ortak ön kontroller: ilişki, öğrenci, ilk ders kuralları, mod ve ücret."""
    if not await booking_service.has_relationship(
        db, tutor_id=tutor.id, client_id=data.client_id
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, ERR_RELATIONSHIP)
    client = await db.get(Client, data.client_id)
    if client is None or getattr(client, "deleted_at", None) is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Öğrenci bulunamadı")
    first_start = data.first_start_at
    first_end = first_start + datetime.timedelta(minutes=data.duration_min)
    # 24 saat ve 14 gün kuralları ilk derse mevcut metinlerle uygulanır.
    booking_service._assert_booking_rules(first_start, now)
    mode, price = booking_service._teklif_modu_ve_ucreti(
        tutor,
        data.mode.value if data.mode else None,
        data.price,
        first_start,
        first_end,
    )
    occ = seri_tarihleri(first_start, data.duration_min, data.weeks)
    return client, mode, price, occ


def _sayimlar(sonuc: list[dict]) -> dict:
    return {
        "offer_now_count": sum(1 for o in sonuc if o["status"] == "OFFER_NOW"),
        "later_count": sum(1 for o in sonuc if o["status"] == "LATER"),
        "conflict_count": sum(1 for o in sonuc if o["status"] == "CONFLICT"),
    }


# ── Uçlar ────────────────────────────────────────────────────────────────────


async def preview_series(db: AsyncSession, tutor: Tutor, data, *, now: datetime.datetime) -> dict:
    """Salt okunur simülasyon: hangi haftalar şimdi, hangileri sonra teklif olur,
    hangileri planlanamaz. Kayıt aynı simülasyonu kilit altında tekrarlar."""
    client, _mode, price, occ = await _hazirla(db, tutor, data, now=now)
    sonuc, window_end = await _simule_et(db, tutor.id, client.id, occ, now=now)
    return {
        "occurrences": sonuc,
        **_sayimlar(sonuc),
        "window_end": window_end,
        "price": {"amount": str(price) if price is not None else None, "currency": "TRY"},
    }


async def create_series(db: AsyncSession, tutor: Tutor, data, *, now: datetime.datetime) -> dict:
    client, mode, _price, occ = await _hazirla(db, tutor, data, now=now)

    await booking_service._lock_tutor(db, tutor.id)
    sonuc, window_end = await _simule_et(db, tutor.id, client.id, occ, now=now)
    sayim = _sayimlar(sonuc)
    if sayim["offer_now_count"] + sayim["later_count"] == 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, ERR_NONE_PLANNABLE)
    # Şimdi hiç teklif çıkmıyorsa seri iki tarafa da görünmez ve bitirilemez
    # kalırdı (bitirme düğmesi seri dersinin sayfasında).
    if sayim["offer_now_count"] == 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, ERR_NONE_NOW)

    yerel_ilk = data.first_start_at.astimezone(booking_service._yerel_tz())
    series = LessonSeries(
        tutor_id=tutor.id,
        client_id=client.id,
        weekday=yerel_ilk.weekday(),
        start_minute=yerel_ilk.hour * 60 + yerel_ilk.minute,
        duration_min=data.duration_min,
        first_date=yerel_ilk.date(),
        weeks=data.weeks,
        price=data.price,
        mode=mode,
        notes=data.notes,
        location=data.location,
        location_lat=data.location_lat,
        location_lng=data.location_lng,
        status=LessonSeriesStatus.ACTIVE.value,
    )
    db.add(series)
    await db.flush()

    offered_ids: list[int] = []
    skipped: list[dict] = []
    for o in sonuc:
        if o["start_at"] >= window_end:
            # Pencere dışı: üretim işi pencere açılınca yeniden dener.
            continue
        series.generated_until = _yerel_tarih(o["start_at"])
        if o["status"] != "OFFER_NOW":
            skipped.append(o)
            continue
        fiyat = seri_fiyati(
            data.price, booking_service._compute_price(tutor, o["start_at"], o["end_at"])
        )
        try:
            async with db.begin_nested():
                b = await booking_service._teklif_yaz(
                    db,
                    tutor,
                    client,
                    start_at=o["start_at"],
                    end_at=o["end_at"],
                    price=fiyat,
                    mode=mode,
                    notes=data.notes,
                    location=data.location,
                    location_lat=data.location_lat,
                    location_lng=data.location_lng,
                    series_id=series.id,
                    bildir=False,
                )
            offered_ids.append(b.id)
        except IntegrityError:
            # Kilit altında olası değil; yine de hafta atlanır, seri kalır.
            for nesne in (tutor, client, series):
                if nesne in db:
                    await db.refresh(nesne)
            skipped.append({**o, "status": "CONFLICT", "reason": "TUTOR_BUSY"})
    await db.flush()

    # Tek bildirim (her ders sohbete ayrı kart olarak düştü).
    await notification_service.notify(
        db,
        user_id=client.id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message=f"{tutor.full_name} sana {data.weeks} haftalık ders serisi teklif etti.",
        link=f"/ders-talepleri/{offered_ids[0]}" if offered_ids else "/student/bookings",
    )
    offered = [
        await booking_service.get_booking(db, bid, viewer=tutor) for bid in offered_ids
    ]
    await db.refresh(series)
    return {"series": series, "offered": offered, "skipped": skipped}


async def get_series(db: AsyncSession, series_id: int, viewer) -> LessonSeries:
    series = await db.get(LessonSeries, series_id)
    if series is None or not _taraf_mi(series, viewer):
        raise HTTPException(status.HTTP_404_NOT_FOUND, ERR_NOT_FOUND)
    return series


async def end_series(db: AsyncSession, series_id: int, actor) -> LessonSeries:
    """Seriyi bitirir: yeni teklif üretilmez, gelecekteki bekleyen (ödemesiz)
    teklifler geri çekilir, kabul edilmiş dersler kalır."""
    series = (
        await db.execute(
            select(LessonSeries)
            .where(LessonSeries.id == series_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if series is None or not _taraf_mi(series, actor):
        raise HTTPException(status.HTTP_404_NOT_FOUND, ERR_NOT_FOUND)
    if series.status == LessonSeriesStatus.ENDED.value:
        raise HTTPException(status.HTTP_409_CONFLICT, ERR_ENDED)

    now = booking_service._utcnow()
    _bitir(series, now, actor.role_id)
    await db.flush()

    bekleyenler = (
        await db.execute(
            select(Booking).where(
                Booking.series_id == series.id,
                Booking.deleted_at.is_(None),
                Booking.status == BookingStatus.PENDING,
                Booking.offered_by_tutor.is_(True),
                Booking.start_at > now,
            )
        )
    ).scalars().all()
    for b in bekleyenler:
        # Ödemesi olan (kabul edilip ertelenmiş) ders claim koşulunda elenir.
        await booking_service._teklifi_geri_cek_yaz(
            db, b, reason="Haftalık seri sona erdi."
        )

    if actor.role_id == ROLE_IDS[RoleType.TUTOR]:
        alici, rol, link = series.client_id, RoleType.CLIENT, "/student/bookings"
        mesaj = (
            f"{actor.full_name} haftalık ders serisini bitirdi; "
            "bekleyen teklifler geri çekildi."
        )
    else:
        alici, rol, link = series.tutor_id, RoleType.TUTOR, "/tutor"
        mesaj = f"{actor.full_name} haftalık ders serisini bitirdi."
    await notification_service.notify(
        db, user_id=alici, role_id=ROLE_IDS[rol], message=mesaj, link=link
    )
    await db.refresh(series)
    return series


# ── Arka plan işi ────────────────────────────────────────────────────────────


def _kabul_edilmedi(
    b: Booking, now: datetime.datetime, odemeli: frozenset[int] = frozenset()
) -> bool:
    """Öğrenci reddetti, ödemesiz teklifi iptal etti ya da teklifin saati geçti
    ve hâlâ bekliyor. Ödeme kaydı olan ders kabul edilmiştir; sonradan iptali
    reddetme sayılmaz."""
    if b.status == BookingStatus.REJECTED and b.cancelled_by_role is None:
        return True
    if (
        b.status == BookingStatus.CANCELLED
        and b.cancelled_by_role == ROLE_IDS[RoleType.CLIENT]
        and b.id not in odemeli
    ):
        return True
    return b.status == BookingStatus.PENDING and booking_service._utc(b.start_at) <= now


async def _son_iki_kabul_edilmedi(
    db: AsyncSession, series: LessonSeries, now: datetime.datetime
) -> bool:
    """Seriden gelen, sonucu belli son iki teklifin ikisi de kabul edilmedi mi?

    Sonucu belli olmayan (saati gelmemiş bekleyen) ve eğitmenin geri çektiği
    teklifler sayılmaz; aksi hâlde yanıt vermeyen öğrenciye pencere hep ileri
    kaydığı için seri hiç durmazdı.
    """
    rows = (
        await db.execute(
            select(Booking).where(
                Booking.series_id == series.id,
                Booking.deleted_at.is_(None),
                Booking.offered_by_tutor.is_(True),
            )
        )
    ).scalars().all()
    tutor_rol = ROLE_IDS[RoleType.TUTOR]
    kararli = [
        b
        for b in rows
        if not (b.status == BookingStatus.REJECTED and b.cancelled_by_role == tutor_rol)
        and not (
            b.status == BookingStatus.PENDING and booking_service._utc(b.start_at) > now
        )
    ]
    kararli.sort(key=lambda b: booking_service._utc(b.start_at), reverse=True)
    son_iki = kararli[:2]
    if len(son_iki) < 2:
        return False
    odemeli = frozenset(
        (
            await db.execute(
                select(Payment.booking_id).where(
                    Payment.booking_id.in_([b.id for b in son_iki])
                )
            )
        ).scalars().all()
    )
    return all(_kabul_edilmedi(b, now, odemeli) for b in son_iki)


async def _hafta_nedeni(
    db: AsyncSession,
    series: LessonSeries,
    s: datetime.datetime,
    e: datetime.datetime,
    now: datetime.datetime,
) -> str | None:
    """Üretim anında haftanın kuralları: mevcut assert'ler ve öğrenci meşguliyeti."""
    try:
        booking_service._assert_booking_rules(s, now)
    except HTTPException:
        return "TOO_SOON"
    try:
        await booking_service._assert_not_on_time_off(db, series.tutor_id, s, e)
    except HTTPException:
        return "TIME_OFF"
    try:
        await booking_service._assert_within_availability(db, series.tutor_id, s, e)
    except HTTPException:
        return "OUTSIDE_AVAILABILITY"
    egitmen_mesgul = await db.scalar(
        select(
            exists().where(
                Booking.tutor_id == series.tutor_id,
                Booking.deleted_at.is_(None),
                Booking.status.in_(_AKTIF),
                Booking.start_at < e,
                Booking.end_at > s,
            )
        )
    )
    if egitmen_mesgul:
        return "TUTOR_BUSY"
    if await booking_service._ogrenci_mesgul_mu(db, series.client_id, s, e):
        return "STUDENT_BUSY"
    return None


async def _seri_uret(db: AsyncSession, series_id: int, *, now: datetime.datetime) -> int:
    series = (
        await db.execute(
            select(LessonSeries)
            .where(
                LessonSeries.id == series_id,
                LessonSeries.status == LessonSeriesStatus.ACTIVE.value,
            )
            .with_for_update(skip_locked=True)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if series is None:
        return 0

    tutor = await db.get(Tutor, series.tutor_id)
    client = await db.get(Client, series.client_id)
    if (
        tutor is None
        or tutor.deleted_at is not None
        or not tutor.is_active
        or tutor.status != TutorStatus.APPROVED
        or client is None
        or client.deleted_at is not None
        or not client.is_active
    ):
        _bitir(series, now, None)
        await db.flush()
        return 0

    if await _son_iki_kabul_edilmedi(db, series, now):
        _bitir(series, now, None)
        await db.flush()
        await notification_service.notify(
            db,
            user_id=series.tutor_id,
            role_id=ROLE_IDS[RoleType.TUTOR],
            message=(
                "Öğrencin haftalık serideki son iki teklifi kabul etmediği için "
                "seri sona erdi."
            ),
            link="/tutor",
        )
        return 0

    occ = seri_tarihleri(_ilk_baslangic(series), series.duration_min, series.weeks)
    window_end = booking_service.booking_window_end(now)
    uretilen = 0
    kilitli = False
    for s, e in occ:
        tarih = _yerel_tarih(s)
        if series.generated_until is not None and tarih <= series.generated_until:
            continue
        if s >= window_end:
            break
        if not kilitli:
            await booking_service._lock_tutor(db, tutor.id)
            kilitli = True
        neden = await _hafta_nedeni(db, series, s, e, now)
        if neden is None:
            fiyat = seri_fiyati(series.price, booking_service._compute_price(tutor, s, e))
            try:
                async with db.begin_nested():
                    await booking_service._teklif_yaz(
                        db,
                        tutor,
                        client,
                        start_at=s,
                        end_at=e,
                        price=fiyat,
                        mode=series.mode or "ONLINE",
                        notes=series.notes,
                        location=series.location,
                        location_lat=series.location_lat,
                        location_lng=series.location_lng,
                        series_id=series.id,
                        bildir=True,
                    )
                uretilen += 1
            except IntegrityError:
                for nesne in (tutor, client, series):
                    if nesne in db:
                        await db.refresh(nesne)
                neden = "TUTOR_BUSY"
        if neden is not None:
            yerel = s.astimezone(booking_service._yerel_tz())
            await notification_service.notify(
                db,
                user_id=series.tutor_id,
                role_id=ROLE_IDS[RoleType.TUTOR],
                message=(
                    f"{yerel:%d.%m.%Y %H:%M} haftalık dersi planlanamadı: "
                    f"{NEDEN_METNI[neden]}"
                ),
                link="/tutor",
            )
        series.generated_until = tarih

    if series.generated_until is not None and series.generated_until >= _yerel_tarih(
        occ[-1][0]
    ):
        _bitir(series, now, None)
    await db.flush()
    return uretilen


async def generate_due(db: AsyncSession, *, now: datetime.datetime) -> int:
    """Pencereye giren haftaları teklif olarak üretir; her seriden sonra commit.

    Bir serinin hatası diğerlerini durdurmaz (geri alınır ve loglanır).
    """
    ids = (
        await db.execute(
            select(LessonSeries.id)
            .where(LessonSeries.status == LessonSeriesStatus.ACTIVE.value)
            .order_by(LessonSeries.id)
        )
    ).scalars().all()
    toplam = 0
    for series_id in ids:
        try:
            toplam += await _seri_uret(db, series_id, now=now)
            await db.commit()
        except Exception:
            logger.exception("haftalık seri üretimi başarısız: %s", series_id)
            await db.rollback()
    return toplam
