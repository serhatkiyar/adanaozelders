"""Test ortamı kurulumu.

core.config.Settings, .env'siz ortamlarda (CI) zorunlu alanlar için değer bekler.
Uygulama modülleri import edilmeden ÖNCE güvenli test default'larını yerleştiririz.
Bu dosya (rootdir conftest) pytest tarafından test modüllerinden önce yüklenir.
"""
import os

os.environ.setdefault("POSTGRES_USER", "test")
os.environ.setdefault("POSTGRES_PASSWORD", "test")
os.environ.setdefault("POSTGRES_DB", "test")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-not-for-production")
os.environ.setdefault("AUTO_CREATE_DB", "False")

# Testler hiçbir koşulda geliştiricinin `.env` dosyasındaki gerçek SMTP
# hesabını kullanmamalı. Doğrudan atama bilinçlidir: yerel Google Workspace
# ayarı veya shell değişkeni pytest'e sızsa bile e-postalar yalnız konsola gider.
os.environ["EMAIL_PROVIDER"] = "console"
os.environ["SMTP_HOST"] = "localhost"
os.environ["SMTP_PORT"] = "1025"
os.environ["SMTP_USERNAME"] = ""
os.environ["SMTP_PASSWORD"] = ""
os.environ["SMTP_USE_TLS"] = "False"

# Pytest dış hizmetlere ve gerçek hesaplara çıkmaz.
os.environ["PAYMENT_PROVIDER"] = "fake"
os.environ["SMS_PROVIDER"] = "console"
os.environ["SUPPLIER_NETWORK_DISABLED"] = "True"
