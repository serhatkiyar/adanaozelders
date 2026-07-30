"""Şifreli kolonlar şifreli metni tutacak kadar geniş mi?

`EncryptedString` DB'de şifrelenmiş (Fernet) metin saklar ve kendi docstring'i
uyarıyor: *"``length`` şifreli metni (token) tutacak kadar geniş olmalı (kısa
girdiler ~100+ karaktere şişer)"*. Buna rağmen `tutors.iban`,
`libraries.iban` ve `payout_records.iban_snapshot` kolonları baseline
migration'da **VARCHAR(34)** açılmıştı (düz IBAN uzunluğu).

Sonuç, hiç tetiklenmemiş bir para-yolu hatasıydı: ilk eğitmen IBAN'ını
kaydettiğinde `value too long for type character varying(34)` ile 500 alırdı.
Geliştirme veritabanında hiç IBAN kaydedilmediği için (0 satır) fark
edilmemişti; sahada ilk hakediş onboarding'inde patlardı.

Bu test şifreli metnin gerçek uzunluğunu ölçer ve model tanımının o uzunluğu
taşıdığını doğrular — kolon genişliği ile şifreleme çıktısı arasındaki
sözleşmeyi kalıcı olarak korur.
"""
from __future__ import annotations

import pytest

from core.crypto import EncryptedString, encrypt
from models.library import Library
from models.payout import PayoutRecord
from models.tutor import Tutor

# Gerçek bir IBAN uzunluğunda örnek (26 hane TR IBAN).
_ORNEK_IBAN = "TR330006100519786457841326"

_SIFRELI_KOLONLAR = [
    (Tutor, "iban"),
    (Library, "iban"),
    (PayoutRecord, "iban_snapshot"),
]


def test_sifreli_metin_duz_ibandan_belirgin_sekilde_uzun():
    """Varsayımı sabitler: şifreleme çıktısı 34 karaktere sığmaz."""
    sifreli = encrypt(_ORNEK_IBAN)
    assert sifreli is not None
    assert len(sifreli) > 34, (
        "Şifreli metin 34 karakterden kısa çıktı — bu testin dayanağı değişmiş, "
        "kolon genişliği varsayımları gözden geçirilmeli"
    )


@pytest.mark.parametrize("model, alan", _SIFRELI_KOLONLAR)
def test_sifreli_kolon_sifreli_metni_tasiyacak_genislikte(model, alan):
    kolon = model.__table__.columns[alan]
    assert isinstance(kolon.type, EncryptedString), (
        f"{model.__tablename__}.{alan} EncryptedString olmalı"
    )
    gerekli = len(encrypt(_ORNEK_IBAN) or "")
    assert kolon.type.length >= gerekli, (
        f"{model.__tablename__}.{alan} genişliği {kolon.type.length}, "
        f"şifreli metin {gerekli} karakter — kayıt DB hatası verir"
    )
