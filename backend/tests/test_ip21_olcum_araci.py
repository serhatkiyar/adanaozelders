"""İP-21 · Faz 1 — ölçüm ARACININ kendi nöbetçileri (saf birim).

**Üretim kodundan ÖNCE yazıldı** (kök CLAUDE.md §E). Sözleşme:
`docs/ip21-nobetci-denetimi-sozlesme.md` §1/K-1.

Bu dosya bir paradoksu çözer: mutasyon provası, testlerin nöbetçiliğini
kanıtlayan araçtır — ama aracın kendisini kim kanıtlar? Buradaki düğümler
sürücünün iki bilinen kusurunu davranışla ölçer. İkisi de gerçek denetimlerde
bulundu, ikisi de **yanlış sayıya** yol açıyor:

  N-1 (TB-45)  Sürücü, mutasyondan ÖNCE hedef testlerin temiz ağaçta yeşil
               olduğunu doğrulamıyor. Zaten kırık bir test mutasyon altında da
               kırık kalır ve "YAKALANDI" sayılır. Denetçi ölçtü: sürücü
               "YAKALANDI (6)" dedi, altı testin beşi mutasyondan bağımsız
               olarak zaten kırıktı. Yön TEHLİKELİ — fazla sayar.
  N-2 (TB-42)  `ERROR` gölgelemesi yalnız içinde `::` geçen satırları sayar.
               Pytest, KOLEKSİYON düzeyinde patlayan dosyayı düğüm ayracı
               OLMADAN raporlar (`ERROR tests/x.py - NameError: …`) ve o satır
               sayılmaz. Yön güvenli (eksik sayar) ama yine de yanlış.

Neden saf birim: her iki kusur da metin ayrıştırma ve akış kontrolüdür;
gerçek pytest koşturmak ölçümü yavaşlatır ve ayırt ediciliği ARTIRMAZ. Sürücü
gerçek koşumu `_kos` ile yapar; düğümler onu değiştirerek akışı ölçer — yani
mock'un kendisi değil, sürücünün KARARI test edilir.
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND / "scripts") not in sys.path:
    sys.path.insert(0, str(BACKEND / "scripts"))


@pytest.fixture
def surucu():
    return importlib.import_module("mutation_drill")


# ── N-2 · TB-42: ERROR gölgelemesi ────────────────────────────────────────────


def test_N2_koleksiyon_hatasi_dugum_ayraci_olmadan_da_sayilir(surucu):
    """🔴 `ERROR tests/x.py - NameError: …` — pytest'in koleksiyon düzeyinde
    patlayan dosya için ürettiği biçim. `::` yok, bugün SAYILMIYOR.

    Bu, "test hiç koşamadı" hâlidir ve mutasyonun en sert yakalanışıdır;
    sayılmaması sürücüyü "YAKALANMADI" demeye iter, o da nöbetçi olan bir
    testi yetersiz ilan ettirir.
    """
    cikti = (
        "ERROR tests/integration/test_x_pg.py - NameError: name 'foo' is not defined\n"
        "1 error in 0.42s\n"
    )
    assert surucu._kirilanlar(cikti), "koleksiyon hatası kanıt sayılmadı"


def test_N2b_logger_ERROR_satiri_kanit_SAYILMAZ(surucu):
    """DOLULUK NÖBETÇİSİ — düzeltme "her ERROR'ı say"a dönüşemez.

    Yakalanan log çıktısı da `ERROR ` ile başlar. Onu saymak, ERROR log yazan
    HER mutasyonu "yakalandı" gösterirdi: ölçüm aracı yalancı yeşil üreticisine
    dönerdi. `::` şartı tam olarak bu yüzden konmuştu.
    """
    cikti = (
        "ERROR    adana.escrow:escrow.py:518 claim reddedildi order=42\n"
        "ERROR    adana:main.py:77 baglanti koptu\n"
        "1 passed in 3.20s\n"
    )
    assert not surucu._kirilanlar(cikti), "logger satırı kanıt sayıldı"


def test_N2c_bilinen_iki_bicim_calismaya_devam_eder(surucu):
    """Regresyon: FAILED ve düğüm ayraçlı ERROR bugün de sayılıyor."""
    assert surucu._kirilanlar("FAILED tests/x.py::test_y - assert 1 == 2\n")
    assert surucu._kirilanlar("ERROR tests/x.py::test_y - fixture patladi\n")


# ── N-1 · TB-45: yeşil taban çizgisi ──────────────────────────────────────────


def test_N1_ortak_surucu_yesil_taban_dogrular(surucu):
    """🔴 `_yesil_taban` ortak sürücüde YOK — yalnız `mutation_drill_ip18`'de.

    Referans uygulama hazırdır ve yeniden yazılmayacaktır (TB-45 "sonraki
    adım"); buraya taşınması gerekir.
    """
    assert hasattr(surucu, "_yesil_taban"), (
        "ortak sürücüde yeşil taban nöbetçisi yok — kırmızı tabanda "
        "'YAKALANDI' denebiliyor (TB-45)"
    )


def test_N1b_taban_kirmiziysa_mutasyon_HIC_UYGULANMAZ(surucu, monkeypatch):
    """Asıl iddia: kırmızı tabanda prova **başarısızlıktır** ve dosyaya
    dokunulmaz.

    Bu düğüm mock'un kendisini değil sürücünün KARARINI ölçer: `_kos`
    değiştirilir (hedef testler zaten kırık), `GeciciYama` ise gerçek
    davranışını kaybetmeden ÇAĞRILDI MI diye izlenir. Doğru davranışta yama
    hiç kurulmaz — çünkü ölçülecek bir şey yoktur.
    """
    yamalandi: list[str] = []

    class SahteSonuc:
        returncode = 1
        stdout = "FAILED tests/x.py::test_zaten_kirik - assert 0\n1 failed in 0.1s\n"
        stderr = ""

    def sahte_kos(*_a, **_k):
        return SahteSonuc()

    class SahteYama:
        def __init__(self, yol, eski, yeni):
            yamalandi.append(str(yol))

        def __enter__(self):
            return self

        def __exit__(self, *_a):
            return False

    monkeypatch.setattr(surucu, "_kos", sahte_kos)
    monkeypatch.setattr(surucu, "GeciciYama", SahteYama)
    monkeypatch.setattr(surucu, "_secilen_test_sayisi", lambda _m: 5)
    monkeypatch.setattr(surucu, "_agac_durumu", lambda: ("HEAD", ""))

    m = surucu.Mutasyon(
        "T1", "taban kırmızı senaryosu",
        "backend/services/order_service.py",
        "eski", "yeni",
        ("tests/integration/test_x_pg.py",),
    )
    sonuc = surucu.calistir(m, "HEAD", "")

    if isinstance(sonuc, tuple):
        sonuc = sonuc[0]
    assert sonuc is False, "kırmızı tabanda prova 'YAKALANDI' saydı (TB-45)"
    assert yamalandi == [], (
        f"taban kırmızıyken dosya yamalandı: {yamalandi} — ölçülecek bir şey yok"
    )
