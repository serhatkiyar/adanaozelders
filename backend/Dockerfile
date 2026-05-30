FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Bağımlılıklar önce (layer cache).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# AUTO_CREATE_DB=true ise açılışta şema hazırlanır (create_all + alembic stamp).
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
