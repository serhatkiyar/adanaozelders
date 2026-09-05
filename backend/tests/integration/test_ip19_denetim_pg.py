"""İP-19 bağımsız denetim düzeltmeleri — GERÇEK Postgres + gerçek HTTP.

Bağımsız denetim (15 Ağu 2026) raporunun davranış düğümleri. **Üretim kodundan
ÖNCE yazıldı** (kök CLAUDE.md §E). Bu dosya bilinçli olarak VROOM/OSRM
GEREKTİRMEZ — B-1'in gizlenme mekanizması tam olarak buydu: filo davranışının
tek nöbetçisi rota servisi ayakta olmayan CI'da atlanıyordu.

Düğümler
--------
B2-a  Seed filoda (max_stops NULL) günün yükü ikinci araca da taşar.
B2-b  Doluluk: tavan altındaki gün gereksiz bölünmez (K-3 ekonomisi durur).
B2-c  Günlük tavan ile plana giren kapasite ayrışamaz.
B5    `PATCH /runs/{id}` yalnız `vehicle_id` ile kurye atamasını SİLMEZ.
B6    Metrik değerleri elle hesaplanmış fixture ile birebir doğrulanır.
B3    İlçesiz adres kaydedilemez (bölge sınıfı sessizce kaybolmasın).
"""
from __future__ import annotations

import datetime
import uuid

import pytest
from sqlalchemy import text

from core.config import settings
from core.database import AsyncSessionLocal
from services import delivery_service
from tests.integration.auth_headers import bearer_headers
from tests.integration.dispatch_yardim import (
    BazNoktasi,
    DispatchFactory,
    EligibleParking,
    SeedFilosu,
    gelecek_gun,
)
from tests.integration.test_ip19_filo_pg import FiloFabrikasi

pytestmark = pytest.mark.asyncio


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


@pytest.fixture
async def filo(pg):
    f = FiloFabrikasi()
    try:
        yield f
    finally:
        await f.temizle()


@pytest.fixture
async def df(pg):
    f = DispatchFactory()
    try:
        yield f
    finally:
        await f.cleanup()


@pytest.fixture(autouse=True)
async def izole_kuyruk(pg):
    """Her dispatch testi, dev DB'de başka uygun sipariş yokmuş gibi koşar."""
    parking = EligibleParking()
    await parking.park()
    try:
        yield parking
    finally:
        await parking.release()


@pytest.fixture(autouse=True)
def _clean_breaker():
    from core import routing

    routing.reset_state()
    yield
    routing.reset_state()


@pytest.fixture
def vroom_kapali(monkeypatch):
    """Rota servisi yokken (CI'ın gerçek durumu) fallback yolu ölçülür."""
    monkeypatch.setattr(settings, "VROOM_URL", "http://127.0.0.1:59999")


@pytest.fixture
async def seed_filo(pg):
    """Aktif filo = migration'ın seed'lediği iki araç (dev artıklarından izole)."""
    baz = BazNoktasi()
    await baz.kur()
    f = SeedFilosu()
    await f.daralt()
    try:
        yield f
    finally:
        await f.geri_al()
        await baz.kaldir()


# ── B-2: seed filoda tavan gerçekten uygulanıyor mu ───────────────────────────
#
# 🔴 Denetim bulgusu B-2 (merge kapısı). Migration LADA/COROLLA'yı `max_stops`
# NULL seed'ler. `_route_vehicle` NULL'ı olduğu gibi rota katmanına verdiği için
# haversine'de `tavanlar` boş kalıyor ve `aktif = vehicles[:1]` — yani ikinci
# araç HİÇ sahaya çıkmıyor. Aynı anda `gunluk_tavan` iki aracı sayarak 2×40=80
# söz veriyor. Ölçülen (denetim, gerçek VROOM): 20 sipariş → {araç1: 20},
# 40 sipariş → {araç1: 40}. Yani üretim varsayılanı = regresyon durumu.
#
# Bu testin fixture'ı seed filoyu OLDUĞU GİBİ kullanır: `max_stops`'a elle
# değer YAZMAZ (mevcut `test_dispatch_kapasiteyi_asan_gun_ikinci_araca_tasar`
# tam olarak bunu yapıyor ve bu yüzden bulguyu göremiyor).


