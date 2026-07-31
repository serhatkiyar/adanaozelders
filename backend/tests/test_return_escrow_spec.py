"""OrderReturn escrow deseni — soft-delete'siz model desteği.

escrow.claim ve reconciler `deleted_at IS NULL` filtresini sabit uyguluyordu;
OrderReturn yalnız TimestampMixin taşıdığından (soft-delete YOK) bu, kısmi
iade yolunda AttributeError üretirdi.
"""
from __future__ import annotations

from services import escrow


def test_return_spec_dogru_kolonlari_isaret_eder() -> None:
    spec = escrow.RETURN_SPEC
    # Para durumu talep üzerinde: bir siparişte birden çok kısmi iade olabilir.
    assert spec.status_attr == "refund_status"
    assert spec.amount_attr == "refund_amount"
    assert spec.has_released_guard is False
    assert (spec.held, spec.refunding, spec.refunded) == ("NONE", "REFUNDING", "REFUNDED")
    assert spec.reference_prefix == "return"


def test_order_return_soft_delete_tasimaz() -> None:
    """Bu doğruysa claim/reconciler `deleted_at` filtresini ATLAMALIDIR."""
    from models.store import OrderReturn

    assert not hasattr(OrderReturn, "deleted_at")


def test_reconciler_return_talebini_de_devralir() -> None:
    from models.store import OrderReturn
    from services import escrow_reconciler

    models = [m for m, _ in escrow_reconciler._REFUNDING_TARGETS]
    assert OrderReturn in models
