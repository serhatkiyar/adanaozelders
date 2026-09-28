"""Özel ders e-postaları: üretilebilirlik, kaçış, tarih/süre ve düzen standardı.

Şablonlar henüz olaylara bağlı değil (önce tasarım + önizleme kararı); bu test
bağlandıklarında da geçerli kalacak sözleşmeyi sabitler.
"""
from __future__ import annotations

import datetime
import re

import pytest

from core.config import settings
from core.mail import ozel_ders as od
from core.mail.base import EmailMessage

_UTC = datetime.timezone.utc
_XSS = "<img src=x onerror=alert(1)>"


def _ders(**kw) -> od.Ders:
    base = dict(
        id=42,
        tutor_name="Ayşe H.",
        student_name="Mehmet K.",
        # 23 Eylül 2026 Çarşamba 11:30 UTC = 14:30 Türkiye
        start_at=datetime.datetime(2026, 9, 23, 11, 30, tzinfo=_UTC),
        end_at=datetime.datetime(2026, 9, 23, 12, 30, tzinfo=_UTC),
        mode="ONLINE",
        price="450.00",
    )
    base.update(kw)
    return od.Ders(**base)


def _hepsi(d: od.Ders) -> dict[str, EmailMessage]:
    eski = d.start_at - datetime.timedelta(days=1)
    return {
        "teklif": od.ders_teklifi(to="a@b.co", ders=d),
        "teklif_seri": od.ders_teklifi(to="a@b.co", ders=d, seri_hafta=4),
        "kesinlesti_odeme": od.ders_kesinlesti(to="a@b.co", ders=d, odeme_gerekli=True),
        "kesinlesti": od.ders_kesinlesti(to="a@b.co", ders=d, odeme_gerekli=False),
        "kesinlesti_dogrudan": od.ders_kesinlesti(
            to="a@b.co", ders=d, odeme_gerekli=False, dogrudan_odeme=True
        ),
        "odeme": od.ders_odemesi_alindi(to="a@b.co", ders=d, tutar="450.00"),
        "hatirlatma_ogr": od.ders_hatirlatma(to="a@b.co", ders=d, alici="student"),
        "hatirlatma_ogt": od.ders_hatirlatma(to="a@b.co", ders=d, alici="tutor"),
        "saat_ogr": od.ders_saati_degisti_ogrenciye(to="a@b.co", ders=d, eski_baslangic=eski),
        "saat_ogt": od.ders_saati_degisti_ogretmene(to="a@b.co", ders=d, eski_baslangic=eski),
        "iptal_ogr": od.ders_iptal_edildi(
            to="a@b.co", ders=d, alici="student", iptal_eden="tutor", neden="Hastayım", ucretli=True
        ),
        "iptal_ogt_gec": od.ders_iptal_edildi(
            to="a@b.co", ders=d, alici="tutor", iptal_eden="student", ucretli=True, gec_iptal=True
        ),
        "iptal_admin": od.ders_iptal_edildi(to="a@b.co", ders=d, alici="student", iptal_eden="admin"),
        "tamamlandi_onay": od.ders_tamamlandi(to="a@b.co", ders=d, onay_bekliyor=True),
        "tamamlandi": od.ders_tamamlandi(to="a@b.co", ders=d, onay_bekliyor=False),
        "iade": od.ders_ucreti_iade_edildi(to="a@b.co", ders=d, tutar="450.00"),
        "talep": od.yeni_ders_talebi(to="a@b.co", ders=d, ogrenci_notu="LGS'ye hazırlanıyorum."),
        "ucret_emanet": od.ders_ucreti_ogretmene(to="a@b.co", ders=d, asama="emanette", tutar="450.00"),
        "ucret_aktarildi": od.ders_ucreti_ogretmene(
            to="a@b.co", ders=d, asama="aktarildi", tutar="450.00", kazanc="382.50"
        ),
        "degerlendirme": od.yeni_degerlendirme(
            to="a@b.co", tutor_name="Ayşe H.", puan=5, yorum="Harika", ogrenci_adi="Mehmet K."
        ),
        "inceleniyor": od.ilan_inceleniyor(to="a@b.co", tutor_name="Ayşe H."),
        "onaylandi": od.ilan_onaylandi(to="a@b.co", tutor_name="Ayşe H."),
        "onaylanmadi": od.ilan_onaylanmadi(to="a@b.co", tutor_name="Ayşe H.", not_="Fotoğraf net değil"),
        "video_ok": od.tanitim_videosu_incelendi(to="a@b.co", tutor_name="Ayşe H.", onaylandi=True),
        "video_red": od.tanitim_videosu_incelendi(
            to="a@b.co", tutor_name="Ayşe H.", onaylandi=False, not_="Ses yok"
        ),
        "para_cekme": od.para_cekme_odendi(to="a@b.co", tutor_name="Ayşe H.", tutar="1250.00"),
        "mesaj": od.yeni_mesajlar(
            to="a@b.co", alici_adi="Mehmet K.", gonderen_adi="Ayşe H.", mesajlar=["Merhaba!"]
        ),
    }


