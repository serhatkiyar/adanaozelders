from __future__ import annotations

import logging

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from core.routing.base import RoutingUnavailable
from services.stock_ledger import (
    IdempotencyConflict,
    InsufficientStock,
    PartialIdempotencyState,
    StockNotTracked,
)

logger = logging.getLogger("adana.routing")
stock_logger = logging.getLogger("adana.stock")

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

    # ── Stok defteri alan istisnaları ──
    #
    # `services/stock_ledger.py` bilinçli olarak HTTP bilmez (FastAPI import
    # etmez): defter, ödeme callback'i / arka plan işi / migration gibi HTTP
    # dışı bağlamlardan da çağrılıyor ve orada `HTTPException` anlamsız olurdu.
    # Dönüşüm bu katmanda yapılır — `RoutingUnavailable` deseninin aynısı.

    @app.exception_handler(InsufficientStock)
    async def _handle_insufficient_stock(
        request: Request, exc: InsufficientStock
    ) -> JSONResponse:
        """409: istek geçerli ama mevcut bakiye yetmiyor.

        Bu dal bir **kırpma** noktası DEĞİLDİR: hareket yazılmadı, stok
        değişmedi. Sipariş akışı stok yetersizliğini claim öncesi ön kontrolde
        yakalayıp iade akışına yönlendirir; buraya düşen istekler admin
        düzeltmesi gibi doğrudan çağrılardır.
        """
        stock_logger.warning(
            "yetersiz stok (%s): ürün %s mevcut %s istenen %s",
            request.url.path, exc.product_id, exc.current, exc.qty_delta,
        )
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "detail": (
                    f"Stok yetersiz: üründe {exc.current} adet var, "
                    f"{abs(exc.qty_delta)} adet düşülemez."
                ),
                "code": "INSUFFICIENT_STOCK",
            },
        )

    @app.exception_handler(IdempotencyConflict)
    async def _handle_idempotency_conflict(
        request: Request, exc: IdempotencyConflict
    ) -> JSONResponse:
        """409: aynı idempotency anahtarı farklı bir payload ile geldi.

        Çelişen alan adları/değerleri yanıta KONMAZ (iç alan adları ve ticari
        referanslar içerir); operatöre logda açıktır.
        """
        stock_logger.error(
            "idempotency çatışması (%s): anahtar=%s çelişen=%s",
            request.url.path, exc.idempotency_key, exc.conflicting_fields,
        )
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "detail": (
                    "Bu stok hareketi daha önce farklı değerlerle kaydedilmiş. "
                    "Sayfayı yenileyip güncel durumu kontrol edin."
                ),
                "code": "STOCK_IDEMPOTENCY_CONFLICT",
            },
        )

    @app.exception_handler(PartialIdempotencyState)
    async def _handle_partial_idempotency(
        request: Request, exc: PartialIdempotencyState
    ) -> JSONResponse:
        """409: toplu hareketin bir kısmı kayıtlı, bir kısmı değil.

        Eksikler bilinçli olarak UYGULANMADI — bu durum insan kararı ister.
        """
        stock_logger.error(
            "kısmi stok defteri durumu (%s): kayıtlı=%s eksik=%s",
            request.url.path, exc.found_keys, exc.missing_keys,
        )
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "detail": (
                    "Bu işlemin stok hareketleri yarım kalmış görünüyor. "
                    "Güvenlik için hiçbir ek hareket uygulanmadı; "
                    "yöneticiyle birlikte kontrol edilmesi gerekiyor."
                ),
                "code": "STOCK_PARTIAL_STATE",
            },
        )

    @app.exception_handler(StockNotTracked)
    async def _handle_stock_not_tracked(
        request: Request, exc: StockNotTracked
    ) -> JSONResponse:
        """400: dijital / stok takibi olmayan üründe stok hareketi istenmiş.

        `stock IS NULL` "stoğu 0" değil, "takip edilmiyor" demektir; isteğin
        kendisi geçersizdir (409 değil 400).
        """
        stock_logger.warning(
            "stok takibi olmayan üründe hareket denemesi (%s): ürün %s",
            request.url.path, exc.product_id,
        )
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "detail": "Bu ürün stok yönetimine tabi değil (dijital ürün).",
                "code": "STOCK_NOT_TRACKED",
            },
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
