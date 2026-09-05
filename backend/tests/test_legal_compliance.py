"""Yasal uyum yardımcıları — fiyat referansı ve hesap anonimleştirmesi.

Kapsanan bulgular:
- P0-23: indirim duyurusunda "son 30 günün en düşük fiyatı" (Fiyat Etiketi
  Yönetmeliği). Serbestçe girilen `compare_at_price` denetimde kabul edilmez.
- P0-20: hesap silme/anonimleştirme. `legalContent.ts` bunu taahhüt ediyordu
  ama karşılığı olan uç yoktu; soft-delete SİLME DEĞİLDİR.
"""
from __future__ import annotations

from decimal import Decimal

from services.account_deletion_service import (
    anonymized_email,
)
from services.store_service import legal_compare_price


def D(v: str) -> Decimal:
    return Decimal(v)


# ── Fiyat referansı ──────────────────────────────────────────────────────────


def test_fiyat_dustuyse_eski_fiyat_gosterilir() -> None:
    # Son 30 günün en düşüğü 150, şimdi 120 → gerçek indirim var.
    assert legal_compare_price(D("120.00"), D("150.00")) == D("150.00")


def test_fiyat_yukseldiyse_indirim_gosterilmez() -> None:
    """Fiyat artmışsa üzeri çizili gösterim yanıltıcıdır."""
    assert legal_compare_price(D("200.00"), D("150.00")) is None


def test_fiyat_ayniysa_indirim_yok() -> None:
    assert legal_compare_price(D("150.00"), D("150.00")) is None


def test_gecmis_yoksa_indirim_iddiasi_yok() -> None:
    """Dayanaksız indirim iddiası ceza konusudur — kayıt yoksa rozet yok."""
    assert legal_compare_price(D("120.00"), None) is None


# ── Hesap anonimleştirme ─────────────────────────────────────────────────────


def test_anonim_eposta_benzersiz_ve_geri_donusumsuz() -> None:
    a = anonymized_email(1, 3)
    b = anonymized_email(2, 3)
    c = anonymized_email(1, 2)  # aynı id, farklı rol
    assert a != b != c and a != c
    # Orijinal veriden hiçbir iz taşımamalı.
    assert "@hesap.silindi" in a
    assert a.startswith("silinmis+")


def test_anonim_eposta_deterministik() -> None:
    """Aynı kullanıcı için aynı değer — tekrar çalıştırma çakışma üretmez."""
    assert anonymized_email(42, 3) == anonymized_email(42, 3)


def test_anonim_degerler_uzunluk_sinirlarina_uyar() -> None:
    """E-posta 255 karakter sınırındadır.

    Kullanıcı adı düğümü 5 Eyl 2026'da kalktı: alan silindi ve
    `anonymized_username` bir gizlilik önlemi değil, NOT NULL dolgusuydu.
    Gerçek anonimleştirme e-posta/ad/telefon/avatar alanlarında ve o duruyor.
    """
    for uid in (1, 999_999_999):
        assert len(anonymized_email(uid, 3)) <= 255
