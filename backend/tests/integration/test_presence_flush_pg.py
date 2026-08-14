"""`core/presence.flush_to_db` GERÇEKTEN veritabanına yazıyor mu? (gerçek PG + gerçek Redis)

## Bu dosyanın varlık sebebi

30 Mayıs 2026'da (`c4319c4`) presence yazımı Redis'e alındı ve toplu flush şu
SQL ile yazıldı:

    UPDATE clients AS t SET last_seen_at = to_timestamp(v.ts)
    FROM (VALUES (:id, :ts)) AS v(id, ts) WHERE t.id = v.id

Bu ifade Postgres'te **hiçbir zaman çalışmadı**: tip bilgisi taşımayan bir
`VALUES` listesinde bound parametreler `text` sayılır, `t.id = v.id` de
"operator does not exist: integer = text" ile patlar. `_presence_flusher`
döngüsü hatayı yakalayıp logladığı için uygulama ayakta kaldı; `presence:dirty`
hash'i ise hiç boşalmadı (7488 kayda kadar şişti) ve `last_seen_at` **71 gün
boyunca yalnız login anında** güncellendi. Yani hata sessizdi ve testler
yeşildi — çünkü bu yolu gerçek Postgres'e karşı koşan hiçbir test yoktu.

Buradaki testler o boşluğu kapatır. Hepsi **gözlemlenebilir davranışı** ölçer:
gerçek Redis'e kirli kayıt konur, gerçek `AsyncSession` ile flush çağrılır ve
satırın DB'deki son hâli **ayrı bir session'dan** okunur (bayat kimlik haritası
sonucu maskelemesin).

## İzolasyon

Redis geliştirme örneğiyle paylaşılır, o yüzden testler ayrı bir Redis
veritabanına (`_TEST_REDIS_DB`) yönlendirilir — aksi hâlde flush'ın silme adımı
canlı `presence:dirty` içeriğini süpürürdü. Üretilen `clients` satırları
teardown'da **fiziksel** silinir (`clients` hijyen nöbetçisinde).
"""
from __future__ import annotations

import datetime
import logging
import uuid

import pytest
import redis.asyncio as aioredis
from sqlalchemy import text

from core import presence
from core.config import settings
from core.database import AsyncSessionLocal
from tests.service_guard import servis_yok

#: Testler canlı presence kuyruğuna dokunmasın diye ayrı Redis veritabanı.
_TEST_REDIS_DB = 15

#: Flush'ın gerçekten yazdığını ayırt edebilmek için kasten "eski" başlangıç.
_ESKI = datetime.datetime(2020, 1, 1, tzinfo=datetime.timezone.utc)


@pytest.fixture
async def redis_izole(pg):
    """`presence` modülünü tek kullanımlık bir Redis veritabanına bağlar."""
    r = aioredis.from_url(settings.REDIS_URL, db=_TEST_REDIS_DB, decode_responses=True)
    try:
        await r.ping()
    except Exception as exc:  # noqa: BLE001 — servis yok/erişilemiyor
        await r.aclose()
        servis_yok("Redis", exc)

    onceki = presence._client
    presence._client = r
    await r.delete("presence:dirty")
    try:
        yield r
    finally:
        presence._client = onceki
        await r.delete("presence:dirty")
        await r.aclose()


async def _client_olustur(last_seen: datetime.datetime | None = _ESKI) -> int:
    """Gerçek bir `clients` satırı üretir, id döner."""
    from models.client import Client

    suffix = uuid.uuid4().hex[:10]
    async with AsyncSessionLocal() as s:
        c = Client(
            email=f"presence-{suffix}@test.local",
            hashed_password="test-only",
            first_name="Presence",
            last_name="Testi",
            username=f"presence{suffix}",
            role_id=3,
            last_seen_at=last_seen,
        )
        s.add(c)
        await s.commit()
        return c.id


async def _client_sil(*ids: int) -> None:
    if not ids:
        return
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("DELETE FROM clients WHERE id = ANY(:ids)"), {"ids": list(ids)}
        )
        await s.commit()


async def _last_seen_oku(client_id: int) -> datetime.datetime | None:
    """Satırı **taze** bir session'dan okur (ORM kimlik haritası devrede olmasın)."""
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(
                text("SELECT last_seen_at FROM clients WHERE id = :i"), {"i": client_id}
            )
        ).scalar_one()


