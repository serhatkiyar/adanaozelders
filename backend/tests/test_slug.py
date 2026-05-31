"""SEO slug yardımcılarının saf testleri."""
from core.slug import slugify_tr, tutor_slug


def test_slugify_transliterates_turkish():
    assert slugify_tr("Şükrü Çağ Öğün") == "sukru-cag-ogun"
    assert slugify_tr("İlayda Işık") == "ilayda-isik"


def test_slugify_collapses_and_trims_separators():
    assert slugify_tr("  Ali   Veli!! ") == "ali-veli"
    assert slugify_tr("A & B / C") == "a-b-c"


def test_slugify_empty_and_symbol_only():
    assert slugify_tr("") == ""
    assert slugify_tr(None) == ""
    assert slugify_tr("!!!") == ""


def test_tutor_slug_appends_id():
    assert tutor_slug(42, "Ahmet Yılmaz") == "ahmet-yilmaz-42"


def test_tutor_slug_falls_back_to_id_when_name_blank():
    # İsim slug'a indirgenemezse salt id döner — resolver yine çözer.
    assert tutor_slug(7, "") == "7"
    assert tutor_slug(7, "!!!") == "7"


def test_tutor_slug_trailing_id_is_parseable():
    # Router sondaki id'yi ayrıştırdığı için slug daima id ile bitmeli.
    import re

    slug = tutor_slug(123, "Çiğdem Şahin")
    assert re.search(r"(\d+)$", slug).group(1) == "123"
