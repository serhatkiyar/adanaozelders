# Backend — Ceyhan Tutoring Marketplace

FastAPI + SQLAlchemy 2.0 Async + PostgreSQL. JWT tabanlı RBAC (Admin, Tutor, Client ayrı tablolar).

## Çalıştırma

```bash
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Şema **Alembic (async, `migrations/`) ile tek kaynaktan** izlenir. Tek bir baseline migration (`532b1fa8771d_baseline_schema`) boş bir DB'de tüm şemayı kurar (tablolar + pg_trgm/btree_gist extension'ları + enum'lar + GiST exclusion + TSVECTOR/generated kolonlar + partial/GIN index'ler). `AUTO_CREATE_DB=true` iken açılışta `core/migrations.py::ensure_schema` yalnızca `alembic upgrade head` (Windows-safe subprocess) çalıştırır, ardından rol/admin seed. Şema değişikliği için: modeli güncelle → `alembic revision --autogenerate -m "..."` → üretileni gözden geçir (extension/exclusion gibi event-tabanlı yapıları elle ekle) → commit. **Geçiş guard'ı**: squash öncesi eski revizyona stamp'lenmiş DB'lerde `upgrade head` "revizyon bulunamadı" verirse `ensure_schema` otomatik `stamp head --purge` uygular (tablolar zaten var; veri kaybı yok).

## Dizin Yapısı

```
backend/
├── main.py                    # FastAPI app, lifespan, CORS, health check, global exception handlers
├── core/
│   ├── config.py              # Pydantic BaseSettings (.env okur)
│   ├── database.py            # Async engine, sessionmaker, DeclarativeBase
│   ├── migrations.py          # ensure_schema: yalnız `alembic upgrade head` (+ squash-öncesi DB'ler için stamp guard)
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
- **Migration Stratejisi (ÖNEMLİ)**: Alembic (async) **tek doğruluk kaynağıdır**. Tek bir baseline migration (`532b1fa8771d_baseline_schema`) boş Postgres'te `alembic upgrade head` ile tüm şemayı kurar; bu, eski bozuk "initial" + create_all+ALTER yığını squash edilerek, boş DB'ye autogenerate edilip elle extension'larla tamamlanarak üretildi (create_all yoluyla `pg_dump` diff'i birebir doğrulandı). Açılışta `AUTO_CREATE_DB=true` iken `ensure_schema` yalnızca `upgrade head` (subprocess) + seed çalıştırır. **Şema değiştirirken**: modeli güncelle → `alembic revision --autogenerate -m "..."` → üretileni gözden geçir. **Autogenerate'in KAÇIRDIKLARI elle eklenir**: extension'lar (`CREATE EXTENSION ...` — `models/__init__.py`'deki `before_create` event yalnız create_all'a bağlı). GiST exclusion / Computed / TSVECTOR / partial-GIN index'ler güncel Alembic'te yakalanır. Modeller `models/__init__.py`'de import + `__all__`'da olmalı (yoksa autogenerate görmez). Eski revizyona stamp'li DB'ler için `ensure_schema` geçiş guard'ı (`stamp head --purge`) içerir.
- **Soft Delete**: `deleted_at` kolonu hemen her tabloda vardır. İlişkili benzersiz index'ler (Unique Indexes) genellikle `WHERE deleted_at IS NULL` koşuluna sahiptir (Partial Index).
- **Zaman Çakışmaları**: `bookings` tablosundaki `tsrange` ve `GiST Exclusion Constraint` ile aynı eğitmenin aynı saatte iki ders alması DB seviyesinde engellenir. İhlal durumunda 409 Conflict döner.
- **Arama**: `tutors` tablosunda `headline`/`bio` için TSVECTOR (`search_vector`) ve isim/branş için `pg_trgm` GIN indexleri kullanılır; sıralama Bayesian Average ile. **Coğrafi arama**: `lat`/`lng`/`radius_km` verilirse Haversine ifadesiyle mesafe hesaplanır, konumu olmayan eğitmenler elenir, mesafe öncelikli sıralanır (`distance_km` döner).
- **Mesajlaşma Koruması (Anti-disintermediation)**: Mesaj atabilmek için aktif bir booking gerekir. `core/moderation.py::mask_contact_info` ile telefon/e-posta `[gizlendi]` şeklinde sansürlenir. Aynı maske mesajlara, ders yorumlarına (booking comments) ve kaynak başlıklarına uygulanır; kaynak URL'leri yalnızca http(s) kabul eder.
- **Booking İşbirliği & Gizlilik**: Ders detayında yorumlar (comments), kaynaklar (resources: harici **link** veya MinIO'ya **yüklenen dosya** — `kind='file'`, uzantı whitelist + boyut limiti; public bucket + uuid key, üretimde private+signed önerilir), buluşma konumu (lat/lng) ve **özel notlar** (private-notes) vardır. Özel notlar yalnızca sahibine döner — filtreleme `booking_service` katmanında merkezîdir (`_filter_private_notes`), router'da tek tek değil. Geçmiş `ACCEPTED` dersler arka plan döngüsünde otomatik `COMPLETED`'a geçer (`auto_complete_past_bookings`).
- **Rate Limiting**: `core/ratelimit.enforce` ortak fixed-window sayaç (Redis, fail-open). IP bazlı `rate_limit` auth uçlarında (login/register/email); kullanıcı bazlı `api/deps.user_rate_limit` (bucket `rl:{key}:u{role_id}:{user_id}`) yazma uçlarında (booking_create, message_send, qa_write, demand_create, review_create, payment_pay). Limiter dependency `get_current_active_user`'ı paylaşır (çift auth yok). Limitler config'te `RATE_LIMIT_*`.
- **Auth Sertleştirme**: Login/register IP bazlı rate-limit (`core/ratelimit`, Redis, fail-open). JWT'ye `jti` eklenir; `/auth/logout` token'ı kalan ömrü kadar Redis denylist'e koyar (`core/token_denylist`), `get_current_user` her istekte kontrol eder. **Refresh token** (`refresh_token_service`, `refresh_tokens` tablosu) DB-tabanlı ve rotasyonludur: `/auth/refresh` eski token'ı revoke edip yenisini üretir, geçerli/aktif kullanıcı için yeni access döner; logout refresh'i de revoke eder. Ham token saklanmaz (SHA-256 hash).
- **Audit Log**: Kritik admin aksiyonları (tutor approve/reject/suspend/activate/delete, booking cancel/dispute, password reset, **report resolve/dismiss**) `audit_service.record` ile `audit_logs`'a yazılır.
- **Şikayet & Moderasyon**: Kullanıcılar içerik/kullanıcı şikayet eder (`POST /reports`, generic `target_type`+`target_id`: TUTOR/CLIENT/REVIEW/MESSAGE/BOOKING_COMMENT; aynı hedefe açık şikayet tekrarı dedupe ile 409). Admin moderasyon kuyruğunda (`/admin/reports`, status filtreli) inceleyip çözer/reddeder (`resolve` → status + not), aksiyon audit'e yazılır. Şikayet oluşturma kullanıcı-bazlı rate-limit'li (`RATE_LIMIT_REPORT`).
- **Ödeme (Escrow)**: `core/payments` sağlayıcıdan bağımsızdır (`PAYMENT_PROVIDER=fake|iyzico`); `payment_service` iş mantığını (escrow + komisyon) yürütür. Hook'lar `booking_service`'te: accept→`create_for_booking` (PENDING), `pay`→HELD, complete (+auto-complete)→`release` (RELEASED), cancel→`refund` (REFUNDED). Tutar sunucu-hesaplı `booking.price`'tan; komisyon `PLATFORM_COMMISSION_RATE`. `payments` tablosu Booking ile 1:1 (selectin → `BookingOut.payment`). **iyzico adaptörü TAM entegre** (Checkout Form): SDK'sız, `httpx` + IYZWSv2 (HMAC-SHA256, `build_auth_headers` saf+pytest). `charge` CF initialize → `redirect_url`(paymentPageUrl)+token; iyzico ödeme sonunda kullanıcının TARAYICISINI `/payments/iyzico/callback`'e POST eder (auth yok, localhost'ta da çalışır) → `retrieve_checkout` ile sonuç SUNUCUDA doğrulanır → `conversationId` referansı (`booking:{id}`|`examreg:{id}`|`studyres:{id}`, `parse_reference` saf+pytest) hangi varlığın kesinleşeceğini söyler → ilgili servisin idempotent `complete_checkout`'u çağrılır (booking→HELD; exam/study→PAID+QR), kullanıcı 303 ile `FRONTEND_BASE_URL`+`/ders-talepleri`|`/biletlerim`'e (`?odeme=basarili|basarisiz`) döner. Başarıda `provider_ref`=paymentTransactionId (iade `/payment/refund` bununla yapılır). Buyer bilgisi `payments.buyer_from_client` (TCKN: sandbox dummy — TODO(prod) gerçek TCKN topla). `BACKEND_BASE_URL` callback kökü. Üç ödeme yüzeyi (booking/deneme bileti/çalışma rez.) aynı sağlayıcıyı paylaşır; geliştirmede `fake` ile akış anında, `PAYMENT_PROVIDER=iyzico`+sandbox anahtarlarıyla gerçek 3DS'li test edilir.
- **E-posta Doğrulama & Şifre Sıfırlama**: `EmailVerificationMixin` admin/tutor/client'a `email_verified_at` ekler (seed admin doğrulanmış). Kayıtta doğrulama maili gönderilir; login bloklanmaz (soft enforcement, UI banner). `core/mail` sağlayıcıdan bağımsızdır (`EMAIL_PROVIDER=console|smtp`); gönderim **best-effort** (hata kayıt/sıfırlama akışını bozmaz). Tokenlar `verification_tokens`'ta **SHA-256 hash'li**, tek kullanımlık, süre sınırlı; ham token yalnız e-posta linkinde. `password-reset/request` hesap enumeration'ına karşı her durumda aynı yanıtı verir.
- **Adres Arama (Geocode) — Sağlayıcıdan Bağımsız**: `services/geocode_service.py` `core/payments`/`core/mail` desenini izler: `GOOGLE_MAPS_API_KEY` ayarlıysa **ileri arama** (autocomplete + details, field mask `location,formattedAddress`) **Google Places API (New)** kullanır; yoksa **Nominatim/OpenStreetMap** fallback — geliştirmede dış hesap/anahtar GEREKMEZ. **Ters-geocode** (harita sürükleme/geolocation→adres) Places API (New)'de olmadığından varsayılan **Nominatim** (`GEOCODE_REVERSE_USE_NOMINATIM=True`) → konsolda yalnız "Places API (New)" açık yeter, en sık çağrı ücretsiz kalır; `False` ise reverse de Geocoding API'ye gider. **Anahtar yalnız sunucuda** (istemciye sızmaz). Maliyet: autocomplete+details **aynı session token** ile tek oturum (token istemcide üretilir, seçim sonrası sıfırlanır) + field mask. Uçlar (`/geocode/*`) kimlik doğrulamalı + kullanıcı bazlı rate-limit (`RATE_LIMIT_GEOCODE`) — Google anahtarını besleyen açık proxy olmasın. Tüm dış çağrılar fail-soft (boş liste/`None`). `httpx` ile çağrılır.
- **Health Check**: `/health` DB + Redis + MinIO durumunu raporlar (DB düşükse 503).
- **Gözlemlenebilirlik**: `core/observability.install(app)` — her HTTP isteğine request-id atar (gelen `X-Request-ID` korunur), pure-ASGI middleware ile ContextVar'a yazar, tüm loglara `[request_id]` olarak işler ve yanıt başlığına ekler. Sentry yalnız `SENTRY_DSN` verilirse başlar (yoksa/SDK yoksa no-op). Logging formatı `configure_logging` ile merkezî.

