"""core/ratelimit._client_ip — X-Forwarded-For yalnız güvenilir proxy'den okunur.

Header körü körüne okunursa saldırgan her istekte farklı bir XFF göndererek
kendine yeni bir Redis kovası açar; login brute-force, kayıt spam'i, e-posta
maliyeti ve takip token'ı denemeleri dahil TÜM IP bazlı limitler etkisiz kalır.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from core import ratelimit


def _request(*, peer: str | None, xff: str | None = None):
    """_client_ip'nin dokunduğu yüzeyi taklit eden minimal sahte istek."""
    headers = {"x-forwarded-for": xff} if xff is not None else {}
    return SimpleNamespace(
        client=SimpleNamespace(host=peer) if peer else None,
        headers=headers,
    )


@pytest.fixture
def trusted(monkeypatch):
    def _set(values: list[str]) -> None:
        monkeypatch.setattr(ratelimit.settings, "TRUSTED_PROXY_IPS", values)

    return _set


def test_guvenilmeyen_peer_xff_yok_sayilir(trusted) -> None:
    trusted([])
    ip = ratelimit._client_ip(_request(peer="203.0.113.9", xff="1.2.3.4"))
    assert ip == "203.0.113.9"  # sahte header değil, gerçek bağlantı


def test_guvenilir_proxy_arkasinda_xff_okunur(trusted) -> None:
    trusted(["127.0.0.1"])
    ip = ratelimit._client_ip(_request(peer="127.0.0.1", xff="198.51.100.7"))
    assert ip == "198.51.100.7"


def test_zincirin_ilk_degeri_alinir(trusted) -> None:
    trusted(["127.0.0.1"])
    ip = ratelimit._client_ip(
        _request(peer="127.0.0.1", xff="198.51.100.7, 10.0.0.1, 127.0.0.1")
    )
    assert ip == "198.51.100.7"


def test_cidr_ile_guven(trusted) -> None:
    trusted(["172.16.0.0/12"])
    assert (
        ratelimit._client_ip(_request(peer="172.18.0.5", xff="198.51.100.7"))
        == "198.51.100.7"
    )
    # Aralık dışı peer güvenilmez → kendi IP'si kullanılır.
    assert (
        ratelimit._client_ip(_request(peer="192.0.2.5", xff="198.51.100.7"))
        == "192.0.2.5"
    )


def test_yildiz_tum_peerlara_guvenir(trusted) -> None:
    trusted(["*"])
    ip = ratelimit._client_ip(_request(peer="203.0.113.9", xff="198.51.100.7"))
    assert ip == "198.51.100.7"


def test_guvenilir_proxy_ama_header_yok(trusted) -> None:
    trusted(["127.0.0.1"])
    assert ratelimit._client_ip(_request(peer="127.0.0.1")) == "127.0.0.1"


def test_bos_xff_degeri_peere_duser(trusted) -> None:
    trusted(["127.0.0.1"])
    assert ratelimit._client_ip(_request(peer="127.0.0.1", xff="   ")) == "127.0.0.1"


def test_peer_yoksa_unknown(trusted) -> None:
    trusted(["*"])
    assert ratelimit._client_ip(_request(peer=None)) == "unknown"


def test_bozuk_cidr_girisi_cokertmez(trusted) -> None:
    trusted(["bu-bir-ip-degil", "127.0.0.1"])
    assert (
        ratelimit._client_ip(_request(peer="127.0.0.1", xff="198.51.100.7"))
        == "198.51.100.7"
    )
