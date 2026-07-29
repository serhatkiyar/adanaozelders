"""core/routing sertleştirmesi: kapasite dengesi, OSRM matris tavanı, savunmacı
ayrıştırma ve devre kesici. DB/ağ gerektirmez.

Bu dosyanın varlık nedeni: rota katmanının asıl riski çökmek değil, SESSİZCE
bozulmaktır. VROOM düştüğünde sistem çalışmaya devam eder ama müşteriye verilen
varış penceresi gerçek yol ağından değil kuş uçuşu tahminden üretilir. Buradaki
testler o bozulmanın (a) akışı kesmediğini, (b) görünür olduğunu, (c) pahalıya
mal olmadığını (tekrar tekrar timeout beklenmediğini) doğrular.
"""
import pytest

from core.routing.base import RoutePoint, RoutingUnavailable
from core.routing.vroom import build_vroom_payload

DEPOT = (36.9855, 35.3253)


def p(id_: int, lat: float, lng: float) -> RoutePoint:
    return RoutePoint(id=id_, lat=lat, lng=lng)


# ── Kapasite dengesi ─────────────────────────────────────────────────────────────


def test_max_tasks_balances_and_never_starves():
    """Araç başına tavan yükü dengelemeli AMA tavan yüzünden atanamayan iş
    ÜRETMEMELİ: k * ceil(n/k) >= n her zaman doğru olmalı. Aksi halde VROOM
    'unassigned' döner, plan tümüyle reddedilir ve sistem sessizce haversine'e
    düşerdi — yani denge uğruna gerçek yol ağını kaybederdik."""
    from core.routing.vroom import max_tasks_per_vehicle

    assert max_tasks_per_vehicle(9, 2) == 5  # kısıtsız VROOM 9'u tek araca yığıyordu
    assert max_tasks_per_vehicle(1, 1) is None  # tek araçta kısıt anlamsız
    assert max_tasks_per_vehicle(0, 3) is None
    for n in range(1, 60):
        for k in (2, 3, 5):
            assert max_tasks_per_vehicle(n, k) * k >= n


def test_multi_vehicle_payload_uses_max_tasks_not_capacity():
    """Kısıt ``max_tasks`` ile verilmeli. ``capacity``/``amount`` VROOM'da aracın
    FİZİKSEL yükünü (hacim/ağırlık) modeller; onu durak sayacı olarak kullanmak
    ileride gerçek yük kısıtı gerektiğinde boyutu işgal ederdi."""
    pts = [p(i, 37.0 + i / 100, 35.3) for i in range(1, 6)]
    payload = build_vroom_payload(
        depot_lat=DEPOT[0], depot_lng=DEPOT[1], points=pts, vehicle_ids=[1, 2]
    )
    assert all(v["max_tasks"] == 3 for v in payload["vehicles"])  # ceil(5/2)
    assert all("capacity" not in v for v in payload["vehicles"])
    assert all("amount" not in j for j in payload["jobs"])


def test_single_vehicle_payload_has_no_task_cap():
    """Tek araç payload'ı kirlenmemeli (geriye uyumluluk)."""
    payload = build_vroom_payload(
        depot_lat=DEPOT[0], depot_lng=DEPOT[1], points=[p(1, 37.0, 35.3)]
    )
    assert "max_tasks" not in payload["vehicles"][0]
    assert "capacity" not in payload["vehicles"][0]


# ── OSRM matris tavanı ───────────────────────────────────────────────────────────


def test_location_budget_blocks_before_network(monkeypatch):
    """VROOM arkada OSRM `table` servisini çağırır; osrm-routed varsayılan tavanı
    100 koordinattır. Aşım ağa çıkmadan yakalanmalı ve neden AÇIK olmalı."""
    from core.config import settings
    from core.routing.vroom import check_location_budget

    monkeypatch.setattr(settings, "VROOM_MAX_LOCATIONS", 10)
    check_location_budget(9, 1)  # 9 durak + 1 depo = 10 → sınırda geçer
    with pytest.raises(RoutingUnavailable, match="tavan"):
        check_location_budget(10, 1)
    # Çok araçta her aracın depo koordinatı da matrise girer.
    with pytest.raises(RoutingUnavailable, match="tavan"):
        check_location_budget(9, 2)
    monkeypatch.setattr(settings, "VROOM_MAX_LOCATIONS", 0)
    check_location_budget(5000, 2)  # 0 = kontrol kapalı


