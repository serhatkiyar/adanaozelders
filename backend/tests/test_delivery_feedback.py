"""Teslimat değerlendirmesi (Faz 7) — saf testler: şema doğrulama + KPI oranı."""
import pytest
from pydantic import ValidationError

from schemas.delivery import DeliveryFeedbackIn
from services.delivery_metrics import DeliveryKpi


def test_gecerli_sorun_kodlari():
    fb = DeliveryFeedbackIn(
        thumbs_up=False,
        problem_codes=["GEC_TESLIMAT", "HASARLI_PAKET", "GEC_TESLIMAT"],
    )
    # Tekrar eden kod tekilleştirilir, sıra korunur.
    assert fb.problem_codes == ["GEC_TESLIMAT", "HASARLI_PAKET"]


def test_gecersiz_sorun_kodu_reddedilir():
    with pytest.raises(ValidationError):
        DeliveryFeedbackIn(thumbs_up=False, problem_codes=["OLMAYAN_KOD"])


def test_yorum_uzunluk_siniri():
    with pytest.raises(ValidationError):
        DeliveryFeedbackIn(thumbs_up=True, comment="x" * 501)


def test_satisfaction_rate():
    k = DeliveryKpi(window_days=30, feedback_up=8, feedback_down=2)
    assert k.satisfaction_rate == 0.8
    assert k.to_dict()["satisfaction_rate"] == 0.8


def test_satisfaction_rate_veri_yokken_none():
    k = DeliveryKpi(window_days=30)
    assert k.satisfaction_rate is None
    d = k.to_dict()
    assert d["feedback_up"] == 0
    assert d["feedback_problems"] == {}
