import datetime
from decimal import Decimal

from services import commission

_NOW = datetime.datetime(2026, 6, 18, 12, 0, tzinfo=datetime.timezone.utc)
_DEF = Decimal("0.10")


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
