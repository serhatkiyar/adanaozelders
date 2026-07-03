<#
.SYNOPSIS
  OSRM icin Adana yol agi verisini hazirlar (tek seferlik; ~10-20 dk).

.DESCRIPTION
  1) Geofabrik'ten Turkiye OSM verisini indirir (~600 MB, devops/osrm altina).
  2) osmium ile Adana/Cukurova bounding-box'ina kirpar (kucuk dosya, az RAM).
  3) OSRM on-islemesi: extract -> partition -> customize (araba profili, MLD).
  Sonra: docker compose --profile routing up -d osrm vroom

  Her adim Docker konteynerleriyle calisir — makineye osmium/osrm kurulmaz.
  Yeniden calistirmak veriyi tazeler (OSM guncellemesi icin ~ayda bir yeterli).

.NOTES
  Bbox, Adana merkez + Ceyhan dahil genis tutuldu: 34.6,36.6,36.1,37.5
  (lon_min,lat_min,lon_max,lat_max). Gerekirse asagidaki $Bbox'i genislet.
#>
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$DataDir = Join-Path $RepoRoot "devops\osrm"
$Bbox = "34.6,36.6,36.1,37.5"
$TurkeyPbf = "turkey-latest.osm.pbf"
$AdanaPbf = "adana.osm.pbf"

New-Item -ItemType Directory -Force $DataDir | Out-Null

# 1) Turkiye OSM verisi (varsa atla — silip yeniden indirerek tazeleyebilirsin)
$TurkeyPath = Join-Path $DataDir $TurkeyPbf
if (-not (Test-Path $TurkeyPath)) {
  Write-Host ">> Geofabrik'ten Turkiye OSM verisi indiriliyor (~600 MB)..."
  Invoke-WebRequest -Uri "https://download.geofabrik.de/europe/turkey-latest.osm.pbf" `
    -OutFile $TurkeyPath
} else {
  Write-Host ">> $TurkeyPbf zaten var, indirme atlandi."
}

# 2) Adana bbox kirpma (osmium)
Write-Host ">> Adana bolgesine kirpiliyor (bbox: $Bbox)..."
docker run --rm -v "${DataDir}:/data" iboates/osmium-tool:latest `
  osmium extract -b $Bbox /data/$TurkeyPbf -o /data/$AdanaPbf --overwrite
if ($LASTEXITCODE -ne 0) { throw "osmium extract basarisiz" }

# 3) OSRM on-isleme (MLD algoritmasi — compose'daki osrm-routed ile ayni)
Write-Host ">> OSRM extract (araba profili)..."
docker run --rm -v "${DataDir}:/data" osrm/osrm-backend:latest `
  osrm-extract -p /opt/car.lua /data/$AdanaPbf
if ($LASTEXITCODE -ne 0) { throw "osrm-extract basarisiz" }

Write-Host ">> OSRM partition..."
docker run --rm -v "${DataDir}:/data" osrm/osrm-backend:latest `
  osrm-partition /data/adana.osrm
if ($LASTEXITCODE -ne 0) { throw "osrm-partition basarisiz" }

Write-Host ">> OSRM customize..."
docker run --rm -v "${DataDir}:/data" osrm/osrm-backend:latest `
  osrm-customize /data/adana.osrm
if ($LASTEXITCODE -ne 0) { throw "osrm-customize basarisiz" }

Write-Host ""
Write-Host "== HAZIR =="
Write-Host "Baslatmak icin:  docker compose --profile routing up -d osrm vroom"
Write-Host "Test:            curl 'http://localhost:5000/route/v1/driving/35.3253,36.9855;35.33,37.01'"
Write-Host "Backend zaten ROUTING_PROVIDER=auto ile VROOM'u otomatik kullanir."
