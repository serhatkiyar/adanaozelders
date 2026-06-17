"""Payout (alt üye işyeri) servis + şema testleri — DB'siz (stub session + fake sağlayıcı)."""
import types

import pytest
from pydantic import ValidationError

from core.payments.base import SubMerchantInfo, SubMerchantResult
from core.payments.fake import FakePaymentProvider
from schemas.payout import PayoutSubmitIn, mask_iban
from services import payout_service

_VALID_IBAN = "TR330006100519786457841326"


class _StubDB:
    async def flush(self):
        pass

    async def refresh(self, obj):
        pass


def _entity():
    return types.SimpleNamespace(
        sub_merchant_key=None,
        iban=None,
        payout_status="NONE",
        identity_last4=None,
        payout_updated_at=None,
    )


# ── Şema ──

def test_mask_iban():
    assert mask_iban(None) is None
    masked = mask_iban(_VALID_IBAN)
    assert masked is not None and masked.endswith("1326") and "*" in masked


def test_iban_normalized_and_validated():
    p = PayoutSubmitIn(iban="tr33 0006 1005 1978 6457 8413 26", tckn="10000000146")
    assert p.iban == _VALID_IBAN  # boşluklar silinir, büyük harf


def test_iban_invalid_raises():
    with pytest.raises(ValidationError):
        PayoutSubmitIn(iban="TR123", tckn="10000000146")


def test_tckn_invalid_raises():
    with pytest.raises(ValidationError):
        PayoutSubmitIn(iban=_VALID_IBAN, tckn="123")


# ── Servis ──

@pytest.fixture
def fake_provider(monkeypatch):
    monkeypatch.setattr(
        payout_service.payments, "get_payment_provider", lambda: FakePaymentProvider()
    )


async def test_submit_fake_active(fake_provider):
    entity = _entity()
    payload = PayoutSubmitIn(iban=_VALID_IBAN, tckn="10000000146", gsm="5551112233")
    out = await payout_service.submit(
        _StubDB(), entity, external_id="tutor:1", name="Ali Veli", email="a@b.com", payload=payload
    )
    assert out.payout_status == "ACTIVE"
    assert entity.payout_status == "ACTIVE"
    assert entity.sub_merchant_key.startswith("fake-sm-")
    assert entity.iban == _VALID_IBAN
    assert entity.identity_last4 == "0146"  # TCKN son 4
    assert out.iban_masked.endswith("1326")
    assert entity.payout_updated_at is not None


async def test_submit_provider_failure_raises(monkeypatch):
    class _FailProvider(FakePaymentProvider):
        async def create_submerchant(self, info: SubMerchantInfo) -> SubMerchantResult:
            return SubMerchantResult(success=False, error="reddedildi")

    monkeypatch.setattr(
        payout_service.payments, "get_payment_provider", lambda: _FailProvider()
    )
    from fastapi import HTTPException

    entity = _entity()
    payload = PayoutSubmitIn(iban=_VALID_IBAN, tckn="10000000146")
    with pytest.raises(HTTPException) as exc:
        await payout_service.submit(
            _StubDB(), entity, external_id="tutor:1", name="X Y", email="x@y.com", payload=payload
        )
    assert exc.value.status_code == 502
    # Başarısızlıkta varlık değişmez.
    assert entity.payout_status == "NONE"
