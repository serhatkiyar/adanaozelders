"""Sosyal paylaşım meta'sı (ekspertiz P0-31).

SPA'nın `index.html`'i her rota için aynı jenerik başlığı taşıyor; meta
etiketleri ancak tarayıcıda JS çalışınca yerleşiyor. WhatsApp/Twitter/Facebook
önizleme botları JS ÇALIŞTIRMAZ — paylaşılan eğitmen veya ürün bağlantısı
jenerik site başlığıyla görünüyordu. Pazaryerinde paylaşım birincil edinim
kanalıdır.
"""
from __future__ import annotations

import re

import pytest

from services.social_meta import (
    DEFAULT_DESCRIPTION,
    render_meta_html,
    truncate,
    tutor_id_from_slug,
)


def _meta(html: str, prop: str) -> str | None:
    m = re.search(rf'property="{re.escape(prop)}" content="(.*?)"', html)
    return m.group(1) if m else None


# ── Slug çözümleme ───────────────────────────────────────────────────────────


def test_egitmen_slugundan_id_cikarilir() -> None:
    """Kanonik slug id ile biter (core/slug.py::tutor_slug)."""
    assert tutor_id_from_slug("ayse-yilmaz-12") == 12
    assert tutor_id_from_slug("dilan-kiyar-4") == 4
    assert tutor_id_from_slug("7") == 7


def test_idsiz_slug_none_doner() -> None:
    assert tutor_id_from_slug("ayse-yilmaz") is None
    assert tutor_id_from_slug("") is None


def test_isimdeki_sayilar_id_sanilmaz() -> None:
    """Yalnız SONDAKİ sayı id'dir."""
    assert tutor_id_from_slug("3d-yayinlari-99") == 99


# ── Açıklama kırpma ──────────────────────────────────────────────────────────


def test_kisa_metin_oldugu_gibi_kalir() -> None:
    assert truncate("Kısa açıklama") == "Kısa açıklama"


def test_uzun_metin_kelime_ortasindan_kesilmez() -> None:
    text = "kelime " * 60
    out = truncate(text, limit=50)
    assert len(out) <= 51  # + ellipsis
    assert out.endswith("…")
    assert not out.rstrip("…").endswith("kel")


def test_bos_metin_varsayilana_duser() -> None:
    """Bot'a boş açıklama vermek önizlemeyi tamamen boşaltır."""
    assert truncate(None) == DEFAULT_DESCRIPTION
    assert truncate("") == DEFAULT_DESCRIPTION


def test_fazla_bosluk_temizlenir() -> None:
    assert truncate("iki\n\nsatır   arası") == "iki satır arası"


# ── HTML üretimi ─────────────────────────────────────────────────────────────


def test_og_etiketleri_doldurulur() -> None:
    html = render_meta_html(
        title="Ayşe Yılmaz — Özel Ders",
        description="Matematik eğitmeni",
        image="https://x.tr/a.png",
        url="https://x.tr/egitmenler/ayse-12",
        kind="profile",
    )
    assert _meta(html, "og:title") == "Ayşe Yılmaz — Özel Ders"
    assert _meta(html, "og:description") == "Matematik eğitmeni"
    assert _meta(html, "og:image") == "https://x.tr/a.png"
    assert _meta(html, "og:type") == "profile"
    assert 'name="twitter:card"' in html


def test_canonical_ve_govde_icerigi_var() -> None:
    """Bazı botlar yalnız meta okur, bazıları ilk paragrafı da kullanır."""
    html = render_meta_html(
        title="Başlık", description="Açıklama", image="/i.png", url="https://x.tr/y"
    )
    assert '<link rel="canonical" href="https://x.tr/y">' in html
    assert "<h1>Başlık</h1>" in html
    assert "<p>Açıklama</p>" in html


@pytest.mark.parametrize(
    "kotu",
    ['<script>alert(1)</script>', 'a" onload="x', "Ali'nin & Ayşe'nin"],
)
def test_kullanici_metni_kacislanir(kotu: str) -> None:
    """Ürün/eğitmen metinleri kullanıcı girdisidir; HTML'e ham girmemeli."""
    html = render_meta_html(
        title=kotu, description=kotu, image="/i.png", url="https://x.tr/y"
    )
    assert "<script>" not in html
    assert 'onload="x"' not in html
    # Kaçışlanmış hâli bulunmalı (içerik kaybolmuş olmasın).
    assert "&lt;script&gt;" in html or "&amp;" in html or "&quot;" in html


def test_dogru_dil_etiketi() -> None:
    html = render_meta_html(
        title="x", description="y", image="/i.png", url="https://x.tr/"
    )
    assert '<html lang="tr">' in html
