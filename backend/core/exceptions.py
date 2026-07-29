from __future__ import annotations

import logging

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from core.routing.base import RoutingUnavailable

logger = logging.getLogger("adana.routing")

_EXCLUSION_VIOLATION = "23P01"
_UNIQUE_VIOLATION = "23505"


def _extract_sqlstate(exc: IntegrityError) -> str | None:
    orig = getattr(exc, "orig", None)
    for candidate in (orig, getattr(orig, "__cause__", None)):
        code = getattr(candidate, "sqlstate", None) or getattr(
            candidate, "pgcode", None
        )
        if code:
            return code
    return None


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(IntegrityError)
    async def _handle_integrity_error(
        request: Request, exc: IntegrityError
    ) -> JSONResponse:
        sqlstate = _extract_sqlstate(exc)
        if sqlstate == _EXCLUSION_VIOLATION:
            return JSONResponse(
                status_code=status.HTTP_409_CONFLICT,
                content={
                    "detail": "The selected time slot conflicts with an "
                    "existing booking for this tutor"
                },
            )
        if sqlstate == _UNIQUE_VIOLATION:
            return JSONResponse(
                status_code=status.HTTP_409_CONFLICT,
                content={"detail": "Resource already exists"},
            )
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": "Database integrity constraint violated"},
        )

    @app.exception_handler(RoutingUnavailable)
    async def _handle_routing_unavailable(
        request: Request, exc: RoutingUnavailable
    ) -> JSONResponse:
        """``ROUTING_PROVIDER=vroom`` (zorunlu) modunda rota servisi düştüğünde
        bu istisna servis katmanından kaçar. Handler olmasaydı admin panelinde
        opak bir 500 görünür, gerçek neden yalnız sunucu logunda kalırdı.

        503 + ``Retry-After``: bu geçici bir altyapı arızasıdır, isteğin kendisi
        geçersiz değildir. Ayrıntı yanıta KONMAZ (iç servis adları/istisna metni
        içerir) — operatöre logda ve ``/health``'te açıktır.
        """
        logger.error("rota servisi kullanılamıyor (%s): %s", request.url.path, exc)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            headers={"Retry-After": "60"},
            content={
                "detail": "Rota servisi şu an kullanılamıyor — birazdan tekrar "
                "deneyin. (Sorun sürerse rota altyapısının durumunu kontrol edin.)"
            },
        )
