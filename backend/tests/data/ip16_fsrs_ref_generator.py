# F-15 referans tablosu üretici — py-fsrs v5.1.3 (FSRS-5) altın değerleri.
# Her senaryo: rating dizisi; her tekrar card.due anında yapılır (due-driven)
# ya da acik gun offsetiyle (offset-driven).
import json
from datetime import datetime, timedelta, timezone

from fsrs import Card, Rating, Scheduler

BASE = datetime(2022, 11, 29, 12, 30, 0, 0, timezone.utc)
R = {"A": Rating.Again, "H": Rating.Hard, "G": Rating.Good, "E": Rating.Easy}


def run_due_driven(ratings):
    """Her tekrar card.due aninda (py-fsrs test_review_card deseni)."""
    sch = Scheduler(enable_fuzzing=False)
    card = Card()
    now = BASE
    steps = []
    for r in ratings:
        card, _log = sch.review_card(card, R[r], review_datetime=now)
        ivl = (card.due - card.last_review).days
        steps.append(
            {
                "rating": r,
                "state": card.state.name,
                "step": card.step,
                "stability": card.stability,
                "difficulty": card.difficulty,
                "interval_days": ivl,
            }
        )
        now = card.due
    return steps


def run_offset_driven(pairs):
    """(rating, elapsed_days) çiftleri — tekrarlar açık gün aralıklarıyla."""
    sch = Scheduler(enable_fuzzing=False)
    card = Card()
    now = BASE
    steps = []
    for r, gap in pairs:
        now = now + timedelta(days=gap)
        card, _log = sch.review_card(card, R[r], review_datetime=now)
        ivl = (card.due - card.last_review).days
        steps.append(
            {
                "rating": r,
                "elapsed_days": gap,
                "state": card.state.name,
                "step": card.step,
                "stability": card.stability,
                "difficulty": card.difficulty,
                "interval_days": ivl,
            }
        )
    return steps


scenarios = {}

# S1-S4: yeni kart x 4 rating (tek tekrar)
for r in "AHGE":
    scenarios[f"yeni_{r}"] = run_due_driven([r])

# S5: py-fsrs test_review_card altin zinciri (13 adim)
scenarios["altin_zincir"] = run_due_driven(list("GGGGGGAAGGGGG"))

# S6: memo_state zinciri (offset) + final Good -> S=49, D=7.0866
scenarios["memo_state"] = run_offset_driven(
    [("A", 0), ("G", 0), ("G", 1), ("G", 3), ("G", 8), ("G", 21)]
)
# final adim: bir Good daha, elapsed = son interval
last = scenarios["memo_state"][-1]
scenarios["memo_state_final"] = run_offset_driven(
    [("A", 0), ("G", 0), ("G", 1), ("G", 3), ("G", 8), ("G", 21), ("G", last["interval_days"])]
)

# S6b: py-fsrs test_memo_state birebir — ofset tekrardan SONRA eklenir,
# yani elapsed dizisi bir kaymis olur (S=49 beklenir)
scenarios["memo_state_upstream"] = run_offset_driven(
    [("A", 0), ("G", 0), ("G", 0), ("G", 1), ("G", 3), ("G", 8), ("G", 21)]
)

# S7: Hard zinciri (ogrenmede Hard davranisi + review Hard cezasi)
scenarios["hard_zinciri"] = run_due_driven(list("HHGGHH"))

# S8: Easy hizli graduate + Easy bonus zinciri
scenarios["easy_zinciri"] = run_due_driven(list("EEE"))

# S9: ardisik lapse (Again x3 review'da)
scenarios["ardisik_lapse"] = run_due_driven(list("GGAGAGA"))

# S10: karisik gercekci oturum
scenarios["karisik"] = run_due_driven(list("GHEGAHG"))

# S11: cok uzun araliklarla (offset) — gec kalinan tekrarlar
scenarios["gec_tekrar"] = run_offset_driven(
    [("G", 0), ("G", 0), ("G", 30), ("G", 400), ("G", 1000)]
)

# S12: same-day tekrarlar (short-term formul, elapsed <1 gun)
scenarios["ayni_gun"] = run_offset_driven(
    [("G", 0), ("G", 0), ("A", 0), ("G", 0), ("E", 0)]
)

print(json.dumps(scenarios, indent=1))
total = sum(len(v) for v in scenarios.values())
import sys
print(f"# senaryo grubu: {len(scenarios)}, toplam adim: {total}", file=sys.stderr)
