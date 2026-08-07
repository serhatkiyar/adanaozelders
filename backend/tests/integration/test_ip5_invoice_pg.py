"""İP-5 · F-1…F-5 — sunucu taraflı fatura ucu (gerçek HTTP + gerçek PG).

Denetim raporu, eksik akış 4: fatura indirilemiyor; `OrderInvoiceModal` kendi
istemci tarafı HTML sürrogatını üretiyor ve bunu kendisi yazıyor. Sunucuda uç
YOK; satıcı kimliği istemci sabitinden geliyor, ödeme satırı ("iyzico ile
ödeme") SABİT YAZILI — yani belge bugün gerçeği söylemiyor.

Bu dosya ucun **gerçek yetki çözümüyle** çalıştığını ve döndürdüğü kırılımın
DB'deki değerlerle birebir aynı olduğunu ölçer.

Kapı sözleşmesi (S-6 ekleri):
* ``INVOICE_ENABLED`` False iken uç YOK gibi davranır (404 — 403 ucun
  varlığını sızdırırdı).
* Kırılımı eksik sipariş (kargo oranı belirlenmemiş / eski sipariş) → 409.
* Satıcı kimliği eksik yapılandırılmışsa → 409. Eksik satıcı bilgisiyle fatura
  üretmek, kargo oranı boşken üretmekle aynı sınıf hatadır.
* Ödenmemiş sipariş → 409: belge ödeme bilgisi (sağlayıcı + tarih) taşır.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from core.config import settings

pytestmark = pytest.mark.asyncio

D = Decimal


@pytest.fixture(autouse=True)
def _fatura_acik(monkeypatch):
    """Testlerde uç AÇIK ve satıcı kimliği TAM.

    Üretimde tersi geçerlidir: ``INVOICE_ENABLED`` varsayılanı False'tur ve
    mali müşavir teyidi gelene kadar açılmaz (S-3/S-6). Değerler test
    verisidir; koda gömülü değildir.
    """
    monkeypatch.setattr(settings, "INVOICE_ENABLED", True, raising=False)
    monkeypatch.setattr(settings, "SHIPPING_TAX_RATE", 0.20, raising=False)
    monkeypatch.setattr(
        settings, "INVOICE_SELLER_NAME", "IP5 Test Satıcı", raising=False
    )
    monkeypatch.setattr(
        settings, "INVOICE_SELLER_TAX_NUMBER", "5590521517", raising=False
    )
    monkeypatch.setattr(
        settings, "INVOICE_SELLER_TAX_OFFICE", "Test VD", raising=False
    )
    monkeypatch.setattr(
        settings, "INVOICE_SELLER_ADDRESS", "Adana, Türkiye", raising=False
    )
    monkeypatch.setattr(settings, "INVOICE_SELLER_PHONE", "+905550000000", raising=False)
    monkeypatch.setattr(
        settings, "INVOICE_SELLER_EMAIL", "bilgi@test.local", raising=False
    )


async def _kargosuz_siparis(http, fab5, musteri=None):
    """Eşik üstü (kargo 0) karışık oranlı sipariş — kırılımı TAM."""
    m = musteri or await fab5.musteri()
    kitap = await fab5.urun(price="100.00", tax_rate="0", stock=10)
    kirtasiye = await fab5.urun(price="120.00", tax_rate="0.20", stock=10)
    o = await fab5.siparis_ver(http, m, items=[(kitap, 3), (kirtasiye, 3)])
    return m, o


# ── F-1 · Sahibi için 200 ───────────────────────────────────────────────────


async def test_f1_sahibi_faturayi_alabiliyor(http, fab5):
    m, o = await _kargosuz_siparis(http, fab5)
    r = await http.get(
        f"/api/v1/store/orders/{o['id']}/invoice", headers=m.headers
    )
    assert r.status_code == 200, r.text
    g = r.json()
    assert g["order_id"] == o["id"]
    assert g["seller"]["tax_number"] == "5590521517"
    assert g["buyer"]["name"]
    assert g["payment"]["provider"], "ödeme sağlayıcısı boş"
    assert g["payment"]["paid_at"], "ödeme tarihi boş"


# ── F-2 · Yabancı müşterinin siparişi → 404 ─────────────────────────────────


async def test_f2_yabanci_musteri_404(http, fab5):
    _, o = await _kargosuz_siparis(http, fab5)
    yabanci = await fab5.musteri()

    r = await http.get(
        f"/api/v1/store/orders/{o['id']}/invoice", headers=yabanci.headers
    )
    assert r.status_code == 404, (
        f"başkasının faturası sızdı: {r.status_code} {r.text}"
    )
    # Gövde siparişin VARLIĞINI de sızdırmamalı.
    assert str(o["id"]) not in r.text or "bulunamadı" in r.text.lower()


# ── F-3 · Anonim → 401 ──────────────────────────────────────────────────────


async def test_f3_anonim_401(http, fab5):
    _, o = await _kargosuz_siparis(http, fab5)
    r = await http.get(f"/api/v1/store/orders/{o['id']}/invoice")
    assert r.status_code == 401, r.text


# ── F-4 · Kırılım DB'deki değerlerle BİREBİR aynı ───────────────────────────


async def test_f4_kirilim_dbdeki_degerlerle_ayni(http, fab5):
    """Fatura, kaydı YENİDEN HESAPLAMAZ; sipariş anında saklananı okur."""
    m, o = await _kargosuz_siparis(http, fab5)
    v = await fab5.siparis_vergisi(o["id"])

    r = await http.get(
        f"/api/v1/store/orders/{o['id']}/invoice", headers=m.headers
    )
    assert r.status_code == 200, r.text
    g = r.json()

    assert D(str(g["totals"]["net_total"])) == v["net_total"]
    assert D(str(g["totals"]["tax_total"])) == v["tax_total"]
    assert D(str(g["totals"]["grand_total"])) == v["total"]

    fatura_kirilim = {
        str(s["rate"]): (D(str(s["base"])), D(str(s["tax"])))
        for s in g["tax_lines"]
    }
    db_kirilim = {
        str(s["rate"]): (D(str(s["base"])), D(str(s["tax"])))
        for s in v["tax_breakdown"]
    }
    assert fatura_kirilim == db_kirilim


async def test_f4b_kalem_satirlari_snapshot_oranini_tasiyor(http, fab5):
    m, o = await _kargosuz_siparis(http, fab5)
    kalemler = {k["id"]: k for k in await fab5.kalem_vergileri(o["id"])}

    r = await http.get(
        f"/api/v1/store/orders/{o['id']}/invoice", headers=m.headers
    )
    assert r.status_code == 200, r.text
    for satir in r.json()["items"]:
        db_kalem = kalemler[satir["order_item_id"]]
        assert D(str(satir["tax_rate"])) == db_kalem["tax_rate"]
        assert D(str(satir["tax_amount"])) == db_kalem["tax_amount"]


async def test_f4c_kargo_orani_belirsizse_409(http, fab5, monkeypatch):
    """S-3 eki: kırılımı eksik siparişte fatura üretilmez, açıkça reddedilir."""
    monkeypatch.setattr(settings, "SHIPPING_TAX_RATE", None, raising=False)
    m = await fab5.musteri()
    kitap = await fab5.urun(price="100.00", tax_rate="0", stock=10)
    o = await fab5.siparis_ver(http, m, items=[(kitap, 2)])  # eşik altı → kargolu

    v = await fab5.siparis_vergisi(o["id"])
    assert v["shipping_tax_rate"] is None  # önkoşul

    r = await http.get(
        f"/api/v1/store/orders/{o['id']}/invoice", headers=m.headers
    )
    assert r.status_code == 409, r.text


async def test_f4d_kirilimsiz_eski_siparis_409(http, fab5):
    """S-4: geriye dönük hesap YOK → eski siparişte fatura üretilmez.

    Tarihsel siparişin vergisini sonradan uydurmak, muhasebe açısından yanlış
    bir belge üretmek demektir; uç bunu 409 ile reddeder.
    """
    from sqlalchemy import text as sa_text

    from core.database import AsyncSessionLocal

    m, o = await _kargosuz_siparis(http, fab5)
    async with AsyncSessionLocal() as s:
        await s.execute(
            sa_text(
                "UPDATE orders SET tax_breakdown = NULL, tax_total = NULL, "
                "net_total = NULL WHERE id = :i"
            ),
            {"i": o["id"]},
        )
        await s.commit()

    r = await http.get(
        f"/api/v1/store/orders/{o['id']}/invoice", headers=m.headers
    )
    assert r.status_code == 409, r.text


async def test_f4e_satici_kimligi_eksikse_409(http, fab5, monkeypatch):
    monkeypatch.setattr(settings, "INVOICE_SELLER_ADDRESS", "", raising=False)
    m, o = await _kargosuz_siparis(http, fab5)
    r = await http.get(
        f"/api/v1/store/orders/{o['id']}/invoice", headers=m.headers
    )
    assert r.status_code == 409, r.text


# ── F-5 · Ödenmemiş sipariş → 409 · kapalı bayrak → 404 ─────────────────────


async def test_f5_odenmemis_siparis_409(http, fab5):
    from sqlalchemy import text as sa_text

    from core.database import AsyncSessionLocal

    m, o = await _kargosuz_siparis(http, fab5)
    async with AsyncSessionLocal() as s:
        await s.execute(
            sa_text(
                "UPDATE orders SET payment_status = 'PENDING', paid_at = NULL, "
                "status = 'PENDING' WHERE id = :i"
            ),
            {"i": o["id"]},
        )
        await s.commit()

    r = await http.get(
        f"/api/v1/store/orders/{o['id']}/invoice", headers=m.headers
    )
    assert r.status_code == 409, r.text


async def test_f5b_bayrak_kapaliyken_404(http, fab5, monkeypatch):
    """Üretimde uç kapalı: varlığını sızdırmadan yok gibi davranır."""
    m, o = await _kargosuz_siparis(http, fab5)
    monkeypatch.setattr(settings, "INVOICE_ENABLED", False, raising=False)

    r = await http.get(
        f"/api/v1/store/orders/{o['id']}/invoice", headers=m.headers
    )
    assert r.status_code == 404, r.text


async def test_f5c_varsayilan_kapali(fab5):
    """Bayrak açıkça açılmadıkça kapalıdır — üretim varsayılanı budur.

    `_fatura_acik` fixture'ı ayarı monkeypatch'lediği için değeri sınıfın
    kendisinden okuyoruz: varsayılan tanımı değişirse bu test kırılır.
    """
    from core.config import Settings

    assert Settings.model_fields["INVOICE_ENABLED"].default is False
