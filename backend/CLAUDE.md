# Backend — Ceyhan Tutoring Marketplace

FastAPI + SQLAlchemy 2.0 Async + PostgreSQL. JWT tabanlı RBAC (Admin, Tutor, Client ayrı tablolar).

## Çalıştırma

```bash
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Şema Alembic (async, `migrations/`) ile izlenir. `AUTO_CREATE_DB=true` iken açılışta `core/migrations.py::ensure_schema` çalışır: `Base.metadata.create_all` (tam güncel şema + pg_trgm/btree_gist extension'ları, idempotent) + `alembic stamp head`, ardından rol/admin seed. **Dikkat:** mevcut `6c1c09c8b1f4` "initial" revizyonu dolu bir DB'ye karşı üretildiği için tabloları kurmaz; temiz DB sağlamayı `create_all` üstlenir. Follow-up: temiz Postgres'te tek bir düzgün initial migration üretip squash etmek.

## Dizin Yapısı

```
backend/
├── main.py                    # FastAPI app, lifespan, CORS, health check, global exception handlers
├── core/
│   ├── config.py              # Pydantic BaseSettings (.env okur)
│   ├── database.py            # Async engine, sessionmaker, DeclarativeBase
│   ├── migrations.py          # ensure_schema: create_all + idempotent ALTER + alembic stamp head
│   ├── moderation.py          # Anti-disintermediation: telefon/e-posta maskeleme (ortak)
│   ├── ratelimit.py           # Redis fixed-window limiter (fail-open): enforce() + rate_limit (IP)
│   │                          #   user_rate_limit (kullanıcı bazlı) api/deps.py'de
│   ├── token_denylist.py      # Logout için Redis jti denylist (token iptali)
│   ├── presence.py            # Redis ile online/last_seen (batch flush)
│   ├── seed.py                # Rol ve admin seed
│   ├── storage.py             # S3/MinIO upload: avatar (Pillow optimize) + genel dosya (ders materyali)
│   ├── mail/                  # Sağlayıcıdan bağımsız e-posta: EmailSender(ABC) +
│   │                          #   Console/SMTP(MailHog) + factory + Türkçe şablonlar
│   ├── payments/              # Sağlayıcıdan bağımsız ödeme: PaymentProvider(ABC) +
│   │                          #   Fake(dev)/Iyzico(prod skeleton) + factory
│   ├── ws_manager.py          # WebSocket bağlantı yöneticisi (push)
│   ├── security.py            # bcrypt hash, JWT encode/decode (jti dahil)
│   ├── observability.py       # request-id (ASGI middleware) + log korelasyonu + Sentry (opsiyonel)
│   └── exceptions.py          # IntegrityError -> 409 Conflict global handler
├── migrations/                # Alembic (env.py async) + versions/
├── alembic.ini                # Alembic config (URL env.py'de settings'ten override edilir)
├── models/                    # SQLAlchemy modelleri
│   ├── __init__.py            # (CRITICAL) Tüm modeller burada import edilmelidir
│   ├── mixins.py              # NameMixin, TimestampMixin, SoftDeleteMixin, LastSeenMixin
│   ├── admin.py, client.py, tutor.py # Ayrı kullanıcı tabloları (tutor: konum lat/lng)
│   ├── booking.py             # Booking + GiST Exclusion Constraint
│   ├── booking_comment.py, booking_resource.py, booking_private_note.py # Ders işbirliği
│   ├── audit_log.py           # Admin aksiyon denetim kaydı
│   ├── verification_token.py  # E-posta doğrulama + şifre sıfırlama (hash'li, tek kullanımlık)
│   ├── payment.py             # Escrow ödeme (Booking 1:1; amount/komisyon/earning, status FSM)
│   ├── refresh_token.py       # Rotasyonlu refresh token (hash'li, revoke edilebilir)
│   ├── report.py              # Kullanıcı şikayeti (trust & safety; admin moderasyon)
│   ├── messaging.py           # Conversation ve Message (Client <-> Tutor)
│   ├── review.py, qa.py, exam.py, demand.py, bookmark.py, notification.py, vb.
├── schemas/                   # Pydantic request/response (In/Out) şemaları
├── services/                  # Business Logic Katmanı
│   ├── search_service.py      # Trigram search, Bayesian sıralama, Haversine mesafe filtresi
│   ├── booking_service.py     # FSM, çakışma kontrolü, meeting room, comment/resource/note, auto-complete
│   ├── messaging_service.py   # mask_contact_info (moderation), read timestamps
│   ├── audit_service.py       # Admin aksiyonlarını audit_logs'a yazar
│   ├── qa_service.py          # Quota control (atomic update)
│   ├── verification_service.py # Token üret/tüket + doğrulama/sıfırlama maili gönder
│   ├── payment_service.py     # Escrow: create/pay/release/refund + komisyon + kazanç özeti
│   ├── refresh_token_service.py # issue/rotate/revoke (rotasyonlu oturum südürürlüğü)
│   ├── report_service.py      # Şikayet create(dedupe)/list/count/resolve
│   └── ... Diğer servisler (notifications, demands, leaderboard vb.)
└── api/
    ├── deps.py                # Auth bağımlılıkları (get_current_user + denylist, require_roles vb.)
    ├── router.py              # Tüm router'ları `/api/v1` prefix ile toplar
    └── routers/               # Tüm endpoint tanımlamaları (auth, tutors, bookings, messages, qa, admin, ws vb.)
