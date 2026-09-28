"""WhatsApp bildirim şablonları — ders, kütüphane ve hesap güvenliği.

Bu şablonlar henüz gönderime BAĞLANMADI (kullanıcı kararı, 28 Eyl 2026: önce
tasarım + önizleme). Bugün WhatsApp yalnız telefon doğrulama kodu için
kullanılıyor (``core/whatsapp.py``).

Neden şablon biçiminde: Meta Cloud API'de işletmenin başlattığı her mesaj
(24 saatlik müşteri penceresi dışında) önceden ONAYLANMIŞ bir şablon ister.
Metinler bu yüzden Meta'nın "UTILITY" (işlemsel) kategori kurallarına göre
yazıldı ve aynen onaya gönderilebilir:

- Değişkenler ``{{1}}``, ``{{2}}``… sırayla; gövde değişkenle başlayıp bitmez.
- Gövde en fazla 1024 karakter; tanıtım/indirim dili yok (yoksa kategori
  MARKETING'e düşer, ücret ve rıza kuralı değişir).
- Değişken değerinde satır sonu, sekme ve 4'ten fazla boşluk olamaz
  (``_temizle``).
- Düğme: tek "URL" düğmesi; dinamik kısım adresin SONUNDA tek değişkendir.

WAHA (resmî olmayan, bağlı cihaz) modunda şablon onayı gerekmez; aynı metin
düz mesaj olarak gider, düğme bir bağlantı satırına dönüşür (``waha_metni``).
Biçim: ``*kalın*``, ``_eğik_``, ``~üstü çizili~`` WhatsApp'ın kendi işaretleri.
"""
from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

from core import frontend_yollari as yol
from core.config import settings


@dataclass(frozen=True, slots=True)
class WaSablon:
    ad: str  # Meta şablon adı (küçük harf, alt çizgi)
    baslik: str  # önizleme / yönetim için insan okunur ad
    alici: str  # "ogrenci" | "ogretmen" | "iki taraf" | "kutuphane"
    govde: str
    degiskenler: tuple[str, ...]  # {{1}}, {{2}}… sırasıyla ne oldukları
    dugme_metni: str | None = None
    # Sitenin kökünden sonraki yol; dinamik ise sonda "{{1}}" taşır.
    dugme_yolu: str | None = None
    kategori: str = "UTILITY"
    dil: str = "tr"


def _S(ad: str, baslik: str, alici: str, govde: str, degiskenler: Sequence[str], dugme=None, yol_=None) -> WaSablon:
    return WaSablon(ad, baslik, alici, govde, tuple(degiskenler), dugme, yol_)


