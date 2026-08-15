"""Günü Optimize Et — GERÇEK Postgres + GERÇEK VROOM/OSRM ile uçtan uca.

Buradaki soru "servis fonksiyonu doğru mu" değil, **zincir doğru mu**: ödenmiş
sipariş → uygunluk kuyruğu → araçlara bölüşüm → tur + durak sırası → ETA +
polyline + sapma. Sahte çözücüyle bu zincirin koordinat sırası, id eşlemesi ve
ETA'nın gerçek sürüş süresine dayanıp dayanmadığı GÖRÜNMEZ.

Gerekenler: compose Postgres + `--profile routing` (osrm, vroom). İkisinden biri
yoksa testler FAIL değil SKIP olur.
"""
from __future__ import annotations

import asyncio
import datetime

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.config import settings
from core.database import AsyncSessionLocal
from schemas.delivery import DeliveryRunCreate
from tests.integration.filo_yardim import arac_id
from services import delivery_service

# İP-19: depo ayarı kalktı (K-9). Bu, testin VROOM canlılık yoklaması ve
# sipariş üretimi için kullandığı Adana-içi bir çapa noktasıdır; migration
# seed'inin BASE noktasıyla aynı koordinat (OSRM verisi Adana bbox'ı).
DEPOT = (36.9855, 35.3253)

# Teslimat noktaları, sipariş fabrikası ve "yabancı uygun siparişi park"
# düzeneği ortak modüldedir: aynı düzenek VROOM'suz koşan
# `test_ip19_denetim_pg.py` tarafından da kullanılır (kopyalanan iki
# fixture'ın ayrışması bu paketin düzeltmeye çalıştığı hata sınıfı).
from tests.integration.dispatch_yardim import (  # noqa: E402
    DispatchFactory,
    EligibleParking as _EligibleParking,
)


def _vroom_up() -> bool:
    try:
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



@pytest.fixture(autouse=True)
async def izole_kuyruk(pg):
    """Her dispatch testi, dev DB'de başka uygun sipariş olmasa gibi koşar."""
    parking = _EligibleParking()
    await parking.park()
    yield parking
    await parking.release()


@pytest.fixture
async def df(pg):
    f = DispatchFactory()
    yield f
    await f.cleanup()


@pytest.fixture(autouse=True)
async def _seed_filosu(pg):
    """Aktif filo = migration seed'i (LADA + COROLLA).

    `dispatch_day` filo-KÜRESELDİR: aktif araç listesini veritabanından okur.
    Bu dosyanın "6 durak tek araca sığmalı" gibi iddiaları, dev/test DB'sine
    elle eklenmiş her araçla sessizce kırılır — nitekim tarayıcı kabul turundan
    kalan iki araç (DOBLO/KANGOO) üç testi düşürdü. Fixture hiçbir aracı
    silmez, yalnız test süresince pasifleştirir.
    """
    from tests.integration.dispatch_yardim import SeedFilosu

    f = SeedFilosu()
    await f.daralt()
    try:
        yield f
    finally:
        await f.geri_al()


@pytest.fixture(autouse=True)
def _clean_breaker():
    from core import routing

    routing.reset_state()
    yield
    routing.reset_state()


def _future_date() -> datetime.date:
    """Yarın: mevcut PLANNED turlarla (varsa gerçek veri) çakışmasın."""
    return datetime.date.today() + datetime.timedelta(days=400)


