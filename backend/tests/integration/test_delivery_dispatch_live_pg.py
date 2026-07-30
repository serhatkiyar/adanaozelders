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
import uuid
from decimal import Decimal

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.config import settings
from core.database import AsyncSessionLocal
from models.client import Client
from models.store import Order
from schemas.delivery import DeliveryRunCreate
from services import delivery_service
from tests.integration.db_guard import assert_test_database

DEPOT = (settings.DELIVERY_DEPOT_LAT, settings.DELIVERY_DEPOT_LNG)

# Adana merkezde gerçek mahalle ölçeğinde dağılmış teslimat noktaları.
_ADRESLER = [
    (37.0025, 35.3210), (36.9760, 35.3400), (37.0140, 35.3050),
    (36.9900, 35.3600), (37.0300, 35.3300), (36.9650, 35.3100),
    (37.0080, 35.3480), (36.9820, 35.2950), (37.0200, 35.3620),
    (36.9700, 35.3520), (37.0350, 35.3150), (36.9950, 35.2880),
    (37.0120, 35.3700), (36.9600, 35.3350), (37.0260, 35.2980),
]


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


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


class DispatchFactory:
    """Testin kendi siparişleri — teardown'da FİZİKSEL silinir."""

    def __init__(self) -> None:
        self.client_ids: list[int] = []
        self.order_ids: list[int] = []
        self.run_ids: list[int] = []

    async def orders(self, n: int) -> list[int]:
        ids: list[int] = []
        async with AsyncSessionLocal() as s:
            for i in range(n):
                u = _uniq()
                client = Client(
                    email=f"c-{u}@dispatch.test", hashed_password="x",
                    first_name="Dagitim", last_name=f"Musteri{i}",
                    username=f"c{u}", role_id=3,
                )
                s.add(client)
                await s.flush()
                lat, lng = _ADRESLER[i % len(_ADRESLER)]
                order = Order(
                    client_id=client.id, status="PAID", payment_status="PAID",
                    subtotal=Decimal("100.00"), total=Decimal("100.00"),
                    has_physical=True, ship_recipient=f"Dagitim Musteri{i}",
                    ship_address=f"Test adres {i}", ship_in_zone=True,
                    ship_lat=Decimal(str(lat)), ship_lng=Decimal(str(lng)),
                    prepared_at=datetime.datetime.now(datetime.timezone.utc),
                )
                s.add(order)
                await s.flush()
                ids.append(order.id)
                self.client_ids.append(client.id)
                self.order_ids.append(order.id)
            await s.commit()
        return ids

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            params = {
                "ids": self.order_ids or [0],
                "runs": self.run_ids or [0],
                "cids": self.client_ids or [0],
            }
            for q in (
                "DELETE FROM delivery_stops WHERE order_id = ANY(:ids)",
                "DELETE FROM delivery_runs WHERE id = ANY(:runs)",
                "DELETE FROM order_status_history WHERE order_id = ANY(:ids)",
                "DELETE FROM orders WHERE id = ANY(:ids)",
                "DELETE FROM clients WHERE id = ANY(:cids)",
            ):
                await s.execute(text(q), params)
            await s.commit()


# ── Dış veriden izolasyon ────────────────────────────────────────────────────
#
# KÖK NEDEN: `dispatch_day(gun)` tasarımı gereği **sistem genelinde** çalışır —
# `eligible_orders(db)` çağırıp söz günü `gun`'ü geçmeyen TÜM konumlu siparişleri
# planlar. Testler ise "yalnız benim siparişlerim planlanır" varsayıyordu ve
# `planlanan == set(order_ids)` / `sum(boyutlar) == n` gibi GLOBAL eşitlikler
# kuruyordu. Geliştirme veritabanında başka bir uygun sipariş bulunduğu anda
# (ör. elle oluşturulmuş demo siparişleri) bu eşitlikler kırılıyordu.
#
# `_future_date()` yorumu "mevcut PLANNED turlarla çakışmasın" diyor ama tarih
# İZOLASYON SAĞLAMAZ: filtre `promised_delivery_date <= gun` olduğu için ileri
# bir tarih, geçmiş sözlü tüm siparişleri de aday yapar. Yani tarihle izole
# etmek imkânsız.
#
# ÇÖZÜM: veriyi SİLMEK yerine "park etmek". `eligible_orders` açık durağı olan
# siparişleri hariç tutar (sipariş başına tek açık durak kısıtı). Bu yüzden test
# başlarken önceden var olan uygun siparişler geçici bir PLANNED tura durak
# olarak bağlanır; teardown'da o tur ve durakları FİZİKSEL silinir. Hiçbir
# üretim verisi değişmez, sipariş durumlarına dokunulmaz ve test dev DB'nin
# içeriğinden bağımsız hale gelir.


