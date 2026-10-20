# Adana Özel Ders & Kitap Mağazası Platformu

Öğrenciler ile eğitmenleri buluşturan, canlı ders (video konferans + interaktif beyaz tahta), randevu/rezervasyon yönetimi ve eğitim materyalleri / kitap mağazası (e-ticaret & kurye rota optimizasyonu) özelliklerini tek çatı altında sunan tam yığın (full-stack) web platformu.

## Başlıca Modüller
- **Özel Ders & Eğitmen Pazaryeri:** Branş/ilçe bazlı eğitmen arama, deneme dersi, takvim ve randevu yönetimi.
- **Canlı Ders Sınıfı:** LiveKit / Agora / Zoom entegrasyonu, Excalidraw interaktif beyaz tahta ve Centrifugo gerçek zamanlı sınıf içi mesajlaşma.
- **Eğitim Mağazası & Tedarikçi Entegrasyonu:** Kitap ve eğitim materyali satışı, stok defteri ve B2B katalog senkronizasyonu.
- **Teslimat & Rota Optimizasyonu:** OSRM ve VROOM tabanlı kurye rota planlama ve canlı kargo takip sistemi.
- **Aralıklı Tekrar Sistemi (FSRS-5):** Öğrenciler için akıllı çalışma kartları ve tekrar planlayıcı.

## Teknoloji Yığını

### Backend (ackend/)
- **Dil & Çatı:** Python 3.12, FastAPI, Starlette, Uvicorn (ASGI)
- **Veritabanı & ORM:** PostgreSQL 16, SQLAlchemy 2.0 (Async), syncpg, Alembic
- **Önbellek & Gerçek Zamanlı:** Redis 7, Centrifugo
- **Depolama & Medya:** MinIO / S3 (ioboto3), Pillow, FFmpeg (ideo-worker)
- **Doğrulama & Güvenlik:** Pydantic v2, PyJWT, bcrypt, 
h3

### Frontend (rontend/)
- **Dil & Çatı:** TypeScript 5.6, React 18, Vite 5, React Router v7
- **Stil & UI:** Tailwind CSS 3, Ant Design v5, Medusa UI
- **Durum Yönetimi:** TanStack React Query v5, Redux Toolkit, Zustand
- **Form & Doğrulama:** React Hook Form, Zod
- **Canlı Ders & Harita:** LiveKit, Agora RTC, Zoom Video SDK, Excalidraw, FullCalendar, Leaflet

## Yerel Geliştirme ve Kurulum

### 1. Altyapı Servisleri (Docker Compose)
Geliştirme ortamında Redis, MinIO ve MailHog servislerini başlatmak için:
```bash
docker compose up -d redis minio minio-init mailhog
```
Tüm sistemi (PostgreSQL + Backend + Frontend dahil) Docker üzerinde çalıştırmak için:
```bash
docker compose --profile tamdocker up --build
```

### 2. Backend Kurulumu
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head
uvicorn main:app --reload --port 8000
```

### 3. Frontend Kurulumu
```bash
cd frontend
npm install
npm run dev
```

## Katmanlı Mimari ve Testler

Yeni bir özellik veya API ucu eklenirken izlenen katman sırası:
1. **Backend:** models/ $\rightarrow$ models/__init__.py $\rightarrow$ schemas/ $\rightarrow$ services/ $\rightarrow$ pi/routers/ $\rightarrow$ pi/router.py
2. **Frontend:** src/types/ $\rightarrow$ src/api/ $\rightarrow$ src/hooks/ $\rightarrow$ src/pages/ veya src/components/

### Test ve Kalite Kontrol Komutları
- **Backend Test & Lint:**
  ```bash
  cd backend
  ruff check .
  pytest -q
  ```
- **Frontend Tip Kontrolü & Birim Testleri:**
  ```bash
  cd frontend
  npx tsc -b
  npm run test
  ```