async def test_dispatch_gercek_yol_agiyla_tur_kurar(df):
    """Zincirin tamamı: uygun sipariş → tur → optimize sıra + ETA + polyline."""
    order_ids = await df.orders(6)
    async with AsyncSessionLocal() as s:
        runs = await delivery_service.dispatch_day(s, _future_date())
    df.run_ids.extend(r.id for r in runs)

    assert len(runs) == 1, "6 durak tek araca sığmalı"
    run = runs[0]
    assert run.optimize_provider == "vroom", "gerçek yol ağı kullanılmadı"
    assert run.total_distance_km and run.total_distance_km > 0
    assert run.route_geometry, "panel haritası için polyline gerekli"

    planlanan = {s.order_id for s in run.stops}
    assert planlanan == set(order_ids), "sipariş kaybı/fazlası var"

    # Durak sırası 1..N kesintisiz; ETA'lar sırayla ileri gitmeli.
    sirali = sorted(run.stops, key=lambda s: s.sequence)
    assert [s.sequence for s in sirali] == list(range(1, len(sirali) + 1))
    etalar = [s.eta for s in sirali]
    assert all(e is not None for e in etalar)
    assert etalar == sorted(etalar), "ETA'lar rota sırasıyla artmıyor"
    simdi = datetime.datetime.now(datetime.timezone.utc)
    assert etalar[0] > simdi, "ilk durağın ETA'sı geçmişte"
    # 6 duraklık Adana içi tur makul bir sürede biter (servis süreleri dahil).
    assert (etalar[-1] - simdi) < datetime.timedelta(hours=6)

    # Sapma her durak için hesaplanmış olmalı (rotayı bozan durak işareti).
    assert all(s.detour_km is not None for s in sirali)


async def test_add_stops_ayni_session_da_taze_okunur(df):
    """REGRESYON (sessiz bozulma): session ``expire_on_commit=False`` ile kurulur,
    bu yüzden commit sonrası kimlik haritasındaki `run.stops` koleksiyonu eski
    kalır ve ``selectinload`` zaten yüklenmiş bir koleksiyonu YENİDEN doldurmaz.
    Bunun sonucu, hata vermeyen bir felaketti: `add_stops` durakları DB'ye
    yazıyor, aynı session'da geri okuyan `optimize_run` turu BOŞ görüyor ve
    "Günü Optimize Et" hiçbir turu optimize etmeden başarıyla dönüyordu
    (ETA yok, polyline yok, sapma yok — panelde sorun görünmüyor).

    Bu testin özü, `add_stops` sonrası aynı session'dan okunan durakların DB'deki
    satırlarla eşleşmesidir; VROOM'a hiç ihtiyaç duymaz."""
    order_ids = await df.orders(3)
    async with AsyncSessionLocal() as s:
        run = await delivery_service.create_run(
            s,
            DeliveryRunCreate(
                run_date=_future_date(),
                vehicle_id=await arac_id(),
            ),
        )
        df.run_ids.append(run.id)
        out = await delivery_service.add_stops(s, run.id, order_ids)
        # Aynı session'dan yanıt: eklenen duraklar GÖRÜNMELİ.
        assert {st.order_id for st in out.stops} == set(order_ids)
        # ...ve DB gerçeğiyle birebir örtüşmeli.
        db_ids = set(
            (
                await s.execute(
                    text("SELECT order_id FROM delivery_stops WHERE run_id = :r"),
                    {"r": run.id},
                )
            )
            .scalars()
            .all()
        )
        assert db_ids == set(order_ids)
        # Ve aynı session'daki bir sonraki okuma da taze olmalı (optimize yolu).
        yeniden = await delivery_service.get_run(s, run.id)
        assert len(yeniden.stops) == 3


async def test_dispatch_kapasiteyi_asan_gun_ikinci_araca_tasar(df):
    """Birincil aracın `max_stops`'unu aşan gün, yük ikinci araca taşmalı.

    İP-19 güncellemesi (sözleşme §6.1): eski test
    `DELIVERY_SINGLE_VEHICLE_MAX_STOPS` eşiğini ve `ceil(n/2)` denge tavanını
    ölçüyordu — ikisi de kalktı. Yeni modelde COROLLA `fixed_cost` taşır
    (seed 1800) ve maliyetli filoda denge tavanı bilinçli olarak YAZILMAZ
    (K-3 çelişkisi, `vroom.py` docstring'i). Bölünmeyi artık ölçülebilir
    biçimde zorlayan şey KAPASİTEDİR: LADA'ya `max_stops` verilir, n onu
    aşar, VROOM taşan kısmı fixed maliyeti ödeyip COROLLA'ya atar.
    Ölçülen: iki araç da sahada, kimse kapasitesini aşmıyor, sipariş kaybı
    yok — "dengeli bölüşüm" değil "kapasite gerçeği" iddiası.
    """
    from tests.integration.filo_yardim import arac_id as _aid

    lada = await _aid()
    n = 11
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE vehicles SET max_stops = 8 WHERE id = :i"), {"i": lada}
        )
        await s.commit()
    try:
        order_ids = await df.orders(n)
        async with AsyncSessionLocal() as s:
            runs = await delivery_service.dispatch_day(s, _future_date())
        df.run_ids.extend(r.id for r in runs)

        # `vehicle` alanı artık ETİKETTİR (İP-19).
        assert {r.vehicle for r in runs} == {"Lada", "Corolla"}
        boyutlar = {r.vehicle: len(r.stops) for r in runs}
        assert sum(boyutlar.values()) == n
        assert boyutlar["Lada"] <= 8, f"kapasite aşıldı: {boyutlar}"
        hepsi = {s.order_id for r in runs for s in r.stops}
        assert hepsi == set(order_ids)
        assert all(
            r.optimize_provider == "vroom" for r in runs if len(r.stops) >= 2
        )
    finally:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("UPDATE vehicles SET max_stops = NULL WHERE id = :i"),
                {"i": lada},
            )
            await s.commit()


