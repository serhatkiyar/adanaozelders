"""Telefon OTP'si deneme sınırı — GERÇEK PostgreSQL + gerçek HTTP.

Güvenlik denetimi bulgusu: `phone_service.verify_otp` hatalı denemede
`otp.attempts += 1` yapıp `flush()` ediyor, ardından 400 fırlatıyordu. İstisna
`get_db`'ye kadar yükselir ve oturum ROLLBACK olur — sayaç artışı da onunla
birlikte geri alınır. Sonuç: `PHONE_OTP_MAX_ATTEMPTS` hiç devreye girmiyor ve
6 haneli kod, 10 dakikalık ömrü boyunca sınırsız denenebiliyordu (doğrulama
ucunda rate-limit de yoktu). Saldırgan başkasının numarasını kendi hesabına
"doğrulanmış" olarak yazdırıp telefon doğrulama kapısını atlatabilirdi.

Test, sayacın HTTP akışı sonunda KALICI olduğunu ve sınır dolduktan sonra
doğru kodun bile reddedildiğini ölçer — servis çağrısını doğrudan test etmek
rollback'i göremezdi.
"""
from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import select, text

from core.config import settings
from core.database import AsyncSessionLocal
from models.client import Client
from models.phone_otp import PhoneOtp
from services import phone_service
from tests.integration.ip3_factory import yetki_basligi

TELEFON = "/api/v1/auth/me/phone"
DOGRULA = "/api/v1/auth/me/phone/verify"


@pytest.fixture
def kod_yakala(monkeypatch):
    """Gönderilen OTP'yi dış servise gitmeden yakalar."""
    yakalanan: dict[str, str] = {}

    async def _wa(*, to, code):
        return False

    async def _sms(*, to, code):
        yakalanan["kod"] = code
        return True

    monkeypatch.setattr(phone_service.whatsapp, "send_otp_whatsapp", _wa)
    monkeypatch.setattr(phone_service.sms, "send_otp_sms", _sms)
    return yakalanan


async def _otp_temizle(client_id: int) -> None:
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("DELETE FROM phone_otps WHERE role_id = 3 AND user_id = :u"),
            {"u": client_id},
        )
        await s.commit()


@pytest.mark.asyncio
async def test_hatali_denemeler_kalici_sayilir_ve_sinirda_kod_olur(ip3, http, kod_yakala):
    client = await ip3.client(phone_verified=False)
    basliklar = yetki_basligi(client)
    try:
        r = await http.post(TELEFON, headers=basliklar, json={"phone": "0532 555 44 33"})
        assert r.status_code == 200, r.text[:200]
        dogru = kod_yakala["kod"]
        yanlis = f"{(int(dogru) + 1) % 1_000_000:06d}"

        for _ in range(settings.PHONE_OTP_MAX_ATTEMPTS):
            r = await http.post(DOGRULA, headers=basliklar, json={"code": yanlis})
            assert r.status_code == 400, r.text[:200]

        async with AsyncSessionLocal() as s:
            otp = (
                await s.execute(
                    select(PhoneOtp)
                    .where(PhoneOtp.role_id == 3, PhoneOtp.user_id == client.id)
                    .order_by(PhoneOtp.id.desc())
                    .limit(1)
                )
            ).scalar_one()
        assert otp.attempts == settings.PHONE_OTP_MAX_ATTEMPTS, (
            f"hatalı deneme sayacı kalıcı değil (attempts={otp.attempts}) — "
            "istisna rollback'i artışı siliyor, kaba kuvvet sınırsız"
        )

        # Sınır doldu: artık DOĞRU kod da kabul edilmemeli.
        r = await http.post(DOGRULA, headers=basliklar, json={"code": dogru})
        assert r.status_code == 400, (
            f"sınır aşıldıktan sonra doğru kod kabul edildi ({r.status_code})"
        )
        async with AsyncSessionLocal() as s:
            taze = await s.get(Client, client.id)
            assert taze.phone_verified_at is None
    finally:
        await _otp_temizle(client.id)


@pytest.mark.asyncio
async def test_dogru_kod_sinirdan_once_calisir(ip3, http, kod_yakala):
    """Düzeltme meşru akışı bozmamalı: birkaç hatadan sonra doğru kod geçer."""
    client = await ip3.client(phone_verified=False)
    basliklar = yetki_basligi(client)
    try:
        r = await http.post(TELEFON, headers=basliklar, json={"phone": "05325554433"})
        assert r.status_code == 200, r.text[:200]
        dogru = kod_yakala["kod"]
        yanlis = f"{(int(dogru) + 1) % 1_000_000:06d}"

        r = await http.post(DOGRULA, headers=basliklar, json={"code": yanlis})
        assert r.status_code == 400
        r = await http.post(DOGRULA, headers=basliklar, json={"code": dogru})
        assert r.status_code == 200, r.text[:200]
        assert r.json()["phone_verified"] is True
    finally:
        await _otp_temizle(client.id)


@pytest.mark.asyncio
async def test_eszamanli_denemeler_siniri_asamaz(ip3, http, kod_yakala):
    """Paralel istekler aynı sayacı okuyup üst üste yazarak sınırı aşamamalı."""
    client = await ip3.client(phone_verified=False)
    basliklar = yetki_basligi(client)
    try:
        r = await http.post(TELEFON, headers=basliklar, json={"phone": "05325554433"})
        assert r.status_code == 200, r.text[:200]
        dogru = kod_yakala["kod"]
        yanlis = f"{(int(dogru) + 1) % 1_000_000:06d}"

        yanitlar = await asyncio.gather(
            *[
                http.post(DOGRULA, headers=basliklar, json={"code": yanlis})
                for _ in range(settings.PHONE_OTP_MAX_ATTEMPTS * 4)
            ]
        )
        assert all(y.status_code == 400 for y in yanitlar)
        kod_hatali = sum(1 for y in yanitlar if y.json()["detail"] == "Kod hatalı.")
        assert kod_hatali <= settings.PHONE_OTP_MAX_ATTEMPTS, (
            f"{kod_hatali} deneme kodla karşılaştırıldı — sınır "
            f"{settings.PHONE_OTP_MAX_ATTEMPTS}"
        )
    finally:
        await _otp_temizle(client.id)
