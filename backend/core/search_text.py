"""Türkçe arama normalizasyonu — sorgu tarafı.

Yazma tarafı (generated `search_vector` kolonları ve trigram indeksleri)
veritabanındaki `tr_normalize()` fonksiyonundan geçer (bkz. migration
`dd737c387ff5`). Sorgu tarafı da AYNI fonksiyondan geçmelidir: iki taraf
ayrılırsa arama sessizce boş sonuç vermeye başlar — hata vermez, sadece
"kayıt bulunamadı" der ve bu fark edilmesi en zor arıza türüdür.

Neden gerekli: `to_tsvector('simple', …)` diakritiğe duyarlıdır. "matematik"
ile "matematık", "öğretmen" ile "ogretmen" farklı sözcüklerdir. Türkçe klavyesi
olmayan, acele yazan ya da mobil otomatik düzeltmenin noktasız ı ürettiği
kullanıcı hiçbir sonuç göremezdi.
"""
from __future__ import annotations

import re

from sqlalchemy import func

# Veritabanındaki fonksiyonun Python karşılığı (aynı harf eşlemesi).
# Yalnız test ve istemci tarafı gösterim için; SQL'de `normalized()` kullanılır.
_TR_MAP = str.maketrans(
    "ÇĞİIÖŞÜçğıiöşüÂÎÛâîû",
    "cgiiosucgiiosuaiuaiu",
)


def normalize_tr(text: str | None) -> str:
    """`tr_normalize()` SQL fonksiyonunun birebir Python eşleniği."""
    if not text:
        return ""
    return text.translate(_TR_MAP).lower()


def normalized(column_or_value):
    """SQL tarafında `tr_normalize(...)` çağrısı üretir.

    Hem kolona (indeksli ifade) hem de bağlı parametreye uygulanabilir.
    """
    return func.tr_normalize(column_or_value)


def terms(q: str) -> list[str]:
    """Sorguyu normalize edilmiş sözcüklere ayırır (noktalama atılır)."""
    return [t for t in re.split(r"[^\w]+", normalize_tr(q), flags=re.UNICODE) if t]


def tsquery(q: str):
    """Kullanıcı sorgusundan ÖNEK EŞLEŞMELİ tsquery üretir.

    Neden önek: `simple` sözlüğü kök bulmaz (Türkçe için PostgreSQL'de hazır
    bir stemmer yoktur). Bu yüzden "öğretmen" araması "öğretmeni" yazan
    profili bulamıyordu — sorun diakritik değil, çekim ekiydi. `ogretmen:*`
    ekleri de kapsar ve arama kutusunda yazarken beklenen davranışı verir
    ("matemat" → "matematik").

    Terimler `\\w` dışındaki her şeyden arındırılıp AND'lenir; kullanıcı
    girdisi tsquery sözdizimine (`&`, `|`, `!`, `:`) hiçbir şekilde
    karışamaz.
    """
    parts = terms(q)
    if not parts:
        # Yalnız noktalama yazılmış: hiçbir şeyle eşleşmeyen sorgu üret
        # (boş tsquery HER KAYDI getirmemeli).
        return func.to_tsquery("simple", "zzzzznomatch")
    return func.to_tsquery("simple", " & ".join(f"{t}:*" for t in parts))


def phrase_tsquery(q: str):
    """Normalize edilmiş `phraseto_tsquery` — sıralı ifade eşleşmesi bonusu.

    Filtre değil, yalnız SIRALAMA skorunda kullanılır: "yaşam kütüphanesi"
    tam sırayla geçen kayıt üste çıksın.
    """
    return func.phraseto_tsquery("simple", normalize_tr(q))
