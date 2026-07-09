<#
.SYNOPSIS
  adanaozelders.com.tr'yi yerel gelistirmeye maskeler — pencere ACIKKEN aktif.

.DESCRIPTION
  Cift tiklayinca (masaustundeki .bat uzerinden) yonetici yetkisi ister, sonra:
    1) hosts dosyasina 127.0.0.1 kayitlarini ekler (isaretli satirlar)
    2) port 80 -> 5173 yonlendirmesi kurar (adres cubugunda :5173 gorunmez)
    3) https icin TLS proxy baslatir (443 -> 5173, dev-tls-proxy.js + mkcert)
    4) DNS onbellegini temizler
  Vite duz http kaldigi icin http://localhost:5173 maskeden bagimsiz calisir.
  Pencerede bir tusa basinca HEPSINI GERI ALIR — kalici iz birakmaz.
  Not: pencereyi X ile kapatirsan geri alma calismayabilir; bir sonraki
  calistirma acilista bayat kayitlari temizler (ya da tekrar ac + tusla kapat).

  Vite tarafinda allowedHosts ayari gerekir (frontend/vite.config.ts'te mevcut).
  npm run dev calisiyor olmali; backend /api proxy'siyle ayni origin'den gider.
#>
$ErrorActionPreference = "Stop"

$Marker = "# adana-dev-maske"
$HostsPath = Join-Path $env:SystemRoot "System32\drivers\etc\hosts"
$Domains = @("adanaozelders.com.tr", "www.adanaozelders.com.tr")
$ProxyScript = Join-Path $PSScriptRoot "dev-tls-proxy.js"
$ProxyPidFile = Join-Path $env:TEMP "adana-maske-proxy.pid"

# Yonetici degilse UAC ile kendini yukseltip cik
$identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  exit
}

function Stop-TlsProxy {
  if (Test-Path $ProxyPidFile) {
    $procId = Get-Content $ProxyPidFile
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    Remove-Item $ProxyPidFile -Force -ErrorAction SilentlyContinue
  }
  # Onceki calisma X ile kapatildiysa 443'te yetim node proxy kalmis olabilir.
  Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq "node") { Stop-Process -Id $p.Id -Force }
  }
}

function Remove-Mask {
  $lines = Get-Content $HostsPath | Where-Object { $_ -notmatch [regex]::Escape($Marker) }
  Set-Content -Path $HostsPath -Value $lines -Encoding ASCII
  Stop-TlsProxy
  # Kayit yoksa netsh hata basar — onemsiz, yut.
  netsh interface portproxy delete v4tov4 listenport=80 listenaddress=127.0.0.1 2>$null | Out-Null
  netsh interface portproxy delete v4tov4 listenport=443 listenaddress=127.0.0.1 2>$null | Out-Null
  ipconfig /flushdns | Out-Null
}

function Add-Mask {
  Remove-Mask  # onceki calisma X ile kapatildiysa bayat kayitlari temizle
  $entries = $Domains | ForEach-Object { "127.0.0.1 $_ $Marker" }
  Add-Content -Path $HostsPath -Value $entries -Encoding ASCII
  netsh interface portproxy add v4tov4 listenport=80 listenaddress=127.0.0.1 connectport=5173 connectaddress=127.0.0.1 | Out-Null
  # https: TLS'i minik node proxy'si verir (443 -> 5173); Vite duz http kalir,
  # http://localhost:5173 maskeden bagimsiz calisir.
  $proxy = Start-Process node -ArgumentList "`"$ProxyScript`"" -WindowStyle Hidden -PassThru
  $proxy.Id | Set-Content $ProxyPidFile
  ipconfig /flushdns | Out-Null
}

try {
  Add-Mask
  $Host.UI.RawUI.WindowTitle = "adanaozelders.com.tr — yerel maske AKTIF"
  Write-Host ""
  Write-Host "  MASKE AKTIF  ->  https://adanaozelders.com.tr  (localhost:5173)" -ForegroundColor Green
  Write-Host "  Frontend'in calisiyor olmali: cd frontend; npm run dev"
  Write-Host ""
  Write-Host "  Bitirmek icin bu pencerede bir tusa bas — maske geri alinir." -ForegroundColor Yellow
  [void][Console]::ReadKey($true)
} finally {
  Remove-Mask
  Write-Host ""
  Write-Host "  Maske kaldirildi — gercek DNS'e donuldu." -ForegroundColor Cyan
  Start-Sleep -Seconds 2
}
