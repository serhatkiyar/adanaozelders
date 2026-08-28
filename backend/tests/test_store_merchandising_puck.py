"""Puck → blok dönüştürücüsünün saf testleri (CMS Faz 2).

Sözleşme: puck_data kanonik, blok satırları bu modülden türetilir; blok
doğrulamaları (`_validate_block`) türetilmiş yazımlar üzerinde çalışır.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from services.store_merchandising_puck import (
    PUCK_TO_BLOCK_TYPE,
    normalize_puck_data,
    puck_item_to_block_write,
)


def oge(tip: str, **props) -> dict:
    return {"type": tip, "props": props}


def veri(*content) -> dict:
    return {"root": {"props": {}}, "content": list(content), "zones": {}}


def test_tum_blok_tipleri_eslenmis() -> None:
    """Eşleme tablosu DB'nin blok tiplerinin tamamını kapsar — eksik tip
    sessizce 'bilinmeyen'e düşerdi."""
    assert sorted(PUCK_TO_BLOCK_TYPE.values()) == sorted([
        "HERO_CAROUSEL", "IMAGE_CARD_GRID", "CATEGORY_GRID", "PRODUCT_RAIL",
        "BANNER", "RICH_TEXT", "RECENTLY_VIEWED", "CARD_ROW",
    ])


def test_hero_kayipsiz_tasinir() -> None:
    w = puck_item_to_block_write(oge(
        "HeroCarousel",
        block_key="k1",
        slides=[{
            "image_url": "https://cdn/x.webp", "mobile_image_url": "https://cdn/m.webp",
            "alt_text": "a", "link_url": "/magaza", "fit": "contain",
            "focal_x": 30, "focal_y": 120,
        }],
        autoplay_ms=4000,
    ), 2)
    assert w.block_type == "HERO_CAROUSEL"
    assert w.block_key == "k1" and w.sort_order == 20
    slayt = w.config["slides"][0]
    assert slayt["mobile_image_url"] == "https://cdn/m.webp"
    assert slayt["fit"] == "contain"
    assert slayt["focal_x"] == 30
    assert slayt["focal_y"] == 100  # 0-100 aralığına kıstırılır
    assert w.config["autoplay_ms"] == 4000


def test_kart_izgarasinda_label_ve_overlay() -> None:
    w = puck_item_to_block_write(oge(
        "ImageCardGrid", title="Kartlar",
        cards=[{"image_url": "https://cdn/k.webp", "alt_text": "k", "label": "Etiket"}],
        overlay=True,
    ), 0)
    assert w.config["cards"][0]["label"] == "Etiket"
    assert w.config["overlay"] is True


def test_urun_rayi_koleksiyon_kimligi() -> None:
    w = puck_item_to_block_write(oge("ProductRail", title="Öne çıkan", product_set={"id": 7, "title": "x"}), 0)
    assert w.block_type == "PRODUCT_RAIL" and w.product_set_id == 7

    with pytest.raises(HTTPException) as e:
        puck_item_to_block_write(oge("ProductRail", title="Boş"), 0)
    assert "koleksiyon" in e.value.detail


def test_banner_config_media_item_seklidir() -> None:
    """Public renderer banner config'ini MediaItem olarak okur (StoreLandingBlocks)."""
    w = puck_item_to_block_write(oge(
        "Banner", title="B",
        image={"image_url": "https://cdn/b.webp", "alt_text": "b", "fit": "cover", "link_url": "/blog"},
    ), 0)
    assert w.config["image_url"] == "https://cdn/b.webp"
    assert w.config["link_url"] == "/blog"


def test_kategori_izgarasi_ve_metin() -> None:
    w = puck_item_to_block_write(oge("CategoryGrid", title="K", category_ids=[1, 2]), 0)
    assert w.config["category_ids"] == [1, 2]
    w = puck_item_to_block_write(oge("RichText", title="", content="merhaba"), 0)
    assert w.config["content"] == "merhaba"


