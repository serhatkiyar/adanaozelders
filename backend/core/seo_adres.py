"""Kök SEO adresleri — saf kurallar (veritabanı YOK, pytest'li).

Alan adı zaten "adanaozelders.com.tr" olduğundan adreslerde "adana" öneki
YOKTUR (kullanıcı kararı, Modül 6). Üç sayfa türü kökte yaşar:

    /lgs-yks-matematik-seyhan        ilan (eğitmen profili)
    /matematik-ozel-ders             ders sayfası
    /seyhan/matematik-ozel-ders      ilçe + ders sayfası

Çakışmasızlık İNŞA YOLUYLA sağlanır, şansa bırakılmaz:

* Ders adresi daima ``-ozel-ders`` ile biter; ilan adresi ASLA onunla bitmez.
* İlçe adresi tek sözcüktür (Adana'nın 15 ilçesinin hiçbiri tire taşımaz);
  ilan adresi daima EN AZ İKİ sözcüktür.
* Mevcut kök rotalar (`REZERVE_ADLAR`) hiçbir kayda verilemez. Liste
  frontend'in rota kaynağıyla nöbetçi testte karşılaştırılır
  (`tests/test_seo_adres.py`), yani yeni bir kök sayfa eklenip buraya
  yazılmazsa test kırılır.

Kalan tek çakışma iki ilanın aynı başlığı taşımasıdır; o da ``-2``, ``-3``
ekiyle çözülür (`benzersiz_yap`).
"""
from __future__ import annotations

import re
from collections.abc import Callable, Iterable

from core.search_text import normalize_tr
from core.slug import slugify_tr

#: Ders sayfası adresinin sabit eki. İlan adresi bununla bitemez.
DERS_EKI = "ozel-ders"

#: İlan adresinin üst sınırı (ek ``-2`` vb. hariç). Google uzun adresi
#: cezalandırmaz ama sonuç sayfasında keser; ~80 karakter okunur kalır.
ILAN_AZAMI_UZUNLUK = 80

#: Geçerli adres parçası: küçük harf, rakam ve tekil tire.
SLUG_DESENI = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

#: Başlıktan atılan dolgu sözcükleri (Türkçe karakterleri sadeleştirilmiş
#: hâlleriyle). Aramada anlam taşımazlar, adresi uzatırlar.
DOLGU_KELIMELERI = frozenset(
    {
        "ve",
        "ile",
        "icin",
        "bir",
        "da",
        "de",
        "ta",
        "te",
        "ya",
        "veya",
        "ki",
        "mi",
        "gibi",
        "olarak",
        "en",
        "cok",
        "her",
    }
)

#: Adana'nın 15 ilçesi. İlçe sayfası yalnız bunlar için açılır; eğitmenin
#: `district` alanı serbest yazılabildiği için eşleşme `normalize_tr` ile yapılır.
ADANA_ILCELERI: tuple[str, ...] = (
    "Seyhan",
    "Çukurova",
    "Yüreğir",
    "Sarıçam",
    "Ceyhan",
    "Kozan",
    "Karaisalı",
    "Karataş",
    "Yumurtalık",
    "İmamoğlu",
    "Pozantı",
    "Aladağ",
    "Feke",
    "Saimbeyli",
    "Tufanbeyli",
)

#: Kökte ASLA kayda verilemeyecek ilk yol parçaları.
#:
#: Üç kaynaktan gelir: (1) frontend'in rota tablosu (`lib/routes.ts` PATHS +
#: `App.tsx` eski yönlendirmeleri), (2) sunucu/altyapı yolları, (3) `public/`
#: altındaki kök dosya ve klasörler. Nöbetçi test (1) ve (3)'ü dosyalardan
#: okuyup bu kümenin onları kapsadığını doğrular.
REZERVE_ADLAR: frozenset[str] = frozenset(
    {
        # ── Frontend: public (SEO) ──
        "egitmenler",
        "kutuphaneler",
        "kutuphane-kayit",
        "magaza",
        "kargo-takip",
        "kvkk",
        "gizlilik-politikasi",
        "kullanim-kosullari",
        "mesafeli-satis-sozlesmesi",
        "iptal-ve-iade-politikasi",
        "cerez-politikasi",
        "on-bilgilendirme-formu",
        "siralama-kriterleri",
        "hakkimizda",
        "blog",
        "sss",
        "iletisim",
        "egitmen-on-basvuru",
        # ── Frontend: kimlik ──
        "giris",
        "kayit",
        "sifremi-unuttum",
        "sifre-yenile",
        "e-posta-dogrula",
        "google-donus",
        "hesap-silme-onayi",
        # ── Frontend: oturum içi ──
        "pano",
        "ders-talepleri",
        "takvim",
        "favoriler",
        "sorular",
        "talepler",
        "denemeler",
        "gorevler",
        "bildirimler",
        "mesaj-merkezi",
        "siparislerim",
        "dijital-urunlerim",
        "liderlik",
        "ogren",
        "adreslerim",
        "ayarlar",
        "ilanini-olustur",
        "ilanimi-one-cikar",
        "dagitim",
        "uyeler",
        "kutuphanem",
        "oturumlar",
        "yonetim",
        "yonetim-yeni",
        # ── Frontend: eski adresler (kalıcı yönlendirme) ve geliştirme ──
        "login",
        "register",
        "forgot-password",
        "reset-password",
        "verify-email",
        "kesfet",
        "admin",
        "tutor",
        "student",
        "profile",
        "settings",
        "messages",
        "calendar",
        "leaderboard",
        "biletlerim",
        "rezervasyonlar",
        "mesajlar",
        "hesabim",
        "bakiyem",
        "ilan-ayarlari",
        "panel",
        "egitmen",
        "lesson",
        "ogrenciler",
        "test-canli-ders",
        "test-kutuphane-karti",
        "test-livekit",
        # ── Sunucu ve altyapı ──
        "api",
        "assets",
        "sitemap.xml",
        "robots.txt",
        "__meta",
        "__sayfa",
        "health",
        "ws",
        "payments",
        "istatistik",
        "docs",
        "redoc",
        "openapi.json",
        "index.html",
        "private",
        "depo",
        # ── public/ kök dosya ve klasörleri ──
        "fonts",
        "icons",
        "images",
        "odeme",
        "vitrin",
        "favicon.png",
        "logo.png",
        "logo.svg",
        "logo-compact.svg",
        "logo-yatay-siyah.svg",
        "magaza-logo.svg",
        "tutor_category.png",
    }
)