# ── Savunmacı ayrıştırma ─────────────────────────────────────────────────────────


def test_assert_covers_detects_dropped_and_phantom_stops():
    """Çağıran sırayı {id: durak} sözlüğünde çözer: eksik id sessizce DÜŞÜRÜLMÜŞ
    bir teslimat, fazla id KeyError/500 demektir."""
    from core.routing.vroom import assert_covers

    assert_covers([3, 1, 2], [1, 2, 3])
    with pytest.raises(RoutingUnavailable, match="eksik"):
        assert_covers([1, 2], [1, 2, 3])
    with pytest.raises(RoutingUnavailable, match="fazla"):
        assert_covers([1, 2, 9], [1, 2])


def test_parse_vroom_fleet_rejects_unexpected_vehicle():
    from core.routing.vroom import parse_vroom_fleet

    unknown = {
        "code": 0,
        "summary": {"unassigned": 0},
        "routes": [{"vehicle": 7, "duration": 10, "steps": [{"type": "job", "id": 1}]}],
    }
    with pytest.raises(RoutingUnavailable, match="bilinmeyen araç"):
        parse_vroom_fleet(unknown, expected_vehicles=[1, 2])
    missing = {
        "code": 0,
        "summary": {"unassigned": 0},
        "routes": [{"duration": 10, "steps": []}],
    }
    with pytest.raises(RoutingUnavailable, match="araç kimliği yok"):
        parse_vroom_fleet(missing)


def test_post_vroom_preserves_error_body():
    """VROOM çözemediği isteğe HTTP 500 + {"code":3,...} döner. Gövde kaybolursa
    her sorun 'ulaşılamadı' gibi görünür ve saha teşhisi imkânsızlaşır."""
    import httpx

    from core.routing.vroom import _error_detail

    detail = _error_detail(
        httpx.Response(500, json={"code": 3, "error": "Too many table coordinates"})
    )
    assert "code=3" in detail and "Too many table coordinates" in detail
    assert _error_detail(httpx.Response(502, text="bad gateway")) == "bad gateway"


# ── Devre kesici ─────────────────────────────────────────────────────────────────


@pytest.fixture
def routing_module():
    from core import routing

    routing.reset_state()
    yield routing
    routing.reset_state()


@pytest.mark.asyncio
async def test_auto_falls_back_and_stops_retrying_during_cooldown(
    routing_module, monkeypatch
):
    """VROOM düştüğünde auto haversine'e düşmeli VE kesici penceresi boyunca
    yeniden DENEMEMELİ: "Günü Optimize Et" tek istekte 1+N planlama çağırır;
    kesici olmasa admin isteği (1+N) × timeout kadar asılı kalır ve o süre
    boyunca DB bağlantısını tutardı."""
    from core.config import settings
    from core.routing.vroom import VroomRoutingProvider

    calls = 0

    async def _boom(self, **kwargs):
        nonlocal calls
        calls += 1
        raise RoutingUnavailable("VROOM kapalı")

    monkeypatch.setattr(settings, "ROUTING_PROVIDER", "auto")
    monkeypatch.setattr(settings, "ROUTING_FAILURE_COOLDOWN_SECONDS", 60)
    monkeypatch.setattr(VroomRoutingProvider, "plan", _boom)

    pts = [p(1, 37.01, 35.33), p(2, 37.05, 35.31)]
    for _ in range(5):
        plan = await routing_module.plan_route(
            depot_lat=DEPOT[0], depot_lng=DEPOT[1], points=pts
        )
        assert plan.provider == "haversine"  # akış bozulmadı
    assert calls == 1  # tek deneme; kalan 4 istek doğrudan fallback


