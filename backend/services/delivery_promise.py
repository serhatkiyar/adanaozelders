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

from core.routing.haversine import haversine_km


def _to_local(dt_utc: datetime.datetime, utc_offset_hours: int) -> datetime.datetime:
    if dt_utc.tzinfo is None:
        dt_utc = dt_utc.replace(tzinfo=datetime.timezone.utc)
    tz = datetime.timezone(datetime.timedelta(hours=utc_offset_hours))
    return dt_utc.astimezone(tz)


def next_working_day(
    day: datetime.date, non_working_weekdays: list[int]
) -> datetime.date:
    """Günü, çalışılmayan günleri (weekday(); 6=Pazar) atlayarak ileri sarar.
    Tüm hafta kapalıysa sonsuz döngüye girmemek için 7 denemede vazgeçer."""
    if len(set(non_working_weekdays)) >= 7:
        return day
    for _ in range(7):
        if day.weekday() not in non_working_weekdays:
            return day
        day += datetime.timedelta(days=1)
    return day


def compute_promised_date(
    paid_at_utc: datetime.datetime,
    *,
    cutoff_hour: int,
    non_working_weekdays: list[int],
    utc_offset_hours: int,
) -> datetime.date:
    """Ödeme anına göre söz verilen teslim günü (yerel takvim günü)."""
    local = _to_local(paid_at_utc, utc_offset_hours)
    day = local.date()
    if local.hour >= cutoff_hour:
        day += datetime.timedelta(days=1)
    return next_working_day(day, non_working_weekdays)


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
    lat: float | None,
    lng: float | None,
    city: str | None,
    district: str | None,
    *,
    depot_lat: float,
    depot_lng: float,
    radius_km: float,
    districts: list[str],
) -> bool | None:
    """Teslimat noktası kendi-filo bölgesinde mi? Pin varsa Haversine yarıçapı
    (otorite — ilçe sınırları geniş, pin doğru); yoksa il+ilçe fallback;
    hiçbiri yoksa None (bilinmiyor)."""
    if lat is not None and lng is not None:
        return haversine_km(depot_lat, depot_lng, float(lat), float(lng)) <= radius_km
    if city and district:
        return _fold(city) == _fold("Adana") and _fold(district) in {
            _fold(d) for d in districts
        }
    return None
