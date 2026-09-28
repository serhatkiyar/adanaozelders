"""Kök SEO adresleri (Modül 6) — saf kurallar, veritabanı YOK.

Korunan sözleşmeler:
  * İlan adresi başlıktan Türkçe sadeleştirmeyle üretilir, dolgu sözcüğü
    taşımaz, ~80 karakteri aşmaz.
  * İlan adresi ders sayfası (`-ozel-ders`) ya da ilçe (tek sözcük) biçimine
    ASLA düşmez — türler arası çakışma inşa yoluyla imkânsız.
  * Çakışma `-2`, `-3` ile çözülür; rezerve kök adlar hiçbir kayda verilmez.
  * Rezerve liste frontend'in rota tablosunu ve `public/` kökünü kapsar
    (yeni bir kök sayfa eklenip buraya yazılmazsa bu dosya kırılır).
  * Ön-çizim şablona doğru enjekte eder; SSS yalnız gerçek sayıdan doğar.
"""
from __future__ import annotations

import re
from pathlib import Path
from types import SimpleNamespace

import pytest

from core import seo_adres
from services import on_cizim
from services.seo_sayfa_service import (
    _Egitmen,
    ders_aciklamasi,
    ders_basligi,
    ders_sss,
    egitmen_id,
    ilan_basligi,
    istatistik,
    kisi_ld,
    tl,
)

_FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


# ── İlan adresi üretimi ────────────────────────────────────────────────────


def test_turkce_karakter_sadelesir_ve_dolgu_atilir() -> None:
    assert (
        seo_adres.ilan_slug_tabani("LGS ve YKS Matematik – Seyhan'da yüz yüze")
        == "lgs-yks-matematik-seyhan-yuz-yuze"
    )
    assert seo_adres.ilan_slug_tabani("Şık, ÇOK güzel Öğretmen için İngilizce") == (
        "sik-guzel-ogretmen-ingilizce"
    )


def test_ilce_baslikta_yoksa_sona_eklenir_varsa_eklenmez() -> None:
    assert seo_adres.ilan_slug_tabani("LGS Matematik dersleri", "çukurova") == (
        "lgs-matematik-dersleri-cukurova"
    )
    assert seo_adres.ilan_slug_tabani("Seyhan LGS Matematik", "Seyhan") == (
        "seyhan-lgs-matematik"
    )
    # Adana ilçesi olmayan değer adrese UYDURULMAZ.
    assert seo_adres.ilan_slug_tabani("LGS Matematik", "Merkez") == "lgs-matematik"


def test_uzunluk_siniri_sozcuk_ortasindan_kesmez() -> None:
    uzun = "deneyimli matematik öğretmeninden birebir etkili sonuç odaklı " * 4
    slug = seo_adres.ilan_slug_tabani(uzun, "Yüreğir")
    assert len(slug) <= seo_adres.ILAN_AZAMI_UZUNLUK
    assert slug.endswith("-yuregir")
    assert seo_adres.gecerli_slug_mi(slug)


@pytest.mark.parametrize(
    "baslik",
    ["Matematik özel ders", "Özel ders", "", None, "İngilizce", "ve ile için"],
)
def test_ilan_adresi_ders_ya_da_ilce_bicimine_dusmez(baslik) -> None:
    slug = seo_adres.ilan_slug_tabani(baslik)
    assert seo_adres.gecerli_slug_mi(slug)
    assert not seo_adres.ders_sayfasi_mi(slug), slug
    assert "-" in slug, "tek sözcüklü ilan adresi ilçe adresiyle çakışır"


def test_cakismada_sira_eki_rezerve_ad_verilmez() -> None:
    assert seo_adres.benzersiz_yap_kume("lgs-matematik", []) == "lgs-matematik"
    assert (
        seo_adres.benzersiz_yap_kume("lgs-matematik", ["lgs-matematik"])
        == "lgs-matematik-2"
    )
    assert (
        seo_adres.benzersiz_yap_kume(
            "lgs-matematik", ["lgs-matematik", "lgs-matematik-2"]
        )
        == "lgs-matematik-3"
    )
    # Başlıktan rezerve bir kök ad doğarsa (ör. "Şifremi unuttum") verilmez.
    taban = seo_adres.ilan_slug_tabani("Şifremi unuttum")
    assert taban == "sifremi-unuttum"
    assert seo_adres.benzersiz_yap_kume(taban, []) == "sifremi-unuttum-2"


