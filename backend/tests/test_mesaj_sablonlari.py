"""Yeni bildirim metinleri: SMS (ASCII, tek boy), WhatsApp (Meta UTILITY şablon
kuralları) ve mağaza/kütüphane/hesap e-postaları.

Metinler henüz gönderime bağlı değil (önce tasarım + önizleme kararı); bu
nöbetçi, bağlandıklarında da geçerli kalacak kuralları sabitler.
"""
from __future__ import annotations

import datetime
import re

import pytest

from core.config import settings
from core.mail import hesap, kutuphane, magaza
from core.sms import sablonlar as sms
from core.whatsapp_sablonlari import SABLONLAR, _temizle, meta_bilesenleri, waha_metni

_UTC = datetime.timezone.utc
_T = datetime.datetime(2026, 10, 12, 7, 0, tzinfo=_UTC)  # 12 Eki 10:00 TR
_XSS = "<img src=x onerror=alert(1)>"
TEK_BOY = 160


@pytest.fixture(autouse=True)
def _https(monkeypatch):
    monkeypatch.setattr(settings, "FRONTEND_BASE_URL", "https://adanaozelders.com.tr")


# ── SMS ──


def _tum_smsler() -> list[str]:
    uzun = "Çağlar Şükrü Öztürkoğlu Ünsalgil"
    kutup = "Seyhan Belediyesi Merkez Halk Kütüphanesi Çalışma Salonu"
    return [
        sms.ders_hatirlatma(diger_ad=uzun, baslangic=_T, ders_id=999999, online=True),
        sms.ders_hatirlatma(diger_ad=uzun, baslangic=_T, ders_id=999999, online=False),
        sms.ders_iptal(diger_ad=uzun, baslangic=_T, ders_id=999999),
        sms.ders_saati_degisti(ogretmen_ad=uzun, yeni_baslangic=_T, ders_id=999999),
        sms.ders_talebi(ogrenci_ad=uzun, baslangic=_T, ders_id=999999, ucretsiz=True),
        sms.ders_odeme_bekliyor(ogretmen_ad=uzun, baslangic=_T, ders_id=999999),
        sms.deneme_bileti(kutuphane=kutup, baslangic=_T, kisa_kod="AB12CD34", kayit_id=999999),
        sms.calisma_rezervasyonu(kutuphane=kutup, baslangic=_T, kisa_kod="AB12CD34", kayit_id=999999),
        sms.sifre_degisti(),
    ]


def test_sms_ascii_ve_tek_boy() -> None:
    """Tek 'ş' kredi maliyetini ikiye katlar; >160 çok parçaya bölünür."""
    for m in _tum_smsler():
        tr = sorted({ch for ch in m if not ch.isascii()})
        assert not tr, f"ASCII dışı {tr}: {m!r}"
        assert len(m) <= TEK_BOY, f"{len(m)} karakter: {m!r}"
        assert ".." not in m and ". ," not in m, m


def test_sms_turkce_ceviri_ve_tarih() -> None:
    assert sms.ascii_tr("Çağrı Işık Ünlü Şenöz") == "Cagri Isik Unlu Senoz"
    assert sms.kisa_tarih(_T) == "12 Eki 10:00"
    assert "https://adanaozelders.com.tr/canli-ders/42" in sms.ders_hatirlatma(
        diger_ad="Ayşe D.", baslangic=_T, ders_id=42, online=True
    )


# ── WhatsApp ──


def test_whatsapp_sablonlari_meta_kurallarina_uyar() -> None:
    adlar = [s.ad for s in SABLONLAR]
    assert len(adlar) == len(set(adlar))
    for s in SABLONLAR:
        assert re.fullmatch(r"[a-z0-9_]+", s.ad), s.ad
        assert s.kategori == "UTILITY" and s.dil == "tr"
        assert len(s.govde) <= 1024, s.ad
        numaralar = [int(n) for n in re.findall(r"\{\{(\d+)\}\}", s.govde)]
        assert sorted(set(numaralar)) == list(range(1, len(s.degiskenler) + 1)), s.ad
        # Meta: gövde değişkenle başlayamaz / bitemez.
        assert not s.govde.startswith("{{") and not s.govde.rstrip().endswith("}}"), s.ad
        # İşlemsel kategori: tanıtım dili yok.
        assert not re.search(r"indirim|kampanya|fırsat|%\d", s.govde, re.I), s.ad
        if s.dugme_yolu:
            # Dinamik kısım yalnız sonda ve tek değişken.
            assert s.dugme_yolu.count("{{") <= 1 and (
                "{{" not in s.dugme_yolu or s.dugme_yolu.endswith("{{1}}")
            ), s.ad


