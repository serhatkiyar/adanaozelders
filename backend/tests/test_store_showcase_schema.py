import pytest
from pydantic import ValidationError

from schemas.store_showcase_card import (
    StoreShowcaseCardCreate,
    StoreShowcaseCardUpdate,
    StoreShowcaseCustomTileEdit,
    StoreShowcaseCustomTileMeta,
)


def test_card_accepts_one_to_four_unique_products():
    card = StoreShowcaseCardCreate(
        title="Sınava hazırlan",
        link_url="/magaza?q=TYT",
        product_ids=[4, 2, 7, 9],
        is_active=True,
    )
    assert card.product_ids == [4, 2, 7, 9]


@pytest.mark.parametrize("product_ids", [[], [1, 2, 3, 4, 5], [1, 1]])
def test_card_rejects_invalid_product_selection(product_ids):
    with pytest.raises(ValidationError):
        StoreShowcaseCardCreate(title="Kart", link_url="/magaza", product_ids=product_ids)


@pytest.mark.parametrize("link", ["javascript:alert(1)", "//evil.example/path", "magaza"])
def test_card_rejects_unsafe_link(link):
    with pytest.raises(ValidationError):
        StoreShowcaseCardCreate(title="Kart", link_url=link, product_ids=[1])


def test_partial_update_keeps_product_ids_unset():
    payload = StoreShowcaseCardUpdate(title="Yeni başlık")
    assert "product_ids" not in payload.model_dump(exclude_unset=True)


def test_custom_tile_accepts_own_link_and_optional_label():
    tile = StoreShowcaseCustomTileMeta(
        label="TYT seçkisi",
        alt_text="TYT kitapları",
        link_url="/magaza?q=TYT",
    )
    assert tile.link_url == "/magaza?q=TYT"


@pytest.mark.parametrize(
    "sources",
    [{}, {"existing_index": 0, "file_index": 0}],
)
def test_custom_tile_edit_requires_exactly_one_image_source(sources):
    with pytest.raises(ValidationError):
        StoreShowcaseCustomTileEdit(
            alt_text="Kitap seçkisi",
            link_url="/magaza",
            **sources,
        )


def test_custom_tile_rejects_unsafe_redirect():
    with pytest.raises(ValidationError):
        StoreShowcaseCustomTileMeta(
            alt_text="Kitap seçkisi",
            link_url="javascript:alert(1)",
        )


def test_custom_tile_requires_accessible_description():
    with pytest.raises(ValidationError):
        StoreShowcaseCustomTileMeta(alt_text="", link_url="/magaza")
