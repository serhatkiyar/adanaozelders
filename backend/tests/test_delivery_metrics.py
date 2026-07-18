"""Teslimat KPI saf hesabı (Faz 6) — pytest.

Hedef disiplini: ham sayı + oran; payda 0 → None (0 değil, yanıltıcı olurdu).
"""

import datetime

from services.delivery_metrics import DeliveryKpi, is_on_time, rate


def test_rate_payda_sifir_none():
    assert rate(3, 0) is None
    assert rate(0, 0) is None


def test_rate_yuvarlama():
    assert rate(1, 3) == 0.3333
    assert rate(2, 4) == 0.5
    assert rate(5, 5) == 1.0


def test_kpi_oranlari():
    k = DeliveryKpi(
        window_days=30,
        delivered=8,
        failed=2,
        delivered_count=8,
        first_attempt_delivered=6,
        on_time_delivered=7,
        promised_delivered=8,
    )
    assert k.first_attempt_rate == rate(6, 8)  # 0.75
    assert k.on_time_rate == rate(7, 8)  # 0.875
    assert k.failure_rate == rate(2, 10)  # 0.2


def test_kpi_veri_yokken_oranlar_none():
    k = DeliveryKpi(window_days=30)
    assert k.first_attempt_rate is None
    assert k.on_time_rate is None
    assert k.failure_rate is None


def test_is_on_time():
    promised = datetime.date(2026, 7, 18)
    # UTC 2026-07-18 22:00 + 3 saat = yerel 2026-07-19 01:00 → söz gününü GEÇTİ
    late = datetime.datetime(2026, 7, 18, 22, 0, tzinfo=datetime.timezone.utc)
    assert is_on_time(late, promised, 3) is False
    # UTC 2026-07-18 10:00 + 3 = yerel 13:00 aynı gün → zamanında
    ok = datetime.datetime(2026, 7, 18, 10, 0, tzinfo=datetime.timezone.utc)
    assert is_on_time(ok, promised, 3) is True
    # Söz günü ya da teslim yoksa None (paydaya girmez)
    assert is_on_time(None, promised, 3) is None
    assert is_on_time(ok, None, 3) is None


def test_to_dict_anahtarlari():
    d = DeliveryKpi(window_days=7).to_dict()
    for key in (
        "window_days", "delivered", "failed", "rescheduled", "delivered_count",
        "first_attempt_rate", "on_time_rate", "failure_rate",
        "failed_not_courier_fault", "fail_by_reason",
    ):
        assert key in d
