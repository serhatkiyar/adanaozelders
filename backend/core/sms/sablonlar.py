"""Yeni SMS metinleri — ders, kütüphane ve hesap güvenliği.

Bu metinler henüz gönderime BAĞLANMADI (kullanıcı kararı, 28 Eyl 2026: önce
tasarım + önizleme). Kanal kuralı: SMS yalnız KRİTİK olaylarda ve WhatsApp'a
ulaşılamadığında yedek olarak gider; her şeyin tam hâli e-postadadır.

Kurallar (mevcut şablonlarla aynı, nöbetçi: tests/test_sms_sablonlar.py):
- Gövde ASCII: tek bir 'ş' mesajı UCS-2'ye çevirip kredisini ikiye katlar.
- Tek boy (<=160): Netgsm çok parçalı mesajı ayrı kredi sayar.
- Marka adı yazılmaz: gönderen başlığı (NETGSM_MSGHEADER) markayı taşır.
- Ad alanları kısaltılır (``_ad``): uzun bir ad mesajı ikinci parçaya taşımasın.

Sessiz saat notu: outbox ``sms:*`` işlerini 21:00–08:30 arası sabaha erteler.
Ders hatırlatması ve saat değişikliği gibi zamana bağlı mesajlar ertelenirse
anlamını yitirir; bağlanırken bu ikisi ya doğrudan gönderilmeli ya da sessiz
saatte hiç gönderilmemelidir.
"""
from __future__ import annotations

import datetime

from core import frontend_yollari as yol
from core.config import settings

_TR_TZ = datetime.timezone(datetime.timedelta(hours=3))
_AYLAR = ("Oca", "Sub", "Mar", "Nis", "May", "Haz", "Tem", "Agu", "Eyl", "Eki", "Kas", "Ara")
_CEVIRI = str.maketrans("çğıöşüÇĞİÖŞÜâîûÂÎÛ", "cgiosuCGIOSUaiuAIU")


def ascii_tr(metin: str) -> str:
    """Türkçe karakterleri ASCII karşılığına çevirir; kalan ASCII dışı karakteri atar."""
    return metin.translate(_CEVIRI).encode("ascii", "ignore").decode("ascii")


def _ad(ad: str, sinir: int = 18) -> str:
    """Kişi/yer adı: ASCII ve en fazla ``sinir`` karakter; kelime ortasından kesmez.

    Kısaltmada nokta eklenmez: ad cümle sonuna denk gelirse ".." oluşurdu.
    """
    a = " ".join(ascii_tr(ad).split())
    if len(a) <= sinir:
        return a
    kes = a[:sinir]
    return kes.rsplit(" ", 1)[0] if " " in kes else kes


def kisa_tarih(dt: datetime.datetime) -> str:
    """``7 Eki 16:00`` — Türkiye saatiyle, ASCII."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    t = dt.astimezone(_TR_TZ)
    return f"{t.day} {_AYLAR[t.month - 1]} {t:%H:%M}"


def _url(yol_: str) -> str:
    return f"{settings.FRONTEND_BASE_URL.rstrip('/')}{yol_}"


# ── Ders ──


def ders_hatirlatma(
    *, diger_ad: str, baslangic: datetime.datetime, ders_id: int, online: bool
) -> str:
    """Ders 1 saat sonra. Online → canlı oda bağlantısı; yüz yüze → ders sayfası."""
    link = _url(f"{yol.CANLI_DERS}/{ders_id}") if online else _url(f"{yol.DERS_TALEPLERI}/{ders_id}")
    eylem = "Derse katil" if online else "Ayrinti"
    return (
        f"{_ad(diger_ad)} ile dersin 1 saat sonra ({kisa_tarih(baslangic)}). "
        f"{eylem}: {link}"
    )


def ders_iptal(*, diger_ad: str, baslangic: datetime.datetime, ders_id: int) -> str:
    """Ders iptal edildi (karşı taraf ya da yönetim)."""
    return (
        f"{kisa_tarih(baslangic)} tarihli dersin iptal edildi ({_ad(diger_ad)}). "
        f"Ayrinti: {_url(f'{yol.DERS_TALEPLERI}/{ders_id}')}"
    )


def ders_saati_degisti(*, ogretmen_ad: str, yeni_baslangic: datetime.datetime, ders_id: int) -> str:
    """Öğretmen dersi başka saate aldı; öğrenci onaylamalı."""
    return (
        f"{_ad(ogretmen_ad)} dersini {kisa_tarih(yeni_baslangic)} saatine aldi. "
        f"Onayla ya da reddet: {_url(f'{yol.DERS_TALEPLERI}/{ders_id}')}"
    )


def ders_talebi(*, ogrenci_ad: str, baslangic: datetime.datetime, ders_id: int, ucretsiz: bool) -> str:
    """Öğretmene yeni ders talebi."""
    ne = "ucretsiz ilk ders" if ucretsiz else "ders"
    return (
        f"Yeni {ne} talebi: {_ad(ogrenci_ad)}, {kisa_tarih(baslangic)}. "
        f"Incele: {_url(f'{yol.DERS_TALEPLERI}/{ders_id}')}"
    )


def ders_odeme_bekliyor(*, ogretmen_ad: str, baslangic: datetime.datetime, ders_id: int) -> str:
    """Öğrencinin talebi kabul edildi; dersin kesinleşmesi için ödeme gerekiyor."""
    return (
        f"{_ad(ogretmen_ad)} ders talebini kabul etti ({kisa_tarih(baslangic)}). "
        f"Kesinlesmesi icin odemeyi tamamla: {_url(f'{yol.DERS_TALEPLERI}/{ders_id}')}"
    )


# ── Kütüphane ──


def deneme_bileti(*, kutuphane: str, baslangic: datetime.datetime, kisa_kod: str, kayit_id: int) -> str:
    """Deneme sınavı bileti — giriş kodu SMS'te de durur (internetsiz girişte işe yarar)."""
    return (
        f"Deneme biletin hazir: {kisa_tarih(baslangic)}, {_ad(kutuphane, 22)}. "
        f"Giris kodun: {kisa_kod}. Bilet: {_url(f'{yol.REZERVASYON_DETAY}/deneme/{kayit_id}')}"
    )


def calisma_rezervasyonu(
    *, kutuphane: str, baslangic: datetime.datetime, kisa_kod: str, kayit_id: int
) -> str:
    """Çalışma alanı rezervasyonu — giriş kodu."""
    return (
        f"Calisma alani rezervasyonun onaylandi: {kisa_tarih(baslangic)}, {_ad(kutuphane, 20)}. "
        f"Giris kodun: {kisa_kod}. {_url(f'{yol.REZERVASYON_DETAY}/calisma/{kayit_id}')}"
    )


# ── Hesap ──


def sifre_degisti() -> str:
    """Şifre değişti — güvenlik uyarısı (ad yok: SMS başkasının eline geçebilir)."""
    return (
        "Hesabinin sifresi degistirildi. Sen yapmadiysan hemen sifreni sifirla: "
        f"{_url(yol.SIFREMI_UNUTTUM)}"
    )
