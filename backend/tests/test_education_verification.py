"""Diploma doğrulama durum geçişleri — DB'siz (stub entity)."""
import types

from services import education_service


def _edu(**kw):
    base = dict(
        verification_code=None,
        document_url=None,
        verification_status="VERIFIED",
        verified_at="2026-01-01",
        verified_by=9,
        verification_note="eski",
    )
    base.update(kw)
    return types.SimpleNamespace(**base)


def test_pending_when_barcode_only():
    edu = _edu(verification_code="AB12-CD34")
    education_service._sync_review_state(edu)
    assert edu.verification_status == "PENDING"
    # Önceki teyit izleri temizlenir.
    assert edu.verified_at is None
    assert edu.verified_by is None
    assert edu.verification_note is None


def test_pending_when_document_only():
    edu = _edu(document_url="https://x/diploma.pdf")
    education_service._sync_review_state(edu)
    assert edu.verification_status == "PENDING"


def test_none_when_no_material():
    edu = _edu()
    education_service._sync_review_state(edu)
    assert edu.verification_status == "NONE"


def test_pending_when_both():
    edu = _edu(verification_code="X", document_url="https://x/d.pdf")
    education_service._sync_review_state(edu)
    assert edu.verification_status == "PENDING"
