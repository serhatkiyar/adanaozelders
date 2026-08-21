"""Cıncık Teslimat söz/bölge hesapları (saf, DB'siz — pytest'li).

16:00 cutoff kuralı: Adana Merkez siparişi yerel saatle cutoff'tan ÖNCE ödendiyse
aynı gün, sonrasında ertesi gün teslim sözü verilir; sonuç çalışılmayan güne
(varsayılan Pazar) denk gelirse ileri sarılır. Tüm fonksiyonlar `now_utc`/
`paid_at_utc` parametresi alır — sunucu saat dilimine (`datetime.date.today()`)
asla bakılmaz; yerel gün `APP_UTC_OFFSET_HOURS` sabit ofsetiyle bulunur
(booking_service deseni; TR'de DST yok).

Bölge kontrolü: harita pin'i varsa depoya Haversine yarıçapı (otorite), yoksa
yapısal il/ilçe fallback'i. İkisi de yoksa None — "bilinmiyor" (eligible
listesine girmez, admin dış-kargo kuyruğunda görür).
"""
from __future__ import annotations

import datetime
import unicodedata



def _to_local(dt_utc: datetime.datetime, utc_offset_hours: int) -> datetime.datetime:
    if dt_utc.tzinfo is None:
        dt_utc = dt_utc.replace(tzinfo=datetime.timezone.utc)
    tz = datetime.timezone(datetime.timedelta(hours=utc_offset_hours))
    return dt_utc.astimezone(tz)


#: Kapalı günler için makul üst sınır — üst üste bu kadar gün kapalıysa
#: (uzun bayram + hafta kapalılığı) yine de bir gün döner (sonsuz döngü yok).
_MAX_CLOSED_LOOKAHEAD = 30


def is_closed(
    day: datetime.date,
    non_working_weekdays: list[int],
    closed_dates: frozenset[datetime.date] = frozenset(),
) -> bool:
    """Gün teslimata kapalı mı? Haftalık kural (weekday) VEYA admin'in kapalı
    işaretlediği tarih (resmî tatil / özel gün)."""
    return day.weekday() in non_working_weekdays or day in closed_dates


def next_working_day(
    day: datetime.date,
    non_working_weekdays: list[int],
    closed_dates: frozenset[datetime.date] = frozenset(),
) -> datetime.date:
    """Günü, kapalı günleri (haftalık kural + admin takvimi) atlayarak ileri sarar.
    Hepsi kapalıysa sonsuz döngüye girmemek için sınırlı denemede vazgeçer."""
    if len(set(non_working_weekdays)) >= 7:
        return day
    for _ in range(_MAX_CLOSED_LOOKAHEAD):
        if not is_closed(day, non_working_weekdays, closed_dates):
            return day
        day += datetime.timedelta(days=1)
    return day


def compute_promised_date(
    paid_at_utc: datetime.datetime,
    *,
    cutoff_hour: int,
    non_working_weekdays: list[int],
    utc_offset_hours: int,
    closed_dates: frozenset[datetime.date] = frozenset(),
) -> datetime.date:
    """Ödeme anına göre söz verilen teslim günü (yerel takvim günü)."""
    local = _to_local(paid_at_utc, utc_offset_hours)
    day = local.date()
    if local.hour >= cutoff_hour:
        day += datetime.timedelta(days=1)
    return next_working_day(day, non_working_weekdays, closed_dates)


def next_delivery_day(
    now_utc: datetime.datetime,
    *,
    non_working_weekdays: list[int],
    utc_offset_hours: int,
    closed_dates: frozenset[datetime.date] = frozenset(),
) -> datetime.date:
    """Erteleme hedefi: yerel bugünden SONRAKİ ilk çalışma günü ("yarına ertele";
    cutoff'a bakılmaz — müşteri isteğiyle gün atlanır)."""
    local_day = _to_local(now_utc, utc_offset_hours).date()
    return next_working_day(
        local_day + datetime.timedelta(days=1), non_working_weekdays, closed_dates
    )


def first_day_with_capacity(
    day: datetime.date,
    booked: dict[datetime.date, int],
    *,
    capacity: int,
    non_working_weekdays: list[int],
    closed_dates: frozenset[datetime.date] = frozenset(),
    max_days: int = 14,
) -> datetime.date:
    """Kapasiteye duyarlı söz: ``day``'den ileri, kontenjanı dolmamış İLK çalışma
    günü. ``booked`` gün → verilmiş söz sayısı (yalnız bölge-içi açık siparişler).
    Cutoff kuralı tek başına kampanya gününde herkese aynı günü söyler; kapasite
    dolduğunda söz DÜRÜSTÇE sonraki güne kayar (Amazon promise = f(cutoff,
    kalan kapasite) ilkesi). capacity <= 0 → kontrol kapalı. ``max_days``
    emniyet supabıdır (her gün doluysa sonsuz döngü yok — son aday döner)."""
    day = next_working_day(day, non_working_weekdays, closed_dates)
    if capacity <= 0:
        return day
    for _ in range(max_days):
        if booked.get(day, 0) < capacity:
            return day
        day = next_working_day(
            day + datetime.timedelta(days=1), non_working_weekdays, closed_dates
        )
    return day


def cutoff_countdown_seconds(
    now_utc: datetime.datetime, *, cutoff_hour: int, utc_offset_hours: int
) -> int | None:
    """Bugünkü cutoff'a kalan saniye; geçtiyse None (söz artık yarına işler)."""
    local = _to_local(now_utc, utc_offset_hours)
    cutoff = local.replace(hour=cutoff_hour, minute=0, second=0, microsecond=0)
    if local >= cutoff:
        return None
    return int((cutoff - local).total_seconds())


def _fold(s: str) -> str:
    """Türkçe aksan/büyük-küçük duyarsız karşılaştırma anahtarı
    ("Yüreğir" == "YUREGIR")."""
    s = s.strip().casefold().replace("ı", "i")
    decomposed = unicodedata.normalize("NFKD", s)
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def in_delivery_zone(
    city: str | None,
    district: str | None,
    *,
    districts: list[str],
) -> bool:
    """Teslimat noktası kendi-filo bölgesinde mi? Otorite İLÇE LİSTESİDİR.

    İP-19 / K-10: eski hâl pin varsa **yarıçapı** otorite sayıyordu ve yarıçap
    DEPO koordinatından ölçülüyordu — aynı değişken hem rotanın başlangıcı hem
    bölgenin merkeziydi. Depo diye bir şey olmadığı (K-9) ve başlangıç noktası
    veriye taşındığı için o bağ koptu: başlangıç noktası taşınsa bölge kaymaz.

    Kural sahibin kendi cümlesidir: "Adana kent merkezinde dağıtım yapacağız,
    kent merkezi içinde değilse kargo firmasına veririz." İlçe listesi bu
    cümlenin birebir karşılığıdır; yarıçap onun yaklaşık bir vekiliydi.

    İl/ilçe bilinmiyorsa sonuç **bölge dışıdır** (güvenli taraf): yanlış söz
    vermektense sipariş dış kargo kuyruğuna düşer.
    """
    if city and district:
        return _fold(city) == _fold("Adana") and _fold(district) in {
            _fold(d) for d in districts
        }
    return False
