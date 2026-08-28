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

os.environ["SMS_PROVIDER"] = "console"

# TB-21: ödeme sağlayıcısı ve tedarikçi ağ kilidi `setdefault` İLE konur;
# doğrudan atama DEĞİL. Sebep ölçüldü (CI koşumu 33202874820, 247 test):
#
# `setdefault` yalnız değişken YOKKEN korur, açıkça verilmiş bir gerçek
# sağlayıcıyı ezmez — ezmesi de yanlış olurdu, env ayarın son sözüdür. O durum
# için ikinci savunma vardır: `tests/integration/db_guard.py` gerçek sağlayıcı
# görürse suite'i hiç başlatmaz ve `test_ip5_provider_guard_pg.py::test_t1b`
# tam olarak bunu sınar.
#
# Doğrudan atamaya çevrildiğinde nöbetçi asla tetiklenmedi: t1b'nin başlattığı
# alt süreç suite'i sonuna kadar koştu ve ANA KOŞUMLA AYNI test veritabanındaki
# ortak ürün kategorisini teardown'da sildi. Ana koşumun kalan testleri
# kategoriyi bulamadı.
#
# Aynı gerekçe tedarikçi kilidi için de geçerli: canlı doğrulama turunda
# açıkça `0` verilebilmelidir.
os.environ.setdefault("PAYMENT_PROVIDER", "fake")
os.environ.setdefault("SUPPLIER_NETWORK_DISABLED", "True")
