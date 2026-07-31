# Python sürümü CI ve geliştirme ortamıyla AYNI olmalı: farklı sürüm,
# testlerin doğruladığı davranışın üretimde geçerli olmadığı anlamına gelir.
FROM python:3.12-slim

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