class _EligibleParking:
    """Test süresince yabancı uygun siparişleri kuyruk dışına alır."""

    def __init__(self) -> None:
        self.run_id: int | None = None
        self.stop_ids: list[int] = []

    async def park(self) -> int:
        # `pg` fixture'ı zaten kilitliyor; burada da doğrulanır çünkü park etmek
        # canlı dağıtım kuyruğunu geçici olarak değiştiren TEK test adımıdır.
        assert_test_database()
        async with AsyncSessionLocal() as s:
            rows = (
                await s.execute(
                    text(
                        """
                        SELECT o.id FROM orders o
                        WHERE o.deleted_at IS NULL
                          AND o.payment_status = 'PAID'
                          AND o.has_physical IS TRUE
                          AND o.status IN ('PAID', 'SHIPPED')
                          AND NOT EXISTS (
                              SELECT 1 FROM delivery_stops ds
                              WHERE ds.order_id = o.id
                                AND ds.status IN ('PENDING', 'DELIVERED')
                          )
                        """
                    )
                )
            ).scalars().all()
            if not rows:
                return 0
            # Park turu testin kullandığı günden AYRI bir günde açılır: gün+araç
            # başına tek PLANNED tur kısıtı testin kendi turlarıyla çakışmasın.
            park_date = _future_date() - datetime.timedelta(days=1)
            run_id = (
                await s.execute(
                    text(
                        """
                        INSERT INTO delivery_runs (run_date, vehicle, status)
                        VALUES (:d, 'LADA', 'PLANNED') RETURNING id
                        """
                    ),
                    {"d": park_date},
                )
            ).scalar_one()
            self.run_id = run_id
            for i, oid in enumerate(rows, start=1):
                sid = (
                    await s.execute(
                        text(
                            """
                            INSERT INTO delivery_stops
                                (run_id, order_id, sequence, status, qr_token)
                            VALUES (:r, :o, :seq, 'PENDING', :tok) RETURNING id
                            """
                        ),
                        {"r": run_id, "o": oid, "seq": i, "tok": f"park-{_uniq()}"},
                    )
                ).scalar_one()
                self.stop_ids.append(sid)
            await s.commit()
        return len(rows)

    async def release(self) -> None:
        if self.run_id is None:
            return
        async with AsyncSessionLocal() as s:
            # Silme HEM id ile HEM işaretle sınırlı: yanlış bir id gerçek bir
            # durağı/turu silemesin. `park-` öneki yalnız bu fixture'ın ürettiği
            # satırlarda bulunur.
            await s.execute(
                text(
                    "DELETE FROM delivery_stops "
                    "WHERE id = ANY(:ids) AND qr_token LIKE 'park-%'"
                ),
                {"ids": self.stop_ids or [0]},
            )
            await s.execute(
                text(
                    "DELETE FROM delivery_runs WHERE id = :r AND status = 'PLANNED' "
                    "AND NOT EXISTS (SELECT 1 FROM delivery_stops ds WHERE ds.run_id = :r)"
                ),
                {"r": self.run_id},
            )
            await s.commit()


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
            s, DeliveryRunCreate(run_date=_future_date(), vehicle="LADA")
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


async def test_dispatch_yogun_gunde_iki_araca_dengeli_bolusturur(df):
    """Eşiği aşan gün ikinci aracı devreye almalı ve yükü DENGELİ bölüşmeli —
    kısıtsız VROOM toplam maliyeti azaltıp bir kuryeye yığabiliyordu."""
    n = settings.DELIVERY_SINGLE_VEHICLE_MAX_STOPS + 3
    order_ids = await df.orders(n)
    async with AsyncSessionLocal() as s:
        runs = await delivery_service.dispatch_day(s, _future_date())
    df.run_ids.extend(r.id for r in runs)

    assert {r.vehicle for r in runs} == {"LADA", "COROLLA"}
    boyutlar = sorted(len(r.stops) for r in runs)
    assert sum(boyutlar) == n
    # ceil(n/2) tavanı: en yüklü araç bunu aşamaz.
    assert boyutlar[-1] <= -(-n // 2), f"yük dengesiz: {boyutlar}"
    hepsi = {s.order_id for r in runs for s in r.stops}
    assert hepsi == set(order_ids)
    assert all(r.optimize_provider == "vroom" for r in runs if len(r.stops) >= 2)


async def test_gunluk_tavan_asilan_siparisler_kuyrukta_kalir(df, monkeypatch):
    """Biriken söz borcu tek günde bitirilemeyecek tur kurmamalı: tavanı aşan
    siparişler PLANA GİRMEZ ama uygunluk kuyruğunda görünmeye devam eder."""
    monkeypatch.setattr(settings, "DELIVERY_MAX_STOPS_PER_RUN", 2)
    monkeypatch.setattr(settings, "DELIVERY_SINGLE_VEHICLE_MAX_STOPS", 99)
    order_ids = await df.orders(6)
    async with AsyncSessionLocal() as s:
        runs = await delivery_service.dispatch_day(s, _future_date())
    df.run_ids.extend(r.id for r in runs)

    planlanan = {st.order_id for r in runs for st in r.stops}
    bizimkiler = planlanan & set(order_ids)
    assert len(bizimkiler) <= 2 * settings.DELIVERY_MAX_STOPS_PER_RUN

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
