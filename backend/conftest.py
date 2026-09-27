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

# pytest-xdist: her işçi AYRI Postgres veritabanı ve AYRI Redis db'si kullanır.
#
# Entegrasyon testleri fiziksel INSERT/DELETE yapar ve `_hijyen_nobetcisi`
# suite öncesi/sonrası tablo sayılarını karşılaştırır; iki işçi aynı DB'yi
# paylaşsa birinin satırı diğerinin sayımını bozardı. Bu yüzden işçi kimliği
# (`gw0`, `gw1`, ...) veritabanı adına eklenir: `test` → `test_gw0`. Ad hâlâ
# `test` içerdiği için `db_guard` kuralı değişmez; DB yoksa
# `tests/integration/conftest.py::_test_veritabani` oluşturup migrate eder.
#
# Redis: işçiler 9-13 arasını kullanır. 15 (tek süreç varsayılanı ve
# `test_presence_flush_pg.py`'nin sabit db'si) ve 14 (CI'da `tests/verify`
# adımı) BİLİNÇLİ olarak dışarıda: işçilerin rate-limit/presence anahtarları
# oralara sızmaz. En fazla 5 işçi.
#
# xdist yokken (`PYTEST_XDIST_WORKER` ayarsız) hiçbir şey değişmez. İşaret
# değişkeni, işçinin başlattığı alt süreçlerde (ör. `test_ip5_provider_guard_pg`
# içindeki iç pytest) ekin iki kez uygulanmasını önler.
_ISCI = os.environ.get("PYTEST_XDIST_WORKER", "")
if _ISCI and os.environ.get("ADANA_XDIST_AYRIK_ISCI") != _ISCI:
    _ISCI_REDIS_DBLERI = (9, 10, 11, 12, 13)
    _sira = int(_ISCI.removeprefix("gw"))
    if _sira >= len(_ISCI_REDIS_DBLERI):
        raise RuntimeError(
            f"pytest-xdist işçisi {_ISCI}: en fazla {len(_ISCI_REDIS_DBLERI)} "
            "işçi desteklenir (ayrı Redis db'si kalmadı); -n değerini düşürün."
        )
    os.environ["POSTGRES_DB"] = f"{os.environ['POSTGRES_DB']}_{_ISCI}"
    # REDIS_URL ayarsızsa dokunulmaz: varsayılan db0'dır ve `redis_guard`
    # onu tek süreçte olduğu gibi reddeder.
    _redis = os.environ.get("REDIS_URL")
    if _redis:
        _kok, _, _son = _redis.rpartition("/")
        if not _son.isdigit():  # yol yok: `redis://host:port`
            _kok = _redis.rstrip("/")
        os.environ["REDIS_URL"] = f"{_kok}/{_ISCI_REDIS_DBLERI[_sira]}"
    os.environ["ADANA_XDIST_AYRIK_ISCI"] = _ISCI


# ── Sınıfsız depolama değeri nöbetçisi (R2 adım 3) ───────────────────────────
#
# `storage.resolve_url` sınıflandıramadığı değeri kullanıcıya göstermez ama
# yutmaz da: `storage.unclassified_hits` sayacını artırır ve ERROR loglar.
# Üretimde bu bir log satırıdır; testte GÖRÜNÜR bir hataya dönüşür. Bilerek
# sınıfsız değer üreten test `@pytest.mark.sinifsiz_depo_degeri` ile işaretlenir.
import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _sinifsiz_depo_degeri_nobetcisi(request):
    from core import storage

    once = dict(storage.unclassified_hits)
    yield
    if request.node.get_closest_marker("sinifsiz_depo_degeri"):
        return
    fark = {
        k: v - once.get(k, 0)
        for k, v in storage.unclassified_hits.items()
        if v != once.get(k, 0)
    }
    if fark:
        pytest.fail(f"sınıfsız depolama değeri yanıta çözüldü: {fark}", pytrace=False)
