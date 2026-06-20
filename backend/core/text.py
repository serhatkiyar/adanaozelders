"""Ortak metin yardımcıları (saf, dış bağımlılıksız)."""

from __future__ import annotations

# İlan başlığı (tutor.headline) için minimum sözcük sayısı kalite kapısı.
HEADLINE_MIN_WORDS = 10


def count_words(text: str | None) -> int:
    """Boşlukla ayrılmış sözcük sayısı. None/boş → 0."""
    if not text:
        return 0
    return len(text.split())
