"""Elle girilebilen kısa doğrulama kodları (QR okutulamazsa operatör girer).

QR güvenli uzun token'ı taşır; kısa kod insan-dostu manuel yedektir. Karışan
karakterler (0/O, 1/I/L) alfabeden çıkarıldı."""

import re
import secrets

# 0, O, 1, I, L yok → telefonda/elle okurken karışmaz (31 karakter).
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


#: QR yükünde taşınan bilet token'ının entropi uzunluğu (bayt). 24 bayt = 192 bit.
QR_TOKEN_BYTES = 24


def gen_short_code(n: int = 6) -> str:
    """n karakterlik rastgele kısa kod (ör. '8F3K9Q')."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(n))


def gen_qr_token() -> str:
    """Bilet/rezervasyon QR token'ı (URL-güvenli, 192 bit).

    Tek bir yerde durur: token üretimi eskiden üç ayrı serviste satır içi
    `secrets.token_urlsafe(24)` çağrısıydı ve arkasında ne tekillik kontrolü ne
    DB kısıtı vardı (denetim P2-40). Tekillik `services/library_capacity.py`
    tarafından, kısıt ise kısmi unique index'lerle sağlanır.
    """
    return secrets.token_urlsafe(QR_TOKEN_BYTES)


def normalize_code(payload: str) -> str:
    """Elle girilen kodu karşılaştırmaya hazırlar: harf/rakam dışını at, büyüt.
    'q8f-3k9' → 'Q8F3K9'. QR içeriği ('{id}:{token}') verilirse uzun/karışık bir
    dize üretir; kısa kod kolonuyla eşleşmez (sorun değil — qr_token yolu eşleşir)."""
    return re.sub(r"[^A-Za-z0-9]", "", payload or "").upper()
