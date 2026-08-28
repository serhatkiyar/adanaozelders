"""Puck verisi ↔ vitrin blok satırları köprüsü (CMS Faz 2).

TASARIM: `puck_data` kanonik kaynak, blok satırları TÜRETİLMİŞ yan üründür.
`save_page_draft` puck_data alınca buradaki dönüştürücüyle
`LandingPageBlockWrite` listesi üretir ve MEVCUT `_validate_block` /
`_sync_draft_blocks` hattından geçirir — görsel URL beyaz listesi, HERO 1-8,
RECENTLY_VIEWED tekliği gibi kurallar iki format için tek yerde yaşar.
Böylece `publish_page`, metrik kaydı, `storefront_health` ve public render
Puck'tan HABERSİZ kalır.

`props.block_key` sözleşmesi: her Puck öğesi block_key'ini açık prop olarak
taşır (Puck'ın kendi `id` biçimine bağlanılmaz). Boşsa sunucu üretir ve
normalize edilmiş veri editöre GERİ döner — metrik tarihçesi bu anahtarla
kesintisiz sürer.
"""
from __future__ import annotations

import json
import uuid

from fastapi import HTTPException, status

from schemas.store_merchandising import LandingPageBlockWrite

#: Puck bileşen adı → DB blok tipi. Tek doğruluk kaynağı; frontend config'i
#: bu adlarla yazar (frontend/src/pages/admin/store/puck/puckConfig.tsx).
PUCK_TO_BLOCK_TYPE: dict[str, str] = {
    "HeroCarousel": "HERO_CAROUSEL",
    "ImageCardGrid": "IMAGE_CARD_GRID",
    "CategoryGrid": "CATEGORY_GRID",
    "ProductRail": "PRODUCT_RAIL",
    "Banner": "BANNER",
    "RichText": "RICH_TEXT",
    "RecentlyViewed": "RECENTLY_VIEWED",
    "CardRow": "CARD_ROW",
}

_MAX_PUCK_BYTES = 400_000

#: Küratörlü görünüm preset'leri — frontend `gorunumSiniflari.ts` ile sözleşme.
#: Serbest renk/px bilinçli YOK: preset dışı her değer 422 (marka tutarlılığı
#: ve ölçülmüş kontrast garantileri korunur).
GORUNUM_SECENEKLERI: dict[str, set[str]] = {
    "hiza": {"sol", "orta"},
    "zemin": {"beyaz", "yumusak", "vurgu"},
    "bosluk": {"dar", "normal", "genis"},
    "kolon": {"2", "3", "4"},       # yalnız IMAGE_CARD_GRID
    "boy": {"ince", "normal"},      # yalnız BANNER
}


