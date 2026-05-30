# Backend — Ceyhan Tutoring Marketplace

FastAPI + SQLAlchemy 2.0 Async + PostgreSQL. JWT tabanlı RBAC (Admin, Tutor, Client ayrı tablolar).

## Çalıştırma

```bash
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

`AUTO_CREATE_DB=true` ile tablo ve indexler otomatik oluşur. Alembic yok, migrationlar idempotent DDL scriptleri ile yönetilir.

## Dizin Yapısı

```
backend/
├── main.py                    # FastAPI app, lifespan, CORS, health check, global exception handlers
├── core/
│   ├── config.py              # Pydantic BaseSettings (.env okur)
│   ├── database.py            # Async engine, sessionmaker, DeclarativeBase
│   ├── init_db.py             # create_all + Idempotent DDL migration (ALTER TABLE...) + Seed veriler
│   ├── security.py            # bcrypt hash, JWT encode/decode
│   └── exceptions.py          # IntegrityError -> 409 Conflict global handler
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
- **Migration Stratejisi**: Alembic yoktur. `core/init_db.py::_apply_lightweight_migrations` içerisinde `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` gibi idempotent SQL komutları ile şema evrimi yönetilir.
- **Soft Delete**: `deleted_at` kolonu hemen her tabloda vardır. İlişkili benzersiz index'ler (Unique Indexes) genellikle `WHERE deleted_at IS NULL` koşuluna sahiptir (Partial Index).
- **Zaman Çakışmaları**: `bookings` tablosundaki `tsrange` ve `GiST Exclusion Constraint` ile aynı eğitmenin aynı saatte iki ders alması DB seviyesinde engellenir. İhlal durumunda 409 Conflict döner.
- **Arama**: `tutors` tablosunda `headline` ve `bio` için TSVECTOR (`search_vector`) ve isim/branş araması için `pg_trgm` GIN indexleri kullanılır. Sıralama Bayesian Average formulüyle yapılır.
- **Mesajlaşma Koruması**: Mesaj atabilmek için aktif bir booking gerekir. Servis seviyesinde telefon/email regex ile `[gizlendi]` şeklinde sansürlenir.

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

- Yeni model eklendiğinde `models/__init__.py` içindeki `__all__` listesine mutlaka ekleyin, yoksa `create_all` tabloyu oluşturmaz.
- Yeni bir router eklendiğinde `api/router.py` dosyasındaki `api_router.include_router` bloğuna kaydedin.
- İş kurallarını (validasyonlar, FSM kontrolleri vb.) router'da değil `services/` altındaki fonksiyonlarda yazın.
- Veritabanı şemasında değişiklik gerekiyorsa `core/init_db.py` içerisine idempotent SQL sorgunuzu ekleyin.