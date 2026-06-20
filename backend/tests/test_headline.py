import pytest
from pydantic import ValidationError

from core.text import HEADLINE_MIN_WORDS, count_words
from schemas.tutor import TutorProfileUpdate


def test_count_words():
    assert count_words(None) == 0
    assert count_words("") == 0
    assert count_words("   ") == 0
    assert count_words("tek") == 1
    assert count_words("  iki   kelime  ") == 2


def test_headline_none_allowed():
    # Başlık opsiyoneldir (taslak); None geçerli.
    m = TutorProfileUpdate(headline=None)
    assert m.headline is None


def test_headline_empty_allowed():
    m = TutorProfileUpdate(headline="   ")
    assert m.headline == "   "


def test_headline_too_short_rejected():
    short = " ".join(["kelime"] * (HEADLINE_MIN_WORDS - 1))
    with pytest.raises(ValidationError):
        TutorProfileUpdate(headline=short)


def test_headline_min_words_accepted():
    ok = " ".join(["kelime"] * HEADLINE_MIN_WORDS)
    m = TutorProfileUpdate(headline=ok)
    assert count_words(m.headline) == HEADLINE_MIN_WORDS
