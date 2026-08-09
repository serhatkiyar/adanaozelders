"""İP-16 FSRS-5 saf planlayıcı motoru (py-fsrs v5.1.3 birebir).

DB bilmez, IO yapmaz, kendi saatini okumaz. Deterministiktir (fuzz yok).
Formüller: sözleşme §1.2, adım makinesi §1.3.

## Zaman burada YOK (denetim H3)

Motor takvim aritmetiği yapmaz: ne `datetime` görür, ne `timedelta` hesaplar,
ne de `due` üretir. Girdisi **geçen çalışma günü sayısıdır** (`elapsed_days`),
çıktısı **bir sonraki aralık** (`interval_minutes`); vade damgasını çağıran
koyar.

Sebebi ölçülmüş bir hatadır: motor eskiden `(now - last_review).days`
kullanıyordu, kuyruk ise gün sınırını `Europe/Istanbul − 4 saat` ile çözüyordu.
İki farklı taban, aynı kartı iki yerde farklı günde sayıyordu — Pazartesi
20:00'de cevaplanıp Salı 09:00'da tekrar cevaplanan kart motora göre "aynı
gün"dü (13 saat) ve Pazartesi 23:00'teki cevapla birebir aynı S değerini
(14.077712147375411) üretiyordu.

**"Geçen gün" ölçüsünün tabanı artık tektir** — `dayboundary.study_day`
farkı — ve onu çağıran verir. Ama sistemde **hâlâ iki granülarite var** ve bu
düzeltmeyle kapanmadı: `elapsed_days` çalışma GÜNÜ ölçer, `due_at` ise AN
tutar (`now + interval_minutes`) ve G-5 karşılaştırması (`due_at <= now`) an
üzerinden yapılır. Sonucu ölçülmüştür: Pazartesi 20:00'de cevaplanan iki
günlük kartın vadesi Çarşamba 20:00'dir, yani kart kendi çalışma gününün
sabahında kuyrukta GÖRÜNMEZ; ayrıca kullanıcı vadeden geç cevapladıkça damga
ileri kayar (20:00 → 22:00 → 00:00 → 02:00 → 04:00) ve 04:00'ü aşınca bir
çalışma günü daha atlar. Bu, bilinçli bir tasarım değil kayıtlı bir borçtur:
sözleşme §11 → "vade damgası an tabanında, elapsed çalışma günü tabanında".
Motor bu asimetrinin dışındadır (an görmez), ama okuyan "tek taban" cümlesini
tüm sisteme genellememeli.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum

from services.spaced_repetition import params

_W = params.FSRS_WEIGHTS


class CardPhase(str, Enum):
    NEW = "NEW"
    LEARNING = "LEARNING"
    REVIEW = "REVIEW"
    RELEARNING = "RELEARNING"


@dataclass(frozen=True)
class SrsCardState:
    """Kartın hafıza durumu. `due`/`last_review` bilinçli olarak YOKTUR —
    onlar takvim damgasıdır ve çağıranda (srs_service/DB) yaşar."""

    phase: CardPhase
    step: int | None
    stability: float | None
    difficulty: float | None
    reps: int
    lapses: int

    @classmethod
    def new(cls) -> "SrsCardState":
        return cls(
            phase=CardPhase.NEW,
            step=None,
            stability=None,
            difficulty=None,
            reps=0,
            lapses=0,
        )


@dataclass(frozen=True)
class ReviewResult:
    state: SrsCardState
    interval_minutes: float


# ── Saf formüller (§1.2) ─────────────────────────────────────────────────────

def _clamp(value: float, lo: float, hi: float) -> float:
    return min(max(value, lo), hi)


def _initial_stability(rating: int) -> float:
    return max(_W[rating - 1], 0.1)


def _initial_difficulty(rating: int) -> float:
    return _clamp(_W[4] - math.exp(_W[5] * (rating - 1)) + 1, 1.0, 10.0)


def _next_difficulty(difficulty: float, rating: int) -> float:
    delta = -(_W[6] * (rating - 3))
    damped = difficulty + delta * (10.0 - difficulty) / 9.0  # linear damping
    # Mean reversion hedefi D0(Easy), clamp'li hesaplanır.
    reverted = _W[7] * _initial_difficulty(4) + (1 - _W[7]) * damped
    return _clamp(reverted, 1.0, 10.0)


def _retrievability_at(stability: float, elapsed_days: int) -> float:
    return (1 + params.FACTOR * elapsed_days / stability) ** params.DECAY


def _short_term_stability(stability: float, rating: int) -> float:
    return stability * math.exp(_W[17] * (rating - 3 + _W[18]))


def _next_forget_stability(
    difficulty: float, stability: float, retrievability: float
) -> float:
    long_term = (
        _W[11]
        * difficulty ** (-_W[12])
        * ((stability + 1) ** _W[13] - 1)
        * math.exp((1 - retrievability) * _W[14])
    )
    short_term_cap = stability / math.exp(_W[17] * _W[18])
    return min(long_term, short_term_cap)


def _next_recall_stability(
    difficulty: float, stability: float, retrievability: float, rating: int
) -> float:
    hard_penalty = _W[15] if rating == 2 else 1.0
    easy_bonus = _W[16] if rating == 4 else 1.0
    return stability * (
        1
        + math.exp(_W[8])
        * (11 - difficulty)
        * stability ** (-_W[9])
        * (math.exp((1 - retrievability) * _W[10]) - 1)
        * hard_penalty
        * easy_bonus
    )


def _next_interval_days(
    stability: float, desired_retention: float, maximum_interval_days: int
) -> int:
    raw = (stability / params.FACTOR) * (
        desired_retention ** (1 / params.DECAY) - 1
    )
    return int(_clamp(round(raw), 1, maximum_interval_days))


# ── Motor ────────────────────────────────────────────────────────────────────

def _update_memory(
    state: SrsCardState, rating: int, elapsed_days: int
) -> tuple[float, float]:
    """S/D her cevapta güncellenir (§1.2 formül seçimi)."""
    if state.stability is None or state.difficulty is None:
        return _initial_stability(rating), _initial_difficulty(rating)
    elapsed = max(0, int(elapsed_days))
    if elapsed < 1:
        stability = _short_term_stability(state.stability, rating)
    else:
        retrievability = _retrievability_at(state.stability, elapsed)
        if rating == 1:
            stability = _next_forget_stability(
                state.difficulty, state.stability, retrievability
            )
        else:
            stability = _next_recall_stability(
                state.difficulty, state.stability, retrievability, rating
            )
    return stability, _next_difficulty(state.difficulty, rating)


def _step_interval_minutes(
    steps: tuple[float, ...], step: int, rating: int
) -> tuple[int, float]:
    """Adım makinesi (§1.3) — mezun ETMEYEN dallar: (yeni adım, dakika)."""
    if rating == 1:  # Again — başa dön
        return 0, steps[0]
    # Hard — adım ilerlemez
    if step == 0 and len(steps) == 1:
        return step, steps[0] * 1.5
    if step == 0 and len(steps) >= 2:
        return step, (steps[0] + steps[1]) / 2
    return step, steps[step]


def review(
    state: SrsCardState,
    rating: int,
    *,
    elapsed_days: int,
    desired_retention: float | None = None,
    maximum_interval_days: int | None = None,
) -> ReviewResult:
    """Bir cevabı işler; yeni durum + bir sonraki aralık (dakika) döner.

    `elapsed_days`: son cevaptan bu yana geçen **çalışma günü** sayısı
    (`dayboundary.study_day` farkı). Aynı çalışma gününde verilen ikinci cevap
    için 0'dır ve short-term formülü seçtirir.
    """
    if rating not in (1, 2, 3, 4):
        raise ValueError(f"rating 1..4 olmalı: {rating!r}")
    retention = (
        params.DESIRED_RETENTION if desired_retention is None else desired_retention
    )
    max_ivl = (
        params.MAXIMUM_INTERVAL_DAYS
        if maximum_interval_days is None
        else maximum_interval_days
    )

    phase = CardPhase(state.phase)
    stability, difficulty = _update_memory(state, rating, elapsed_days)
    lapses = state.lapses

    if phase == CardPhase.REVIEW:
        if rating == 1:
            lapses += 1
            new_phase = CardPhase.RELEARNING
            new_step: int | None = 0
            interval_minutes: float = params.RELEARNING_STEPS_MINUTES[0]
        else:
            new_phase = CardPhase.REVIEW
            new_step = None
            days = _next_interval_days(stability, retention, max_ivl)
            interval_minutes = days * 1440
    else:
        # NEW/LEARNING → learning adımları; RELEARNING → relearning adımları.
        if phase == CardPhase.RELEARNING:
            steps = params.RELEARNING_STEPS_MINUTES
            learn_phase = CardPhase.RELEARNING
        else:
            steps = params.LEARNING_STEPS_MINUTES
            learn_phase = CardPhase.LEARNING
        cur_step = state.step if state.step is not None else 0
        graduates = rating == 4 or (rating == 3 and cur_step + 1 >= len(steps))
        if graduates:
            new_phase = CardPhase.REVIEW
            new_step = None
            days = _next_interval_days(stability, retention, max_ivl)
            interval_minutes = days * 1440
        else:
            new_phase = learn_phase
            if rating == 3:  # Good, son adım değil → ilerle
                new_step = cur_step + 1
                interval_minutes = steps[new_step]
            else:
                new_step, interval_minutes = _step_interval_minutes(
                    steps, cur_step, rating
                )

    new_state = SrsCardState(
        phase=new_phase,
        step=new_step,
        stability=stability,
        difficulty=difficulty,
        reps=state.reps + 1,
        lapses=lapses,
    )
    return ReviewResult(state=new_state, interval_minutes=interval_minutes)


def preview_intervals(state: SrsCardState, *, elapsed_days: int) -> dict[int, float]:
    """Dört rating için sonraki aralık (dakika) — yan etkisiz önizleme."""
    return {
        r: review(state, r, elapsed_days=elapsed_days).interval_minutes
        for r in (1, 2, 3, 4)
    }


def retrievability(state: SrsCardState, *, elapsed_days: int) -> float:
    """R(t,S); hiç tekrar edilmemiş kartta 0.0."""
    if state.stability is None:
        return 0.0
    return _retrievability_at(state.stability, max(0, int(elapsed_days)))
