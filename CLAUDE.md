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

Gerekli: PostgreSQL (pg_trgm ve btree_gist eklentileri aktif), Python 3.11+, Node 18+, Redis (presence + rate-limit), S3/MinIO (avatar).

### Docker ile (tek komut)

```bash
docker-compose up --build   # postgres + redis + minio + backend(8000) + frontend(5173)
```

`docker-compose.yml` Postgres/Redis/MinIO'yu (avatar bucket init dahil) ayağa kaldırır; backend açılışta şemayı hazırlar. CI: `.github/workflows/ci.yml` (backend pytest + frontend build).

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
- **Booking FSM**: PENDING → ACCEPTED/REJECTED/CANCELLED; ACCEPTED → COMPLETED/CANCELLED. Geçmiş ACCEPTED dersler arka planda otomatik COMPLETED'a geçer.
- **Ders İşbirliği**: Onaylı derste yorumlar, kaynaklar (link), buluşma konumu ve özel notlar (yalnız sahibine görünür); ONLINE derste minimize edilebilir gömülü Jitsi penceresi.
- **Arama ve Sıralama**: pg_trgm trigram similarity + GIN index ile full-text search; Bayesian average ile sıralama. **Coğrafi arama**: lat/lng/radius_km ile Haversine mesafe filtresi ("yakınımdaki eğitmenler").
- **Mesajlaşma (Gated)**: Sadece aktif/onaylanmış rezervasyonu olan eğitmen ve öğrenci mesajlaşabilir. `mask_contact_info` ile anti-disintermediation; aynı maske ders yorumları ve kaynak başlıklarına da uygulanır.
- **Yetkilendirme & Güvenlik**: JWT `role_id` (1=ADMIN, 2=TUTOR, 3=CLIENT) ile RBAC. Login/register IP rate-limit; `/auth/logout` ile sunucu tarafı token iptali (Redis denylist). Admin kritik aksiyonları `audit_logs`'a yazılır.
- **QA Kota**: Tamamlanan ders başına öğrencinin 3 soru hakkı vardır (7 günlük pencere içinde). Atomik güncellemelerle race condition önlenir.

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
