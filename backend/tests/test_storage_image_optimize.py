"""``core/storage`` görsel optimizasyonu: şeffaflık BEYAZ zemine düzleşir.

Regresyon sebebi: ``optimize_image``/``optimize_photo`` WebP'ye yazmadan önce
doğrudan ``convert("RGB")`` çağırıyordu. Alfa düştüğünde geriye şeffaf
piksellerin renk değeri kalır ve bu neredeyse her zaman (0,0,0)'dır — şeffaf
PNG kapaklar mağazada SİYAH zeminli görünüyordu.

Testler gerçek Pillow ardışığını (PNG → optimize → WebP) uçtan uca sürer;
çıktı WebP'si yeniden açılıp PİKSEL DEĞERİ okunur. Mock yoktur: bozulan şey
kütüphanenin kendi dönüşüm davranışıydı.
"""
import io
import warnings

import pytest
from PIL import Image

from core import storage

# WebP kayıplıdır (quality=85); düz renk alanlarında sapma birkaç birimdir.
# Eşikler "beyaz mı siyah mı" ayrımını ayırt etmeye fazlasıyla yeter.
ACIK = 240
KOYU = 40


def _png_bytes(img: Image.Image, **save_kwargs) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG", **save_kwargs)
    return buf.getvalue()


def _webp_ac(data: bytes) -> Image.Image:
    out = Image.open(io.BytesIO(data))
    assert out.format == "WEBP"
    return out.convert("RGB")


