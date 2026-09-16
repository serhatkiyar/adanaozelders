"""Değerlendirme uygunluğu — `services.review_service.degerlendirme_engeli`.

Kullanıcı kararı (16 Eyl 2026): bir öğrenci bir eğitmeni yalnız BİR KEZ
değerlendirir ve yalnız KARTLA (yapılandırılmış sağlayıcıyla) ÖDENMİŞ ders
değerlendirilebilir. Karar saf bir fonksiyonda verilir; hem yorum oluşturma hem
rezervasyon çıktısındaki `can_review` bayrağı aynı fonksiyonu kullanır.
"""
from __future__ import annotations

import pytest

from models.booking import Booking, BookingStatus
from models.payment import Payment, PaymentStatus
from services.review_service import degerlendirme_engeli

SAGLAYICI = "iyzico"


def _booking(status: BookingStatus = BookingStatus.COMPLETED) -> Booking:
    return Booking(status=status)


def _payment(
    status: PaymentStatus = PaymentStatus.RELEASED, provider: str = SAGLAYICI
) -> Payment:
    return Payment(status=status, provider=provider)


def _engel(booking, payment, *, egitmen=False, booking_ok=False):
    return degerlendirme_engeli(
        booking,
        payment,
        saglayici=SAGLAYICI,
        egitmen_zaten_degerlendirildi=egitmen,
        booking_zaten_degerlendirildi=booking_ok,
    )


def test_kartla_odenmis_tamamlanmis_ilk_yorum_serbest():
    assert _engel(_booking(), _payment()) is None


def test_emanetteki_odeme_de_yeterli():
    assert _engel(_booking(), _payment(PaymentStatus.HELD)) is None


@pytest.mark.parametrize(
    "status",
    [s for s in BookingStatus if s != BookingStatus.COMPLETED],
)
def test_tamamlanmamis_ders_degerlendirilemez(status):
    assert _engel(_booking(status), _payment()) == (
        "Yalnız tamamlanmış dersler değerlendirilebilir."
    )


def test_odemesiz_ders_degerlendirilemez():
    """Ücretsiz ilk ders: ödeme kaydı hiç kurulmaz (payment_service.create_for_booking)."""
    assert _engel(_booking(), None) == "Yalnız kartla ödenmiş dersler değerlendirilebilir."


@pytest.mark.parametrize(
    "status",
    [PaymentStatus.PENDING, PaymentStatus.REFUNDING, PaymentStatus.REFUNDED, PaymentStatus.FAILED],
)
def test_tahsil_edilmemis_veya_iade_edilmis_odeme_yetmez(status):
    assert _engel(_booking(), _payment(status)) == (
        "Yalnız kartla ödenmiş dersler değerlendirilebilir."
    )


def test_baska_saglayiciyla_odenmis_ders_yetmez():
    assert _engel(_booking(), _payment(provider="havale")) == (
        "Yalnız kartla ödenmiş dersler değerlendirilebilir."
    )


def test_ayni_egitmene_ikinci_yorum_yasak():
    assert _engel(_booking(), _payment(), egitmen=True) == (
        "Bu eğitmeni zaten değerlendirdiniz."
    )


def test_ayni_ders_ikinci_kez_degerlendirilemez():
    """Booking kuralı eğitmen kuralından ÖNCE okunur: gerekçe daha özgül."""
    assert _engel(_booking(), _payment(), egitmen=True, booking_ok=True) == (
        "Bu ders zaten değerlendirilmiş."
    )


def test_odeme_kurali_yorum_kurallarindan_once_gelir():
    """Ödenmemiş ders için 'zaten değerlendirdiniz' demek yanıltıcı olurdu."""
    assert _engel(_booking(), None, egitmen=True) == (
        "Yalnız kartla ödenmiş dersler değerlendirilebilir."
    )
