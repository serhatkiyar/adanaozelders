import pytest
from fastapi import HTTPException

from models.booking import Booking, BookingStatus
from services.booking_service import _transition


def _booking(status: BookingStatus) -> Booking:
    return Booking(status=status)


@pytest.mark.parametrize(
    "src,dst",
    [
        (BookingStatus.PENDING, BookingStatus.ACCEPTED),
        (BookingStatus.PENDING, BookingStatus.REJECTED),
        (BookingStatus.PENDING, BookingStatus.CANCELLED),
        (BookingStatus.ACCEPTED, BookingStatus.COMPLETED),
        (BookingStatus.ACCEPTED, BookingStatus.CANCELLED),
    ],
)
def test_valid_transitions(src, dst):
    b = _booking(src)
    _transition(b, dst)
    assert b.status == dst


@pytest.mark.parametrize(
    "src,dst",
    [
        (BookingStatus.COMPLETED, BookingStatus.CANCELLED),
        (BookingStatus.REJECTED, BookingStatus.ACCEPTED),
        (BookingStatus.CANCELLED, BookingStatus.PENDING),
        (BookingStatus.PENDING, BookingStatus.COMPLETED),
        (BookingStatus.ACCEPTED, BookingStatus.REJECTED),
    ],
)
def test_invalid_transitions_raise_409(src, dst):
    b = _booking(src)
    with pytest.raises(HTTPException) as exc:
        _transition(b, dst)
    assert exc.value.status_code == 409
    # durum değişmemeli
    assert b.status == src
