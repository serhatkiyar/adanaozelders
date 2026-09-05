"""SMS şablonlarının kredi maliyeti nöbetçisi.

Türkçe karakter içeren bir SMS, GSM-7 yerine UCS-2 ile kodlanır ve tek parçanın
sınırı 160'tan 70 karaktere düşer — yani metne tek bir 'ş' eklemek o mesajın
Netgsm faturasındaki kredisini ikiye katlar. Netgsm'in OTP paketi ayrıca tek boy
ile sınırlıdır; sınırı aşan mesaj gövde kodu '20' ile REDDEDİLİR (gönderilmez).

Bu yüzden altı şablonun tamamı ASCII ve tek boy olmak zorunda. Şablonlar elle
yazıldığı için bu kural sessizce bozulabilir; nöbetçi bozulmayı yakalar.
"""

from __future__ import annotations

import pytest

from core.sms import sender as sender_mod
from core.sms.base import SmsMessage, SmsSender

#: GSM-7 tek parça sınırı. Aşılırsa mesaj çok parçaya bölünür (kredi katlanır) ve
#: OTP paketinden hiç gönderilemez.
TEK_BOY_SINIRI = 160


class _YakalayanSender(SmsSender):
    """Gönderim yapmaz, metni saklar."""

    def __init__(self) -> None:
        self.mesajlar: list[SmsMessage] = []

    async def send(self, message: SmsMessage) -> None:
        self.mesajlar.append(message)


@pytest.fixture
def yakalanan(monkeypatch: pytest.MonkeyPatch) -> _YakalayanSender:
    fake = _YakalayanSender()
    monkeypatch.setattr(sender_mod, "get_sms_sender", lambda: fake)
    return fake


async def _tum_sablonlari_uret(s: _YakalayanSender) -> None:
    """Altı şablonun tamamını gerçekçi (uzun uçlu) verilerle üretir."""
    await sender_mod.send_otp_sms(to="+905551112233", code="123456")
    await sender_mod.send_delivery_otp_sms(
        to="+905551112233", code="123456", order_id=999999
    )
    url = "https://adanaozelders.com/takip/AbCdEfGhIjKlMnOp"
    # Kısmi teslimatla birlikte imza `order_no` aldı; en uzun hâl bölünmüş
    # siparişin ikinci teslimatıdır, boy sınavı onunla yapılır.
    await sender_mod.send_tracking_link_sms(
        to="+905551112233", order_no="9999-9999-9999", url=url
    )
    await sender_mod.send_tracking_link_sms(
        to="+905551112233", order_no="9999-9999-9999", url=url, shipment_no=2
    )
    # stops_ahead=0 ve >0 iki farklı cümle üretir; ikisi de sınanmalı.
    for kalan in (0, 12):
        await sender_mod.send_approach_sms(
            to="+905551112233", order_id=999999, stops_ahead=kalan, url=url
        )
    await sender_mod.send_failed_sms(to="+905551112233", order_id=999999)
    await sender_mod.send_postponed_sms(
        to="+905551112233", order_id=999999, new_date="12.09.2026"
    )


@pytest.mark.asyncio
async def test_sablonlar_ascii(yakalanan: _YakalayanSender) -> None:
    await _tum_sablonlari_uret(yakalanan)
    assert yakalanan.mesajlar, "şablon üretilmedi — test kurulumu bozuk"
    for m in yakalanan.mesajlar:
        tr = sorted({c for c in m.text if not c.isascii()})
        assert not tr, f"ASCII dışı karakter {tr} — kredi ikiye katlanır: {m.text!r}"


@pytest.mark.asyncio
async def test_sablonlar_tek_boya_sigar(yakalanan: _YakalayanSender) -> None:
    await _tum_sablonlari_uret(yakalanan)
    for m in yakalanan.mesajlar:
        assert len(m.text) <= TEK_BOY_SINIRI, (
            f"{len(m.text)} karakter — tek boyu aşıyor, OTP paketinden "
            f"gönderilemez: {m.text!r}"
        )
