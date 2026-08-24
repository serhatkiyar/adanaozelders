"""İndirilen CSV şablonu GERÇEKTEN içe aktarılabiliyor mu — gerçek HTTP + PG.

## Neden bu test sınırın iki yakasını birden okur

Şablonun başlığı ve örnek satırı frontend'de yaşar
(`frontend/src/lib/productCsvTemplate.ts`), doğrulaması ise backend'dedir
(`services/store_service.py::bulk_import_products`). Kayma tam bu boşlukta
oluştu: örnek satır 18 alan taşıyordu, başlık 19 kolondu — `tax_rate`
atlanmıştı ve sonraki her değer bir sola kaymıştı (`tax_rate=399`,
`stock="yks-kitaplari"`). Şablonu indirip dolduran herkes reddedilen bir dosya
gönderiyordu.

Frontend'deki Vitest nöbetçisi (`productCsvTemplate.test.ts`) hizayı ve alan
anlamlarını korur; **ama backend'in o satırı kabul ettiğini kanıtlayamaz**.
Şablon dosyadan OKUNUR (kopyalanmaz): kopyalansaydı iki metin sessizce
ayrışabilir ve test yanlış bir şeyi doğrulardı.
"""
from __future__ import annotations

import pathlib
import re

import httpx
import pytest
from sqlalchemy import text

from core.config import settings
from core.database import AsyncSessionLocal
from tests.integration.db_guard import purge_products
from tests.integration.ip12_factory import fab12  # noqa: F401  (fixture)

UC = f"{settings.API_V1_PREFIX}/store/admin/products/bulk"

#: repo kökü = .../backend/tests/integration/<bu dosya> → parents[3]
SABLON_DOSYASI = (
    pathlib.Path(__file__).resolve().parents[3]
    / "frontend"
    / "src"
    / "lib"
    / "productCsvTemplate.ts"
)


def _sablon_sabiti(ad: str) -> str:
    """`export const <ad> =` sonrasındaki tek tırnaklı/çift tırnaklı dizgi."""
    kaynak = SABLON_DOSYASI.read_text(encoding="utf-8")
    m = re.search(rf'export const {ad} =\s*\n?\s*"([^"]*)";', kaynak)
    assert m, f"{ad} şablon dosyasında bulunamadı: {SABLON_DOSYASI}"
    return m.group(1)


@pytest.fixture
async def http():
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://sablon.test"
    ) as c:
        yield c


@pytest.fixture
async def urun_copu(pg, sablon_kategorisi):
    """Başlık ile temizlik — test başarısız olsa da satır kalmasın."""
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
async def sablon_kategorisi(pg):
    """Şablonun `category_slug`'ı katalogda YOKSA satır reddedilir.

    Slug uydurma değil, gerçek katalogdan (`seed_kitapsec.py`); ama tek
    kullanımlık test veritabanı boş açılır. Kategori burada kurulur ki test
    ölçmek istediği şeyi — kolon hizasını — ölçsün, seed'in varlığını değil.
    """
    slug = _sablon_sabiti("CSV_SAMPLE_ROW").split(",")[6]
    async with AsyncSessionLocal() as s:
        mevcut = (
            await s.execute(
                text("SELECT id FROM product_categories WHERE slug = :s"), {"s": slug}
            )
        ).first()
        if mevcut:
            yield slug
            return
        yeni = (
            await s.execute(
                text(
                    "INSERT INTO product_categories (slug, name, sort_order) "
                    "VALUES (:s, :n, 0) RETURNING id"
                ),
                {"s": slug, "n": slug},
            )
        ).scalar_one()
        await s.commit()
    yield slug
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("DELETE FROM product_categories WHERE id = :i"), {"i": yeni}
        )
        await s.commit()


async def test_indirilen_sablon_OLDUGU_GIBI_ice_aktarilabilir(
    http, fab12, urun_copu, sablon_kategorisi  # noqa: F811
):
    """Şablonu indirip hiç değiştirmeden geri yükleyen kullanıcı 1 ürün almalı.

    Kayma döneminde bu istek `created=0` + "tax_rate 0 ≤ oran < 1 olmalı: 399"
    hatasıyla dönüyordu.
    """
    _admin_id, basliklar = await fab12.admin(izinler=["products.manage"])
    kolonlar = _sablon_sabiti("CSV_COLUMNS")
    ornek = _sablon_sabiti("CSV_SAMPLE_ROW")

    # Örnek satırın başlığı benzersizleştirilmez: şablon OLDUĞU GİBİ denenir.
    # (Aynı ISBN ikinci kez gelirse servis satırı `skipped` sayar — bu yüzden
    # teardown başlıkla temizler ve test tek koşuda anlamlıdır.)
    urun_copu.append(ornek.split(",")[0])
    csv_metni = f"{kolonlar}\n{ornek}\n"

    r = await http.post(
        UC,
        files={"file": ("urun-sablonu.csv", csv_metni.encode("utf-8"), "text/csv")},
        headers=basliklar,
    )

    assert r.status_code == 200, r.text
    sonuc = r.json()
    assert sonuc["errors"] == [], sonuc["errors"]
    assert sonuc["created"] == 1, sonuc

    # Kaymanın en okunaklı kanıtı: değerler DOĞRU kolonlara oturdu mu?
    async with AsyncSessionLocal() as s:
        satir = (
            await s.execute(
                text(
                    "SELECT kind, tax_rate, price, stock, status, isbn "
                    "FROM products WHERE title = :t"
                ),
                {"t": ornek.split(",")[0]},
            )
        ).one()
    assert satir.kind == "PHYSICAL"
    assert 0 <= float(satir.tax_rate) < 1
    assert float(satir.price) > 0
    assert satir.stock is not None
    assert satir.status in ("ACTIVE", "HIDDEN", "DRAFT")
    assert satir.isbn and satir.isbn.isdigit()
