"""Eğitmen profil/slot uçlarında id sınırı ve video tamamlama rate-limit'i.

Postgres INTEGER'ı aşan id sorguya giderse asyncpg taşma hatası 500 olur;
bu uçlar böyle bir id'yi servise hiç iletmeden 404 döndürmeli. DB'ye
gidilmez: servis çağrıları sahteyle ölçülür.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from api.routers import tutors as tutors_router
from core.database import get_db

UCLAR = ["/api/v1/tutors/{id}", "/api/v1/tutors/{id}/slots"]


@pytest.fixture
def client(monkeypatch):
    from main import app

    async def _serbest(**kwargs):
        return None

    async def _sahte_db():
        yield None

    cagrilar: list[int] = []

    async def _bulunamadi(db, tutor_id):
        cagrilar.append(tutor_id)
        raise HTTPException(status_code=404, detail="Öğretmen bulunamadı.")

    monkeypatch.setattr("core.ratelimit.enforce", _serbest)
    monkeypatch.setattr(tutors_router.search_service, "get_tutor_public", _bulunamadi)
    monkeypatch.setattr(tutors_router.booking_service, "get_bookable_tutor", _bulunamadi)
    app.dependency_overrides[get_db] = _sahte_db
    try:
        with TestClient(app) as c:
            c.cagrilar = cagrilar
            yield c
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.parametrize("uc", UCLAR)
@pytest.mark.parametrize("tutor_id", ["2147483648", "x-2147483648", "99999999999", "0", "ali-0"])
def test_sinir_disi_id_servise_gitmeden_404(client, uc, tutor_id):
    r = client.get(uc.format(id=tutor_id))
    assert r.status_code == 404
    assert client.cagrilar == []


@pytest.mark.parametrize("uc", UCLAR)
@pytest.mark.parametrize("tutor_id", ["2147483647", "ahmet-yilmaz-2147483647"])
def test_ust_sinirdaki_id_servise_iletilir(client, uc, tutor_id):
    r = client.get(uc.format(id=tutor_id))
    assert r.status_code == 404
    assert client.cagrilar == [2_147_483_647]


def _bagimliliklar(yol: str, metod: str) -> list:
    for route in tutors_router.router.routes:
        if route.path == yol and metod in route.methods:
            return [d.call for d in route.dependant.dependencies]
    raise AssertionError(f"rota yok: {metod} {yol}")


def test_video_tamamlama_limiti_yalniz_complete_ucunda():
    yol = "/tutors/me/intro-video/uploads/{video_id}"
    assert tutors_router._video_complete_limit in _bagimliliklar(f"{yol}/complete", "POST")
    assert tutors_router._video_complete_limit not in _bagimliliklar(yol, "DELETE")


class _SahteRedis:
    def __init__(self):
        self.sayac: dict[str, int] = {}

    async def incr(self, key):
        self.sayac[key] = self.sayac.get(key, 0) + 1
        return self.sayac[key]

    async def expire(self, key, seconds):
        return True

    async def ttl(self, key):
        return 42


async def test_video_tamamlama_limiti_asilinca_429(monkeypatch):
    from types import SimpleNamespace

    from core import ratelimit

    redis = _SahteRedis()
    monkeypatch.setattr(ratelimit, "_redis", lambda: redis)
    kullanici = SimpleNamespace(role_id=2, id=7)
    limit = tutors_router._VIDEO_COMPLETE_LIMIT_PER_MIN

    for _ in range(limit):
        await tutors_router._video_complete_limit(user=kullanici)
    with pytest.raises(HTTPException) as exc:
        await tutors_router._video_complete_limit(user=kullanici)
    assert exc.value.status_code == 429
    assert list(redis.sayac) == ["rl:tutor_video_complete:u2:7"]
