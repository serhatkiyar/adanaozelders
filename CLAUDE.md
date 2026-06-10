# Ceyhan Tutoring Marketplace

Özel ders pazar yeri platformu. Öğrenciler onaylı eğitmenleri arar/filtreler, ders rezervasyonu yapar; eğitmenler talepleri yönetir. Admin onay mekanizması ile kalite kontrolü sağlanır. Projede ayrıca mesajlaşma, bildirimler, soru-cevap, deneme sınavı takibi ve liderlik tablosu gibi zengin özellikler bulunur.

## Genel Mimari

Monorepo. İki bağımsız uygulama:

| Katman | Dizin | Teknoloji | Port |
|--------|-------|-----------|------|
| Backend API | `backend/` | Python 3.11+ · FastAPI · SQLAlchemy 2.0 Async · PostgreSQL | 8000 |
| Frontend SPA | `frontend/` | React 18 · Vite · TypeScript · Tailwind CSS 3 · Zustand | 5173 |

İletişim: Frontend → Backend REST API (`/api/v1/*`).

## Hızlı Başlangıç

```bash
# Backend
cd backend
pip install -r requirements.txt
cp .env.example .env          # DATABASE_URL ve SECRET_KEY düzenle
uvicorn main:app --reload     # http://localhost:8000

# Frontend
cd frontend
npm install
cp .env.example .env          # VITE_API_BASE_URL=http://localhost:8000/api/v1
npm run dev                   # http://localhost:5173
```

Gerekli: PostgreSQL (pg_trgm ve btree_gist eklentileri aktif), Python 3.11+, Node 18+, Redis (presence + rate-limit), S3/MinIO (avatar). E-posta için MailHog/SMTP **opsiyoneldir** — `EMAIL_PROVIDER=console` ile (varsayılan) dış servis gerekmez, mailler loglanır.

### Docker ile (tek komut)

```bash
docker-compose up --build   # postgres + redis + minio + backend(8000) + frontend(5173)
```

`docker-compose.yml` Postgres/Redis/MinIO'yu (avatar bucket init dahil) + **MailHog**'u (SMTP yakalayıcı; web UI `http://localhost:8025`) ayağa kaldırır; backend açılışta şemayı hazırlar. CI: `.github/workflows/ci.yml` (backend pytest + frontend **Vitest** + build).

## Veritabanı Şeması (Özet)

```
tutors ──┬── tutor_educations / tutor_subjects / tutor_availability
  (konum)│
  lat/lng├── bookings ──┬── reviews (1:1)
         │   (client_id)├── qa_threads (chat-style qa_messages)
         │              ├── practice_exams
         │              └── booking_comments / booking_resources / booking_private_notes
clients ─┼── client_educations
         ├── bookmarks (client->tutor)
         ├── demands (açık talepler)
         └── conversations/messages (client<->tutor)
admins (bağımsız kullanıcı tablosu)
audit_logs (admin aksiyon denetim kaydı)   notifications ((user_id, role_id))
```

- **Unified User Table Yoktur**: Admin, Tutor ve Client ayrı tablolarda tutulur.
- **Soft-delete**: Tüm tablolarda `deleted_at` kolonu (`deleted_at IS NULL` filtresi önemlidir).
- **Migration**: Alembic ile izlenir (async, `migrations/`). **Dikkat:** mevcut "initial" revizyonu dolu bir DB'ye karşı üretildiği için tabloları kurmaz; bu yüzden açılışta (`AUTO_CREATE_DB=true`) `core/migrations.py::ensure_schema` çalışır → `Base.metadata.create_all` + idempotent `ALTER ... ADD COLUMN IF NOT EXISTS` + `alembic stamp head`, ardından rol/admin seed. Yeni *tablo* create_all ile gelir; mevcut tabloya yeni *kolon* için `_ADDED_COLUMNS_DDL`'e idempotent ALTER ekleyin. Detay: `backend/CLAUDE.md`.
- **Concurrency**: Booking çakışmaları PostgreSQL GiST Exclusion Constraint ile veritabanı seviyesinde engellenir.

## İş Kuralları ve Temel Özellikler

