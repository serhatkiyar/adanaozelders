"""İP-5 · V-1…V-5 — KDV oranının YAZILABİLİR olması (gerçek HTTP + gerçek PG).

Denetim raporu P1-7: `tax_rate` üretim kodunda yalnız model tanımı + okuma
yerlerinde geçiyor; `ProductCreate`/`ProductUpdate` şemalarında alan yok, CSV
başlığı yok. Sonuç: her ürünün oranı `server_default 0` kalıyor ve buna bağlı
olarak her sipariş kaleminin `tax_amount`'ı 0 çıkıyor.

Bu dosya oranın **gerçekten yazıldığını** ölçer: HTTP isteği gönderilir,
sonuç `products` tablosundan HAM SQL ile okunur. Şemanın alanı kabul etmesi
tek başına kanıt değildir — Pydantic bilinmeyen alanı sessizce yutar ve uç
yine 201 döner; bu yüzden her doğrulama DB'deki değere bakar.

Birim: `tax_rate` ORAN'dır (0.20 = %20), yüzde değil. `models.store.Product`
(`Numeric(5,4)`) ve `services/tax.py` (`0 ≤ oran < 1`) bu birimde çalışır.
"""
from __future__ import annotations

import io
from decimal import Decimal

import pytest

from tests.integration.ip5_factory import uniq

pytestmark = pytest.mark.asyncio

_IZIN = ["products.view", "products.manage"]


async def _admin_headers(fab5):
    _, headers = await fab5.admin(izinler=_IZIN)
    return headers


# ── V-1 · ProductCreate oranı kabul ediyor ve DB'ye YAZIYOR ──────────────────


async def test_v1_urun_olusturmada_oran_dbye_yaziliyor(http, fab5):
    headers = await _admin_headers(fab5)
    r = await http.post(
        "/api/v1/store/admin/products",
        headers=headers,
        json={
            "title": f"IP5 Kirtasiye {uniq()}",
            "kind": "PHYSICAL",
            "price": "120.00",
            "tax_rate": "0.20",
            "stock": 5,
            "status": "ACTIVE",
        },
    )
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    fab5.product_ids.append(pid)

    # Yanıt gövdesi DEĞİL, tablodaki değer kanıttır.
    assert await fab5.urun_orani(pid) == Decimal("0.2000")


async def test_v1b_oran_yaniti_da_tasiyor(http, fab5):
    """Oran yazıldıysa okunabilmeli — admin ekranı düzenlemede onu gösterir."""
    headers = await _admin_headers(fab5)
    r = await http.post(
        "/api/v1/store/admin/products",
        headers=headers,
        json={
            "title": "IP5 Oran Yaniti",
            "kind": "PHYSICAL",
            "price": "100.00",
            "tax_rate": "0.10",
            "stock": 1,
        },
    )
    assert r.status_code == 201, r.text
    fab5.product_ids.append(r.json()["id"])
    assert Decimal(str(r.json()["tax_rate"])) == Decimal("0.10")


# ── V-2 · ProductUpdate oranı GÜNCELLİYOR ───────────────────────────────────


async def test_v2_urun_guncellemede_oran_degisiyor(http, fab5):
    headers = await _admin_headers(fab5)
    pid = await fab5.urun(price="100.00", tax_rate="0", stock=3)

    r = await http.patch(
        f"/api/v1/store/admin/products/{pid}",
        headers=headers,
        json={"tax_rate": "0.20"},
    )
    assert r.status_code == 200, r.text
    assert await fab5.urun_orani(pid) == Decimal("0.2000")


async def test_v2b_oran_gonderilmezse_mevcut_deger_korunuyor(http, fab5):
    """Kısmi PATCH oranı SIFIRLAMAMALI — `exclude_unset` sözleşmesi."""
    headers = await _admin_headers(fab5)
    pid = await fab5.urun(price="100.00", tax_rate="0.20", stock=3)

    r = await http.patch(
        f"/api/v1/store/admin/products/{pid}",
        headers=headers,
        json={"title": "IP5 Yalniz Baslik"},
    )
    assert r.status_code == 200, r.text
    assert await fab5.urun_orani(pid) == Decimal("0.2000")


# ── V-3 · CSV içe aktarma `tax_rate` sütununu OKUYOR ────────────────────────