@pytest.mark.asyncio
async def test_flush_last_seen_at_i_gercekten_gunceller(redis_izole):
    """Kirli kayıt → flush → satırın `last_seen_at`'i DB'de değişmiş olmalı.

    CAST'ler kaldırılırsa (30 Mayıs–9 Ağustos arasındaki hâl) `session.execute`
    `ProgrammingError: operator does not exist: integer = text` fırlatır ve bu
    test kırmızıya döner.
    """
    client_id = await _client_olustur()
    hedef_ts = int(datetime.datetime.now(datetime.timezone.utc).timestamp()) - 120
    try:
        await redis_izole.hset("presence:dirty", f"clients:{client_id}", hedef_ts)

        async with AsyncSessionLocal() as s:
            yazilan = await presence.flush_to_db(s)

        assert yazilan == 1, "flush kayıt saymadı"

        son = await _last_seen_oku(client_id)
        assert son is not None
        assert son != _ESKI, "last_seen_at hiç değişmedi (flush yazmamış)"
        assert int(son.timestamp()) == hedef_ts, (
            f"yazılan an beklenenden farklı: {son} (epoch {int(son.timestamp())}) "
            f"!= epoch {hedef_ts}"
        )
    finally:
        await _client_sil(client_id)


@pytest.mark.asyncio
async def test_flush_bilinmeyen_tablo_adini_sql_e_gommez(redis_izole):
    """Redis'ten gelen uydurma/enjeksiyon biçimli tablo adı flush'ı bozmamalı.

    Allowlist kaldırılırsa `UPDATE ogrenciler_dropla ...` "relation does not
    exist" ile patlar, aynı transaction'daki meşru güncelleme de commit
    edilemez → test kırmızıya döner.
    """
    client_id = await _client_olustur()
    hedef_ts = int(datetime.datetime.now(datetime.timezone.utc).timestamp()) - 300
    try:
        await redis_izole.hset(
            "presence:dirty",
            mapping={
                "ogrenciler_dropla:1": hedef_ts,  # allowlist dışı, uydurma tablo
                "pg_stat_activity:1": hedef_ts,   # var olan ama yazılmaması gereken
                f"clients:{client_id}": hedef_ts,  # meşru kayıt
            },
        )

        async with AsyncSessionLocal() as s:
            yazilan = await presence.flush_to_db(s)

        assert yazilan == 1, "yalnız allowlist'teki tablo yazılmalıydı"

        son = await _last_seen_oku(client_id)
        assert son is not None and int(son.timestamp()) == hedef_ts, (
            "allowlist dışı kayıt meşru güncellemeyi de düşürmüş"
        )
    finally:
        await _client_sil(client_id)


@pytest.mark.asyncio
async def test_bozuk_anahtar_kuyrugu_kilitlemez(redis_izole):
    """Ayrıştırılamayan bir alan adı bütün flush'ı süresiz bloke etmemeli.

    `key.split(":")` iki parçadan fazlasında `ValueError` fırlatır; tek bozuk
    alan, kuyruğun bir daha ASLA boşalmaması demektir (aynı sızıntı deseni).
    """
    client_id = await _client_olustur()
    hedef_ts = int(datetime.datetime.now(datetime.timezone.utc).timestamp()) - 60
    try:
        await redis_izole.hset(
            "presence:dirty",
            mapping={
                "bozuk-anahtar": hedef_ts,           # ayıraç yok
                "clients:abc": hedef_ts,             # id sayı değil
                f"clients:{client_id}": hedef_ts,    # meşru kayıt
            },
        )

        async with AsyncSessionLocal() as s:
            yazilan = await presence.flush_to_db(s)

        assert yazilan == 1
        son = await _last_seen_oku(client_id)
        assert son is not None and int(son.timestamp()) == hedef_ts

        # Bozuk alanlar kuyrukta birikmemeli: temizlenmiş olmalılar.
        assert await redis_izole.hlen("presence:dirty") == 0, (
            "bozuk alanlar kuyrukta kaldı, her turda yeniden işlenecekler"
        )
    finally:
        await _client_sil(client_id)


