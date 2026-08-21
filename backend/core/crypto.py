"""Alan-düzeyi simetrik şifreleme (at-rest).

Hassas kişisel veriyi (ör. diploma doğrulama TCKN'si) DB'de **şifreli** saklar; uygulama
kodu düz metinle çalışır (SQLAlchemy ``EncryptedString`` TypeDecorator şeffaf şifreler/çözer).

Anahtar: ``FIELD_ENCRYPTION_KEY`` (önerilen, üretimde ayrı tut) yoksa ``SECRET_KEY``'den
türetilir (dev'de ek ayar gerekmez). Anahtar değişirse eski şifreli veri çözülemez.
"""
from __future__ import annotations

import base64
import hashlib
import logging
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import String, Text
from sqlalchemy.types import TypeDecorator

from core.config import settings

logger = logging.getLogger("adana.crypto")


@lru_cache
def _fernet() -> Fernet:
    raw = (settings.FIELD_ENCRYPTION_KEY or settings.JWT_SECRET_KEY or "dev")
    # SHA-256 → 32 byte → urlsafe base64 = geçerli Fernet anahtarı (deterministik).
    key = base64.urlsafe_b64encode(hashlib.sha256(raw.encode()).digest())
    return Fernet(key)


def encrypt(plain: str | None) -> str | None:
    if plain is None or plain == "":
        return None
    return _fernet().encrypt(plain.encode()).decode()


def decrypt(token: str | None) -> str | None:
    if token is None or token == "":
        return None
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        # Çözülemedi (anahtar uyuşmazlığı / bozuk veri). FAIL-SAFE: çöp veriyi
        # düz metin gibi DÖNDÜRME — yoksa ör. yanlış TCKN doğrulanmış sanılır.
        # None döner ("veri yok" gibi davranılır) ve durum loglanır.
        logger.error("Alan şifresi çözülemedi (anahtar değişmiş veya bozuk veri olabilir).")
        return None


class EncryptedString(TypeDecorator):
    """DB'de şifreli, Python'da düz metin string. ``length`` şifreli metni (token)
    tutacak kadar geniş olmalı (kısa girdiler ~100+ karaktere şişer)."""

    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return encrypt(value)

    def process_result_value(self, value, dialect):
        return decrypt(value)


class EncryptedText(TypeDecorator):
    """DB'de şifreli, Python'da düz metin — **genişlik sınırı olmadan**.

    Neden `EncryptedString`'in yanına ayrı bir tip: Fernet çıktısı girdiyle
    orantılı büyür (~1,4 kat + sabit başlık). IBAN gibi kısa bir alan için
    `VARCHAR(n)` seçmek makul, ama bir **JWT** için değildir — Yıldırım
    token'ı 600-900 karakter bandındadır ve şifrelenince 1000'i rahatça aşar.
    Sabit bir genişlik seçmek, sağlayıcı token biçimini büyüttüğü gün
    `value too long for type character varying(n)` ile 500 demektir; hata da
    ancak yönetici token'ı yapıştırdığında ortaya çıkar.

    `tests/acceptance/test_encrypted_column_widths.py` bu tipi tanır ve
    genişliksiz olduğu için ölçüm yapmaz — ama genişliği OLAN bir kolonun
    yanlışlıkla bu tipe geçmediğini doğrular.
    """

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return encrypt(value)

    def process_result_value(self, value, dialect):
        return decrypt(value)
