"""Para çekme talebi önkoşulları — `payout_ledger.talep_engeli` (saf).

Öğretmen "Para çek" diyebilmesi için: IBAN hesabı ACTIVE, bakiye > 0 ve açık
talep yok. Aynı fonksiyon hem talep ucunda (409 gerekçesi) hem cüzdan
kutusunda (düğme pasif + altındaki metin) kullanılır.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from services.payout_ledger import talep_engeli


def test_hepsi_tamamsa_engel_yok():
    assert talep_engeli(payout_status="ACTIVE", balance=Decimal("10"), acik_talep_var=False) is None


@pytest.mark.parametrize("durum", ["NONE", "PENDING", "REJECTED"])
def test_iban_aktif_degilse_engel(durum):
    engel = talep_engeli(payout_status=durum, balance=Decimal("10"), acik_talep_var=False)
    assert engel is not None and "IBAN" in engel


@pytest.mark.parametrize("bakiye", [Decimal("0"), Decimal("0.00")])
def test_bakiye_yoksa_engel(bakiye):
    assert talep_engeli(payout_status="ACTIVE", balance=bakiye, acik_talep_var=False)


def test_acik_talep_once_soylenir():
    # IBAN yok + açık talep: kullanıcıya önce işlenen talep söylenir.
    engel = talep_engeli(payout_status="NONE", balance=Decimal("0"), acik_talep_var=True)
    assert engel is not None and "işlenmekte" in engel
