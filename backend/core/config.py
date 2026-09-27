from functools import lru_cache
from typing import Literal

from pydantic import computed_field, model_validator
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

    # Çalışma ortamı. "production" iken açılışta sertleştirme guard'ı koşar
    # (bkz. _guard_production): geliştirme kolaylığı için konmuş fail-open
    # varsayılanların (sahte ödeme, console SMS/e-posta, demo seed, otomatik
    # şema kurulumu, zayıf sır) üretime sızması UYGULAMAYI AÇTIRMAZ.
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"

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
    # Bağlantıyı bu süreden sonra yenile. Havuzdaki bağlantılar sonsuza dek
    # yaşarsa, araya giren bir NAT/load balancer sessizce düşürdüğü bağlantıyı
    # uygulama "canlı" sanar ve ilk sorguda kopuk-boru hatası alır.
    DB_POOL_RECYCLE_SECONDS: int = 1800
    # Havuz doluysa bir istek bağlantı için ne kadar bekler. Varsayılan (30 sn)
    # trafik dalgasında istekleri yığar; erken 500 vermek yığılmadan iyidir.
    DB_POOL_TIMEOUT_SECONDS: int = 10
    # Sunucu tarafı sorgu tavanı. Kaçak bir sorgu (indekssiz büyük tablo taraması)
    # bağlantıyı süresiz tutup havuzu tüketmesin. 0 = kapalı.
    DB_STATEMENT_TIMEOUT_MS: int = 15000

    # Object storage (S3/MinIO) ağ davranışı: varsayılan botocore ayarları
    # bağlantı başına ~60 sn bekler ve 5 kez dener → erişilemez MinIO'da tek
    # istek dakikalarca DB session'ı tutar.
    S3_CONNECT_TIMEOUT_SECONDS: int = 3
    S3_READ_TIMEOUT_SECONDS: int = 10
    S3_MAX_ATTEMPTS: int = 2
    # Hassas dosyalar (`private/` öneki) anonim okunamaz; imzalı URL ile sunulur.
    # TTL istemci önbelleğinden UZUN olmalı: React Query'de duran bir yanıtın
    # içindeki imza, kullanıcı sayfaya dönmeden önce ölürse görsel kırılır.
    S3_PRESIGN_TTL_SECONDS: int = 3600
    # Tarayıcının depolamaya eriştiği adres. Compose'da backend MinIO'ya
    # `http://minio:9000` ile bağlanır ama tarayıcı o adı çözemez; imza host'u
    # kapsadığından presigned URL de bu adresle üretilmelidir. Boşsa
    # AWS_ENDPOINT_URL kullanılır (tek adresli kurulumlarda fark yoktur).
    S3_PUBLIC_ENDPOINT_URL: str = ""
    # ── İki bucket (27 Eyl 2026, R2 geçişi) ──
    # Public ve private dosyalar AYRI bucket'larda durur: R2'de önek bazlı
    # bucket policy yok, custom domain bağlanan bucket'ın tamamı herkese açılır.
    # Boş bırakılırsa ikisi de AWS_BUCKET_NAME olur (tek bucket'lı yerel MinIO;
    # ayrımı orada önek whitelist'li policy yapar). Üretimde ikisi de zorunlu ve
    # birbirinden farklı olmalıdır (_guard_production).
    S3_PUBLIC_BUCKET: str = ""
    S3_PRIVATE_BUCKET: str = ""
    # Public dosyaların tarayıcıya verilen kök adresi (ör. https://cdn.alan.com).
    # Yol biçimi `{S3_PUBLIC_BASE_URL}/{key}` — bucket adı yolda YOK. Boşsa
    # `{S3_PUBLIC_ENDPOINT_URL veya AWS_ENDPOINT_URL}/{public bucket}` (MinIO).
    # Private dosyalar bu adresle ASLA üretilmez; imza yalnız S3 API adresinde.
    S3_PUBLIC_BASE_URL: str = ""
    # Açılışta bucket oluşturma + policy yazma. Yalnız kendi MinIO'muzda True;
    # R2/AWS'de bucket'lar konsoldan yönetilir (R2 PutBucketPolicy desteklemez).
    S3_MANAGE_BUCKETS: bool = True
    # Eski depolama kökleri (virgülle ayrılmış), ör.
    # `https://depo.adanaozelders.com.tr/avatars`. R2 geçişinden sonra DB'de
    # kalan eski tam adresler bu köklerle AÇIKÇA tanınır: anahtarı çıkarılıp
    # yeni bucket'tan sunulur (private → imzalı, public → CDN), sınıfsız olan
    # yanıttan çıkarılır. Dış adres gibi olduğu gibi GEÇİRİLMEZ.
    S3_LEGACY_BASE_URLS: str = ""
    # Ürün görselleri için ÜST SINIR (piksel) — sabit çıktı boyutu DEĞİL.
    # Her ürün görseli beyaz zeminli bir KAREYE pad'lenir (kırpılmaz), ama
    # tuvalin kenarı bu sayı değil, küçültme sonrası İÇERİĞİN UZUN KENARIDIR:
    # büyük görsel önce bu sınıra indirilir, küçük görsel olduğu gibi kalır
    # (400×580 → 580×580, 2000×1000 → 1200×1200). Sabit tuval, katalogdaki
    # 400×580'lik kapakları görünürde yarı yarıya küçültüyordu — gerekçe ve
    # ölçüm `storage.pad_to_square` docstring'inde.
    PRODUCT_IMAGE_SIZE: int = 1200

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
    #: `presence:dirty` bu boyutu aşarsa kritik seviyede loglanır (0 = kapalı).
    #:
    #: Neden var: flush SQL'i 30 Mayıs–9 Ağustos 2026 arasında her turda
    #: patladı, hata `_presence_flusher`'da yakalanıp loglandı ve kuyruk sessizce
    #: 7488 kayda şişti. Kimse 71 gün boyunca fark etmedi. Yazma bir daha
    #: başarısız olursa alarm kuyruğun kendisinden gelsin — tek bir istisna
    #: satırından değil. Eşik gerçek tavana göre değil "burada bir şey yanlış"
    #: eşiğine göre seçilir: aktif kullanıcı sayısı × flush aralığı bunun çok
    #: altındadır.
    PRESENCE_DIRTY_MAX_ENTRIES: int = 50_000

    # ── Gerçek-zamanlı (Centrifugo) ──
    # `core/ws_manager.py` tek-process bellek-içidir: backend birden fazla
    # replikaya çıktığında bir replikadaki push diğerine bağlı istemciye
    # ULAŞMAZ. Centrifugo fan-out'u Redis üzerinden yapar. Kapalıyken
    # (varsayılan) `/realtime/*` uçları 503 döner ve arayüz hiç bağlanmaz —
    # GOOGLE_OAUTH ile aynı yaklaşım: geliştirmede dış servis GEREKMEZ.
    # Mevcut `/ws` ucu (WebRTC sinyalleşmesi dahil) bundan ETKİLENMEZ.
    CENTRIFUGO_ENABLED: bool = False
    CENTRIFUGO_API_URL: str = "http://centrifugo:8000/api"
    CENTRIFUGO_API_KEY: str = ""
    CENTRIFUGO_TOKEN_HMAC_SECRET: str = ""
    # Bağlantı token'ının ömrü. Kısa tutulur: SDK süresi dolmadan kendiliğinden
    # yeniler ve kullanıcı yetkisi kaybolduğunda bağlantı en geç bu süre sonra
    # ölür (Centrifugo'da sunucu tarafı iptal yoktur).
    CENTRIFUGO_TOKEN_TTL_SECONDS: int = 600
    # Publish çağrısı istek akışının İÇİNDE yapılır ve `get_db` oturumu isteğin
    # SONUNA KADAR tutar (bkz. core/database.py) — yani bu süre boyunca bir
    # havuz bağlantısı tamamen kozmetik bir sinyal için park eder. Değer bu
    # yüzden `DB_POOL_TIMEOUT_SECONDS`ın (10 sn) çok altında: Centrifugo aynı
    # Docker ağında, istek ~60 baytlık bir POST. Saniyelerce beklemek bir
    # Centrifugo yavaşlamasını DB havuzu tükenmesine çevirirdi; hızlı düşmek
    # best-effort bir katman için doğru davranıştır (bkz. `broadcast`).
    CENTRIFUGO_TIMEOUT_SECONDS: float = 1.0
    CENTRIFUGO_NAMESPACE: str = "kisisel"

    # ── Canlı ders (LiveKit) ──
    # Kendi sunucumuzda duran WebRTC SFU'su. Üçü de BOŞKEN özellik kapalıdır:
    # `/bookings/{id}/live-token` 503 döner (Centrifugo/Google OAuth ile aynı
    # yaklaşım — geliştirmede dış servis GEREKMEZ). Açılış guard'ına
    # EKLENMEZ: eksik yapılandırma yalnız bu tek ucu etkiler, uygulamanın
    # geri kalanı bundan bağımsız çalışır.
    #   LIVEKIT_URL        → tarayıcının bağlanacağı adres (wss://…)
    #   LIVEKIT_API_KEY    → token'ın `iss` claim'i
    #   LIVEKIT_API_SECRET → token'ı imzalayan HS256 sırrı
    LIVEKIT_URL: str = ""
    LIVEKIT_API_KEY: str = ""
    LIVEKIT_API_SECRET: str = ""

    # ── Canlı ders sağlayıcısı ──
    # "Derse katıl" hangi altyapıya gider (`BookingOut.canli_ders_saglayici`).
    # Açılış guard'ına EKLENMEZ: anahtar eksikse yalnız ilgili token ucu 503
    # döner, açılışta tek bir uyarı loglanır (bkz. main.py::lifespan).
    # zoom ve agora PARALEL: her ders ilk giriş biletinde bu ikisinden birine
    # kalıcı atanır (`core/canli_ders.py::saglayici_sec`); bu değer hepsi
    # tükenince seçilen varsayılandır. livekit/jitsi paralel atamayı kapatır.
    CANLI_DERS_SAGLAYICI: Literal["zoom", "agora", "livekit", "jitsi"] = "zoom"
    # Zoom Video SDK (Zoom Marketplace → Video SDK uygulaması). İkisi de BOŞKEN
    # `/bookings/{id}/zoom-token` 503 döner.
    #   ZOOM_VIDEO_SDK_KEY    → JWT'nin `app_key` claim'i
    #   ZOOM_VIDEO_SDK_SECRET → JWT'yi imzalayan HS256 sırrı
    ZOOM_VIDEO_SDK_KEY: str = ""
    ZOOM_VIDEO_SDK_SECRET: str = ""
    # JWT `video_webrtc_mode`: True → 1 = WebRTC video (varsayılan, canlı).
    # False → 0 yalnız TEST içindir: WASM/veri kanalı video yolunu zorlar.
    ZOOM_VIDEO_WEBRTC: bool = True
    # Agora RTC (console.agora.io). İkisi de BOŞKEN Agora hiç atanmaz.
    #   AGORA_APP_ID          → token'daki uygulama kimliği (istemciye de gider)
    #   AGORA_APP_CERTIFICATE → AccessToken2'yi imzalayan sır (yalnız sunucuda)
    AGORA_APP_ID: str = ""
    AGORA_APP_CERTIFICATE: str = ""
    # Aylık ücretsiz kişi-dakikası kotaları (takvim ayı, UTC). Atama, kalan
    # kotası en çok olan sağlayıcıyı seçer; kullanım tahmini atanmış derslerin
    # süresi × 2'dir. Varsayılanlar yer tutucu — gerçek rakam .env'den gelir.
    ZOOM_UCRETSIZ_KISI_DK: int = 10000
    AGORA_UCRETSIZ_KISI_DK: int = 10000
    # Token ucu kullanıcı bazlı sınırlanır: ders penceresinde yeniden bağlanma
    # birkaç token ister, ama döngüye girmiş bir istemci SFU'yu boğmasın.
    RATE_LIMIT_LIVE_TOKEN: int = 20

    # Ters proxy arkasında istemci IP'si: X-Forwarded-For YALNIZCA bağlantı bu
    # listedeki bir adresten geliyorsa okunur. Boş liste = XFF'e hiç güvenme
    # (doğrudan bağlantı IP'si kullanılır). Aksi halde saldırgan her istekte
    # sahte XFF göndererek TÜM IP bazlı rate-limit'leri (login brute-force,
    # kayıt spam'i, e-posta maliyeti, takip token'ı) etkisiz kılar.
    # Örn. tek VPS'te Caddy/nginx önde ise: ["127.0.0.1"]; Docker ağında
    # proxy'nin konteyner IP'si veya "172.16.0.0/12" gibi bir CIDR.
    TRUSTED_PROXY_IPS: list[str] = []

    # Rate limiting (Redis fixed-window). Redis erişilemezse fail-open.
    # IP bazlı (auth uçları):
    RATE_LIMIT_WINDOW_SECONDS: int = 60
    RATE_LIMIT_LOGIN: int = 10
    RATE_LIMIT_REGISTER: int = 5
    # Kullanıcı bazlı (yazma uçları; pencere = RATE_LIMIT_WINDOW_SECONDS):
    RATE_LIMIT_BOOKING: int = 10
    RATE_LIMIT_MESSAGE: int = 30
    # Ders öncesi (INQUIRY) sohbet korumaları — veritabanından sayılır, Redis
    # yokken de uygulanır (fail-closed; Modül 5):
    # öğrencinin son 24 saatte ilk mesaj atabileceği yeni eğitmen sayısı,
    MESSAGE_INQUIRY_DAILY_NEW: int = 5
    # eğitmen hiç yanıt vermemişken öğrencinin o sohbete atabileceği mesaj sayısı.
    MESSAGE_INQUIRY_MAX_UNANSWERED: int = 3
    # Eğitmenin öğrenci engelleme ucu (kullanıcı bazlı, pencere başına).
    RATE_LIMIT_BLOCK: int = 10
    RATE_LIMIT_QA: int = 15
    RATE_LIMIT_DEMAND: int = 10
    RATE_LIMIT_REVIEW: int = 10
    RATE_LIMIT_PAYMENT: int = 10
    RATE_LIMIT_REPORT: int = 5
    # İade talebi: CAYMA türü admin onayı beklemeden para hareketi başlatır,
    # bu yüzden ödeme uçlarıyla aynı sınıfta korunur (İP2A-11).
    RATE_LIMIT_RETURN: int = 5
    # To-do görev/alt görev yazma uçları (kullanıcı bazlı; hızlı ekleme için yüksek).
    RATE_LIMIT_TASK: int = 60
    # Filo yönetimi (araç/başlangıç noktası CRUD + günü optimize et). Uçlar
    # zaten ADMIN + `delivery.manage` ister; limit kötü niyete karşı değil,
    # döngüye girmiş bir panel/betiğin filoyu ya da rota servisini boğmasına
    # karşıdır — o yüzden elle çalışmanın çok üstünde ama sınırsız değil
    # (İP-19 §3.4; bağımsız denetim B-10 bu satırın kodda karşılığı
    # olmadığını ölçtü).
    RATE_LIMIT_FLEET: int = 60

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
    # SEO ön-çizimi (Modül 6): derlenmiş `index.html` şablonunun İÇ adresi.
    # Üretimde frontend konteyneri (`http://frontend:80`, compose ağı).
    # Boşsa ön-çizim ucu 503 döner ve frontend nginx'i normal SPA'ya düşer —
    # sayfa yine açılır, yalnız ön-çizilmiş içerik gelmez.
    FRONTEND_INTERNAL_URL: str = ""
    # Backend'in dışarıdan erişilen kökü — iyzico ödeme callback URL'i bundan üretilir.
    # (Sandbox'ta da çalışır: callback sunucu-sunucu değil, kullanıcının TARAYICISININ
    # POST'udur; localhost'a erişebilir.)
    BACKEND_BASE_URL: str = "http://localhost:8000"
    # Oturumsuz kargo takip linkinin (SMS'le paylaşılır) kökü. Üretimde ayrı
    # subdomain; geliştirmede frontend kökü + /kargo-takip yolu kullanılır.
    PUBLIC_TRACKING_BASE_URL: str = "http://localhost:5173/kargo-takip"

    # ── Google ile giriş (OAuth 2.0 / OpenID Connect) ──
    # Boş bırakılırsa özellik TAMAMEN KAPALIDIR: uçlar 404 döner ve arayüz
    # düğmeyi hiç çizmez (`/auth/oauth/providers`). Geliştirmede dış hesap
    # gerekmesin diye varsayılan bu — GOOGLE_MAPS_API_KEY ile aynı yaklaşım.
    #
    # Sunucu tarafı authorization-code akışı kullanılır, Google'ın tarayıcı
    # kütüphanesi (GSI) DEĞİL: GSI script'i sayfa açılır açılmaz Google'a istek
    # atar, yani kullanıcı hiçbir onay vermeden üçüncü tarafa veri gider. Bu
    # deponun KVKK kararına ters (bkz. frontend __guards__/disFont.test.ts) ve
    # CSP'deki `script-src 'self'`i de delerdi.
    GOOGLE_OAUTH_CLIENT_ID: str | None = None
    GOOGLE_OAUTH_CLIENT_SECRET: str | None = None
    # `state` çerezinin ömrü: kullanıcının Google ekranında geçireceği süre.
    # Kısa tutulur; bu çerez tek kullanımlıktır ve callback'te hemen silinir.
    GOOGLE_OAUTH_STATE_TTL_SECONDS: int = 600

    # E-posta gönderimi. EMAIL_PROVIDER: "console" (loglar) | "smtp" (MailHog/SES vb.).
    # Geliştirmede "smtp" + MailHog (port 1025) ya da "console" yeterlidir; gerçek
    # sağlayıcı yalnızca üretimde gerekir.
    EMAIL_PROVIDER: str = "console"
    EMAIL_FROM: str = "no-reply@adanaozelders.com.tr"
    # İletişim formu mesajlarının düşeceği kutu. Boşsa EMAIL_FROM kullanılır
    # (yapılandırma eksikse bile mesaj kaybolmaz).
    SUPPORT_EMAIL: str | None = None
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

    # WhatsApp doğrulama kodu. WHATSAPP_PROVIDER: "off" (varsayılan; her şey
    # SMS) | "waha" (kendi sunucumuzdaki WAHA, bağlı cihaz) | "meta" (WhatsApp
    # Cloud API). Açıkken telefon OTP'si önce WhatsApp'tan gider; gönderilemezse
    # ya da kullanıcı "SMS olarak al" derse SMS'e düşer.
    WHATSAPP_PROVIDER: str = "off"
    #: WAHA (yalnız WHATSAPP_PROVIDER=waha). İç ağ adresi; dışarıya açılmaz.
    WAHA_URL: str | None = None
    WAHA_API_KEY: str | None = None
    WAHA_SESSION: str = "default"
    #: Aynı numaraya saatte en çok kaç WhatsApp kodu (aşılırsa SMS'e düşer).
    #: WhatsApp'ın yeni kişilere toplu mesaj kısıtına karşı tampon.
    WHATSAPP_OTP_SAATLIK_SINIR: int = 3
    # Meta WhatsApp Cloud API (yalnız WHATSAPP_PROVIDER=meta).
    WHATSAPP_PHONE_NUMBER_ID: str | None = None
    WHATSAPP_ACCESS_TOKEN: str | None = None
    #: Meta'da onaylı "authentication" şablonunun adı (kopyala-kodu düğmeli).
    WHATSAPP_OTP_TEMPLATE: str | None = None
    WHATSAPP_TEMPLATE_LANG: str = "tr"
    WHATSAPP_API_VERSION: str = "v21.0"

    # Ödeme (escrow). PAYMENT_PROVIDER: "fake" (geliştirme; anında başarı) | "iyzico".
    # Geliştirmede dış hesap/anahtar GEREKMEZ ("fake"). Komisyon oranı 0..1 arası.
    PAYMENT_PROVIDER: str = "fake"
    PAYMENT_CURRENCY: str = "TRY"
    PLATFORM_COMMISSION_RATE: float = 0.10
    # Kütüphane kolu koltuk tutma süresi (dakika). Deneme bileti ve çalışma alanı
    # rezervasyonunda ödeme bekleyen kayıt (PENDING_PAYMENT) kontenjandan koltuk
    # TUTAR; tutma bu süre sonunda kendiliğinden düşer (arka plan işi yoktur —
    # koltuk yüklemi zamanı DB saatiyle okur, bkz. services/library_capacity.py).
    # Süresiz tutma, ödemeyi yarıda bırakan tek kişinin kontenjanı sonsuza dek
    # kilitlemesi demek olurdu; hiç tutmamak ise kapasitenin üzerinde tahsilat
    # (denetim P1-20). 30 dk, 3DS'li bir ödeme yolculuğunun rahat üstündedir.
    LIBRARY_SEAT_HOLD_MINUTES: int = 30
    # Mağaza kargo: eşikli ücretsiz kargo. Eşik (TL) ve üstü sipariş ücretsiz;
    # altındaki fiziksel siparişe sabit ücret. (Frontend lib/shipping.ts ile aynı.)
    SHIPPING_FREE_THRESHOLD: float = 500.0
    SHIPPING_FLAT_FEE: float = 49.90
    #: Kargo bedelinin KDV oranı (ORAN, 0.20 = %20). **Varsayılanı YOKTUR.**
    #:
    #: Kargo bir hizmettir; oranı sepetteki maldan türetilemez. Sepetin
    #: ağırlıklı ortalamasını almak kesirli ve savunulamaz bir oran üretir,
    #: "kargo muaftır" demek ise bir mevzuat iddiasını koda gömmek olurdu.
    #: Bu yüzden değer `.env`'den gelir ve kararı mali müşavir verir.
    #:
    #: `None` iken sipariş NORMAL geçer ama kargonun vergi kırılımı
    #: `orders.shipping_tax_rate = NULL` olarak **belirsiz** kaydedilir —
    #: sessizce %0 yazılmaz. Fatura ucu böyle bir siparişte 409 döner ve
    #: `GET /store/admin/tax-health` kaç siparişin bu durumda olduğunu sayar.
    SHIPPING_TAX_RATE: float | None = None

    #: İndirim duyurusunda referans alınan geçmiş pencere (GÜN).
    #:
    #: Ticari Reklam ve Haksız Ticari Uygulamalar Yönetmeliği'nde üstü çizili
    #: fiyatın dayanağı uzun süre "son 30 gün"dü; 1 Ağustos 2026'dan itibaren
    #: **son 10 gün** olarak uygulanıyor. Değer kod sabiti değil AYAR: mevzuat
    #: yeniden değişirse kod dokunulmadan çevrilebilsin.
    #:
    #: Değeri büyütmek indirim iddiasını GÜÇLENDİRMEZ, aksine daha eski ve
    #: yüksek bir fiyatı referans göstererek dayanaksız bir indirim üretir.
    PRICE_REFERENCE_WINDOW_DAYS: int = 10

    # ── Fatura (e-Arşiv'e HAZIR, hiçbir dış servise BAĞLI DEĞİL) ──
    #: Sunucu taraflı fatura ucunun ana şalteri. Varsayılan KAPALI: metinler
    #: mali müşavir onayından geçene ve satıcı bilgileri kesinleşene kadar
    #: üretimde açılmaz. Kapalıyken uç 404 döner (403 varlığını sızdırırdı).
    INVOICE_ENABLED: bool = False
    #: Satıcı kimliği — faturanın zorunlu unsurları. Hepsi DOLU olmalıdır;
    #: eksik bilgiyle fatura üretmek, kargo oranı boşken üretmekle aynı sınıf
    #: hatadır ve uç 409 ile reddeder. Değerler `.env`'den gelir; şahıs
    #: şirketinin adresi/telefonu kesinleşince oraya yazılır.
    INVOICE_SELLER_NAME: str | None = None
    INVOICE_SELLER_TAX_NUMBER: str | None = None
    INVOICE_SELLER_TAX_OFFICE: str | None = None
    INVOICE_SELLER_ADDRESS: str | None = None
    INVOICE_SELLER_PHONE: str | None = None
    INVOICE_SELLER_EMAIL: str | None = None
    # Kendi-filo teslimat (mağaza kitap dağıtımı). İP-19/K-9: DEPO AYARI YOK —
    # turun başlangıç noktası veridir (`pickup_points`, kind=BASE; araç bazlı
    # `vehicles.start_point_id`). Teslim OTP'si kapıda müşterinin söylediği
    # koddur — telefon doğrulama OTP'sinden ayrıdır.
    DELIVERY_OTP_TTL_MINUTES: int = 30
    DELIVERY_OTP_MAX_ATTEMPTS: int = 5
    # Rota optimizasyonu (Faz B). ROUTING_PROVIDER: "auto" (VROOM dene, düşerse
    # haversine — geliştirmede kurulumsuz çalışır) | "vroom" | "haversine".
    # VROOM+OSRM: `docker compose --profile routing up` + scripts/setup-osrm-adana.ps1
    ROUTING_PROVIDER: str = "auto"
    VROOM_URL: str = "http://localhost:3000"
    # VROOM isteği tavanı. Planlama CPU işidir: 300 duraklı bir gün ~3 sn sürer;
    # 20 sn dolmuşsa servis sağlıksızdır ve beklemenin faydası yok (istek boyunca
    # DB bağlantısı tutulur — DB_POOL_TIMEOUT_SECONDS'tan uzun beklemek havuzu yer).
    VROOM_TIMEOUT_SECONDS: float = 20.0
    # Tek planlamadaki azami koordinat (durak + depo). VROOM arkada OSRM'in
    # `table` servisini çağırır; `osrm-routed --max-table-size` bundan BÜYÜK
    # olmalıdır (compose: 500). Tavan aşılırsa OSRM "TooBig" döner ve hata,
    # gerçek nedeni görünmeden "VROOM'a ulaşılamadı" gibi loglanırdı — bu yüzden
    # istek ağa çıkmadan önce burada kesilir. 0 = kontrol kapalı.
    VROOM_MAX_LOCATIONS: int = 300
    # Devre kesici: VROOM düştükten sonra bu kadar saniye yeniden denenmez.
    # "Günü Optimize Et" tek istekte 1 + N planlama çağırır; kesici olmasa VROOM
    # kapalıyken admin isteği (1+N) × timeout kadar asılı kalırdı. 0 = kapalı.
    ROUTING_FAILURE_COOLDOWN_SECONDS: int = 60
    # /health rota yoklaması: gerçek (2 duraklık) plan isteği bu aralıkla
    # önbelleklenir ve bu süreyle sınırlanır (sağlık ucu asla asılı kalmaz).
    ROUTING_HEALTH_TTL_SECONDS: int = 60
    ROUTING_HEALTH_TIMEOUT_SECONDS: float = 5.0

    # ── Tedarikçi senkronu (Yıldırım B2B) ──
    #
    # DİKKAT: API token'ı BURADA DEĞİLDİR. Sır panelden girilir ve DB'de
    # şifreli durur (`suppliers.api_token`, `core/crypto.EncryptedText`);
    # env'e koymak rotasyonu deploy'a bağlar ve sırrı üç ortama kopyalar.
    # Aynı gerekçeyle senkron ARALIKLARI da env'de değil, tedarikçi satırında:
    # kullanıcı sıklığı panelden değiştirebilmeli, yeniden başlatma istemeden.
    #
    # Buradakiler yalnız süreç düzeyi teknik ayarlardır.
    #
    # Döngü tick'i: DB'deki vadeye bakar, işi kendisi yapmaz. 15 sn, 30 sn'lik
    # alt sınırın yarısı — vade geldiğinde en fazla yarım periyot gecikir.
    SUPPLIER_SYNC_TICK_SECONDS: int = 15
    SUPPLIER_HTTP_TIMEOUT_SECONDS: float = 15.0
    # İstekler arası bekleme (rapor §2.11: origin zayıf, 800 ms ölçülmüş kural).
    SUPPLIER_REQUEST_GAP_SECONDS: float = 0.8
    # `/health` "bayat mı" eşiği: son başarılı senkronun üzerinden aralığın bu
    # katı geçtiyse `degraded`. 1 kat çok hassas olurdu (tek gecikmiş tur alarm
    # verirdi), 3 kat gerçek bir duruşu ~3 dakikada bildirir.
    SUPPLIER_STALE_FACTOR: int = 3
    # Devre kesici tavanı: `min(30 sn × 2^n, bu değer)`.
    SUPPLIER_MAX_COOLDOWN_SECONDS: int = 1800
    # Token vadesine bu kadar gün kala kayan pencere yenilemesi denenir.
    SUPPLIER_TOKEN_REFRESH_DAYS: int = 7
    # TESTLERDE AÇIK (bkz. `backend/conftest.py`): istemci ağ açmayı reddeder.
    # `PAYMENT_PROVIDER=fake` ile aynı sınıf koruma — geliştiricinin panelden
    # girdiği gerçek token suite'ten canlı cari hesaba çıkmasın.
    SUPPLIER_NETWORK_DISABLED: bool = False
    # Durak başına paket teslim servis süresi (sn) — ETA hesabına girer.
    DELIVERY_STOP_SERVICE_SECONDS: int = 180
    # "Rotayı bozan durak" eşiği: durağın rotaya kattığı ek yol (km) bunu
    # aşarsa panelde işaretlenir (dış kuryeye devretme adayı).
    DELIVERY_DETOUR_KM: float = 8.0
    # Cıncık Teslimat sözü: yerel saatle bu saatten ÖNCE ödenen Adana-içi sipariş
    # aynı gün, sonrası ertesi gün teslim edilir (services/delivery_promise.py).
    DELIVERY_CUTOFF_HOUR: int = 16
    # Haftalık kapalı günler (weekday(); 6=Pazar). VARSAYILAN BOŞ = 7 gün açık.
    # Tatiller haftalık kural DEĞİL, admin'in yönettiği tarih-bazlı takvimdir
    # (delivery_closed_days tablosu) — operasyon kendi günlerini kontrol eder.
    DELIVERY_NON_WORKING_WEEKDAYS: list[int] = []
    # Kendi-filo teslimat bölgesi: pin varsa depoya Haversine yarıçapı (otorite),
    # İP-19/K-10: bölgenin TEK otoritesi bu ilçe listesidir ("Adana kent
    # merkezi"). Yarıçap kaldırıldı — depo koordinatına bağlıydı ve depo yok;
    # il/ilçe bilinmiyorsa sipariş bölge DIŞI sayılır (dış kargo kuyruğu).
    DELIVERY_ZONE_DISTRICTS: list[str] = ["Seyhan", "Yüreğir", "Çukurova", "Sarıçam"]
    # Müşteriye gösterilen varış penceresi: stop.eta − early … eta + late,
    # 15 dk'ya yuvarlı ("18:00–19:00"). Nokta ETA müşteriye gösterilmez.
    DELIVERY_ETA_WINDOW_EARLY_MINUTES: int = 15
    DELIVERY_ETA_WINDOW_LATE_MINUTES: int = 45
    # Bir aracın bir günde fiilen bitirebileceği durak sayısı. "Günü Optimize Et"
    # bu tavanı aşan siparişleri PLANA ALMAZ (eligible kuyruğunda, aciliyet
    # sırasında bekler) — aksi halde biriken söz borcu tek günde bitirilemeyecek
    # bir tur kurar ve hepsine söz verilmiş görünür. 0 = tavan kapalı.
    DELIVERY_MAX_STOPS_PER_RUN: int = 40
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
    # Üç-deneme kuralı (PDS F1/§3.4): bu kadar başarısız teslim DENEMESİnden
    # sonra sipariş otomatik yeniden kuyruğa girmez — operatör istisna kuyruğuna
    # düşer (sonsuz PAID↔FAILED döngüsü engeli). Çözüm operatör kararıdır
    # (teslim-alma noktası / iptal+iade). 0 = tavan kapalı (sınırsız deneme).
    DELIVERY_MAX_DELIVERY_ATTEMPTS: int = 3
    # Outbox worker'ı: bekleyen SMS/e-posta olaylarını bu aralıkla gönderir.
    OUTBOX_DISPATCH_INTERVAL_SECONDS: int = 15
    OUTBOX_MAX_ATTEMPTS: int = 8
    # Sessiz saat (PDS §3.8): müşteriye SMS gece yarısı yağmaz — bu aralıkta
    # bekleyen SMS'ler ertesi sabah bitiş saatine ERTELENİR (gönderim iptal
    # değil, zaman kaydırma). Aralık gece yarısını sarar: 21:00 → 08:30.
    # 0 = sessiz saat kapalı (her an gönder).
    DELIVERY_QUIET_START_HOUR: int = 21
    DELIVERY_QUIET_END_HOUR: int = 8
    DELIVERY_QUIET_END_MINUTE: int = 30
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
    # Demo/başlangıç eğitmenleri (core/seed.py::seed_tutors). Şifreleri kodda AÇIK
    # yazılıdır ve kayıtlar APPROVED gelir → üretimde ASLA açılmamalı; guard da
    # production'da True olmasını engeller.
    SEED_DEMO_DATA: bool = True
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

    # Özel ders onayı (17 Eyl 2026, kullanıcı kararı). Öğrenci dersi onaylamaz ya
    # da sorun bildirmezse, bitişinden bu kadar saat sonra ders onaylanmış sayılır
    # ve emanet eğitmene geçer. Öğrencinin "sorun bildir" penceresi de budur.
    # (Kütüphane sınav/çalışma tarafı AUTO_COMPLETE_GRACE_HOURS'ta kalır.)
    LESSON_CONFIRM_WINDOW_HOURS: int = 72
    # Derse bu kadar saatten az kala: eğitmen iptal edemez; öğrenci erteleyemez,
    # iptal ederse ödenmiş ücret iade edilmez, eğitmene geçer.
    LESSON_LATE_CANCEL_HOURS: int = 12
    # Ders talebi kuralları (Modül 3). Ders en az BOOKING_MIN_NOTICE_HOURS saat
    # önceden, en fazla İstanbul'da bugünden BOOKING_WINDOW_DAYS gün sonrasının
    # gece yarısına kadar talep edilir. Slot listesi bu adımla üretilir.
    BOOKING_MIN_NOTICE_HOURS: int = 24
    BOOKING_WINDOW_DAYS: int = 14
    BOOKING_SLOT_STEP_MINUTES: int = 30

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

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def GOOGLE_OAUTH_ENABLED(self) -> bool:
        """İkisi de doluysa açık. Yarım yapılandırma = kapalı (fail-closed)."""
        return bool(self.GOOGLE_OAUTH_CLIENT_ID and self.GOOGLE_OAUTH_CLIENT_SECRET)

    @property
    def GOOGLE_OAUTH_REDIRECT_URI(self) -> str:
        """Google Console'a yazılacak adres. AYRI BİR AYAR DEĞİL, türetilir.

        Google bu adresi birebir karşılaştırır (tek karakter fark
        `redirect_uri_mismatch` verir). Ayrı bir ayar olsaydı `BACKEND_BASE_URL`
        değiştiğinde sessizce sapar ve hata ancak canlıda görünürdü.
        """
        return f"{self.BACKEND_BASE_URL.rstrip('/')}{self.API_V1_PREFIX}/auth/google/callback"

    @model_validator(mode="after")
    def _guard_centrifugo(self) -> "Settings":
        """CENTRIFUGO_ENABLED açıkken sırları ORTAMDAN BAĞIMSIZ doğrular.

        `_guard_production`'a katılmadı bilinçli olarak: o guard yalnız
        ``ENVIRONMENT=production``'da koşar. Buradaki iki hata ise hangi
        ortamda olursa olsun sessiz bir yanlış çalışmadır — eksik sır
        "gerçek-zamanlı açık" sanılırken her publish'in 401 ile düşmesi,
        ortak sır ise Centrifugo bağlantı token'ıyla API access token'ının
        birbirinin yerine kullanılabilmesi demektir.
        """
        if not self.CENTRIFUGO_ENABLED:
            return self
        eksik = [
            ad
            for ad in ("CENTRIFUGO_API_KEY", "CENTRIFUGO_TOKEN_HMAC_SECRET")
            if not getattr(self, ad)
        ]
        if eksik:
            raise ValueError(f"CENTRIFUGO_ENABLED açık ama boş: {', '.join(eksik)}")
        if self.CENTRIFUGO_TOKEN_HMAC_SECRET == self.JWT_SECRET_KEY:
            raise ValueError(
                "CENTRIFUGO_TOKEN_HMAC_SECRET, JWT_SECRET_KEY ile AYNI olamaz."
            )
        return self

    def _storage_production_problems(self) -> list[str]:
        """Üretim nesne deposu (R2) sözleşmesi — değer (sır) yazdırmaz.

        * S3 API adresi https (R2: ``https://<hesap>.r2.cloudflarestorage.com``);
        * public ve private bucket ikisi de dolu ve FARKLI: aynı olursa private
          dosyalar custom domain bağlı (tamamı herkese açık) bucket'a düşer;
        * public kök (CDN) https ve host'u S3 API host'larından farklı: private
          adresler ve imzalar yalnız S3 API'de üretilir, CDN'den açılamaz;
        * bucket yönetimi kapalı (R2 bucket'ları konsoldan; policy yazılamaz);
        * eski kökler https ve CDN/S3 API host'larıyla çakışmıyor.
        """
        from urllib.parse import urlsplit

        out: list[str] = []
        if not self.AWS_ENDPOINT_URL.startswith("https://"):
            out.append("AWS_ENDPOINT_URL https:// olmalı (R2 S3 API adresi)")
        pub = self.S3_PUBLIC_BUCKET.strip().lower()
        priv = self.S3_PRIVATE_BUCKET.strip().lower()
        if not pub or not priv:
            out.append("S3_PUBLIC_BUCKET ve S3_PRIVATE_BUCKET üretimde zorunlu")
        elif pub == priv:
            out.append(
                "S3_PUBLIC_BUCKET ile S3_PRIVATE_BUCKET aynı olamaz "
                "(private dosyalar herkese açık bucket'a düşerdi)"
            )
        api_hosts = {
            urlsplit(u).netloc.lower()
            for u in (self.AWS_ENDPOINT_URL, self.S3_PUBLIC_ENDPOINT_URL)
            if u
        }
        base = self.S3_PUBLIC_BASE_URL.strip()
        base_host = urlsplit(base).netloc.lower() if base else ""
        if not base.startswith("https://") or not base_host:
            out.append("S3_PUBLIC_BASE_URL https:// ile başlayan CDN adresi olmalı")
        elif base_host in api_hosts:
            out.append("S3_PUBLIC_BASE_URL host'u S3 API host'uyla aynı olamaz")
        if self.S3_MANAGE_BUCKETS:
            out.append("S3_MANAGE_BUCKETS=False olmalı (R2 bucket'ları konsoldan yönetilir)")
        for raw in filter(None, (x.strip() for x in self.S3_LEGACY_BASE_URLS.split(","))):
            parts = urlsplit(raw)
            if parts.scheme != "https" or not parts.netloc:
                out.append("S3_LEGACY_BASE_URLS girdileri https:// adres olmalı")
            elif parts.netloc.lower() in api_hosts | {base_host}:
                out.append("S3_LEGACY_BASE_URLS host'u CDN ya da S3 API host'u olamaz")
        return out

    @model_validator(mode="after")
    def _guard_production(self) -> "Settings":
        """ENVIRONMENT=production iken tehlikeli geliştirme varsayılanlarını reddet.

        Bu ayarların her biri geliştirmeyi kolaylaştırmak için fail-OPEN seçildi
        (dış hesap gerekmesin diye). Üretimde aynı varsayılanlar sessiz felakete
        dönüşür: `PAYMENT_PROVIDER=fake` para tahsil etmeden sipariş kapatır,
        `SMS_PROVIDER=console` teslimat OTP'sini müşteriye değil loga yazar.
        Sessizce yanlış çalışmaktansa AÇILMAMAK doğru davranıştır.
        """
        if not self.is_production:
            return self

        problems: list[str] = []

        # Google girişi üretimde ZORUNLU DEĞİL: kapalıyken tamamen görünmez
        # opsiyonel bir özelliktir, `PAYMENT_PROVIDER=fake` gibi sessiz bir
        # felaket değil. Denetlenen tek şey YARIM yapılandırma: biri dolu biri
        # boşsa `GOOGLE_OAUTH_ENABLED` False kalır ama operatör özelliği açtığını
        # sanar; düğme görünmez ve kimse sebebini aramaz.
        if bool(self.GOOGLE_OAUTH_CLIENT_ID) != bool(self.GOOGLE_OAUTH_CLIENT_SECRET):
            problems.append(
                "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET yarım "
                "yapılandırılmış (biri dolu, biri boş) — Google girişi sessizce "
                "kapalı kalır"
            )

        if self.PAYMENT_PROVIDER.strip().lower() != "iyzico":
            problems.append(
                f"PAYMENT_PROVIDER={self.PAYMENT_PROVIDER!r} — üretimde 'iyzico' olmalı "
                "(aksi halde sahte sağlayıcı para tahsil etmeden başarı döner)"
            )
        if self.PAYMENT_PROVIDER.strip().lower() == "iyzico" and not (
            self.IYZICO_API_KEY and self.IYZICO_SECRET_KEY
        ):
            problems.append("IYZICO_API_KEY / IYZICO_SECRET_KEY boş")
        if self.EMAIL_PROVIDER.strip().lower() == "console":
            problems.append("EMAIL_PROVIDER=console — e-postalar yalnız loga yazılır")
        if self.SMS_PROVIDER.strip().lower() == "console":
            problems.append("SMS_PROVIDER=console — OTP'ler müşteriye gitmez, loga yazılır")
        if self.AUTO_CREATE_DB:
            problems.append(
                "AUTO_CREATE_DB=True — migration açılışta çalışmamalı; "
                "deploy adımı olarak `alembic upgrade head` çalıştırın"
            )
        if self.SEED_DEMO_DATA:
            problems.append(
                "SEED_DEMO_DATA=True — şifresi kodda açık olan APPROVED demo "
                "eğitmenleri canlı aramaya girer"
            )
        if len(self.JWT_SECRET_KEY) < 32 or "change-this" in self.JWT_SECRET_KEY:
            problems.append(
                "JWT_SECRET_KEY zayıf veya varsayılan (en az 32 karakter, rastgele olmalı)"
            )
        if self.ADMIN_PASSWORD and "change-this" in self.ADMIN_PASSWORD:
            problems.append("ADMIN_PASSWORD varsayılan değerde")
        if "minioadmin" in (self.AWS_ACCESS_KEY_ID, self.AWS_SECRET_ACCESS_KEY):
            problems.append("AWS_ACCESS_KEY_ID/SECRET varsayılan 'minioadmin' değerinde")
        # Dosya adresleri (ve imzaları) bu adresle üretilir. Dahili konteyner adı
        # kalırsa hiçbir görsel/belge açılmaz ve hata sessizdir: API 200 döner,
        # yalnız tarayıcı dosyayı çekemez.
        storage_endpoint = self.S3_PUBLIC_ENDPOINT_URL or self.AWS_ENDPOINT_URL
        if storage_endpoint and not storage_endpoint.startswith("https://"):
            problems.append(
                "S3_PUBLIC_ENDPOINT_URL https:// olmalı (tarayıcının depoya "
                f"eriştiği adres; şu an: {storage_endpoint!r})"
            )
        problems.extend(self._storage_production_problems())
        local_origins = [
            o for o in self.BACKEND_CORS_ORIGINS if "localhost" in o or "127.0.0.1" in o
        ]
        if local_origins:
            problems.append(f"BACKEND_CORS_ORIGINS yerel köken içeriyor: {local_origins}")
        if not self.TRUSTED_PROXY_IPS:
            problems.append(
                "TRUSTED_PROXY_IPS boş — ters proxy arkasında istemci IP'si "
                "çözülemez, IP bazlı rate-limit'ler tek bir IP'de toplanır "
                "(proxy yoksa bilinçli olarak ['*'] verilebilir)"
            )
        if self.FRONTEND_BASE_URL.startswith("http://") or self.BACKEND_BASE_URL.startswith(
            "http://"
        ):
            problems.append("FRONTEND_BASE_URL / BACKEND_BASE_URL https:// olmalı")
        # Rota sağlayıcısı: `haversine` kuş uçuşu tahmindir. Müşteriye gösterilen
        # varış penceresi ("18:00–19:00") ve kuryenin gün planı bu tahminden
        # üretilirse sistematik olarak yanlış söz verilir — üretimde bilinçli
        # seçilmiş olamaz. `auto` serbesttir (VROOM düşerse çalışmaya devam
        # etmek doğrudur; bozulma /health + ERROR log ile görünür).
        routing_mode = (self.ROUTING_PROVIDER or "").strip().lower()
        if routing_mode == "haversine":
            problems.append(
                "ROUTING_PROVIDER=haversine — üretimde 'vroom' ya da 'auto' olmalı "
                "(kuş uçuşu tahmin müşteriye yanlış varış penceresi sözü verir)"
            )
        elif routing_mode not in ("auto", "vroom"):
            problems.append(
                f"ROUTING_PROVIDER={self.ROUTING_PROVIDER!r} geçersiz "
                "(auto | vroom | haversine)"
            )
        elif "localhost" in self.VROOM_URL or "127.0.0.1" in self.VROOM_URL:
            # Konteynerde `localhost` VROOM değil backend'in kendisidir; istek
            # sessizce düşer ve rota kalıcı olarak haversine'e geriler.
            problems.append(
                f"VROOM_URL yerel adres gösteriyor ({self.VROOM_URL!r}) — "
                "üretimde servis adı olmalı (ör. http://vroom:3000)"
            )

        if problems:
            raise ValueError(
                "ENVIRONMENT=production için güvenli olmayan yapılandırma:\n  - "
                + "\n  - ".join(problems)
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
