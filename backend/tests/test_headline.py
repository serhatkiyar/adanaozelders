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


def test_headline_too_short_TASLAKTA_KABUL_EDILIR():
    """5 Eyl 2026: eşik PATCH'ten kalktı, yalnız yayın kapısında yaşıyor.

    Eskiden burası `ValidationError` bekliyordu. Sihirbaz her adımda
    `PATCH /tutors/me` yaptığı için o kural "sayaç uyarır ama engellemez"
    kararıyla çakışıyordu: kullanıcı adımı geçemiyor ve bizim yazdığımız açık
    mesaj yerine ham şema hatası görüyordu. Taslak artık serbest; eşiğin TEK
    yeri `services/tutor_service.submit_for_approval` (nöbetçisi
    tests/test_tutor_yayin_kapisi.py::test_kisa_baslik_hala_reddedilir).
    """
    short = " ".join(["kelime"] * (HEADLINE_MIN_WORDS - 1))
    m = TutorProfileUpdate(headline=short)
    assert count_words(m.headline) == HEADLINE_MIN_WORDS - 1


def test_headline_min_words_accepted():
    ok = " ".join(["kelime"] * HEADLINE_MIN_WORDS)
    m = TutorProfileUpdate(headline=ok)
    assert count_words(m.headline) == HEADLINE_MIN_WORDS