@pytest.mark.asyncio
async def test_vroom_mode_fails_fast_while_cooling(routing_module, monkeypatch):
    """Zorunlu VROOM modunda kesici sessiz fallback YAPMAZ — hızlı ve nedeniyle
    birlikte hata verir."""
    from core.config import settings
    from core.routing.vroom import VroomRoutingProvider

    calls = 0

    async def _boom(self, **kwargs):
        nonlocal calls
        calls += 1
        raise RoutingUnavailable("OSRM verisi yok")

    monkeypatch.setattr(settings, "ROUTING_PROVIDER", "vroom")
    monkeypatch.setattr(settings, "ROUTING_FAILURE_COOLDOWN_SECONDS", 60)
    monkeypatch.setattr(VroomRoutingProvider, "plan", _boom)

    pts = [p(1, 37.01, 35.33)]
    with pytest.raises(RoutingUnavailable, match="OSRM verisi yok"):
        await routing_module.plan_route(
            depot_lat=DEPOT[0], depot_lng=DEPOT[1], points=pts
        )
    with pytest.raises(RoutingUnavailable, match="başarısız"):
        await routing_module.plan_route(
            depot_lat=DEPOT[0], depot_lng=DEPOT[1], points=pts
        )
    assert calls == 1


@pytest.mark.asyncio
async def test_fleet_path_also_falls_back(routing_module, monkeypatch):
    """Çoklu araç yolu da aynı kesici/fallback sözleşmesine tabidir."""
    from core.config import settings
    from core.routing.vroom import VroomRoutingProvider

    async def _boom(self, **kwargs):
        raise RoutingUnavailable("VROOM kapalı")

    monkeypatch.setattr(settings, "ROUTING_PROVIDER", "auto")
    monkeypatch.setattr(VroomRoutingProvider, "plan_fleet", _boom)
    fleet = await routing_module.plan_fleet(
        depot_lat=DEPOT[0],
        depot_lng=DEPOT[1],
        points=[p(1, 36.99, 35.30), p(2, 37.02, 35.42)],
        vehicle_ids=[1, 2],
    )
    assert fleet.provider == "haversine"
    assert sorted(i for r in fleet.routes.values() for i in r.ordered_ids) == [1, 2]


@pytest.mark.asyncio
async def test_recovery_clears_breaker(routing_module, monkeypatch):
    """VROOM geri gelince kesici temizlenmeli — kalıcı olarak tahmine düşülmez."""
    from core.config import settings
    from core.routing.base import RoutePlan
    from core.routing.vroom import VroomRoutingProvider

    monkeypatch.setattr(settings, "ROUTING_PROVIDER", "auto")
    monkeypatch.setattr(settings, "ROUTING_FAILURE_COOLDOWN_SECONDS", 0)

    state = {"fail": True}

    async def _flaky(self, **kwargs):
        if state["fail"]:
            raise RoutingUnavailable("geçici")
        return RoutePlan(ordered_ids=[1], provider="vroom")

    monkeypatch.setattr(VroomRoutingProvider, "plan", _flaky)
    pts = [p(1, 37.01, 35.33)]
    first = await routing_module.plan_route(
        depot_lat=DEPOT[0], depot_lng=DEPOT[1], points=pts
    )
    assert first.provider == "haversine"
    state["fail"] = False
    second = await routing_module.plan_route(
        depot_lat=DEPOT[0], depot_lng=DEPOT[1], points=pts
    )
    assert second.provider == "vroom"


# ── Sağlık raporu ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_health_snapshot_flags_haversine_as_degraded(routing_module, monkeypatch):
    """Kuş uçuşu mod çalışır ama SAĞLIKLI değildir: /health bunu bozulma olarak
    bildirmeli, yoksa üretimde aylarca fark edilmeden yanlış ETA verilir."""
    from core.config import settings

    monkeypatch.setattr(settings, "ROUTING_PROVIDER", "haversine")
    snap = await routing_module.health_snapshot()
    assert snap["status"] == "haversine"
    assert snap["degraded"] is True


