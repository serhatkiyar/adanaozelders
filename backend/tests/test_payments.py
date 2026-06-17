"""Escrow ödeme: komisyon/earning hesabı + sağlayıcı soyutlaması (DB'siz)."""
from decimal import Decimal

from core import payments
from core.config import settings
from core.payments.fake import FakePaymentProvider
from core.payments.iyzico import IyzicoProvider
from services import commission


def _split(amount: Decimal):
    """Global oranla bölüştürme (komisyon mantığı services.commission'a taşındı)."""
    rate = commission.effective_commission_rate(None, None)
    return commission.split(amount, rate)


def test_split_default_commission(monkeypatch):
    monkeypatch.setattr(settings, "PLATFORM_COMMISSION_RATE", 0.10)
    commission, earning = _split(Decimal("250.00"))
    assert commission == Decimal("25.00")
    assert earning == Decimal("225.00")
    assert commission + earning == Decimal("250.00")


def test_split_other_rate(monkeypatch):
    monkeypatch.setattr(settings, "PLATFORM_COMMISSION_RATE", 0.15)
    commission, earning = _split(Decimal("100.00"))
    assert commission == Decimal("15.00")
    assert earning == Decimal("85.00")


def test_split_rounds_half_up(monkeypatch):
    monkeypatch.setattr(settings, "PLATFORM_COMMISSION_RATE", 0.10)
    # 99.99 * 0.10 = 9.999 -> 10.00 ; earning = 89.99
    commission, earning = _split(Decimal("99.99"))
    assert commission == Decimal("10.00")
    assert earning == Decimal("89.99")
    assert commission + earning == Decimal("99.99")


def test_provider_selection(monkeypatch):
    payments.get_payment_provider.cache_clear()
    monkeypatch.setattr(settings, "PAYMENT_PROVIDER", "fake")
    assert isinstance(payments.get_payment_provider(), FakePaymentProvider)

    payments.get_payment_provider.cache_clear()
    monkeypatch.setattr(settings, "PAYMENT_PROVIDER", "IYZICO")  # büyük/küçük duyarsız
    assert isinstance(payments.get_payment_provider(), IyzicoProvider)

    payments.get_payment_provider.cache_clear()  # diğer testler için varsayılana dön


async def test_fake_provider_charge_and_refund():
    p = FakePaymentProvider()
    res = await p.charge(
        amount=Decimal("100"), currency="TRY", booking_id=1, description="x"
    )
    assert res.success is True
    assert res.provider_ref is not None
    assert res.redirect_url is None  # fake'te 3DS yönlendirmesi yok
    assert await p.refund(provider_ref=res.provider_ref, amount=Decimal("100")) is True