async def test_B2a_seed_filoda_tavani_asan_gun_ikinci_araca_tasar(
    df, seed_filo, monkeypatch, vroom_kapali
):
    """Seed filo (max_stops NULL) + tavanı aşan gün → yük bölünür."""
    monkeypatch.setattr(settings, "DELIVERY_MAX_STOPS_PER_RUN", 5)
    gun = gelecek_gun()
    order_ids = await df.orders(8)

    async with AsyncSessionLocal() as s:
        runs = await delivery_service.dispatch_day(s, gun)
    df.run_ids.extend(r.id for r in runs)

    boyutlar = sorted(len(r.stops) for r in runs)
    assert len(runs) == 2, f"tek araca yüklendi: {boyutlar}"
    assert max(boyutlar) <= 5, f"araç başına tavan aşıldı: {boyutlar}"
    assert sum(boyutlar) == 8, "sipariş kaybı/tekrarı"
    assert {st.order_id for r in runs for st in r.stops} == set(order_ids)


async def test_B2b_tavan_altindaki_gun_gereksiz_bolunmez(
    df, seed_filo, monkeypatch, vroom_kapali
):
    """DOLULUK NÖBETÇİSİ: düzeltme "her günü böl"e dönüşmemeli.

    K-3 ekonomisi bu: yedek araç ancak gerekince çıkar. Bu düğüm olmasa
    B2-a'yı "her zaman iki araç kullan" diye geçirmek mümkün olurdu.
    """
    monkeypatch.setattr(settings, "DELIVERY_MAX_STOPS_PER_RUN", 5)
    gun = gelecek_gun()
    await df.orders(4)

    async with AsyncSessionLocal() as s:
        runs = await delivery_service.dispatch_day(s, gun)
    df.run_ids.extend(r.id for r in runs)

    assert len(runs) == 1, f"4 durak tek araca sığmalıydı: {[len(r.stops) for r in runs]}"


async def test_B2c_gunluk_tavan_plana_giren_kapasiteyle_AYNI_sayidir(
    df, seed_filo, monkeypatch, vroom_kapali
):
    """Tavan ile fiili kapasite ayrışamaz — §0.2 tuzağının asıl ölçümü.

    Eski hâlde tavan (2×5=10) plana giren kapasiteden (1×sınırsız) farklıydı;
    fark "10 siparişe söz ver, hepsini tek araca yükle" demekti. İddia: tavan
    kadar sipariş planlanır VE hiçbir araç kendi tavanını aşmaz.
    """
    monkeypatch.setattr(settings, "DELIVERY_MAX_STOPS_PER_RUN", 5)
    gun = gelecek_gun()
    order_ids = await df.orders(13)

    tavan = await delivery_service.gunluk_tavan(None)
    async with AsyncSessionLocal() as s:
        runs = await delivery_service.dispatch_day(s, gun)
    df.run_ids.extend(r.id for r in runs)

    planlanan = {st.order_id for r in runs for st in r.stops} & set(order_ids)
    assert len(planlanan) == tavan == 10, (
        f"tavan {tavan}, planlanan {len(planlanan)} — ikisi aynı sayı olmalı"
    )
    assert all(len(r.stops) <= 5 for r in runs), (
        f"araç başına tavan aşıldı: {[len(r.stops) for r in runs]}"
    )

    async with AsyncSessionLocal() as s:
        kalan = {o.order_id for o in await delivery_service.eligible_orders(s)}
    assert set(order_ids) - planlanan <= kalan, "plana girmeyen sipariş kayboldu"


# ── B-5: tur güncellemesi kurye atamasını sessizce silmemeli ──────────────────


