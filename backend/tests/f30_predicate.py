"""SQL durum yüklemi çözümleyicisi — F30 "canlı paket" drift nöbetçisi için.

## Neden ayrı bir modül

"Canlı paket" yükleminin (`status NOT IN ('DELIVERED','VOID')`) ÜÇ kopyası var:

1. `models.packing.LIVE_PACKAGE_SQL` — kısmi unique index'in `postgresql_where`'i,
2. `migrations/versions/f30_paketleme_semasi.py::_LIVE` — uygulanan şemanın metni,
3. `models.packing.TERMINAL_PACKAGE_STATUSES` — servisin/FSM'in terminal kümesi.

Üçü ayrışırsa hata SESSİZDİR: index "ikinci paket açılamaz" derken servis
"canlı paket yok" der, ya da tersi. `alembic check` bunu YAKALAMAZ — kısmi
index'lerin `WHERE` yüklemini karşılaştırmaz (yalnız varlığını).

## Neden metin karşılaştırması yetmez

İki metin aynı anlamı farklı yazabilir (`NOT IN ('VOID','DELIVERED')`,
boşluk/sıra farkı) ve PostgreSQL katalogda yüklemi kendi normal biçimine
çevirir:

    ((status)::text <> ALL (ARRAY['DELIVERED'::character varying,
                                  'VOID'::character varying]::text[]))

Bu yüzden karşılaştırma **anlam düzeyinde** yapılır: (polarite, durum kümesi).
Böylece boşluk/sıra/normalizasyon farkına kırılmaz; ama kümeye bir durum
eklenir ya da çıkarılırsa kırılır — istenen tam olarak budur.
"""
from __future__ import annotations

import re

#: Yüklemde geçebilecek tek tırnaklı literaller.
_LITERAL_RE = re.compile(r"'([^']*)'")

#: Olumsuzlama işaretleri. PostgreSQL `NOT IN`'i `<> ALL`'a çevirir; ikisi de
#: aynı anlama gelir ve ikisi de tanınmalıdır.
_NEGATIF_RE = re.compile(r"NOT\s+IN|<>\s*ALL|!=\s*ALL|<>|!=", re.IGNORECASE)


class YuklemCozulemedi(AssertionError):
    """Yüklem bu çözümleyicinin tanıdığı biçimlerin dışında."""


def parse_status_predicate(sql: str, *, gecerli_durumlar: tuple[str, ...]) -> tuple[bool, frozenset[str]]:
    """SQL yükleminden `(negatif_mi, durum_kümesi)` çıkarır.

    `gecerli_durumlar` süzgeci bilinçlidir: PostgreSQL normalizasyonu
    `'character varying'` gibi tip adlarını da tek tırnak içinde yazar; onlar
    durum değildir ve kümeye girmemelidir.

    Dönen `negatif_mi=True` → "bu kümenin DIŞINDA olanlar" (canlı paket),
    `False` → "bu kümenin İÇİNDE olanlar".
    """
    literaller = [x for x in _LITERAL_RE.findall(sql) if x in gecerli_durumlar]
    if not literaller:
        raise YuklemCozulemedi(f"yüklemde hiç durum literali yok: {sql!r}")
    negatif = _NEGATIF_RE.search(sql) is not None
    return negatif, frozenset(literaller)


def canli_kume(sql: str, *, tum_durumlar: tuple[str, ...]) -> frozenset[str]:
    """Yüklemin GEÇERLİ SAYDIĞI durum kümesi — polarite normalize edilmiş hâli.

    İki farklı yazım (`status NOT IN ('DELIVERED','VOID')` ve
    `status IN ('OPEN','PACKED',…)`) aynı kümeye iner; karşılaştırma böylece
    yazım biçiminden tamamen bağımsızlaşır.
    """
    negatif, kume = parse_status_predicate(sql, gecerli_durumlar=tum_durumlar)
    return frozenset(tum_durumlar) - kume if negatif else kume