def _yari_seffaf_rgba(boyut: int = 128) -> Image.Image:
    """Sol yarısı OPAK kırmızı, sağ yarısı TAM şeffaf bir RGBA görüntü.

    Şeffaf bölgenin renk değeri bilerek (0,0,0): hatanın kaynağı buydu ve
    düzeltme yoksa sağ yarı siyah çıkar.
    """
    img = Image.new("RGBA", (boyut, boyut), (0, 0, 0, 0))
    img.paste((255, 0, 0, 255), (0, 0, boyut // 2, boyut))
    return img


def _paletli_seffaf(boyut: int = 128) -> bytes:
    """Sol yarısı opak kırmızı, sağ yarısı şeffaf PALETLİ (P modu) PNG.

    Palete ayrıca YARI SAYDAM bir üçüncü renk tanımlanır (görüntüde
    kullanılmaz). Sebebi ölçülmüştür: yalnız "tam opak + tam şeffaf" indeksi
    olan bir palette Pillow tRNS'i tek bir ``int`` olarak yazar ve
    ``P → RGB`` dönüşümü uyarı VERMEZ; uyarı yalnız ``transparency``
    ``bytes`` okunduğunda çıkar. Üçüncü renk olmadan bu dosyanın uyarı
    testi hiçbir şeyi koruyamazdı.
    """
    img = Image.new("P", (boyut, boyut))
    img.putpalette([255, 0, 0] + [0, 0, 0] + [0, 255, 0] + [0, 0, 0] * 253)
    img.paste(0, (0, 0, boyut // 2, boyut))
    img.paste(1, (boyut // 2, 0, boyut, boyut))
    raw = _png_bytes(img, transparency=bytes([255, 0, 128]))
    # Fixture'ın kendi nöbetçisi: Pillow sürümü tRNS'i tek int'e indirirse
    # uyarı yolu kapanır ve test sessizce boş bir iddiaya dönerdi.
    okunan = Image.open(io.BytesIO(raw)).info.get("transparency")
    assert isinstance(okunan, bytes), f"fixture bayt tRNS üretmedi: {okunan!r}"
    return raw


def _acik_mi(piksel: tuple[int, int, int]) -> bool:
    return all(k >= ACIK for k in piksel)


# ── Şeffaf alan beyaz olmalı ────────────────────────────────────────────────


@pytest.mark.parametrize(
    "optimize",
    [
        pytest.param(lambda b: storage.optimize_image(b, size=(64, 64)), id="optimize_image"),
        pytest.param(lambda b: storage.optimize_photo(b, max_dim=64), id="optimize_photo"),
    ],
)
def test_seffaf_rgba_alan_beyaz_olur_siyah_degil(optimize):
    out = _webp_ac(optimize(_png_bytes(_yari_seffaf_rgba())))
    g, y = out.size
    sag_ust = out.getpixel((g - 3, 2))
    sag_alt = out.getpixel((g - 3, y - 3))
    assert _acik_mi(sag_ust), f"şeffaf alan beyaz değil: {sag_ust}"
    assert _acik_mi(sag_alt), f"şeffaf alan beyaz değil: {sag_alt}"


@pytest.mark.parametrize(
    "optimize",
    [
        pytest.param(lambda b: storage.optimize_image(b, size=(64, 64)), id="optimize_image"),
        pytest.param(lambda b: storage.optimize_photo(b, max_dim=64), id="optimize_photo"),
    ],
)
def test_opak_alan_rengini_korur(optimize):
    """Düzleştirme yalnız şeffaf alanı doldurmalı; opak piksel bozulmamalı.

    Bu olmadan "her şeyi beyaza boya" gibi bir düzeltme de testi geçerdi.
    """
    out = _webp_ac(optimize(_png_bytes(_yari_seffaf_rgba())))
    r, g, b = out.getpixel((2, 2))
    assert r >= ACIK and g <= KOYU and b <= KOYU, f"opak kırmızı bozuldu: {(r, g, b)}"


def test_tamamen_seffaf_gorsel_bastan_sona_beyaz():
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    out = _webp_ac(storage.optimize_image(_png_bytes(img), size=(32, 32)))
    for nokta in ((0, 0), (31, 0), (0, 31), (31, 31), (16, 16)):
        assert _acik_mi(out.getpixel(nokta)), f"{nokta} beyaz değil: {out.getpixel(nokta)}"


def test_la_modu_seffafligi_da_beyaza_duzlesir():
    """LA (gri + alfa): sol yarı opak SİYAH, sağ yarı şeffaf.

    Sağ yarının beyaz çıkması, düzeltmenin "alfa 0 → zemin" yaptığını; sol
    yarının siyah kalması, gerçek siyahın beyaza çevrilmediğini gösterir.
    """
    img = Image.new("LA", (64, 64), (0, 0))
    img.paste((0, 255), (0, 0, 32, 64))
    out = _webp_ac(storage.optimize_photo(_png_bytes(img), max_dim=64))
    assert _acik_mi(out.getpixel((61, 32))), "şeffaf alan beyaz değil"
    assert all(k <= KOYU for k in out.getpixel((2, 32))), "opak siyah bozuldu"


# ── Pillow uyarısı ──────────────────────────────────────────────────────────


def test_fixture_gercekten_uyari_ureten_bir_girdi():
    """Nöbetçinin nöbetçisi.

    Aşağıdaki uyarı testi ancak Pillow'un o girdide GERÇEKTEN uyardığı
    durumda anlam taşır. Bu test, fixture'ın doğrudan ``convert("RGB")``
    edildiğinde uyarıyı tetiklediğini kanıtlar; tetiklemezse "uyarı yok"
    iddiası bedavaya geçerdi.
    """
    with warnings.catch_warnings(record=True) as kayit:
        warnings.simplefilter("always")
        Image.open(io.BytesIO(_paletli_seffaf())).convert("RGB")
    assert any(
        "Palette images with Transparency" in str(w.message) for w in kayit
    ), "fixture Pillow palet uyarısını tetiklemiyor — uyarı testi boş kalır"


@pytest.mark.parametrize(
    "optimize",
    [
        pytest.param(lambda b: storage.optimize_image(b, size=(64, 64)), id="optimize_image"),
        pytest.param(lambda b: storage.optimize_photo(b, max_dim=64), id="optimize_photo"),
    ],
)
def test_paletli_seffaf_png_uyari_uretmez_ve_beyaz_olur(optimize):
    """``P → RGB`` doğrudan yapılırsa Pillow uyarır VE şeffaflığı sessizce atar.

    Uyarının kendisi zararsız görünür ama bu projede tam olarak atılan
    şeffaflık siyah zemine dönüşüyordu — ikisi aynı hatanın iki yüzü.
    """
    with warnings.catch_warnings(record=True) as kayit:
        warnings.simplefilter("always")
        out = _webp_ac(optimize(_paletli_seffaf()))

    palet_uyarilari = [
        str(w.message) for w in kayit if "Palette images with Transparency" in str(w.message)
    ]
    assert not palet_uyarilari, f"Pillow palet uyarısı tetiklendi: {palet_uyarilari}"

    g, _ = out.size
    assert _acik_mi(out.getpixel((g - 3, 2))), "paletli şeffaf alan beyaz değil"
    r, ye, m = out.getpixel((2, 2))
    assert r >= ACIK and ye <= KOYU and m <= KOYU, f"paletli opak alan bozuldu: {(r, ye, m)}"


# ── Şeffaflığı olmayan görüntüde davranış değişmemeli ───────────────────────


@pytest.mark.parametrize(
    "img",
    [
        pytest.param(Image.new("RGB", (64, 64), (0, 0, 255)), id="RGB"),
        pytest.param(Image.new("L", (64, 64), 128), id="L-gri"),
        pytest.param(Image.new("P", (64, 64)), id="P-alfasiz"),
        pytest.param(Image.new("CMYK", (64, 64)), id="CMYK"),
    ],
)
def test_seffafligi_olmayan_gorsel_dokunulmadan_gecer(img):
    """``flatten_on_white`` alfasız görüntüde AYNI nesneyi döndürmeli.

    Kimlik (``is``) kontrolü bilinçli: kopya döndürmek de "davranış aynı"
    görünürdü ama mevcut mod dönüşümü zincirini sessizce değiştirirdi.
    """
    assert storage.flatten_on_white(img) is img


def test_seffafsiz_rgb_gorselin_renkleri_korunur():
    img = Image.new("RGB", (128, 128), (0, 0, 255))
    img.paste((255, 255, 0), (0, 0, 64, 128))
    out = _webp_ac(storage.optimize_image(_png_bytes(img), size=(64, 64)))
    r, g, b = out.getpixel((61, 32))
    assert b >= ACIK and r <= KOYU and g <= KOYU, f"mavi bozuldu: {(r, g, b)}"
    r, g, b = out.getpixel((2, 32))
    assert r >= ACIK and g >= ACIK and b <= KOYU, f"sarı bozuldu: {(r, g, b)}"


def test_ciktilar_gecerli_webp():
    """Düzleştirme çıktı formatını değiştirmemeli (alfa'sız WebP)."""
    data = storage.optimize_image(_png_bytes(_yari_seffaf_rgba()), size=(64, 64))
    out = Image.open(io.BytesIO(data))
    assert out.format == "WEBP"
    assert out.size == (64, 64)