async def test_B5_arac_degistirmek_kuryeyi_silmez(filo, http):
    """🔴 `update_run` `run.courier_id = payload.courier_id` satırını KOŞULSUZ
    çalıştırıyor: gövdede `courier_id` hiç gönderilmese bile `None` yazılıyor.
    Sözleşme bu ucu "tur meta güncellemesi (kurye VE/VEYA araç)" diye ilan
    ediyor — aracı değiştiren ilk ekran kurye atamalarını sessizce silecek."""
    _, hdr = await filo.admin("delivery.view", "delivery.manage")
    v1 = await filo.arac()
    v2 = await filo.arac()

    async with AsyncSessionLocal() as s:
        courier_id = (
            await s.execute(
                text(
                    "INSERT INTO couriers (name, is_active) "
                    "VALUES (:n, true) RETURNING id"
                ),
                {"n": f"Denetim Kurye {_uniq()}"},
            )
        ).scalar_one()
        run_id = (
            await s.execute(
                text(
                    "INSERT INTO delivery_runs (run_date, vehicle_id, courier_id, status)"
                    " VALUES (:d, :v, :c, 'PLANNED') RETURNING id"
                ),
                {"d": gelecek_gun(), "v": v1, "c": courier_id},
            )
        ).scalar_one()
        await s.commit()
    filo.run_ids.append(run_id)

    try:
        r = await http.patch(
            f"/api/v1/delivery/runs/{run_id}",
            json={"vehicle_id": v2},
            headers=hdr,
        )
        assert r.status_code == 200, r.text
        assert (r.json().get("courier") or {}).get("id") == courier_id, (
            "araç değiştirilince kurye ataması silindi"
        )

        # DOLULUK NÖBETÇİSİ: açıkça `null` gönderen çağrı kuryeyi ÇÖZEBİLMELİ.
        r2 = await http.patch(
            f"/api/v1/delivery/runs/{run_id}",
            json={"courier_id": None},
            headers=hdr,
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["courier"] is None, "kurye ataması kaldırılamıyor"
    finally:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("DELETE FROM delivery_runs WHERE id = :r"), {"r": run_id}
            )
            await s.execute(
                text("DELETE FROM couriers WHERE id = :c"), {"c": courier_id}
            )
            await s.commit()


# ── B-6/B-7: metrik DEĞERLERİ ─────────────────────────────────────────────────
#
# 🔴 Sözleşme §5 D-14 "beş metrik uçtan doğru hesaplanır (bilinen fixture
# üzerinde elle doğrulanmış değerler)" diyor; mevcut test BOŞ tarih aralığında
# yalnız anahtarların varlığına bakıyor (tüm değerler None/{}). Boşluk iki
# gerçek hatayı örtmüş:
#   1. `toplam_km` her turu sayıyor — optimize edilip HİÇ BAŞLAMAMIŞ (ya da
#      iptal edilmiş) turun kilometresi teslimatsız biçimde paydaya giriyor.
#   2. `planned` CANCELLED durakları sayıyor — oysa model docstring'i onları
#      açıkça "kurye performansına SAYILMAZ" diye tanımlıyor.


async def test_B6_metrikler_elle_hesaplanmis_degerlerle_birebir(filo, df, http):
    """Bilinen fixture → her metriğin beklenen değeri elle hesaplanmıştır.

    Tur A (DONE, 4 saat, 40 km): 2 DELIVERED + 1 FAILED(EVDE_YOK) + 1 CANCELLED
    Tur B (CANCELLED, hiç başlamadı, duraksız): 20 km

        delivered          = 2
        planned            = 3   (CANCELLED durak sayılmaz)
        km_per_delivery    = 40/2 = 20.0   (B turunun 20 km'si sayılmaz)
        stops_per_hour     = 2/4  = 0.5
        on_time_rate       = 1/2  = 0.5
        first_attempt_rate = 1/2  = 0.5
        fail_reasons       = {"EVDE_YOK": 1}
    """
    _, hdr = await filo.admin("delivery.view")
    v1 = await filo.arac()
    v2 = await filo.arac()
    gun = gelecek_gun() + datetime.timedelta(days=7)
    order_ids = await df.orders(4)

    async with AsyncSessionLocal() as s:
        # Sipariş kurgusu: ilk teslim zamanında + ilk denemede, ikinci teslim
        # geç + ikinci denemede.
        await s.execute(
            text(
                "UPDATE orders SET promised_delivery_date = :d, "
                "failed_delivery_count = 0 WHERE id = :o"
            ),
            {"d": gun, "o": order_ids[0]},
        )
        await s.execute(
            text(
                "UPDATE orders SET promised_delivery_date = :d, "
                "failed_delivery_count = 1 WHERE id = :o"
            ),
            {"d": gun - datetime.timedelta(days=1), "o": order_ids[1]},
        )
        basla = datetime.datetime.now(datetime.timezone.utc)
        run_a = (
            await s.execute(
                text(
                    "INSERT INTO delivery_runs (run_date, vehicle_id, status, "
                    "started_at, completed_at, total_distance_km) "
                    "VALUES (:d, :v, 'DONE', :b, :s, 40) RETURNING id"
                ),
                {
                    "d": gun,
                    "v": v1,
                    "b": basla,
                    "s": basla + datetime.timedelta(hours=4),
                },
            )
        ).scalar_one()
        run_b = (
            await s.execute(
                text(
                    "INSERT INTO delivery_runs (run_date, vehicle_id, status, "
                    "total_distance_km) VALUES (:d, :v, 'CANCELLED', 20) RETURNING id"
                ),
                {"d": gun, "v": v2},
            )
        ).scalar_one()
        durumlar = [
            (order_ids[0], "DELIVERED", None),
            (order_ids[1], "DELIVERED", None),
            (order_ids[2], "FAILED", "EVDE_YOK"),
            (order_ids[3], "CANCELLED", None),
        ]
        for i, (oid, durum, sebep) in enumerate(durumlar, start=1):
            await s.execute(
                text(
                    "INSERT INTO delivery_stops (run_id, order_id, sequence, "
                    "status, qr_token, fail_reason) "
                    "VALUES (:r, :o, :seq, :st, :tok, :fr)"
                ),
                {
                    "r": run_a, "o": oid, "seq": i, "st": durum,
                    "tok": f"denetim-{_uniq()}", "fr": sebep,
                },
            )
        await s.commit()
    df.run_ids.extend([run_a, run_b])

    r = await http.get(
        f"/api/v1/delivery/metrics?from_date={gun.isoformat()}&to_date={gun.isoformat()}",
        headers=hdr,
    )
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["delivered"] == 2
    assert m["planned"] == 3, "iptal edilen durak kurye performansına sayıldı"
    assert m["km_per_delivery"] == 20.0, (
        "hiç başlamamış/iptal turun kilometresi paydaya karıştı"
    )
    assert m["stops_per_hour"] == 0.5
    assert m["on_time_rate"] == 0.5
    assert m["first_attempt_rate"] == 0.5
    assert m["fail_reasons"] == {"EVDE_YOK": 1}


