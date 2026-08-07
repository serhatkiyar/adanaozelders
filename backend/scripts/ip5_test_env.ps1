# İP-5 (KDV / fatura) entegrasyon testleri için ortam.
#
# Kullanım (backend/ içinden):
#   . .\scripts\ip5_test_env.ps1
#   python -m pytest tests/integration -k ip5 -q
#
# Test veritabanı TEK KULLANIMLIK'tır ve adı `test` içermek ZORUNDADIR
# (tests/integration/db_guard.py); yoksa conftest onu oluşturup
# `alembic upgrade head` ile hazırlar. Geliştirme kataloğu (`ceyhandb`)
# bilinçli olarak allowlist DIŞINDADIR.
#
# NOT: `PAYMENT_PROVIDER` burada AYARLANMAZ. TB-21'den beri kök `conftest.py`
# onu `fake`'e sabitliyor ve entegrasyon suite'i gerçek bir sağlayıcıyla
# başlatılırsa koşmayı reddediyor. Betiğe yazmak, korumanın çalışıp
# çalışmadığını gizlerdi.

$env:POSTGRES_USER = "postgres"
$env:POSTGRES_HOST = "localhost"
$env:POSTGRES_PORT = "5432"
$env:POSTGRES_DB   = "adana_ip5_test"
$env:JWT_SECRET_KEY = "ip5-test-secret-not-for-production"
$env:AUTO_CREATE_DB = "False"
$env:ENVIRONMENT = "development"

if (-not $env:POSTGRES_PASSWORD) {
    Write-Host "POSTGRES_PASSWORD ayarlanmamis; once su komutu calistirin:" -ForegroundColor Yellow
    Write-Host '  $env:POSTGRES_PASSWORD = "<sifre>"' -ForegroundColor Yellow
}

Write-Host "IP-5 test ortami hazir: POSTGRES_DB=$($env:POSTGRES_DB)" -ForegroundColor Green
