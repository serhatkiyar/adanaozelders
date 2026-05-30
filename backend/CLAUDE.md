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
│   ├── migrations.py          # Startup'ta `alembic upgrade head` (ayrı thread)
│   ├── moderation.py          # Anti-disintermediation: telefon/e-posta maskeleme (ortak)
│   ├── seed.py                # Rol ve admin seed
│   ├── storage.py             # Avatar S3/MinIO upload (Pillow ile optimize)
│   ├── security.py            # bcrypt hash, JWT encode/decode
│   └── exceptions.py          # IntegrityError -> 409 Conflict global handler
├── migrations/                # Alembic (env.py async) + versions/
├── alembic.ini                # Alembic config (URL env.py'de settings'ten override edilir)
├── models/                    # SQLAlchemy modelleri
│   ├── __init__.py            # (CRITICAL) Tüm modeller burada import edilmelidir
│   ├── mixins.py              # NameMixin, TimestampMixin, SoftDeleteMixin, LastSeenMixin
│   ├── admin.py, client.py, tutor.py # Ayrı kullanıcı tabloları
│   ├── booking.py             # Booking + GiST Exclusion Constraint
│   ├── messaging.py           # Conversation ve Message (Client <-> Tutor)
│   ├── review.py, qa_thread.py, practice_exam.py, demands.py, bookmarks.py, vb.
├── schemas/                   # Pydantic request/response (In/Out) şemaları
├── services/                  # Business Logic Katmanı
│   ├── search_service.py      # Trigram search, Bayesian sıralama
│   ├── booking_service.py     # FSM geçişleri, zaman çakışma kontrolleri, meeting room
│   ├── messaging_service.py   # Anti-disintermediation regex, read timestamps
│   ├── qa_service.py          # Quota control (atomic update)
│   └── ... Diğer servisler (notifications, demands, leaderboard vb.)
└── api/
    ├── deps.py                # Auth bağımlılıkları (get_current_user, require_roles vb.)
    ├── router.py              # Tüm router'ları `/api/v1` prefix ile toplar
    └── routers/               # Tüm endpoint tanımlamaları (auth, tutors, bookings, messages, qa, admin vb.)
```

## Mimari Kararlar ve Veritabanı Notları

- **Birleşik Kullanıcı Tablosu Yok**: `admins`, `tutors`, `clients` ayrı tablolardır. Giriş yaparken (`/auth/login`) sırayla 3 tablo aranır. Bildirimler gibi ortak alanlar `(user_id, role_id)` composite key ile bağlanır.
- **Migration Stratejisi**: Alembic (async). Şema değişikliğinde `alembic revision --autogenerate -m "..."` ile revizyon üretilir, `alembic upgrade head` ile uygulanır. Açılışta `AUTO_CREATE_DB=true` ise `core/migrations.py::upgrade_to_head` (ayrı thread'de) çalışır. Modeller `models/__init__.py`'de import edilmeli ki autogenerate onları görsün.
- **Soft Delete**: `deleted_at` kolonu hemen her tabloda vardır. İlişkili benzersiz index'ler (Unique Indexes) genellikle `WHERE deleted_at IS NULL` koşuluna sahiptir (Partial Index).
- **Zaman Çakışmaları**: `bookings` tablosundaki `tsrange` ve `GiST Exclusion Constraint` ile aynı eğitmenin aynı saatte iki ders alması DB seviyesinde engellenir. İhlal durumunda 409 Conflict döner.
- **Arama**: `tutors` tablosunda `headline` ve `bio` için TSVECTOR (`search_vector`) ve isim/branş araması için `pg_trgm` GIN indexleri kullanılır. Sıralama Bayesian Average formulüyle yapılır.
- **Mesajlaşma Koruması (Anti-disintermediation)**: Mesaj atabilmek için aktif bir booking gerekir. `core/moderation.py::mask_contact_info` ile telefon/e-posta `[gizlendi]` şeklinde sansürlenir. Aynı maske mesajlara, ders yorumlarına (booking comments) ve kaynak başlıklarına uygulanır; kaynak URL'leri yalnızca http(s) kabul eder.

## API Endpoint Haritası (Özet)

Tüm istekler `/api/v1` ile başlar.

| Yol | İşlev |
|-----|-------|
| `/auth/*` | Register (tutor/client), Login (OAuth2 formu), Me (profil get/patch) |
| `/tutors/*` | Arama, public profil, onboarding/ilan yönetimi (suspend, activate) |
| `/clients/*` | Öğrenci arama (tutor/admin için) ve profil |
| `/bookings/*` | Rezervasyon oluşturma, accept/reject/complete/cancel/reschedule FSM işlemleri |
| `/messages/*` | Sohbetler listesi, unread counts, mesajlaşma (aktif booking gerektirir) |
| `/qa/*` | Soru sorma (ders başına 3 kota), thread/chat mesajları |
| `/reviews/*` | Tamamlanan derse yorum yapma, tutor cevabı |
| `/demands/*` | Öğrenci ilan bırakır, öğretmenler browse eder |
| `/practice-exams/*` | Deneme sınavı girişleri ve net/konu takibi |
| `/bookmarks/*` | Favori eğitmen ekleme/çıkarma |
| `/notifications/*` | Bildirim listesi, read/unread durumları |
| `/admin/*` | İstatistikler, user/tutor listeleme, tutor onay/red/askıya alma |
| `/leaderboard/*` | En iyi eğitmenler ve öğrenciler listesi |

## Kodlama Kuralları

- Yeni model eklendiğinde `models/__init__.py` içindeki `__all__` listesine mutlaka ekleyin, yoksa Alembic autogenerate tabloyu görmez.
- Yeni bir router eklendiğinde `api/router.py` dosyasındaki `api_router.include_router` bloğuna kaydedin.
- İş kurallarını (validasyonlar, FSM kontrolleri vb.) router'da değil `services/` altındaki fonksiyonlarda yazın.
- Veritabanı şemasında değişiklik gerekiyorsa modeli güncelleyip `alembic revision --autogenerate -m "..."` ile migration üretin ve `migrations/versions/` üretilen dosyayı gözden geçirin.