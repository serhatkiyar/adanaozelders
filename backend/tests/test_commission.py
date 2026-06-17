import datetime
from decimal import Decimal

from core.config import settings
from services import commission

_NOW = datetime.datetime(2026, 6, 18, 12, 0, tzinfo=datetime.timezone.utc)
_DEF = Decimal("0.10")


def _enable_promo(monkeypatch, months=3, rate=0.0):
    monkeypatch.setattr(settings, "LAUNCH_PROMO_MONTHS", months)
    monkeypatch.setattr(settings, "LAUNCH_PROMO_COMMISSION_RATE", rate)


def test_no_override_returns_default():
    assert commission.effective_commission_rate(None, None, default=_DEF) == _DEF


def test_override_without_until_is_permanent():
    r = commission.effective_commission_rate(Decimal("0"), None, now=_NOW, default=_DEF)
    assert r == Decimal("0")


def test_override_active_before_until():
    until = _NOW + datetime.timedelta(days=30)
    r = commission.effective_commission_rate(
        Decimal("0.05"), until, now=_NOW, default=_DEF
    )
    assert r == Decimal("0.05")


def test_override_expired_falls_back_to_default():
    until = _NOW - datetime.timedelta(days=1)
    r = commission.effective_commission_rate(
        Decimal("0"), until, now=_NOW, default=_DEF
    )
    assert r == _DEF


def test_split_rounds_half_up():
    # 99.99 * 0.10 = 9.999 → 10.00 komisyon; kazanç = 89.99
    comm, earn = commission.split(Decimal("99.99"), Decimal("0.10"))
    assert comm == Decimal("10.00")
    assert earn == Decimal("89.99")
    assert comm + earn == Decimal("99.99")


def test_split_zero_rate_promo():
    comm, earn = commission.split(Decimal("100.00"), Decimal("0"))
    assert comm == Decimal("0.00")
    assert earn == Decimal("100.00")


# ── Lansman promosyonu (created_at-bazlı, global; eğitmen+kütüphane ortak) ──

def test_launch_promo_active_within_window(monkeypatch):
    _enable_promo(monkeypatch, months=3, rate=0.0)
    created = _NOW - datetime.timedelta(days=10)  # 10 gün önce kayıt → promo içinde
    r = commission.effective_commission_rate(None, None, created_at=created, now=_NOW, default=_DEF)
    assert r == Decimal("0")


def test_launch_promo_expired_after_window(monkeypatch):
    _enable_promo(monkeypatch, months=3, rate=0.0)
    created = _NOW - datetime.timedelta(days=200)  # 3 aydan eski → promo bitti
    r = commission.effective_commission_rate(None, None, created_at=created, now=_NOW, default=_DEF)
    assert r == _DEF


def test_launch_promo_disabled_by_default(monkeypatch):
    _enable_promo(monkeypatch, months=0)  # KAPALI
    created = _NOW - datetime.timedelta(days=1)
    r = commission.effective_commission_rate(None, None, created_at=created, now=_NOW, default=_DEF)
    assert r == _DEF


def test_special_override_beats_launch_promo(monkeypatch):
    _enable_promo(monkeypatch, months=3, rate=0.0)
    created = _NOW - datetime.timedelta(days=10)
    r = commission.effective_commission_rate(
        Decimal("0.05"), None, created_at=created, now=_NOW, default=_DEF
    )
    assert r == Decimal("0.05")  # tedarikçiye özel override önce gelir