@pytest.fixture(autouse=True)
def _https(monkeypatch):
    # Üretim gibi HTTPS kök: logo/ikonlar görsel olarak çizilir.
    monkeypatch.setattr(settings, "FRONTEND_BASE_URL", "https://adanaozelders.com.tr")


def test_tum_ozel_ders_sablonlari_uretilebilir_ve_standarda_uyar() -> None:
    for ad, m in _hepsi(_ders()).items():
        assert isinstance(m, EmailMessage), ad
        assert m.subject and m.text.strip() and m.html.strip(), ad
        govde = m.html.split("<body", 1)[1]
        boyutlar = set(re.findall(r"font-size:(\d+)px", govde))
        assert boyutlar <= {"26", "18", "16", "14", "1"}, (ad, boyutlar)
        assert "<strong" not in govde and "çalışmazsa" not in govde, ad
        assert "aldın." not in govde, ad  # "bu e-postayı … aldın" satırı yok


def test_tarih_ve_sure_turkce_ve_turkiye_saatiyle() -> None:
    d = _ders()
    assert d.zaman == "23 Eylül Çarşamba, 14:30"
    assert d.sure == "1 saat"
    assert _ders(end_at=d.start_at + datetime.timedelta(minutes=90)).sure == "1 saat 30 dk"
    assert _ders(end_at=d.start_at + datetime.timedelta(minutes=45)).sure == "45 dk"


def test_ucretsiz_ilk_ders_ve_yuz_yuze_etiketleri() -> None:
    d = _ders(is_free_lesson=True, price=None, mode="IN_PERSON", location="Seyhan")
    talep = od.yeni_ders_talebi(to="a@b.co", ders=d)
    assert "ücretsiz ilk ders" in talep.subject
    assert "İlk ders ücretsiz" in talep.html
    assert "Yüz yüze · Seyhan" in talep.html
    # Yüz yüze derste "Derse katıl" (canlı oda) düğmesi olmaz.
    hat = od.ders_hatirlatma(to="a@b.co", ders=d, alici="student")
    assert "/canli-ders/42" not in hat.html and "/ders-talepleri/42" in hat.html
    online = od.ders_hatirlatma(to="a@b.co", ders=_ders(), alici="student")
    assert "https://adanaozelders.com.tr/canli-ders/42" in online.html


def test_iptal_iade_metni_gec_iptale_gore_degisir() -> None:
    d = _ders()
    erken = od.ders_iptal_edildi(to="a@b.co", ders=d, alici="student", iptal_eden="student", ucretli=True)
    gec = od.ders_iptal_edildi(
        to="a@b.co", ders=d, alici="student", iptal_eden="student", ucretli=True, gec_iptal=True
    )
    assert "tamamı iade edilecek" in erken.html
    assert "iade edilmez" in gec.html and "tamamı iade" not in gec.html


def test_kullanici_verisi_kacislanir() -> None:
    d = _ders(tutor_name=_XSS, student_name=_XSS, location=_XSS, mode="IN_PERSON")
    for ad, m in _hepsi(d).items():
        assert "<img src=x" not in m.html, ad
    for m in (
        od.yeni_ders_talebi(to="a@b.co", ders=_ders(), ogrenci_notu=_XSS),
        od.yeni_degerlendirme(to="a@b.co", tutor_name="A", puan=3, yorum=_XSS, ogrenci_adi=None),
        od.yeni_mesajlar(to="a@b.co", alici_adi="A", gonderen_adi="B", mesajlar=[_XSS]),
        od.ders_iptal_edildi(to="a@b.co", ders=_ders(), alici="tutor", iptal_eden="student", neden=_XSS),
    ):
        assert "<img src=x" not in m.html
        assert "&lt;img src=x onerror=alert(1)&gt;" in m.html


def test_mesaj_ozeti_son_uc_mesaji_gosterir() -> None:
    m = od.yeni_mesajlar(
        to="a@b.co", alici_adi="A", gonderen_adi="Ayşe H.", mesajlar=[f"mesaj {i}" for i in range(5)]
    )
    assert "5 mesaj gönderdi" in m.subject
    assert "mesaj 4" in m.html and "mesaj 2" in m.html and "mesaj 1" not in m.html
    assert "Önceki 2 mesaj daha var" in m.html