# ── B-3: ilçesiz adres ────────────────────────────────────────────────────────


async def test_B3_ilcesiz_adres_kaydedilemez(pg, http):
    """🔴 K-10 ile bölge otoritesi ilçe listesi oldu, ama adres şeması ilçeyi
    hâlâ opsiyonel bırakıyor. Pin'ini işaretlemiş ama ilçesini yazmamış müşteri
    sessizce "bölge dışı" oluyor ve düşeceği dış kargo kuyruğu henüz yok."""
    from models.client import Client

    u = _uniq()
    async with AsyncSessionLocal() as s:
        c = Client(
            email=f"adres-{u}@denetim.test", hashed_password="x",
            first_name="Adres", last_name="Denetim", role_id=3,
        )
        s.add(c)
        await s.flush()
        cid = c.id
        await s.commit()

    try:
        hdr = await bearer_headers(cid, role="CLIENT", role_id=3)
        govde = {
            "title": "Ev",
            "address_line": "Test Mah. 1. Sok. No 1",
            "city": "Adana",
            "location_lat": 37.0025,
            "location_lng": 35.3210,
        }
        r = await http.post("/api/v1/me/addresses", json=govde, headers=hdr)
        assert r.status_code == 422, (
            f"ilçesiz adres kabul edildi ({r.status_code}) — sipariş sessizce "
            "bölge dışı olur"
        )

        # DOLULUK NÖBETÇİSİ: ilçe verilince kayıt geçmeli.
        r2 = await http.post(
            "/api/v1/me/addresses",
            json={**govde, "district": "Seyhan"},
            headers=hdr,
        )
        assert r2.status_code == 201, r2.text
    finally:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("DELETE FROM client_addresses WHERE client_id = :c"), {"c": cid}
            )
            await s.execute(text("DELETE FROM clients WHERE id = :c"), {"c": cid})
            await s.commit()


# ── B-10: filo yazma uçları gerçekten limitleniyor mu ─────────────────────────