def rezerve_mi(slug: str) -> bool:
    """Adres parçası kökte başka bir sayfaya ait mi?"""
    return slug in REZERVE_ADLAR


def gecerli_slug_mi(slug: str) -> bool:
    return bool(slug) and SLUG_DESENI.fullmatch(slug) is not None


def ders_sayfasi_slugu(ders_slug: str) -> str:
    """`matematik` → `matematik-ozel-ders` (ders sayfasının kök adresi)."""
    return f"{ders_slug}-{DERS_EKI}"


def ders_sayfasi_mi(slug: str) -> bool:
    return slug.endswith(f"-{DERS_EKI}")


def ilce_slugu(ilce: str) -> str:
    """`Çukurova` → `cukurova`."""
    return slugify_tr(ilce)


def ilce_adi(deger: str | None) -> str | None:
    """Serbest yazılmış ilçe değerini kanonik ada çevirir ("cukurova" → "Çukurova").

    Adana ilçesi değilse None: ilan adresine ve ilçe sayfasına bilinmeyen bir
    yer adı uydurulmaz.
    """
    if not deger:
        return None
    aranan = normalize_tr(deger.strip())
    for ad in ADANA_ILCELERI:
        if normalize_tr(ad) == aranan:
            return ad
    return None


def _kes(sozcukler: list[str], sinir: int) -> list[str]:
    """Sözcük sınırından keser (sözcük ortası kesilmez)."""
    out: list[str] = []
    uzunluk = 0
    for s in sozcukler:
        ek = len(s) + (1 if out else 0)
        if uzunluk + ek > sinir:
            if not out:  # tek sözcük sınırdan uzunsa kendisi kesilir
                out.append(s[:sinir])
            break
        out.append(s)
        uzunluk += ek
    return out


def ilan_slug_tabani(baslik: str | None, ilce: str | None = None) -> str:
    """İlan başlığından temiz adres tabanı üretir (benzersizlik HARİÇ).

    Kurallar (kullanıcı kararı, Modül 6):
      * Türkçe karakter sadeleşir, küçük harf, tire ayraç (`slugify_tr`).
      * Dolgu sözcükleri atılır; yinelenen sözcük tekilleşir.
      * ~80 karakterde sözcük sınırından kesilir.
      * İlçe başlıkta geçmiyorsa SONA eklenir. Gerekçe: aramaların büyük
        kısmı yerel ("seyhan matematik öğretmeni"); ilçe, adresi aynı başlığı
        taşıyan başka ilçedeki ilandan da ayırır. Ders adı EKLENMEZ — yayın
        kapısı başlığın branş içermesini zaten istiyor, ikinci kez yazmak
        adresi uzatır.
      * Adres ``-ozel-ders`` ile bitemez (ders sayfalarına ayrılmış) ve en az
        iki sözcüktür (tek sözcüklü ilçe adresleriyle çakışmaz).
    """
    sozcukler: list[str] = []
    for s in slugify_tr(baslik).split("-"):
        if not s or s in DOLGU_KELIMELERI or s in sozcukler:
            continue
        sozcukler.append(s)

    ilce_ad = ilce_adi(ilce)
    ilce_parcasi = ilce_slugu(ilce_ad) if ilce_ad else None
    ekle_ilce = bool(ilce_parcasi) and ilce_parcasi not in sozcukler

    sinir = ILAN_AZAMI_UZUNLUK - (len(ilce_parcasi) + 1 if ekle_ilce else 0)
    sozcukler = _kes(sozcukler, sinir)
    if ekle_ilce:
        sozcukler.append(ilce_parcasi)  # type: ignore[arg-type]

    if not sozcukler:
        sozcukler = ["ozel", "ders", "egitmeni"]
    if sozcukler[-2:] == DERS_EKI.split("-"):
        sozcukler.append("egitmeni")
    if len(sozcukler) < 2:
        sozcukler.append("ozel-ders-egitmeni")
    return "-".join(sozcukler)


def benzersiz_yap(taban: str, dolu_mu: Callable[[str], bool]) -> str:
    """`taban`, dolu ya da rezerveyse `taban-2`, `taban-3` … döner."""
    aday = taban
    n = 1
    while rezerve_mi(aday) or dolu_mu(aday):
        n += 1
        aday = f"{taban}-{n}"
    return aday


def benzersiz_yap_kume(taban: str, dolular: Iterable[str]) -> str:
    kume = set(dolular)
    return benzersiz_yap(taban, kume.__contains__)
