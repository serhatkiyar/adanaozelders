"""Ortak metin yardımcıları (saf, dış bağımlılıksız)."""

from __future__ import annotations

# İlan başlığı (tutor.headline) için minimum sözcük sayısı kalite kapısı.
HEADLINE_MIN_WORDS = 10

# Saatlik ücret aralığı (kullanıcı kararı, 16 Eyl 2026). İstemci tarafı
# `tutorOnboarding/sozlesme.ts` (UCRET_EN_AZ/UCRET_EN_COK) ve arama filtresinin
# ekseni (`PriceRangeHistogram`) aynı sayıları taşır; taslak serbestçe
# kaydedilir, eşik yayın kapısında (`tutor_service.submit_for_approval`).
HOURLY_RATE_MIN = 250
HOURLY_RATE_MAX = 5000


def count_words(text: str | None) -> int:
    """Boşlukla ayrılmış sözcük sayısı. None/boş → 0."""
    if not text:
        return 0
    return len(text.split())
