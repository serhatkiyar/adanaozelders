"""Gözlemlenebilirlik: request-id korelasyonu + (opsiyonel) Sentry hata izleme.

- **Request-ID**: Her HTTP isteğine benzersiz bir kimlik atanır (gelen
  ``X-Request-ID`` varsa korunur), bir ContextVar'a yazılır, tüm log kayıtlarına ve
  yanıt başlığına (``X-Request-ID``) işlenir — bir hatayı log ve istemci arasında
  ilişkilendirmek için. Pure-ASGI middleware kullanılır (ContextVar, route handler
  ile aynı task'ta görünür; BaseHTTPMiddleware bunu garanti etmez).
- **Sentry**: Yalnızca ``SENTRY_DSN`` verilirse etkinleşir; aksi halde no-op
  (geliştirmede dış hesap/anahtar gerekmez). SDK kurulu değilse de sessizce atlanır.
"""
from __future__ import annotations

import logging
import sys
import uuid
from contextvars import ContextVar

from fastapi import FastAPI

from core.config import settings

logger = logging.getLogger("adana")

# İstek başına korelasyon kimliği (varsayılan "-": istek dışı/startup logları).
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")


class RequestIdFilter(logging.Filter):
    """Her log kaydına aktif request_id'yi ekler (formatter %(request_id)s kullanır)."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_ctx.get()
        return True


def configure_logging() -> None:
    level = getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s"
        )
    )
    handler.addFilter(RequestIdFilter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)


class RequestIdMiddleware:
    """Pure-ASGI request-id middleware (ContextVar set + yanıt başlığı)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = dict(scope.get("headers") or {}).get(b"x-request-id")
        rid = incoming.decode() if incoming else uuid.uuid4().hex[:16]
        token = request_id_ctx.set(rid)

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                headers.append((b"x-request-id", rid.encode()))
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            request_id_ctx.reset(token)


def init_sentry() -> None:
    """SENTRY_DSN verilmişse Sentry'yi başlatır; aksi halde no-op."""
    if not settings.SENTRY_DSN:
        logger.info("Sentry devre dışı (SENTRY_DSN tanımsız).")
        return
    try:
        import sentry_sdk
    except ImportError:
        logger.warning("sentry-sdk kurulu değil; Sentry atlanıyor.")
        return
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.SENTRY_ENVIRONMENT,
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        send_default_pii=False,
    )
    logger.info("Sentry etkin (environment=%s).", settings.SENTRY_ENVIRONMENT)


def install(app: FastAPI) -> None:
    """Logging'i yapılandırır, Sentry'yi (varsa) başlatır, request-id middleware ekler."""
    configure_logging()
    init_sentry()
    app.add_middleware(RequestIdMiddleware)
