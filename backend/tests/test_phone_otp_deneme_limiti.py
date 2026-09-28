"""Telefon OTP'si deneme limiti: hatalı deneme sayacı istek rollback'inden sağ çıkmalı.

`get_db` istisnada rollback yapar. Sayaç yalnız flush edilip 400 fırlatılırsa
her istek sayacı sıfıra geri sarar; limit etkisiz kalır ve 6 haneli kod
sınırsız denenebilir. Bu testler her denemeyi ayrı bir "istek" olarak koşar ve
yalnız commit edilen durumu bir sonraki isteğe taşır.
"""
from __future__ import annotations

import datetime
import types

import pytest
from fastapi import HTTPException

from core.config import settings
from services import phone_service

_DOGRU_KOD = "123456"
_YANLIS_KOD = "000000"


class _Sonuc:
    def __init__(self, obj):
        self._obj = obj

    def scalar_one_or_none(self):
        return self._obj


class _IstekOturumu:
    """Tek bir OTP satırı üzerinde commit/rollback semantiğini taklit eder."""

    _ALANLAR = ("attempts", "used_at")

    def __init__(self, otp, user):
        self.otp = otp
        self.user = user
        self._kalici = self._anlik()

    def _anlik(self):
        return (
            {a: getattr(self.otp, a) for a in self._ALANLAR},
            (self.user.phone, self.user.phone_verified_at),
        )

    async def execute(self, *a, **k):
        # Kullanılmış kod aktif sorgudan düşer (`used_at IS NULL` filtresi).
        return _Sonuc(None if self.otp.used_at is not None else self.otp)

    async def flush(self):
        return None

    async def commit(self):
        self._kalici = self._anlik()

    async def rollback(self):
        otp_alanlari, (phone, verified) = self._kalici
        for alan, deger in otp_alanlari.items():
            setattr(self.otp, alan, deger)
        self.user.phone, self.user.phone_verified_at = phone, verified


async def _istek(db: _IstekOturumu, kod: str) -> None:
    """`get_db` gibi: başarıda commit, istisnada rollback."""
    try:
        await phone_service.verify_otp(db, db.user, kod)
    except Exception:
        await db.rollback()
        raise
    await db.commit()


def _kurulum():
    now = datetime.datetime.now(datetime.timezone.utc)
    otp = types.SimpleNamespace(
        phone="+905321234567",
        code_hash=phone_service._hash(_DOGRU_KOD),
        expires_at=now + datetime.timedelta(minutes=10),
        attempts=0,
        used_at=None,
    )
    user = types.SimpleNamespace(
        id=7, role_id=3, phone="+905321234567", phone_verified_at=None
    )
    return _IstekOturumu(otp, user)


async def test_hatali_deneme_sayaci_rollbackten_sag_cikar():
    db = _kurulum()
    with pytest.raises(HTTPException) as exc:
        await _istek(db, _YANLIS_KOD)
    assert exc.value.detail == "Kod hatalı."
    assert db.otp.attempts == 1


async def test_limit_dolunca_dogru_kod_da_reddedilir():
    db = _kurulum()
    for _ in range(settings.PHONE_OTP_MAX_ATTEMPTS):
        with pytest.raises(HTTPException):
            await _istek(db, _YANLIS_KOD)

    with pytest.raises(HTTPException) as exc:
        await _istek(db, _DOGRU_KOD)
    assert "Çok fazla" in exc.value.detail
    # Kod kalıcı olarak kilitlenir; sonraki doğru deneme de geçemez.
    assert db.otp.used_at is not None
    with pytest.raises(HTTPException):
        await _istek(db, _DOGRU_KOD)
    assert db.user.phone_verified_at is None


async def test_limit_altinda_dogru_kod_numarayi_dogrular():
    db = _kurulum()
    for _ in range(settings.PHONE_OTP_MAX_ATTEMPTS - 1):
        with pytest.raises(HTTPException):
            await _istek(db, _YANLIS_KOD)
    await _istek(db, _DOGRU_KOD)
    assert db.user.phone_verified_at is not None