## API Endpoint Haritası (Özet)

Tüm istekler `/api/v1` ile başlar.

| Yol | İşlev |
|-----|-------|
| `/auth/*` | Register (tutor/client, rate-limit), Login (access+**refresh** döner), **Refresh** (rotasyon), **Logout** (access+refresh iptal), Me (get/patch), avatar, şifre değiştir, **verify-email/confirm+resend**, **password-reset/request+confirm** |
| `/tutors/*` | Arama (q/branş/fiyat/yaş + **lat/lng/radius_km**), public profil, onboarding/ilan yönetimi, profil (konum dahil) |
| `/clients/*` | Öğrenci arama (tutor/admin için) ve profil |
| `/delivery/*` | Mağaza kendi-filo teslimatı (tümü ADMIN; `services/delivery_service.py`). Planlama: `runs` CRUD + `{id}/stops` (durak ekle; ACTIVE turda da olur) + `{id}/reorder` (permütasyon doğrulamalı) + `start`/`complete`/`cancel` + `eligible-orders` (PAID+fiziksel+açık durağı yok). Saha: `scan` (paket QR → durak; token deseni `"{id}:{token}"`), `stops/{id}/send-otp` (müşteriye `core/sms` teslim kodu; hash'li, `DELIVERY_OTP_TTL_MINUTES`), `verify` (OTP → durak DELIVERED + sipariş DELIVERED + teslim GPS'i), `override-deliver` (notlu yönetici teslimi), `fail` (sipariş PAID'e döner, yeniden planlanabilir). Tur başlarken siparişler SHIPPED + `tracking_no=ELDEN-R{run}-S{stop}`. **Rota optimizasyonu** `{id}/optimize`: `core/routing` sağlayıcı katmanı (payments deseni) — `ROUTING_PROVIDER=auto|vroom|haversine`; VROOM (self-hosted, compose `routing` profili + `scripts/setup-osrm-adana.ps1`) gerçek yol ağı, haversine (NN+2-opt, saf) kurulumsuz fallback. Sonuç: durak sequence + `eta` + `detour_km` (eşik `DELIVERY_DETOUR_KM` → `is_outlier`) + run'da toplam km/süre + polyline `route_geometry`; konumsuz duraklar sona atılır, sonuçlanmışlar sırasını korur. Saf yardımcılar (`parse_qr_token`/`hash_otp`/`validate_reorder`/`otp_expired`/`compute_detours` + `core/routing` NN/2-opt/VROOM payload-parse) pytest'li |
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
| `/geocode/*` | Adres arama proxy'si (kimlik doğrulamalı, kullanıcı bazlı rate-limit): `autocomplete` (typeahead, `session` token'lı), `details` (place_id→koordinat+adres, field mask'li), `reverse` (koordinat→adres). İleri arama `GOOGLE_MAPS_API_KEY` varsa **Google Places API (New)**, yoksa **Nominatim**; **reverse** varsayılan Nominatim (`services/geocode_service.py`); anahtar yalnız sunucuda. Detay aşağıda |
| `/libraries/*` | Kütüphane/etüt merkezi kataloğu (Faz 1). Public: arama (`q`/`amenities`/**lat/lng/radius_km**/`sort`), detay (`/{id_or_slug}`), değerlendirme listesi. CLIENT: değerlendirme ekle/sil (kütüphane başına tek, booking-gated değil; rate-limit `RATE_LIMIT_REVIEW`). ADMIN: `/admin` (gizliler dahil liste), create/patch/delete (küratör CRUD). Arama Haversine+Bayesian (`services/library_service.py`), "şu an açık" sunucuda (Europe/Istanbul). **Router sırası kritik**: `/admin` ve `/reviews/{id}` route'ları `/{id_or_slug}` ve `/{library_id}`'den ÖNCE tanımlı |
| `/exam-sessions/*`, `/exam-registrations/*`, `/exam-attendance/verify` | Kütüphane deneme oturumları (Faz 2). Public: `/exam-sessions?library_id=` (yaklaşan). Yönetim (ADMIN veya o kütüphanenin OPERATÖRÜ): `/exam-sessions/manage`, POST/PATCH/cancel, `/{id}/roster`. CLIENT: `/exam-registrations` (kaydol), `/{id}/pay` (escrow HELD + qr_token üretir, rate-limit `RATE_LIMIT_PAYMENT`), `/{id}/cancel` (yalnız ödeme öncesi — no-show iadesi yok), `/mine`. OPERATÖR: `/exam-attendance/verify` (QR payload → ATTENDED + escrow RELEASED to library). Escrow `ExamRegistration`'da gömülü; `services/library_exam_service.py` (`_split`/`parse_qr_token` saf+pytest). Tablolar baseline migration'dan |
| `/study-reservations/*` | Kütüphane çalışma alanı saatlik koltuk rezervasyonu (Faz 3). Public: `/quote?library_id=&starts_at=&ends_at=` (fiyat+uygunluk). CLIENT: POST (rezerve, kontenjan+çalışma saati doğrulama), `/{id}/pay` (escrow, rate-limit `RATE_LIMIT_PAYMENT`), `/{id}/cancel` (yalnız ödeme öncesi), `/mine`. ADMIN/OPERATÖR: `/manage?library_id=`. QR girişi **birleşik** `/exam-attendance/verify` ile (token önce deneme, sonra çalışma rezervasyonunda aranır). `services/study_reservation_service.py` (`compute_amount` saf+pytest); escrow `StudyReservation`'da gömülü. `Library.study_hourly_price` doluysa açık |
| `/libraries/{id}/operators`, `/library-operators/*` | Kütüphane operatörü hesapları (Faz 2). ADMIN: bir kütüphaneye operatör oluştur/listele/sil. OPERATÖR: `/library-operators/me`. `services/library_operator_service.py`. Operatör = 4. kullanıcı tablosu `library_operators` (role_id=4); auth `_LOGIN_PRECEDENCE`/`_ROLE_MODELS`'e bağlı; `role_type` PG enum'una `ALTER TYPE ... ADD VALUE` ile eklenir (`core/migrations.py`) |
| `/leaderboard/*` | En iyi eğitmenler ve öğrenciler listesi |
| `/payments/*` | Booking ödemesi (escrow): durum sorgu, **pay** (öğrenci öder→HELD), **earnings** (tutor kazanç özeti), **admin/summary** (platform komisyon/hacim) |
| `/tasks/*` | Kişisel To-Do (Todoist benzeri): proje(liste)/görev/alt-görev/**etiket** CRUD, `toggle` (tamamla; **tekrarlayan** görev bir sonraki tarihe yuvarlanır), `reorder` (sürükle-bırak), filtreler (status/`booking_id`/`label_id`); 4-kademe öncelik (1=P1…4=P4), **Gelen Kutusu** (silinemez varsayılan proje, `list_lists`'te lazy oluşur). Sahiplik `(user_id, role_id)`; görev opsiyonel `booking_id` ile derse bağlanır. **Kayıtlı filtreler** (Todoist 'Filtreler'): `/tasks/filters` CRUD — `task_filters` tablosu, kriterler JSONB (`q`/`priorities`/`label_ids`/`due`/`sort`), `normalize_criteria` ile sağlanır+güvenli (saf+pytest); arama/daraltma istemcide zaten yüklü görevlere uygulanır (ek istek yok). **Favoriler**: proje/etiket/filtre üçünde de `is_favorite` (PATCH ile toggle) → kenar çubuğunda "Favoriler" bölümünde toplanır. **Son tarih hatırlatması**: `_reminder_loop` (main.py, **60 sn**) `send_task_due_reminders` (örtük; açık hatırlatıcısı olan görevleri atlar — çift bildirim yok) + `dispatch_task_reminders`'ı çağırır. **Hatırlatıcılar** (`task_reminders` tablosu, 1-N): `relative` (son tarihe göre `offset_minutes`, negatif=önce) veya `absolute` (`remind_at`); `compute_trigger_at` (saf+pytest) ile `trigger_at` (UTC) hesaplanır; durum `pending/sent/failed`. Görev create/update'inde **iç içe** gelir (full-replace), son tarih değişince relative'ler yeniden hesaplanır+silahlanır. İstemci `timezone` (Intl…timeZone) payload'da gelir (bilgi; hesap mutlak instant'larla). CASCADE |
| `/flashcards/*` | Kelime kartı destesi/kart CRUD + **SM-2** aralıklı tekrar (`study`/`review`); sahiplik `(user_id, role_id)` |
| `/habits/*` | Alışkanlık takibi (Öğren hub'ı): habit CRUD + `check` (gün işaretle/geri al, `delta` ile sayaç). Günlük/haftalık hedef (`period`+`target_per_period`); seri (current/longest streak), tamamlanma ve ısı haritası verisi **sunucuda** hesaplanır (`compute_habit_stats`, saf+pytest). `entry_date`/`on` **istemcinin yerel günü** (TZ kaymasız). `habit_entries` (habit_id,entry_date) benzersiz; işaret kalkınca satır **fiziksel** silinir (soft-delete yok). Sahiplik `(user_id, role_id)` |
| `/ws` | WebSocket (mesaj/bildirim/booking-comment push; token query param) |

## Kodlama Kuralları

- Yeni model eklendiğinde `models/__init__.py` içindeki `__all__` listesine mutlaka ekleyin, yoksa Alembic autogenerate tabloyu görmez.
- Yeni bir router eklendiğinde `api/router.py` dosyasındaki `api_router.include_router` bloğuna kaydedin.
- İş kurallarını (validasyonlar, FSM kontrolleri vb.) router'da değil `services/` altındaki fonksiyonlarda yazın.
- Veritabanı şemasında değişiklik gerekiyorsa modeli güncelleyip `alembic revision --autogenerate -m "..."` ile migration üretin ve `migrations/versions/` üretilen dosyayı gözden geçirin (extension/exclusion gibi event-tabanlı yapılar autogenerate'te çıkmaz, elle ekleyin). Artık `_ADDED_COLUMNS_DDL`/`create_all` YOKTUR — migration tek kaynaktır.