"""Takip ekranının teslimat listesi — paket durumundan müşteri durumuna çeviri.

Saf (DB'siz). Bugün bir siparişin tek teslimatı olur; bu çeviri kısmi teslimat
geldiğinde ("eldekini bugün gönder, kalanı temin edilince") paket başına
çalışacak.
"""
from services.delivery_service import shipment_status


def test_teslim_edilmis_paket_her_zaman_DELIVERED():
    assert shipment_status("DELIVERED", "EN_ROUTE") == "DELIVERED"


def test_aractaki_paket_siparis_durumunu_izler():
    # Paket kuryede: yolda mı, bugün teslim edilemedi mi, ertelendi mi —
    # cevabı durak taşır, paket değil.
    assert shipment_status("HANDED_OVER", "EN_ROUTE") == "EN_ROUTE"
    assert shipment_status("HANDED_OVER", "FAILED") == "FAILED"
    assert shipment_status("RETURN_PENDING", "POSTPONED") == "POSTPONED"


def test_depodaki_paket_yola_cikmamistir():
    for depo in ("OPEN", "PACKED", "RETURNED"):
        assert shipment_status(depo, "EN_ROUTE") == "NOT_DISPATCHED"


def test_paketsiz_eski_siparis_siparis_durumuna_duser():
    # F30 öncesi sipariş: paket kaydı yok, sentetik tek teslimat üretilir.
    assert shipment_status(None, "EN_ROUTE") == "EN_ROUTE"
    assert shipment_status(None, "NOT_DISPATCHED") == "NOT_DISPATCHED"


def test_depodaki_paket_teslim_edildi_diyemez():
    # Sipariş DELIVERED görünse bile depoda duran paket teslim edilmemiştir;
    # kısmi teslimatta ikinci paket tam olarak bu durumda olacak.
    assert shipment_status("PACKED", "DELIVERED") == "NOT_DISPATCHED"
