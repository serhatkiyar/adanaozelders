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
# TB-21: sahte ödeme sağlayıcısı test ortamının VARSAYILANIDIR.
#
# Bu satır olmadan geliştiricinin `.env`'indeki `PAYMENT_PROVIDER=iyzico`
# (sandbox anahtarlarıyla, canlı doğrulama için bilinçli) testlere sızıyordu:
# entegrasyon conftest'i çoğu yolda `FakePaymentProvider`'ı fixture ile
# enjekte ediyor, ama sağlayıcıyı fixture'dan almayan yollar GERÇEKTEN
# sandbox'a ağ isteği atıyordu. Ölçülmüş kanıt: `test_ip1b_silme_guard_pg
# ::test_D4_...` → `402: email hatalı format ile gönderilmiştir`, istek
# `sandbox-api.iyzipay.com`'a gitmiş.
#
# Zararın en sinsi yüzü üçüncüsüdür: sandbox isteği BAŞARILI olsaydı test
# yeşil kalır ve fake sağlayıcı yolunun hiç sınanmadığı fark edilmezdi.
#
# `setdefault` yalnız değişken YOKKEN korur — açıkça verilmiş bir gerçek
# sağlayıcıyı ezmez (ezmesi de yanlış olurdu; env ayarın son sözüdür). O
# durum için ikinci savunma vardır: `tests/integration/db_guard.py
# ::assert_fake_payment_provider` suite'i başlatmaz.
os.environ.setdefault("PAYMENT_PROVIDER", "fake")
