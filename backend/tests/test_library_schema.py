"""LibraryDetailOut, LibrarySearchOut'tan türetilirken çift 'open_now' argümanı
oluşmamalı (servis katmanı base.model_dump(exclude={'open_now'}) kullanır)."""

from schemas.library import LibraryDetailOut, LibrarySearchOut


def _base() -> LibrarySearchOut:
    return LibrarySearchOut(
        id=1, name="Test", slug="test", amenities=[], rating_count=0, open_now=None
    )


def test_detail_from_search_no_duplicate_open_now():
    base = _base()
    detail = LibraryDetailOut(
        **base.model_dump(exclude={"open_now"}),
        phone=None,
        email=None,
        website=None,
        status="ACTIVE",
        created_at=None,
        hours=[],
        open_now=True,
    )
    assert detail.open_now is True
    assert detail.name == "Test"
    assert detail.status == "ACTIVE"
