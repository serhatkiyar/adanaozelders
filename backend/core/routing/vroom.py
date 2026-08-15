"""VROOM sağlayıcısı — self-hosted VRP çözücü (arka uçta OSRM yol ağı).

``docker compose --profile routing up`` ile kalkar (bkz. scripts/setup-osrm-adana.sh
veya .ps1 — veri hazırlığı). Payload kurma/yanıt ayrıştırma saf fonksiyonlardır
(pytest'li); ağ çağrısı yalnız ``plan``/``plan_fleet`` içindedir. Ulaşılamazsa
``RoutingUnavailable`` — factory ``auto`` modunda haversine'e düşer.

**Koordinat tavanı**: VROOM her planlamada OSRM'in ``table`` (mesafe matrisi)
servisini çağırır; ``osrm-routed`` varsayılan tavanı 100 koordinattır ve aşılınca
"TooBig" döner. Tavan aşımı ağa çıkmadan ÖNCE burada yakalanır (``VROOM_MAX_LOCATIONS``)
— aksi halde 100+ duraklı kampanya gününde hata, gerçek nedeni görünmeden
"VROOM'a ulaşılamadı" gibi loglanırdı.
"""
from __future__ import annotations

import math
from typing import Any

import httpx

from core.config import settings
from core.routing.base import (
    FleetPlan,
    RoutePlan,
    RoutePoint,
    RouteVehicle,
    RoutingProvider,
    RoutingUnavailable,
)

#: Sağlık yoklamasının çapa noktası. Bu bir OPERASYON varsayımı DEĞİLDİR
#: (İP-19 depoyu kaldırdı, başlangıç noktaları veridir) — OSRM verisinin
#: kapsadığı bölgenin içinden herhangi bir nokta gerekir ve veri hazırlığı
#: Adana bbox'ı ile yapılır (`scripts/setup-osrm-adana.*`). Veri kapsamı
#: değişirse burası da değişmelidir.
_PING_LAT, _PING_LNG = 36.9855, 35.3253


def max_tasks_per_vehicle(job_count: int, vehicle_count: int) -> int | None:
    """Çok araçlı planda araç başına durak tavanı (saf).

    **Neden gerekli**: VROOM kısıtsız bırakılırsa TOPLAM maliyeti azaltır, yükü
    dengelemez. Gerçek Adana koordinatlarıyla ölçüldü — 20 sipariş / 2 araç,
    siparişlerin çoğu tek bölgede toplandığında bölüşüm **[20, 0]** çıkıyordu:
    ikinci kurye bütün gün boşta. Dengeli dağılımda bile 40 siparişte bölüşüm
    11-29 ve kuryeler arası mesai farkı ~59 dakikaydı.

    **Maliyeti ölçüldü**: ``ceil(n/k)`` tavanı toplam mesafeyi dengeli günlerde
    %1-3, en kötü (çarpık) günde ~%9 artırır; buna karşılık mesai farkını
    43-93 dk'dan 3-13 dk'ya indirir. %20 tolerans denendi — mesafeyi anlamlı
    kurtarmadan dengeyi bozduğu için sıkı tavan tercih edildi.

    **Neden ``capacity`` değil ``max_tasks``**: VROOM'da ``capacity``/``amount``
    aracın FİZİKSEL yükünü (hacim/ağırlık) modeller; onu durak sayısı saymak için
    kullanmak, ileride gerçek yük kısıtı gerektiğinde boyutu işgal ederdi.
    ``max_tasks`` doğrudan "araç başına azami görev" demektir (VROOM ≥1.11).

    ``k * ceil(n/k) >= n`` olduğundan bu tavan atanamayan iş ÜRETEMEZ — yani
    kısıt yüzünden plan düşüp sessizce haversine'e gerilemez. Tek araçta kısıt
    anlamsız → ``None`` (payload birebir eski haliyle kalır).
    """
    if vehicle_count <= 1 or job_count <= 0:
        return None
    return math.ceil(job_count / vehicle_count)


