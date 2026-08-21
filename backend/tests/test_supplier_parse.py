"""Yıldırım yanıtlarının ayrıştırılması — SAF, ağsız.

Ayrıştırma ağdan bilinçli olarak ayrıldı (`core/payments/iyzico.py::build_auth_headers`
deseni): gerçek yanıt şekli bir fixture'da durur, dönüşüm saf bir fonksiyondur ve
pytest'lenir. Fixture GERÇEK ölçümden (`yildirim-b2b-rapor` §2.4/2.5) türetildi;
yalnız ürün adları ve barkodlar anonimleştirildi, **alan adları ve tipler
gerçektir**.

Bu dosyanın koruduğu iki kritik nokta:

* **D-3** — maliyet `kirilim` içindeki *varsayılan* kırılımdan gelir. Fixture'da
  `fiyatlar["55880"].net` (56.691) ile `kirilim["55880"]` varsayılanının `net`i
  (51.0219) bilerek FARKLIDIR; yanlış alanı okuyan bir uygulama bu testi geçemez.
* **D-4** — `stokBakiye` kesirli olabilir (ölçümde 12.5). `Decimal` ile okunur;
  `int()` ile okuyan uygulama 12.5'i 12 yapar ve testi kıramaz — bu yüzden
  fixture'daki değer tam sayı DEĞİLDİR ve eşitlik `Decimal("12.5")` ile kurulur.
"""
from __future__ import annotations

import json
import pathlib
from decimal import Decimal

import pytest

from core.suppliers.yildirim import chunk_ids, parse_favorites, parse_price_response

VERI = pathlib.Path(__file__).parent / "data"