def validate_gorunum(raw: object, *, block_type: str) -> dict:
    """`gorunum` nesnesini preset allowlist'ine indirger (saf; pytest'li)."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise _err("Görünüm ayarları geçersiz.")
    out: dict = {}
    for anahtar, deger in raw.items():
        secenekler = GORUNUM_SECENEKLERI.get(str(anahtar))
        if secenekler is None:
            raise _err(f"Bilinmeyen görünüm ayarı: {anahtar!r}")
        if anahtar == "kolon" and block_type != "IMAGE_CARD_GRID":
            raise _err("Kolon ayarı yalnız resimli kartlarda kullanılabilir.")
        if anahtar == "boy" and block_type != "BANNER":
            raise _err("Boy ayarı yalnız banner bloğunda kullanılabilir.")
        if str(deger) not in secenekler:
            raise _err(f"Görünüm ayarı {anahtar!r} için geçersiz değer: {deger!r}")
        out[str(anahtar)] = str(deger)
    return out


def _err(mesaj: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, mesaj)


def _media_item(raw: object, *, allow_label: bool = False) -> dict:
    """Puck medya öğesini blok config MediaItem şekline indirger."""
    if not isinstance(raw, dict):
        raise _err("Görsel öğesi geçersiz.")
    item: dict = {
        "image_url": str(raw.get("image_url") or ""),
        "alt_text": str(raw.get("alt_text") or ""),
        "decorative": bool(raw.get("decorative")),
    }
    if raw.get("mobile_image_url"):
        item["mobile_image_url"] = str(raw["mobile_image_url"])
    if raw.get("link_url"):
        item["link_url"] = str(raw["link_url"])
    if raw.get("fit") in ("cover", "contain"):
        item["fit"] = raw["fit"]
    for eksen in ("focal_x", "focal_y"):
        deger = raw.get(eksen)
        if isinstance(deger, (int, float)):
            item[eksen] = max(0, min(100, int(deger)))
    if allow_label and raw.get("label"):
        item["label"] = str(raw["label"])
    return item


def _common(props: dict) -> dict:
    return {
        "title": str(props.get("title") or ""),
        "description": str(props.get("description") or ""),
        "link_label": str(props.get("link_label") or ""),
        "link_url": (str(props["link_url"]) if props.get("link_url") else None),
    }


def puck_item_to_block_write(item: dict, index: int) -> LandingPageBlockWrite:
    """Tek Puck öğesi → LandingPageBlockWrite (saf; pytest'li)."""
    tip = PUCK_TO_BLOCK_TYPE.get(str(item.get("type")))
    if tip is None:
        raise _err(f"Bilinmeyen blok tipi: {item.get('type')!r}")
    props = item.get("props")
    if not isinstance(props, dict):
        raise _err("Blok özellikleri eksik.")
    ortak = _common(props)
    config: dict = {}
    product_set_id: int | None = None

    if tip == "HERO_CAROUSEL":
        slides = props.get("slides")
        if not isinstance(slides, list):
            raise _err("Hero slaytları bir liste olmalı.")
        config["slides"] = [_media_item(s) for s in slides]
        autoplay = props.get("autoplay_ms")
        if isinstance(autoplay, (int, float)) and autoplay > 0:
            config["autoplay_ms"] = int(autoplay)
        # Amazon tarzı: hero alta doğru zemine karışır (gradient fade),
        # üzerine bindirmeli kart satırı gelir.
        if props.get("fade_bottom"):
            config["fade_bottom"] = True
    elif tip == "IMAGE_CARD_GRID":
        cards = props.get("cards")
        if not isinstance(cards, list):
            raise _err("Kartlar bir liste olmalı.")
        config["cards"] = [_media_item(c, allow_label=True) for c in cards]
        if props.get("overlay"):
            config["overlay"] = True
    elif tip == "CATEGORY_GRID":
        ids = props.get("category_ids")
        if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
            raise _err("Kategori bloğunda kategori kimlikleri liste olmalı.")
        config["category_ids"] = ids
    elif tip == "PRODUCT_RAIL":
        secim = props.get("product_set")
        if isinstance(secim, dict) and isinstance(secim.get("id"), int):
            product_set_id = secim["id"]
        elif isinstance(props.get("product_set_id"), int):
            product_set_id = props["product_set_id"]
        else:
            raise _err("Ürün vitrini için bir koleksiyon seçin.")
    elif tip == "BANNER":
        config = _media_item(props.get("image") or props, allow_label=False)
    elif tip == "CARD_ROW":
        cards = props.get("cards")
        if not isinstance(cards, list):
            raise _err("Kart satırı bir kart listesi taşımalı.")
        config["cards"] = [
            {
                "title": str((c or {}).get("title") or "") if isinstance(c, dict) else "",
                "link_label": str(c.get("link_label") or "") if isinstance(c, dict) else "",
                "link_url": (str(c["link_url"]) if isinstance(c, dict) and c.get("link_url") else None),
                "items": [
                    _media_item(i, allow_label=True)
                    for i in (c.get("items") if isinstance(c, dict) and isinstance(c.get("items"), list) else [])
                ],
            }
            for c in cards
        ]
        if props.get("overlay"):
            config["overlay"] = True
    elif tip == "RICH_TEXT":
        # Zengin metin: HTML burada DEĞİL, yazma boğazında sanitize edilir
        # (store_merchandising_service._sanitize_rich_text — legacy yol dahil).
        config["content_html"] = str(props.get("content_html") or "")
        # Eski düz alan fallback olarak korunur (eski public render yolu).
        if props.get("content"):
            config["content"] = str(props["content"])
    # RECENTLY_VIEWED: config boş.

    gorunum = validate_gorunum(props.get("gorunum"), block_type=tip)
    if gorunum:
        config["gorunum"] = gorunum

    return LandingPageBlockWrite(
        block_key=(str(props["block_key"]) if props.get("block_key") else None),
        block_type=tip,
        config=config,
        product_set_id=product_set_id,
        is_active=True,
        sort_order=index * 10,
        **ortak,
    )


def normalize_puck_data(data: dict) -> tuple[dict, list[LandingPageBlockWrite]]:
    """Puck verisini doğrular, block_key'leri tamamlar, blok yazımlarını üretir.

    Döndürdüğü normalize veri DB'ye yazılır ve editöre geri gönderilir —
    sunucunun ürettiği block_key'ler editörle senkron kalır.
    """
    if not isinstance(data, dict) or not isinstance(data.get("content"), list):
        raise _err("Sayfa verisi geçersiz (content listesi yok).")
    if len(json.dumps(data, ensure_ascii=False).encode()) > _MAX_PUCK_BYTES:
        raise _err("Sayfa verisi 400 KB sınırını aşamaz.")

    normalized = {
        "root": data.get("root") if isinstance(data.get("root"), dict) else {"props": {}},
        "content": [],
        "zones": data.get("zones") if isinstance(data.get("zones"), dict) else {},
    }
    writes: list[LandingPageBlockWrite] = []
    keys: set[str] = set()
    for index, item in enumerate(data["content"]):
        if not isinstance(item, dict):
            raise _err("Blok öğesi geçersiz.")
        props = item.get("props")
        if not isinstance(props, dict):
            raise _err("Blok özellikleri eksik.")
        key = str(props.get("block_key") or "") or str(uuid.uuid4())
        if key in keys:
            raise _err("Blok anahtarları tekrar edemez.")
        keys.add(key)
        item = {**item, "props": {**props, "block_key": key}}
        writes.append(puck_item_to_block_write(item, index))
        normalized["content"].append(item)
    return normalized, writes
