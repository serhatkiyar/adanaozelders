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

from core.crypto import EncryptedString, EncryptedText, encrypt
from models.library import Library
from models.payout import PayoutRecord
from models.supplier import Supplier
from models.tutor import Tutor

# Gerçek bir IBAN uzunluğunda örnek (26 hane TR IBAN).
_ORNEK_IBAN = "TR330006100519786457841326"

# Yıldırım B2B token'ı bir JWT'dir ve 30 gün ömürlüdür; ölçülen boyut 600-900
# karakter bandındadır. Şifreleme bunu ~1,4 katına çıkarır → SINIRLI genişlikte
# bir VARCHAR bu değeri taşıyamaz. Örnek, üst banttan seçildi.
_ORNEK_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." + ("x" * 820) + ".imzasi"

#: (model, alan, örnek düz metin)
_SIFRELI_KOLONLAR = [
    (Tutor, "iban", _ORNEK_IBAN),
    (Library, "iban", _ORNEK_IBAN),
    (PayoutRecord, "iban_snapshot", _ORNEK_IBAN),
    (Supplier, "api_token", _ORNEK_TOKEN),
]


def test_sifreli_metin_duz_ibandan_belirgin_sekilde_uzun():
    """Varsayımı sabitler: şifreleme çıktısı 34 karaktere sığmaz."""
    sifreli = encrypt(_ORNEK_IBAN)
    assert sifreli is not None
    assert len(sifreli) > 34, (
        "Şifreli metin 34 karakterden kısa çıktı — bu testin dayanağı değişmiş, "
        "kolon genişliği varsayımları gözden geçirilmeli"
    )


def test_uzun_token_sifrelenince_varchar_bandini_asar():
    """`EncryptedText`'in gerekçesini sabitler: bir JWT şifrelenince VARCHAR(255)
    bir yana, VARCHAR(1000)'e bile sığmayabilir. Sabit genişlik seçmek yerine
    sınırsız kolon kullanmanın nedeni budur."""
    sifreli = encrypt(_ORNEK_TOKEN) or ""
    assert len(sifreli) > 1000, (
        "Örnek token şifrelenince 1000 karakterin altında kaldı — bu testin "
        "dayanağı değişmiş, kolon tipi kararı gözden geçirilmeli"
    )


@pytest.mark.parametrize("model, alan, ornek", _SIFRELI_KOLONLAR)
def test_sifreli_kolon_sifreli_metni_tasiyacak_genislikte(model, alan, ornek):
    kolon = model.__table__.columns[alan]
    assert isinstance(kolon.type, (EncryptedString, EncryptedText)), (
        f"{model.__tablename__}.{alan} şifreli tip olmalı"
    )
    gerekli = len(encrypt(ornek) or "")
    genislik = getattr(kolon.type, "length", None)
    if genislik is None:
        # `EncryptedText` → Postgres TEXT, üst sınır yok. Doğru karar; ölçülecek
        # bir genişlik de yok.
        assert isinstance(kolon.type, EncryptedText), (
            f"{model.__tablename__}.{alan} genişliksiz ama EncryptedText değil — "
            "sınırsız VARCHAR beklenmedik bir yapılandırmadır"
        )
        return
    assert genislik >= gerekli, (
        f"{model.__tablename__}.{alan} genişliği {genislik}, "
        f"şifreli metin {gerekli} karakter — kayıt DB hatası verir"
    )
