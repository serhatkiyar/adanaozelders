"""İP-21 · Faz 3 — nöbetsiz kalmış GERÇEK davranışlar (gerçek PostgreSQL).

**Üretim kodundan ÖNCE yazıldı** (kök CLAUDE.md §E). Sözleşme §1/K-2.

Üç davranış bugün DOĞRU çalışıyor ama hiçbir test onları korumuyor: sökülünce
suite yeşil kalıyor. Ölçüldü (İP-21 teşhis turu, yeşil taban doğrulanarak):

  N-5/N-6 (TB-43)  `LEAST(…, total)` ve `COALESCE(refunded_at, now())`
                   söküldü → 31 para testinin hiçbiri kırılmadı.
  N-7     (TB-44)  `study_queue::_order_id` tersine çevrildi → 33 test
                   kırılmadı.

Neden mevcut testler görmüyor — her üçünde de aynı sebep: **fixture, davranışın
ayırt edici olduğu durumu hiç üretmiyor.** Tam iade tek adımda `LEAST`'i de
`COALESCE`'ı da devreye sokmaz (sıfırdan tam tutara giden tek hareket tavana
çarpmaz, `refunded_at` zaten NULL'dur). Tek yeni kartla sıra gözlenemez.
Yani testler "yanlış" değil, **yetersiz**: doğru şeyi ölçüyorlar ama korumanın
devreye girdiği hâli hiç kurmuyorlar.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from core.database import AsyncSessionLocal
from services import order_service
from tests.integration.ip16_factory import deste, kuyruk, not_ekle
from tests.integration.ip2a_factory import IadeFabrikasi


@pytest.fixture
async def fab(pg):
    f = IadeFabrikasi()
    try:
        yield f
    finally:
        await f.temizle()


# ── N-5/N-6 · TB-43: kümülatif kısmi iade tavanı + ilk damga ──────────────────
#
# `apply_refunded_amount` TEK YAZICIDIR (İP-2a/M6) ve doğrudan çağrılır: asıl
# ölçülen şey bu fonksiyonun SQL sözleşmesidir. RMA akışının üstünden geçmek
# ölçümü zayıflatırdı — `reservable_refund` tavanı iki kısmi iadenin toplamını
# zaten `total`'a kırpar ve `LEAST`'in kendisi hiç devreye girmez. Yani üstteki
# tavan, alttaki tavanı GÖRÜNMEZ kılar; korumanın kaldırıldığı bir dünyada
# hesap yine doğru çıkar ve boşluk fark edilmez.


async def test_N5_kumulatif_kismi_iade_total_i_ASAMAZ(fab):
    """🔴 `LEAST(refunded_amount + :a, total)` sökülünce hiçbir test kırılmıyor.

    Gerçek risk: kolon `total`'ı aşarsa ciro raporu **negatif net ciro**
    gösterir ve `escrow.order_inflight_refund`'ın `total - kesin` hesabı
    negatife düşer.
    """
    pid = await fab.urun(price="100.00", stock=5)
    siparis = await fab.siparis(items=[(pid, 1)])

    async with AsyncSessionLocal() as db:
        order = await order_service._load_full(db, siparis.order_id)
        assert order is not None
        toplam = Decimal(str(order.total))
        await order_service.apply_refunded_amount(db, order, toplam * Decimal("0.6"))
        await db.commit()

    async with AsyncSessionLocal() as db:
        order = await order_service._load_full(db, siparis.order_id)
        # İkinci hareket toplamı total'ın ÜSTÜNE çıkarmak ister.
        await order_service.apply_refunded_amount(db, order, toplam * Decimal("0.6"))
        await db.commit()

    satir = await fab.siparis_satiri(siparis.order_id)
    assert satir["refunded_amount"] == toplam, (
        f"iade toplamı total'ı aştı: {satir['refunded_amount']} > {toplam}"
    )


async def test_N6_refunded_at_ILK_iadenin_damgasini_korur(fab):
    """🔴 `COALESCE(refunded_at, now())` düz `now()` yapılınca test kırılmıyor.

    Damga iade penceresi ve denetim izi için okunur; her yeni kısmi iadede
    ezilirse "ilk iade ne zaman oldu" bilgisi kaybolur.
    """
    pid = await fab.urun(price="100.00", stock=5)
    siparis = await fab.siparis(items=[(pid, 1)])

    async with AsyncSessionLocal() as db:
        order = await order_service._load_full(db, siparis.order_id)
        await order_service.apply_refunded_amount(db, order, Decimal("10.00"))
        await db.commit()
    ilk = (await fab.siparis_satiri(siparis.order_id))["refunded_at"]
    assert ilk is not None, "ilk iade damgası hiç yazılmadı"

    async with AsyncSessionLocal() as db:
        order = await order_service._load_full(db, siparis.order_id)
        await order_service.apply_refunded_amount(db, order, Decimal("10.00"))
        await db.commit()
    ikinci = (await fab.siparis_satiri(siparis.order_id))["refunded_at"]

    assert ikinci == ilk, (
        f"ikinci kısmi iade ilk damgayı ezdi: {ilk} → {ikinci}"
    )


async def test_N6b_sifir_ve_negatif_tutar_HICBIR_SEY_yazmaz(fab):
    """DOLULUK NÖBETÇİSİ: erken çıkış (`if amount <= 0: return`) korunur —
    yoksa `refunded_at` sıfır tutarlı bir çağrıyla damgalanırdı."""
    pid = await fab.urun(price="100.00", stock=5)
    siparis = await fab.siparis(items=[(pid, 1)])

    async with AsyncSessionLocal() as db:
        order = await order_service._load_full(db, siparis.order_id)
        await order_service.apply_refunded_amount(db, order, Decimal("0"))
        await order_service.apply_refunded_amount(db, order, Decimal("-5"))
        await db.commit()

    satir = await fab.siparis_satiri(siparis.order_id)
    assert satir["refunded_amount"] == Decimal("0.00")
    assert satir["refunded_at"] is None, "sıfır tutarlı çağrı damga yazdı"


# ── N-7 · TB-44: yeni kart kovasının sırası ───────────────────────────────────


async def test_N7_yeni_kartlar_EKLENIS_sirasiyla_sunulur(ip16, ip16_http):
    """🔴 `_order_id` tersine çevrilince hiçbir test kırılmıyor.

    Sözleşme (İP-16 §4.1/Q-9) "yeni kartlar `card_id` artan = ekleniş sırası"
    diyor. Bugüne dek tek yeni kartla ölçülüyordu; tek kartla sıra
    **gözlemlenemez** — kova hangi sırayla dizilirse dizilsin aynı kart döner.

    Kullanıcıya etkisi: deste tasarımı sıraya bağlıysa (alfabe, konu sırası,
    kolaydan zora) öğrenme akışı bozulur ve hiçbir test bunu söylemez.
    """
    _, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr, name="Sıra denemesi")

    ilk_not = await not_ekle(ip16_http, hdr, d["id"], front="A", back="1")
    ikinci_not = await not_ekle(ip16_http, hdr, d["id"], front="B", back="2")
    assert ikinci_not["id"] > ilk_not["id"], "fixture kurgusu bozuk"

    q = await kuyruk(ip16_http, hdr, d["id"])
    kart = q.get("card") or q
    assert kart and kart.get("id"), f"kuyruk kart döndürmedi: {q}"

    # Kartlar notlarla aynı sırada üretilir; ilk notun kartı daha küçük id'lidir.
    from tests.integration.ip16_factory import kartlar

    liste = await kartlar(ip16_http, hdr, d["id"])
    kart_idler = sorted(c["id"] for c in (liste.get("items") or liste))
    assert len(kart_idler) >= 2, f"iki kart bekleniyordu: {kart_idler}"

    assert kart["id"] == kart_idler[0], (
        f"yeni kart kovası ekleniş sırasında sunulmadı: gelen {kart['id']}, "
        f"beklenen {kart_idler[0]} (kartlar: {kart_idler})"
    )
