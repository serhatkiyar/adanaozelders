"""Mağaza sipariş durum makinesi (saf) — geçerli/geçersiz geçişler + ön-koşullar."""
from services.order_fsm import ALLOWED_ORDER_TRANSITIONS, can_transition


def test_valid_happy_path_transitions():
    assert can_transition("PENDING", "PAID")
    assert can_transition("PAID", "SHIPPED")
    assert can_transition("SHIPPED", "DELIVERED")


def test_same_status_is_noop_true():
    for s in ("PENDING", "PAID", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"):
        assert can_transition(s, s) is True


def test_mark_delivered_precondition():
    # Yalnız SHIPPED → DELIVERED; PENDING/PAID'den doğrudan teslim edilemez.
    assert can_transition("SHIPPED", "DELIVERED")
    assert not can_transition("PENDING", "DELIVERED")
    assert not can_transition("PAID", "DELIVERED")


def test_shipped_can_revert_to_paid():
    # Teslim edilemedi / tur iptal → SHIPPED geri PAID (yeniden planlanabilir).
    assert can_transition("SHIPPED", "PAID")


def test_terminal_states_have_no_exit():
    assert ALLOWED_ORDER_TRANSITIONS["CANCELLED"] == set()
    assert ALLOWED_ORDER_TRANSITIONS["REFUNDED"] == set()
    assert not can_transition("REFUNDED", "PAID")
    assert not can_transition("CANCELLED", "SHIPPED")


def test_refund_reachable_from_paid_shipped_delivered():
    assert can_transition("PAID", "REFUNDED")
    assert can_transition("SHIPPED", "REFUNDED")
    assert can_transition("DELIVERED", "REFUNDED")


def test_cancel_only_before_shipping():
    assert can_transition("PENDING", "CANCELLED")
    assert can_transition("PAID", "CANCELLED")
    assert not can_transition("SHIPPED", "CANCELLED")
    assert not can_transition("DELIVERED", "CANCELLED")


def test_unknown_status_denied():
    assert not can_transition("BOGUS", "PAID")
    assert not can_transition("PAID", "BOGUS")
