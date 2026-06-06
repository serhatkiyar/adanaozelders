"""Elle girilebilen kısa doğrulama kodları (QR okutulamazsa operatör girer).

QR güvenli uzun token'ı taşır; kısa kod insan-dostu manuel yedektir. Karışan
karakterler (0/O, 1/I/L) alfabeden çıkarıldı."""

import re
import secrets

# 0, O, 1, I, L yok → telefonda/elle okurken karışmaz (31 karakter).
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def gen_short_code(n: int = 6) -> str:
    """n karakterlik rastgele kısa kod (ör. '8F3K9Q')."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(n))


def normalize_code(payload: str) -> str:
    """Elle girilen kodu karşılaştırmaya hazırlar: harf/rakam dışını at, büyüt.
    'q8f-3k9' → 'Q8F3K9'. QR içeriği ('{id}:{token}') verilirse uzun/karışık bir
    dize üretir; kısa kod kolonuyla eşleşmez (sorun değil — qr_token yolu eşleşir)."""
    return re.sub(r"[^A-Za-z0-9]", "", payload or "").upper()
