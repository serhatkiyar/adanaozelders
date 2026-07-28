import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from api.router import api_router
from core.config import settings
from core.database import AsyncSessionLocal, engine
from core.exceptions import register_exception_handlers
from core import migrations, seed
from core import outbox
from core import presence
from core import observability
from core import storage
from services import (
    booking_service,
    delivery_service,
    escrow_reconciler,
    library_exam_service,
    study_reservation_service,
    task_service,
)

logger = logging.getLogger(__name__)

# 60 sn: açık görev hatırlatıcılarının (trigger_at <= now) zamanında işlenmesi için.
_REMINDER_INTERVAL_SECONDS = 60


async def _reminder_loop() -> None:
    while True:
        await asyncio.sleep(_REMINDER_INTERVAL_SECONDS)
        try:
            async with AsyncSessionLocal() as session:
                await booking_service.send_due_reminders(session)
                await booking_service.auto_complete_past_bookings(session)
                # Kütüphane: no-show ödenmiş kayıtlarda emaneti kütüphaneye serbest bırak
                # (aksi halde escrow'da süresiz kilitli kalırdı).
                await library_exam_service.auto_release_no_shows(session)
                await study_reservation_service.auto_release_no_shows(session)
                await task_service.send_task_due_reminders(session)
                await task_service.dispatch_task_reminders(session)
                await session.commit()
            # Escrow mutabakatı KENDİ session'ında koşar: kayıt başına commit'ler
            # (intent deseni) yukarıdaki toplu commit'e karışmasın.
            async with AsyncSessionLocal() as session:
                await escrow_reconciler.reconcile_refunding(session)
                await escrow_reconciler.reconcile_stale_checkouts(session)
            # Teslimat watchdog'u: saatlerce ACTIVE kalan turları kapat (kendi
            # session'ı — tur başına commit'ler yukarıya karışmasın).
            async with AsyncSessionLocal() as session:
                await delivery_service.expire_stale_runs(session)
        except Exception:
            # best-effort; bir sonraki periyotta tekrar denenir ama sessizce yutma.
            logger.exception("reminder loop iteration failed")


async def _outbox_loop() -> None:
    """Transactional outbox worker'ı: bekleyen SMS/e-posta olaylarını gönderir
    (at-least-once + üstel backoff; bkz. core/outbox.py)."""
    while True:
        await asyncio.sleep(settings.OUTBOX_DISPATCH_INTERVAL_SECONDS)
        try:
            async with AsyncSessionLocal() as session:
                await outbox.dispatch_pending(session)
        except Exception:
            logger.exception("outbox dispatch iteration failed")


async def _presence_flusher() -> None:
    while True:
        await asyncio.sleep(settings.PRESENCE_FLUSH_INTERVAL_SECONDS)
        try:
            async with AsyncSessionLocal() as session:
                await presence.flush_to_db(session)
        except Exception:
            logger.exception("presence flush iteration failed")

@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.AUTO_CREATE_DB:
        # Şemayı garanti et (alembic upgrade head — migration tek kaynak). Bkz. core/migrations.py.
        await migrations.ensure_schema()
        async with AsyncSessionLocal() as session:
            await seed.seed_roles(session)
            await seed.seed_admin(session)
            if settings.SEED_DEMO_DATA:
                # Demo eğitmenler: şifreleri kodda açık ve kayıtlar APPROVED
                # gelir — yalnız geliştirme/demo ortamında.
                await seed.seed_tutors(session)
            await session.commit()
    # MinIO bucket + anonim-okuma policy'si (best-effort; minio-init'e bağımlılık yok).
    await storage.ensure_bucket()
    task1 = asyncio.create_task(_reminder_loop())
    task2 = asyncio.create_task(_presence_flusher())
    task3 = asyncio.create_task(_outbox_loop())
    yield
    task1.cancel()
    task2.cancel()
    task3.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task1
        await task2
        await task3
    await engine.dispose()


# Üretimde interaktif dokümantasyon ve OpenAPI şeması kapalı: aksi halde admin,
# kurye, operatör ve ödeme uçlarının tam haritası (alan adları, TCKN/IBAN/escrow
# şemaları dahil) anonim ziyaretçiye sunulur.
_docs_enabled = not settings.is_production

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=(f"{settings.API_V1_PREFIX}/openapi.json" if _docs_enabled else None),
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count"],
)

# Logging + Sentry (opsiyonel) + request-id middleware (en dışta, ilk çalışır).
observability.install(app)

register_exception_handlers(app)
app.include_router(api_router, prefix=settings.API_V1_PREFIX)

# ── SEO: sitemap (KÖK yolda) ────────────────────────────────────────────────
# Arama motorları sitemap'i alan adının kökünde arar; /api/v1 altında kalırsa
# robots.txt'ten referans verilse bile alışılmış konumda bulunmaz. Caddy bu
# yolu backend'e proxy'ler (bkz. devops/Caddyfile).


@app.get("/sitemap.xml", include_in_schema=False)
async def sitemap() -> Response:
    from services import sitemap_service

    async with AsyncSessionLocal() as session:
        xml = await sitemap_service.build_sitemap(session)
    return Response(
        content=xml,
        media_type="application/xml",
        headers={"Cache-Control": "public, max-age=3600"},
    )



async def _check_database() -> bool:
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        return True
    except Exception:
        logger.warning("health: database check failed", exc_info=True)
        return False


async def _check_redis() -> bool:
    try:
        import redis.asyncio as aioredis

        client = aioredis.from_url(settings.REDIS_URL)
        try:
            return bool(await client.ping())
        finally:
            await client.aclose()
    except Exception:
        logger.warning("health: redis check failed", exc_info=True)
        return False


async def _check_storage() -> bool:
    try:
        import aioboto3

        session = aioboto3.Session()
        async with session.client(
            "s3",
            endpoint_url=settings.AWS_ENDPOINT_URL,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
            region_name=settings.AWS_REGION_NAME,
        ) as s3:
            await s3.head_bucket(Bucket=settings.AWS_BUCKET_NAME)
        return True
    except Exception:
        logger.warning("health: storage check failed", exc_info=True)
        return False


@app.get("/health")
async def health_check():
    # DB çekirdek bağımlılık; düşükse 503. Redis/MinIO yardımcı, durumları raporlanır.
    db_ok = await _check_database()
    redis_ok = await _check_redis()
    storage_ok = await _check_storage()
    body = {
        "status": "ok" if db_ok else "degraded",
        "database": "connected" if db_ok else "down",
        "redis": "connected" if redis_ok else "down",
        "storage": "connected" if storage_ok else "down",
    }
    if not db_ok:
        return JSONResponse(status_code=503, content=body)
    return body
