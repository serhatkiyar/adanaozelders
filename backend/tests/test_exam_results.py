from core.exam_results import parse_registration_id


def test_parse_leading_id_variants():
    assert parse_registration_id("123 - Ali Veli.pdf") == 123
    assert parse_registration_id("123_karne.pdf") == 123
    assert parse_registration_id("123.pdf") == 123
    assert parse_registration_id("  007-ahmet.pdf") == 7  # baştaki sıfırlar


def test_parse_strips_path():
    assert parse_registration_id("C:\\karneler\\45 ahmet.pdf") == 45
    assert parse_registration_id("klasor/88-zeynep.pdf") == 88


def test_parse_no_leading_number():
    assert parse_registration_id("ahmet-karne.pdf") is None
    assert parse_registration_id("") is None
    assert parse_registration_id(None) is None
