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

Gerekli: PostgreSQL (pg_trgm ve btree_gist eklentileri aktif), Python 3.11+, Node 18+.

## Veritabanı Şeması (Özet)

```
tutors ──┬── tutor_educations / tutor_subjects / tutor_availability
         ├── bookings ──┬── reviews (1:1)
         │   (client_id)├── qa_threads (chat-style qa_messages)
         │              └── practice_exams
clients ─┼── client_educations
         ├── bookmarks (client->tutor)
         ├── demands (açık talepler)
         └── conversations/messages (client<->tutor)
admins (bağımsız kullanıcı tablosu)
```

- **Unified User Table Yoktur**: Admin, Tutor ve Client ayrı tablolarda tutulur.
- **Soft-delete**: Tüm tablolarda `deleted_at` kolonu (`deleted_at IS NULL` filtresi önemlidir).
- **Migration**: Alembic kullanılmamaktadır. `core/init_db.py::_apply_lightweight_migrations` içinde idempotent DDL (ALTER TABLE) ile tablo güncellemeleri yapılır. Yeni tablolar `Base.metadata.create_all` ile otomatik oluşur.
- **Concurrency**: Booking çakışmaları PostgreSQL GiST Exclusion Constraint ile veritabanı seviyesinde engellenir.

## İş Kuralları ve Temel Özellikler

- **Tutor Onboarding FSM**: DRAFT → PENDING_APPROVAL → APPROVED/REJECTED/SUSPENDED (Admin onayı gerekir)
- **Booking FSM**: PENDING → ACCEPTED/REJECTED/CANCELLED; ACCEPTED → COMPLETED/CANCELLED
- **Arama ve Sıralama**: pg_trgm trigram similarity + GIN index ile full-text search. Bayesian average formülü ile eğitmen sıralaması yapılır.
- **Mesajlaşma (Gated)**: Sadece aktif/onaylanmış rezervasyonu olan eğitmen ve öğrenci mesajlaşabilir. Sistemde regex tabanlı anti-disintermediation (iletişim bilgisi gizleme) vardır.
- **Yetkilendirme**: JWT payload'undaki `role_id` (1=ADMIN, 2=TUTOR, 3=CLIENT) ile dependency injection üzerinden RBAC (Role-Based Access Control) sağlanır.
- **QA Kota**: Tamamlanan ders başına öğrencinin 3 soru hakkı vardır (7 günlük pencere içinde). Atomik güncellemelerle race condition önlenir.

## Roller

| Rol | Yapabilir |
|-----|-----------|
| CLIENT | Eğitmen ara, rezervasyon yap, talep (demand) oluştur, mesajlaş, deneme sınavı kaydet, favorilere ekle (bookmark), soru sor, yorum/puan ver. |
| TUTOR | Onboarding/Profil yönetimi, rezervasyon kabul/red, öğrenci taleplerine (demands) bak, mesajlaş, soruları cevapla. |
| ADMIN | Eğitmen onay/red/askıya alma, tüm kullanıcıları listeleme, platform istatistiklerini görme. |

## Kodlama Kuralları

- **Mock/Sahte Veri Kullanma**: Her şey gerçek API'ye bağlı çalışmalıdır.
- **Backend Model Ekleme**: Yeni tablo oluştururken `models/__init__.py` dosyasına import edin ve `__all__` listesine ekleyin.
- **Backend Route Ekleme**: Yeni router'ı `api/router.py` dosyasına include edin.
- **Frontend Veri Çekme**: Tüm API çağrıları `@tanstack/react-query` hooks üzerinden ve axios instance (`api/axios.ts`) kullanılarak yapılmalıdır.
