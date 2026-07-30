"""Yıkıcı entegrasyon testlerinin veritabanı kilidi (saf, DB gerektirmez).

Kilit `tests/integration/db_guard.py`'de ve `pg` fixture'ından çağrılıyor. Bu
testler kilidin gerçekten kilitlediğini doğrular: entegrasyon testleri fiziksel
INSERT/DELETE yapıyor ve bir tanesi dağıtım kuyruğundaki siparişleri geçici
olarak park ediyor — yanlış veritabanına bağlanmış bir koşu canlı operasyonu
bozar.
"""
from __future__ import annotations

import pytest

from tests.integration.db_guard import UnsafeTestDatabase, assert_test_database


def test_uretim_ortami_HER_HALDE_reddedilir():
    """Veritabanı adı ne olursa olsun üretimde koşmanın meşru hâli yok."""
    for db in ("ceyhandb", "adana_test", "her_neyse"):
        with pytest.raises(UnsafeTestDatabase) as exc:
            assert_test_database(environment="production", database=db)
        assert "production" in str(exc.value)


def test_bilinmeyen_veritabani_adi_reddedilir():
    """Yanlış `POSTGRES_DB` ile koşmak sessizce geçmemeli."""
    for db in ("adana_canli", "musteri_db", "ceyhan_prod", "postgres"):
        with pytest.raises(UnsafeTestDatabase):
            assert_test_database(environment="development", database=db)


def test_bos_veritabani_adi_reddedilir():
    with pytest.raises(UnsafeTestDatabase):
        assert_test_database(environment="development", database="")


def test_gelistirme_veritabani_ve_test_adlari_kabul_edilir():
    # Projenin geliştirme veritabanı: entegrasyon testleri bilinçli olarak ona
    # karşı koşar (bkz. tests/integration/conftest.py başlığı).
    assert_test_database(environment="development", database="ceyhandb")
    assert_test_database(environment="staging", database="ceyhandb")
    # Adında "test" geçen her ad güvenli sayılır.
    assert_test_database(environment="development", database="my_test_db")
    assert_test_database(environment="development", database="TEST")


def test_env_ile_ek_izin_verilebilir(monkeypatch):
    """CI kendi veritabanı adını açıkça beyan edebilir."""
    with pytest.raises(UnsafeTestDatabase):
        assert_test_database(environment="development", database="ci_kosum")

    monkeypatch.setenv("INTEGRATION_TEST_DB_ALLOW", "ci_kosum, baska_db")
    assert_test_database(environment="development", database="ci_kosum")
    assert_test_database(environment="development", database="baska_db")

    # Ek izin ÜRETİMİ açmaz — ortam kontrolü her şeyin önünde.
    with pytest.raises(UnsafeTestDatabase):
        assert_test_database(environment="production", database="ci_kosum")


def test_allowlist_denylist_DEGIL():
    """Bilmediğimiz bir üretim adı denylist'ten kaçardı; allowlist'ten kaçamaz.

    Bu test kuralın yönünü sabitler: yeni bir ad eklemek BİLİNÇLİ bir karar
    olmalı, tahmin edilen kötü kelimelerin listesi değil.
    """
    with pytest.raises(UnsafeTestDatabase):
        # İçinde "prod"/"live" gibi bir ipucu YOK ama güvenli de değil.
        assert_test_database(environment="development", database="adana")
