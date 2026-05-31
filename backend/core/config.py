from functools import lru_cache

from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    PROJECT_NAME: str = "Ceyhan Tutoring Marketplace"
    API_V1_PREFIX: str = "/api/v1"

    BACKEND_CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    POSTGRES_USER: str
    POSTGRES_PASSWORD: str
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str

    DB_ECHO: bool = False
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20

    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    # Refresh token (DB-tabanlı, rotasyonlu): access süresi dolunca sessizce yenilenir.
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    LAST_SEEN_THROTTLE_SECONDS: int = 60

    REDIS_URL: str = "redis://localhost:6379/0"
    PRESENCE_ONLINE_TTL_SECONDS: int = 300
    PRESENCE_FLUSH_INTERVAL_SECONDS: int = 300

    # Rate limiting (Redis fixed-window). Redis erişilemezse fail-open.
    # IP bazlı (auth uçları):
    RATE_LIMIT_WINDOW_SECONDS: int = 60
    RATE_LIMIT_LOGIN: int = 10
    RATE_LIMIT_REGISTER: int = 5
    # Kullanıcı bazlı (yazma uçları; pencere = RATE_LIMIT_WINDOW_SECONDS):
    RATE_LIMIT_BOOKING: int = 10
    RATE_LIMIT_MESSAGE: int = 30
    RATE_LIMIT_QA: int = 15
    RATE_LIMIT_DEMAND: int = 10
    RATE_LIMIT_REVIEW: int = 10
    RATE_LIMIT_PAYMENT: int = 10
    RATE_LIMIT_REPORT: int = 5

    AWS_ACCESS_KEY_ID: str = "minioadmin"
    AWS_SECRET_ACCESS_KEY: str = "minioadmin"
    AWS_REGION_NAME: str = "us-east-1"
    AWS_BUCKET_NAME: str = "avatars"
    AWS_ENDPOINT_URL: str = "http://localhost:9000"
    MAX_AVATAR_SIZE_BYTES: int = 5 * 1024 * 1024
    # Ders materyali (dosya eki) yükleme limiti.
    MAX_RESOURCE_SIZE_BYTES: int = 10 * 1024 * 1024

    # E-posta linklerinin (doğrulama/şifre sıfırlama) işaret edeceği frontend kökü.
    FRONTEND_BASE_URL: str = "http://localhost:5173"

    # E-posta gönderimi. EMAIL_PROVIDER: "console" (loglar) | "smtp" (MailHog/SES vb.).
    # Geliştirmede "smtp" + MailHog (port 1025) ya da "console" yeterlidir; gerçek
    # sağlayıcı yalnızca üretimde gerekir.
    EMAIL_PROVIDER: str = "console"
    EMAIL_FROM: str = "no-reply@ceyhan.local"
    EMAIL_FROM_NAME: str = "Ceyhan Özel Ders"
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 1025
    SMTP_USERNAME: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_USE_TLS: bool = False
    SMTP_TIMEOUT_SECONDS: int = 10

    # Doğrulama / şifre sıfırlama token ömürleri.
    EMAIL_VERIFY_TOKEN_TTL_HOURS: int = 24
    PASSWORD_RESET_TOKEN_TTL_HOURS: int = 2

    # Ödeme (escrow). PAYMENT_PROVIDER: "fake" (geliştirme; anında başarı) | "iyzico".
    # Geliştirmede dış hesap/anahtar GEREKMEZ ("fake"). Komisyon oranı 0..1 arası.
    PAYMENT_PROVIDER: str = "fake"
    PAYMENT_CURRENCY: str = "TRY"
    PLATFORM_COMMISSION_RATE: float = 0.10
    # iyzico (yalnızca PAYMENT_PROVIDER=iyzico iken gerekir; sandbox URL'i default).
    IYZICO_API_KEY: str | None = None
    IYZICO_SECRET_KEY: str | None = None
    IYZICO_BASE_URL: str = "https://sandbox-api.iyzipay.com"

    # E-posta tetikleyen endpoint'ler için IP rate-limit (Redis, fail-open).
    RATE_LIMIT_EMAIL: int = 5

    # Gözlemlenebilirlik. Sentry yalnızca SENTRY_DSN verilirse etkinleşir (yoksa
    # no-op — geliştirmede dış hesap gerekmez). Request-id her zaman çalışır.
    LOG_LEVEL: str = "INFO"
    SENTRY_DSN: str | None = None
    SENTRY_ENVIRONMENT: str = "development"
    SENTRY_TRACES_SAMPLE_RATE: float = 0.0

    AUTO_CREATE_DB: bool = True
    ADMIN_EMAIL: str | None = None
    ADMIN_PASSWORD: str | None = None
    ADMIN_FULL_NAME: str = "System Admin"

    BAYESIAN_CONFIDENCE: float = 10.0
    BAYESIAN_PRIOR_MEAN: float = 3.5

    QA_WEEKLY_QUOTA: int = 3
    QA_QUOTA_WINDOW_DAYS: int = 7
    QA_QUESTIONS_PER_LESSON: int = 3

    # ACCEPTED bir ders, bitişinden bu kadar saat sonra hâlâ tamamlanmadıysa arka
    # plan görevi tarafından otomatik COMPLETED'a geçirilir (review/QA açılsın diye).
    AUTO_COMPLETE_GRACE_HOURS: int = 12

    # Müsaitlik/yerel saat hesapları için sabit ofset (Türkiye UTC+3, DST yok).
    APP_UTC_OFFSET_HOURS: int = 3

    @computed_field
    @property
    def DATABASE_URL(self) -> str:
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
