"""iyzico adaptörünün saf (ağsız) parçaları: imza, fiyat formatı, referans çözümü."""
import base64
import hashlib
import hmac
from decimal import Decimal

from core.payments.iyzico import build_auth_headers, format_price, parse_reference


def test_format_price_two_decimals():
    assert format_price(Decimal("500")) == "500.00"
    assert format_price(Decimal("99.9")) == "99.90"
    assert format_price("149.5") == "149.50"
    assert format_price(0) == "0.00"


def test_parse_reference_known_kinds():
    assert parse_reference("booking:12") == ("booking", 12)
    assert parse_reference("examreg:5") == ("examreg", 5)
    assert parse_reference("studyres:7") == ("studyres", 7)


def test_parse_reference_rejects_garbage():
    assert parse_reference(None) is None
    assert parse_reference("") is None
    assert parse_reference("booking") is None
    assert parse_reference("booking:abc") is None
    assert parse_reference("bilinmeyen:3") is None
    assert parse_reference(":12") is None


def test_build_auth_headers_iyzwsv2():
    headers = build_auth_headers(
        api_key="api-k",
        secret_key="secret-s",
        uri_path="/payment/x",
        body='{"a": 1}',
        random_key="RND123",
    )
    assert headers["x-iyzi-rnd"] == "RND123"
    assert headers["Content-Type"] == "application/json"
    assert headers["Authorization"].startswith("IYZWSv2 ")

    decoded = base64.b64decode(headers["Authorization"].removeprefix("IYZWSv2 ")).decode()
    expected_sig = hmac.new(
        b"secret-s", b'RND123/payment/x{"a": 1}', hashlib.sha256
    ).hexdigest()
    assert decoded == f"apiKey:api-k&randomKey:RND123&signature:{expected_sig}"


def test_build_auth_headers_random_key_generated():
    h1 = build_auth_headers(api_key="k", secret_key="s", uri_path="/p", body="{}")
    h2 = build_auth_headers(api_key="k", secret_key="s", uri_path="/p", body="{}")
    # random_key verilmezse her çağrıda taze üretilir (replay'e karşı).
    assert h1["x-iyzi-rnd"] != h2["x-iyzi-rnd"]