@pytest.mark.asyncio
async def test_health_snapshot_reports_breaker_without_network(
    routing_module, monkeypatch
):
    """Kesici açıkken sağlık ucu ağa ÇIKMAZ (yoklama isteği hattı daha da
    yormamalı) — bilinen hatayı raporlar."""
    from core.config import settings
    from core.routing import vroom as vroom_mod

    monkeypatch.setattr(settings, "ROUTING_PROVIDER", "auto")
    monkeypatch.setattr(settings, "ROUTING_FAILURE_COOLDOWN_SECONDS", 60)

    async def _fail_if_called(**kwargs):
        raise AssertionError("kesici açıkken ağa çıkılmamalı")

    routing_module._state.note_failure(RoutingUnavailable("bağlantı reddedildi"))
    monkeypatch.setattr(vroom_mod, "ping", _fail_if_called)
    snap = await routing_module.health_snapshot()
    assert snap["status"] == "down" and snap["degraded"] is True
    assert "bağlantı reddedildi" in snap["detail"]


# ── Sağlık raporu tutarlılığı (yanıltıcı "sağlıklı" olmamalı) ────────────────────


@pytest.mark.asyncio
async def test_canli_hata_bayat_basarili_yoklamayi_gecersiz_kilar(
    routing_module, monkeypatch
):
    """Yoklama önbelleği TTL'li: başarılı bir yoklamadan hemen sonra gerçek
    planlamalar düşmeye başlarsa, /health TTL boyunca "connected" demeye devam
    ederdi — tam da kaçınmak istediğimiz yanıltıcı rapor. Gerçek trafik sonucu
    önbelleği ezmeli."""
    from core.config import settings
    from core.routing import vroom as vroom_mod
    from core.routing.vroom import VroomRoutingProvider

    monkeypatch.setattr(settings, "ROUTING_PROVIDER", "auto")
    # Kesici KAPALI: yalnız önbellek tutarlılığını sınıyoruz.
    monkeypatch.setattr(settings, "ROUTING_FAILURE_COOLDOWN_SECONDS", 0)
    monkeypatch.setattr(settings, "ROUTING_HEALTH_TTL_SECONDS", 3600)

    async def _ok(**kwargs):
        return None

    monkeypatch.setattr(vroom_mod, "ping", _ok)
    assert (await routing_module.health_snapshot())["status"] == "connected"

    async def _boom(self, **kwargs):
        raise RoutingUnavailable("OSRM düştü")

    monkeypatch.setattr(VroomRoutingProvider, "plan", _boom)
    plan = await routing_module.plan_route(
        depot_lat=DEPOT[0], depot_lng=DEPOT[1], points=[p(1, 37.0, 35.3)]
    )
    assert plan.provider == "haversine"
    snap = await routing_module.health_snapshot()
    assert snap["status"] == "down" and snap["degraded"] is True


@pytest.mark.asyncio
async def test_uretimde_saglik_ucu_ic_ayrinti_sizdirmaz(routing_module, monkeypatch):
    """/health kimlik doğrulamasız PUBLIC bir uçtur (Caddy alan adının kökünde
    yayınlar). Üretimde iç servis adı ve istisna metni oraya konmamalı."""
    from core.config import settings

    monkeypatch.setattr(settings, "ROUTING_PROVIDER", "auto")
    monkeypatch.setattr(settings, "ROUTING_FAILURE_COOLDOWN_SECONDS", 60)
    routing_module._state.note_failure(
        RoutingUnavailable("VROOM'a ulaşılamadı: http://vroom:3000 bağlantı reddedildi")
    )

    public = await routing_module.health_snapshot(verbose=False)
    assert public["status"] == "down" and public["degraded"] is True
    birlesik = " ".join(str(v) for v in public.values())
    assert "vroom:3000" not in birlesik
    assert "detail" not in public and "last_error" not in public

    # Geliştirmede ayrıntı GÖRÜNMELİ (teşhis için).
    dev = await routing_module.health_snapshot(verbose=True)
    assert "vroom:3000" in dev["detail"]


@pytest.mark.asyncio
async def test_verbose_varsayilani_ortama_bagli(routing_module, monkeypatch):
    from core.config import settings

    monkeypatch.setattr(settings, "ROUTING_PROVIDER", "haversine")
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    assert "detail" not in await routing_module.health_snapshot()
    monkeypatch.setattr(settings, "ENVIRONMENT", "development")
    assert "detail" in await routing_module.health_snapshot()
