"""Admin takvimi — kapalı gün söz motoru entegrasyonu (saf birim testleri).

Kapalı günler (resmî tatil / özel gün) haftalık kural gibi atlanır; söz motoru
o günlere söz vermez. Pazar artık VARSAYILAN açık (haftanın 7 günü).
"""

import datetime

from services import delivery_promise as dp


def test_pazar_artik_acik():
    # Pazar (weekday 6), non_working boş → söz o güne verilebilir.
    sunday = datetime.date(2026, 7, 19)  # Pazar
    assert sunday.weekday() == 6
    assert dp.next_working_day(sunday, []) == sunday


def test_kapali_gun_atlanir():
    holiday = datetime.date(2026, 4, 23)  # 23 Nisan
    got = dp.next_working_day(holiday, [], frozenset({holiday}))
    assert got == datetime.date(2026, 4, 24)


def test_ust_uste_kapali_gunler():
    # 3 günlük tatil bloğu → ilk açık gün 4.
    closed = frozenset(
        {
            datetime.date(2026, 3, 21),
            datetime.date(2026, 3, 22),
            datetime.date(2026, 3, 23),
        }
    )
    got = dp.next_working_day(datetime.date(2026, 3, 21), [], closed)
    assert got == datetime.date(2026, 3, 24)


def test_is_closed():
    d = datetime.date(2026, 5, 1)
    assert dp.is_closed(d, [], frozenset({d})) is True
    assert dp.is_closed(d, [6], frozenset()) is False  # Cuma, haftalık kapalı değil
    sunday = datetime.date(2026, 7, 19)
    assert dp.is_closed(sunday, [6], frozenset()) is True  # haftalık kural aktifse


def test_compute_promised_date_tatili_atlar():
    # 22 Nisan 10:00 (cutoff öncesi) → aday 22 Nisan; ama 23 Nisan tatil,
    # 22 zaten açık → 22 döner. Tatili aday gününe koyarsak atlar:
    paid = datetime.datetime(2026, 4, 23, 8, 0, tzinfo=datetime.timezone.utc)
    got = dp.compute_promised_date(
        paid,
        cutoff_hour=16,
        non_working_weekdays=[],
        utc_offset_hours=3,
        closed_dates=frozenset({datetime.date(2026, 4, 23)}),
    )
    assert got == datetime.date(2026, 4, 24)


def test_first_day_with_capacity_tatil_ve_doluluk():
    # 20 Mart dolu + 21 Mart tatil → 22 Mart'a düşer.
    day = datetime.date(2026, 3, 20)
    booked = {datetime.date(2026, 3, 20): 5}
    got = dp.first_day_with_capacity(
        day,
        booked,
        capacity=5,
        non_working_weekdays=[],
        closed_dates=frozenset({datetime.date(2026, 3, 21)}),
    )
    assert got == datetime.date(2026, 3, 22)
