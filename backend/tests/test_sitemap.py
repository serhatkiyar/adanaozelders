"""Sitemap üretimi (ekspertiz P0-30).

SPA liste sayfaları "Daha fazla göster" butonuyla sayfalanıyor; crawler ilk
sayfadan sonrasını göremiyordu. Bir pazaryerinin değeri uzun kuyruk
sorgularındadır — sitemap o kuyruğun tek erişim yoludur.

Kritik kural: URL'ler frontend rotalarıyla BİREBİR aynı olmalı. Sapma, Search
Console'da "tarama hatası" olarak birikir ve indekslemeyi bozar.
"""
from __future__ import annotations

import datetime
import xml.etree.ElementTree as ET

from services.sitemap_service import (
    STATIC_PATHS,
    _url_entry,
    blog_path,
    library_path,
    product_path,
    render_sitemap,
    tutor_path,
)

NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"


def test_url_yollari_frontend_rotalariyla_ayni() -> None:
    """frontend/src/lib/routes.ts:
    tutor: "/egitmenler/:slug" · storeProduct: "/magaza/urun/:slug"
    """
    assert tutor_path("ayse-yilmaz-12") == "/egitmenler/ayse-yilmaz-12"
    assert library_path("merkez-kutuphane") == "/kutuphaneler/merkez-kutuphane"
    assert product_path("tyt-matematik") == "/magaza/urun/tyt-matematik"
    assert blog_path("tyt-calisma-programi") == "/blog/tyt-calisma-programi"


def test_statik_sayfalar_kapsanmis() -> None:
    paths = [p for p, _f, _pr in STATIC_PATHS]
    # Ana giriş noktaları ve destek/yasal sayfalar indekslenebilir olmalı.
    for expected in ("/", "/egitmenler", "/kutuphaneler", "/magaza", "/blog", "/sss", "/iletisim"):
        assert expected in paths
    # Oturum-içi yollar sitemap'e GİRMEMELİ (robots.txt zaten Disallow eder).
    for forbidden in ("/hesabim", "/mesajlar", "/siparislerim", "/giris"):
        assert forbidden not in paths


def test_gecerli_xml_uretilir() -> None:
    xml = render_sitemap([_url_entry("/", changefreq="daily", priority="1.0")])
    root = ET.fromstring(xml)
    assert root.tag == f"{NS}urlset"
    urls = root.findall(f"{NS}url")
    assert len(urls) == 1
    assert urls[0].find(f"{NS}loc").text.endswith("/")


def test_lastmod_tarih_bicimi() -> None:
    """Sitemap protokolü W3C tarih formatı ister; datetime doğrudan yazılamaz."""
    entry = _url_entry(
        "/egitmenler/x-1",
        lastmod=datetime.datetime(2026, 7, 28, 15, 30, tzinfo=datetime.timezone.utc),
    )
    assert "<lastmod>2026-07-28</lastmod>" in entry


def test_ozel_karakterler_kacislanir() -> None:
    """Slug'da & geçerse XML bozulmamalı."""
    entry = _url_entry("/magaza/urun/a&b")
    assert "&amp;" in entry
    ET.fromstring(render_sitemap([entry]))  # ayrıştırılabilir olmalı


def test_bos_liste_gecerli_xml_verir() -> None:
    """Katalog boşken de crawler'a bozuk belge sunulmamalı."""
    root = ET.fromstring(render_sitemap([]))
    assert root.tag == f"{NS}urlset"
    assert root.findall(f"{NS}url") == []


def test_oncelikler_gecerli_araliktadir() -> None:
    for _path, _freq, priority in STATIC_PATHS:
        assert 0.0 <= float(priority) <= 1.0


def test_changefreq_protokol_degerleri() -> None:
    gecerli = {"always", "hourly", "daily", "weekly", "monthly", "yearly", "never"}
    for _path, freq, _prio in STATIC_PATHS:
        assert freq in gecerli
