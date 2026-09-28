import datetime

import pytest
from pydantic import ValidationError

from schemas.booking import BookingCreate, BookingResourceCreate

UTC = datetime.timezone.utc


def test_resource_accepts_https_url():
    r = BookingResourceCreate(title="Kaynak", url="https://example.com/pdf")
    assert r.url == "https://example.com/pdf"


@pytest.mark.parametrize(
    "bad_url",
    [
        "javascript:alert(1)",
        "mailto:hoca@gmail.com",
        "tel:+905321234567",
        "data:text/html,<script>",
        "ftp://x.y/z",
    ],
)
def test_resource_rejects_non_http_schemes(bad_url):
    with pytest.raises(ValidationError):
        BookingResourceCreate(title="Kaynak", url=bad_url)


def test_booking_create_requires_tz_aware():
    naive = datetime.datetime(2030, 1, 1, 10, 0, 0)
    with pytest.raises(ValidationError):
        BookingCreate(tutor_id=1, start_at=naive, end_at=naive + datetime.timedelta(hours=1))


def test_booking_create_rejects_end_before_start():
    start = datetime.datetime(2030, 1, 1, 10, 0, 0, tzinfo=UTC)
    with pytest.raises(ValidationError):
        BookingCreate(tutor_id=1, start_at=start, end_at=start - datetime.timedelta(hours=1))


def test_booking_create_valid():
    start = datetime.datetime(2030, 1, 1, 10, 0, 0, tzinfo=UTC)
    bc = BookingCreate(tutor_id=1, start_at=start, end_at=start + datetime.timedelta(hours=1))
    assert bc.tutor_id == 1


def _pencere():
    start = datetime.datetime(2030, 1, 1, 10, 0, 0, tzinfo=UTC)
    return {"start_at": start, "end_at": start + datetime.timedelta(hours=1)}


@pytest.mark.parametrize("bad_id", [0, -1, 2_147_483_648])
def test_booking_create_tutor_id_int_sinirinda(bad_id):
    with pytest.raises(ValidationError):
        BookingCreate(tutor_id=bad_id, **_pencere())
    assert BookingCreate(tutor_id=2_147_483_647, **_pencere()).tutor_id == 2_147_483_647


@pytest.mark.parametrize("bad_id", [0, -1, 2_147_483_648])
def test_booking_offer_client_id_int_sinirinda(bad_id):
    from schemas.booking import BookingOffer

    with pytest.raises(ValidationError):
        BookingOffer(client_id=bad_id, **_pencere())
    assert BookingOffer(client_id=2_147_483_647, **_pencere()).client_id == 2_147_483_647


def test_booking_create_notes_1000_karakter():
    assert len(BookingCreate(tutor_id=1, notes="a" * 1000, **_pencere()).notes) == 1000
    with pytest.raises(ValidationError):
        BookingCreate(tutor_id=1, notes="a" * 1001, **_pencere())