def test_bilinmeyen_tip_422() -> None:
    with pytest.raises(HTTPException) as e:
        puck_item_to_block_write(oge("Bilinmeyen"), 0)
    assert "Bilinmeyen blok tipi" in e.value.detail


def test_normalize_block_key_uretir_ve_geri_dondurur() -> None:
    data = veri(oge("RichText", content="a"))
    normalized, writes = normalize_puck_data(data)
    key = normalized["content"][0]["props"]["block_key"]
    assert key and writes[0].block_key == key


def test_normalize_tekrar_eden_key_422() -> None:
    data = veri(oge("RichText", block_key="ayni", content="a"),
                oge("RichText", block_key="ayni", content="b"))
    with pytest.raises(HTTPException) as e:
        normalize_puck_data(data)
    assert "tekrar edemez" in e.value.detail


def test_normalize_dev_veri_422() -> None:
    data = veri(oge("RichText", block_key="k", content="x" * 500_000))
    with pytest.raises(HTTPException) as e:
        normalize_puck_data(data)
    assert "400 KB" in e.value.detail


def test_normalize_content_listesi_sart() -> None:
    with pytest.raises(HTTPException):
        normalize_puck_data({"root": {}})


def test_zengin_metin_content_html_tasinir() -> None:
    w = puck_item_to_block_write(
        oge("RichText", title="", content_html="<p>merhaba</p>"), 0
    )
    assert w.config["content_html"] == "<p>merhaba</p>"


def test_gorunum_preset_dogrulanir() -> None:
    w = puck_item_to_block_write(
        oge("RichText", content_html="<p>a</p>", gorunum={"zemin": "yumusak", "bosluk": "genis"}), 0
    )
    assert w.config["gorunum"] == {"zemin": "yumusak", "bosluk": "genis"}

    with pytest.raises(HTTPException) as e:
        puck_item_to_block_write(oge("RichText", gorunum={"zemin": "kirmizi"}), 0)
    assert "geçersiz değer" in e.value.detail

    with pytest.raises(HTTPException) as e:
        puck_item_to_block_write(oge("RichText", gorunum={"padding": "10px"}), 0)
    assert "Bilinmeyen görünüm ayarı" in e.value.detail

    # kolon yalnız resimli kartlarda, boy yalnız banner'da.
    with pytest.raises(HTTPException):
        puck_item_to_block_write(oge("RichText", gorunum={"kolon": "3"}), 0)
    w = puck_item_to_block_write(
        oge("ImageCardGrid", cards=[{"image_url": "https://cdn/x.webp", "alt_text": "x"}],
            gorunum={"kolon": "3"}), 0
    )
    assert w.config["gorunum"] == {"kolon": "3"}


def test_kart_satiri_ve_hero_fade_eslenir() -> None:
    """Amazon deseni: hero fade_bottom taşır, kart satırı kart+görsel yapısını korur."""
    w = puck_item_to_block_write(oge(
        "HeroCarousel",
        slides=[{"image_url": "https://cdn/h.webp", "alt_text": "h"}],
        fade_bottom=True,
    ), 0)
    assert w.config["fade_bottom"] is True

    w = puck_item_to_block_write(oge(
        "CardRow",
        cards=[{
            "title": "Okula dönüş",
            "link_label": "Alışverişe başla",
            "link_url": "/magaza",
            "items": [
                {"image_url": "https://cdn/1.webp", "alt_text": "a", "label": "Çantalar"},
                {"image_url": "https://cdn/2.webp", "alt_text": "b", "label": "Defterler"},
                {"image_url": "https://cdn/3.webp", "alt_text": "c", "label": "Kalemler"},
                {"image_url": "https://cdn/4.webp", "alt_text": "d", "label": "Elektronik"},
            ],
        }],
        overlay=True,
    ), 1)
    assert w.block_type == "CARD_ROW"
    assert w.config["overlay"] is True
    kart = w.config["cards"][0]
    assert kart["title"] == "Okula dönüş" and kart["link_url"] == "/magaza"
    assert [i["label"] for i in kart["items"]] == ["Çantalar", "Defterler", "Kalemler", "Elektronik"]