SABLONLAR: tuple[WaSablon, ...] = (
    # ── Ders — öğretmene ──
    _S(
        "ders_talebi",
        "Yeni ders talebi",
        "ogretmen",
        "📚 *Yeni ders talebi*\n\n"
        "{{1}} senden ders almak istiyor.\n\n"
        "🗓 {{2}}\n📍 {{3}}\n💳 {{4}}\n\n"
        "Talebi kabul etmek ya da reddetmek için aşağıdaki düğmeye dokun.",
        ("öğrenci adı", "zaman", "ders şekli", "ücret"),
        "Talebi incele",
        f"{yol.DERS_TALEPLERI}/{{{{1}}}}",
    ),
    # ── Ders — öğrenciye ──
    _S(
        "ders_teklifi",
        "Ders teklifi",
        "ogrenci",
        "📚 *Ders teklifi*\n\n"
        "{{1}} sana ders teklif etti.\n\n"
        "🗓 {{2}}\n📍 {{3}}\n💳 {{4}}\n\n"
        "Teklifi inceleyip kabul edebilir ya da reddedebilirsin.",
        ("öğretmen adı", "zaman", "ders şekli", "ücret"),
        "Teklifi incele",
        f"{yol.DERS_TALEPLERI}/{{{{1}}}}",
    ),
    _S(
        "ders_odeme_bekliyor",
        "Talep kabul edildi — ödeme bekliyor",
        "ogrenci",
        "✅ *Ders talebin kabul edildi*\n\n"
        "{{1}} ders talebini kabul etti.\n\n"
        "🗓 {{2}}\n💳 {{3}}\n\n"
        "Dersin kesinleşmesi için ödemeyi tamamla.",
        ("öğretmen adı", "zaman", "ücret"),
        "Ödemeyi tamamla",
        f"{yol.DERS_TALEPLERI}/{{{{1}}}}",
    ),
    _S(
        "ders_kesinlesti",
        "Ders kesinleşti",
        "ogrenci",
        "🎉 *Dersin kesinleşti*\n\n"
        "{{1}} ile dersin takvime eklendi.\n\n"
        "🗓 {{2}}\n📍 {{3}}\n\n"
        "Görüşmek üzere!",
        ("öğretmen adı", "zaman", "ders şekli"),
        "Dersi görüntüle",
        f"{yol.DERS_TALEPLERI}/{{{{1}}}}",
    ),
    _S(
        "ders_hatirlatma_online",
        "Ders hatırlatması — online",
        "iki taraf",
        "⏰ *Dersin 1 saat sonra başlıyor*\n\n"
        "{{1}} ile online dersin yaklaşıyor.\n\n"
        "🗓 {{2}}\n\n"
        "Ders odası dersten 15 dakika önce açılır.",
        ("karşı tarafın adı", "zaman"),
        "Derse katıl",
        f"{yol.CANLI_DERS}/{{{{1}}}}",
    ),
    _S(
        "ders_hatirlatma_yuzyuze",
        "Ders hatırlatması — yüz yüze",
        "iki taraf",
        "⏰ *Dersin 1 saat sonra başlıyor*\n\n"
        "{{1}} ile yüz yüze dersin yaklaşıyor.\n\n"
        "🗓 {{2}}\n📍 {{3}}\n\n"
        "Buluşma yeri değişirse ders sayfasında görünür.",
        ("karşı tarafın adı", "zaman", "buluşma yeri"),
        "Ders ayrıntıları",
        f"{yol.DERS_TALEPLERI}/{{{{1}}}}",
    ),
    _S(
        "ders_saati_degisti",
        "Öğretmen saati değiştirdi",
        "ogrenci",
        "🔄 *Dersin yeni bir saate alındı*\n\n"
        "{{1}} dersini başka bir saate aldı.\n\n"
        "Eski saat: ~{{2}}~\nYeni saat: *{{3}}*\n\n"
        "Yeni saat uymuyorsa reddedebilirsin; ödediğin ücretin tamamı iade edilir.",
        ("öğretmen adı", "eski saat", "yeni saat"),
        "Yanıtla",
        f"{yol.DERS_TALEPLERI}/{{{{1}}}}",
    ),
    _S(
        "ders_iptal",
        "Ders iptal edildi",
        "iki taraf",
        "❌ *Ders iptal edildi*\n\n"
        "{{1}} tarihli dersin iptal edildi.\n\n"
        "İptal eden: {{2}}\nNeden: {{3}}\n\n"
        "{{4}} Yeni bir saat ayarlamak için mesaj gönderebilirsin.",
        ("ders zamanı", "iptal eden", "neden", "iade bilgisi"),
        "Mesaj gönder",
        yol.MESAJLAR,
    ),
    _S(
        "ders_degerlendir",
        "Ders tamamlandı — değerlendir",
        "ogrenci",
        "⭐ *Dersin nasıl geçti?*\n\n"
        "{{1}} ile {{2}} tarihli dersin tamamlandı. Değerlendirmen hem öğretmenine hem de "
        "öğretmen arayan diğer öğrencilere yardımcı olur.",
        ("öğretmen adı", "ders zamanı"),
        "Değerlendir",
        f"{yol.DERS_TALEPLERI}/{{{{1}}}}",
    ),
    # ── Mesaj ──
    _S(
        "yeni_mesaj",
        "Okunmamış mesaj",
        "iki taraf",
        "✉️ *Yeni mesajın var*\n\n"
        "{{1}} sana mesaj gönderdi:\n\n"
        "_{{2}}_\n\n"
        "Yanıtlamak için aşağıdaki düğmeye dokun.",
        ("gönderenin adı", "mesajın ilk 200 karakteri"),
        "Mesajı aç",
        yol.MESAJLAR,
    ),
    # ── Öğretmen ilanı ──
    _S(
        "ilan_onaylandi",
        "İlan onaylandı",
        "ogretmen",
        "🥳 *İlanın yayında!*\n\n"
        "Tebrikler {{1}}, ilanın onaylandı. Öğrenciler artık seni Adana Özel Ders'te bulabilir.",
        ("öğretmen adı",),
        "İlanımı gör",
        yol.ILANIM,
    ),
    # ── Kütüphane ──
    _S(
        "deneme_bileti",
        "Deneme sınavı bileti",
        "ogrenci",
        "🎫 *Deneme sınavı biletin hazır*\n\n"
        "📝 {{1}}\n🗓 {{2}}\n📍 {{3}}\n\n"
        "Giriş kodun: *{{4}}*\n\n"
        "Sınav günü girişte bu kodu ya da biletindeki QR kodu göster.",
        ("sınav adı", "zaman", "kütüphane", "giriş kodu"),
        "Biletimi göster",
        f"{yol.REZERVASYON_DETAY}/deneme/{{{{1}}}}",
    ),
    _S(
        "calisma_rezervasyonu",
        "Çalışma alanı rezervasyonu",
        "ogrenci",
        "📚 *Çalışma alanı rezervasyonun onaylandı*\n\n"
        "📍 {{1}}\n🗓 {{2}}\n\n"
        "Giriş kodun: *{{3}}*\n\n"
        "Girişte bu kodu ya da rezervasyonundaki QR kodu göster.",
        ("kütüphane", "zaman", "giriş kodu"),
        "Rezervasyonumu göster",
        f"{yol.REZERVASYON_DETAY}/calisma/{{{{1}}}}",
    ),
    # ── Hesap güvenliği ──
    _S(
        "sifre_degisti",
        "Şifre değiştirildi",
        "iki taraf",
        "🔒 *Şifren değiştirildi*\n\n"
        "Hesabının şifresi {{1}} tarihinde değiştirildi ve tüm cihazlardaki oturumların kapatıldı.\n\n"
        "Bu işlemi sen yapmadıysan hemen şifreni sıfırla.",
        ("tarih",),
        "Şifremi sıfırla",
        yol.SIFREMI_UNUTTUM,
    ),
)

