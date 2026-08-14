"""İP-19 filo sözleşmesi — saf/birim düğümler (D-1 · D-4…D-7 · D-16).

Bu dosya **üretim kodundan ÖNCE** yazıldı (kök CLAUDE.md §E). Kırmızı fazda
düşmesi beklenen düğümler, kaldırılacak yapılar hâlâ var olduğu ve yerlerine
geçecek yapılar henüz yazılmadığı içindir.

Sözleşme: `docs/ip19-dagitim-operasyon-sozlesme.md`.

## Yokluk iddiaları neden tek başına yetmez

"`DeliveryVehicle` enum'u yok" iddiası, `models/delivery.py` tamamen silinse de
geçer. Bu yüzden her yokluk düğümünün yanına **doluluk nöbetçisi** kondu:
yerine geçen yapının GERÇEKTEN var olduğu ayrıca ölçülür (sözleşme §5.1).
"""
from __future__ import annotations

import math

import pytest


# ── D-1: kaldırılan yapılar ───────────────────────────────────────────────────


def test_D1_arac_enumu_kaldirildi():
    """`DeliveryVehicle` enum'u yok. Araç artık bir tablodur (K-1).

    Enum bugün `models/delivery.py:40-44`'te duruyor ve **hiçbir yerde
    kullanılmıyor** — kolon `String(20)`, doğrulama regex, servis ayrı sözlük.
    Yani tek doğruluk kaynağı illüzyonu üretiyor; kaldırılması gerekiyor.
    """
    import models.delivery as m

    assert not hasattr(m, "DeliveryVehicle"), (
        "DeliveryVehicle enum'u hâlâ var — araç tabloya taşınmadı"
    )


def test_D1_vehicle_ids_sozlugu_kaldirildi():
    """`_VEHICLE_IDS = {1: 'LADA', 2: 'COROLLA'}` yok.

    Bu sözlük VROOM int id'si ile enum string'i arasında köprüydü.
    `vehicles.id` doğrudan VROOM id'si olunca köprü gereksizleşir (K-1).
    """
    import services.delivery_service as s

    assert not hasattr(s, "_VEHICLE_IDS"), (
        "_VEHICLE_IDS sözlüğü hâlâ var — filo boyutu kodda sabit demektir"
    )


def test_D1_tek_arac_esigi_ayari_kaldirildi():
    """`DELIVERY_SINGLE_VEHICLE_MAX_STOPS` yok — karar ekonomiye taşındı (K-3).

    Bu sabit "12 duraktan sonra ikinci aracı çıkar" diyordu ve coğrafyayı hiç
    görmüyordu. Yerine `vehicles.fixed_cost` → VROOM `costs.fixed` geçer.
    """
    from core.config import settings

    assert not hasattr(settings, "DELIVERY_SINGLE_VEHICLE_MAX_STOPS"), (
        "eşik ayarı hâlâ var — araç sayısı kararı sabitte demektir"
    )


def test_D1_depo_koordinati_ayarlari_kaldirildi():
    """`DELIVERY_DEPOT_LAT/LNG` yok — depo yoktur (K-9).

    Bu koordinat gerçek bir yer değildi (şehir merkezi yer tutucusu) ve İKİ
    alakasız işi birden taşıyordu: rota başlangıcı + bölge merkezi (K-10).
    Başlangıç `pickup_points`'e, bölge ilçe listesine taşınır.
    """
    from core.config import settings

    for ad in ("DELIVERY_DEPOT_LAT", "DELIVERY_DEPOT_LNG", "DELIVERY_ZONE_RADIUS_KM"):
        assert not hasattr(settings, ad), f"{ad} hâlâ var (K-9/K-10)"