def test_ilce_adlari_tek_sozcuk_ve_gecerli() -> None:
    for ad in seo_adres.ADANA_ILCELERI:
        slug = seo_adres.ilce_slugu(ad)
        assert seo_adres.gecerli_slug_mi(slug) and "-" not in slug, ad
        assert not seo_adres.rezerve_mi(slug), ad


# ── Rezerve liste ↔ frontend rota tablosu (nöbetçi) ───────────────────────


def _ilk_parcalar(yollar) -> set[str]:
    out = set()
    for yol in yollar:
        parca = yol.strip("/").split("/")[0]
        if parca and not parca.startswith(":") and parca != "*":
            out.add(parca)
    return out


def test_rezerve_liste_frontend_rotalarini_kapsar() -> None:
    routes = (_FRONTEND / "src" / "lib" / "routes.ts").read_text(encoding="utf-8")
    paths_blok = routes.split("export const PATHS", 1)[1].split("} as const", 1)[0]
    app = (_FRONTEND / "src" / "App.tsx").read_text(encoding="utf-8")
    yollar = re.findall(r':\s*"(/[^"]*)"', paths_blok)
    yollar += re.findall(r'path="(/[^"]*)"', app)
    yollar += re.findall(r'\[\s*"(/[^"]*)"\s*,', app)  # LEGACY_STATIC
    parcalar = _ilk_parcalar(yollar)
    assert len(parcalar) > 40, "tarama rota bulamıyor (yalancı yeşil kapısı)"
    eksik = sorted(parcalar - seo_adres.REZERVE_ADLAR)
    assert not eksik, f"kök rota rezerve listede yok: {eksik}"


def test_rezerve_liste_public_kokunu_kapsar() -> None:
    adlar = {p.name for p in (_FRONTEND / "public").iterdir()}
    assert "robots.txt" in adlar
    eksik = sorted(adlar - seo_adres.REZERVE_ADLAR)
    assert not eksik, f"public/ kökündeki ad rezerve listede yok: {eksik}"


# ── Sayfa metinleri: yalnız gerçek sayılar ────────────────────────────────


def _e(ucret, mod="BOTH", ilk=True, yorum=0, puan=0) -> _Egitmen:
    return _Egitmen(1, "Seyhan", ucret, mod, ilk, yorum, puan)


def test_istatistik_ve_baslik() -> None:
    ist = istatistik([_e(500.0, "IN_PERSON"), _e(1000.0, "ONLINE", ilk=False), _e(None)])
    assert (ist.egitmen_sayisi, ist.ucretli_sayisi) == (3, 2)
    assert (ist.en_dusuk_ucret, ist.en_yuksek_ucret, ist.ortalama_ucret) == (500, 1000, 750)
    assert (ist.yuz_yuze_sayisi, ist.online_sayisi) == (2, 2)
    assert ist.ilk_ders_ucretsiz_sayisi == 2
    assert ders_basligi("Matematik", 3) == (
        "Adana Matematik Özel Ders – 3 Öğretmen | Adana Özel Ders"
    )
    assert ders_basligi("Matematik", 1, "Seyhan").startswith("Seyhan Matematik Özel Ders")
    assert "500 TL – 1.000 TL" in ders_aciklamasi("Matematik", ist)
    assert tl(1250) == "1.250 TL"


def test_ucret_yoksa_ucret_sorusu_uydurulmaz() -> None:
    ist = istatistik([_e(None, "ONLINE", ilk=False)])
    sorular = [s.soru for s in ders_sss("Fizik", ist, None, [])]
    assert not any("ücret" in s for s in sorular)
    assert not any("İlk ders" in s for s in sorular)
    assert " TL" not in ders_aciklamasi("Fizik", ist)


