"""SEO dostu slug üretimi (Türkçe karakter destekli).

Eğitmen profil URL'leri ``/egitmenler/ahmet-42`` biçimindedir. Slug daima
``-{id}`` ile biter; bu sayede frontend sondaki id'yi ayrıştırıp eğitmeni çözer
(isim değişse bile linkler kırılmaz, ayrıca benzersizlik için ekstra kolona
gerek kalmaz).

SOYAD SLUG'A GİRMEZ (ÜK-9). Bu bir biçim tercihi değil: slug
``sitemap_service`` üzerinden doğrudan arama motorlarına veriliyor, yani soyad
arayüzden kaldırılsa bile URL'de ve Google sonuçlarında kalırdı. Gizleme kararı
alınıp burası atlanırsa iş yalnız kozmetik olur.
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


def tutor_slug(tutor_id: int, display_name: str | None) -> str:
    """Eğitmen için kanonik slug: ``isim-{id}`` (isim yoksa salt id).

    Parametre bilerek ``display_name``: çağıran yanlışlıkla ``full_name``
    geçirirse soyad URL'e ve sitemap'e geri sızar. Ad birden çok sözcükse
    (ör. "Ayşe Nur") tamamı kalır — kesilen şey SOYADdır, adın kendisi değil.
    """
    base = slugify_tr(display_name)
    return f"{base}-{tutor_id}" if base else str(tutor_id)
