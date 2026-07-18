"""Kendi-filo teslimat KPI hesabı (Faz 6, PDS §14).

Saf hesap katmanı (DB'siz, pytest'li) + ince DB toplama. **Hedef disiplini**:
ilk 90 gün hedefsiz BASELINE ölçülür — bu katman ham sayılar + türetilmiş
oranlar (izleme yönü) verir; kırmızı/yeşil yargı ÜRETMEZ (PDS §14).

Maliyet/durak, SMS/sipariş gibi UNIT ECONOMICS metrikleri maliyet girdisi
(yakıt/amortisman/kurye saati) gerektirir — bu bir operasyon kararıdır; girdi
tanımlanana dek bu katman yalnız operasyonel/deneyim KPI'larını hesaplar.
"""
from __future__ import annotations

import datetime
from dataclasses import dataclass, field


def rate(numerator: int, denominator: int) -> float | None:
    """Oran (0..1), payda 0 ise None (henüz veri yok — 0 demek yanıltıcı olurdu).
    İki ondalığa yuvarlanır."""
    if denominator <= 0:
        return None
    return round(numerator / denominator, 4)


@dataclass
class DeliveryKpi:
    """Bir pencere için teslimat KPI özeti (ham sayı + oran; hedef YOK)."""

    window_days: int
    # Ham durak sonuçları
    delivered: int = 0
    failed: int = 0
    rescheduled: int = 0
    # Türetilmiş (payda 0 ise None)
    delivered_count: int = 0  # söz tutma/ilk-deneme paydası (teslim edilenler)
    first_attempt_delivered: int = 0
    on_time_delivered: int = 0
    promised_delivered: int = 0  # söz günü olan teslimler (pencere isabeti paydası)
    # FAILED neden dağılımı (Pareto): kod -> adet
    fail_by_reason: dict[str, int] = field(default_factory=dict)
    # Kurye kusuru sayılmayan başarısızlıklar (E4/D8/müşteri talebi)
    failed_not_courier_fault: int = 0
    # Teslim sonrası müşteri değerlendirmesi (Faz 7): 👍/👎 + sorun Pareto'su
    feedback_up: int = 0
    feedback_down: int = 0
    feedback_problems: dict[str, int] = field(default_factory=dict)

    @property
    def first_attempt_rate(self) -> float | None:
        return rate(self.first_attempt_delivered, self.delivered_count)

    @property
    def satisfaction_rate(self) -> float | None:
        """👍 oranı: 👍 / (👍 + 👎). Değerlendirme yoksa None (0 yanıltıcı)."""
        return rate(self.feedback_up, self.feedback_up + self.feedback_down)

    @property
    def on_time_rate(self) -> float | None:
        """Söz tutma: söz gününde/öncesinde teslim / söz günü olan teslimler."""
        return rate(self.on_time_delivered, self.promised_delivered)

    @property
    def failure_rate(self) -> float | None:
        """Başarısız deneme oranı: FAILED / (DELIVERED + FAILED)."""
        return rate(self.failed, self.delivered + self.failed)

    def to_dict(self) -> dict:
        return {
            "window_days": self.window_days,
            "delivered": self.delivered,
            "failed": self.failed,
            "rescheduled": self.rescheduled,
            "delivered_count": self.delivered_count,
            "first_attempt_delivered": self.first_attempt_delivered,
            "first_attempt_rate": self.first_attempt_rate,
            "on_time_delivered": self.on_time_delivered,
            "promised_delivered": self.promised_delivered,
            "on_time_rate": self.on_time_rate,
            "failure_rate": self.failure_rate,
            "failed_not_courier_fault": self.failed_not_courier_fault,
            "fail_by_reason": self.fail_by_reason,
            "feedback_up": self.feedback_up,
            "feedback_down": self.feedback_down,
            "satisfaction_rate": self.satisfaction_rate,
            "feedback_problems": self.feedback_problems,
        }


def is_on_time(
    delivered_at: datetime.datetime | None,
    promised_date: datetime.date | None,
    utc_offset_hours: int,
) -> bool | None:
    """Teslim, söz gününde ya da öncesinde mi yapıldı? Söz günü ya da teslim
    zamanı yoksa None (pencere isabeti paydasına girmez). Teslim anı UTC →
    yerel takvim gününe çevrilip söz günüyle kıyaslanır."""
    if delivered_at is None or promised_date is None:
        return None
    local = delivered_at + datetime.timedelta(hours=utc_offset_hours)
    return local.date() <= promised_date
