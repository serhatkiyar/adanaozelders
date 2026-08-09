from __future__ import annotations

import logging
import time

import redis.asyncio as aioredis

from core.config import settings

logger = logging.getLogger(__name__)

_client: aioredis.Redis | None = None

#: Kirli kayıt kuyruğu. Alan adı `"{tablo}:{id}"`, değer epoch saniyesi.
_DIRTY_KEY = "presence:dirty"

# `last_seen_at` taşıyan giriş hesabı tabloları (LastSeenMixin). Tablo adı SQL'e
# f-string ile gömüldüğü ve Redis'ten okunduğu için allowlist dışına çıkılmaz.
_FLUSHABLE_TABLES = frozenset(
    {"admins", "tutors", "clients", "library_operators", "courier_accounts"}
)

#: Yazılan alanları **değeri değişmemişse** silen Lua betiği.
#:
#: Neden `DEL` değil: `flush_to_db` kuyruğu `HGETALL` ile okur, DB'ye yazar,
#: sonra temizler. Bu iki adım arasında geçen sürede (bir UPDATE + COMMIT)
#: gelen her `touch` çağrısı, tüm hash'i silen bir `DEL` ile **sessizce
#: kaybolurdu** — kullanıcı çevrimiçiydi ama bir sonraki flush turuna kadar
#: (varsayılan 5 dk) kaydı yoktu.
#:
#: Neden düz `HDEL` de yetmez: aynı kullanıcı flush ortasında yeniden
#: `touch`'lanırsa alan adı aynıdır, ama değeri artık daha yenidir. Düz `HDEL`
#: o yeni damgayı da düşürür. Bu yüzden silme **değer karşılaştırmalıdır**:
#: yalnız okuduğumuz değer hâlâ oradaysa silinir.
_CAD_SCRIPT = """
local silinen = 0
for i = 1, #ARGV, 2 do
  if redis.call('HGET', KEYS[1], ARGV[i]) == ARGV[i + 1] then
    redis.call('HDEL', KEYS[1], ARGV[i])
    silinen = silinen + 1
  end
end
return silinen
"""

#: Tek EVAL çağrısına konacak en fazla alan sayısı (ARGV bunun iki katı olur).
_CAD_CHUNK = 1000


def _redis() -> aioredis.Redis | None:
    global _client
    if _client is None:
        try:
            _client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        except Exception:
            return None
    return _client


async def touch(table: str, user_id: int) -> None:
    r = _redis()
    if r is None:
        return
    try:
        ts = int(time.time())
        async with r.pipeline(transaction=False) as pipe:
            pipe.set(f"presence:{table}:{user_id}", ts, ex=settings.PRESENCE_ONLINE_TTL_SECONDS)
            pipe.hset(_DIRTY_KEY, f"{table}:{user_id}", ts)
            await pipe.execute()
    except Exception:
        return  # presence best-effort; auth akışını asla bozma


def _uyar_kuyruk_sismis(adet: int) -> None:
    """Kuyruk beklenmedik boyuta ulaştıysa sessiz kalma.

    Sızıntının 71 gün fark edilmemesinin sebebi buydu: flush her turda
    patlıyordu ama şişen kuyruk hiçbir yerde alarm üretmiyordu.
    """
    tavan = settings.PRESENCE_DIRTY_MAX_ENTRIES
    if tavan and adet > tavan:
        logger.critical(
            "presence:dirty kuyrugu tavani asti: %s kayit (tavan %s). "
            "Flush yazma yolu muhtemelen basarisiz oluyor; %s hatalarina bakin.",
            adet,
            tavan,
            __name__,
        )


def _ayristir(key: str) -> tuple[str, int] | None:
    """`"{tablo}:{id}"` alanını çözer; çözemezse `None`.

    Tek bir bozuk alan (ayıraçsız ad, sayı olmayan id) eskiden `ValueError`
    fırlatıp **bütün flush turunu** düşürüyordu — yani kuyruk bir daha asla
    boşalmıyordu. Aynı sızıntı deseni tek bir çöp kayıtla tetiklenebilirdi.
    """
    table, sep, raw_id = key.rpartition(":")
    if not sep or table not in _FLUSHABLE_TABLES:
        return None  # tablo adı SQL'e gömülüyor: Redis'ten gelen değere güvenme
    try:
        return table, int(raw_id)
    except ValueError:
        return None


async def _kuyruktan_dus(r: aioredis.Redis, alanlar: list[tuple[str, str]]) -> None:
    """İşlenen alanları kuyruktan **değeri değişmemişse** siler."""
    for i in range(0, len(alanlar), _CAD_CHUNK):
        argv: list[str] = []
        for alan, deger in alanlar[i : i + _CAD_CHUNK]:
            argv.append(alan)
            argv.append(deger)
        try:
            await r.eval(_CAD_SCRIPT, 1, _DIRTY_KEY, *argv)
        except Exception:
            # Scripting kapalı/desteklenmiyorsa düz HDEL'e düş: aradaki YENİ
            # kullanıcıları yine korur, yalnız aynı alanın tazelenmesini
            # kaybeder (en fazla bir flush aralığı kadar bayatlık).
            try:
                await r.hdel(_DIRTY_KEY, *[a for a, _ in alanlar[i : i + _CAD_CHUNK]])
            except Exception:
                logger.warning("presence:dirty temizlenemedi", exc_info=True)
                return


async def flush_to_db(session) -> int:
    from sqlalchemy import bindparam, text

    r = _redis()
    if r is None:
        return 0
    try:
        pending = await r.hgetall(_DIRTY_KEY)
    except Exception:
        return 0
    if not pending:
        return 0

    _uyar_kuyruk_sismis(len(pending))

    buckets: dict[str, list[dict]] = {}
    for key, ts in pending.items():
        cozulen = _ayristir(key)
        if cozulen is None:
            continue
        table, _id = cozulen
        try:
            epoch = int(ts)
        except (TypeError, ValueError):
            continue
        buckets.setdefault(table, []).append({"id": _id, "ts": epoch})
    for table, rows in buckets.items():
        # CAST'ler ŞART: tip bilgisi olmayan bir VALUES listesinde Postgres bound
        # parametreleri `text` sayar, `t.id = v.id` de "integer = text" ile patlar.
        stmt = text(
            f"UPDATE {table} AS t SET last_seen_at = to_timestamp(v.ts) "
            "FROM (VALUES (CAST(:id AS INTEGER), CAST(:ts AS BIGINT))) AS v(id, ts) "
            "WHERE t.id = v.id"
        ).bindparams(bindparam("id"), bindparam("ts"))
        await session.execute(stmt, rows)
    await session.commit()
    # Kuyruktan yalnız BU turda okunan alanlar düşürülür (çözülemeyenler dâhil —
    # aksi hâlde çöp kayıtlar her turda yeniden işlenirdi). Silme, okuma ile
    # yazma arasında gelen `touch`'ları korumak için değer karşılaştırmalıdır.
    await _kuyruktan_dus(r, list(pending.items()))
    return sum(len(v) for v in buckets.values())
