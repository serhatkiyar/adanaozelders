"""Kullanıcıdan gelen URL alanları için şema doğrulaması (saf; pytest'li).

Bir URL'in kullanıcı arayüzünde ``href`` olarak render edildiği her yerde şema
whitelist'i ZORUNLUDUR: ``javascript:`` ve ``data:`` URL'leri tıklandığında
sayfa bağlamında kod çalıştırır (depolanmış XSS), ``mailto:``/``tel:`` ise
platformun aracılık modelini (anti-disintermediation) delmenin kolay yoludur.

Kullanım (Pydantic şemalarında):

    @field_validator("website")
    @classmethod
    def _v(cls, v: str | None) -> str | None:
        return ensure_http_url(v, field="Web sitesi")
"""

from __future__ import annotations

import re

# Yalnız http/https. Şema adı büyük/küçük harf duyarsız; araya boşluk/kontrol
# karakteri sokularak ("java\tscript:") atlatılamaması için önce strip edilir.
_HTTP_SCHEME = re.compile(r"^https?://", re.IGNORECASE)


def ensure_http_url(value: str | None, *, field: str = "URL") -> str | None:
    """http(s) şemalı bir URL döndürür; boş/None ise None.

    ``ValueError`` fırlatır (Pydantic bunu 422'ye çevirir).
    """
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    # Kontrol karakterleri (\x00-\x1f) bazı tarayıcılarda şema ayrıştırmasında
    # yok sayılır — "java\x00script:" gibi denemeleri baştan reddet.
    if any(ch < " " or ch == "\x7f" for ch in cleaned):
        raise ValueError(f"{field} geçersiz karakter içeriyor")
    if not _HTTP_SCHEME.match(cleaned):
        raise ValueError(f"{field} http:// veya https:// ile başlamalıdır")
    return cleaned
