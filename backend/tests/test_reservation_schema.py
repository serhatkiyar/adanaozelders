"""Decimal amount, str alanına model_validate ile sığmalı (coerce_numbers_to_str).
Bu olmadan reserve/register commit'ten SONRA serileştirmede 500 verir."""

import datetime
from decimal import Decimal
from types import SimpleNamespace

from schemas.library_exam import RegistrationOut
from schemas.study import StudyReservationOut


def _now() -> datetime.datetime:
    return datetime.datetime(2026, 6, 6, 12, 0, tzinfo=datetime.timezone.utc)


def test_study_reservation_out_coerces_decimal_amount():
    row = SimpleNamespace(
        id=1, library_id=1, client_id=6,
        starts_at=_now(), ends_at=_now(), status="PAID",
        amount=Decimal("30.00"), currency="TRY",
        paid_at=_now(), attended_at=None, qr_token="abc", created_at=_now(),
    )
    out = StudyReservationOut.model_validate(row)
    assert out.amount == "30.00"
    assert isinstance(out.amount, str)


def test_registration_out_coerces_decimal_amount():
    row = SimpleNamespace(
        id=1, session_id=1, client_id=6, status="PAID",
        amount=Decimal("125.50"), currency="TRY",
        paid_at=_now(), attended_at=None, qr_token="xyz", created_at=_now(),
        session=None,
    )
    out = RegistrationOut.model_validate(row)
    assert out.amount == "125.50"
    assert isinstance(out.amount, str)
