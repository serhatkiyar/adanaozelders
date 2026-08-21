"""delivery_promise saf yardımcıları: cutoff/söz günü + bölge kontrolü."""
import datetime

from services.delivery_promise import (
    compute_promised_date,
    cutoff_countdown_seconds,
    in_delivery_zone,
    next_working_day,
)

UTC = datetime.timezone.utc

DISTRICTS = ["Seyhan", "Yüreğir", "Çukurova", "Sarıçam"]


def _promised(paid_local_hhmm: str, date="2026-07-08", non_working=(6,)):
    """Yerel (UTC+3) saatle ödeme → söz günü. 2026-07-08 = Çarşamba."""
    h, m = map(int, paid_local_hhmm.split(":"))
    local = datetime.datetime.fromisoformat(f"{date}T{h:02d}:{m:02d}:00+03:00")
    return compute_promised_date(
        local.astimezone(UTC),
        cutoff_hour=16,
        non_working_weekdays=list(non_working),
        utc_offset_hours=3,
    )


def test_before_cutoff_same_day():
    assert _promised("15:59") == datetime.date(2026, 7, 8)


def test_at_cutoff_next_day():
    assert _promised("16:00") == datetime.date(2026, 7, 9)


def test_after_cutoff_next_day():
    assert _promised("21:30") == datetime.date(2026, 7, 9)


def test_saturday_after_cutoff_skips_sunday():
    # 2026-07-11 Cumartesi 16:05 → Pazar atlanır → Pazartesi.
    assert _promised("16:05", date="2026-07-11") == datetime.date(2026, 7, 13)


def test_sunday_order_rolls_to_monday():
    # Pazar günü (2026-07-12) cutoff öncesi bile olsa çalışılmayan gün → Pazartesi.
    assert _promised("10:00", date="2026-07-12") == datetime.date(2026, 7, 13)


def test_no_non_working_days_seven_day_week():
    assert _promised("10:00", date="2026-07-12", non_working=()) == datetime.date(
        2026, 7, 12
    )


def test_utc_midnight_crossing_uses_local_day():
    # 23:30 UTC = ertesi gün 02:30 yerel (iyzico gece callback'i) — yerel gün esas.
    paid = datetime.datetime(2026, 7, 8, 23, 30, tzinfo=UTC)
    got = compute_promised_date(
        paid, cutoff_hour=16, non_working_weekdays=[6], utc_offset_hours=3
    )
    assert got == datetime.date(2026, 7, 9)  # yerel 9 Tem 02:30, cutoff öncesi → aynı (yerel) gün


def test_naive_datetime_treated_as_utc():
    paid = datetime.datetime(2026, 7, 8, 12, 0)  # tz'siz → UTC varsayılır (=15:00 yerel)
    got = compute_promised_date(
        paid, cutoff_hour=16, non_working_weekdays=[6], utc_offset_hours=3
    )
    assert got == datetime.date(2026, 7, 8)


def test_next_working_day_all_week_closed_gives_up():
    d = datetime.date(2026, 7, 12)
    assert next_working_day(d, list(range(7))) == d


def test_countdown_before_cutoff():
    now = datetime.datetime.fromisoformat("2026-07-08T14:00:00+03:00").astimezone(UTC)
    assert cutoff_countdown_seconds(now, cutoff_hour=16, utc_offset_hours=3) == 7200


def test_countdown_after_cutoff_none():
    now = datetime.datetime.fromisoformat("2026-07-08T16:00:01+03:00").astimezone(UTC)
    assert cutoff_countdown_seconds(now, cutoff_hour=16, utc_offset_hours=3) is None


# ── Bölge kontrolü ────────────────────────────────────────────────────────────────


def _zone(city=None, district=None):
    return in_delivery_zone(city, district, districts=DISTRICTS)


# İP-19/K-10 güncellemesi: eski pin/yarıçap testleri KALDIRILDI — bölge
# kararının tek otoritesi artık ilçe listesidir (yarıçap, uydurma depo
# koordinatına bağlıydı ve depo diye bir şey yok). İmza nöbetçisi ve tam
# vaka matrisi `tests/test_ip19_filo_sozlesme.py::test_D16_*`'dadır; buradaki
# testler fonksiyonun bu dosyadaki mevcut kapsamını (ilçe kararı) korur.


def test_district_authority_in_zone():
    assert _zone(city="Adana", district="Yüreğir") is True


def test_district_case_and_accent_insensitive():
    assert _zone(city="ADANA", district="yuregir") is True
    assert _zone(city="adana", district="CUKUROVA") is True


def test_district_out_of_zone():
    assert _zone(city="Adana", district="Ceyhan") is False
    assert _zone(city="Mersin", district="Seyhan") is False


def test_missing_info_is_out_of_zone():
    # Eski davranış None ("bilinmiyor") idi; İP-19 güvenli tarafa çekti —
    # bilinmeyen adres bölge DIŞI sayılır, dış kargo kuyruğuna düşer (K-10).
    assert _zone() is False
    assert _zone(city="Adana") is False
