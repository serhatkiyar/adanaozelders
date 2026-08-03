#!/usr/bin/env bash
# F30 gerçek tarayıcı kabulü — tek komutluk koşum.
#
# Neden ayrı bir yığın: kabul, geliştirme veritabanına ve geliştirme
# sunucularına DOKUNMAZ. Kendi test veritabanını (adı `test` içerir), kendi
# backend portunu (8001) ve kendi Vite portunu (5174) kullanır; bittiğinde
# ikisini de kapatır. Aksi hâlde kabul verisi katalog veritabanına sızar ve
# admin ekranlarını şişirir (kök CLAUDE.md §G).
#
# Gerekenler: PostgreSQL (5432), Redis (6379), Chrome, Node 22+, Python
# (pymupdf + opencv-python-headless — yalnız doğrulama aracı, requirements.txt'e
# EKLENMEZ).
#
# Kullanım:
#   bash scripts/f30-browser-acceptance.sh
set -euo pipefail

KOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CIKTI="${KOK}/.f30-kabul"
DB="${F30_E2E_DB:-adana_f30_e2e_test}"
BE_PORT="${F30_E2E_BACKEND_PORT:-8001}"
FE_PORT="${F30_E2E_FRONTEND_PORT:-5174}"
ADMIN_EMAIL="${F30_E2E_ADMIN_EMAIL:-f30-kabul@test.local}"
ADMIN_PASSWORD="${F30_E2E_ADMIN_PASSWORD:-F30-kabul-parola-2026}"

case "$DB" in
  *test*) ;;
  *) echo "REDDEDİLDİ: '$DB' adı 'test' içermiyor." >&2; exit 2 ;;
esac

for PORT_ in "$BE_PORT" "$FE_PORT"; do
  if curl -sf "http://127.0.0.1:${PORT_}/" >/dev/null 2>&1 ||
     curl -sf "http://127.0.0.1:${PORT_}/health/live" >/dev/null 2>&1; then
    echo "REDDEDİLDİ: :${PORT_} zaten dinleniyor. Eski bir sürece bağlanan kabul" >&2
    echo "sessizce yalancı olur (bir kez yaşandı). Önce o süreci kapatın." >&2
    exit 2
  fi
done

