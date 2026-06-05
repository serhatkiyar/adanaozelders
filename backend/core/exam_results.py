"""Karne (sonuç belgesi) yardımcıları — saf (DB'siz), pytest'li.

Toplu karne yüklemede dosya adından kayıt (registration) eşlemesi için. Operatör
indirdiği referans listesindeki ``registration_id``'yi dosya adının başına koyar
(ör. "123 - Ali Veli.pdf", "123_karne.pdf", "123.pdf")."""

from __future__ import annotations

import re


def parse_registration_id(filename: str | None) -> int | None:
    """Dosya adının başındaki sayıyı registration_id olarak çıkarır (yoksa None).

    Yol ayraçları temizlenir; baştaki boşluk/sıfırlar tolere edilir. "abc.pdf" → None.
    """
    if not filename:
        return None
    base = filename.replace("\\", "/").rsplit("/", 1)[-1]
    m = re.match(r"\s*0*(\d+)", base)
    if not m:
        return None
    try:
        return int(m.group(1))
    except ValueError:  # pragma: no cover - regex zaten rakam garantiler
        return None
