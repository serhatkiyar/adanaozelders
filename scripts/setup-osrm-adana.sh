#!/usr/bin/env bash
# OSRM icin Adana yol agi verisini hazirlar (tek seferlik; ~10-20 dk).
#
# setup-osrm-adana.ps1'in Linux/macOS esdegeridir. Uretim sunucusu Linux
# oldugundan rota altyapisi ORADA bu betikle kurulur; PowerShell surumu
# gelistirici makinesi (Windows) icindir. Ikisi ayni bbox'i ve ayni OSRM
# on-isleme zincirini kullanir — ciktilari birebir degistirilebilir.
#
#   1) Geofabrik'ten Turkiye OSM verisini indirir (~600 MB, devops/osrm altina).
#   2) osmium ile Adana/Cukurova bounding-box'ina kirpar (kucuk dosya, az RAM).
#   3) OSRM on-islemesi: extract -> partition -> customize (araba profili, MLD).
#
# Her adim Docker konteyneriyle calisir — makineye osmium/osrm kurulmaz.
# Yeniden calistirmak veriyi tazeler (OSM guncellemesi icin ~ayda bir yeterli);
# sonrasinda `docker compose ... restart osrm` gerekir.
#
# Kullanim:
#   ./scripts/setup-osrm-adana.sh            # eksikse indirir, hazirlar
#   FORCE_DOWNLOAD=1 ./scripts/setup-osrm-adana.sh   # OSM verisini tazele
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$REPO_ROOT/devops/osrm"
# Adana merkez + Ceyhan dahil genis tutuldu (lon_min,lat_min,lon_max,lat_max).
BBOX="${BBOX:-34.6,36.6,36.1,37.5}"
TURKEY_PBF="turkey-latest.osm.pbf"
ADANA_PBF="adana.osm.pbf"

mkdir -p "$DATA_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "HATA: docker bulunamadi." >&2
  exit 1
fi

# 1) Turkiye OSM verisi
if [[ -n "${FORCE_DOWNLOAD:-}" ]]; then
  rm -f "$DATA_DIR/$TURKEY_PBF"
fi
if [[ ! -f "$DATA_DIR/$TURKEY_PBF" ]]; then
  echo ">> Geofabrik'ten Turkiye OSM verisi indiriliyor (~600 MB)..."
  curl -fL --retry 3 -o "$DATA_DIR/$TURKEY_PBF" \
    "https://download.geofabrik.de/europe/turkey-latest.osm.pbf"
else
  echo ">> $TURKEY_PBF zaten var, indirme atlandi (tazelemek icin FORCE_DOWNLOAD=1)."
fi

# 2) Adana bbox kirpma (osmium)
echo ">> Adana bolgesine kirpiliyor (bbox: $BBOX)..."
docker run --rm -v "$DATA_DIR:/data" iboates/osmium:latest \
  extract -b "$BBOX" "/data/$TURKEY_PBF" -o "/data/$ADANA_PBF" --overwrite

# 3) OSRM on-isleme (MLD — compose'daki osrm-routed --algorithm mld ile ayni)
echo ">> OSRM extract (araba profili)..."
docker run --rm -v "$DATA_DIR:/data" osrm/osrm-backend:latest \
  osrm-extract -p /opt/car.lua "/data/$ADANA_PBF"

echo ">> OSRM partition..."
docker run --rm -v "$DATA_DIR:/data" osrm/osrm-backend:latest \
  osrm-partition /data/adana.osrm

echo ">> OSRM customize..."
docker run --rm -v "$DATA_DIR:/data" osrm/osrm-backend:latest \
  osrm-customize /data/adana.osrm

echo
echo "== HAZIR =="
echo "Gelistirme:  docker compose --profile routing up -d osrm vroom"
echo "Uretim:      docker compose -f docker-compose.prod.yml --env-file .env.prod up -d osrm vroom"
echo "Dogrulama:   curl -s localhost:8000/health | grep -o '\"routing\".*'"
