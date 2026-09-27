"""``core/storage.pad_to_square``: ürün görseli beyaz zeminli KARE tuvale pad'lenir.

Sebep: mağaza kataloğunda kitap kapağı dikey, kırtasiye ürünü kare/yatay
geliyordu; en-boy oranını koruyan ``optimize_photo`` yüzünden liste kutuları
farklı yükseklikte çıkıp ızgara dağınık görünüyordu. Merkezden kare CROP
(``optimize_image``) ise çözüm değil: dikey kapağın altını ve üstünü — kitabın
adını — keser.

Testler gerçek Pillow ardışığını uçtan uca sürer (PNG → pad → WebP); çıktı
WebP'si yeniden açılıp PİKSEL DEĞERİ ve içerik SINIR KUTUSU ölçülür. Mock
yoktur: doğrulanan şey kütüphanenin kendi dönüşüm davranışıdır.
"""
import ast
import importlib
import io
import pathlib

import pytest
from PIL import Image

from core import storage
from core.config import settings

# WebP kayıplıdır (quality=82); düz renk alanlarında sapma birkaç birimdir.
ACIK = 240
KOYU = 60
# Kayıplı sıkıştırma içerik kenarında 1-2 piksellik bir rampa bırakır. Bu pay,
# ölçülen sınır kutusunun birkaç piksel şişmesini tolere eder ama testin asıl
# ayırt ettiği hataları (büyütme, kırpma, yanlış eksende pad) yakalamaya devam
# eder — oradaki sapma yüzlerce pikseldir.
PAY = 4


def _png(img: Image.Image, **kw) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG", **kw)
    return buf.getvalue()


def _webp_ac(data: bytes) -> Image.Image:
    out = Image.open(io.BytesIO(data))
    assert out.format == "WEBP"
    return out.convert("RGB")


def _beyaz_mi(piksel) -> bool:
    return all(k >= ACIK for k in piksel)


