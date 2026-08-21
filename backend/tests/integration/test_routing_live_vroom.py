"""Rota optimizasyonu — GERÇEK VROOM + OSRM'e karşı uçtan uca doğrulama.

Birim testleri (``tests/test_routing*.py``) payload/ayrıştırma sözleşmesini
sahte veriyle sınar; burada gerçek çözücüye ve gerçek Adana yol ağına bağlanılır.
Yakalamayı hedeflediği sınıf, birim testlerinin YAPI GEREĞİ göremeyeceği hatalar:

  - OSRM ``--max-table-size`` (varsayılan 100) yüzünden 100+ duraklı turun
    tümüyle çözülememesi — bu hata canlıda "TooBig" olarak döner, sahte
    yanıtlarda hiç görünmez;
  - VROOM'un çok araçlı bölüştürmeyi kapasite kısıtı olmadan dengelememesi;
  - fallback'in (haversine) gerçek yol ağına göre ne kadar saptığı.

VROOM erişilemezse testler FAIL değil SKIP olur (kurulumsuz geliştirme bozulmaz).
Ayağa kaldırmak için:  docker compose --profile routing up -d osrm vroom
"""
from __future__ import annotations

import math

import httpx
import pytest

from core.config import settings
from core.routing import plan_fleet, plan_route, reset_state
from core.routing.base import RoutePoint, RouteVehicle, RoutingUnavailable
from core.routing.haversine import HaversineRoutingProvider, haversine_km
from core.routing.vroom import VroomRoutingProvider

pytestmark = pytest.mark.asyncio

DEPOT = (36.9855, 35.3253)  # Seyhan — settings.DELIVERY_DEPOT_* ile aynı bölge


def _vroom_up() -> bool:
    try:
        # Boş iş listesi VROOM'a geçerli bir istektir; ayakta mı diye bakıyoruz.
        resp = httpx.post(
            settings.VROOM_URL,
            json={
                "vehicles": [{"id": 1, "profile": "car", "start": [DEPOT[1], DEPOT[0]]}],
                "jobs": [{"id": 1, "location": [DEPOT[1] + 0.004, DEPOT[0] + 0.004]}],
            },
            timeout=5,
        )
        return resp.status_code == 200 and resp.json().get("code") == 0
    except Exception:
        return False


pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(
        not _vroom_up(),
        reason="VROOM/OSRM ayakta değil (docker compose --profile routing up -d osrm vroom)",
    ),
]


