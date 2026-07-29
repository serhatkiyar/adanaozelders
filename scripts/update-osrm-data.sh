#!/usr/bin/env bash
# OSM yol agi verisini ATOMIK olarak tazeler (aylik cron ile calisir).
#
# NEDEN AYRI BIR BETIK: setup-osrm-adana.sh ILK KURULUM icindir ve dosyalari
# dogrudan canli dizinde uretir. Bunu calisan bir sistemde her ay yapmak iki
# sekilde patlar:
#   1. osrm-extract canli dosyalarin UZERINE yazar; islem yarida kalirsa
#      (disk dolar, makine yeniden baslar, osmium hata verir) geriye YARIM bir
#      veri seti kalir ve OSRM bir dahaki restart'ta hic acilmaz.
#   2. Yeni veri bozuksa (Geofabrik'te kirik dosya, bbox degisikligi) geri
#      donus yolu olmaz.
#
# Bu betigin akisi:
#   1. Veriyi GECICI klasorde hazirla (canliya dokunma).
#   2. Beklenen dosyalarin tamaminin olustugunu ve bos olmadigini dogrula.
#   3. Yeni veriyi TAKAS ETMEDEN once gecici bir OSRM konteyneriyle sina.
#   4. Eski veriyi yedekle.
#   5. Atomik olarak yeni klasore gecir (iki ardisik rename).
#   6. OSRM/VROOM servislerini yeniden baslat.
#   7. GERCEK rota readiness testi calistir (VROOM uzerinden plan iste).
#   8. Test basarisizsa eski veriye don, servisleri geri al, yeniden dogrula.
#
# Her adim log'lanir; herhangi bir basarisizlik sifir-disi cikis kodu + syslog
# + (varsa) webhook uyarisi uretir. Rollback BASARILI olsa bile cikis kodu
# sifir-disidir: sistem calisiyor ama veri ESKI kaldi, bu gorulmelidir.
#
# Kullanim:
#   ./scripts/update-osrm-data.sh                 # tam guncelleme
#   ./scripts/update-osrm-data.sh --check         # yalniz readiness testi
#   ./scripts/update-osrm-data.sh --rollback      # elle geri alma
#
# Ortam degiskenleri:
#   COMPOSE_FILE   varsayilan: docker-compose.prod.yml (yoksa docker-compose.yml)
#   COMPOSE_ARGS   ek compose argumanlari (or. "--env-file .env.prod")
#   VROOM_URL      readiness testi icin (varsayilan http://localhost:3000)
#   ALERT_WEBHOOK  basarisizlikta POST edilecek adres (opsiyonel)
#   SKIP_DOWNLOAD  1 ise Turkiye PBF yeniden indirilmez (mevcut dosya kullanilir)
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$REPO_ROOT/devops/osrm"           # canli (compose buraya bind eder)
STAGE_DIR="$REPO_ROOT/devops/osrm.staging"  # hazirlik
PREV_DIR="$REPO_ROOT/devops/osrm.previous"  # yedek (bir onceki calisan veri)
CACHE_DIR="$REPO_ROOT/devops/osrm.cache"    # indirilen ham PBF (canli disinda)
LOCK_FILE="/tmp/osrm-adana-update.lock"
STATUS_FILE="$REPO_ROOT/devops/osrm.last-update"

BBOX="${BBOX:-34.6,36.6,36.1,37.5}"
TURKEY_PBF="turkey-latest.osm.pbf"
ADANA_PBF="adana.osm.pbf"
VROOM_URL="${VROOM_URL:-http://localhost:3000}"
# Adana merkez (depo civari) — readiness testinin referans noktalari.
REF_LAT="36.9855"; REF_LNG="35.3253"
REF_LAT2="37.0100"; REF_LNG2="35.3300"

# osrm-routed'un acilabilmesi icin GEREKEN dosyalar. Biri eksikse veri yarimdir.
REQUIRED_FILES=(
  adana.osrm adana.osrm.cell_metrics adana.osrm.cells adana.osrm.cnbg
  adana.osrm.datasource_names adana.osrm.ebg adana.osrm.ebg_nodes
  adana.osrm.edges adana.osrm.enw adana.osrm.fileIndex adana.osrm.geometry
  adana.osrm.icd adana.osrm.maneuver_overrides adana.osrm.mldgr adana.osrm.names
  adana.osrm.nbg_nodes adana.osrm.partition adana.osrm.properties
  adana.osrm.ramIndex adana.osrm.restrictions adana.osrm.timestamp
  adana.osrm.turn_duration_penalties adana.osrm.turn_penalties_index
  adana.osrm.turn_weight_penalties
)