```

**Testler:** `cd backend && pytest -q` — DB gerektirmeyen çekirdek mantık testleri (`tests/`: booking FSM, moderation maskeleme, rol haritası, private-note filtresi, booking şema doğrulama). `conftest.py` CI için güvenli env default'ları koyar.

## Mimari Kararlar ve Veritabanı Notları

- **Birleşik Kullanıcı Tablosu Yok**: `admins`, `tutors`, `clients` ayrı tablolardır. Giriş yaparken (`/auth/login`) sırayla 3 tablo aranır. Bildirimler gibi ortak alanlar `(user_id, role_id)` composite key ile bağlanır.
- **Migration Stratejisi (ÖNEMLİ)**: Alembic (async) ile izlenir AMA mevcut `6c1c09c8b1f4` "initial" revizyonu dolu bir DB'ye karşı autogenerate edildiği için tabloları/extension'ları KURMAZ → salt `alembic upgrade head` temiz DB'yi provision edemez. Bu yüzden açılışta `AUTO_CREATE_DB=true` iken `core/migrations.py::ensure_schema` çalışır: `Base.metadata.create_all` + idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (create_all mevcut tabloya kolon EKLEMEDİĞİNDEN) + `alembic stamp head`. **Mevcut tabloya yeni kolon eklerken**: modeli güncelle + `_ADDED_COLUMNS_DDL`'e idempotent ALTER ekle (+ kayıt için Alembic migration). Yeni *tablolar* create_all ile gelir. Modeller `models/__init__.py`'de import edilmeli.
- **Soft Delete**: `deleted_at` kolonu hemen her tabloda vardır. İlişkili benzersiz index'ler (Unique Indexes) genellikle `WHERE deleted_at IS NULL` koşuluna sahiptir (Partial Index).
- **Zaman Çakışmaları**: `bookings` tablosundaki `tsrange` ve `GiST Exclusion Constraint` ile aynı eğitmenin aynı saatte iki ders alması DB seviyesinde engellenir. İhlal durumunda 409 Conflict döner.
- **Arama**: `tutors` tablosunda `headline`/`bio` için TSVECTOR (`search_vector`) ve isim/branş için `pg_trgm` GIN indexleri kullanılır; sıralama Bayesian Average ile. **Coğrafi arama**: `lat`/`lng`/`radius_km` verilirse Haversine ifadesiyle mesafe hesaplanır, konumu olmayan eğitmenler elenir, mesafe öncelikli sıralanır (`distance_km` döner).
- **Mesajlaşma Koruması (Anti-disintermediation)**: Mesaj atabilmek için aktif bir booking gerekir. `core/moderation.py::mask_contact_info` ile telefon/e-posta `[gizlendi]` şeklinde sansürlenir. Aynı maske mesajlara, ders yorumlarına (booking comments) ve kaynak başlıklarına uygulanır; kaynak URL'leri yalnızca http(s) kabul eder.
- **Booking İşbirliği & Gizlilik**: Ders detayında yorumlar (comments), kaynaklar (resources: harici **link** veya MinIO'ya **yüklenen dosya** — `kind='file'`, uzantı whitelist + boyut limiti; public bucket + uuid key, üretimde private+signed önerilir), buluşma konumu (lat/lng) ve **özel notlar** (private-notes) vardır. Özel notlar yalnızca sahibine döner — filtreleme `booking_service` katmanında merkezîdir (`_filter_private_notes`), router'da tek tek değil. Geçmiş `ACCEPTED` dersler arka plan döngüsünde otomatik `COMPLETED`'a geçer (`auto_complete_past_bookings`).
- **Rate Limiting**: `core/ratelimit.enforce` ortak fixed-window sayaç (Redis, fail-open). IP bazlı `rate_limit` auth uçlarında (login/register/email); kullanıcı bazlı `api/deps.user_rate_limit` (bucket `rl:{key}:u{role_id}:{user_id}`) yazma uçlarında (booking_create, message_send, qa_write, demand_create, review_create, payment_pay). Limiter dependency `get_current_active_user`'ı paylaşır (çift auth yok). Limitler config'te `RATE_LIMIT_*`.
- **Auth Sertleştirme**: Login/register IP bazlı rate-limit (`core/ratelimit`, Redis, fail-open). JWT'ye `jti` eklenir; `/auth/logout` token'ı kalan ömrü kadar Redis denylist'e koyar (`core/token_denylist`), `get_current_user` her istekte kontrol eder. **Refresh token** (`refresh_token_service`, `refresh_tokens` tablosu) DB-tabanlı ve rotasyonludur: `/auth/refresh` eski token'ı revoke edip yenisini üretir, geçerli/aktif kullanıcı için yeni access döner; logout refresh'i de revoke eder. Ham token saklanmaz (SHA-256 hash).
- **Audit Log**: Kritik admin aksiyonları (tutor approve/reject/suspend/activate/delete, booking cancel/dispute, password reset, **report resolve/dismiss**) `audit_service.record` ile `audit_logs`'a yazılır.
- **Şikayet & Moderasyon**: Kullanıcılar içerik/kullanıcı şikayet eder (`POST /reports`, generic `target_type`+`target_id`: TUTOR/CLIENT/REVIEW/MESSAGE/BOOKING_COMMENT; aynı hedefe açık şikayet tekrarı dedupe ile 409). Admin moderasyon kuyruğunda (`/admin/reports`, status filtreli) inceleyip çözer/reddeder (`resolve` → status + not), aksiyon audit'e yazılır. Şikayet oluşturma kullanıcı-bazlı rate-limit'li (`RATE_LIMIT_REPORT`). `reports` tablosu create_all ile gelir.
- **Ödeme (Escrow)**: `core/payments` sağlayıcıdan bağımsızdır (`PAYMENT_PROVIDER=fake|iyzico`); `payment_service` iş mantığını (escrow + komisyon) yürütür. Hook'lar `booking_service`'te: accept→`create_for_booking` (PENDING), `pay`→HELD, complete (+auto-complete)→`release` (RELEASED), cancel→`refund` (REFUNDED). Tutar sunucu-hesaplı `booking.price`'tan; komisyon `PLATFORM_COMMISSION_RATE`. `payments` tablosu Booking ile 1:1 (selectin → `BookingOut.payment`). iyzico adaptörü prod iskeleti (lazy SDK + 3DS redirect TODO); geliştirmede `fake` kullanılır.
- **E-posta Doğrulama & Şifre Sıfırlama**: `EmailVerificationMixin` admin/tutor/client'a `email_verified_at` ekler (seed admin doğrulanmış). Kayıtta doğrulama maili gönderilir; login bloklanmaz (soft enforcement, UI banner). `core/mail` sağlayıcıdan bağımsızdır (`EMAIL_PROVIDER=console|smtp`); gönderim **best-effort** (hata kayıt/sıfırlama akışını bozmaz). Tokenlar `verification_tokens`'ta **SHA-256 hash'li**, tek kullanımlık, süre sınırlı; ham token yalnız e-posta linkinde. `password-reset/request` hesap enumeration'ına karşı her durumda aynı yanıtı verir. **Yeni kolon notu**: `email_verified_at` mevcut tablolara `_ADDED_COLUMNS_DDL` ile, `verification_tokens` tablosu create_all ile gelir.
- **Health Check**: `/health` DB + Redis + MinIO durumunu raporlar (DB düşükse 503).
- **Gözlemlenebilirlik**: `core/observability.install(app)` — her HTTP isteğine request-id atar (gelen `X-Request-ID` korunur), pure-ASGI middleware ile ContextVar'a yazar, tüm loglara `[request_id]` olarak işler ve yanıt başlığına ekler. Sentry yalnız `SENTRY_DSN` verilirse başlar (yoksa/SDK yoksa no-op). Logging formatı `configure_logging` ile merkezî.

## API Endpoint Haritası (Özet)

Tüm istekler `/api/v1` ile başlar.

| Yol | İşlev |
|-----|-------|
| `/auth/*` | Register (tutor/client, rate-limit), Login (access+**refresh** döner), **Refresh** (rotasyon), **Logout** (access+refresh iptal), Me (get/patch), avatar, şifre değiştir, **verify-email/confirm+resend**, **password-reset/request+confirm** |
| `/tutors/*` | Arama (q/branş/fiyat/yaş + **lat/lng/radius_km**), public profil, onboarding/ilan yönetimi, profil (konum dahil) |
| `/clients/*` | Öğrenci arama (tutor/admin için) ve profil |
| `/bookings/*` | Oluşturma + accept/reject/complete/cancel/reschedule FSM + **location/comments/resources/private-notes** alt kaynakları (resources: link **+ dosya yükleme** `resources/upload`) |
| `/messages/*` | Sohbetler listesi, unread counts, mesajlaşma (aktif booking gerektirir) |
| `/qa/*` | Soru sorma (ders başına 3 kota), thread/chat mesajları |
| `/reviews/*` | Tamamlanan derse yorum yapma, tutor cevabı |
| `/demands/*` | Öğrenci ilan bırakır, öğretmenler browse eder |
| `/practice-exams/*` | Deneme sınavı girişleri ve net/konu takibi |
| `/bookmarks/*` | Favori eğitmen ekleme/çıkarma |
| `/notifications/*` | Bildirim listesi, read/unread durumları |
| `/admin/*` | İstatistikler, user/tutor listeleme, tutor onay/red/askı, booking cancel/dispute, **audit-logs**, **users/reset-password**, **reports** (moderasyon kuyruğu: list/count/resolve) |
| `/reports/*` | Şikayet oluştur (generic target, dedupe, rate-limit) + kendi şikayetlerim |
| `/leaderboard/*` | En iyi eğitmenler ve öğrenciler listesi |
| `/payments/*` | Booking ödemesi (escrow): durum sorgu, **pay** (öğrenci öder→HELD), **earnings** (tutor kazanç özeti), **admin/summary** (platform komisyon/hacim) |
| `/tasks/*` | Kişisel To-Do (Todoist benzeri): proje(liste)/görev/alt-görev/**etiket** CRUD, `toggle` (tamamla; **tekrarlayan** görev bir sonraki tarihe yuvarlanır), `reorder` (sürükle-bırak), filtreler (status/`booking_id`/`label_id`); 4-kademe öncelik (1=P1…4=P4), **Gelen Kutusu** (silinemez varsayılan proje, `list_lists`'te lazy oluşur). Sahiplik `(user_id, role_id)`; görev opsiyonel `booking_id` ile derse bağlanır. **Son tarih hatırlatması**: `_reminder_loop` (main.py, 5 dk) `send_task_due_reminders`'ı çağırır — lead penceresindeki/gecikmiş aktif görevler için sahibine bir kez bildirim (`reminder_sent`; due değişince/tekrar yuvarlanınca sıfırlanır) |
| `/ws` | WebSocket (mesaj/bildirim/booking-comment push; token query param) |

## Kodlama Kuralları

- Yeni model eklendiğinde `models/__init__.py` içindeki `__all__` listesine mutlaka ekleyin, yoksa Alembic autogenerate tabloyu görmez.
- Yeni bir router eklendiğinde `api/router.py` dosyasındaki `api_router.include_router` bloğuna kaydedin.
- İş kurallarını (validasyonlar, FSM kontrolleri vb.) router'da değil `services/` altındaki fonksiyonlarda yazın.
- Veritabanı şemasında değişiklik gerekiyorsa modeli güncelleyip `alembic revision --autogenerate -m "..."` ile migration üretin ve `migrations/versions/` üretilen dosyayı gözden geçirin.