async def test_gunluk_tavan_asilan_siparisler_kuyrukta_kalir(df, monkeypatch):
    """Biriken söz borcu tek günde bitirilemeyecek tur kurmamalı: tavanı aşan
    siparişler PLANA GİRMEZ ama uygunluk kuyruğunda görünmeye devam eder."""
    monkeypatch.setattr(settings, "DELIVERY_MAX_STOPS_PER_RUN", 2)
    order_ids = await df.orders(6)
    # İP-19: tavan artık plana giren araçların toplamıdır (max_stops NULL →
    # DELIVERY_MAX_STOPS_PER_RUN başına düşer). Seed'li iki araçla 2+2=4.
    tavan = await delivery_service.gunluk_tavan(None)
    async with AsyncSessionLocal() as s:
        runs = await delivery_service.dispatch_day(s, _future_date())
    df.run_ids.extend(r.id for r in runs)

    planlanan = {st.order_id for r in runs for st in r.stops}
    bizimkiler = planlanan & set(order_ids)
    assert len(bizimkiler) <= tavan

    async with AsyncSessionLocal() as s:
        kalan = {o.order_id for o in await delivery_service.eligible_orders(s)}
    assert set(order_ids) - bizimkiler <= kalan, "plana girmeyen sipariş kayboldu"


async def test_vroom_kapaliyken_dispatch_yine_de_tur_kurar(df, monkeypatch):
    """Dayanıklılık: rota servisi çökse bile gün planlanabilmeli (yaklaşık sırayla)
    — teslimat operasyonu VROOM'a bağımlı hale gelmemeli."""
    monkeypatch.setattr(settings, "VROOM_URL", "http://127.0.0.1:59999")
    order_ids = await df.orders(5)
    async with AsyncSessionLocal() as s:
        runs = await delivery_service.dispatch_day(s, _future_date())
    df.run_ids.extend(r.id for r in runs)

    assert runs and runs[0].optimize_provider == "haversine"
    assert {st.order_id for r in runs for st in r.stops} == set(order_ids)
    assert runs[0].route_geometry is None  # kuş uçuşunda polyline yok
    assert all(st.eta is not None for st in runs[0].stops)