def test_whatsapp_doldurma_ve_meta_yuku() -> None:
    for s in SABLONLAR:
        degerler = [f"deger{i}\nsatir" for i in range(1, len(s.degiskenler) + 1)]
        metin = waha_metni(s, degerler, dugme_degeri=42)
        assert "{{" not in metin, s.ad
        assert "deger1 satir" in metin  # satır sonu temizlendi
        yuk = meta_bilesenleri(s, degerler, dugme_degeri=42)
        assert len(yuk[0]["parameters"]) == len(s.degiskenler)
        assert all("\n" not in p["text"] for p in yuk[0]["parameters"])
    with pytest.raises(ValueError):
        waha_metni(SABLONLAR[0], ["eksik"])
    assert _temizle("a\tb     c") == "a b c"


# ── E-postalar ──


def _tum_epostalar(ad: str = "Ayşe Yılmaz", metin: str = "Kutu hasarlı geldi") -> dict:
    return {
        "odeme_basarisiz": magaza.odeme_basarisiz(
            to="a@b", name=ad, konu="siparişin", tutar="349.90",
            url="https://adanaozelders.com.tr/siparislerim/1", satirlar=[("siparis", "Sipariş no", "1042")],
        ),
        "iade_talebi": magaza.iade_talebi_alindi(
            to="a@b", name=ad, siparis_id=1, siparis_no="1042", iade_turu="Hasarlı ürün",
            urunler=[metin, "LGS Matematik"], tutar="120.00",
        ),
        "iade_red": magaza.iade_talebi_reddedildi(to="a@b", name=ad, siparis_id=1, siparis_no="1042", not_=metin),
        "iade_tamam": magaza.iade_tamamlandi(to="a@b", name=ad, siparis_id=1, siparis_no="1042", tutar="120"),
        "siparis_iptal": magaza.siparis_iptal_edildi(to="a@b", name=ad, siparis_id=1, siparis_no="1042"),
        "deneme_bileti": kutuphane.deneme_bileti(
            to="a@b", name=ad, kayit_id=7, oturum="LGS Deneme 3", baslangic=_T, sure_dk=135,
            kutuphane=metin, tutar="150", kisa_kod="AB12CD",
        ),
        "deneme_iptal_iade": kutuphane.deneme_bileti_iptal(
            to="a@b", name=ad, oturum="LGS Deneme 3", baslangic=_T, iptal_eden="kutuphane", iade_tutari="150"
        ),
        "deneme_iptal_iadesiz": kutuphane.deneme_bileti_iptal(
            to="a@b", name=ad, oturum="LGS Deneme 3", baslangic=_T, iptal_eden="ogrenci", iade_tutari=None
        ),
        "karne": kutuphane.deneme_karnesi(to="a@b", name=ad, oturum="LGS Deneme 3"),
        "calisma": kutuphane.calisma_rezervasyonu(
            to="a@b", name=ad, kayit_id=8, kutuphane=metin, baslangic=_T,
            bitis=_T + datetime.timedelta(hours=3), tutar="60", kisa_kod="ZX98",
        ),
        "calisma_iptal": kutuphane.calisma_rezervasyonu_iptal(
            to="a@b", name=ad, kutuphane=metin, baslangic=_T, iade_tutari="60"
        ),
        "kutuphane_basvuru": kutuphane.kutuphane_basvurusu_alindi(to="a@b", name=ad, kutuphane=metin),
        "kutuphane_onay": kutuphane.kutuphane_basvurusu_sonuc(to="a@b", name=ad, kutuphane=metin, onaylandi=True),
        "kutuphane_red": kutuphane.kutuphane_basvurusu_sonuc(
            to="a@b", name=ad, kutuphane=metin, onaylandi=False, gerekce=metin
        ),
        "sifre": hesap.sifre_degistirildi(to="a@b", name=ad),
        "sifre_sifirlama": hesap.sifre_degistirildi(to="a@b", name=ad, sifirlama=True),
        "hesap_silindi": hesap.hesap_silindi(to="a@b", name=ad),
    }


def test_epostalar_uretilebilir_ve_standarda_uyar() -> None:
    for ad, m in _tum_epostalar().items():
        assert m.subject and m.text.strip() and m.html.strip(), ad
        govde = m.html.split("<body", 1)[1]
        boyutlar = set(re.findall(r"font-size:(\d+)px", govde))
        assert boyutlar <= {"26", "18", "16", "14", "1"}, (ad, boyutlar)
        assert "<strong" not in govde and "çalışmazsa" not in govde and "aldın." not in govde, ad


def test_epostalarda_kullanici_verisi_kacislanir() -> None:
    for ad, m in _tum_epostalar(ad=_XSS, metin=_XSS).items():
        assert "<img src=x" not in m.html, ad


def test_bilet_giris_kodu_ve_iade_metni() -> None:
    e = _tum_epostalar()
    assert "AB12CD" in e["deneme_bileti"].html and "/rezervasyon/deneme/7" in e["deneme_bileti"].html
    assert "iade edilecek" in e["deneme_iptal_iade"].html
    assert "iade edilmez" in e["deneme_iptal_iadesiz"].html
    assert "sıfırlandı" in e["sifre_sifirlama"].subject