async def test_B10_filo_yazma_ucu_kullanici_bazli_limitlenir(filo, http, monkeypatch):
    """🔴 Sözleşme §3.4 "yazma uçları `user_rate_limit` ile kapılanır" diyordu;
    denetim 30 ardışık POST'un 30'unun da 201 döndüğünü ölçtü — kodda limiter
    hiç yoktu. Bu düğüm anlatılanı DAVRANIŞLA ölçer: limit aşılınca 429.

    Limit kötü niyete karşı değil (uç zaten ADMIN + `delivery.manage`);
    döngüye girmiş bir panel/betiğin filoyu boğmasına karşıdır.
    """
    from core import ratelimit
    from core.config import settings as _s

    # `core.ratelimit._client` MODÜL DÜZEYİNDE bir singleton'dır ve ilk
    # yaratıldığı event loop'a bağlanır. pytest-asyncio her teste yeni loop
    # kurduğu için, suite içinde önceki loop'tan kalmış istemci hata verir ve
    # `enforce` FAIL-OPEN'a düşer — yani limiter testi tek başına yeşil,
    # suite içinde SESSİZCE etkisiz olur. (Üretimde tek uzun ömürlü loop
    # olduğu için sorun değil; ama bu, depodaki her rate-limit testinin
    # yalancı yeşil olabileceği anlamına gelir — teknik borca yazıldı.)
    monkeypatch.setattr(ratelimit, "_client", None)

    _, hdr = await filo.admin("delivery.view", "delivery.manage")
    vid = await filo.arac()

    kodlar = []
    for i in range(_s.RATE_LIMIT_FLEET + 1):
        r = await http.patch(
            f"/api/v1/delivery/vehicles/{vid}",
            json={"label": f"Tur {i}"},
            headers=hdr,
        )
        kodlar.append(r.status_code)
        if r.status_code == 429:
            break

    assert kodlar[0] == 200, f"ilk çağrı geçmeliydi: {kodlar[0]}"
    assert 429 in kodlar, (
        f"{len(kodlar)} ardışık yazmada limit devreye girmedi: {set(kodlar)}"
    )


# ── B-9 / B-14 · matristen SONRA eklendi (dürüst kayıt) ───────────────────────
#
# Bu iki düğüm kırmızı matriste yoktu: düzeltmeler sırasında B-9'un (nokta
# düzenlenemiyor) ve B-14'ün (pasifleştirme açık tur kapısını atlıyor) kapatma
# biçimi belirlenince yazıldılar. Yeni davranışın nöbetçisidirler.


async def test_B9_baslangic_noktasi_deploysuz_duzeltilebilir(filo, http):
    """K-9'un gerekçesi ("nokta VERİDİR, deploy'suz düzenlenir") uç yalnız
    GET+POST taşıdığı sürece karşılanmıyordu. Koordinat, müşteriye gösterilen
    varış penceresinin de başlangıcıdır — yanlışı sessizce yaşayamaz."""
    _, hdr = await filo.admin("delivery.view", "delivery.manage")
    pid = await filo.baslangic_noktasi(lat=36.9855, lng=35.3253)

    r = await http.patch(
        f"/api/v1/delivery/pickup-points/{pid}",
        json={"lat": 37.0025, "lng": 35.3210, "name": "Gerçek Depo"},
        headers=hdr,
    )
    assert r.status_code == 200, r.text
    assert r.json()["lat"] == 37.0025 and r.json()["name"] == "Gerçek Depo"

    # Kalıcı mı — yanıt nesnesi değil, DB gerçeği.
    async with AsyncSessionLocal() as s:
        lat = (
            await s.execute(
                text("SELECT lat FROM pickup_points WHERE id = :i"), {"i": pid}
            )
        ).scalar_one()
    assert float(lat) == 37.0025

    assert (
        await http.patch(
            "/api/v1/delivery/pickup-points/99999999",
            json={"name": "Yok"},
            headers=hdr,
        )
    ).status_code == 404
    _, yetkisiz = await filo.admin("delivery.view")
    assert (
        await http.patch(
            f"/api/v1/delivery/pickup-points/{pid}", json={"name": "X"}, headers=yetkisiz
        )
    ).status_code == 403


async def test_B14_acik_turu_olan_arac_PASIFLESTIRILEMEZ(filo, http):
    """Pasifleştirme silmenin yumuşak hâlidir; kapı ikisinde de aynı olmalı."""
    _, hdr = await filo.admin("delivery.view", "delivery.manage")
    vid = await filo.arac()
    async with AsyncSessionLocal() as s:
        run_id = (
            await s.execute(
                text(
                    "INSERT INTO delivery_runs (run_date, vehicle_id, status) "
                    "VALUES (:d, :v, 'PLANNED') RETURNING id"
                ),
                {"d": gelecek_gun() + datetime.timedelta(days=3), "v": vid},
            )
        ).scalar_one()
        await s.commit()
    filo.run_ids.append(run_id)

    r = await http.patch(
        f"/api/v1/delivery/vehicles/{vid}", json={"is_active": False}, headers=hdr
    )
    assert r.status_code == 409, f"açık turu olan araç pasifleştirildi: {r.status_code}"

    # DOLULUK NÖBETÇİSİ: kapı yalnız PASİFLEŞTİRMEYE bakar, etiket düzenlemeye değil.
    r2 = await http.patch(
        f"/api/v1/delivery/vehicles/{vid}", json={"label": "Yeni Etiket"}, headers=hdr
    )
    assert r2.status_code == 200, r2.text
