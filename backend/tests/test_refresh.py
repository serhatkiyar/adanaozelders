"""Refresh token: saf yardımcılar + şema + rol haritası (DB'siz).

issue/rotate/revoke DB gerektirir (entegrasyon); burada hash, şema ve refresh
sırasında kullanılan role_id->rol adı eşlemesi test edilir.
"""
import pytest
from pydantic import ValidationError

from models.role import ROLE_IDS, RoleType, role_name
from schemas.auth import RefreshRequest, Token
from services import refresh_token_service as rts


def test_hash_deterministic_sha256():
    h = rts._hash("refresh-abc")
    assert h == rts._hash("refresh-abc")
    assert len(h) == 64
    assert h != rts._hash("refresh-abd")


def test_token_schema_optional_refresh():
    assert Token(access_token="a").refresh_token is None
    assert Token(access_token="a", refresh_token="r").refresh_token == "r"


def test_refresh_request_requires_nonempty_token():
    assert RefreshRequest(refresh_token="x").refresh_token == "x"
    with pytest.raises(ValidationError):
        RefreshRequest(refresh_token="")


def test_role_name_reverse_mapping():
    # /auth/refresh, rotate'tan dönen role_id'yi access token rolüne çevirir.
    assert role_name(ROLE_IDS[RoleType.ADMIN]) == "ADMIN"
    assert role_name(ROLE_IDS[RoleType.TUTOR]) == "TUTOR"
    assert role_name(ROLE_IDS[RoleType.CLIENT]) == "CLIENT"
