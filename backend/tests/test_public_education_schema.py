"""Herkese açık öğretmen detayı diploma dosyasını sızdırmaz.

Özgeçmiş bölümü okul/derece/yıl ve doğrulama durumunu gösterir; diploma
DOSYASININ adresi/adı yalnız sahibine ve admine döner (bkz. OwnEducationOut).
"""
from __future__ import annotations

from schemas.education import PublicEducationOut
from schemas.tutor import TutorSearchOut


def test_public_egitimde_belge_alani_yok():
    alanlar = set(PublicEducationOut.model_fields)
    assert "document_url" not in alanlar
    assert "document_name" not in alanlar
    assert {"school_name", "degree", "start_year", "end_year", "verification_status"} <= alanlar


def test_ogretmen_detayi_public_egitim_semasini_kullanir():
    tip = TutorSearchOut.model_fields["educations"].annotation
    assert "PublicEducationOut" in str(tip)
