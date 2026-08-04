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


def test_return_spec_referansi_TAHSILATIN_kimligidir() -> None:
    """İP2A-02: sağlayıcı referansı talebin değil, TAHSİLATIN kimliğidir.

    Bu iddia bu testte bir kez TERS yazılmıştı (`reference_prefix == "return"`)
    ve kusuru sabitliyordu: charge `order:{order_id}` conversationId'siyle
    yapılır, iyzico `payment/detail` yalnız onu tanır. `return:{return_id}`
    referansı hiçbir zaman eşleşmez → sarkan kısmi iade pozitif kanıt
    bulamaz, 3 denemede kalıcı olarak askıda kalır.
    """
    spec = escrow.RETURN_SPEC
    assert spec.reference_prefix == "order"
    assert spec.reference_id_attr == "order_id"


def test_return_spec_manuel_inceleme_durumu_tanimli() -> None:
    """PK-δ: deneme tavanı dolan iade sessiz log'da değil, sorgulanabilir
    bir DURUMDA durmalı."""
    from models.store import ReturnRefundStatus

    assert escrow.RETURN_SPEC.manual_review == ReturnRefundStatus.MANUAL_REVIEW.value
    assert escrow.ORDER_SPEC.manual_review is not None


def test_escrow_spec_kilit_siniflari_TEKIL() -> None:
    """Advisory kilit sınıfı model başına tekil olmalı: iki model aynı sınıfı
    paylaşırsa birbirinin iadesini gereksizce bloklar/atlar."""
    specs = [
        escrow.PAYMENT_SPEC, escrow.EXAM_SPEC, escrow.STUDY_SPEC,
        escrow.ORDER_SPEC, escrow.RETURN_SPEC,
    ]
    siniflar = [s.lock_class for s in specs]
    assert len(set(siniflar)) == len(siniflar), f"çakışan kilit sınıfı: {siniflar}"
    assert all(c > 0 for c in siniflar), "kilit sınıfı 0 bırakılamaz"


def test_order_return_soft_delete_tasimaz() -> None:
    """Bu doğruysa claim/reconciler `deleted_at` filtresini ATLAMALIDIR."""
    from models.store import OrderReturn

    assert not hasattr(OrderReturn, "deleted_at")


def test_reconciler_return_talebini_de_devralir() -> None:
    from models.store import OrderReturn
    from services import escrow_reconciler

    models = [m for m, _ in escrow_reconciler._REFUNDING_TARGETS]
    assert OrderReturn in models