def _yukle(ad: str) -> dict:
    return json.loads((VERI / ad).read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def favoriler():
    return {f.external_id: f for f in parse_favorites(_yukle("yildirim_favoriler.json"))}


@pytest.fixture(scope="module")
def fiyatlar():
    return parse_price_response(_yukle("yildirim_fiyat.json"))


# ── Favori listesi ──


def test_tum_favoriler_ayristirilir(favoriler):
    assert len(favoriler) == 6


def test_temel_alanlar_dogru_okunur(favoriler):
    f = favoriler[55880]
    assert f.code == "MAS 9321"
    assert f.brand == "MAS BION"
    assert f.category_path == "KIRTASİYE > OFİS ÜRÜNLERİ > Makaslar"
    assert f.barcode == "8691217932103"
    assert f.has_image is True
    assert f.stock_status == "H"


def test_kesirli_stok_decimal_olarak_korunur(favoriler):
    """`stokBakiye` 12.5 gelebiliyor (rapor §2.4). Tamsayıya yuvarlamak,
    tedarikçide 12,5 düzine varken 12 düzine varmış gibi davranmaktır."""
    f = favoriler[11003]
    assert isinstance(f.stock_qty, Decimal)
    assert f.stock_qty == Decimal("12.5")


def test_para_alanlari_float_degil_decimal(favoriler):
    f = favoriler[55880]
    assert isinstance(f.list_price, Decimal)
    # 44.897 float üzerinden geçseydi 44.896999999999998 olurdu.
    assert f.list_price == Decimal("44.897")


def test_kdv_yuzdeden_orana_cevrilir(favoriler):
    """API `kdv: 20` (yüzde) verir; bizde `tax_rate` ORANDIR (0.20).

    Dönüşüm sınırda yapılır — aksi halde iki birim sistemi kod içinde yan yana
    yaşar ve biri ötekinin yerine geçtiğinde hata yalnız faturada görünür."""
    assert favoriler[55880].vat_rate == Decimal("0.20")
    assert favoriler[11003].vat_rate == Decimal("0.10")
    assert favoriler[77394].vat_rate == Decimal("0")


def test_satis_birimi_varsayilan_birimden_okunur(favoriler):
    """Fiyat ve stok `birimler[0]` cinsindendir; birim adı saklanmak zorunda —
    "12,5" sayısı tek başına 12,5 adet mi 12,5 düzine mi söylemez."""
    assert favoriler[55880].unit_name == "Adet"
    assert favoriler[11003].unit_name == "Düzine"
    assert favoriler[93075].unit_name == "Paket"
    assert favoriler[11003].unit_multiplier == Decimal("1")


def test_barkodsuz_urun_none_dondurur(favoriler):
    assert favoriler[93075].barcode is None


def test_stoksuz_urun(favoriler):
    f = favoriler[39236]
    assert f.stockless is True
    assert f.stock_qty == Decimal("0")


def test_gorseli_olmayan_urun_isaretlenir(favoriler):
    assert favoriler[93075].has_image is False


def test_acilis_tarihi_okunur(favoriler):
    """Rapor `acilisTarihi`'nin artımlı senkron için güvenilmez olduğunu söylüyor
    (10.290 üründe aynı damga) — yine de saklanır, yalnız KARAR VERİCİ değildir."""
    assert favoriler[11003].opened_at is not None
    assert favoriler[11003].opened_at.year == 2026


def test_ciplak_liste_de_kabul_edilir():
    """Rapor zarf şeklini `/favoriler/urunler` için açıkça yazmıyor.

    İki olasılık var: `{"urunler": [...]}` (arama zarfı) veya çıplak liste.
    Ayrıştırıcı ikisini de kabul eder — yanlış tahmin, ilk gerçek koşuda
    "0 favori bulundu" diye SESSİZ bir başarı üretirdi."""
    zarf = _yukle("yildirim_favoriler.json")
    ciplak = parse_favorites(zarf["urunler"])
    assert len(ciplak) == 6


def test_bos_yanit_bos_liste_verir():
    assert parse_favorites({"urunler": []}) == []
    assert parse_favorites([]) == []


# ── Fiyat yanıtı ──


def test_maliyet_varsayilan_kirilimdan_gelir_zarftan_degil(fiyatlar):
    """D-3'ün NÖBETÇİSİ.

    Rapor 100 üründe ölçtü: `fiyatlar[id].net` 99'unda varsayılan kırılımdan
    ortalama %10,1 PAHALI. Zarftaki `net`i maliyet sanmak, her üründe ~%10
    yanlış marj demektir."""
    p = fiyatlar[55880]
    varsayilan = p.default_breakdown
    assert varsayilan is not None
    assert varsayilan.name == "PEŞİN"
    assert varsayilan.net == Decimal("51.0219")
    # Zarftaki değer de saklanır ama maliyet DEĞİLDİR; ikisinin farklı olduğu
    # bu fixture'da kanıtlıdır.
    assert p.envelope_net == Decimal("56.691")
    assert varsayilan.net != p.envelope_net


def test_panel_dogrulamasi_cinar_defteri(fiyatlar):
    """Rapor §2.6'daki elle doğrulanmış örnek: panel "size özel 153 TL +KDV %10"
    diyor, hesabımız 168,30 TL vermeli."""
    p = fiyatlar[11003]
    assert p.default_breakdown.net == Decimal("153.0")
    assert p.vat_rate == Decimal("0.10")


def test_kirilimsiz_urun_varsayilani_none(fiyatlar):
    """93075'in `fiyatlar` kaydı var ama `kirilim`i yok → maliyet HESAPLANAMAZ.
    Uydurulmuş bir maliyet, zararına satışı görünmez yapardı."""
    p = fiyatlar[93075]
    assert p.breakdowns == ()
    assert p.default_breakdown is None


def test_iskonto_zincirinden_yeniden_hesaplanmaz(fiyatlar):
    """Bazı fiyatlar elle girilmiştir ve iskonto zincirinden TÜREMEZ
    (rapor: id 39236 → taban 5060, net 3499). API'nin verdiği `net` olduğu
    gibi alınır."""
    p = fiyatlar[39236]
    assert p.base == Decimal("5060.0")
    assert p.default_breakdown.net == Decimal("3499.0")


def test_doviz_ve_kampanya_bayraklari(fiyatlar):
    assert fiyatlar[70213].campaign is True
    assert fiyatlar[55880].campaign is False
    assert fiyatlar[90002].currency_id == 2
    assert fiyatlar[55880].currency_id == 1


def test_kayan_nokta_artigi_decimal_ile_korunur(fiyatlar):
    """API `147.39999999999998` gibi değerler döndürüyor. `Decimal(str(x))` ile
    okunur; `float` üzerinden geçerse yuvarlama hatası kuruşa yansır."""
    assert fiyatlar[77394].default_breakdown.net == Decimal("147.39999999999998")


def test_bilinmeyen_id_yanitta_yoksa_sozlukte_de_yok(fiyatlar):
    assert 424242 not in fiyatlar


# ── Batch bölme ──


def test_batch_siniri_yuzdur():
    """`POST /fiyat` 100 ID'de 200, 200 ID'de 400 döndürüyor (rapor §2.5)."""
    parcalar = chunk_ids(list(range(1, 251)), 100)
    assert [len(p) for p in parcalar] == [100, 100, 50]


def test_tam_yuz_tek_parca_kalir():
    assert len(chunk_ids(list(range(100)), 100)) == 1


def test_bos_liste_parcalanmaz():
    assert chunk_ids([], 100) == []


def test_batch_hicbir_id_kaybetmez():
    kaynak = list(range(1, 251))
    duz = [x for p in chunk_ids(kaynak, 100) for x in p]
    assert duz == kaynak
