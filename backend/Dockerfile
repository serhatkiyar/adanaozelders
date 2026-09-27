# Python sürümü CI ve geliştirme ortamıyla AYNI olmalı: farklı sürüm,
# testlerin doğruladığı davranışın üretimde geçerli olmadığı anlamına gelir.
#
# İki hedef (multi-stage):
#   * varsayılan (son stage) → API (uvicorn). FFmpeg YOK, imaj küçük kalır.
#   * `worker`               → aynı kod + ffmpeg/ffprobe; `video-worker`
#                              konteyneri `build: target: worker` ile kullanır.
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# curl: konteyner healthcheck'i için (compose bunu kullanır).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Bağımlılıklar önce (layer cache).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Root olarak çalışmayın: konteyner kaçışında zararı sınırlar.
RUN useradd --create-home --uid 10001 app \
    && chown -R app:app /app

# ── Video işçisi: FFmpeg statik ikilileri (ffmpeg + ffprobe) ──
# Debian `apt install ffmpeg` slim imaja ~250 MB kütüphane ekler; statik derleme
# ~80 MB'tır ve digest ile sabitlenir (deterministik, tedarik zinciri izlenebilir).
# Sürüm yükseltmek: mwader/static-ffmpeg etiket + digest'i birlikte güncelle.
FROM mwader/static-ffmpeg:7.1.1 AS ffmpeg-bin

FROM base AS worker
COPY --from=ffmpeg-bin /ffmpeg /ffprobe /usr/local/bin/
USER app
# Kuyruk DB tablosudur; port açılmaz. Geçici dosyalar /tmp (compose'ta tmpfs).
CMD ["python", "-m", "workers.video_worker"]

# ── API (varsayılan hedef) ──
FROM base AS api
USER app

EXPOSE 8000

# Süreç canlı mı? (/health DB+Redis+MinIO'yu da yoklar; burada ucuz liveness
# yeterli — bağımlılık arızasında konteyneri yeniden başlatmak sorunu çözmez,
# yalnız restart döngüsü üretir.)
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

# NOT: Üretimde AUTO_CREATE_DB=False'tur (guard bunu zorlar); migration ayrı bir
# deploy adımıdır:
#   docker compose run --rm backend python -m alembic upgrade head
#
# --proxy-headers KULLANILMIYOR: istemci IP'si uygulama katmanında
# TRUSTED_PROXY_IPS'e göre çözülüyor (bkz. core/ratelimit.py). İkisini birlikte
# açmak X-Forwarded-For'u iki kez yorumlamak olur.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