async def test_ayni_gun_eszamanli_iki_kez_optimize_edilirse_tutarli_kalir(df):
    """İki admin "Günü Optimize Et"e aynı anda basarsa: tek tur, çift durak yok.

    Servis katmanındaki find-or-create kontrolü yarışı KAZANMAZ; son sözü kısmi
    unique index'ler söyler (`uq_delivery_run_planned` gün+araç başına tek planlı
    tur, `uq_delivery_stop_open` sipariş başına tek açık durak). Bu test o
    invariant'ların gerçek eşzamanlılıkta tuttuğunu doğrular — iki ayrı session,
    iki ayrı transaction."""
    order_ids = await df.orders(8)
    gun = _future_date()

    async def _dispatch():
        async with AsyncSessionLocal() as s:
            try:
                return await delivery_service.dispatch_day(s, gun)
            except HTTPException as exc:
                return exc

    sonuclar = await asyncio.gather(_dispatch(), _dispatch())
    for sonuc in sonuclar:
        if isinstance(sonuc, list):
            df.run_ids.extend(r.id for r in sonuc)

    async with AsyncSessionLocal() as s:
        turlar = (
            await s.execute(
                text("SELECT id FROM delivery_runs WHERE run_date = :d"), {"d": gun}
            )
        ).scalars().all()
        df.run_ids.extend(turlar)
        cift = (
            await s.execute(
                text(
                    "SELECT order_id FROM delivery_stops WHERE order_id = ANY(:o) "
                    "GROUP BY order_id HAVING count(*) > 1"
                ),
                {"o": order_ids},
            )
        ).scalars().all()
        toplam = (
            await s.execute(
                text("SELECT count(*) FROM delivery_stops WHERE order_id = ANY(:o)"),
                {"o": order_ids},
            )
        ).scalar()

    assert not cift, f"aynı sipariş birden çok durağa yazıldı: {cift}"
    assert len(turlar) == 1, f"gün+araç başına tek tur olmalı, {len(turlar)} var"
    assert toplam == len(order_ids), "durak sayısı sipariş sayısıyla eşleşmiyor"


async def test_ikinci_dispatch_ayni_siparisleri_tekrar_planlamaz(df):
    """Idempotency: zaten açık durağı olan sipariş uygunluk kuyruğunda DEĞİLDİR,
    yeniden planlanmaz. Yeni sipariş geldiyse yalnız o eklenir."""
    ilk_grup = await df.orders(4)
    gun = _future_date()
    async with AsyncSessionLocal() as s:
        runs = await delivery_service.dispatch_day(s, gun)
    df.run_ids.extend(r.id for r in runs)
    assert sum(len(r.stops) for r in runs) == 4

    # Yeni sipariş yokken: planlanacak bir şey kalmadı (çift planlama yok).
    async with AsyncSessionLocal() as s:
        with pytest.raises(HTTPException) as exc:
            await delivery_service.dispatch_day(s, gun)
    assert exc.value.status_code == 400

    # Yeni sipariş geldiğinde yalnız O eklenir (eskiler tekrarlanmaz).
    yeni = await df.orders(2)
    async with AsyncSessionLocal() as s:
        runs2 = await delivery_service.dispatch_day(s, gun)
    df.run_ids.extend(r.id for r in runs2)
    tum_duraklar = [st.order_id for r in runs2 for st in r.stops]
    assert sorted(tum_duraklar) == sorted(ilk_grup + yeni)
    assert len(tum_duraklar) == len(set(tum_duraklar)), "durak tekrarlandı"


async def test_seed_filoda_tavani_asan_gun_GERCEK_vroom_ile_de_bolunur(df, monkeypatch):
    """Bağımsız denetim B-2'nin canlı ikizi.

    `test_ip19_denetim_pg.py::test_B2a_*` aynı iddiayı haversine ile ölçer
    (CI'da koşsun diye). Bu düğüm gerçek çözücüyle ölçer: seed filo `max_stops`
    NULL taşır, o yüzden payload'a `max_tasks` yazılmıyordu ve VROOM sabit
    maliyetli ikinci aracı çıkarmaya hiç zorlanmıyordu — 40 sipariş tek araca
    biniyordu (denetim ölçümü: 20→{1:20}, 40→{1:40}).

    Fixture seed filoyu OLDUĞU GİBİ kullanır: `max_stops`'a elle değer yazmaz.
    """
    monkeypatch.setattr(settings, "DELIVERY_MAX_STOPS_PER_RUN", 5)
    order_ids = await df.orders(8)
    async with AsyncSessionLocal() as s:
        runs = await delivery_service.dispatch_day(s, _future_date())
    df.run_ids.extend(r.id for r in runs)

    boyutlar = sorted(len(r.stops) for r in runs)
    assert len(runs) == 2, f"gerçek VROOM yükü tek araca bindirdi: {boyutlar}"
    assert max(boyutlar) <= 5, f"araç başına tavan aşıldı: {boyutlar}"
    assert {st.order_id for r in runs for st in r.stops} == set(order_ids)
    assert all(r.optimize_provider == "vroom" for r in runs if len(r.stops) >= 2)
