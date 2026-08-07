# İP-1b entegrasyon koşusu için ortam değişkenleri.
#
# Kök `conftest.py` CI için sahte POSTGRES_* varsayılanları koyar ve bunlar
# `.env`'i EZER (env > .env). Gerçek değerler pytest'ten ÖNCE verilmelidir,
# aksi halde `role "test" does not exist` alınır.
#
# Veritabanı adı `test` İÇERMEK ZORUNDA (tests/integration/db_guard.py);
# `ceyhandb` (geliştirme verisi) bilinçli olarak allowlist dışıdır.
$env:POSTGRES_USER = 'postgres'
$env:POSTGRES_PASSWORD = '123456'
$env:POSTGRES_HOST = 'localhost'
$env:POSTGRES_PORT = '5432'
$env:POSTGRES_DB = 'adana_ip1b_test'
$env:AUTO_CREATE_DB = 'false'
$env:ENVIRONMENT = 'development'
# Elle `alembic` koşarken gerekir (pytest'te kök conftest.py koyuyor).
$env:JWT_SECRET_KEY = 'ip1b-test-only-secret-key-not-for-production'
