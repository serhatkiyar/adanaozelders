import pytest
from pydantic import ValidationError

from schemas.store_home_section import (
    StoreHomeImageTileEdit,
    StoreHomeImageTileMeta,
    StoreHomeProductSectionWrite,
    StoreHomeRecentlyViewedUpdate,
    StoreHomeSectionReorder,
)


def _product_payload(product_ids: list[int]):
    return {
        "title": "Romanlar",
        "description": "Editörün seçtikleri",
        "link_url": "/magaza?category=3",
        "link_label": "Tümünü gör",
        "is_active": True,
        "sort_order": 0,
        "product_ids": product_ids,
    }


def test_product_section_accepts_one_to_twelve_unique_products():
    one = StoreHomeProductSectionWrite.model_validate(_product_payload([1]))
    twelve = StoreHomeProductSectionWrite.model_validate(_product_payload(list(range(1, 13))))
    assert one.product_ids == [1]
    assert len(twelve.product_ids) == 12


@pytest.mark.parametrize("product_ids", [[], list(range(1, 14)), [1, 1], [0]])
def test_product_section_rejects_invalid_product_selection(product_ids: list[int]):
    with pytest.raises(ValidationError):
        StoreHomeProductSectionWrite.model_validate(_product_payload(product_ids))


def test_image_tile_accepts_internal_and_https_links():
    internal = StoreHomeImageTileMeta(label="Roman", alt_text="Roman kapakları", link_url="/magaza")
    external = StoreHomeImageTileMeta(label="Yayınevi", alt_text="Yayınevi", link_url="https://example.com")
    assert internal.link_url == "/magaza"
    assert external.link_url == "https://example.com"


@pytest.mark.parametrize("link", ["javascript:alert(1)", "//example.com", "magaza"])
def test_image_tile_rejects_unsafe_or_relative_links(link: str):
    with pytest.raises(ValidationError):
        StoreHomeImageTileMeta(label="", alt_text="Açıklama", link_url=link)


def test_image_edit_requires_exactly_one_source():
    base = {"label": "", "alt_text": "Açıklama", "link_url": "/magaza"}
    StoreHomeImageTileEdit(**base, existing_index=0)
    StoreHomeImageTileEdit(**base, file_index=0)
    with pytest.raises(ValidationError):
        StoreHomeImageTileEdit(**base)
    with pytest.raises(ValidationError):
        StoreHomeImageTileEdit(**base, existing_index=0, file_index=0)


def test_reorder_rejects_duplicates():
    with pytest.raises(ValidationError):
        StoreHomeSectionReorder(ordered_ids=[1, 1])


def test_recently_viewed_update_only_accepts_boolean_visibility():
    assert StoreHomeRecentlyViewedUpdate(is_active=False).is_active is False
    with pytest.raises(ValidationError):
        StoreHomeRecentlyViewedUpdate.model_validate({})
