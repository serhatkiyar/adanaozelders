"""Öznitelik/medya API sözleşmeleri (manuel vitrin sonrası kalan yüzey)."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from schemas.store_merchandising import (
    AttributeDefinitionWrite,
    AttributeValueWrite,
    ProductAttributeAssignmentWrite,
)


def test_oznitelik_adi_bos_olamaz() -> None:
    with pytest.raises(ValidationError):
        AttributeDefinitionWrite(name="")


def test_deger_etiketi_sinirli() -> None:
    AttributeValueWrite(label="Ciltli")
    with pytest.raises(ValidationError):
        AttributeValueWrite(label="x" * 101)


def test_atamada_tekrar_eden_deger_reddedilir() -> None:
    with pytest.raises(ValidationError) as e:
        ProductAttributeAssignmentWrite(value_ids=[1, 2, 1])
    assert "birden fazla" in str(e.value)


def test_atama_bos_liste_kabul_eder() -> None:
    """Tüm öznitelikleri kaldırmak geçerli bir yazımdır."""
    assert ProductAttributeAssignmentWrite(value_ids=[]).value_ids == []
