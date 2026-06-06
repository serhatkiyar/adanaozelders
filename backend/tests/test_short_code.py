"""Kısa doğrulama kodu üretimi + normalize (QR okutulamazsa elle giriş)."""

from core.codes import gen_short_code, normalize_code


def test_gen_short_code_length_and_alphabet():
    code = gen_short_code()
    assert len(code) == 6
    # Karışan karakterler (0,O,1,I,L) üretilmemeli.
    assert not (set(code) & set("01OIL"))
    assert gen_short_code(8) != gen_short_code(8)  # rastgele


def test_normalize_code_strips_and_uppercases():
    assert normalize_code(" 7uz-nwa ") == "7UZNWA"
    assert normalize_code("8f3 k9q") == "8F3K9Q"
    assert normalize_code("") == ""


def test_normalize_code_on_qr_payload_does_not_match_short_code():
    # QR içeriği ("{id}:{token}") normalize edilince uzun/karışık olur → kısa kodla
    # yanlışlıkla eşleşmez (qr_token yolu eşleşir).
    out = normalize_code("12:Abc_def-XYZ123")
    assert len(out) > 6
    assert out == "12ABCDEFXYZ123"
