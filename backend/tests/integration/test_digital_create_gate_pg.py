"""Dijital ürün OLUŞTURMA kapısı — gerçek Postgres + gerçek HTTP.

## Kapatılan tuzak

`digital_products_live` bayrağı kapalıyken checkout dijital kalemi 503 ile
reddediyordu (`payment_gates.assert_digital_products_allowed`), ama ürünü
OLUŞTURMA yolunda hiçbir kapı yoktu. Sonuç bir tuzaktı:

1. Admin `kind=DIGITAL` seçip ürünü kaydedebiliyordu,
2. Ürün `status=ACTIVE` ile vitrine çıkıyordu (public arama yalnız `status`
   filtreler, bayrağa bakmaz),
3. Müşteri sepete ekleyebiliyor ama ödeyemiyordu (503),
4. Ve ürün **düzeltilemiyordu**: `kind` bir BEFORE UPDATE trigger'ıyla
   (`products_identity_immutable`) değişmez — SKU öneki ona bağlı. Yani tek
   çıkış yolu ürünü silip yeniden açmaktı.

## Bu dosya neyi kanıtlar

Kapının yalnız var olduğunu değil, **veriye hiç dokunmadığını**: ret sonrası
`products` tablosunda satır KALMAMALIDIR. "503 döndü" tek başına yeterli
değildir — ürün yazılıp sonra hata dönmüş de olabilirdi.

Bayrak açıkken aynı isteğin geçmesi de sınanır: kapı bir YASAK değil, bayrağın
aynasıdır. Aksi hâlde bayrak açıldığında dijital satış yine çalışmazdı.

Gerçek altyapı gerekçesi (kök CLAUDE.md → F): yetki çözümü, `status` yazımı,
trigger'lar ve rollback davranışı mock'lanamaz.
"""
from __future__ import annotations

import uuid

import httpx
import pytest
from sqlalchemy import text

from core import flags
from core.config import settings
from core.database import AsyncSessionLocal
from services import feature_flag_service
from tests.integration.db_guard import purge_products
from tests.integration.ip12_factory import fab12  # noqa: F401  (fixture)

UC = f"{settings.API_V1_PREFIX}/store/admin/products"


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


@pytest.fixture
async def http():
    """Gerçek FastAPI uygulaması; dependency override YOK, lifespan YOK."""
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://dijital.test"
    ) as c:
        yield c


@pytest.fixture
async def urun_copu():
    """Testin HTTP üzerinden oluşturduğu ürünleri fiziksel siler.

    Temizlik **ID ile değil BAŞLIK ile** yapılır. Sebebi somut: bu dosyanın
    testleri "ürün OLUŞMAMALI" diye iddia eder, dolayısıyla başarılı koşuda
    silinecek ID yoktur — ama kapı bozulduğunda (mutasyon provası ya da gerçek
    bir regresyon) satır oluşur ve iddia patladığı için ID hiç kaydedilemez.
    Böyle bir koşu test veritabanında kalıcı çöp bırakırdı (hijyen nöbetçisi
    bunu bir kez yakaladı). Başlık kaydı istekten ÖNCE yapılır.

    Teardown testin sonucundan bağımsız koşar.
    """
    basliklar: list[str] = []
    yield basliklar
    if not basliklar:
        return
    async with AsyncSessionLocal() as s:
        idler = (
            (
                await s.execute(
                    text("SELECT id FROM products WHERE title = ANY(:t)"),
                    {"t": basliklar},
                )
            )
            .scalars()
            .all()
        )
        if idler:
            await purge_products(s, list(idler))
        await s.commit()


@pytest.fixture
async def bayrak(fab12):  # noqa: F811
    """Bayrağı testin istediği duruma alır; teardown'da DB satırını siler.

    Bayrak DB'de yaşadığı için (`feature_flags`), açık bırakılan bir satır
    sonraki testlere ve geliştirme ortamına sızardı. Süreç içi önbellek de
    her iki uçta temizlenir.
    """
    admin_id, _ = await fab12.admin(izinler=["products.manage"])

    async def ayarla(acik: bool) -> None:
        async with AsyncSessionLocal() as s:
            await feature_flag_service.set_flag(
                s,
                key=flags.FLAG_DIGITAL_PRODUCTS_LIVE,
                enabled=acik,
                admin_id=admin_id,
                note="entegrasyon testi",
            )
            await s.commit()
        flags.invalidate(flags.FLAG_DIGITAL_PRODUCTS_LIVE)

    flags.invalidate(flags.FLAG_DIGITAL_PRODUCTS_LIVE)
    yield ayarla
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("DELETE FROM feature_flags WHERE key = :k"),
            {"k": flags.FLAG_DIGITAL_PRODUCTS_LIVE},
        )
        await s.commit()
    flags.invalidate(flags.FLAG_DIGITAL_PRODUCTS_LIVE)


def _govde(kind: str, ek: str) -> dict:
    return {
        "title": f"Dijital Kapı Testi {ek}",
        "kind": kind,
        "price": "99.90",
        # Oran ZORUNLU ve testte gerçek bir mevzuat değeri DEĞİL — bu dosya KDV
        # kararını sınamıyor (mali müşavir onayı ayrı iş).
        "tax_rate": "0.1234",
        "status": "ACTIVE",
    }


