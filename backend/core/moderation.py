"""Anti-disintermediation: kullanıcı içeriğinde telefon/e-posta gibi iletişim
bilgilerini maskeler. Mesajlaşma, ders yorumları ve kaynak paylaşımı gibi tüm
serbest-metin kanallarında ikinci savunma katmanı olarak kullanılır.
"""
from __future__ import annotations

import re

_PLACEHOLDER = "[gizlendi]"

# Telefon (uluslararası/yerel) ve e-posta sızıntısını yakalar.
_LEAK = re.compile(
    r"(\+?\d[\d\s().-]{8,}\d)|([\w.+-]+@[\w-]+\.[\w.-]+)", re.IGNORECASE
)


def mask_contact_info(text: str | None) -> str | None:
    """Metindeki telefon/e-posta bilgilerini [gizlendi] ile değiştirir."""
    if not text:
        return text
    return _LEAK.sub(_PLACEHOLDER, text)