def test_D1_kurye_plakasi_araca_tasindi():
    """`couriers.vehicle_plate` yok — araç niteliği araçta yaşar (K-5).

    Bugünkü hâl anti-pattern: kurye araç değiştirince geçmiş yalan söyler.
    """
    from models.courier import Courier

    assert not hasattr(Courier, "vehicle_plate"), (
        "vehicle_plate hâlâ kuryede — araç niteliği sürücü kaydında demektir"
    )


# ── D-1 DOLULUK NÖBETÇİLERİ ───────────────────────────────────────────────────
# Yukarıdaki beş iddia, ilgili modüller tamamen silinse de geçerdi.


def test_D1_NOBETCI_vehicle_modeli_var_ve_kayitli():
    """Yerine geçen `Vehicle` modeli GERÇEKTEN var ve `models/__init__`'te kayıtlı.

    Kayıt kritiktir: `models/__init__.py`'de olmayan model Alembic
    autogenerate tarafından **görülmez** (kök CLAUDE.md kodlama kuralı).
    """
    import models
    from models.vehicle import Vehicle

    assert Vehicle.__tablename__ == "vehicles"
    assert "Vehicle" in models.__all__, "models/__init__.__all__ kaydı eksik"
    for kolon in ("code", "label", "plate", "profile", "max_stops",
                  "shift_start", "shift_end", "fixed_cost", "sort_order", "is_active"):
        assert hasattr(Vehicle, kolon), f"Vehicle.{kolon} yok"


def test_D1_NOBETCI_pickup_point_modeli_var_ve_kayitli():
    """Başlangıç/toplama noktaları veri olarak var (K-9)."""
    import models
    from models.pickup_point import PickupPoint

    assert PickupPoint.__tablename__ == "pickup_points"
    assert "PickupPoint" in models.__all__
    for kolon in ("name", "kind", "lat", "lng", "is_active", "sort_order"):
        assert hasattr(PickupPoint, kolon), f"PickupPoint.{kolon} yok"


def test_D1_NOBETCI_run_araca_FK_ile_bagli():
    """`delivery_runs.vehicle_id` FK var, serbest string kolon yok."""
    from models.delivery import DeliveryRun

    assert hasattr(DeliveryRun, "vehicle_id"), "vehicle_id FK yok"
    assert not hasattr(DeliveryRun, "vehicle"), (
        "serbest `vehicle` string kolonu hâlâ var"
    )


# ── D-4…D-7: VROOM payload sözleşmesi ─────────────────────────────────────────


def _arac(**kw):
    """Varsayılan `RouteVehicle` — testin niyetini tek satırda okutur."""
    from core.routing.base import RouteVehicle

    return RouteVehicle(**kw)


def _noktalar(n: int):
    from core.routing.base import RoutePoint

    return [RoutePoint(id=i, lat=36.98 + i * 0.001, lng=35.32 + i * 0.001)
            for i in range(1, n + 1)]


def test_D4_varsayilan_araclarda_payload_BUGUNKUYLE_AYNI():
    """Geriye uyumluluk: hiçbir yeni alan dolu değilse payload birebir eski.

    Bu düğüm paketin **en önemli güvencesidir**: yeni yetenekler koşullu
    eklenir, varsayılan davranış değişmez. Değişirse VROOM planları sessizce
    kayar ve bunu başka hiçbir test görmez.
    """
    from core.routing.vroom import build_vroom_payload

    p = build_vroom_payload(
        points=_noktalar(3),
        vehicles=[_arac(id=1, start_lat=36.9855, start_lng=35.3253)],
    )
    (arac,) = p["vehicles"]
    assert arac == {"id": 1, "profile": "car", "start": [35.3253, 36.9855]}, (
        f"varsayılan araç payload'ı değişmiş: {arac}"
    )
    # DOLULUK NÖBETÇİSİ: boş payload karşılaştırması iki tarafta da eşit çıkardı.
    assert len(p["jobs"]) == 3


