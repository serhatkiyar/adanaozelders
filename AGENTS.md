# Adana Özel Ders

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
- **Migration**: Alembic (async, `migrations/`) **tek doğruluk kaynağıdır**. Tek bir baseline migration (`532b1fa8771d`) boş Postgres'te `alembic upgrade head` ile tüm şemayı kurar (eski bozuk initial + create_all/ALTER yığını squash edildi; create_all yoluyla `pg_dump` diff'i birebir doğrulandı). Açılışta (`AUTO_CREATE_DB=true`) `ensure_schema` yalnız `upgrade head` (subprocess) + seed çalıştırır; eski revizyona stamp'li DB'ler için otomatik `stamp head --purge` guard'ı vardır. Şema değişikliği: modeli güncelle → `alembic revision --autogenerate` → üretileni gözden geçir (extension/exclusion elle). Detay: `backend/AGENTS.md`.
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
- **Mağaza Kendi-Filo Teslimatı (Faz A)**: Fiziksel kitap siparişleri kargo firmasına verilmez — platformun kendi aracı (LADA birincil, COROLLA yedek) günlük **dağıtım turlarıyla** teslim eder. Admin panel "Dağıtım" sekmesi: tur kur → ödenmiş fiziksel siparişleri durak olarak ekle → elle sırala → **QR etiketleri yazdır** → başlat. Dağıtıcı saha ekranı (`/dagitim/:id`, mobil, ADMIN): sıradaki durak, **Google Maps deep-link** navigasyon (uygulama içi adım-adım navigasyon YAZILMAZ), paket QR doğrulama, teslimde müşteriye SMS'lenen **OTP** (`core/sms`, hash'li+süreli+deneme limitli; kod ulaşmazsa notlu yönetici teslimi). Teslim → sipariş DELIVERED; edilemedi → FAILED + sipariş PAID'e döner (ertesi tura yeniden eklenebilir). Konum otoritesi checkout'taki harita pin'idir (`Order.ship_lat/lng` ← `ClientAddress`). **Faz B (rota optimizasyonu):** sağlayıcıdan bağımsız `core/routing` — **VROOM+OSRM self-hosted** (compose `routing` profili; tek seferlik veri hazırlığı `scripts/setup-osrm-adana.ps1`, Geofabrik→osmium Adana bbox→osrm-extract) ya da **kurulumsuz haversine fallback** (yakın-komşu+2-opt; `ROUTING_PROVIDER=auto` VROOM düşerse sessizce geriler). "Rotayı Optimize Et" → durak sırası + ETA'lar + toplam km/süre + rota haritası (polyline); durak başına **sapma (detour_km)** hesaplanır, `DELIVERY_DETOUR_KM` eşiğini aşan "rotayı bozan" duraklar işaretlenir (dış kuryeye devretme adayı). **Faz C (canlı takip):** dağıtıcı telefonu aktif turda ~10 sn'de bir konum ping'ler (`core/courier_position` — Redis, TTL'li SON konum, kalıcı iz YOK/KVKK); müşteri sipariş detayında "Kuryemiz dağıtımda" şeridi (kaç durak önde + tahmini varış + son sinyal yaşı) + canlı harita (ev pini + kurye aracı, 15 sn poll); admin rota haritasında da canlı kurye işareti. Kendi-filo `tracking_no` (`ELDEN-*`) dış kargo linki GÖSTERMEZ. **"Cıncık Teslimat" genişletmesi (Faz D-H):** **(D) Söz + bölge** — 16:00 cutoff (yerel +3, Pazar sarması; `services/delivery_promise.py` saf): PAID anında `Order.promised_delivery_date`; bölge kontrolü pin→depoya haversine yarıçapı (`DELIVERY_ZONE_RADIUS_KM=25`), pin'sizse il/ilçe fallback → `Order.ship_in_zone` snapshot; `ClientAddress.city/district` yapısal; eligible yalnız bölge-içi + söze göre sıralı; bölge dışı "Dış kargo bekleyenler" kuyruğunda (kargo API'si ŞİRKET+SANDBOX SONRASI — manuel takip-no akışı yazılmadı); public `GET /store/delivery-info` → ürün/sepet/checkout'ta geri sayımlı söz rozeti (`DeliveryPromiseBadge`). **(E) Kurye + zengin takip** — `couriers` tablosu (isim/vesikalık/plaka, admin CRUD + `DeliveryRun.courier_id`); takip sayfası: statü timeline'ı (`services/delivery_timeline.py` **whitelist projeksiyonu** — `reason`/`changed_by` ASLA sızmaz), **ETA penceresi** ("18:00–19:00"; nokta ETA müşteriye gösterilmez), kurye kimlik kartı, "önünde N / toplam M", maskeli alıcı, teslim kanıtı satırı. **(F) Foto PoD** — `DeliveryStop.photo_url` + `proof=PHOTO`; saha ekranında kamera capture. **(G) Teslimat tercihleri** — `Order.delivery_pref` (ADRESIMDEYIM/KAPIYA_BIRAK/KOMSUYA_BIRAK/BENI_ARA; tercih SİPARİŞTE yaşar, durak "deneme"dir) + `postpone_count` (limit 2); `DeliveryStopStatus.RESCHEDULED` (müşteri erteledi — FAILED'dan ayrı; `_has_open_stop` saymaz → ertesi gün yeniden eligible); CLIENT uçları + **token'lı public** tercih/erteleme (adres değişikliği YALNIZ oturumlu, bölge dışına çıkarsa 409 `OUT_OF_ZONE`+force); kurye ekranında amber talimat bandı, KAPIYA/KOMSUYA'da OTP'siz `deliver-drop` (foto kanıt zorunlu). **(H) Çoklu araç + bildirim** — `POST /delivery/dispatch-day` "Günü Optimize Et": `core/routing.plan_fleet` (VROOM doğal multi-vehicle / haversine açısal bölme; `build_vroom_payload` geriye uyumlu), eşik `DELIVERY_SINGLE_VEHICLE_MAX_STOPS=12` üstünde COROLLA devrede; durak sonuçlanınca sıradaki 2 müşteriye "kuryen yaklaşıyor" SMS+bildirim (`approach_notified_at` tek-sefer damgası), teslim-edilemedi/ertelendi SMS'leri.
- **Yasal Sayfalar (Lansman Öncesi)**: 6 public sayfa — KVKK Aydınlatma, Gizlilik Politikası, Kullanım Koşulları, **Mesafeli Satış Sözleşmesi**, İptal ve İade Politikası, Çerez Politikası. İçerik tek kaynakta saf veri olarak: `frontend/src/lib/legalContent.ts` (JSX yok → Vitest'lenir); ortak düzen `pages/LegalPage.tsx`. Mesafeli satış/iade metinleri escrow akışı + no-show iade-yok kuralıyla uyumlu (Mesafeli Sözleşmeler Yönetmeliği m.15/1-g cayma istisnası). Footer'da hepsine link; kayıt formunda zorunlu KVKK/koşul onay checkbox'ı (`ConsentCheckbox`); ödeme yüzeylerinde sözleşme bilgilendirme notu (`PaymentConsentNote`). **NOT: Metinler lansmandan önce avukat onayından geçmeli**; şirket bilgileri (`OPERATOR` sabiti) şahıs şirketi kurulunca güncellenecek (TODO'lar dosyada).

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
