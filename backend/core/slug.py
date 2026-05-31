"""SEO dostu slug üretimi (Türkçe karakter destekli).

Eğitmen profil URL'leri ``/egitmenler/ahmet-yilmaz-42`` biçimindedir. Slug daima
``-{id}`` ile biter; bu sayede frontend sondaki id'yi ayrıştırıp eğitmeni çözer
(isim değişse bile linkler kırılmaz, ayrıca benzersizlik için ekstra kolona
gerek kalmaz).
"""

from __future__ import annotations

import re
import unicodedata

# Türkçe harfleri ASCII karşılıklarına çevir (NFKD bunları doğru çözmediği için).
_TR_MAP = str.maketrans(
    {
        "ç": "c",
        "Ç": "c",
        "ğ": "g",
        "Ğ": "g",
        "ı": "i",
        "I": "i",
        "İ": "i",
        "ö": "o",
        "Ö": "o",
        "ş": "s",
        "Ş": "s",
        "ü": "u",
        "Ü": "u",
    }
)


def slugify_tr(value: str | None) -> str:
    """Serbest metni URL-güvenli, küçük harfli bir slug'a çevirir."""
    if not value:
        return ""
    text = value.translate(_TR_MAP).lower()
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def tutor_slug(tutor_id: int, full_name: str | None) -> str:
    """Eğitmen için kanonik slug: ``isim-soyisim-{id}`` (isim yoksa salt id)."""
    base = slugify_tr(full_name)
    return f"{base}-{tutor_id}" if base else str(tutor_id)