async def _dijital_satir_sayisi(baslik: str) -> int:
    async with AsyncSessionLocal() as s:
        return int(
            (
                await s.execute(
                    text(
                        "SELECT count(*) FROM products "
                        "WHERE title = :t AND kind = 'DIGITAL'"
                    ),
                    {"t": baslik},
                )
            ).scalar_one()
        )


# ── D-1 · bayrak kapalı: ret + veriye dokunma ───────────────────────────────


async def test_bayrak_kapaliyken_dijital_urun_OLUSTURULAMAZ(
    http, fab12, bayrak, urun_copu  # noqa: F811
):
    """503 + `DIGITAL_PRODUCTS_CLOSED` ve **tabloda satır yok**."""
    await bayrak(False)
    _admin_id, basliklar = await fab12.admin(izinler=["products.manage"])
    ek = _uniq()
    govde = _govde("DIGITAL", ek)
    urun_copu.append(govde["title"])  # kapı bozulursa satır teardown'da silinsin

    r = await http.post(UC, json=govde, headers=basliklar)

    assert r.status_code == 503, r.text
    detay = r.json()["detail"]
    assert detay["code"] == "DIGITAL_PRODUCTS_CLOSED"

    # ASIL iddia: ürün YAZILMADI. Ret sonrası kalan satır, tuzağın devam
    # ettiği anlamına gelirdi (kind trigger'ı yüzünden düzeltilemez bir satır).
    assert await _dijital_satir_sayisi(govde["title"]) == 0


async def test_fiziksel_urun_ayni_bayrakta_ETKILENMEZ(
    http, fab12, bayrak, urun_copu  # noqa: F811
):
    """Kapı yalnız DIGITAL'i durdurur — kitap/kırtasiye satışı ASIL iştir."""
    await bayrak(False)
    _admin_id, basliklar = await fab12.admin(izinler=["products.manage"])
    ek = _uniq()
    govde = _govde("PHYSICAL", ek)
    urun_copu.append(govde["title"])

    r = await http.post(UC, json=govde, headers=basliklar)

    assert r.status_code == 201, r.text
    assert r.json()["kind"] == "PHYSICAL"


# ── D-2 · bayrak açık: kapı bir YASAK değil, bayrağın aynası ────────────────


async def test_bayrak_acikken_dijital_urun_olusturulabilir(
    http, fab12, bayrak, urun_copu  # noqa: F811
):
    """Aksi hâlde bayrak açıldığında dijital satış yine çalışmazdı."""
    await bayrak(True)
    _admin_id, basliklar = await fab12.admin(izinler=["products.manage"])
    ek = _uniq()
    govde = _govde("DIGITAL", ek)
    urun_copu.append(govde["title"])

    r = await http.post(UC, json=govde, headers=basliklar)

    assert r.status_code == 201, r.text
    assert r.json()["kind"] == "DIGITAL"


# ── D-3 · CSV kapısı: aynı ekranın ikinci kapısı ────────────────────────────


async def test_csv_ile_de_dijital_urun_KACIRILAMAZ(
    http, fab12, bayrak, urun_copu  # noqa: F811
):
    """Toplu içe aktarma aynı admin ekranındadır; açık kalırsa kapı tiyatrodur.

    CSV'de `kind` boş bırakılırsa PHYSICAL varsayılır (mevcut davranış), bu
    yüzden aynı dosyaya bir de fiziksel satır konur: dijital satır reddedilip
    HATA olarak raporlanırken fiziksel satır oluşmalıdır (satır bazlı
    savepoint'in kanıtı).
    """
    await bayrak(False)
    _admin_id, basliklar = await fab12.admin(izinler=["products.manage"])
    ek = _uniq()
    dijital_baslik = f"CSV Dijital {ek}"
    fiziksel_baslik = f"CSV Fiziksel {ek}"
    urun_copu.extend([dijital_baslik, fiziksel_baslik])
    csv_metni = (
        "title,kind,price,tax_rate,status\n"
        f"{dijital_baslik},DIGITAL,50,0.1234,ACTIVE\n"
        f"{fiziksel_baslik},PHYSICAL,50,0.1234,ACTIVE\n"
    )

    r = await http.post(
        f"{UC}/bulk",
        files={"file": ("urunler.csv", csv_metni.encode("utf-8"), "text/csv")},
        headers=basliklar,
    )

    assert r.status_code == 200, r.text
    sonuc = r.json()
    assert sonuc["created"] == 1, sonuc
    assert any(
        "dijital" in (h["message"] or "").lower() for h in sonuc["errors"]
    ), sonuc["errors"]
    assert await _dijital_satir_sayisi(dijital_baslik) == 0


# ── D-4 · public uygunluk ucu bayrağı söyler ────────────────────────────────


async def test_public_uygunluk_ucu_dijital_durumu_bildirir(http, bayrak):
    """İstemcinin DIGITAL seçeneğini kapatabilmesi için bayrağı OKUYABİLMESİ
    gerekir; bugüne dek public hiçbir uç bunu söylemiyordu.

    Aynı uç zaten public ve rate-limit'li (`/payments/availability`); ikinci
    bir uç açmak yerine tek alan eklenir.
    """
    await bayrak(False)
    r = await http.get(f"{settings.API_V1_PREFIX}/payments/availability")
    assert r.status_code == 200, r.text
    assert r.json()["digital_products_open"] is False

    await bayrak(True)
    r = await http.get(f"{settings.API_V1_PREFIX}/payments/availability")
    assert r.json()["digital_products_open"] is True
