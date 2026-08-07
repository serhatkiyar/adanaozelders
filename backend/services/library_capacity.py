"""Kütüphane kolu kontenjan çekirdeği — koltuk yüklemi, kilit ve bilet kodu tekilliği.

Deneme bileti (``ExamRegistration``) ve çalışma alanı rezervasyonu
(``StudyReservation``) aynı kontenjan sözleşmesini paylaşır; kural üç yazma
yolunda da geçerli olmak zorunda olduğu için (kayıt · ödeme · iyzico callback'i)
tek bir yerde durur. Denetim P1-20'nin sebebi tam olarak dağınıklıktı: kontrol
yalnız `register()/reserve()` içindeydi ve ödeme yolları onu hiç görmüyordu.

## Koltuk yüklemi (seat predicate)

Bir satır şu iki hâlde koltuk tutar:

1. ``status ∈ (PAID, ATTENDED)`` — para alınmış, koltuk kalıcı olarak satılmış;
2. ``status = PENDING_PAYMENT`` **ve** ``hold_expires_at > now()`` — ödeme
   yolculuğu sürüyor, koltuk geçici olarak ayrılmış.

``ACTIVE_REGISTRATION_STATUSES`` sabiti bilinçli olarak **DEĞİŞTİRİLMEDİ**.
Denetim onu "PENDING_PAYMENT eklensin" diye işaret ediyor ama o sabit yalnız
kontenjan için kullanılmıyor: operatörün yoklama listesi (`roster`), toplu karne
eşlemesi (`bulk_upload_documents`) ve **kütüphaneyle mesajlaşma kapısı**
(`messaging_service.py:176,182`) de ondan besleniyor. Ödemesiz bir kaydı oraya
sokmak, ödeme yapmamış birine operatör listesinde yer ve DM hakkı vermek olurdu
(P0-6 komşuluğu). Kontenjan bu yüzden AYRI bir yüklemle ifade edilir.

## Tutma neden TTL ile düşer (ve neden ayrı bir arka plan işi yok)

Süresiz tutma, ödeme sayfasını kapatan tek kişinin kontenjanı sonsuza dek
kilitlemesi demektir. Alternatifler:

- *EXPIRED durumu + arka plan süpürgesi*: yeni bir durum değeri
  (`REGISTRATION_TRANSITIONS`, şemalar, frontend) ve yeni bir zamanlanmış iş
  ister; süpürge gecikirse koltuk yine kilitli kalır.
- *TTL yüklemi* (seçilen): tutma bir **zaman damgasıdır**, süresi dolduğu an
  koltuk kendiliğinden boşalır. Hiçbir işin koşmasına bağlı değildir, bu yüzden
  "süpürge çalışmadı" diye bir arıza sınıfı yoktur. Satırın kendisi
  `PENDING_PAYMENT` kalır (öğrenci "Biletlerim"den ödemeyi sürdürebilir; koltuk
  hâlâ boşsa `pay()` onu geri alır).

## Kilit sırası (kanonik)

    Library  →  LibraryExamSession  →  ExamRegistration / StudyReservation

Kontenjan serileştirmesi **advisory** kilitle yapılır (satır kilidiyle değil):
advisory kilitler ayrı bir isim alanındadır, satır yazımlarının kanonik sırasını
bozmaz ve `escrow.py`'deki uçuş-içi iade nöbetiyle aynı mekanizmadır. Sınıf
numaraları tek bir yerde durur: ``services/escrow.py``.

Deneme kolu yalnız **oturum** kilidini, çalışma kolu yalnız **kütüphane**
kilidini alır; hiçbir yol ikisini birden almaz → bu iki sınıf arasında deadlock
kurulamaz.
"""
from __future__ import annotations

import datetime

from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from core import codes
from core.config import settings
from models.library_exam import (
    ACTIVE_REGISTRATION_STATUSES,
    ExamRegistration,
    RegistrationStatus,
)
from models.study_reservation import StudyReservation
from services import escrow


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def seat_hold_deadline() -> datetime.datetime:
    """Yeni bir tutmanın son geçerlilik anı."""
    return _now() + datetime.timedelta(minutes=settings.LIBRARY_SEAT_HOLD_MINUTES)


def holds_seat(model):
    """Koltuk tutan satırların SQL yüklemi (modülün başındaki sözleşme).

    ``func.now()`` bilinçli: karşılaştırma **veritabanı saatiyle** yapılır.
    Uygulama saatini kullanmak, saati kaymış tek bir sunucunun kontenjanı
    kendine göre yorumlamasına yol açardı.
    """
    return or_(
        model.status.in_(ACTIVE_REGISTRATION_STATUSES),
        and_(
            model.status == RegistrationStatus.PENDING_PAYMENT.value,
            model.hold_expires_at.isnot(None),
            model.hold_expires_at > func.now(),
        ),
    )


def hold_is_live(row) -> bool:
    """Satırın tutması hâlâ geçerli mi (Python tarafı — kilit gerektirmeyen yol)."""
    son = getattr(row, "hold_expires_at", None)
    return son is not None and son > _now()