async def _csv_yukle(http, headers, govde: str):
    return await http.post(
        "/api/v1/store/admin/products/bulk",
        headers=headers,
        files={"file": ("urunler.csv", io.BytesIO(govde.encode("utf-8")), "text/csv")},
    )


async def _csv_urunlerini_topla(fab5, onek: str) -> dict[str, Decimal]:
    """Önekle oluşmuş ürünleri teardown'a KAYDEDER ve oranlarını döner.

    Kayıt, assert'lerden ÖNCE yapılır: bir assert düşerse bile ürünler
    fabrikanın temizlik listesindedir. (Bu tuzağa bir kez düşüldü — uç 500
    dönünce kayıt satırına hiç ulaşılmadı ve satırlar test DB'sinde kaldı,
    sonraki koşumu kirletti.)
    """
    from sqlalchemy import text as sa_text

    from core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as s:
        rows = (
            await s.execute(
                sa_text(
                    "SELECT id, title, tax_rate FROM products "
                    "WHERE title LIKE :p ORDER BY title"
                ),
                {"p": f"{onek}%"},
            )
        ).all()
    fab5.product_ids.extend([r[0] for r in rows])
    return {r[1]: Decimal(str(r[2])) for r in rows}


async def test_v3_csv_orani_okuyor(http, fab5):
    headers = await _admin_headers(fab5)
    # Önek koşuma özgüdür: paralel/ardışık koşumlar birbirinin satırını
    # görmez ve sabit başlık çakışması yaşanmaz.
    onek = f"IP5CSV{uniq()}"
    csv = (
        "title,kind,price,tax_rate,stock\n"
        f"{onek} Kirtasiye,PHYSICAL,120.00,0.20,5\n"
        f"{onek} Kitap,PHYSICAL,100.00,0,5\n"
    )
    r = await _csv_yukle(http, headers, csv)
    oranlar = await _csv_urunlerini_topla(fab5, onek)

    assert r.status_code == 200, r.text
    assert r.json()["created"] == 2, r.json()
    assert oranlar[f"{onek} Kirtasiye"] == Decimal("0.2000")
    assert oranlar[f"{onek} Kitap"] == Decimal("0.0000")


async def test_v3b_csv_oransiz_satir_reddediliyor_ve_raporlaniyor(http, fab5):
    """S-5: sessiz varsayılan YOK — oransız satır oluşturulmaz, hata listelenir.

    Sessizce %0 yazmak, yanlış oranla satılan ve yanlış fatura kesilen bir
    ürün demektir; hata ancak muhasebede ortaya çıkar.
    """
    headers = await _admin_headers(fab5)
    onek = f"IP5CSVX{uniq()}"
    csv = (
        "title,kind,price,tax_rate,stock\n"
        f"{onek} Oranli,PHYSICAL,120.00,0.20,5\n"
        f"{onek} Oransiz,PHYSICAL,100.00,,5\n"
    )
    r = await _csv_yukle(http, headers, csv)
    oranlar = await _csv_urunlerini_topla(fab5, onek)

    assert r.status_code == 200, r.text
    sonuc = r.json()
    assert sonuc["created"] == 1, sonuc
    assert f"{onek} Oransiz" not in oranlar, "oransız satır oluşturulmuş"
    assert f"{onek} Oranli" in oranlar, "geçerli satır da atlanmış"
    assert sonuc["errors"], "reddedilen satır raporlanmamış"
    assert any(
        "tax_rate" in e["message"] or "KDV" in e["message"] for e in sonuc["errors"]
    ), sonuc["errors"]


# ── V-4 · Geçersiz oran → 422 ───────────────────────────────────────────────


