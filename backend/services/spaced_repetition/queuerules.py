"""İP-16 saf kuyruk/limit kuralları (sözleşme §4).

Sıra (Q-9): (1) vadesi gelmiş intraday learning, (2) review, (3) yeni —
her kovada `due` artan, eşitlikte `card_id`; yeni kartlarda ekleniş sırası
(`card_id`). Limit kalıtımı (L-3): zincirdeki tanımlı limitlerin minimumu.
Servis katmanı bu yardımcıları kullanır; burada DB/IO yoktur.
"""
from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime

from services.spaced_repetition import params
from services.spaced_repetition.engine import CardPhase

# Learning kartı vadesi gelmemişse ve başka kart yoksa bu pencere içinde
# erken gösterilir (Anki varsayılanı, §4.1).
LEARN_AHEAD_MINUTES: int = 20

# Kuyruk kovaları (küçük önce gelir).
BUCKET_LEARNING: int = 0
BUCKET_REVIEW: int = 1
BUCKET_NEW: int = 2

_PHASE_BUCKET = {
    CardPhase.LEARNING: BUCKET_LEARNING,
    CardPhase.RELEARNING: BUCKET_LEARNING,
    CardPhase.REVIEW: BUCKET_REVIEW,
    CardPhase.NEW: BUCKET_NEW,
}


def queue_bucket(phase: CardPhase | str) -> int:
    """Fazın kuyruk kovası: learning/relearning → review → new."""
    return _PHASE_BUCKET[CardPhase(phase)]


def queue_sort_key(
    phase: CardPhase | str, due: datetime | None, card_id: int
) -> tuple[int, float, int]:
    """Deterministik sıralama anahtarı (Q-9): kova → due → card_id.

    Yeni kartlarda `due` yoktur; ekleniş sırası (`card_id`) belirleyicidir.
    """
    due_key = due.timestamp() if due is not None else 0.0
    return (queue_bucket(phase), due_key, card_id)


def effective_limits(
    chain: Iterable[tuple[int | None, int | None]],
) -> tuple[int, int]:
    """Kökten seçili desteye zincir için efektif (yeni, review) limitleri.

    Tanımlı (None olmayan) değerlerin MİNİMUMU alınır (L-3); zincirde hiç
    tanım yoksa varsayılanlar geçerlidir.
    """
    new_values = []
    review_values = []
    for new_per_day, reviews_per_day in chain:
        if new_per_day is not None:
            new_values.append(new_per_day)
        if reviews_per_day is not None:
            review_values.append(reviews_per_day)
    return (
        min(new_values) if new_values else params.DEFAULT_NEW_PER_DAY,
        min(review_values) if review_values else params.DEFAULT_REVIEWS_PER_DAY,
    )