# ── Serileştirme (advisory kilitler) ────────────────────────────────────────────


async def lock_exam_session(db: AsyncSession, session_id: int) -> None:
    """Bir deneme oturumunun kontenjan kararlarını seri hâle getirir."""
    await db.execute(
        text("SELECT pg_advisory_xact_lock(:c, :i)"),
        {"c": escrow.EXAM_SESSION_CAPACITY_LOCK_CLASS, "i": int(session_id)},
    )


async def lock_library(db: AsyncSession, library_id: int) -> None:
    """Bir kütüphanenin çalışma alanı kontenjan kararlarını seri hâle getirir."""
    await db.execute(
        text("SELECT pg_advisory_xact_lock(:c, :i)"),
        {"c": escrow.LIBRARY_CAPACITY_LOCK_CLASS, "i": int(library_id)},
    )


# ── Koltuk sayımı ───────────────────────────────────────────────────────────────


async def count_exam_seats(
    db: AsyncSession, session_id: int, *, exclude_id: int | None = None
) -> int:
    """Bir oturumda koltuk tutan kayıt sayısı.

    ``exclude_id`` verilirse o satır sayılmaz: "benim dışımda kaç koltuk dolu"
    sorusu, kendi tutmasını iki kez saymadan kapasite kontrolü yapmayı sağlar.
    """
    kosullar = [
        ExamRegistration.session_id == session_id,
        ExamRegistration.deleted_at.is_(None),
        holds_seat(ExamRegistration),
    ]
    if exclude_id is not None:
        kosullar.append(ExamRegistration.id != exclude_id)
    return int((await db.execute(select(func.count()).where(*kosullar))).scalar_one())


async def count_study_seats(
    db: AsyncSession,
    library_id: int,
    starts: datetime.datetime,
    ends: datetime.datetime,
    *,
    exclude_id: int | None = None,
) -> int:
    """[starts, ends) penceresiyle çakışan, koltuk tutan rezervasyon sayısı."""
    kosullar = [
        StudyReservation.library_id == library_id,
        StudyReservation.deleted_at.is_(None),
        holds_seat(StudyReservation),
        StudyReservation.starts_at < ends,
        StudyReservation.ends_at > starts,
    ]
    if exclude_id is not None:
        kosullar.append(StudyReservation.id != exclude_id)
    return int((await db.execute(select(func.count()).where(*kosullar))).scalar_one())


# ── Bilet kodu tekilliği ────────────────────────────────────────────────────────
#
# Kod üretimi **iki tabloya birden** bakar: operatör tek ekrandan hem deneme
# biletini hem çalışma rezervasyonunu okutur (`/exam-attendance/verify` token'ı
# önce deneme, sonra çalışma tablosunda arar). Yalnız kendi tablosuna bakan bir
# üretici, iki kol arasında çakışan bir kod dağıtabilir ve doğrulama yanlış
# bileti bulurdu. DB kısıtı tablo başınadır (çapraz tabloya kısıt yazılamaz);
# bu yüzden üretici tarafındaki çapraz kontrol kısıtın tamamlayıcısıdır.
#
# Statü filtresi YOKTUR (eski `_unique_short_code` yalnız PAID/ATTENDED'a
# bakıyordu): `verify_attendance` da statüye bakmadan arar, dolayısıyla iptal
# edilmiş bir kaydın kodunu yeniden dağıtmak doğrulamayı belirsizleştirirdi.

_MAX_DENEME = 12


async def _kod_kullanimda(db: AsyncSession, kolon_adi: str, deger: str) -> bool:
    for model in (ExamRegistration, StudyReservation):
        kolon = getattr(model, kolon_adi)
        var = (
            await db.execute(
                select(model.id).where(kolon == deger, model.deleted_at.is_(None)).limit(1)
            )
        ).first()
        if var is not None:
            return True
    return False


async def unique_short_code(db: AsyncSession) -> str:
    """Her iki kolda da kullanımda olmayan kısa kod (kısmi unique index destekler)."""
    for _ in range(_MAX_DENEME):
        kod = codes.gen_short_code()
        if not await _kod_kullanimda(db, "short_code", kod):
            return kod
    # 31^6 alanda 12 ardışık çakışma gerçekçi değildir; buraya düşmek kodun
    # tükendiğini değil bir şeyin bozulduğunu gösterir. Sessizce çakışan bir kod
    # dağıtmaktansa kısıtın hatasına düşmek yeğdir.
    raise RuntimeError("benzersiz kısa kod üretilemedi")


async def unique_qr_token(db: AsyncSession) -> str:
    """Her iki kolda da kullanımda olmayan QR token'ı.

    192 bitlik alanda çakışma pratikte imkânsızdır; kontrol yine de yapılır
    çünkü asıl risk rastgelelik değil **veri taşıma/geri yükleme** hatalarıdır
    ve kolonun arkasında artık bir kısıt vardır (denetim P2-40).
    """
    for _ in range(_MAX_DENEME):
        token = codes.gen_qr_token()
        if not await _kod_kullanimda(db, "qr_token", token):
            return token
    raise RuntimeError("benzersiz QR token üretilemedi")
