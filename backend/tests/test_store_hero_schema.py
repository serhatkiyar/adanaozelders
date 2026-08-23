import datetime

import pytest
from pydantic import ValidationError

from schemas.store_hero_slide import (
    StoreHeroSlideCreate,
    StoreHeroSlideReorder,
    StoreHeroSlideUpdate,
)


def test_link_accepts_internal_path_and_https() -> None:
    assert StoreHeroSlideCreate(link_url="/magaza?q=TYT").link_url == "/magaza?q=TYT"
    assert StoreHeroSlideCreate(link_url="https://example.com").link_url == "https://example.com"


@pytest.mark.parametrize("url", ["javascript:alert(1)", "//evil.example/path", "ftp://example.com"])
def test_link_rejects_unsafe_or_ambiguous_url(url: str) -> None:
    with pytest.raises(ValidationError):
        StoreHeroSlideCreate(link_url=url)


def test_create_rejects_invalid_date_window() -> None:
    start = datetime.datetime(2026, 8, 24, tzinfo=datetime.timezone.utc)
    with pytest.raises(ValidationError):
        StoreHeroSlideCreate(starts_at=start, ends_at=start)


def test_update_rejects_null_for_not_null_columns() -> None:
    for field in ("alt_text", "is_active", "sort_order"):
        with pytest.raises(ValidationError):
            StoreHeroSlideUpdate.model_validate({field: None})


def test_reorder_rejects_duplicate_ids() -> None:
    with pytest.raises(ValidationError):
        StoreHeroSlideReorder(ordered_ids=[1, 1])