@pytest.mark.parametrize(
    "gecersiz",
    ["-0.01", "1", "1.5", "abc", "20"],
    ids=["negatif", "bir", "birden_buyuk", "sayi_degil", "yuzde_yazilmis"],
)
async def test_v4_gecersiz_oran_422(http, fab5, gecersiz):
    """Sınır ORAN birimindedir: 0 ≤ r < 1.

    `"20"` bilinçli olarak listede: admin yüzde girmeye çalışırsa uç bunu
    %2000 diye kabul etmemelidir. Sessizce yanlış fatura üretmek, hata
    vermekten kötüdür (`services/tax.py` aynı gerekçeyle ValueError atar).
    """
    headers = await _admin_headers(fab5)
    r = await http.post(
        "/api/v1/store/admin/products",
        headers=headers,
        json={
            "title": "IP5 Gecersiz Oran",
            "kind": "PHYSICAL",
            "price": "100.00",
            "tax_rate": gecersiz,
            "stock": 1,
        },
    )
    if r.status_code == 201:  # pragma: no cover — kırmızı matriste beklenen yol
        fab5.product_ids.append(r.json()["id"])
    assert r.status_code == 422, f"geçersiz oran kabul edildi: {r.text}"


async def test_v4b_gecersiz_oran_guncellemede_de_422(http, fab5):
    headers = await _admin_headers(fab5)
    pid = await fab5.urun(price="100.00", tax_rate="0.20", stock=1)
    r = await http.patch(
        f"/api/v1/store/admin/products/{pid}",
        headers=headers,
        json={"tax_rate": "1.20"},
    )
    assert r.status_code == 422, r.text
    # Reddedilen istek DEĞİŞİKLİK BIRAKMAMALI.
    assert await fab5.urun_orani(pid) == Decimal("0.2000")


async def test_v4c_oran_zorunlu_alan(http, fab5):
    """S-5: oran hiç gönderilmezse ürün oluşturulamaz (sessiz %0 yok)."""
    headers = await _admin_headers(fab5)
    r = await http.post(
        "/api/v1/store/admin/products",
        headers=headers,
        json={
            "title": "IP5 Oransiz Urun",
            "kind": "PHYSICAL",
            "price": "100.00",
            "stock": 1,
        },
    )
    if r.status_code == 201:  # pragma: no cover
        fab5.product_ids.append(r.json()["id"])
    assert r.status_code == 422, f"oransız ürün kabul edildi: {r.text}"


# ── V-5 · Oran ÜRÜN bazında saklanıyor, kategoriye göre türetilmiyor ─────────


async def test_v5_ayni_kategoride_farkli_oranlar_korunuyor(http, fab5):
    """Aynı kategorideki iki ürün farklı oran taşıyabilmeli.

    Mevzuat kararını koda gömmemenin ölçülebilir hâli budur: oran VERİDİR,
    kategoriden türetilmez. Bu test, birinin "kitap kategorisi → %0" gibi bir
    kısayol eklemesini yakalar.
    """
    headers = await _admin_headers(fab5)

    kr = await http.post(
        "/api/v1/store/admin/categories",
        headers=headers,
        json={"name": f"IP5 Kategori {uniq()}"},
    )
    assert kr.status_code in (200, 201), kr.text
    kategori_id = kr.json()["id"]

    try:
        idler = []
        for oran in ("0", "0.20"):
            r = await http.post(
                "/api/v1/store/admin/products",
                headers=headers,
                json={
                    "title": f"IP5 Kat Urun {oran}",
                    "kind": "PHYSICAL",
                    "price": "100.00",
                    "tax_rate": oran,
                    "stock": 1,
                    "category_id": kategori_id,
                },
            )
            assert r.status_code == 201, r.text
            pid = r.json()["id"]
            fab5.product_ids.append(pid)
            idler.append((pid, Decimal(oran)))

        for pid, beklenen in idler:
            assert await fab5.urun_orani(pid) == beklenen.quantize(Decimal("0.0001"))

        # Kategori değişikliği oranı EZMEMELİ.
        pid0 = idler[0][0]
        r = await http.patch(
            f"/api/v1/store/admin/products/{pid0}",
            headers=headers,
            json={"category_id": None},
        )
        assert r.status_code == 200, r.text
        assert await fab5.urun_orani(pid0) == Decimal("0.0000")
    finally:
        from sqlalchemy import text as sa_text

        from core.database import AsyncSessionLocal

        async with AsyncSessionLocal() as s:
            await s.execute(
                sa_text("UPDATE products SET category_id = NULL WHERE category_id = :c"),
                {"c": kategori_id},
            )
            await s.execute(
                sa_text("DELETE FROM product_categories WHERE id = :c"),
                {"c": kategori_id},
            )
            await s.commit()
