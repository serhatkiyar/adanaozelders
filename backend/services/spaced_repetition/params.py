"""İP-16 FSRS-5 parametreleri — TEK doğruluk kaynağı (sözleşme §1.1).

Değerler py-fsrs v5.1.3 varsayılanlarıdır (son FSRS-5 sürümü); fuzz kapalı,
kendi öğrenme-bilimi iddiamız yok. Referans üretici:
`tests/data/ip16_fsrs_ref_generator.py`.
"""
from __future__ import annotations

# 19 ağırlık (0-indeksli; w[0]..w[18]) — py-fsrs v5.1.3 Scheduler().parameters
FSRS_WEIGHTS: tuple[float, ...] = (
    0.40255,
    1.18385,
    3.173,
    15.69105,
    7.1949,
    0.5345,
    1.4604,
    0.0046,
    1.54575,
    0.1192,
    1.01925,
    1.9395,
    0.11,
    0.29605,
    2.2698,
    0.2315,
    2.9898,
    0.51655,
    0.6621,
)

DECAY: float = -0.5
FACTOR: float = 0.9 ** (1 / DECAY) - 1  # = 19/81

DESIRED_RETENTION: float = 0.9
MAXIMUM_INTERVAL_DAYS: int = 36500

LEARNING_STEPS_MINUTES: tuple[float, ...] = (1, 10)
RELEARNING_STEPS_MINUTES: tuple[float, ...] = (10,)

LEECH_THRESHOLD: int = 8

# Gün sınırı (K-9): Europe/Istanbul, sabah 04:00 devrilmesi.
ROLLOVER_HOUR: int = 4
TIMEZONE_NAME: str = "Europe/Istanbul"

# Günlük varsayılan limitler (deste NULL bırakırsa).
DEFAULT_NEW_PER_DAY: int = 20
DEFAULT_REVIEWS_PER_DAY: int = 200
