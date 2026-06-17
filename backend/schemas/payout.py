from __future__ import annotations

import datetime
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

PayoutStatus = Literal["NONE", "PENDING", "ACTIVE", "REJECTED"]

_IBAN_RE = re.compile(r"^TR\d{24}$")


def _normalize_iban(v: str) -> str:
    """Boşlukları sil, büyük harfe çevir, TR IBAN formatını doğrula (TR + 24 hane)."""
    cleaned = re.sub(r"\s+", "", v or "").upper()
    if not _IBAN_RE.match(cleaned):
        raise ValueError("Geçerli bir TR IBAN girin (TR + 24 hane)")
    return cleaned


def _validate_tckn(v: str) -> str:
    v = (v or "").strip()
    if not (v.isdigit() and len(v) == 11):
        raise ValueError("TCKN 11 haneli rakam olmalı")
    return v


class PayoutSubmitIn(BaseModel):
    """Eğitmen/kütüphane sahibi ödeme bilgisi (alt üye işyeri için)."""

    iban: str
    tckn: str
    gsm: str | None = Field(default=None, max_length=20)

    _v_iban = field_validator("iban")(_normalize_iban)
    _v_tckn = field_validator("tckn")(_validate_tckn)


class PayoutOut(BaseModel):
    """Ödeme/escrow alma durumu. IBAN maskeli; TCKN yalnız son4."""

    model_config = ConfigDict(from_attributes=True)

    payout_status: PayoutStatus = "NONE"
    iban_masked: str | None = None
    identity_last4: str | None = None
    payout_updated_at: datetime.datetime | None = None


def mask_iban(iban: str | None) -> str | None:
    """'TR12 3456 ... 7890' → son 4 görünür, gerisi maskeli."""
    if not iban:
        return None
    tail = iban[-4:]
    return f"TR** **** **** **** {tail}"