def test_ilan_basligi_isimle_baslamaz() -> None:
    assert ilan_basligi("LGS Matematik", "Dilan", "Matematik") == (
        "LGS Matematik | Adana Matematik Özel Ders"
    )
    # Başlık yoksa ad kullanılır ama ders kalıbı yine sonda.
    assert ilan_basligi(None, "Dilan", None) == "Dilan | Adana Özel Ders"


# ── Ön-çizim enjeksiyonu ──────────────────────────────────────────────────

_SABLON = """<!doctype html>
<html lang="tr">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="description"
      content="jenerik"
    />
    <title>Jenerik</title>
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>"""


def test_sablona_head_ve_govde_enjekte_edilir() -> None:
    head = on_cizim.head_etiketleri(
        baslik="Adana Fizik Özel Ders – 2 Öğretmen | Adana Özel Ders",
        aciklama='A "b" <c>',
        yol="/fizik-ozel-ders",
        json_ld=[{"@type": "FAQPage", "x": "</script><script>alert(1)"}],
    )
    html = on_cizim.enjekte(_SABLON, head, "<main><h1>Adana Fizik Özel Ders</h1></main>")
    assert "Jenerik" not in html and "jenerik" not in html
    assert html.count("<title") == 1 and 'name="description"' in html
    assert "&quot;b&quot; &lt;c&gt;" in html
    assert 'rel="canonical" href="http://' in html and "/fizik-ozel-ders" in html
    assert "</script><script>alert" not in html, "JSON-LD `<` kaçışlanmalı"
    assert '<div id="root"><main><h1>Adana Fizik Özel Ders</h1></main></div>' in html
    # Asset yolu bozulmaz.
    assert 'src="/assets/index-abc.js"' in html
    # react-helmet-async açılışta bu etiketleri kendi etiketleriyle değiştirir.
    assert 'data-rh="true"' in html


# ── İlan yapısal verisi ───────────────────────────────────────────────────


def _ilan(**kw) -> SimpleNamespace:
    t = dict(
        display_name="Dilan",
        headline="LGS Matematik",
        subjects=["Matematik"],
        district="seyhan",
        hourly_rate=600,
        rating_count=0,
        rating_average=None,
    )
    t.update(kw)
    return SimpleNamespace(**t)


def test_puan_person_uzerinde_degil_hizmette() -> None:
    """schema.org'da `aggregateRating` Person'ın özelliği değildir; doğrulayıcı
    onu tanımaz. Puan öğretmenin sunduğu hizmete (Service) bağlanır."""
    ld = kisi_ld(_ilan(rating_count=4, rating_average=4.75), "Matematik", "/x-y", None)
    assert ld["@type"] == "Person" and "aggregateRating" not in ld
    hizmet = ld["makesOffer"]["itemOffered"]
    assert hizmet["@type"] == "Service" and hizmet["name"] == "Matematik özel ders"
    assert hizmet["aggregateRating"]["reviewCount"] == 4
    assert hizmet["aggregateRating"]["ratingValue"] == 4.75
    assert ld["makesOffer"]["price"] == 600.0 and ld["makesOffer"]["priceCurrency"] == "TRY"
    assert ld["address"]["addressLocality"] == "Seyhan"


def test_yorumsuz_ilanda_puan_uydurulmaz() -> None:
    ld = kisi_ld(_ilan(), "Matematik", "/x-y", None)
    assert "aggregateRating" not in ld["makesOffer"]["itemOffered"]


def test_ucret_ve_puan_yoksa_teklif_dugumu_yok() -> None:
    ld = kisi_ld(_ilan(hourly_rate=None), None, "/x-y", None)
    assert "makesOffer" not in ld


def test_ucretsiz_ama_puanli_ilanda_fiyat_uydurulmaz() -> None:
    ld = kisi_ld(_ilan(hourly_rate=None, rating_count=2, rating_average=5.0), None, "/x-y", None)
    assert "price" not in ld["makesOffer"]
    assert ld["makesOffer"]["itemOffered"]["aggregateRating"]["reviewCount"] == 2


def test_eski_egitmen_adresinden_id() -> None:
    assert egitmen_id("dilan-4") == 4
    assert egitmen_id("4") == 4
    assert egitmen_id("dilan") is None