- **Tutor Onboarding FSM**: DRAFT → PENDING_APPROVAL → APPROVED/REJECTED/SUSPENDED (Admin onayı gerekir)
- **Booking FSM**: PENDING → ACCEPTED/REJECTED/CANCELLED; ACCEPTED → COMPLETED/CANCELLED. Geçmiş ACCEPTED dersler arka planda otomatik COMPLETED'a geçer. **Ücret sunucuda hesaplanır** (eğitmen saatlik ücreti × süre); istemciden alınmaz, reschedule'da yeniden hesaplanır.
- **Ders İşbirliği**: Onaylı derste yorumlar, kaynaklar (link **veya yüklenen dosya** — PDF/görsel/doküman, MinIO'ya), buluşma konumu ve özel notlar (yalnız sahibine görünür); ONLINE derste minimize edilebilir gömülü Jitsi penceresi.
- **Arama ve Sıralama**: pg_trgm trigram similarity + GIN index ile full-text search; Bayesian average ile sıralama. **Coğrafi arama**: lat/lng/radius_km ile Haversine mesafe filtresi ("yakınımdaki eğitmenler").
- **Mesajlaşma (Gated)**: Sadece aktif/onaylanmış rezervasyonu olan eğitmen ve öğrenci mesajlaşabilir. `mask_contact_info` ile anti-disintermediation; aynı maske ders yorumları ve kaynak başlıklarına da uygulanır.
- **Yetkilendirme & Güvenlik**: JWT `role_id` (1=ADMIN, 2=TUTOR, 3=CLIENT) ile RBAC. Login/register/email **IP** rate-limit; booking/mesaj/qa/demand/review/ödeme yazma uçlarında **kullanıcı bazlı** rate-limit (Redis fixed-window, fail-open); `/auth/logout` ile sunucu tarafı token iptali (Redis denylist). Kısa ömürlü access token, **DB-tabanlı rotasyonlu refresh token** ile `/auth/refresh` üzerinden sessizce yenilenir (frontend axios interceptor); logout her ikisini de iptal eder. Admin kritik aksiyonları `audit_logs`'a yazılır.
- **E-posta Doğrulama & Self-Service Şifre Sıfırlama**: Kayıtta doğrulama maili gönderilir; `email_verified` durumu panelde banner ile gösterilir (login bloklanmaz — soft enforcement). Şifre sıfırlama token tabanlıdır (hesap enumeration'ına karşı sabit yanıt). Sağlayıcıdan bağımsız `core/mail` katmanı: geliştirmede console/MailHog, üretimde gerçek SMTP — yalnızca `.env` değişir. Tokenlar DB'de **hash'li**, tek kullanımlık, süre sınırlı (`verification_tokens`).
- **Ödeme (Escrow / Emanet)**: Sağlayıcıdan bağımsız `core/payments` katmanı (geliştirmede `FakePaymentProvider` anında başarı — dış hesap gerekmez; **iyzico Checkout Form tam entegre**: sandbox/üretim yalnız `.env` anahtarlarıyla seçilir, 3DS + sunucu-doğrulamalı callback dahil — üç ödeme yüzeyi de [ders/deneme bileti/çalışma rez.] aynı akışı kullanır). Akış: tutor accept → ödeme `PENDING` → öğrenci öder → `HELD` (emanet) → ders COMPLETED → komisyon (`PLATFORM_COMMISSION_RATE`, varsayılan %10) düşülüp eğitmene `RELEASED`; iptalde `REFUNDED`. Tutar sunucuda hesaplanan `booking.price`'tan gelir; eğitmen kazancı ve platform komisyonu `payments` tablosunda tutulur.
- **QA Kota**: Tamamlanan ders başına öğrencinin 3 soru hakkı vardır (7 günlük pencere içinde). Atomik güncellemelerle race condition önlenir.
- **Kütüphaneler / Etüt Merkezleri (Faz 1)**: Bölgedeki çalışma mekânları **admin küratörlüğünde** kataloglanır (eğitmenlerin kardeşi 3. supply-side entity; self-servis onboarding yok). Eğitmen aramasının altyapısını yeniden kullanır: pg_trgm + TSVECTOR full-text, lat/lng Haversine "yakınımdaki", Bayesian sıralama, öğrenci değerlendirmesi (booking-gated DEĞİL, kütüphane başına tek). Profil: çalışma saatleri (haftalık, sunucuda "şu an açık mı" — Europe/Istanbul), olanaklar (wifi/sessiz alan/kafeterya…), konum (harita). Public: `/kutuphaneler` (liste+harita) ve `/kutuphaneler/:slug`.
- **Kütüphane Deneme Oturumları + QR Yoklama (Faz 2)**: Kütüphaneler ücretli deneme sınavı oturumları (TYT/AYT/YKS…, tarih/kontenjan/ücret) açar — etkinlik+biletleme modeli. Öğrenci kaydolur, **online öder (escrow)**, oturum günü kütüphanede **QR kodunu okutarak** katılımı doğrular → emanetteki ücret komisyon düşülüp kütüphaneye serbest bırakılır (`PLATFORM_COMMISSION_RATE`). **No-show iadesi yoktur** (ödenmiş kayıt iptal edilemez; oturumu admin iptal ederse iade edilir). QR'ı **kütüphane operatörü** (4. kullanıcı rolü `LIBRARY_OPERATOR`, role_id=4; admin oluşturur, bir kütüphaneye bağlı) okutur. Öğrenci biletleri `/biletlerim`'de (qrcode.react). Escrow `ExamRegistration`'da gömülü (booking Payment'tan ayrı), `core/payments` sağlayıcısı charge/refund için kullanılır.
- **Kütüphane Çalışma Alanı Rezervasyonu (Faz 3)**: Kütüphaneler **saatlik koltuk** rezervasyonu sunar (`Library.study_hourly_price` + `capacity`; belirli koltuk değil, kontenjan bazlı). Öğrenci tarih+saat aralığı seçer, fiyat (saatlik×süre) ve uygunluk sunucuda hesaplanır (`/study-reservations/quote`), online öder (escrow), kütüphanede **QR okutarak giriş** yapar. Çakışan aktif rezervasyon sayısı kapasiteyi aşamaz; pencere çalışma saatleri içinde olmalı. **No-show iadesi yok**. QR doğrulama **birleşiktir**: operatör tek ekrandan hem deneme biletini hem çalışma rezervasyonunu okutur (`/exam-attendance/verify` token'ı her iki tabloda arar).
- **Roller (güncel)**: ADMIN(1), TUTOR(2), CLIENT(3), **LIBRARY_OPERATOR(4)**. Operatör yalnız kendi kütüphanesinin deneme oturumlarını + çalışma rezervasyonlarını yönetir ve QR doğrular. Öğrenci biletleri/rezervasyonları `/biletlerim`'de.

## Roller

| Rol | Yapabilir |
|-----|-----------|
| CLIENT | Eğitmen ara (yakınımda dahil), rezervasyon yap, talep (demand) oluştur, mesajlaş, deneme sınavı kaydet, favorilere ekle, soru sor, yorum/puan ver, takvim. |
| TUTOR | Onboarding/Profil + konum yönetimi, rezervasyon kabul/red/tamamla, ders kaynağı/not paylaş, öğrenci taleplerine bak, mesajlaş, soruları cevapla, takvim. |
| ADMIN | Eğitmen onay/red/askı, booking iptal/dispute, şifre sıfırlama, audit log görüntüleme, kullanıcı listeleme, platform istatistikleri. |

## Kodlama Kuralları

- **Mock/Sahte Veri Kullanma**: Her şey gerçek API'ye bağlı çalışmalıdır.
- **Backend Model Ekleme**: Yeni tablo oluştururken `models/__init__.py` dosyasına import edin ve `__all__` listesine ekleyin.
- **Backend Route Ekleme**: Yeni router'ı `api/router.py` dosyasına include edin.
- **Frontend Veri Çekme**: Tüm API çağrıları `@tanstack/react-query` hooks üzerinden ve axios instance (`api/axios.ts`) kullanılarak yapılmalıdır.
