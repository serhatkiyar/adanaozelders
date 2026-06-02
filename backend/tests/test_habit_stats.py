import datetime

from services.habit_service import compute_habit_stats

TODAY = datetime.date(2026, 6, 2)  # Salı


def _days(*offsets: int, count: int = 1) -> dict[datetime.date, int]:
    """TODAY'den `offset` gün önceki günlere `count` veren sözlük."""
    return {TODAY - datetime.timedelta(days=o): count for o in offsets}


# ── Günlük ───────────────────────────────────────────────────────
def test_daily_empty():
    s = compute_habit_stats("daily", 1, {}, TODAY)
    assert s["current_streak"] == 0
    assert s["longest_streak"] == 0
    assert s["total_completions"] == 0
    assert s["done"] is False


def test_daily_streak_includes_today():
    s = compute_habit_stats("daily", 1, _days(0, 1, 2), TODAY)
    assert s["current_streak"] == 3
    assert s["done"] is True
    assert s["today_count"] == 1


def test_daily_streak_unbroken_when_today_not_done_yet():
    # Bugün henüz yapılmadı ama dün/önceki günler dolu — seri kırılmamalı.
    s = compute_habit_stats("daily", 1, _days(1, 2, 3), TODAY)
    assert s["current_streak"] == 3
    assert s["done"] is False


def test_daily_gap_breaks_current_streak():
    # 0 ve 1 dolu, 2 boş, 3-4 dolu → güncel seri 2, en uzun 2.
    s = compute_habit_stats("daily", 1, _days(0, 1, 3, 4), TODAY)
    assert s["current_streak"] == 2
    assert s["longest_streak"] == 2
    assert s["total_completions"] == 4


def test_daily_target_requires_count():
    # Hedef 3; bugün 2 → tamamlanmadı; dün 3 → o gün sayılır.
    counts = {TODAY: 2, TODAY - datetime.timedelta(days=1): 3}
    s = compute_habit_stats("daily", 3, counts, TODAY)
    assert s["done"] is False
    assert s["period_count"] == 2
    assert s["current_streak"] == 1  # sadece dün hedefe ulaştı


# ── Haftalık ─────────────────────────────────────────────────────
def test_weekly_counts_days_in_week():
    # Bu hafta (Pzt 1 Haz, Salı 2 Haz dahil) 3 gün hedefli; 2 gün işaretli.
    counts = {
        datetime.date(2026, 6, 1): 1,
        datetime.date(2026, 6, 2): 1,
    }
    s = compute_habit_stats("weekly", 3, counts, TODAY)
    assert s["period_count"] == 2
    assert s["done"] is False
    assert s["current_streak"] == 0


def test_weekly_complete_week_streak():
    # Geçen hafta (25-31 May) hedef 2 → 2 gün; bu hafta 2 gün → iki tam hafta.
    counts = {
        datetime.date(2026, 5, 25): 1,
        datetime.date(2026, 5, 26): 1,
        datetime.date(2026, 6, 1): 1,
        datetime.date(2026, 6, 2): 1,
    }
    s = compute_habit_stats("weekly", 2, counts, TODAY)
    assert s["done"] is True
    assert s["current_streak"] == 2
    assert s["total_completions"] == 2
