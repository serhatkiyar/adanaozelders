import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from core import storage
from core.config import settings
from schemas.store import ProductCreate
from schemas.store_merchandising import (
    LandingPageBlockWrite,
    PriceRule,
    ProductSetRevisionWrite,
    StorePageEventIn,
)
from services.store_merchandising_service import (
    _plan_publication_window,
    _sign_attribution,
    _validate_image_url,
    decode_attribution_token,
)


UTC = datetime.timezone.utc


def test_product_set_rejects_conflicting_manual_overrides():
    with pytest.raises(ValidationError):
        ProductSetRevisionWrite(pinned_product_ids=[7], excluded_product_ids=[7])


def test_price_rule_requires_a_valid_range():
    with pytest.raises(ValidationError):
        PriceRule(field="PRICE")
    with pytest.raises(ValidationError):
        PriceRule(field="PRICE", minimum=100, maximum=50)


def test_product_rail_requires_a_product_set_reference():
    with pytest.raises(ValidationError):
        LandingPageBlockWrite(block_type="PRODUCT_RAIL")

    stable = LandingPageBlockWrite(block_type="PRODUCT_RAIL", product_set_id=7)
    legacy = LandingPageBlockWrite(
        block_type="PRODUCT_RAIL", product_set_revision_id=17
    )
    assert stable.product_set_id == 7
    assert legacy.product_set_revision_id == 17


@pytest.mark.parametrize("unsafe_url", ["javascript:alert(1)", "//evil.example/path", "magaza"])
def test_landing_block_rejects_unsafe_top_level_and_nested_links(unsafe_url: str):
    with pytest.raises(ValidationError):
        LandingPageBlockWrite(
            block_type="BANNER",
            link_url=unsafe_url,
            config={"image_url": "/media/banner.webp"},
        )
    with pytest.raises(ValidationError):
        LandingPageBlockWrite(
            block_type="HERO_CAROUSEL",
            config={"slides": [{"image_url": "/media/hero.webp", "link_url": unsafe_url}]},
        )


def test_active_product_requires_category():
    with pytest.raises(ValidationError):
        ProductCreate(
            title="TYT Matematik",
            kind="PHYSICAL",
            price="199.90",
            tax_rate="0.10",
            stock=2,
            status="ACTIVE",
        )


def test_page_event_requires_a_consistent_target():
    with pytest.raises(ValidationError):
        StorePageEventIn(event_type="PRODUCT_CLICK", block_key="romanlar")
    with pytest.raises(ValidationError):
        StorePageEventIn(event_type="BLOCK_CLICK", block_key="romanlar", product_id=41)
    with pytest.raises(ValidationError):
        StorePageEventIn(event_type="PAGE_VIEW", block_key="romanlar")

    assert StorePageEventIn(
        event_type="PRODUCT_CLICK", block_key="romanlar", product_id=41
    ).product_id == 41


def test_attribution_token_is_signed_and_tamper_evident():
    token = _sign_attribution(12, "romanlar", 41)
    assert decode_attribution_token(token) == {
        "rev": 12,
        "block": "romanlar",
        "product": 41,
        "exp": decode_attribution_token(token)["exp"],
    }
    body, signature = token.rsplit(".", 1)
    tampered = f"{body[:-1]}A.{signature}"
    assert decode_attribution_token(tampered) is None


def test_landing_image_must_use_the_configured_public_storage_origin():
    _validate_image_url(storage.object_url("store-hero/banner.webp"))
    _validate_image_url(storage.object_url("avatars/store-hero/legacy.webp"))

    disguised = (
        f"https://attacker.example/{settings.AWS_BUCKET_NAME}/"
        "store-hero/tracker.webp"
    )
    with pytest.raises(HTTPException):
        _validate_image_url(disguised)


def test_new_publication_replaces_the_current_open_ended_revision():
    current = SimpleNamespace(
        starts_at=datetime.datetime(2026, 8, 23, 16, tzinfo=UTC),
        ends_at=None,
    )
    new_start = datetime.datetime(2026, 8, 23, 19, tzinfo=UTC)

    effective_end, to_close = _plan_publication_window(
        [current], new_start, None
    )

    assert effective_end is None
    assert to_close == [current]


def test_open_ended_revision_stops_at_the_next_scheduled_publication():
    next_publication = SimpleNamespace(
        starts_at=datetime.datetime(2026, 8, 25, 9, tzinfo=UTC),
        ends_at=None,
    )
    effective_end, to_close = _plan_publication_window(
        [next_publication],
        datetime.datetime(2026, 8, 24, 9, tzinfo=UTC),
        None,
    )

    assert effective_end == next_publication.starts_at
    assert to_close == []


def test_explicit_publication_window_explains_the_conflicting_schedule():
    next_publication = SimpleNamespace(
        starts_at=datetime.datetime(2026, 8, 25, 9, tzinfo=UTC),
        ends_at=None,
    )
    with pytest.raises(HTTPException, match="25.08.2026 12:00"):
        _plan_publication_window(
            [next_publication],
            datetime.datetime(2026, 8, 24, 9, tzinfo=UTC),
            datetime.datetime(2026, 8, 26, 9, tzinfo=UTC),
        )
