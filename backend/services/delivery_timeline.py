"""Müşteri takip ekranı gösterim yardımcıları (saf, DB'siz — pytest'li).

``project_customer_timeline``: OrderStatusHistory satırlarını müşteriye uygun
olay akışına çevirir — **whitelist projeksiyonu**: yalnız (code, at) sızar;
``reason``/``changed_by`` iç not içerebileceğinden ASLA dönmez. Türkçe metinler
frontend sözlüğündedir (kod → kopya).

``eta_window``: nokta ETA'yı müşteri sözü penceresine çevirir ("18:00–19:00").
Nokta ETA müşteriye gösterilmez — tutturamama şikâyeti üretir.

``mask_recipient``: oturumsuz takip sayfasında alıcı adı maskeli gösterilir
(link paylaşılabilir; tam ad PII'dır).
"""
from __future__ import annotations

import dataclasses
import datetime


@dataclasses.dataclass(frozen=True)
class TimelineEvent:
    code: str
    at: datetime.datetime


# Müşteriye gösterilen olay kodları (frontend sözlüğüyle birebir):
# ORDER_RECEIVED, PAYMENT_CONFIRMED, PLANNED_FOR_DELIVERY, OUT_FOR_DELIVERY,
# DELIVERY_FAILED, POSTPONED, DELIVERED, CANCELLED, REFUNDED


def project_customer_timeline(
    history: list[tuple[str | None, str, datetime.datetime]],
    *,
    planned_at: datetime.datetime | None = None,
    last_stop_status: str | None = None,
    postponed_at: datetime.datetime | None = None,
) -> list[TimelineEvent]:
    """History satırlarını (old_status, new_status, created_at) müşteri olaylarına
    projekte eder. Whitelist dışı geçişler sessizce düşer.

    ``planned_at``: siparişin durağının oluşturulduğu an (PLANNED tur) —
    "dağıtım planlandı" sentetik olayı, varsa OUT_FOR_DELIVERY'den önce eklenir.
    ``last_stop_status``: SHIPPED→PAID geri sarımının nedeni durağın son halinden
    okunur (FAILED → teslim edilemedi, RESCHEDULED → müşteri erteledi).
    ``postponed_at``: PLANNED turdayken (henüz SHIPPED olmadan) ertelemede history
    satırı oluşmaz — sentetik POSTPONED bu damgayla eklenir (history'den zaten
    POSTPONED üretildiyse eklenmez; çift satır olmaz).
    """
    events: list[TimelineEvent] = []
    for old, new, at in history:
        code: str | None = None
        if new == "PENDING":
            code = "ORDER_RECEIVED"
        elif new == "PAID" and old in (None, "PENDING"):
            code = "PAYMENT_CONFIRMED"
        elif new == "SHIPPED":
            code = "OUT_FOR_DELIVERY"
        elif new == "PAID" and old == "SHIPPED":
            # Geri sarım: kurye ulaşamadı mı, müşteri mi erteledi?
            code = "POSTPONED" if last_stop_status == "RESCHEDULED" else "DELIVERY_FAILED"
        elif new == "DELIVERED":
            code = "DELIVERED"
        elif new == "CANCELLED":
            code = "CANCELLED"
        elif new == "REFUNDED":
            code = "REFUNDED"
        if code is not None:
            events.append(TimelineEvent(code=code, at=at))

    if planned_at is not None:
        # Sentetik "dağıtım planlandı" — ilk OUT_FOR_DELIVERY'den önce ve
        # PAYMENT_CONFIRMED'dan sonra anlamlı; kendi damgasıyla sıraya girer.
        events.append(TimelineEvent(code="PLANNED_FOR_DELIVERY", at=planned_at))

    if postponed_at is not None and not any(e.code == "POSTPONED" for e in events):
        events.append(TimelineEvent(code="POSTPONED", at=postponed_at))

    events.sort(key=lambda e: e.at)
    return events


def eta_window(
    eta: datetime.datetime,
    *,
    early_minutes: int,
    late_minutes: int,
    round_to_minutes: int = 15,
) -> tuple[datetime.datetime, datetime.datetime]:
    """Nokta ETA → (başlangıç, bitiş) pencere; uçlar round_to'ya yuvarlanır
    (başlangıç aşağı, bitiş yukarı — pencere asla ETA'yı dışlamaz)."""
    start = eta - datetime.timedelta(minutes=early_minutes)
    end = eta + datetime.timedelta(minutes=late_minutes)
    step = datetime.timedelta(minutes=round_to_minutes)

    def _floor(dt: datetime.datetime) -> datetime.datetime:
        base = dt.replace(minute=0, second=0, microsecond=0)
        return base + step * ((dt - base) // step)

    def _ceil(dt: datetime.datetime) -> datetime.datetime:
        floored = _floor(dt)
        return floored if floored == dt else floored + step

    return _floor(start), _ceil(end)


_MASK_KEEP = 2
_MASK_TAIL = "*****"


def _mask_words(text: str) -> str:
    """Kargo sektörü maskesi: her kelimenin ilk 2 karakteri kalır, gerisi yıldız.

    Yurtiçi/Aras vb. takip sayfalarındaki davranış — sayı da harf de aynı kurala
    girer ("18*****", "KE*****"). Alıcı gönderisini tanır, üçüncü kişi adresi
    okuyamaz.
    """
    return " ".join(w[:_MASK_KEEP] + _MASK_TAIL for w in text.split())


def mask_address(
    address: str | None,
    district: str | None = None,
    city: str | None = None,
) -> str | None:
    """Teslimat adresini oturumsuz takip sayfası için maskeler.

    "Kurtuluş Mah. Atatürk Cad. No:12 Daire 5" + Seyhan/Adana
      → "Ku***** Ma***** At***** Ca***** No***** Da***** 5***** Se***** Ad*****"

    Takip linki SMS ile gider ve iletilebilir; adresin tamamı maskelenir. Adres
    zaten ilçe/il içeriyorsa kuyruk tekrar eklenmez.
    """
    base = " ".join(address.split()) if address else ""
    lower = base.casefold()
    tail = " ".join(
        p.strip()
        for p in (district, city)
        if p and p.strip() and p.strip().casefold() not in lower
    )
    full = " ".join(p for p in (base, tail) if p)
    return _mask_words(full) or None


def mask_recipient(name: str | None) -> str | None:
    """"Serhat Kıyar" → "Se***** Kı***** (oturumsuz sayfada PII koruması)."""
    if not name:
        return None
    return _mask_words(name) or None
