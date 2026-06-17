"""Kütüphane escrow durum normalizasyonu (DB'siz, saf fonksiyon)."""
import datetime

from models.library_exam import RegistrationStatus
from services.library_service import normalize_escrow_status

_NOW = datetime.datetime(2026, 6, 18, tzinfo=datetime.timezone.utc)


def test_released_takes_priority():
    # released_at doluysa durum ne olursa olsun RELEASED.
    assert (
        normalize_escrow_status(
            status=RegistrationStatus.PAID.value, released_at=_NOW
        )
        == "RELEASED"
    )
    assert (
        normalize_escrow_status(
            status=RegistrationStatus.ATTENDED.value, released_at=_NOW
        )
        == "RELEASED"
    )


def test_paid_maps_to_held():
    assert (
        normalize_escrow_status(
            status=RegistrationStatus.PAID.value, released_at=None
        )
        == "HELD"
    )


def test_pending_payment_maps_to_pending():
    assert (
        normalize_escrow_status(
            status=RegistrationStatus.PENDING_PAYMENT.value, released_at=None
        )
        == "PENDING"
    )


def test_refunded_by_status_or_timestamp():
    assert (
        normalize_escrow_status(
            status=RegistrationStatus.REFUNDED.value, released_at=None
        )
        == "REFUNDED"
    )
    # refunded_at dolu + serbest değilse REFUNDED (status PAID kalmış olsa bile).
    assert (
        normalize_escrow_status(
            status=RegistrationStatus.PAID.value,
            released_at=None,
            refunded_at=_NOW,
        )
        == "REFUNDED"
    )


def test_cancelled_maps_to_cancelled():
    assert (
        normalize_escrow_status(
            status=RegistrationStatus.CANCELLED.value, released_at=None
        )
        == "CANCELLED"
    )
