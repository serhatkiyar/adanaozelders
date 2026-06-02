from services.task_service import normalize_criteria


def test_empty_criteria_defaults():
    c = normalize_criteria(None)
    assert c == {
        "q": None,
        "priorities": [],
        "label_ids": [],
        "due": [],
        "sort": "smart",
    }


def test_q_trimmed_and_blank_becomes_none():
    assert normalize_criteria({"q": "  rapor  "})["q"] == "rapor"
    assert normalize_criteria({"q": "   "})["q"] is None


def test_priorities_filtered_to_valid_range_unique_order_preserved():
    c = normalize_criteria({"priorities": [2, 2, 5, 0, 1, "3", None]})
    assert c["priorities"] == [2, 1, 3]


def test_label_ids_deduped_and_coerced():
    c = normalize_criteria({"label_ids": ["7", 7, 3, "bad"]})
    assert c["label_ids"] == [7, 3]


def test_due_groups_whitelisted_and_deduped():
    c = normalize_criteria({"due": ["today", "today", "nope", "overdue"]})
    assert c["due"] == ["today", "overdue"]


def test_unknown_sort_falls_back_to_smart():
    assert normalize_criteria({"sort": "weird"})["sort"] == "smart"
    assert normalize_criteria({"sort": "priority"})["sort"] == "priority"