def _grid(n: int, *, spread: float = 0.004) -> list[RoutePoint]:
    """Depo çevresine yayılmış n durak (Adana merkez ölçeğinde gerçekçi)."""
    side = math.ceil(math.sqrt(n))
    pts: list[RoutePoint] = []
    for i in range(n):
        pts.append(
            RoutePoint(
                id=i + 1,
                lat=DEPOT[0] - spread * side / 2 + spread * (i // side),
                lng=DEPOT[1] - spread * side / 2 + spread * (i % side),
            )
        )
    return pts


@pytest.fixture(autouse=True)
def _clean_breaker():
    reset_state()
    yield
    reset_state()


async def test_gercek_yol_agi_kullaniliyor():
    """`auto` modda VROOM ayaktaysa gerçekten VROOM kullanılmalı — sessizce
    haversine'e düşülmemeli (fallback'in en sinsi hali budur)."""
    plan = await plan_route(depot_lat=DEPOT[0], depot_lng=DEPOT[1], points=_grid(8))
    assert plan.provider == "vroom", "VROOM ayakta ama tahmine düşüldü"
    assert plan.geometry, "yol ağı planında polyline dönmeli (panel haritası çizer)"
    assert plan.total_distance_km and plan.total_distance_km > 0
    assert sorted(plan.ordered_ids) == list(range(1, 9))  # durak kaybı yok


@pytest.mark.parametrize("n", [99, 120, 200])
async def test_yuz_ustu_durak_cozulebiliyor(n: int):
    """REGRESYON: osrm-routed varsayılan --max-table-size 100'dür. Bayram/kampanya
    gününde 100+ duraklı tur bu yüzden OSRM'de "TooBig" alıyor, VROOM code=3
    dönüyor ve `auto` sessizce kuş uçuşu tahmine düşüyordu — yani gerçek yol ağı
    tam da EN ÇOK gerektiği gün devre dışı kalıyordu. compose artık
    --max-table-size 500 ile açılır."""
    plan = await plan_route(depot_lat=DEPOT[0], depot_lng=DEPOT[1], points=_grid(n))
    assert plan.provider == "vroom", f"{n} durakta yol ağı çözümü kayboldu"
    assert len(plan.ordered_ids) == n
    # Varış ofsetleri rota boyunca artmalı (ETA hesabının temeli).
    offsets = [plan.arrival_offsets[i] for i in plan.ordered_ids]
    assert offsets == sorted(offsets)


async def test_tavan_asimi_ag_a_cikmadan_kesilir(monkeypatch):
    """Yapılandırılan koordinat tavanı aşılırsa istek VROOM'a hiç gitmemeli ve
    `auto` düzgünce fallback'e geçmeli (500 değil)."""
    monkeypatch.setattr(settings, "VROOM_MAX_LOCATIONS", 20)
    with pytest.raises(RoutingUnavailable, match="tavan"):
        await VroomRoutingProvider().plan(
            depot_lat=DEPOT[0], depot_lng=DEPOT[1], points=_grid(50)
        )
    plan = await plan_route(depot_lat=DEPOT[0], depot_lng=DEPOT[1], points=_grid(50))
    assert plan.provider == "haversine"  # akış kesilmedi, yalnız bozuldu


def _filo(n: int, *, fixed_cost: int = 0, max_stops: int | None = None):
    """n araçlık filo; hepsi aynı başlangıç noktasından (İP-19: depo yok, K-9)."""
    return [
        RouteVehicle(
            id=i,
            start_lat=DEPOT[0],
            start_lng=DEPOT[1],
            fixed_cost=fixed_cost,
            max_stops=max_stops,
        )
        for i in range(1, n + 1)
    ]


async def test_coklu_arac_yuku_dengeli_bolusturuyor():
    """Kısıtsız VROOM toplam maliyeti azaltır, yükü dengelemez: 20 iş / 2 araçta
    ölçülen bölüşüm çok dengesiz olabiliyordu (bir kurye 8 saat, diğeri 2 saat).
    capacity=ceil(n/k) tavanı bunu düzeltmeli — ve kapasite yüzünden atanamayan
    iş üretmemeli.

    İP-19 (bağımsız denetim B-1): `plan_fleet` imzası `depot_lat/vehicle_ids`
    yerine araç NESNELERİ alacak biçimde değişmişti, bu dosya güncellenmemişti
    ve VROOM kapalı CI'da SKIP olduğu için kırıklığı görünmedi. Denge tavanı
    MALİYETSİZ filoya aittir (K-3a) — bu düğüm o hâli ölçer.
    """
    points = _grid(20)
    fleet = await plan_fleet(points=points, vehicles=_filo(2))
    assert fleet.provider == "vroom"
    sizes = sorted(len(r.ordered_ids) for r in fleet.routes.values())
    assert sum(sizes) == 20, "durak kaybı/tekrarı var"
    assert sizes[-1] <= 10, f"yük dengesiz bölüşüldü: {sizes}"
    all_ids = sorted(i for r in fleet.routes.values() for i in r.ordered_ids)
    assert all_ids == [p.id for p in points]


async def test_maliyetli_filoda_tavan_YINE_DE_uygulanir():
    """K-3a'nın canlı kanıtı (denetim M-5): `costs.fixed` ile `max_tasks` aynı
    payload'da yaşayabilir. Denge tavanı maliyetli filoda bilinçli yazılmaz ama
    aracın KENDİ fiziksel tavanı her hâlde uygulanır — "tek araca 40 yükle"
    durumunun sağlayıcı katmanındaki nöbetçisi (B-2).

    Bu düğüm kasıtlı olarak YEŞİL doğar: mevcut davranışın doğru olduğunu
    ölçer ve ileride `max_stops`'un maliyetli filoda düşürülmesini engeller.
    """
    points = _grid(12)
    fleet = await plan_fleet(points=points, vehicles=_filo(2, fixed_cost=1800, max_stops=7))
    assert fleet.provider == "vroom"
    sizes = sorted(len(r.ordered_ids) for r in fleet.routes.values())
    assert sum(sizes) == 12, "kapasite yüzünden atanamayan iş üretildi"
    assert max(sizes) <= 7, f"araç kendi tavanını aştı: {sizes}"


async def test_haversine_fallback_gercek_rotayi_asiri_iyimser_gostermiyor():
    """Fallback'in ne kadar saptığını ÖLÇ. Kuş uçuşu tahmin gerçek yol ağından
    kısa çıkarsa müşteriye fazla iyimser varış penceresi verilir; bu testin
    amacı bir eşiği "geçirmek" değil, sapmanın büyüklük mertebesini kayıt altına
    almak ve tahminin gerçeğin ~yarısına düşmediğini garanti etmektir."""
    points = _grid(15)
    real = await VroomRoutingProvider().plan(
        depot_lat=DEPOT[0], depot_lng=DEPOT[1], points=points
    )
    approx = await HaversineRoutingProvider().plan(
        depot_lat=DEPOT[0], depot_lng=DEPOT[1], points=points
    )
    ratio = approx.total_duration_seconds / real.total_duration_seconds
    assert 0.5 <= ratio <= 2.0, (
        f"haversine tahmini gerçek yol ağından çok sapıyor (oran {ratio:.2f}; "
        f"gerçek {real.total_duration_seconds}s, tahmin {approx.total_duration_seconds}s)"
    )


def _decode_polyline5(encoded: str) -> list[tuple[float, float]]:
    """Google/OSRM polyline5 çözücü (yalnız test için — bağımlılık eklememek
    adına yerinde; frontend aynı biçimi @mapbox/polyline ile çözer)."""
    coords: list[tuple[float, float]] = []
    index = lat = lng = 0
    while index < len(encoded):
        for is_lat in (True, False):
            shift = result = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else (result >> 1)
            if is_lat:
                lat += delta
            else:
                lng += delta
        coords.append((lat / 1e5, lng / 1e5))
    return coords


async def test_rota_geometrisi_duraklara_yakin_geciyor():
    """VROOM'un döndüğü polyline gerçekten planlanan durakların üzerinden
    geçmeli. Yanlış koordinat sırası ([lat,lng] ↔ [lng,lat]) tam burada
    yakalanır: rota Adana yerine bambaşka bir yerde çizilirdi."""
    points = _grid(6)
    plan = await VroomRoutingProvider().plan(
        depot_lat=DEPOT[0], depot_lng=DEPOT[1], points=points
    )
    coords = _decode_polyline5(plan.geometry)  # [(lat, lng), ...]
    for p in points:
        nearest = min(haversine_km(p.lat, p.lng, c[0], c[1]) for c in coords)
        assert nearest < 0.5, f"durak {p.id} rota geometrisinden {nearest:.2f} km uzakta"


async def test_vroom_dustugunde_devre_kesici_hatti_yormaz(monkeypatch):
    """VROOM erişilemez olduğunda: (a) akış bozulmaz, (b) tekrar tekrar timeout
    beklenmez. Erişilemeyen adrese yönlendirip ölçüyoruz."""
    import time

    monkeypatch.setattr(settings, "VROOM_URL", "http://127.0.0.1:59999")
    monkeypatch.setattr(settings, "ROUTING_FAILURE_COOLDOWN_SECONDS", 60)
    monkeypatch.setattr(settings, "ROUTING_PROVIDER", "auto")

    started = time.monotonic()
    for _ in range(6):  # "Günü Optimize Et" tek istekte 1+N planlama çağırır
        plan = await plan_route(depot_lat=DEPOT[0], depot_lng=DEPOT[1], points=_grid(5))
        assert plan.provider == "haversine"
    assert time.monotonic() - started < 5.0, "kesici çalışmıyor — her çağrı ağa çıkıyor"