def _serit_gorsel(genislik: int, yukseklik: int) -> Image.Image:
    """Üst şeridi KIRMIZI, alt şeridi MAVİ, ortası YEŞİL bir görüntü.

    Şeritler kırpma dedektörüdür: merkezden kare crop yapan bir uygulamada
    dikey görselin üst/alt şeritleri kadraj dışında kalır ve köşede yeşil
    görünür. Düz tek renkli bir fixture bu farkı gösteremezdi.
    """
    img = Image.new("RGB", (genislik, yukseklik), (0, 200, 0))
    serit = max(1, yukseklik // 10)
    img.paste((255, 0, 0), (0, 0, genislik, serit))
    img.paste((0, 0, 255), (0, yukseklik - serit, genislik, yukseklik))
    return img


def _icerik_kutusu(img: Image.Image) -> tuple[int, int, int, int]:
    """Beyaz OLMAYAN piksellerin sınır kutusu (sol, üst, sağ, alt)."""
    gri = img.convert("L").point(lambda v: 0 if v >= ACIK else 255)
    kutu = gri.getbbox()
    assert kutu is not None, "çıktı baştan sona beyaz — içerik kaybolmuş"
    return kutu


# ── Kare tuval ve pad ekseni ────────────────────────────────────────────────


def test_dikey_gorsel_kareye_padlenir_ve_pad_SAG_SOLDA_olur():
    """1000×1500 → 1200×1200; içerik dikeyde TAM dolu, pad sağ/soldadır."""
    out = _webp_ac(storage.pad_to_square(_png(_serit_gorsel(1000, 1500))))
    assert out.size == (1200, 1200)

    sol, ust, sag, alt = _icerik_kutusu(out)
    # Dikey görsel yüksekliğe oturur: üst/alt kenarda beyaz bant OLMAMALI.
    assert ust <= PAY and alt >= 1200 - PAY, f"dikeyde pad var: {(ust, alt)}"
    # Genişlik 1000*(1200/1500)=800 → her yanda 200px beyaz.
    assert abs(sol - 200) <= PAY and abs(sag - 1000) <= PAY, f"yatay pad yanlış: {(sol, sag)}"
    assert _beyaz_mi(out.getpixel((5, 600))), "sol kenar beyaz değil"
    assert _beyaz_mi(out.getpixel((1194, 600))), "sağ kenar beyaz değil"


def test_dikey_gorselin_ust_ve_alt_seritleri_KESILMEZ():
    """Kırpma nöbetçisi: kadrajın en üstü kırmızı, en altı mavi kalmalı.

    Merkezden kare crop'a çevrilirse bu iki şerit kadraj dışında kalır ve
    ikisi de yeşile döner — testin ayırt ettiği tam olarak budur.
    """
    out = _webp_ac(storage.pad_to_square(_png(_serit_gorsel(1000, 1500))))
    ust = out.getpixel((600, 4))
    alt = out.getpixel((600, 1195))
    assert ust[0] >= 200 and ust[1] <= KOYU, f"üst şerit (kırmızı) kesilmiş: {ust}"
    assert alt[2] >= 200 and alt[0] <= KOYU, f"alt şerit (mavi) kesilmiş: {alt}"


def test_yatay_gorselin_padi_ALT_USTTE_olur():
    """1500×800 → 1200×1200; içerik yatayda tam dolu, pad alt/üsttedir."""
    out = _webp_ac(storage.pad_to_square(_png(_serit_gorsel(1500, 800))))
    assert out.size == (1200, 1200)

    sol, ust, sag, alt = _icerik_kutusu(out)
    assert sol <= PAY and sag >= 1200 - PAY, f"yatayda pad var: {(sol, sag)}"
    # Yükseklik 800*(1200/1500)=640 → alt/üstte (1200-640)/2=280px beyaz.
    assert abs(ust - 280) <= PAY and abs(alt - 920) <= PAY, f"dikey pad yanlış: {(ust, alt)}"
    assert _beyaz_mi(out.getpixel((600, 5))), "üst kenar beyaz değil"
    assert _beyaz_mi(out.getpixel((600, 1194))), "alt kenar beyaz değil"


def test_kare_gorselde_pad_YOKTUR():
    """1600×1600 → 1200×1200, dört köşe de içerik: hiç beyaz bant eklenmez."""
    kaynak = Image.new("RGB", (1600, 1600), (0, 0, 255))
    out = _webp_ac(storage.pad_to_square(_png(kaynak)))
    assert out.size == (1200, 1200)
    for nokta in ((2, 2), (1197, 2), (2, 1197), (1197, 1197), (600, 600)):
        r, g, b = out.getpixel(nokta)
        assert b >= 200 and r <= KOYU, f"{nokta} pad'lenmiş (beyaz): {(r, g, b)}"


# ── Büyütme yasağı ──────────────────────────────────────────────────────────


def test_katalog_olcusu_400x580_TUVALI_580_OLUR_ve_dikeyde_TAM_DOLAR():
    """Kataloğun baskın ölçüsü (4593 kapak 400×580) → 580×580, doluluk %100 dikey.

    Tuval sabit ``PRODUCT_IMAGE_SIZE`` olsaydı çıktı 1200×1200 olur, 400×580
    içerik karenin ortasında kalır ve ``object-contain`` ile kutuya
    sığdırıldığında kapak görünürde yarı yarıya küçülürdü. Bu testin ayırt
    ettiği tam olarak budur: uzun kenar tuvale EŞİT olmalı, altında değil.
    """
    out = _webp_ac(storage.pad_to_square(_png(_serit_gorsel(400, 580))))
    assert out.size == (580, 580), f"tuval içeriğin uzun kenarı değil: {out.size}"

    sol, ust, sag, alt = _icerik_kutusu(out)
    # Piksel büyütülmemiş: içerik hâlâ 400×580.
    assert abs((sag - sol) - 400) <= PAY, f"içerik genişliği büyütülmüş: {sag - sol}"
    assert abs((alt - ust) - 580) <= PAY, f"içerik yüksekliği büyütülmüş: {alt - ust}"
    # Uzun kenar tuvali doldurur: dikeyde beyaz bant YOK.
    assert ust <= PAY and alt >= 580 - PAY, f"dikeyde pad var: {(ust, alt)}"
    # Kısa kenar ortalanır: (580-400)/2 = 90.
    assert abs(sol - 90) <= PAY and abs(sag - 490) <= PAY, f"yatay pad yanlış: {(sol, sag)}"
    assert _beyaz_mi(out.getpixel((5, 290))), "sol kenar beyaz değil"
    assert _beyaz_mi(out.getpixel((574, 290))), "sağ kenar beyaz değil"


def test_ust_sinirdan_BUYUK_gorsel_once_sinira_kuculur():
    """2000×1000 → üst sınıra sığdır (1200×600) → tuval uzun kenar = 1200."""
    out = _webp_ac(storage.pad_to_square(_png(_serit_gorsel(2000, 1000))))
    assert out.size == (1200, 1200), f"üst sınır uygulanmamış: {out.size}"

    sol, ust, sag, alt = _icerik_kutusu(out)
    assert sol <= PAY and sag >= 1200 - PAY, f"yatayda pad var: {(sol, sag)}"
    # Yükseklik 1000*(1200/2000)=600 → alt/üstte (1200-600)/2=300px beyaz.
    assert abs(ust - 300) <= PAY and abs(alt - 900) <= PAY, f"dikey pad yanlış: {(ust, alt)}"


def test_kucuk_gorsel_pikselleri_BUYUTULMEZ():
    """110×110 (katalogda gerçekten var) → 110×110; sınıra esnetilmez.

    Büyütme yapılsaydı çıktı 1200×1200 olurdu ve düşük çözünürlüklü kapak
    bulanıklaşırdı.
    """
    out = _webp_ac(storage.pad_to_square(_png(_serit_gorsel(110, 110))))
    assert out.size == (110, 110), f"küçük görsel büyütülmüş: {out.size}"


# ── Alfa: şeffaf alan beyaz, siyah DEĞİL ────────────────────────────────────


def test_seffaf_png_beyaz_zemine_duzlesir_siyah_alan_kalmaz():
    """2a5ecf5 regresyonunun pad yolundaki karşılığı.

    Sağ yarısı TAM şeffaf (renk değeri (0,0,0)) dikey bir PNG: düzleştirme
    resize'dan önce yapılmazsa bu yarı siyah çıkar.
    """
    img = Image.new("RGBA", (600, 900), (0, 0, 0, 0))
    img.paste((255, 0, 0, 255), (0, 0, 300, 900))
    out = _webp_ac(storage.pad_to_square(_png(img)))
    assert out.size == (900, 900), f"tuval içeriğin uzun kenarı değil: {out.size}"

    # ÖLÇÜM NOKTALARI İÇERİĞİN İÇİNDE OLMALI. 600×900 büyütülmez, tuval uzun
    # kenar = 900 → içerik x 150..749, y 0..899. Şeffaf sağ yarı x 450..749'dur.
    # İlk yazımda noktalar pad bölgesine düşüyordu ve test, düzleştirme
    # kaldırıldığında bile geçiyordu (yalancı yeşil); mutasyon provası bunu
    # ortaya çıkardı. Noktalar o yüzden içeriğin şeffaf yarısından seçilir.
    for nokta in ((500, 100), (620, 450), (730, 800)):
        assert _beyaz_mi(out.getpixel(nokta)), f"{nokta} siyah/koyu kaldı: {out.getpixel(nokta)}"
    # Opak yarı bozulmamalı — "her şeyi beyaza boya" düzeltmesi de geçmesin.
    r, g, b = out.getpixel((300, 450))
    assert r >= 200 and g <= KOYU and b <= KOYU, f"opak kırmızı bozuldu: {(r, g, b)}"


def test_tamamen_seffaf_gorsel_bastan_sona_beyaz_ve_karedir():
    img = Image.new("RGBA", (800, 400), (0, 0, 0, 0))
    out = _webp_ac(storage.pad_to_square(_png(img), size=256))
    assert out.size == (256, 256)
    for nokta in ((0, 0), (255, 0), (0, 255), (255, 255), (128, 128)):
        assert _beyaz_mi(out.getpixel(nokta)), f"{nokta} beyaz değil: {out.getpixel(nokta)}"


def test_paletli_seffaf_png_de_beyaz_zemine_duzlesir():
    """P modunda şeffaflık piksel verisinde değil ``info['transparency']``de durur."""
    img = Image.new("P", (400, 600))
    img.putpalette([255, 0, 0] + [0, 0, 0] + [0, 0, 0] * 254)
    img.paste(0, (0, 0, 200, 600))
    img.paste(1, (200, 0, 400, 600))
    out = _webp_ac(storage.pad_to_square(_png(img, transparency=bytes([255, 0])), size=600))
    # 400×600 büyütülmez → tuvalde x 100..500, y 0..600.
    assert _beyaz_mi(out.getpixel((450, 300))), (
        f"paletli şeffaf alan beyaz değil: {out.getpixel((450, 300))}"
    )
    r, g, b = out.getpixel((150, 300))
    assert r >= 200 and g <= KOYU, f"paletli opak alan bozuldu: {(r, g, b)}"


# ── Boyut config'ten okunur ─────────────────────────────────────────────────


def test_varsayilan_boyut_configten_gelir(monkeypatch):
    """Kare kenarı sabit kodlanmamalı: ayar değişince çıktı da değişmeli."""
    assert settings.PRODUCT_IMAGE_SIZE == 1200
    monkeypatch.setattr(settings, "PRODUCT_IMAGE_SIZE", 640)
    out = _webp_ac(storage.pad_to_square(_png(_serit_gorsel(1000, 1500))))
    assert out.size == (640, 640)


def test_acik_boyut_argumani_configi_ezer(monkeypatch):
    monkeypatch.setattr(settings, "PRODUCT_IMAGE_SIZE", 640)
    out = _webp_ac(storage.pad_to_square(_png(_serit_gorsel(1000, 1500)), size=300))
    assert out.size == (300, 300)


# ── Kütüphane / avatar yolu DEĞİŞMEDİ ───────────────────────────────────────


def test_optimize_photo_hala_en_boy_oranini_korur():
    """Kütüphane banner/galeri yolunun nöbetçisi.

    ``optimize_photo`` kareye pad'lenseydi kütüphane kapakları da 1:1 olurdu.
    Çıktının KARE OLMAMASI, o yolun dokunulmadığının doğrudan kanıtıdır.
    """
    out = _webp_ac(storage.optimize_photo(_png(_serit_gorsel(1000, 1500)), max_dim=600))
    assert out.size == (400, 600), f"kütüphane yolu kareye dönmüş: {out.size}"


def test_optimize_image_hala_merkezden_kare_KIRPAR():
    """Avatar/logo yolunun nöbetçisi: crop davranışı korunmalı.

    1000×1500 dikey görselin merkezden kare crop'u üst kırmızı ve alt mavi
    şeritleri kadraj dışında bırakır → dört köşe de YEŞİL olur.
    """
    out = _webp_ac(storage.optimize_image(_png(_serit_gorsel(1000, 1500)), size=(200, 200)))
    assert out.size == (200, 200)
    for nokta in ((3, 3), (196, 3), (3, 196), (196, 196)):
        r, g, b = out.getpixel(nokta)
        assert g >= 150 and r <= KOYU and b <= KOYU, f"{nokta} crop davranışı değişmiş: {(r, g, b)}"


def _referans_adlari(modul_adi: str, fonksiyon: str | None = None) -> set[str]:
    """Modülde (ya da tek bir fonksiyon gövdesinde) geçen tanımlayıcı adları.

    Hem ``storage.upload_product_photo`` (Attribute) hem çıplak ``optimize_image``
    (Name) toplanır. Sadece "çağrılan" adlar toplansaydı, fonksiyonu ARGÜMAN
    olarak geçiren ``_optimize_in_thread(optimize_image, ...)`` deseni hiç
    görünmez ve ``upload_avatar`` nöbetçisi BOŞ kümeyle bedavaya geçerdi.

    Sınır AST ile bulunur — ``find()`` + sabit karakter penceresi kullanılmaz;
    yorum ve docstring düğüm üretmez.
    """
    modul = importlib.import_module(modul_adi)
    with open(modul.__file__, encoding="utf-8") as f:
        agac = ast.parse(f.read())
    kapsam: ast.AST = agac
    if fonksiyon is not None:
        kapsam = next(
            d
            for d in agac.body
            if isinstance(d, (ast.AsyncFunctionDef, ast.FunctionDef)) and d.name == fonksiyon
        )
    adlar = {n.attr for n in ast.walk(kapsam) if isinstance(n, ast.Attribute)}
    adlar |= {n.id for n in ast.walk(kapsam) if isinstance(n, ast.Name)}
    # Kapsam gerçekten okundu mu: boş küme her "… not in" iddiasını bedava geçirir.
    assert adlar, f"{modul_adi}.{fonksiyon} kapsamından hiç ad toplanamadı"
    return adlar


@pytest.mark.parametrize("fonksiyon", ["set_cover", "add_images"])
def test_urun_yolu_yeni_fonksiyona_bagli(fonksiyon):
    """Bağlantı nöbetçisi: ürün uçları ARTIK ``upload_product_photo`` çağırır.

    Kaynak sözleşmesi testidir (DÜŞÜK GÜÇLÜ) — yukarıdaki piksel testleri
    dönüşümün kendisini zaten davranışla kanıtlıyor; bu test yalnız doğru
    fonksiyonun bağlandığını, AST ile fonksiyon gövdesi sınırlanarak ölçer.
    """
    cagrilar = _referans_adlari("services.store_service", fonksiyon)
    assert "upload_product_photo" in cagrilar
    assert "upload_library_photo" not in cagrilar


def test_kutuphane_yolu_eski_fonksiyonda_KALDI():
    """Karşı nöbetçi: kütüphane servisi körlemesine değiştirilmemiş olmalı."""
    cagrilar = _referans_adlari("services.library_service")
    assert "upload_library_photo" in cagrilar
    assert "upload_product_photo" not in cagrilar


def test_avatar_yolu_kare_crop_fonksiyonunda_KALDI():
    """Avatar yükleme ``optimize_image``e bağlı kalmalı (pad'e geçmemeli)."""
    cagrilar = _referans_adlari("core.storage", "upload_avatar")
    assert "optimize_image" in cagrilar, "avatar yolu kare-crop fonksiyonunu bırakmış"
    assert "pad_to_square" not in cagrilar


# ── Async yükleme yolu ──────────────────────────────────────────────────────


def test_upload_product_photo_kare_webp_uretir_ve_public_onege_yazar(monkeypatch):
    """``upload_product_photo`` uçtan uca: gerçek Pillow + gerçek thread offload.

    Yalnız S3 ``put`` yakalanır (ağ yok); doğrulanan şey depoya GİDEN baytın
    kendisidir — dönüşümün bağlanıp bağlanmadığı böyle kanıtlanır. Önek de
    ölçülür: ``library-photos`` ``PUBLIC_PREFIXES`` içindedir; yeni bir öneğe
    yazılsaydı ürün görselleri anonim okumaya kapanıp 403 verirdi.
    """
    import asyncio

    yakalanan: dict[str, object] = {}

    async def _sahte_put(data: bytes, *, prefix: str, client=None) -> str:
        yakalanan["data"] = data
        yakalanan["prefix"] = prefix
        return "https://ornek/x.webp"

    monkeypatch.setattr(storage, "_put_webp", _sahte_put)
    url = asyncio.run(storage.upload_product_photo(_png(_serit_gorsel(1000, 1500))))

    assert url == "https://ornek/x.webp"
    assert yakalanan["prefix"] == "library-photos"
    assert f"{yakalanan['prefix']}/" in storage.PUBLIC_PREFIXES

    out = _webp_ac(yakalanan["data"])
    assert out.size == (1200, 1200), f"depoya giden görsel kare değil: {out.size}"
    assert _beyaz_mi(out.getpixel((5, 600))), "depoya giden görselde beyaz pad yok"


# ── Toplu içe aktarma betikleri de aynı yolda ───────────────────────────────
#
# Bayiden toplu görsel geldiğinde ürün kapaklarını bu betikler yükler. Eski
# yolda kalırlarsa katalog karışır: elle yüklenen kapak pad'li, toplu gelen
# pad'siz olur ve ızgara yine dağınık görünür. Betikler `sys.path` kurulumu ve
# `argparse` içerdiği için import EDİLMEZ; kaynak AST ile okunur (kaynak
# sözleşmesi testi — DÜŞÜK GÜÇLÜ, ama dönüşümün kendisi yukarıda davranışla
# zaten kanıtlı; burada ölçülen tek şey doğru fonksiyonun bağlandığı).

_BETIK_KOKU = pathlib.Path(storage.__file__).resolve().parent.parent / "scripts"

# (dosya, dönüşümü yapan fonksiyon, beklenen ad, olmaması gereken eski ad)
_BETIK_SOZLESMESI = [
    ("import_kitapsec_books.py", "_upload_cover", "upload_product_photo", "upload_library_photo"),
    ("import_ucdortbes.py", "_upload_cover", "upload_product_photo", "upload_library_photo"),
    (
        "backfill_kitapsec_covers.py",
        "_upload_via_shared_client",
        "upload_product_photo",
        "optimize_photo",
    ),
]


def _betik_fonksiyon_adlari(dosya: str, fonksiyon: str) -> set[str]:
    """Betikteki TEK bir fonksiyon gövdesinde geçen tanımlayıcı adlar.

    Sınır AST ile bulunur; modülün tamamına bakmak yanıltırdı — docstring'ler
    ve başka yardımcılar eski adı anabilir.
    """
    yol = _BETIK_KOKU / dosya
    assert yol.exists(), f"betik bulunamadı: {yol}"
    agac = ast.parse(yol.read_text(encoding="utf-8"))
    dugum = next(
        d
        for d in ast.walk(agac)
        if isinstance(d, (ast.AsyncFunctionDef, ast.FunctionDef)) and d.name == fonksiyon
    )
    adlar = {n.attr for n in ast.walk(dugum) if isinstance(n, ast.Attribute)}
    adlar |= {n.id for n in ast.walk(dugum) if isinstance(n, ast.Name)}
    assert adlar, f"{dosya}::{fonksiyon} kapsamından hiç ad toplanamadı"
    return adlar


@pytest.mark.parametrize(
    "dosya, fonksiyon, beklenen, eski",
    _BETIK_SOZLESMESI,
    ids=[b[0] for b in _BETIK_SOZLESMESI],
)
def test_toplu_ice_aktarma_betikleri_urun_pad_yolunu_kullanir(dosya, fonksiyon, beklenen, eski):
    adlar = _betik_fonksiyon_adlari(dosya, fonksiyon)
    assert beklenen in adlar, f"{dosya}::{fonksiyon} artık {beklenen} kullanmalı"
    assert eski not in adlar, f"{dosya}::{fonksiyon} hâlâ eski {eski} yolunda"


def test_backfill_paylasilan_istemci_optimizasyonu_KORUNDU():
    """Performans hilesi korunur, ama depo erişimi ortak katmandan geçer.

    Ölçüldü: `aioboto3.Session()` her çağrıda botocore servis modellerini
    diskten yeniden yükler → görsel başına ~1,1 sn, 4.681 görselde ~90 dk.
    Betik bu yüzden çağıranın açtığı TEK istemciyi (`storage.open_client`)
    `storage.upload_product_photo(..., client=s3)`'e geçirir. Bucket adı, ACL
    ve `put_object` betikte YOKTUR (R2 adım 6): bucket seçimi fail-closed
    olarak yalnız `core/storage`'da yapılır.
    """
    yol = _BETIK_KOKU / "backfill_kitapsec_covers.py"
    agac = ast.parse(yol.read_text(encoding="utf-8"))
    dugum = next(
        d
        for d in ast.walk(agac)
        if isinstance(d, (ast.AsyncFunctionDef, ast.FunctionDef))
        and d.name == "_upload_via_shared_client"
    )
    assert [a.arg for a in dugum.args.args][:1] == ["s3"], "paylaşılan istemci parametresi kayıp"
    cagri = next(
        n for n in ast.walk(dugum)
        if isinstance(n, ast.Call) and getattr(n.func, "attr", None) == "upload_product_photo"
    )
    assert any(k.arg == "client" for k in cagri.keywords), "istemci paylaşılmıyor"
    kaynak = yol.read_text(encoding="utf-8")
    for yasak in ("put_object", "AWS_BUCKET_NAME", "public-read", "_s3_client"):
        assert yasak not in kaynak, f"betikte doğrudan depo kullanımı: {yasak}"
    assert "storage.open_client()" in kaynak