mkdir -p "$CIKTI"
rm -f "$CIKTI"/*.png "$CIKTI"/*.pdf "$CIKTI"/rapor.json 2>/dev/null || true

export POSTGRES_DB="$DB"
export POSTGRES_USER="${POSTGRES_USER:-postgres}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-123456}"
export POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
export POSTGRES_PORT="${POSTGRES_PORT:-5432}"
export ENVIRONMENT=development
export AUTO_CREATE_DB=true
export ADMIN_EMAIL ADMIN_PASSWORD
export PAYMENT_PROVIDER=fake
export EMAIL_PROVIDER=console
export SMS_PROVIDER=console
export ROUTING_PROVIDER=haversine
# Ayarın adı `BACKEND_CORS_ORIGINS` (JSON listesi) — `CORS_ORIGINS` diye bir
# ayar YOK ve ilk denemede sessizce yok sayıldı. HER İKİ ana bilgisayar adı
# yazılır: Chrome sayfayı `127.0.0.1`'den açıyor, `localhost` ile aynı origin
# SAYILMAZ ve istek CORS'a takılınca ekranda "Sunucuya ulaşılamıyor" görünür —
# sunucu ayakta olsa bile.
export BACKEND_CORS_ORIGINS="[\"http://127.0.0.1:${FE_PORT}\",\"http://localhost:${FE_PORT}\"]"

temizle() {
  [[ -n "${BE_PID:-}" ]] && kill "$BE_PID" 2>/dev/null || true
  [[ -n "${FE_PID:-}" ]] && kill "$FE_PID" 2>/dev/null || true
  [[ -n "${ENV_LOCAL:-}" ]] && rm -f "$ENV_LOCAL" 2>/dev/null || true
  true
}
trap temizle EXIT

# Veritabanını backend'den ÖNCE aç: `AUTO_CREATE_DB` yalnız `alembic upgrade
# head` çalıştırır, `CREATE DATABASE` yapmaz (bilinçli — uygulama kendi
# veritabanını yaratmamalı). Testlerin conftest'i bunu kendi yapıyor; kabul
# yığınının da kendi eşdeğerine ihtiyacı var.
echo "▸ veritabanı"
( cd "$KOK/backend" && python -c "
import asyncio, sys
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from core.config import settings

ad = settings.POSTGRES_DB
assert 'test' in ad.lower(), ad
bakim = 'postgresql+asyncpg://%s:%s@%s:%s/postgres' % (
    settings.POSTGRES_USER, settings.POSTGRES_PASSWORD,
    settings.POSTGRES_HOST, settings.POSTGRES_PORT)

async def ana():
    # Her kosumda SIFIRDAN: kabul tekrarlanabilir olmali. Onceki kosumun
    # biraktigi planli tur gun+arac benzersizligini ihlal ediyor ve tohum
    # ikinci kez calismiyordu. Ayrica sifir veriyle baslamak, kuyrukta
    # siparis var gibi iddialarin eski kalintiyla yesillenmesini de engeller.
    e = create_async_engine(bakim, isolation_level='AUTOCOMMIT')
    async with e.connect() as c:
        await c.execute(text(
            'SELECT pg_terminate_backend(pid) FROM pg_stat_activity '
            'WHERE datname = :a AND pid <> pg_backend_pid()'), {'a': ad})
        await c.execute(text('DROP DATABASE IF EXISTS \"%s\"' % ad))
        await c.execute(text('CREATE DATABASE \"%s\"' % ad))
        sys.stderr.write('sifirdan olusturuldu: %s\n' % ad)
    await e.dispose()

asyncio.run(ana())
" )

echo "▸ backend :$BE_PORT  (db=$DB)"
( cd "$KOK/backend" && python -m uvicorn main:app --host 127.0.0.1 --port "$BE_PORT" \
    >"$CIKTI/backend.log" 2>&1 ) &
BE_PID=$!

# Hazırlık ölçütü LIVENESS DEĞİL, gerçek şema. İlk denemede `/health/live`
# beklenmişti ve kabul, önceki koşumdan kalan ESKİ bir uvicorn'a bağlanıp
# "hazır" saydı: yeni süreç hâlâ migrate ederken tohum boş veritabanına yazmaya
# çalıştı ("relation products does not exist"). Artık migration'ın gerçekten
# bittiği, `alembic_version`'ın head'e ulaşmasıyla ölçülüyor.
for _ in $(seq 1 180); do
  if ( cd "$KOK/backend" && AUTO_CREATE_DB=False python -c "
import asyncio, sys
from sqlalchemy import text
from core.database import engine
async def a():
    try:
        async with engine.connect() as c:
            await c.execute(text('SELECT 1 FROM products LIMIT 1'))
            await c.execute(text('SELECT 1 FROM order_packages LIMIT 1'))
    except Exception:
        sys.exit(1)
    finally:
        await engine.dispose()
asyncio.run(a())
" >/dev/null 2>&1 ) && curl -sf "http://127.0.0.1:${BE_PORT}/health/live" >/dev/null 2>&1; then
    HAZIR=1; break
  fi
  sleep 1
done
[[ "${HAZIR:-}" == "1" ]] || {
  echo "backend/şema hazır olmadı — $CIKTI/backend.log"; tail -30 "$CIKTI/backend.log"; exit 1; }

echo "▸ tohum"
( cd "$KOK/backend" && python -m scripts.f30_e2e_seed ) > "$CIKTI/seed.json"
cat "$CIKTI/seed.json"

echo "▸ frontend :$FE_PORT"
( cd "$KOK/frontend" && VITE_API_BASE_URL="http://127.0.0.1:${BE_PORT}/api/v1" \
    npx vite --port "$FE_PORT" --strictPort --host 127.0.0.1 \
    >"$CIKTI/frontend.log" 2>&1 ) &
FE_PID=$!

for _ in $(seq 1 120); do
  if curl -sf "http://127.0.0.1:${FE_PORT}/" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -sf "http://127.0.0.1:${FE_PORT}/" >/dev/null || {
  echo "vite açılmadı — $CIKTI/frontend.log"; tail -30 "$CIKTI/frontend.log"; exit 1; }

echo "▸ tarayıcı kabulü"
( cd "$KOK/frontend" && node scripts/f30_browser_acceptance.mjs \
    --seed "$CIKTI/seed.json" --out "$CIKTI" \
    --frontend "http://127.0.0.1:${FE_PORT}" \
    --backend "http://127.0.0.1:${BE_PORT}" \
    --admin-password "$ADMIN_PASSWORD" )
TARAYICI=$?

echo "▸ baskı kabulü (PDF ölçüsü + metin + QR çözümü)"
# `encoding="utf-8"` ZORUNLU: Windows'ta varsayılan kod sayfası cp1254 ve rapor
# Türkçe metin taşıyor — açık kodlama olmadan okuma UnicodeDecodeError veriyor.
QR="$(python -c "import json,sys;print(json.load(open(sys.argv[1], encoding='utf-8'))['qr_payload'])" "$CIKTI/rapor.json")"
( cd "$KOK/backend" && python -m scripts.f30_baski_kabul "$CIKTI/paket-etiketi.pdf" \
    --qr "$QR" \
    --icermeli "Reşatbey" \
    --icermeli "eczanenin üst katı" \
    --icermeli "KOMŞUYA" )
BASKI=$?

echo
echo "tarayıcı=$TARAYICI  baskı=$BASKI  (0 = geçti)"
exit $(( TARAYICI || BASKI ))
