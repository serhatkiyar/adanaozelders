"""TB-70 · "En beğenilen" ile "Önerilen" AYNI sıralama olamaz — gerçek PG.

## Neden

`docs/teknik-borc.md` TB-70: vitrin kuşakları aynı ürünleri gösteriyordu.
Ölçülen kök neden `services/store_service.py`de: `sort == "rating"` dalı
`ORDER BY skor DESC, created_at DESC, id DESC` üretiyordu ve bu, varsayılan
dalla **birebir aynıydı**. Katalogda 4695 üründen yalnız 1'inin puanı olduğu
için Bayesian skor herkeste eşit çıkıyor, bağ `created_at`e düşüyor ve
"En beğenilen" fiilen "En yeni" oluyordu.

Yani kusur "sıralama biraz farklı" değil: iki ayrı menü seçeneği aynı SQL'i
üretiyordu ve kullanıcı seçim yaptığını sanıyordu.

## Ölçülen sözleşme

"En beğenilen" PUANLANMIŞ ürünü, daha yeni ama puansız ürünlerin ÜSTÜNE
koyar. Varsayılan sıralama bunu yapmaz (skorlar eşitken en yeni öne geçer).
İki sıralamanın çıktısı bu veride AYNI OLMAMALIDIR.
"""
from __future__ import annotations

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from services import store_service

pytestmark = pytest.mark.asyncio


async def _puanla(product_id: int, *, toplam: int, adet: int) -> None:
    """Puanı doğrudan kolona yazar.

    Üretimde puan yorumlardan türer; burada ölçülen şey SIRALAMA, yorum akışı
    değil. Kolonlar sıralamanın girdisidir.
    """
    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "UPDATE products SET rating_sum = :t, rating_count = :a "
                "WHERE id = :i"
            ),
            {"t": toplam, "a": adet, "i": product_id},
        )
        await s.commit()


async def _sirala(sort: str | None, ids: set[int]) -> list[int]:
    """Verilen sıralamayla arama yapar; YALNIZ testin ürettiği ürünleri döner."""
    async with AsyncSessionLocal() as s:
        sonuc = await store_service.search_products(s, sort=sort, limit=100)
    return [urun.id for urun in sonuc if urun.id in ids]


async def test_en_begenilen_varsayilandan_FARKLI_siralar(fab12):
    """TB-70'in kanıtı: iki seçenek aynı sırayı üretemez."""
    # Önce eski ve PUANLI, sonra iki yeni ve PUANSIZ ürün.
    eski = await fab12.kitap(title="TB70 Eski Puanli")
    yeni1 = await fab12.kitap(title="TB70 Yeni A")
    yeni2 = await fab12.kitap(title="TB70 Yeni B")
    await _puanla(eski.id, toplam=48, adet=10)  # 4.8 ortalama, 10 oy

    ids = {eski.id, yeni1.id, yeni2.id}
    begenilen = await _sirala("rating", ids)
    varsayilan = await _sirala(None, ids)

    # 1) "En beğenilen" puanlanmış ürünü öne alır.
    assert begenilen[0] == eski.id, begenilen

    # 2) Varsayılan sıralama bunu YAPMAZ: skorlar eşitken en yeni öne geçer.
    assert varsayilan[0] != eski.id, varsayilan

    # 3) Asıl sözleşme: iki sıralama aynı diziyi üretemez.
    assert begenilen != varsayilan, (
        "'En beğenilen' ile 'Önerilen' aynı sırayı üretti — TB-70 geri döndü"
    )


async def test_puansiz_katalogda_iki_siralama_cakisabilir(fab12):
    """Sınır durumu AÇIKÇA kayda geçer.

    Hiç puanlanmış ürün yoksa "en beğenilen" sıralayacak bir şey bulamaz ve
    varsayılanla çakışması DOĞRUDUR. Bu testin varlığı, yukarıdaki iddianın
    "her koşulda farklı olsun" diye yanlış anlaşılmasını engeller.
    """
    a = await fab12.kitap(title="TB70 Puansiz A")
    b = await fab12.kitap(title="TB70 Puansiz B")
    ids = {a.id, b.id}
    assert await _sirala("rating", ids) == await _sirala(None, ids)