def build_vroom_payload(
    *,
    points: list[RoutePoint],
    vehicles: list[RouteVehicle],
) -> dict[str, Any]:
    """VROOM isteği (açık tur — başlangıca dönüş zorunlu değil). Koordinatlar
    [lng, lat].

    İP-19 sözleşmesi (D-4…D-7): yeni yeteneklerin TÜMÜ **koşulludur** —
    varsayılan değerli araçlarda payload, paket öncesi tek-araç hâliyle
    **birebir aynıdır** (geriye uyumluluk paketin en önemli güvencesidir;
    değişse VROOM planları sessizce kayar ve başka hiçbir test görmez).

    * ``max_tasks``    = ``min(ceil(n/k), v.max_stops)`` — iki ayrı kısıt aynı
      alana yazılır: kuryeler arası mesai DENGESİ (yukarıdaki ölçülmüş
      gerekçe) ve aracın kendi kapasitesi (K-4). Küçüğü bağlayıcıdır;
      hiçbiri yoksa alan yazılmaz.

      **Denge tavanı YALNIZ maliyetsiz (homojen) filoda uygulanır.** Yeşil
      fazda ölçülen çelişki: ``ceil(n/k)`` SERT bir kısıttır — filoda
      ``fixed_cost``'lu bir yedek araç varken de yazılırsa, VROOM 3 siparişi
      bile bölmek ZORUNDA kalır (tek araç tavanı aşamaz) ve K-3'ün "ikinci
      araç ancak kazanç sabit maliyeti aşarsa çıkar" ekonomisi hiç
      çalışamaz. İki kısıt aynı anda ifade edilemez; öncelik K-3'ündür:
      herhangi bir araçta ``fixed_cost > 0`` ise denge tavanı yazılmaz,
      dengeyi ekonomi + ``max_stops`` yönetir. Maliyetsiz filoda (hepsi
      "zaten sahada" varsayımı) eski ölçülmüş denge davranışı birebir korunur.
    * ``time_window``  yalnız vardiyanın İKİ ucu da doluysa (yarım pencere
      VROOM'da tanımsız; NULL = "kısıt yok", K-2).
    * ``costs.fixed``  yalnız pozitifse — yedek aracı çıkarma EKONOMİSİ (K-3);
      eski 12'lik eşik coğrafyayı görmüyordu, VROOM ikinci aracı ancak
      kazanç sabit maliyeti aşarsa kullanır.
    * ``start``        araç başınadır (K-9: depo yok, başlangıç noktası veri).
    """
    maliyetli_filo = any(rv.fixed_cost > 0 for rv in vehicles)
    denge = (
        None if maliyetli_filo else max_tasks_per_vehicle(len(points), len(vehicles))
    )
    out_vehicles: list[dict[str, Any]] = []
    for rv in vehicles:
        v: dict[str, Any] = {
            "id": rv.id,
            "profile": rv.profile,
            "start": [rv.start_lng, rv.start_lat],
        }
        tavanlar = [t for t in (denge, rv.max_stops) if t is not None]
        if tavanlar:
            v["max_tasks"] = min(tavanlar)
        if rv.shift_start_sec is not None and rv.shift_end_sec is not None:
            v["time_window"] = [rv.shift_start_sec, rv.shift_end_sec]
        if rv.fixed_cost > 0:
            v["costs"] = {"fixed": rv.fixed_cost}
        out_vehicles.append(v)
    jobs = [
        {
            "id": p.id,
            "location": [p.lng, p.lat],
            "service": settings.DELIVERY_STOP_SERVICE_SECONDS,
        }
        for p in points
    ]
    return {"vehicles": out_vehicles, "jobs": jobs, "options": {"g": True}}


def check_location_budget(point_count: int, vehicle_count: int) -> None:
    """Planlama OSRM matris tavanına sığıyor mu? Sığmıyorsa ağa çıkmadan
    ``RoutingUnavailable`` (nedeni AÇIK) — çağıran auto modda haversine'e düşer,
    vroom modunda operatör gerçek nedeni görür."""
    total = point_count + max(vehicle_count, 1)  # duraklar + depo(lar)
    limit = settings.VROOM_MAX_LOCATIONS
    if limit > 0 and total > limit:
        raise RoutingUnavailable(
            f"Planlama {total} koordinat gerektiriyor; tavan {limit} "
            "(OSRM --max-table-size / VROOM maxlocations ile birlikte yükseltilmeli)"
        )


