import asyncio
import contextlib
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from api.router import api_router
from core.config import settings
from core.database import AsyncSessionLocal, engine
from core.exceptions import register_exception_handlers
from core.init_db import init_db
from core import presence
from services import booking_service

_REMINDER_INTERVAL_SECONDS = 300


async def _reminder_loop() -> None:
    while True:
        await asyncio.sleep(_REMINDER_INTERVAL_SECONDS)
        try:
            async with AsyncSessionLocal() as session:
                await booking_service.send_due_reminders(session)
                await session.commit()
        except Exception:
            pass  # best-effort; bir sonraki periyotta tekrar denenir


async def _presence_flusher() -> None:
    while True:
        await asyncio.sleep(settings.PRESENCE_FLUSH_INTERVAL_SECONDS)
        try:
            async with AsyncSessionLocal() as session:
                await presence.flush_to_db(session)
        except Exception:
            pass

@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.AUTO_CREATE_DB:
        await init_db()
    task1 = asyncio.create_task(_reminder_loop())
    task2 = asyncio.create_task(_presence_flusher())
    yield
    task1.cancel()
    task2.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task1
        await task2
    await engine.dispose()


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)
app.include_router(api_router, prefix=settings.API_V1_PREFIX)


@app.get("/health")
async def health_check() -> dict[str, str]:
    async with AsyncSessionLocal() as session:
        await session.execute(text("SELECT 1"))
    return {"status": "ok", "database": "connected"}