def test_D5_vardiya_penceresi_YALNIZ_ikisi_de_doluysa_gonderilir():
    """`time_window` ancak `shift_start` VE `shift_end` doluysa yazılır (K-2).

    Yarım pencere göndermek VROOM'da tanımsızdır; ayrıca K-2 gereği NULL
    vardiya "kısıt yok" demektir — kurucu esnek çalışıyorsa plan bugünkü
    davranışını korumalıdır.
    """
    from core.routing.vroom import build_vroom_payload

    pts = _noktalar(2)

    tam = build_vroom_payload(
        points=pts,
        vehicles=[_arac(id=1, start_lat=36.98, start_lng=35.32,
                        shift_start_sec=9 * 3600, shift_end_sec=18 * 3600)],
    )
    assert tam["vehicles"][0]["time_window"] == [9 * 3600, 18 * 3600]

    for eksik in (
        {"shift_start_sec": 9 * 3600},
        {"shift_end_sec": 18 * 3600},
        {},
    ):
        p = build_vroom_payload(
            points=pts,
            vehicles=[_arac(id=1, start_lat=36.98, start_lng=35.32, **eksik)],
        )
        assert "time_window" not in p["vehicles"][0], (
            f"yarım/boş vardiya pencere üretti: {eksik}"
        )


def test_D6_sabit_maliyet_YALNIZ_sifirdan_buyukse_gonderilir():
    """`costs.fixed` yedek aracı çıkarma ekonomisidir (K-3); 0 ise alan yazılmaz."""
    from core.routing.vroom import build_vroom_payload

    pts = _noktalar(2)

    p = build_vroom_payload(
        points=pts,
        vehicles=[_arac(id=1, start_lat=36.98, start_lng=35.32, fixed_cost=25000)],
    )
    assert p["vehicles"][0]["costs"] == {"fixed": 25000}

    p0 = build_vroom_payload(
        points=pts,
        vehicles=[_arac(id=1, start_lat=36.98, start_lng=35.32, fixed_cost=0)],
    )
    assert "costs" not in p0["vehicles"][0]


@pytest.mark.parametrize(
    "n,arac_sayisi,max_stops,beklenen",
    [
        (10, 2, None, 5),    # yalnız denge tavanı: ceil(10/2)
        (10, 2, 3, 3),       # araç tavanı daha sıkı
        (10, 2, 40, 5),      # denge tavanı daha sıkı
        (10, 1, 4, 4),       # tek araç: denge tavanı yok, araç tavanı var
        (10, 1, None, None),  # ikisi de yok → alan yazılmaz
    ],
)
def test_D7_max_tasks_iki_tavanin_kucugudur(n, arac_sayisi, max_stops, beklenen):
    """`max_tasks = min(ceil(n/k), vehicle.max_stops)`.

    İki ayrı kısıt aynı alana yazılır: (a) kuryeler arası **mesai dengesi**
    (`vroom.py:31-56`'daki ölçülmüş gerekçe), (b) aracın kendi **kapasitesi**
    (K-4). Küçüğü bağlayıcıdır; hiçbiri yoksa alan hiç yazılmaz.
    """
    from core.routing.vroom import build_vroom_payload

    araclar = [
        _arac(id=i, start_lat=36.98, start_lng=35.32, max_stops=max_stops)
        for i in range(1, arac_sayisi + 1)
    ]
    p = build_vroom_payload(points=_noktalar(n), vehicles=araclar)
    v = p["vehicles"][0]
    if beklenen is None:
        assert "max_tasks" not in v
    else:
        assert v["max_tasks"] == beklenen
        # Kısıt açlık üretemez: k * max_tasks >= n olmalı (vroom.py gerekçesi).
        if max_stops is None:
            assert arac_sayisi * v["max_tasks"] >= n


