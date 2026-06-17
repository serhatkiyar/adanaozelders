from core import crypto


def test_roundtrip():
    token = crypto.encrypt("10000000146")
    assert token != "10000000146"  # şifreli
    assert crypto.decrypt(token) == "10000000146"


def test_none_and_empty():
    assert crypto.encrypt(None) is None
    assert crypto.encrypt("") is None
    assert crypto.decrypt(None) is None
    assert crypto.decrypt("") is None


def test_decrypt_invalid_returns_none():
    # Çözülemeyen değer (anahtar uyuşmazlığı/bozuk) FAIL-SAFE None döner — çöp düz
    # metin gibi DÖNMEZ (yanlış TCKN doğrulanmasını önler).
    assert crypto.decrypt("plain-not-a-token") is None


def test_two_encryptions_differ_but_decrypt_same():
    a = crypto.encrypt("12345678901")
    b = crypto.encrypt("12345678901")
    # Fernet IV/timestamp içerir → token'lar farklı ama çözümleri aynı.
    assert a != b
    assert crypto.decrypt(a) == crypto.decrypt(b) == "12345678901"
