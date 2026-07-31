"""Liveness ile readiness'in AYRI olduğu — ve public sağlık ucunun üretimde
iç ayrıntı sızdırmadığı.

Neden ayrı olmalı: `/health` bilinçli olarak ağır bir teşhis ucudur (DB + Redis +
MinIO + rota yoklaması). Bir süreç denetleyicisi ya da konteyner liveness probe'u
onu "yeniden başlat" kararına bağlarsa, bağımlılıklardan biri yavaşladığında
SAĞLIKLI uygulama öldürülür — ve yeniden başlayan uygulama aynı yavaş bağımlılığı
bulup yine ölür (kırbaç etkisi).
"""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client():
    from main import app

    with TestClient(app) as c:
        yield c


def test_liveness_hicbir_bagimliliga_dokunmaz(client, monkeypatch):
    """Tüm dış bağımlılıklar patlasa bile liveness 200 dönmeli ve ANINDA
    dönmeli — süreç ayakta olduğu sürece 'canlı'dır."""
    import main

    async def _patla():
        raise RuntimeError("bağımlılık kontrolü çağrılmamalıydı")

    async def _patla_dict():
        raise RuntimeError("bağımlılık kontrolü çağrılmamalıydı")

    monkeypatch.setattr(main, "_check_database", _patla)
    monkeypatch.setattr(main, "_check_redis", _patla)
    monkeypatch.setattr(main, "_check_storage", _patla)
    monkeypatch.setattr(main, "_check_routing", _patla_dict)

    # Asıl kanıt: yukarıdaki kontroller çağrılsaydı istek 500 dönerdi.
    resp = client.get("/health/live")
    assert resp.status_code == 200
    assert resp.json() == {"status": "alive"}

    # Süre ölçümü ısıtmadan SONRA (ilk TestClient isteği ~1 sn taşıyıcı kurulumu).
    started = time.monotonic()
    for _ in range(5):
        assert client.get("/health/live").status_code == 200
    ortalama = (time.monotonic() - started) / 5
    assert ortalama < 0.05, f"liveness ucu ağır: istek başına {ortalama*1000:.0f} ms"


def test_readiness_rota_bozulmasini_bildirir_ama_dusurmez(client, monkeypatch):
    """Rota bozulması `degraded` olarak GÖRÜNMELİ ama 503 üretmemeli: VROOM
    kapalıyken teslimat planlaması yaklaşıklaşır, site çalışmaya devam eder."""
    import main

    async def _db_ok():
        return True

    async def _yardimci():
        return True

    async def _rota_bozuk():
        return {"provider": "auto", "status": "down", "degraded": True}

    monkeypatch.setattr(main, "_check_database", _db_ok)
    monkeypatch.setattr(main, "_check_redis", _yardimci)
    monkeypatch.setattr(main, "_check_storage", _yardimci)
    monkeypatch.setattr(main, "_check_routing", _rota_bozuk)

    resp = client.get("/health")
    assert resp.status_code == 200  # rota ikincil — isteği düşürmez
    body = resp.json()
    assert body["status"] == "degraded"
    assert body["routing"]["degraded"] is True


def test_readiness_db_dustugunde_503(client, monkeypatch):
    """DB çekirdek bağımlılıktır — düşükse readiness gerçekten başarısızdır."""
    import main

    async def _db_kapali():
        return False

    async def _yardimci():
        return True

    async def _rota():
        return {"provider": "auto", "status": "connected", "degraded": False}

    monkeypatch.setattr(main, "_check_database", _db_kapali)
    monkeypatch.setattr(main, "_check_redis", _yardimci)
    monkeypatch.setattr(main, "_check_storage", _yardimci)
    monkeypatch.setattr(main, "_check_routing", _rota)

    resp = client.get("/health")
    assert resp.status_code == 503
    assert resp.json()["status"] == "degraded"


def test_rota_kontrolu_saglik_ucunu_asla_patlatmaz(client, monkeypatch):
    """Rota katmanı beklenmedik bir hata verirse sağlık ucu 500 DÖNMEMELİ —
    izleme aracı 'uygulama çöktü' sanmamalı."""
    import main
    from core import routing

    async def _patla(**kwargs):
        raise RuntimeError("beklenmedik")

    async def _db_ok():
        return True

    async def _yardimci():
        return True

    monkeypatch.setattr(routing, "health_snapshot", _patla)
    monkeypatch.setattr(main, "_check_database", _db_ok)
    monkeypatch.setattr(main, "_check_redis", _yardimci)
    monkeypatch.setattr(main, "_check_storage", _yardimci)

    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["routing"]["status"] == "unknown"


def test_zorunlu_vroom_modunda_rota_arizasi_503_verir(client, monkeypatch):
    """`ROUTING_PROVIDER=vroom` iken rota servisi düşerse istisna servis
    katmanından kaçar. Handler olmasa admin panelinde OPAK bir 500 görünür ve
    gerçek neden yalnız logda kalırdı. 503 + Retry-After doğru sınıflandırmadır:
    istek geçerli, altyapı geçici olarak yok. Ayrıntı gövdeye KONMAZ."""
    from fastapi import APIRouter

    from core.routing.base import RoutingUnavailable
    from main import app

    r = APIRouter()

    @r.get("/__test__/rota-arizasi")
    async def _patlat():
        raise RoutingUnavailable("VROOM'a ulaşılamadı: http://vroom:3000 reddedildi")

    app.include_router(r)
    try:
        resp = client.get("/__test__/rota-arizasi")
        assert resp.status_code == 503
        assert resp.headers.get("Retry-After") == "60"
        assert "vroom:3000" not in resp.text
        assert "Rota servisi" in resp.json()["detail"]
    finally:
        app.router.routes = [
            rt for rt in app.router.routes
            if getattr(rt, "path", "") != "/__test__/rota-arizasi"
        ]
