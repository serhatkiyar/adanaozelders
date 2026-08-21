"""Sağlayıcıdan bağımsız rota optimizasyonu (core/payments deseni).

``ROUTING_PROVIDER``: "auto" (varsayılan — VROOM dene, düşerse haversine),
"vroom" (zorunlu; düşerse hata), "haversine" (dış servis yok).

**Sessiz bozulma bu katmanın asıl riskidir.** VROOM düştüğünde ``auto`` modu
çalışmaya devam eder ama ETA/mesafe kuş uçuşu tahmine döner — müşteriye verilen
"18:00–19:00" penceresi gerçek yol ağından değil, 28 km/sa varsayımından gelir.
Bu yüzden burada üç şey tutulur:

1. **Devre kesici** — VROOM bir kez düştüyse ``ROUTING_FAILURE_COOLDOWN_SECONDS``
   boyunca yeniden denenmez. "Günü Optimize Et" tek istekte 1 + N planlama
   çağırır; kesici olmasa VROOM kapalıyken admin isteği (1+N) × timeout kadar
   asılı kalır ve o süre boyunca DB bağlantısını tutar.
2. **Durum kaydı** — son başarı/hata anı ve nedeni; ``/health`` bunu raporlar.
3. **Yüksek sesli log** — üretimde fallback WARNING değil ERROR'dır (bir kez,
   kesici penceresi başına — log seli olmadan görünür kalır).
"""
from __future__ import annotations

import asyncio
import datetime
import logging

from core.config import settings
from core.routing.base import (
    FleetPlan,
    RoutePlan,
    RoutePoint,
    RouteVehicle,
    RoutingProvider,
    RoutingUnavailable,
)
from core.routing import vroom as _vroom
from core.routing.haversine import HaversineRoutingProvider
from core.routing.vroom import VroomRoutingProvider

logger = logging.getLogger("adana.routing")

__all__ = [
    "FleetPlan",
    "RoutePlan",
    "RoutePoint",
    "RouteVehicle",
    "RoutingProvider",
    "RoutingUnavailable",
    "HaversineRoutingProvider",
    "VroomRoutingProvider",
    "plan_route",
    "plan_fleet",
    "health_snapshot",
    "reset_state",
]


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


class _State:
    """VROOM sağlayıcısının süreç-içi sağlık durumu (tek replika kapsamı).

    Kalıcı depo (Redis) bilinçli KULLANILMADI: bu durum yalnız "bu süreç şu an
    boşuna beklemesin" kararını verir; replikalar arası paylaşımı gerektirecek
    bir doğruluk sonucu yoktur ve Redis'e bağımlı olmak fallback'i daha kırılgan
    yapardı.
    """

    def __init__(self) -> None:
        self.last_ok_at: datetime.datetime | None = None
        self.last_error_at: datetime.datetime | None = None
        self.last_error: str | None = None
        self.consecutive_failures: int = 0
        self.cooldown_until: datetime.datetime | None = None
        # Sağlık yoklaması önbelleği (uptime izleyicisi /health'i sık çağırır).
        self.probe_at: datetime.datetime | None = None
        self.probe_ok: bool | None = None
        self.probe_error: str | None = None
        self.probe_lock = asyncio.Lock()

    def cooling(self) -> bool:
        return self.cooldown_until is not None and _now() < self.cooldown_until

    def note_success(self) -> None:
        was_down = self.consecutive_failures > 0
        self.last_ok_at = _now()
        self.consecutive_failures = 0
        self.cooldown_until = None
        self.last_error = None
        # GERÇEK trafik, sentetik yoklamadan daha iyi bir sağlık kanıtıdır:
        # sonucu doğrudan yoklama önbelleğine yaz. Aksi halde bayat bir "başarılı"
        # yoklama, canlı planlamalar düşerken /health'e "connected" dedirtirdi.
        self.probe_ok, self.probe_error, self.probe_at = True, None, self.last_ok_at
        if was_down:
            logger.warning("VROOM yeniden erişilebilir — gerçek yol ağına dönüldü")

    def note_failure(self, exc: Exception) -> None:
        first = self.consecutive_failures == 0 or not self.cooling()
        self.consecutive_failures += 1
        self.last_error_at = _now()
        self.last_error = str(exc)
        # Bkz. note_success: canlı hata yoklama önbelleğini de geçersiz kılar.
        self.probe_ok, self.probe_error, self.probe_at = False, str(exc), self.last_error_at
        cooldown = max(settings.ROUTING_FAILURE_COOLDOWN_SECONDS, 0)
        self.cooldown_until = (
            _now() + datetime.timedelta(seconds=cooldown) if cooldown else None
        )
        if first:
            # Üretimde bu sessiz bir bozulmadır: rota kurulmaya devam eder ama
            # ETA'lar kuş uçuşu tahminine düşer. Alarma girecek seviyede logla.
            log = logger.error if settings.is_production else logger.warning
            log(
                "VROOM kullanılamıyor (%s. hata) — rota planlaması haversine "
                "tahminine düşüyor: %s",
                self.consecutive_failures,
                exc,
            )


_state = _State()


def reset_state() -> None:
    """Testler için: devre kesici/probe durumunu sıfırla."""
    global _state
    _state = _State()


def _mode() -> str:
    return (settings.ROUTING_PROVIDER or "auto").strip().lower()


