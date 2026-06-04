"""LibraryDetailOut, LibrarySearchOut'tan türetilirken çift 'open_now' argümanı
oluşmamalı (servis katmanı base.model_dump(exclude={'open_now'}) kullanır)."""

from schemas.library import LibraryDetailOut, LibraryImageOut, LibrarySearchOut


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
    # Görseller varsayılan boş; detayda logo/galeri taşınır.
    assert detail.images == []


def test_detail_carries_logo_and_gallery():
    base = _base()
    base.logo_url = "http://x/logo.webp"
    detail = LibraryDetailOut(
        **base.model_dump(exclude={"open_now"}),
        status="ACTIVE",
        images=[
            LibraryImageOut(id=2, url="http://x/b.webp", sort_order=1),
            LibraryImageOut(id=1, url="http://x/a.webp", caption="Salon", sort_order=0),
        ],
        open_now=None,
    )
    assert detail.logo_url == "http://x/logo.webp"
    assert [im.id for im in detail.images] == [2, 1]
    assert detail.images[1].caption == "Salon"
