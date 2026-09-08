"""Sunucunun ürettiği frontend yolları, istemcinin rota kaynağıyla uyumlu mu.

## Ölçtüğü kusur sınıfı

Bildirim satırlarının `link` alanı, e-posta gövdeleri ve ödeme sağlayıcısının
dönüş adresleri istemci yollarını taşır. İki taraf ayrı dosyalarda yaşar ve
ayrışmaları SESSİZDİR: istemcide eski yollar için kalıcı yönlendirme var, yani
bayat bir link 404 vermez — fazladan bir atlamayla açılır ve kimse fark etmez.
Fark edilen tek gün, yönlendirme de temizlendiği gündür; o zaman kırılan şey
kullanıcının e-postasındaki bağlantı olur.

8 Eyl 2026'da panel şeridi kurulurken altı yol `/pano/*` altına taşındı ve
sunucu tarafında sekiz dosyada on iki düz dize elle bulunmak zorunda kaldı.
Bu düğüm o aramanın bir dahaki sefere otomatik olması içindir.

## Gücü ve sınırı

`routes.ts`ten METİN olarak okur (istemci TypeScript'i burada çalıştırılamaz),
yani `PATHS` sözlüğünün biçimine bağımlıdır. Karşılığında iddia gerçek veri
üzerindedir: karşılaştırılan şey iki dosyanın ASIL değerleridir, ikisinin de
kopyalandığı üçüncü bir liste değil. Sunucunun ürettiği her yolun istemcide
tanımlı olduğunu görür; istemcideki her yolun sunucuda karşılığı olmasını
BEKLEMEZ (çoğunun olması da gerekmez).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from core import frontend_yollari

_ROUTES_TS = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "routes.ts"
)

# Sunucu sabiti → istemcideki `PATHS` anahtarı.
_ESLESME = {
    "PANO": "bookings",
    "MESAJLAR": "messages",
    "ILANIM": "tutorListing",
    "DEGERLENDIRMELER": "tutorReviews",
    "BAKIYEM": "balance",
    "HESABIM": "profile",
    "DERS_TALEPLERI": "lesson",
    "SIPARISLERIM": "orders",
    "ONE_CIKAR": "tutorPromotion",
    "REZERVASYON_DETAY": "libraryReservation",
}

# Parametreli istemci yolları (`/ders-talepleri/:id`); sunucu bunların ÖNEKİNİ
# tutar ve id'yi kendisi ekler.
_ONEK_OLANLAR = {"DERS_TALEPLERI", "REZERVASYON_DETAY"}


def _istemci_yollari() -> dict[str, str]:
    """`PATHS` sözlüğündeki `anahtar: "/yol"` satırlarını okur."""
    kaynak = _ROUTES_TS.read_text(encoding="utf-8")
    bas = kaynak.index("export const PATHS")
    son = kaynak.index("export const ROUTES")
    return {
        m.group(1): m.group(2)
        for m in re.finditer(r'^\s*(\w+):\s*"([^"]+)",', kaynak[bas:son], re.M)
    }


def test_routes_ts_okunabiliyor():
    """DOLULUK: ayrıştırma kırılırsa aşağıdaki iddialar bedava geçerdi."""
    yollar = _istemci_yollari()
    assert len(yollar) > 50, "PATHS ayrıştırılamadı — biçim değişmiş olabilir"
    assert yollar["home"] == "/"


@pytest.mark.parametrize("sabit,istemci_anahtari", sorted(_ESLESME.items()))
def test_sunucu_yolu_istemciyle_ayni(sabit: str, istemci_anahtari: str):
    yollar = _istemci_yollari()
    assert istemci_anahtari in yollar, (
        f"`PATHS.{istemci_anahtari}` yok — istemcide silinmiş ya da adı değişmiş"
    )
    beklenen = yollar[istemci_anahtari]
    gercek = getattr(frontend_yollari, sabit)

    if sabit in _ONEK_OLANLAR:
        # `/ders-talepleri/:id` → önek `/ders-talepleri`
        beklenen = re.sub(r"(/:[^/]+)+$", "", beklenen)

    assert gercek == beklenen, (
        f"frontend_yollari.{sabit} = {gercek!r} ama istemcide "
        f"PATHS.{istemci_anahtari} = {beklenen!r}. Bildirim linkleri ve ödeme "
        f"dönüş adresleri bayat kaldı; yönlendirme sayesinde ÇALIŞMAYA devam "
        f"ederler, o yüzden bunu tarayıcıda fark edemezsin."
    )


def _legacy_yonlendirmeler() -> set[str]:
    """`App.tsx::LEGACY_STATIC` tablosundaki ESKİ yolları okur."""
    app_tsx = (
        Path(__file__).resolve().parents[2] / "frontend" / "src" / "App.tsx"
    ).read_text(encoding="utf-8")
    bas = app_tsx.index("LEGACY_STATIC")
    son = app_tsx.index("];", bas)
    return {
        m.group(1)
        for m in re.finditer(r'\[\s*"([^"]+)"\s*,', app_tsx[bas:son])
    }


def _servis_linkleri() -> list[tuple[str, str]]:
    """Servislerde STATİK yazılmış bildirim linkleri: (yol, "dosya:satır")."""
    kok = Path(__file__).resolve().parents[1]
    bulunan: list[tuple[str, str]] = []
    for dosya in sorted((kok / "services").rglob("*.py")):
        for no, satir in enumerate(
            dosya.read_text(encoding="utf-8").splitlines(), start=1
        ):
            m = re.search(r'link\s*=\s*"(/[^"]*)"', satir)
            if m:
                bulunan.append((m.group(1), f"{dosya.relative_to(kok)}:{no}"))
    return bulunan


def test_hicbir_bildirim_linki_404_degil():
    """Her bildirim linki ya CANLI bir rota ya da yönlendirilen bir eski yol.

    Bu düğüm yazıldığı gün bir kusur buldu: `payout_service` IBAN değişikliği
    güvenlik bildirimini ("bu işlemi sen yapmadıysan hemen şifreni değiştir")
    `/panel/odeme-hesabi`ye bağlıyordu. Öyle bir yol HİÇ olmadı ve
    yönlendirmesi de yoktu — bildirim 404 açıyordu.

    Bu sınıf sessizdir: linki üreten sunucu, çözen istemcidir. Sunucu tarafında
    hiçbir test kırılmaz, istemci tarafında böyle bir link hiç doğmaz.
    """
    canli = set(_istemci_yollari().values())
    yonlendirilen = _legacy_yonlendirmeler()
    linkler = _servis_linkleri()
    assert len(linkler) > 20, "servis linkleri taranamadı — desen değişmiş olabilir"

    kirik = [
        f"{nerede} → {link}"
        for link, nerede in linkler
        if link not in canli and link not in yonlendirilen
    ]
    assert kirik == [], (
        "bildirim linki ne canlı bir rota ne de yönlendirilmiş bir eski yol; "
        "kullanıcı bildirime tıklayınca 404 görür:\n  " + "\n  ".join(kirik)
    )


def test_serit_yollari_duz_dize_yazilmaz():
    """Şeridin yolları servislerde ELLE yazılamaz — sabitten gelmek zorunda.

    `/pano/*` taşınması sırasında sekiz dosyada on iki düz dize elle bulundu.
    Bu düğüm o aramanın tekrarını engeller: şeride ait bir yol (yenisi ya da
    taşınmadan önceki DÜZ hâli) servis kodunda dize olarak belirirse kırılır.
    """
    TASINANLAR = {
        "/pano", "/pano/mesajlar", "/pano/ilanim", "/pano/degerlendirmeler",
        "/pano/bakiyem", "/pano/hesabim",
        # Taşınmadan önceki hâlleri: yönlendirme sayesinde ÇALIŞIRLAR, o
        # yüzden geri sızmaları fark edilmez.
        "/rezervasyonlar", "/mesajlar", "/ilan-ayarlari", "/bakiyem", "/hesabim",
    }
    kacaklar = [
        f"{nerede} → {link}"
        for link, nerede in _servis_linkleri()
        if link in TASINANLAR
    ]
    assert kacaklar == [], (
        "şerit yolu düz dize yazılmış; `core.frontend_yollari` sabitini "
        "kullan:\n  " + "\n  ".join(kacaklar)
    )
