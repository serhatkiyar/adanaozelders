"""İP-16 gün sınırı (K-9): Europe/Istanbul, 04:00 devrilmesi.

Saf modül — zaman parametreyle enjekte edilir; zoneinfo IO sayılmaz
(sözleşme §2). tzdata bulunamazsa sabit UTC+3 fallback.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from services.spaced_repetition import params

try:  # pragma: no cover - ortam bağımlı
    from zoneinfo import ZoneInfo

    _TZ = ZoneInfo(params.TIMEZONE_NAME)
except Exception:  # pragma: no cover - tzdata yoksa
    _TZ = timezone(timedelta(hours=3), name="TRT")


def study_day(now: datetime) -> date:
    """`now` anının çalışma günü: TR yereline çevir, rollover saatini çıkar."""
    local = now.astimezone(_TZ)
    return (local - timedelta(hours=params.ROLLOVER_HOUR)).date()


def day_start(d: date) -> datetime:
    """`d` çalışma gününün başlangıç anı (yerel 04:00'ün UTC karşılığı)."""
    local = datetime.combine(d, time(hour=params.ROLLOVER_HOUR), tzinfo=_TZ)
    return local.astimezone(timezone.utc)


def next_day_start(now: datetime) -> datetime:
    """Bir sonraki çalışma gününün başlangıcı (bury'nin dolduğu an)."""
    return day_start(study_day(now) + timedelta(days=1))