def parse_vroom_plan(data: dict[str, Any]) -> RoutePlan:
    """VROOM yanıtından tek-araç planı çıkarır. ``code != 0`` ya da atanmamış iş
    varsa ``RoutingUnavailable`` (kısmi plan sessizce uygulanmaz)."""
    _require_complete(data)
    return _route_to_plan(data["routes"][0])


def _require_complete(data: dict[str, Any]) -> None:
    """Yanıtın eksiksiz bir plan olduğunu doğrular (parse yollarının ortak girişi)."""
    if data.get("code") != 0:
        raise RoutingUnavailable(f"VROOM hata kodu: {data.get('code')} {data.get('error')}")
    if data.get("summary", {}).get("unassigned", 0):
        raise RoutingUnavailable("VROOM bazı durakları atayamadı")
    if not (data.get("routes") or []):
        raise RoutingUnavailable("VROOM rota dönmedi")


def _route_to_plan(route: dict[str, Any]) -> RoutePlan:
    """Tek VROOM route'unu RoutePlan'a çevirir (parse_vroom_plan'ın çekirdeği)."""
    ordered: list[int] = []
    offsets: dict[int, int] = {}
    for step in route.get("steps", []):
        if step.get("type") == "job":
            ordered.append(step["id"])
            offsets[step["id"]] = int(step.get("arrival", 0))
    distance_m = route.get("distance")
    return RoutePlan(
        ordered_ids=ordered,
        arrival_offsets=offsets,
        total_duration_seconds=int(route.get("duration", 0))
        + int(route.get("service", 0)),
        total_distance_km=round(distance_m / 1000, 1) if distance_m else None,
        geometry=route.get("geometry"),
        provider="vroom",
    )


def parse_vroom_fleet(data: dict[str, Any], *, expected_vehicles: list[int] | None = None) -> dict[int, RoutePlan]:
    """Çok araçlı VROOM yanıtı: araç id → rota. ``code != 0`` ya da atanmamış
    iş varsa ``RoutingUnavailable`` (kısmi plan uygulanmaz).

    ``expected_vehicles`` verilirse dönen araç id'leri doğrulanır: çağıran bu
    id'leri kendi araç sözlüğünde arayacağından (delivery: 1=LADA, 2=COROLLA)
    beklenmeyen bir id sessiz KeyError/500 üretirdi.
    """
    _require_complete(data)
    out: dict[int, RoutePlan] = {}
    for r in data["routes"]:
        if "vehicle" not in r:
            raise RoutingUnavailable("VROOM rotasında araç kimliği yok")
        vid = int(r["vehicle"])
        if expected_vehicles is not None and vid not in expected_vehicles:
            raise RoutingUnavailable(f"VROOM bilinmeyen araç kimliği döndü: {vid}")
        out[vid] = _route_to_plan(r)
    return out


def assert_covers(plan_ids: list[int], requested: list[int]) -> None:
    """Plan, istenen durakların TAMAMINI ve yalnız onları içeriyor mu? (saf)

    Çağıran sırayı ``{id: durak}`` sözlüğünde çözer; eksik/fazla id sessiz
    KeyError ya da — daha kötüsü — sessizce düşürülmüş bir durak demektir.
    """
    if sorted(plan_ids) != sorted(requested):
        missing = sorted(set(requested) - set(plan_ids))
        extra = sorted(set(plan_ids) - set(requested))
        raise RoutingUnavailable(
            f"Rota planı duraklarla eşleşmiyor (eksik: {missing}, fazla: {extra})"
        )


