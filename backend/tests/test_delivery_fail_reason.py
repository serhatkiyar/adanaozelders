"""FAILED neden kodları (Faz 3) — saf birim testleri.

- Neden kodu kümesi ve KPI hariç-tutma seti tutarlı.
- Kurye kusuru sayılmayanlar: ERKEN_DENEME / GUVENLIK / MUSTERI_TALEBI.
"""

from models.delivery import FAIL_REASONS_NOT_COURIER_FAULT, FailReason


def test_fail_reason_kodlari_tam():
    assert {r.value for r in FailReason} == {
        "EVDE_YOK",
        "ADRES_SORUNU",
        "ERISIM_SORUNU",
        "ERKEN_DENEME",
        "MUSTERI_TALEBI",
        "GUVENLIK",
        "PAKET_SORUNU",
        "ARAC_SORUNU",
        "DIGER",
    }


def test_kpi_haric_tutma_seti():
    """Kurye kusuru sayılmayanlar tam olarak bu üçü — ne eksik ne fazla.
    (E4 erken deneme, D8 güvenlik, müşteri talebi PDS'te kurye metriğine yazılmaz.)"""
    assert FAIL_REASONS_NOT_COURIER_FAULT == {
        FailReason.ERKEN_DENEME.value,
        FailReason.GUVENLIK.value,
        FailReason.MUSTERI_TALEBI.value,
    }
    # Kurye kusuru sayılanlar hariç tutma setinde OLMAMALI.
    for r in (FailReason.EVDE_YOK, FailReason.ADRES_SORUNU, FailReason.PAKET_SORUNU):
        assert r.value not in FAIL_REASONS_NOT_COURIER_FAULT
