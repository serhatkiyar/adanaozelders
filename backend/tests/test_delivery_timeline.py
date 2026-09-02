"""delivery_timeline saf yardımcıları: whitelist projeksiyonu + ETA penceresi + maske."""
import datetime

from services.delivery_timeline import (
    eta_window,
    mask_address,
    mask_recipient,
    project_customer_timeline,
)

UTC = datetime.timezone.utc


def _t(hour: int, minute: int = 0) -> datetime.datetime:
    return datetime.datetime(2026, 7, 10, hour, minute, tzinfo=UTC)


# ── project_customer_timeline ─────────────────────────────────────────────────────


def test_happy_path_projection_order():
    events = project_customer_timeline(
        [
            (None, "PENDING", _t(9)),
            ("PENDING", "PAID", _t(9, 5)),
            ("PAID", "SHIPPED", _t(11)),
            ("SHIPPED", "DELIVERED", _t(15)),
        ],
        planned_at=_t(10),
        last_stop_status="DELIVERED",
    )
    assert [e.code for e in events] == [
        "ORDER_RECEIVED",
        "PAYMENT_CONFIRMED",
        "PLANNED_FOR_DELIVERY",
        "OUT_FOR_DELIVERY",
        "DELIVERED",
    ]
    # Zaman sırası korunur (sentetik olay damgasıyla araya girer).
    assert [e.at for e in events] == sorted(e.at for e in events)


def test_rewind_failed_vs_rescheduled():
    rows = [
        ("PAID", "SHIPPED", _t(11)),
        ("SHIPPED", "PAID", _t(15)),
    ]
    failed = project_customer_timeline(rows, last_stop_status="FAILED")
    assert [e.code for e in failed] == ["OUT_FOR_DELIVERY", "DELIVERY_FAILED"]

    postponed = project_customer_timeline(rows, last_stop_status="RESCHEDULED")
    assert [e.code for e in postponed] == ["OUT_FOR_DELIVERY", "POSTPONED"]


def test_internal_details_never_leak():
    """Whitelist dışı geçişler düşer; dönen olaylarda yalnız code+at alanı var
    (reason/changed_by hiçbir biçimde taşınmaz)."""
    events = project_customer_timeline(
        [
            (None, "PENDING", _t(9)),
            ("PAID", "WEIRD_INTERNAL", _t(10)),  # whitelist dışı → düşer
        ]
    )
    assert [e.code for e in events] == ["ORDER_RECEIVED"]
    assert set(vars(events[0])) == {"code", "at"}


def test_cancelled_and_refunded():
    events = project_customer_timeline(
        [
            (None, "PENDING", _t(9)),
            ("PENDING", "CANCELLED", _t(10)),
        ]
    )
    assert [e.code for e in events] == ["ORDER_RECEIVED", "CANCELLED"]

    events = project_customer_timeline([("DELIVERED", "REFUNDED", _t(18))])
    assert [e.code for e in events] == ["REFUNDED"]


# ── eta_window ────────────────────────────────────────────────────────────────────


def test_eta_window_rounds_out():
    start, end = eta_window(_t(18, 7), early_minutes=15, late_minutes=45)
    assert start == _t(17, 45)  # 17:52 → aşağı 17:45
    assert end == _t(19, 0)  # 18:52 → yukarı 19:00
    assert start <= _t(18, 7) <= end


def test_eta_window_exact_boundary_not_expanded():
    start, end = eta_window(_t(18, 15), early_minutes=15, late_minutes=45)
    assert start == _t(18, 0)
    assert end == _t(19, 0)  # 19:00 tam adımda — yukarı taşmaz


# ── mask_recipient ────────────────────────────────────────────────────────────────


def test_mask_recipient():
    # Sektör maskesi: her kelimenin ilk 2 karakteri kalır (Yurtiçi/Aras deseni).
    assert mask_recipient("Serhat Kıyar") == "Se***** Kı*****"
    assert mask_recipient("Ayşe") == "Ay*****"
    assert mask_recipient("  ") is None
    assert mask_recipient(None) is None


# ── mask_address ──────────────────────────────────────────────────────────────────


def test_mask_address_keeps_only_first_two_chars_of_each_word():
    out = mask_address("Kurtuluş Mah. Atatürk Cad. No:12", "Seyhan", "Adana")
    assert out == "Ku***** Ma***** At***** Ca***** No***** Se***** Ad*****"


def test_mask_address_masks_numbers_like_words():
    # Kapı/blok sayısı da aynı kurala girer: "18*****" (sektör davranışı).
    assert mask_address("1845 Sokak", None, None) == "18***** So*****"


def test_mask_address_does_not_repeat_district_and_city():
    out = mask_address("Kurtuluş Mah. Seyhan Adana", "Seyhan", "Adana")
    assert out == "Ku***** Ma***** Se***** Ad*****"


def test_mask_address_district_only_when_address_missing():
    assert mask_address(None, "Seyhan", "Adana") == "Se***** Ad*****"
    assert mask_address("   ", None, None) is None
    assert mask_address(None, None, None) is None
