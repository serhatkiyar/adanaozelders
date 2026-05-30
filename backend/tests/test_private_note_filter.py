from types import SimpleNamespace

from models.role import ROLE_IDS, RoleType
from services.booking_service import _filter_private_notes

TUTOR = ROLE_IDS[RoleType.TUTOR]
CLIENT = ROLE_IDS[RoleType.CLIENT]


def _note(role_id, user_id, body):
    return SimpleNamespace(owner_role=role_id, owner_id=user_id, body=body)


def test_only_owner_notes_remain():
    booking = SimpleNamespace(
        private_notes=[
            _note(TUTOR, 1, "tutor gizli"),
            _note(CLIENT, 9, "client gizli"),
            _note(TUTOR, 2, "başka tutor"),
        ]
    )
    # Tutor #1 görüntülüyor: yalnız kendi notu kalmalı.
    _filter_private_notes(booking, role_id=TUTOR, user_id=1)
    assert [n.body for n in booking.private_notes] == ["tutor gizli"]


def test_counterparty_notes_never_leak():
    booking = SimpleNamespace(
        private_notes=[_note(TUTOR, 1, "tutor"), _note(CLIENT, 9, "client")]
    )
    # Client #9 görüntülüyor: tutor'un notu sızmamalı.
    _filter_private_notes(booking, role_id=CLIENT, user_id=9)
    assert all(n.owner_role == CLIENT and n.owner_id == 9 for n in booking.private_notes)
    assert len(booking.private_notes) == 1


def test_no_matching_notes_yields_empty():
    booking = SimpleNamespace(private_notes=[_note(TUTOR, 1, "x")])
    _filter_private_notes(booking, role_id=CLIENT, user_id=5)
    assert booking.private_notes == []