class _YarisSession:
    """Flush'ın ilk `execute`'unda araya bir yazma sokan session sarmalayıcısı.

    `flush_to_db` `hgetall` ile okuduğu alanları sonradan siler. Silme adımı
    tüm hash'i kaldırıyorsa, okuma ile silme ARASINDA gelen `touch` çağrıları
    sessizce kaybolur. Bu sarmalayıcı o pencereyi deterministik yapar —
    `asyncio.sleep` ile "herhâlde araya girmiştir" tahmini yapılmaz.
    """

    def __init__(self, inner, hook):
        self._inner = inner
        self._hook = hook
        self._fired = False

    async def execute(self, *args, **kwargs):
        if not self._fired:
            self._fired = True
            await self._hook()
        return await self._inner.execute(*args, **kwargs)

    async def commit(self):
        return await self._inner.commit()


@pytest.mark.asyncio
async def test_flush_sirasinda_gelen_yeni_kayit_kaybolmaz(redis_izole):
    """Okuma ile silme arasında `touch`'lanan BAŞKA kullanıcı kuyrukta kalmalı."""
    okunan_id = await _client_olustur()
    araya_giren_id = await _client_olustur()
    hedef_ts = int(datetime.datetime.now(datetime.timezone.utc).timestamp()) - 45
    try:
        await redis_izole.hset("presence:dirty", f"clients:{okunan_id}", hedef_ts)

        async def araya_gir():
            await presence.touch("clients", araya_giren_id)

        async with AsyncSessionLocal() as inner:
            await presence.flush_to_db(_YarisSession(inner, araya_gir))

        assert await redis_izole.hexists(
            "presence:dirty", f"clients:{araya_giren_id}"
        ), "flush sırasında gelen yeni kayıt silindi (hgetall + DEL yarışı)"
        assert not await redis_izole.hexists(
            "presence:dirty", f"clients:{okunan_id}"
        ), "yazılan kayıt kuyruktan düşmedi"
    finally:
        await _client_sil(okunan_id, araya_giren_id)


@pytest.mark.asyncio
async def test_flush_sirasinda_tazelenen_ayni_kayit_kaybolmaz(redis_izole):
    """Aynı kullanıcı flush ortasında yeniden `touch`'lanırsa yeni damga kalmalı.

    Düz `HDEL` bunu da düşürürdü: okunan alan adı aynıdır, ama değeri artık
    daha yenidir. Silme bu yüzden **değer karşılaştırmalı** yapılır.
    """
    client_id = await _client_olustur()
    eski_ts = int(datetime.datetime.now(datetime.timezone.utc).timestamp()) - 600
    try:
        await redis_izole.hset("presence:dirty", f"clients:{client_id}", eski_ts)

        async def araya_gir():
            await presence.touch("clients", client_id)  # aynı alan, YENİ damga

        async with AsyncSessionLocal() as inner:
            await presence.flush_to_db(_YarisSession(inner, araya_gir))

        kalan = await redis_izole.hget("presence:dirty", f"clients:{client_id}")
        assert kalan is not None, "flush sırasında tazelenen kayıt silindi"
        assert int(kalan) > eski_ts
    finally:
        await _client_sil(client_id)


@pytest.mark.asyncio
async def test_kuyruk_tavani_asilinca_kritik_log(redis_izole, caplog, monkeypatch):
    """`presence:dirty` beklenmedik boyuta ulaşırsa sessiz kalınmamalı.

    Sızıntının 71 gün fark edilmemesinin sebebi tam olarak buydu: kuyruk
    şişerken hiçbir yerde alarm yoktu.
    """
    monkeypatch.setattr(settings, "PRESENCE_DIRTY_MAX_ENTRIES", 2, raising=False)
    client_id = await _client_olustur()
    ts = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
    try:
        await redis_izole.hset(
            "presence:dirty",
            mapping={
                f"clients:{client_id}": ts,
                "clients:999999001": ts,
                "clients:999999002": ts,
            },
        )
        with caplog.at_level(logging.CRITICAL, logger="core.presence"):
            async with AsyncSessionLocal() as s:
                await presence.flush_to_db(s)

        kritikler = [r for r in caplog.records if r.levelno >= logging.CRITICAL]
        assert kritikler, "kuyruk tavanı aşıldı ama kritik log yok"
        assert "presence:dirty" in kritikler[0].getMessage()

        # Alarm verilmiş olması yazmayı engellememeli.
        son = await _last_seen_oku(client_id)
        assert son is not None and int(son.timestamp()) == ts
    finally:
        await _client_sil(client_id)


@pytest.mark.asyncio
async def test_bos_kuyruk_sifir_doner(redis_izole):
    """Kuyruk boşken flush ne yazar ne patlar."""
    async with AsyncSessionLocal() as s:
        assert await presence.flush_to_db(s) == 0
