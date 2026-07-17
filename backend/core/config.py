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

    PROJECT_NAME: str = "Adana Özel Ders"
    API_V1_PREFIX: str = "/api/v1"

    BACKEND_CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        # Yerel ağ (telefon vb.) erişimi — makinenin Wi-Fi IP'si.
        "http://10.62.0.178:5173",
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
    # Alan-düzeyi şifreleme anahtarı (TCKN gibi hassas veri at-rest). Verilmezse
    # JWT_SECRET_KEY'den türetilir; ÜRETİMDE ayrı, kalıcı bir değer tut (değişirse
    # eski şifreli veri çözülemez).
    FIELD_ENCRYPTION_KEY: str | None = None
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
    # To-do görev/alt görev yazma uçları (kullanıcı bazlı; hızlı ekleme için yüksek).
    RATE_LIMIT_TASK: int = 60

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
    # Backend'in dışarıdan erişilen kökü — iyzico ödeme callback URL'i bundan üretilir.
    # (Sandbox'ta da çalışır: callback sunucu-sunucu değil, kullanıcının TARAYICISININ
    # POST'udur; localhost'a erişebilir.)
    BACKEND_BASE_URL: str = "http://localhost:8000"
    # Oturumsuz kargo takip linkinin (SMS'le paylaşılır) kökü. Üretimde ayrı
    # subdomain; geliştirmede frontend kökü + /kargo-takip yolu kullanılır.
    PUBLIC_TRACKING_BASE_URL: str = "http://localhost:5173/kargo-takip"

    # E-posta gönderimi. EMAIL_PROVIDER: "console" (loglar) | "smtp" (MailHog/SES vb.).
    # Geliştirmede "smtp" + MailHog (port 1025) ya da "console" yeterlidir; gerçek
    # sağlayıcı yalnızca üretimde gerekir.
    EMAIL_PROVIDER: str = "console"
    EMAIL_FROM: str = "no-reply@adanaozelders.com.tr"
    EMAIL_FROM_NAME: str = "Adana Özel Ders"
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 1025
    SMTP_USERNAME: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_USE_TLS: bool = False
    SMTP_TIMEOUT_SECONDS: int = 10

    # Doğrulama / şifre sıfırlama token ömürleri.
    EMAIL_VERIFY_TOKEN_TTL_HOURS: int = 24
    PASSWORD_RESET_TOKEN_TTL_HOURS: int = 2

    # SMS / telefon doğrulama. SMS_PROVIDER: "console" (loglar; dış hesap gerekmez) |
    # "netgsm" (üretim). Geliştirmede "console" yeterli — kod backend loglarında.
    SMS_PROVIDER: str = "console"
    PHONE_OTP_TTL_MINUTES: int = 10
    PHONE_OTP_MAX_ATTEMPTS: int = 5
    # Netgsm (yalnızca SMS_PROVIDER=netgsm iken gerekir).
    NETGSM_USERCODE: str | None = None
    NETGSM_PASSWORD: str | None = None
    NETGSM_MSGHEADER: str | None = None

    # Ödeme (escrow). PAYMENT_PROVIDER: "fake" (geliştirme; anında başarı) | "iyzico".
    # Geliştirmede dış hesap/anahtar GEREKMEZ ("fake"). Komisyon oranı 0..1 arası.
    PAYMENT_PROVIDER: str = "fake"
    PAYMENT_CURRENCY: str = "TRY"
    PLATFORM_COMMISSION_RATE: float = 0.10
    # Mağaza kargo: eşikli ücretsiz kargo. Eşik (TL) ve üstü sipariş ücretsiz;
    # altındaki fiziksel siparişe sabit ücret. (Frontend lib/shipping.ts ile aynı.)
    SHIPPING_FREE_THRESHOLD: float = 500.0
    SHIPPING_FLAT_FEE: float = 49.90
    # Kendi-filo teslimat (mağaza kitap dağıtımı). Depo = turun başlangıç noktası
    # (Seyhan Çakmak Cad. civarı; kesinleşince .env'den güncellenir). Teslim OTP'si
    # kapıda müşterinin söylediği koddur — telefon doğrulama OTP'sinden ayrıdır.
    DELIVERY_DEPOT_LAT: float = 36.985500
    DELIVERY_DEPOT_LNG: float = 35.325300
    DELIVERY_OTP_TTL_MINUTES: int = 30
    DELIVERY_OTP_MAX_ATTEMPTS: int = 5
    # Rota optimizasyonu (Faz B). ROUTING_PROVIDER: "auto" (VROOM dene, düşerse
    # haversine — geliştirmede kurulumsuz çalışır) | "vroom" | "haversine".
    # VROOM+OSRM: `docker compose --profile routing up` + scripts/setup-osrm-adana.ps1
    ROUTING_PROVIDER: str = "auto"
    VROOM_URL: str = "http://localhost:3000"
    # Durak başına paket teslim servis süresi (sn) — ETA hesabına girer.
    DELIVERY_STOP_SERVICE_SECONDS: int = 180
    # "Rotayı bozan durak" eşiği: durağın rotaya kattığı ek yol (km) bunu
    # aşarsa panelde işaretlenir (dış kuryeye devretme adayı).
    DELIVERY_DETOUR_KM: float = 8.0
    # Cıncık Teslimat sözü: yerel saatle bu saatten ÖNCE ödenen Adana-içi sipariş
    # aynı gün, sonrası ertesi gün teslim edilir; çalışılmayan güne (weekday();
    # 6=Pazar) denk gelirse ileri sarılır (services/delivery_promise.py).
    DELIVERY_CUTOFF_HOUR: int = 16
    DELIVERY_NON_WORKING_WEEKDAYS: list[int] = [6]
    # Kendi-filo teslimat bölgesi: pin varsa depoya Haversine yarıçapı (otorite),
    # pin yoksa il=Adana + ilçe listesi fallback'i. Bölge dışı sipariş eligible
    # listesine girmez; admin "dış kargo bekliyor" kuyruğunda görür.
    DELIVERY_ZONE_RADIUS_KM: float = 25.0
    DELIVERY_ZONE_DISTRICTS: list[str] = ["Seyhan", "Yüreğir", "Çukurova", "Sarıçam"]
    # Müşteriye gösterilen varış penceresi: stop.eta − early … eta + late,
    # 15 dk'ya yuvarlı ("18:00–19:00"). Nokta ETA müşteriye gösterilmez.
    DELIVERY_ETA_WINDOW_EARLY_MINUTES: int = 15
    DELIVERY_ETA_WINDOW_LATE_MINUTES: int = 45
    # "Günü Optimize Et": konumlu sipariş sayısı bu eşiği aşarsa ikinci araç
    # (COROLLA) devreye girer; altındaysa tek LADA turu kurulur.
    DELIVERY_SINGLE_VEHICLE_MAX_STOPS: int = 12
    # Bir durak sonuçlanınca sıradaki bu kadar müşteriye "kuryen yaklaşıyor"
    # SMS+bildirimi gider (durak başına tek sefer — approach_notified_at damgası).
    DELIVERY_NEXT_NOTIFY_COUNT: int = 2
    # Kapasiteye duyarlı söz: bir güne en fazla bu kadar bölge-içi teslimat sözü
    # verilir (16:00 cutoff'u geçen HERKESE "yarın" demek kampanya günü toplu söz
    # ihlali üretir — dolu gün atlanıp sonraki çalışma gününe söz verilir).
    # 0 = kapasite kontrolü KAPALI (sınırsız).
    DELIVERY_DAILY_CAPACITY: int = 30
    # Watchdog: bu kadar saattir hâlâ ACTIVE olan tur (kurye telefonu öldü,
    # tamamlamayı unuttu…) otomatik iptal edilir — bekleyen duraklar FAILED,
    # siparişler PAID'e döner, adminlere alarm bildirimi gider. 0 = kapalı.
    DELIVERY_STALE_RUN_HOURS: int = 14
    # Outbox worker'ı: bekleyen SMS/e-posta olaylarını bu aralıkla gönderir.
    OUTBOX_DISPATCH_INTERVAL_SECONDS: int = 15
    OUTBOX_MAX_ATTEMPTS: int = 8
    # Lansman promosyonu: kayıttan itibaren ilk N ay indirimli/0 komisyon. MONTHS=0
    # ise KAPALI (varsayılan: düz %10, kampanya yok). Açmak için .env'de ayarla.
    LAUNCH_PROMO_MONTHS: int = 0
    LAUNCH_PROMO_COMMISSION_RATE: float = 0.0
    # iyzico (yalnızca PAYMENT_PROVIDER=iyzico iken gerekir; sandbox URL'i default).
    IYZICO_API_KEY: str | None = None
    IYZICO_SECRET_KEY: str | None = None
    IYZICO_BASE_URL: str = "https://sandbox-api.iyzipay.com"

    # Escrow iade mutabakatı (reconciler — bkz. services/escrow.py):
    # REFUNDING'de sarkan kayıt, niyet damgasından bu kadar dakika geçmeden ellenmesin
    # (uçuştaki istekle yarışma); deneme sınırı aşılınca yalnız alarm (retry durur).
    REFUND_RECONCILE_MIN_AGE_MINUTES: int = 15
    REFUND_MAX_ATTEMPTS: int = 3
    # Bayat checkout mutabakatı (callback hiç gelmemiş/varlık iptal edilmişken ödenmiş
    # oturumlar): bu yaştan eski ve şu pencereden yeni kayıtlar sağlayıcıdan doğrulanır.
    CHECKOUT_RECONCILE_MIN_AGE_MINUTES: int = 15
    CHECKOUT_RECONCILE_MAX_AGE_HOURS: int = 48
    CHECKOUT_RECONCILE_INTERVAL_SECONDS: int = 900

    # E-posta tetikleyen endpoint'ler için IP rate-limit (Redis, fail-open).
    RATE_LIMIT_EMAIL: int = 5
    # SMS OTP gönderimi — kullanıcı bazlı (spam/maliyet koruması).
    RATE_LIMIT_SMS: int = 5
    # Adres arama (geocode) proxy'si — kullanıcı bazlı (typeahead için yüksek).
    RATE_LIMIT_GEOCODE: int = 90
    # Oturumsuz kargo takibi (SMS linki) — IP bazlı (token brute-force koruması).
    RATE_LIMIT_TRACKING: int = 60

    # Adres arama/geocode. Sağlayıcıdan bağımsız (core/payments, core/mail deseni):
    #   GOOGLE_MAPS_API_KEY verilirse Google Places API (New) + Geocoding kullanılır
    #   (autocomplete session token + field mask ile maliyet düşük; anahtar yalnız
    #   sunucuda durur, istemciye sızmaz). Verilmezse Nominatim/OpenStreetMap'e
    #   fallback edilir — geliştirmede DIŞ HESAP/ANAHTAR GEREKMEZ.
    GOOGLE_MAPS_API_KEY: str | None = None
    # Ters-geocode (koordinat→adres; harita sürükleme/geolocation) için Google
    # Places API (New) yetmez → Geocoding API gerekir. Maliyet (en sık çağrı) ve
    # "yalnız Places API açık kalsın" için varsayılan: key olsa bile reverse'i
    # ücretsiz Nominatim'e ver. False yaparsan reverse de Google'a gider (o zaman
    # konsolda "Geocoding API" de etkin olmalı). İleri arama (autocomplete/details)
    # her hâlükârda key varsa Google'ı kullanır.
    GEOCODE_REVERSE_USE_NOMINATIM: bool = True
    GEOCODE_COUNTRY: str = "tr"
    GEOCODE_LANGUAGE: str = "tr"
    # Sonuçları yerele yaklaştırmak için arama yanlılığı (Adana merkezli — depo çevresi).
    GEOCODE_BIAS_LAT: float = 36.985500
    GEOCODE_BIAS_LNG: float = 35.325300
    GEOCODE_BIAS_RADIUS_M: int = 30000

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

    # Görev son tarihi bu kadar dakika kala (ve geçmiş ama hatırlatılmamış görevler için)
    # bir kez hatırlatma bildirimi gönderilir.
    TASK_REMINDER_LEAD_MINUTES: int = 60

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
