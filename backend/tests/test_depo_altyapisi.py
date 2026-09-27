"""R2 geçişi altyapı sözleşmesi (27 Eyl 2026, adım 4).

Compose, Caddy ve örnek env dosyaları uygulama koduyla aynı kuralı taşımalı:
üretimde depo R2'dir, adres `.env.prod`'dan gelir (compose onu ezmez), public ve
private bucket ayrıdır, private dosya bu sunucudan ya da CDN'den geçmez.
"""
from __future__ import annotations

from pathlib import Path

import yaml

from core.config import Settings

KOK = Path(__file__).resolve().parents[2]


def _yaml(ad: str) -> dict:
    return yaml.safe_load((KOK / ad).read_text(encoding="utf-8"))


def _env_ornegi(ad: str) -> dict[str, str]:
    out = {}
    for satir in (KOK / ad).read_text(encoding="utf-8").splitlines():
        satir = satir.strip()
        if satir and not satir.startswith("#") and "=" in satir:
            k, v = satir.split("=", 1)
            out[k.strip()] = v.strip()
    return out


# ── Üretim compose ──────────────────────────────────────────────────────────


def test_prod_backend_depo_adresini_ezmiyor_ve_zorunlu_kiliyor():
    env = _yaml("docker-compose.prod.yml")["services"]["backend"]["environment"]
    assert "minio" not in str(env.get("AWS_ENDPOINT_URL")), "MinIO adresi .env'i eziyor"
    for anahtar in ("AWS_ENDPOINT_URL", "S3_PUBLIC_BUCKET", "S3_PRIVATE_BUCKET", "S3_PUBLIC_BASE_URL"):
        assert str(env.get(anahtar, "")).startswith(f"${{{anahtar}:?"), anahtar
    assert env.get("S3_MANAGE_BUCKETS") == "False"
    # Sırlar compose'a yazılmaz; yalnız env_file'dan gelir.
    assert "AWS_SECRET_ACCESS_KEY" not in env
    assert "AWS_ACCESS_KEY_ID" not in env


def test_prod_minio_yalniz_gecis_profilinde_ve_veri_korunuyor():
    compose = _yaml("docker-compose.prod.yml")
    assert compose["services"]["minio"].get("profiles") == ["eski-depo"]
    assert "minio" not in (compose["services"]["backend"].get("depends_on") or {})
    assert "miniodata" in compose["volumes"], "eski veri volume'ü kopyalama bitmeden silinmez"


def test_caddy_eski_depo_proxy_si_kaldirildi():
    caddy = (KOK / "devops/Caddyfile").read_text(encoding="utf-8")
    assert "depo.{$DOMAIN}" not in caddy
    assert "reverse_proxy minio" not in caddy


# ── Örnek env dosyaları ─────────────────────────────────────────────────────


def test_prod_env_ornegi_iki_ayri_bucket_ve_cdn():
    env = _env_ornegi(".env.prod.example")
    assert env["S3_PUBLIC_BUCKET"] and env["S3_PRIVATE_BUCKET"]
    assert env["S3_PUBLIC_BUCKET"] != env["S3_PRIVATE_BUCKET"]
    assert env["S3_PUBLIC_BASE_URL"] == "https://cdn.adanaozelders.com.tr"
    assert env["AWS_ENDPOINT_URL"].endswith(".r2.cloudflarestorage.com")
    assert "S3_PUBLIC_ENDPOINT_URL" not in env, "R2'de ayrı tarayıcı adresi yok"


def test_prod_env_ornegi_depo_degerleri_guardi_gecer():
    """Örnekteki depo değerleri üretim guard'ından geçmeli (sır yer tutucularıyla)."""
    env = _env_ornegi(".env.prod.example")
    depo = {k: env[k] for k in env if k.startswith(("AWS_", "S3_"))}
    s = Settings(
        _env_file=None,
        ENVIRONMENT="production",
        POSTGRES_USER="u", POSTGRES_PASSWORD="p", POSTGRES_DB="d",
        JWT_SECRET_KEY="x" * 48,
        PAYMENT_PROVIDER="iyzico", IYZICO_API_KEY="k", IYZICO_SECRET_KEY="s",
        EMAIL_PROVIDER="smtp", SMS_PROVIDER="netgsm",
        AUTO_CREATE_DB=False, SEED_DEMO_DATA=False,
        BACKEND_CORS_ORIGINS=["https://adanaozelders.com.tr"],
        TRUSTED_PROXY_IPS=["127.0.0.1"],
        FRONTEND_BASE_URL="https://adanaozelders.com.tr",
        BACKEND_BASE_URL="https://api.adanaozelders.com.tr",
        VROOM_URL="http://vroom:3000",
        S3_MANAGE_BUCKETS=False,  # compose environment'ta sabit
        **depo,
    )
    assert s.is_production


# ── Yerel compose: MinIO desteği korunur, iki bucket modu açılabilir ─────────


def test_yerel_compose_minio_tek_ve_iki_bucket_destekler():
    compose = _yaml("docker-compose.yml")
    init = compose["services"]["minio-init"]["entrypoint"]
    assert "mc anonymous set download" not in init, "bucket'ın tamamı anonim açılmaz"
    assert "S3_PUBLIC_BUCKET" in init and "S3_PRIVATE_BUCKET" in init
    env = compose["services"]["backend"]["environment"]
    assert env["AWS_ENDPOINT_URL"] == "http://minio:9000"
    assert "S3_PUBLIC_BUCKET" in env and "S3_PRIVATE_BUCKET" in env