async def ping(*, timeout: float) -> None:
    """Sağlık yoklaması: depo çevresinde iki duraklık gerçek bir plan iste.

    VROOM'un ayakta olması yetmez — arkasındaki OSRM verisi yüklü değilse
    VROOM da çözemez. En ucuz uçtan uca kanıt gerçek (ama minik) bir plandır.
    """
    lat, lng = _PING_LAT, _PING_LNG
    payload = build_vroom_payload(
        points=[
            RoutePoint(id=1, lat=lat + 0.004, lng=lng + 0.004),
            RoutePoint(id=2, lat=lat - 0.004, lng=lng - 0.004),
        ],
        vehicles=[RouteVehicle(id=1, start_lat=lat, start_lng=lng)],
    )
    parse_vroom_plan(await _post_vroom(payload, timeout=timeout))


async def _post_vroom(
    payload: dict[str, Any], *, timeout: float | None = None
) -> dict[str, Any]:
    """VROOM'a plan isteği. Hata gövdesi KORUNUR: VROOM çözemediği isteklere
    HTTP 500 + ``{"code": 3, "error": "..."}`` döner; gövdeyi okumazsak her
    sorun "ulaşılamadı" gibi görünür ve saha teşhisi imkânsızlaşır."""
    try:
        async with httpx.AsyncClient(
            timeout=timeout if timeout is not None else settings.VROOM_TIMEOUT_SECONDS
        ) as client:
            resp = await client.post(settings.VROOM_URL, json=payload)
            if resp.status_code >= 400:
                raise RoutingUnavailable(
                    f"VROOM {resp.status_code}: {_error_detail(resp)}"
                )
            return resp.json()
    except RoutingUnavailable:
        raise
    except (httpx.HTTPError, ValueError) as exc:
        raise RoutingUnavailable(f"VROOM'a ulaşılamadı: {exc}") from exc


def _error_detail(resp: httpx.Response) -> str:
    try:
        body = resp.json()
    except ValueError:
        return resp.text[:200]
    if isinstance(body, dict):
        return f"code={body.get('code')} {body.get('error')}"
    return str(body)[:200]


class VroomRoutingProvider(RoutingProvider):
    name = "vroom"

    async def plan(
        self, *, depot_lat: float, depot_lng: float, points: list[RoutePoint]
    ) -> RoutePlan:
        if not points:
            return RoutePlan(ordered_ids=[], provider=self.name)
        check_location_budget(len(points), 1)
        # Tek-tur optimize yolu: başlangıç noktası varsayılan araca sarılır —
        # payload, İP-19 öncesi tek-araç hâliyle birebir aynı kalır (D-4).
        payload = build_vroom_payload(
            points=points,
            vehicles=[RouteVehicle(id=1, start_lat=depot_lat, start_lng=depot_lng)],
        )
        plan = parse_vroom_plan(await _post_vroom(payload))
        assert_covers(plan.ordered_ids, [p.id for p in points])
        return plan

    async def plan_fleet(
        self,
        *,
        points: list[RoutePoint],
        vehicles: list[RouteVehicle],
    ) -> FleetPlan:
        if not points:
            return FleetPlan(routes={}, provider=self.name)
        if len(vehicles) == 1:
            # Tek araç: base'in plan() yolu — ama aracın KENDİ kısıtları
            # (max_stops/vardiya/başlangıç) kaybolmasın diye burada payload'ı
            # yine tam araçla kurarız.
            check_location_budget(len(points), 1)
            payload = build_vroom_payload(points=points, vehicles=vehicles)
            routes = parse_vroom_fleet(
                await _post_vroom(payload), expected_vehicles=[vehicles[0].id]
            )
            assert_covers(
                [i for r in routes.values() for i in r.ordered_ids],
                [p.id for p in points],
            )
            return FleetPlan(routes=routes, provider=self.name)
        check_location_budget(len(points), len(vehicles))
        payload = build_vroom_payload(points=points, vehicles=vehicles)
        routes = parse_vroom_fleet(
            await _post_vroom(payload), expected_vehicles=[v.id for v in vehicles]
        )
        assert_covers(
            [i for r in routes.values() for i in r.ordered_ids], [p.id for p in points]
        )
        return FleetPlan(routes=routes, provider=self.name)
