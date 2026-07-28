"""Settings._guard_production — üretimde tehlikeli varsayılanları reddeder.

Geliştirme kolaylığı için seçilmiş fail-open varsayılanlar (sahte ödeme
sağlayıcısı, console SMS/e-posta, demo seed, açılışta migration) üretime
sızarsa sessizce yanlış çalışır: `PAYMENT_PROVIDER=fake` para tahsil etmeden
sipariş kapatır, `SMS_PROVIDER=console` teslimat OTP'sini müşteriye değil loga
yazar. Guard bu durumda uygulamanın AÇILMAMASINI sağlar.
"""
from __future__ import annotations

import pytest

from core.config import Settings

# Guard'ı geçen (üretime uygun) taban yapılandırma.
_SAFE: dict[str, object] = {
    "ENVIRONMENT": "production",
    "POSTGRES_USER": "u",
    "POSTGRES_PASSWORD": "p",
    "POSTGRES_DB": "d",
    "JWT_SECRET_KEY": "x" * 48,
    "PAYMENT_PROVIDER": "iyzico",
    "IYZICO_API_KEY": "k",
    "IYZICO_SECRET_KEY": "s",
    "EMAIL_PROVIDER": "smtp",
    "SMS_PROVIDER": "netgsm",
    "AUTO_CREATE_DB": False,
    "SEED_DEMO_DATA": False,
    "AWS_ACCESS_KEY_ID": "gercek-anahtar",
    "AWS_SECRET_ACCESS_KEY": "gercek-gizli",
    "BACKEND_CORS_ORIGINS": ["https://adanaozelders.com.tr"],
    "TRUSTED_PROXY_IPS": ["127.0.0.1"],
    "FRONTEND_BASE_URL": "https://adanaozelders.com.tr",
    "BACKEND_BASE_URL": "https://api.adanaozelders.com.tr",
}


def _settings(**overrides: object) -> Settings:
    # _env_file=None: geliştiricinin gerçek .env'i teste sızmasın.
    return Settings(_env_file=None, **{**_SAFE, **overrides})  # type: ignore[arg-type]


def test_guvenli_uretim_yapilandirmasi_gecer() -> None:
    s = _settings()
    assert s.is_production is True


def test_gelistirme_ortaminda_guard_calismaz() -> None:
    # Varsayılanların tamamı "tehlikeli" ama ENVIRONMENT=development → sorun yok.
    s = Settings(
        _env_file=None,
        ENVIRONMENT="development",
        POSTGRES_USER="u",
        POSTGRES_PASSWORD="p",
        POSTGRES_DB="d",
        JWT_SECRET_KEY="kisa",
    )
    assert s.is_production is False
    assert s.PAYMENT_PROVIDER == "fake"


@pytest.mark.parametrize(
    ("overrides", "beklenen"),
    [
        ({"PAYMENT_PROVIDER": "fake"}, "PAYMENT_PROVIDER"),
        ({"PAYMENT_PROVIDER": "bilinmeyen"}, "PAYMENT_PROVIDER"),
        ({"IYZICO_SECRET_KEY": None}, "IYZICO"),
        ({"EMAIL_PROVIDER": "console"}, "EMAIL_PROVIDER"),
        ({"SMS_PROVIDER": "console"}, "SMS_PROVIDER"),
        ({"AUTO_CREATE_DB": True}, "AUTO_CREATE_DB"),
        ({"SEED_DEMO_DATA": True}, "SEED_DEMO_DATA"),
        ({"JWT_SECRET_KEY": "kisa-anahtar"}, "JWT_SECRET_KEY"),
        ({"JWT_SECRET_KEY": "change-this-to-a-long-random-secret-x"}, "JWT_SECRET_KEY"),
        ({"ADMIN_PASSWORD": "change-this-admin-password"}, "ADMIN_PASSWORD"),
        ({"AWS_ACCESS_KEY_ID": "minioadmin"}, "minioadmin"),
        ({"BACKEND_CORS_ORIGINS": ["http://localhost:5173"]}, "CORS"),
        ({"TRUSTED_PROXY_IPS": []}, "TRUSTED_PROXY_IPS"),
        ({"FRONTEND_BASE_URL": "http://adanaozelders.com.tr"}, "https"),
    ],
)
def test_tehlikeli_ayar_uretimde_reddedilir(
    overrides: dict[str, object], beklenen: str
) -> None:
    with pytest.raises(ValueError, match=beklenen):
        _settings(**overrides)


def test_birden_cok_sorun_tek_hatada_toplanir() -> None:
    """Guard ilk sorunda durmaz — tüm eksikler tek seferde raporlanır
    (deploy sırasında sırayla keşfetmek yerine hepsini bir kerede görün)."""
    with pytest.raises(ValueError) as exc:
        _settings(PAYMENT_PROVIDER="fake", SMS_PROVIDER="console", SEED_DEMO_DATA=True)
    mesaj = str(exc.value)
    assert "PAYMENT_PROVIDER" in mesaj
    assert "SMS_PROVIDER" in mesaj
    assert "SEED_DEMO_DATA" in mesaj
