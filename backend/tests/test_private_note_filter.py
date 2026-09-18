from sqlalchemy.orm.attributes import get_history

from models.booking import Booking
from models.booking_private_note import BookingPrivateNote
from models.role import ROLE_IDS, RoleType
from services.booking_service import _filter_private_notes

TUTOR = ROLE_IDS[RoleType.TUTOR]
CLIENT = ROLE_IDS[RoleType.CLIENT]


def _note(role_id, user_id, body):
    return BookingPrivateNote(owner_role=role_id, owner_id=user_id, body=body)


def _booking(*notes):
    b = Booking()
    b.private_notes = list(notes)
    return b


def test_only_owner_notes_remain():
    booking = _booking(
        _note(TUTOR, 1, "tutor gizli"),
        _note(CLIENT, 9, "client gizli"),
        _note(TUTOR, 2, "başka tutor"),
    )
    # Tutor #1 görüntülüyor: yalnız kendi notu kalmalı.
    _filter_private_notes(booking, role_id=TUTOR, user_id=1)
    assert [n.body for n in booking.private_notes] == ["tutor gizli"]


def test_counterparty_notes_never_leak():
    booking = _booking(_note(TUTOR, 1, "tutor"), _note(CLIENT, 9, "client"))
    # Client #9 görüntülüyor: tutor'un notu sızmamalı.
    _filter_private_notes(booking, role_id=CLIENT, user_id=9)
    assert all(n.owner_role == CLIENT and n.owner_id == 9 for n in booking.private_notes)
    assert len(booking.private_notes) == 1


def test_no_matching_notes_yields_empty():
    booking = _booking(_note(TUTOR, 1, "x"))
    _filter_private_notes(booking, role_id=CLIENT, user_id=5)
    assert booking.private_notes == []


def test_suzme_orm_degisikligi_uretmez():
    """`private_notes` delete-orphan taşır: süzme koleksiyon DEĞİŞİKLİĞİ olarak
    kaydedilirse düşen (karşı tarafın) notları commit veritabanından siler."""
    booking = _booking(_note(TUTOR, 1, "tutor"), _note(CLIENT, 9, "client"))
    _filter_private_notes(booking, role_id=CLIENT, user_id=9)
    gecmis = get_history(booking, "private_notes")
    assert not gecmis.deleted and not gecmis.added