async def _with_vroom(call, mode: str, fallback):
    """VROOM'u dene; kesici/hata durumunda moda göre yükselt ya da fallback'e düş."""
    if _state.cooling():
        if mode == "vroom":
            raise RoutingUnavailable(
                f"VROOM son {_state.consecutive_failures} denemede başarısız: "
                f"{_state.last_error}"
            )
        logger.debug("VROOM devre kesicide — doğrudan haversine")
        return await fallback()
    try:
        result = await call()
    except RoutingUnavailable as exc:
        _state.note_failure(exc)
        if mode == "vroom":
            raise
        return await fallback()
    _state.note_success()
    return result


async def plan_route(
    *, depot_lat: float, depot_lng: float, points: list[RoutePoint]
) -> RoutePlan:
    """Ayarlara göre sağlayıcı seçip planlar. ``auto`` modda VROOM düşerse
    haversine'e (log'lu, devre kesicili) geriler — geliştirme kurulumsuz çalışır."""
    mode = _mode()

    async def _haversine() -> RoutePlan:
        return await HaversineRoutingProvider().plan(
            depot_lat=depot_lat, depot_lng=depot_lng, points=points
        )

    if mode == "haversine":
        return await _haversine()
    return await _with_vroom(
        lambda: VroomRoutingProvider().plan(
            depot_lat=depot_lat, depot_lng=depot_lng, points=points
        ),
        mode,
        _haversine,
    )


async def plan_fleet(
    *,
    points: list[RoutePoint],
    vehicles: list[RouteVehicle],
) -> FleetPlan:
    """Çok araçlı bölüştürme + rota (plan_route ile aynı sağlayıcı seçimi/fallback).

    İP-19: araç NESNESİ alır — start/max_stops/vardiya/fixed_cost araç başına
    (sözleşme §3.1). VROOM işleri araçlara kendisi dağıtır (denge tavanı +
    `costs.fixed` ekonomisi); haversine gereken araç sayısını `max_stops`'tan
    türetip kutupsal-açı dilimleme + NN/2-opt ile yaklaşır."""
    mode = _mode()

    async def _haversine() -> FleetPlan:
        return await HaversineRoutingProvider().plan_fleet(
            points=points, vehicles=vehicles
        )

    if mode == "haversine":
        return await _haversine()
    return await _with_vroom(
        lambda: VroomRoutingProvider().plan_fleet(points=points, vehicles=vehicles),
        mode,
        _haversine,
    )


async def health_snapshot(*, verbose: bool | None = None) -> dict:
    """Rota altyapısının **readiness** durumu (liveness DEĞİL — bkz. `/health/live`).

    ``haversine`` modunda ağ yoklaması yapılmaz (dış servis zaten yok). Diğer
    modlarda ``ROUTING_HEALTH_TTL_SECONDS`` önbellekli GERÇEK bir mini plan
    isteği atılır: VROOM sürecinin ayakta olması yetmez, arkasındaki OSRM verisi
    de yüklü olmalıdır. Devre kesici açıkken ağa çıkılmaz — bilinen hata döner.
    Canlı planlamaların sonucu da önbelleğe yazıldığından (bkz. ``_State``), bayat
    bir "başarılı" yoklama gerçek bozulmayı örtemez.

    ``verbose``: serbest metin hata ayrıntısı dönsün mü. ``/health`` **kimlik
    doğrulaması olmayan public bir uçtur** (Caddy alan adının kökünde yayınlar);
    üretimde iç servis adları ve istisna metinleri oraya konmaz. Varsayılan:
    üretimde kapalı, geliştirmede açık.
    """
    if verbose is None:
        verbose = not settings.is_production
    mode = _mode()
    base: dict = {"provider": mode, "degraded": False}

    def _finish(status: str, *, degraded: bool, detail: str | None = None) -> dict:
        base["status"] = status
        base["degraded"] = degraded
        if verbose:
            base["last_ok_at"] = (
                _state.last_ok_at.isoformat() if _state.last_ok_at else None
            )
            base["last_error"] = _state.last_error
            if detail:
                base["detail"] = detail
        return base

    if mode == "haversine":
        return _finish(
            "haversine",
            degraded=True,
            detail="Yaklaşık (kuş uçuşu) mod — yol ağı sağlayıcısı kapalı",
        )

    if _state.cooling():
        return _finish(
            "down", degraded=True, detail=f"VROOM devre kesicide: {_state.last_error}"
        )

    ttl = max(settings.ROUTING_HEALTH_TTL_SECONDS, 0)

    def _fresh() -> bool:
        return (
            _state.probe_at is not None
            and (_now() - _state.probe_at).total_seconds() < ttl
        )

    if not _fresh():
        async with _state.probe_lock:
            # Kilidi beklerken başka bir istek (ya da gerçek bir planlama) tazelemiş olabilir.
            if not _fresh():
                try:
                    await _vroom.ping(timeout=settings.ROUTING_HEALTH_TIMEOUT_SECONDS)
                    _state.note_success()
                except RoutingUnavailable as exc:
                    _state.note_failure(exc)
                except Exception as exc:  # noqa: BLE001 — sağlık ucu asla patlamaz
                    logger.warning("rota yoklaması beklenmedik hata: %s", exc)
                    _state.probe_ok, _state.probe_error = False, str(exc)
                    _state.probe_at = _now()

    if _state.probe_ok:
        return _finish("connected", degraded=False)
    return _finish(
        "down",
        degraded=True,
        detail=(
            _state.probe_error
            if mode == "vroom"
            else f"VROOM kapalı, haversine tahminine düşülüyor: {_state.probe_error}"
        ),
    )