def test_D7_araclar_farkli_tavan_tasiyabilir():
    """Heterojen filo: her araç kendi `max_stops`'unu taşır.

    Bugün tek `cap` değeri hesaplanıp TÜM araçlara aynısı yazılıyor
    (`vroom.py:71-77`) — büyük araç daha çok, yedek araç daha az alamıyor.
    """
    from core.routing.vroom import build_vroom_payload

    p = build_vroom_payload(
        points=_noktalar(20),
        vehicles=[
            _arac(id=1, start_lat=36.98, start_lng=35.32, max_stops=15),
            _arac(id=2, start_lat=36.98, start_lng=35.32, max_stops=5),
        ],
    )
    tavanlar = {v["id"]: v["max_tasks"] for v in p["vehicles"]}
    assert tavanlar == {1: 10, 2: 5}, f"heterojen tavan yansımadı: {tavanlar}"


def test_D4_arac_basina_farkli_baslangic_noktasi():
    """Her araç kendi `start`'ını taşır (K-9).

    Bugün tüm araçlara aynı depo sabiti yazılıyor (`vroom.py:74`); depo
    olmadığı için başlangıç noktası veriden gelmeli.
    """
    from core.routing.vroom import build_vroom_payload

    p = build_vroom_payload(
        points=_noktalar(4),
        vehicles=[
            _arac(id=1, start_lat=36.98, start_lng=35.32),
            _arac(id=2, start_lat=37.01, start_lng=35.40),
        ],
    )
    baslangiclar = {v["id"]: v["start"] for v in p["vehicles"]}
    assert baslangiclar == {1: [35.32, 36.98], 2: [35.40, 37.01]}


# ── D-16: bölge kararı ilçe listesine bağlandı (K-10) ─────────────────────────


def test_D16_bolge_karari_ilce_listesine_bagli_yaricap_YOK():
    """`in_delivery_zone` artık koordinat/yarıçap ALMAZ — otorite ilçe listesi.

    Sebep ölçülmüş bir tasarım hatasıdır (K-10): yarıçap **depo
    koordinatından** ölçülüyordu ve aynı değişken hem rota başlangıcı hem
    bölge merkeziydi. Başlangıç gerçek bir yere taşınsa bölge de kayardı.
    """
    import inspect

    from services.delivery_promise import in_delivery_zone

    imza = set(inspect.signature(in_delivery_zone).parameters)
    for yasak in ("lat", "lng", "depot_lat", "depot_lng", "radius_km"):
        assert yasak not in imza, (
            f"in_delivery_zone hâlâ `{yasak}` alıyor — bölge merkezle bağlı"
        )
    assert "districts" in imza


@pytest.mark.parametrize(
    "city,district,beklenen",
    [
        ("Adana", "Seyhan", True),
        ("Adana", "SARIÇAM", True),      # aksan/büyük-küçük duyarsız
        ("Adana", "Yüreğir", True),
        ("Adana", "Ceyhan", False),      # kent merkezi dışı → dış kargo
        ("Mersin", "Seyhan", False),     # başka il
        ("Adana", None, False),          # ilçe yok → GÜVENLİ TARAF
        (None, "Seyhan", False),         # il yok → GÜVENLİ TARAF
    ],
)
def test_D16_ilce_listesi_otorite_bilinmeyen_bolge_DISI(city, district, beklenen):
    """İlçe bilgisi yoksa sonuç **bölge dışıdır** — yanlış söz vermektense
    dış kargo kuyruğuna düşsün (K-10)."""
    from services.delivery_promise import in_delivery_zone

    assert in_delivery_zone(
        city, district, districts=["Seyhan", "Yüreğir", "Çukurova", "Sarıçam"]
    ) is beklenen


def test_D16_NOBETCI_ilce_listesi_gercekten_okunuyor():
    """Doluluk nöbetçisi: fonksiyon listeyi gerçekten kullanıyor.

    Bu olmadan "Ceyhan → False" iddiası, fonksiyon HER ZAMAN False dönse de
    geçerdi.
    """
    from services.delivery_promise import in_delivery_zone

    assert in_delivery_zone("Adana", "Ceyhan", districts=["Ceyhan"]) is True
