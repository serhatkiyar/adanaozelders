"""Request-id middleware + log korelasyonu + Sentry no-op (DB'siz, sunucusuz)."""
import logging

from core import observability
from core.config import settings
from core.observability import RequestIdFilter, RequestIdMiddleware, request_id_ctx


def test_request_id_default_outside_request():
    assert request_id_ctx.get() == "-"


def test_filter_injects_request_id():
    token = request_id_ctx.set("abc123")
    try:
        rec = logging.LogRecord("n", logging.INFO, "p", 1, "m", None, None)
        assert RequestIdFilter().filter(rec) is True
        assert rec.request_id == "abc123"
    finally:
        request_id_ctx.reset(token)


def test_init_sentry_noop_without_dsn(monkeypatch):
    monkeypatch.setattr(settings, "SENTRY_DSN", None)
    observability.init_sentry()  # istisna fırlatmamalı (no-op)


async def _drive(scope) -> tuple[dict, list]:
    captured: dict = {}

    async def app(scope, receive, send):
        captured["rid"] = request_id_ctx.get()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    sent: list = []

    async def send(msg):
        sent.append(msg)

    async def receive():
        return {"type": "http.request"}

    await RequestIdMiddleware(app)(scope, receive, send)
    return captured, sent


async def test_middleware_generates_id_and_sets_header():
    captured, sent = await _drive({"type": "http", "headers": []})
    assert captured["rid"] != "-"  # handler içinde üretilmiş kimlik görünür
    start = next(m for m in sent if m["type"] == "http.response.start")
    keys = [k for k, _ in start["headers"]]
    assert b"x-request-id" in keys


async def test_middleware_preserves_incoming_id():
    scope = {"type": "http", "headers": [(b"x-request-id", b"trace-xyz")]}
    captured, sent = await _drive(scope)
    assert captured["rid"] == "trace-xyz"
    start = sent[0]
    assert (b"x-request-id", b"trace-xyz") in start["headers"]