# ── Log / uyari ──────────────────────────────────────────────────────────────
log()  { printf '%s [osrm-update] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
fail() { log "HATA: $*"; }

alert() {
  local mesaj="$1"
  log "UYARI GONDERILIYOR: $mesaj"
  command -v logger >/dev/null 2>&1 && logger -t osrm-update -p daemon.err "$mesaj" || true
  if [[ -n "${ALERT_WEBHOOK:-}" ]]; then
    curl -fsS -m 10 -X POST -H 'Content-Type: application/json' \
      -d "{\"text\":\"[osrm-update] $mesaj\"}" "$ALERT_WEBHOOK" >/dev/null 2>&1 \
      || log "webhook uyarisi gonderilemedi"
  fi
}

# Izleme araclarinin okuyabilecegi son durum dosyasi.
durum_yaz() {
  printf 'status=%s\ntimestamp=%s\ndetail=%s\n' \
    "$1" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "${2:-}" > "$STATUS_FILE"
}

# ── Compose yardimcilari ─────────────────────────────────────────────────────
compose_dosyasi() {
  if [[ -n "${COMPOSE_FILE:-}" ]]; then echo "$COMPOSE_FILE"; return; fi
  if [[ -f "$REPO_ROOT/docker-compose.prod.yml" ]]; then
    echo "docker-compose.prod.yml"
  else
    echo "docker-compose.yml"
  fi
}

compose() {
  # shellcheck disable=SC2086
  (cd "$REPO_ROOT" && docker compose -f "$(compose_dosyasi)" ${COMPOSE_ARGS:-} "$@")
}

_compose_rota() {
  # Gelistirme compose'unda rota servisleri profil arkasindadir.
  if [[ "$(compose_dosyasi)" == "docker-compose.yml" ]]; then
    (cd "$REPO_ROOT" && docker compose --profile routing "$@")
  else
    compose "$@"
  fi
}

servisleri_durdur() {
  log "osrm/vroom durduruluyor (takas icin)..."
  _compose_rota stop osrm vroom >/dev/null 2>&1 || { fail "servisler durdurulamadi"; return 1; }
  return 0
}

servisleri_baslat() {
  log "osrm/vroom baslatiliyor..."
  _compose_rota up -d osrm vroom >/dev/null 2>&1 || { fail "servisler baslatilamadi"; return 1; }
  return 0
}

# ── Readiness: GERCEK rota istegi ────────────────────────────────────────────
# VROOM'un ayakta olmasi YETMEZ; arkasindaki OSRM verisi de yuklu ve makul
# olmalidir. Bu yuzden gercek bir plan istenir ve sonucun MANTIKLI oldugu
# dogrulanir: sifir/absurd mesafe, kirpilmis (bos) bir yol agi demektir.
readiness_testi() {
  local deneme=0 yanit=""
  local payload
  payload=$(cat <<JSON
{"vehicles":[{"id":1,"profile":"car","start":[$REF_LNG,$REF_LAT]}],
 "jobs":[{"id":1,"location":[$REF_LNG2,$REF_LAT2],"service":180},
         {"id":2,"location":[$REF_LNG,$REF_LAT],"service":180}],
 "options":{"g":true}}
JSON
)
  while (( deneme < 12 )); do
    yanit=$(curl -fsS -m 15 -X POST -H 'Content-Type: application/json' \
              -d "$payload" "$VROOM_URL" 2>/dev/null) && break
    deneme=$((deneme + 1)); sleep 5
  done
  if [[ -z "$yanit" ]]; then
    fail "readiness: VROOM'a $VROOM_URL adresinden ulasilamadi"; return 1
  fi
  if ! grep -q '"code":0' <<<"$yanit"; then
    fail "readiness: VROOM plan uretemedi -> $(head -c 200 <<<"$yanit")"; return 1
  fi
  if grep -q '"unassigned":[1-9]' <<<"$yanit"; then
    fail "readiness: VROOM duraklari atayamadi (yol agi eksik olabilir)"; return 1
  fi
  # Mesafe akil saglıgı: Adana ici iki nokta arasi tur 0 km olamaz, 200 km de.
  local metre
  metre=$(sed -n 's/.*"distance":\([0-9]\+\).*/\1/p' <<<"$yanit" | head -1)
  if [[ -z "$metre" || "$metre" -lt 500 || "$metre" -gt 200000 ]]; then
    fail "readiness: mesafe akil disi (${metre:-yok} m) — veri kirpik olabilir"
    return 1
  fi
  log "readiness OK (referans tur ${metre} m)"
  return 0
}

# ── Veri hazirlama (GECICI klasorde) ─────────────────────────────────────────
docker_calistir() {
  docker run --rm -v "$STAGE_DIR:/data" "$@"
}

veri_hazirla() {
  rm -rf "$STAGE_DIR"; mkdir -p "$STAGE_DIR" "$CACHE_DIR"

  local pbf="$CACHE_DIR/$TURKEY_PBF"
  if [[ "${SKIP_DOWNLOAD:-0}" != "1" || ! -f "$pbf" ]]; then
    log "Geofabrik'ten Turkiye OSM verisi indiriliyor (~600 MB)..."
    # Once .part'a indir, ancak tamamlaninca yerine koy: yarim indirme
    # bir sonraki calismada "mevcut" sanilmasin.
    if ! curl -fL --retry 3 --retry-delay 10 -o "$pbf.part" \
         "https://download.geofabrik.de/europe/turkey-latest.osm.pbf"; then
      fail "OSM verisi indirilemedi"; return 1
    fi
    mv -f "$pbf.part" "$pbf"
  else
    log "Mevcut $TURKEY_PBF kullaniliyor (SKIP_DOWNLOAD=1)."
  fi
  cp "$pbf" "$STAGE_DIR/$TURKEY_PBF" || { fail "PBF kopyalanamadi"; return 1; }

  log "Adana bbox kirpiliyor ($BBOX)..."
  docker_calistir iboates/osmium:latest \
    extract -b "$BBOX" "/data/$TURKEY_PBF" -o "/data/$ADANA_PBF" --overwrite \
    || { fail "osmium extract basarisiz"; return 1; }

  log "OSRM extract..."
  docker_calistir osrm/osrm-backend:latest osrm-extract -p /opt/car.lua "/data/$ADANA_PBF" \
    || { fail "osrm-extract basarisiz"; return 1; }
  log "OSRM partition..."
  docker_calistir osrm/osrm-backend:latest osrm-partition /data/adana.osrm \
    || { fail "osrm-partition basarisiz"; return 1; }
  log "OSRM customize..."
  docker_calistir osrm/osrm-backend:latest osrm-customize /data/adana.osrm \
    || { fail "osrm-customize basarisiz"; return 1; }

  rm -f "$STAGE_DIR/$TURKEY_PBF"   # 600 MB'lik ham veriyi canli dizine tasima
  return 0
}

butunluk_dogrula() {
  local dizin="$1" eksik=0
  for f in "${REQUIRED_FILES[@]}"; do
    if [[ ! -s "$dizin/$f" ]]; then
      fail "eksik/bos dosya: $f"; eksik=1
    fi
  done
  return $eksik
}

# Takastan ONCE: yeni veriyi tek kullanimlik bir konteynerde ac ve sorgula.
# Bozuk veriyi canliya hic tasimadan yakalamanin tek yolu budur.
staging_smoke_testi() {
  local ad="osrm-staging-smoke-$$"
  docker rm -f "$ad" >/dev/null 2>&1
  if ! docker run -d --name "$ad" -p 127.0.0.1:5099:5000 -v "$STAGE_DIR:/data:ro" \
       osrm/osrm-backend:latest \
       osrm-routed --algorithm mld --max-table-size 500 /data/adana.osrm >/dev/null 2>&1; then
    fail "staging OSRM konteyneri baslatilamadi"; return 1
  fi
  local ok=1 deneme=0
  while (( deneme < 20 )); do
    if curl -fsS -m 5 "http://localhost:5099/route/v1/driving/$REF_LNG,$REF_LAT;$REF_LNG2,$REF_LAT2" \
         2>/dev/null | grep -q '"code":"Ok"'; then ok=0; break; fi
    deneme=$((deneme + 1)); sleep 2
  done
  if (( ok != 0 )); then
    fail "staging verisi rota uretemedi — takas YAPILMADI"
    docker logs --tail 5 "$ad" 2>&1 | sed 's/^/    /' || true
  else
    log "staging smoke testi OK"
  fi
  docker rm -f "$ad" >/dev/null 2>&1
  return $ok
}

takas_et() {
  rm -rf "$PREV_DIR"
  # Iki ardisik rename: ayni dosya sisteminde her biri atomiktir.
  #
  # DIKKAT — takas SERVISLER DURDURULMUS haldeyken yapilir. Calisan bir
  # konteynerin bind-mount ettigi dizini yeniden adlandirmak Linux'ta calisir
  # (konteyner eski inode'u tutar) ama Docker Desktop/Windows'ta "Permission
  # denied" verir; olcerek gorduk. Ustelik canli mount altindan dizin cekmek
  # her platformda kirilgan bir varsayimdir. Bunun bedeli ~15-20 sn rota
  # kesintisidir: `auto` modu o pencerede tahmine duser (ayin 1'i 04:00'te
  # kimse dagitim planlamaz) ve pencere bittiginde kendiliginden geri doner.
  mv "$DATA_DIR" "$PREV_DIR" || { fail "eski veri yedeklenemedi"; return 1; }
  if ! mv "$STAGE_DIR" "$DATA_DIR"; then
    fail "yeni veri yerine konamadi — eski veri geri aliniyor"
    mv "$PREV_DIR" "$DATA_DIR" || fail "KRITIK: eski veri de geri alinamadi ($PREV_DIR)"
    return 1
  fi
  log "veri takas edildi (eski veri: $PREV_DIR)"
  return 0
}

geri_al() {
  if [[ ! -d "$PREV_DIR" ]]; then
    fail "geri alinacak yedek yok ($PREV_DIR)"; return 1
  fi
  log "eski veriye donuluyor..."
  servisleri_durdur || true            # takasla ayni sebep: mount tutuyorken rename etme
  rm -rf "$STAGE_DIR.bozuk"
  mv "$DATA_DIR" "$STAGE_DIR.bozuk" 2>/dev/null || true   # bozuk veriyi incelemek uzere sakla
  mv "$PREV_DIR" "$DATA_DIR" || { fail "KRITIK: geri alma basarisiz"; servisleri_baslat || true; return 1; }
  servisleri_baslat || true
  if readiness_testi; then
    log "geri alma basarili — sistem ESKI veriyle calisiyor"
    return 0
  fi
  fail "KRITIK: geri alma sonrasi da rota calismiyor"
  return 1
}

disk_kontrol() {
  # Staging + yedek + ham PBF icin kabaca 2 GB serbest alan iste.
  local kb
  kb=$(df -Pk "$REPO_ROOT" | awk 'NR==2 {print $4}')
  if [[ -n "$kb" && "$kb" -lt 2097152 ]]; then
    fail "yetersiz disk alani ($((kb/1024)) MB serbest, en az 2048 MB gerekli)"
    return 1
  fi
  return 0
}

# ── Akis ─────────────────────────────────────────────────────────────────────
main() {
  case "${1:-}" in
    --check)
      readiness_testi && { durum_yaz ok "readiness"; exit 0; }
      durum_yaz fail "readiness"; alert "rota readiness testi basarisiz"; exit 1
      ;;
    --rollback)
      geri_al && { durum_yaz rolled_back "elle"; exit 0; }
      durum_yaz fail "rollback"; exit 1
      ;;
  esac

  log "=== OSM veri guncellemesi basliyor (compose: $(compose_dosyasi)) ==="
  command -v docker >/dev/null 2>&1 || { fail "docker yok"; alert "docker bulunamadi"; exit 1; }
  disk_kontrol || { durum_yaz fail "disk"; alert "OSM guncellemesi: yetersiz disk"; exit 1; }

  if ! veri_hazirla; then
    rm -rf "$STAGE_DIR"
    durum_yaz fail "hazirlama"; alert "OSM veri hazirlama basarisiz — canli veri DEGISMEDI"; exit 1
  fi
  if ! butunluk_dogrula "$STAGE_DIR"; then
    rm -rf "$STAGE_DIR"
    durum_yaz fail "butunluk"; alert "OSM verisi eksik uretildi — canli veri DEGISMEDI"; exit 1
  fi
  if ! staging_smoke_testi; then
    rm -rf "$STAGE_DIR"
    durum_yaz fail "smoke"; alert "Yeni OSM verisi rota uretemedi — canli veri DEGISMEDI"; exit 1
  fi

  # Takas servisler DURDURULMUS haldeyken yapilir (bkz. takas_et yorumu).
  if ! servisleri_durdur; then
    rm -rf "$STAGE_DIR"
    durum_yaz fail "stop"; alert "OSRM durdurulamadi — canli veri DEGISMEDI"; exit 1
  fi
  if ! takas_et; then
    servisleri_baslat || true
    durum_yaz fail "takas"; alert "OSM veri takasi basarisiz — eski veri yerinde"; exit 1
  fi
  if ! servisleri_baslat; then
    geri_al; durum_yaz fail "restart"; alert "OSRM baslatilamadi — eski veriye donuldu"; exit 1
  fi
  if ! readiness_testi; then
    alert "Yeni veriyle readiness basarisiz — eski veriye donuluyor"
    if geri_al; then
      durum_yaz rolled_back "readiness"
      alert "Eski veriye DONULDU: sistem calisiyor ama yol agi verisi ESKI"
      exit 1
    fi
    durum_yaz fail "rollback"; alert "KRITIK: rota calismiyor, elle mudahale gerekli"; exit 1
  fi

  # Bir onceki yedek yalnizca BASARIDAN sonra silinir (tek adim geri donus hakki
  # bir sonraki calismaya kadar durur).
  log "=== guncelleme basarili ==="
  durum_yaz ok "guncellendi"
  exit 0
}

# Ust uste calismayi engelle (cron gecikirse iki surec ayni dizinlere yazmasin).
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    log "baska bir guncelleme calisiyor — cikiliyor"; exit 0
  fi
fi
main "$@"
