"""delivery_service saf yardımcıları — DB gerektirmez."""
import datetime

from services.delivery_service import (
    gen_otp,
    hash_otp,
    new_qr_token,
    otp_expired,
    parse_qr_token,
    validate_reorder,
)


def test_parse_qr_token_plain_and_prefixed():
    assert parse_qr_token("abc123") == "abc123"
    assert parse_qr_token("42:abc123") == "abc123"
    assert parse_qr_token("  42:abc123  ") == "abc123"
    # Token'ın kendisi ':' içeriyorsa yalnız İLK ayraç kırpılır (etiket "{id}:{token}").
    assert parse_qr_token("7:ab:cd") == "ab:cd"


def test_gen_otp_six_digits():
    for _ in range(20):
        code = gen_otp()
        assert len(code) == 6 and code.isdigit()


def test_hash_otp_stable_and_trims():
    assert hash_otp("123456") == hash_otp(" 123456 ")
    assert hash_otp("123456") != hash_otp("123457")
    assert len(hash_otp("123456")) == 64  # sha256 hex


def test_new_qr_token_unique_urlsafe():
    tokens = {new_qr_token() for _ in range(50)}
    assert len(tokens) == 50
    assert all(":" not in t for t in tokens)  # payload ayracıyla çakışmamalı


def test_validate_reorder():
    assert validate_reorder([1, 2, 3], [3, 1, 2]) is True
    assert validate_reorder([1, 2, 3], [1, 2]) is False  # eksik
    assert validate_reorder([1, 2, 3], [1, 2, 2]) is False  # tekrar
    assert validate_reorder([1, 2, 3], [1, 2, 4]) is False  # yabancı id
    assert validate_reorder([], []) is True


def test_resolve_tracking_status():
    from services.delivery_service import resolve_tracking_status

    # Yolda: yalnız AKTİF tur + BEKLEYEN durak.
    assert (
        resolve_tracking_status(order_status="SHIPPED", stop_status="PENDING", run_status="ACTIVE")
        == "EN_ROUTE"
    )
    # Planlı turda henüz yola çıkmadı.
    assert (
        resolve_tracking_status(order_status="PAID", stop_status="PENDING", run_status="PLANNED")
        == "NOT_DISPATCHED"
    )
    # Teslim: sipariş ya da durak hangisi işaretliyse.
    assert (
        resolve_tracking_status(order_status="DELIVERED", stop_status=None, run_status=None)
        == "DELIVERED"
    )
    assert (
        resolve_tracking_status(order_status="SHIPPED", stop_status="DELIVERED", run_status="ACTIVE")
        == "DELIVERED"
    )
    # Teslim edilemedi → FAILED (yeniden planlanacak).
    assert (
        resolve_tracking_status(order_status="PAID", stop_status="FAILED", run_status="ACTIVE")
        == "FAILED"
    )
    # Hiç durağı yok.
    assert (
        resolve_tracking_status(order_status="PAID", stop_status=None, run_status=None)
        == "NOT_DISPATCHED"
    )


def test_otp_expired():
    now = datetime.datetime(2026, 7, 3, 12, 0, tzinfo=datetime.timezone.utc)
    assert otp_expired(None, now) is True  # hiç gönderilmemiş
    fresh = now - datetime.timedelta(minutes=1)
    assert otp_expired(fresh, now) is False
    stale = now - datetime.timedelta(minutes=999)
    assert otp_expired(stale, now) is True
