"""Faz 0 güvenlik ağı — saf birim testleri.

Kapsam (bkz. docs/arsiv/teslimat/teslimat-faz0-denetim-matrisi.md §6):
- G-2: public token'la bırakma tercihine yükseltme yasağı (DROP_PREFS sınırı)
- G-3: OTP SMS'inde sosyal mühendislik kalkanı cümlesi
- G-4: OTP resend throttle (deneme sayacının sonsuz tazelenmesini keser)

Token yolunda foto sızmaması (G-1) DB gerektirir — tests/integration tarafında.
"""

import datetime

from core.sms.sender import delivery_otp_sms_text
from models.store import DeliveryPref
from services.delivery_service import OTP_RESEND_INTERVAL_SECONDS, otp_resend_blocked
from services.order_service import DROP_PREFS, is_drop_pref

NOW = datetime.datetime(2026, 7, 17, 12, 0, 0, tzinfo=datetime.timezone.utc)


# ── G-4: resend throttle ──────────────────────────────────────────────────────


def test_otp_resend_ilk_gonderim_serbest():
    assert otp_resend_blocked(None, NOW) is False


def test_otp_resend_erken_tekrar_engelli():
    sent = NOW - datetime.timedelta(seconds=OTP_RESEND_INTERVAL_SECONDS - 1)
    assert otp_resend_blocked(sent, NOW) is True


def test_otp_resend_sure_dolunca_serbest():
    sent = NOW - datetime.timedelta(seconds=OTP_RESEND_INTERVAL_SECONDS)
    assert otp_resend_blocked(sent, NOW) is False


# ── G-2: bırakma tercihi sınırı ───────────────────────────────────────────────


def test_drop_prefs_tam_kume():
    """Bırakma kümesi tam olarak kapıya+komşuya'dır — ne eksik ne fazla.

    BENI_ARA/ADRESIMDEYIM public token'dan serbesttir (PDS token yetkisi:
    izleme + erteleme + beni-ara); kümeye yanlışlıkla eklenirse müşteri kendi
    SMS linkinden zararsız tercihini bile değiştiremez olur.
    """
    assert DROP_PREFS == {
        DeliveryPref.KAPIYA_BIRAK.value,
        DeliveryPref.KOMSUYA_BIRAK.value,
    }


def test_is_drop_pref():
    assert is_drop_pref(DeliveryPref.KAPIYA_BIRAK.value)
    assert is_drop_pref(DeliveryPref.KOMSUYA_BIRAK.value)
    assert not is_drop_pref(DeliveryPref.ADRESIMDEYIM.value)
    assert not is_drop_pref(DeliveryPref.BENI_ARA.value)


# ── G-3: SMS güvenlik cümlesi ─────────────────────────────────────────────────


def test_otp_sms_guvenlik_cumlesi_sabit():
    text = delivery_otp_sms_text(order_id=42, code="123456", ttl_minutes=30)
    assert "Kuryemiz seni arayip asla kod istemez" in text
    assert "123456" in text
    assert "#42" in text
    assert "30 dk" in text
