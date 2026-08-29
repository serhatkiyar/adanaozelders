"""Yeni üye kaydı bayrağı (registration_open) — kapı testleri.

Kullanıcı kararı (30 Ağu 2026): site halka açıkken kayıt admin panelinden
kapatılabilmeli. Kapalıyken iki register ucu da 403 döner; public
`/auth/register/open` ucu frontend'in düğmeleri gizlemesi için durumu söyler.
Girişler ve eğitmen ön başvurusu bu bayraktan ETKİLENMEZ.

Kapı `auth_service`'ten ÖNCE çalıştığı için DB'ye yazma doğmaz; bayrak da
monkeypatch'lidir — test gerçek HTTP katmanını (router sırası dahil) ölçer.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _temiz_onbellek():
    from core import flags

    flags.reset_cache()
    yield
    flags.reset_cache()


@pytest.fixture
def bayrak(monkeypatch):
    from core import flags

    state: dict[str, bool] = {}

    def _varsayilan(key: str) -> bool:
        return next(s.default for s in flags.FLAG_SPECS if s.key == key)

    async def _fake(db, key):  # noqa: ANN001
        return state.get(key, _varsayilan(key))

    monkeypatch.setattr(flags, "is_enabled", _fake)
    return state


@pytest.fixture(scope="module")
def client():
    from main import app

    with TestClient(app) as c:
        yield c


def _kayit_govdesi() -> dict:
    return {
        "email": "kapi-testi@example.com",
        "password": "Sifre123!",
        "first_name": "Kapı",
        "last_name": "Testi",
        "username": "kapitesti",
        "consent_version": "2026-08-30",
    }


def test_bayrak_kapaliyken_iki_uc_da_403(client, bayrak):
    from core import flags

    bayrak[flags.FLAG_REGISTRATION_OPEN] = False
    for uc in ("/api/v1/auth/register/client", "/api/v1/auth/register/tutor"):
        r = client.post(uc, json=_kayit_govdesi())
        assert r.status_code == 403, (uc, r.status_code, r.text)
        assert "kapalı" in r.json()["detail"]


def test_public_uc_durumu_soyler(client, bayrak):
    from core import flags

    bayrak[flags.FLAG_REGISTRATION_OPEN] = False
    r = client.get("/api/v1/auth/register/open")
    assert r.status_code == 200 and r.json() == {"open": False}

    bayrak[flags.FLAG_REGISTRATION_OPEN] = True
    r = client.get("/api/v1/auth/register/open")
    assert r.json() == {"open": True}


def test_katalog_varsayilani_aciktir():
    # Satırı olmayan DB'de davranış katalog varsayılanıdır — yanlışlıkla
    # "herkese kapalı" doğmasın diye burada sabitlenir.
    from core import flags

    spec = next(s for s in flags.FLAG_SPECS if s.key == flags.FLAG_REGISTRATION_OPEN)
    assert spec.default is True and spec.enforced is True