SABLON: dict[str, WaSablon] = {s.ad: s for s in SABLONLAR}

_BOSLUK = re.compile(r"\s+")


def _temizle(deger: object, sinir: int = 200) -> str:
    """Meta kuralı: değişkende satır sonu/sekme ve art arda 4+ boşluk olamaz."""
    s = _BOSLUK.sub(" ", str(deger)).strip()
    return s if len(s) <= sinir else s[: sinir - 1].rstrip() + "…"


def _doldur(sablon: WaSablon, degerler: Sequence[object]) -> str:
    if len(degerler) != len(sablon.degiskenler):
        raise ValueError(f"{sablon.ad}: {len(sablon.degiskenler)} değer bekleniyor")
    metin = sablon.govde
    for i, d in enumerate(degerler, start=1):
        metin = metin.replace(f"{{{{{i}}}}}", _temizle(d))
    return metin


def dugme_url(sablon: WaSablon, dugme_degeri: object | None = None) -> str | None:
    if not sablon.dugme_yolu:
        return None
    yol_ = sablon.dugme_yolu.replace("{{1}}", str(dugme_degeri or ""))
    return f"{settings.FRONTEND_BASE_URL.rstrip('/')}{yol_}"


def waha_metni(sablon: WaSablon, degerler: Sequence[object], dugme_degeri: object | None = None) -> str:
    """WAHA (düz mesaj) için tam metin: gövde + düğmenin bağlantı satırı."""
    metin = _doldur(sablon, degerler)
    url = dugme_url(sablon, dugme_degeri)
    return f"{metin}\n\n👉 {sablon.dugme_metni}: {url}" if url else metin


def meta_bilesenleri(
    sablon: WaSablon, degerler: Sequence[object], dugme_degeri: object | None = None
) -> list[dict]:
    """Meta Cloud API ``template.components`` yükü (gövde + varsa dinamik düğme)."""
    _doldur(sablon, degerler)  # sayı denetimi
    bilesenler: list[dict] = [
        {
            "type": "body",
            "parameters": [{"type": "text", "text": _temizle(d)} for d in degerler],
        }
    ]
    if sablon.dugme_yolu and "{{1}}" in sablon.dugme_yolu:
        bilesenler.append(
            {
                "type": "button",
                "sub_type": "url",
                "index": "0",
                "parameters": [{"type": "text", "text": str(dugme_degeri)}],
            }
        )
    return bilesenler
