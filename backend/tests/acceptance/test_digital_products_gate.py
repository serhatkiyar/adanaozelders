"""Dijital ürün satışı kapısı — DAVRANIŞ SÖZLEŞMESİ.

Neden var: sanal POS başvurusunda platformun eğitim hizmeti satmadığı, üçüncü
kişi adına tahsilat yapmadığı ve emanet modeli kullanmadığı beyan edildi. Yasal
metinler (mesafeli satış sözleşmesi + ön bilgilendirme formu) buna göre yazıldı
ve dijital ürüne ilişkin HİÇBİR hüküm içermiyor. Dolayısıyla dijital bir kalemin
kasadan geçebilmesi, yalnız bir ürün kararı değil, yayımlanmış bir beyanla
çelişki üretir.

Kapatılan somut boşluk: ödeme KOLLARI "kimin adına tahsilat yapılıyor" sorusuna
bakar. `SellerType.PLATFORM` + `ProductKind.DIGITAL` kombinasyonu `store`
koluna düşer ve o kolun varsayılanı AÇIKTIR (platform kendi malını satar) —
yani kol kapısı bu ürünü hiç durdurmaz. `create_product` `seller_type`'ı
PLATFORM'a sabitler ama `kind`'ı çağırandan alır, bu yüzden böyle bir ürün
oluşturulabilir.

Bu dosya `tests/acceptance/` altındadır: bilinçli bir karar olmadan
düzenlenmez (bkz. kök CLAUDE.md).
"""
import pytest
from fastapi import HTTPException

from core import flags
from services import payment_gates


@pytest.mark.asyncio
async def test_dijital_kalem_varsayilan_olarak_REDDEDILIR():
    """Bayrak varsayılanı kapalı → dijital kalem 503 alır."""
    with pytest.raises(HTTPException) as exc:
        await payment_gates.assert_digital_products_allowed(None, ["DIGITAL"])
    assert exc.value.status_code == 503
    assert exc.value.detail["code"] == "DIGITAL_PRODUCTS_CLOSED"


@pytest.mark.asyncio
async def test_karisik_sepette_tek_bir_dijital_kalem_bile_yeter():
    """Fiziksel kitapların arasına karışan tek dijital satır siparişi durdurur."""
    with pytest.raises(HTTPException) as exc:
        await payment_gates.assert_digital_products_allowed(
            None, ["PHYSICAL", "PHYSICAL", "DIGITAL"]
        )
    assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_yalniz_fiziksel_sepet_gecer():
    """Kitap satışı ilk sürümün ASIL işi — kapı onu engellememeli."""
    await payment_gates.assert_digital_products_allowed(None, ["PHYSICAL"])
    await payment_gates.assert_digital_products_allowed(None, [])


@pytest.mark.asyncio
async def test_kind_degeri_bicimden_bagimsiz_yakalanir():
    """Büyük/küçük harf ve boşluk, kapıyı atlatmanın yolu olmamalı."""
    for bicim in ("digital", " Digital ", "DIGITAL"):
        with pytest.raises(HTTPException):
            await payment_gates.assert_digital_products_allowed(None, [bicim])


@pytest.mark.asyncio
async def test_sepet_uyarisi_odeme_denemesinden_once_bildirilir():
    """`validate_cart` bunu kullanır: kullanıcı 503'e kadar yürümesin."""
    assert await payment_gates.digital_blocked_for_kinds(None, ["DIGITAL"]) is True
    assert await payment_gates.digital_blocked_for_kinds(None, ["PHYSICAL"]) is False


def test_bayrak_katalogda_kayitli_kapali_ve_UYGULANIYOR():
    """`enforced=False` bir bayrak panelde açık görünüp hiçbir şeyi kapatmaz;
    bu kapı gerçekten uygulandığı için işaretin doğru olması gerekir."""
    spec = next(
        (s for s in flags.FLAG_SPECS if s.key == flags.FLAG_DIGITAL_PRODUCTS_LIVE),
        None,
    )
    assert spec is not None, "digital_products_live bayrağı katalogda yok"
    assert spec.default is False, "dijital ürün satışı varsayılan olarak AÇIK olamaz"
    assert spec.enforced is True


def test_siparis_yolu_kapiyi_GERCEKTEN_cagiriyor():
    """Kablolama sözleşmesi (düşük güçlü — yukarıdaki davranış testlerinin
    yanında durur): kapı fonksiyonu var olup `create_order` onu çağırmıyorsa
    koruma yok demektir. AST ile fonksiyon gövdesi içinde aranır; yorum satırı
    veya docstring yanlış pozitif üretmez.
    """
    import ast
    import pathlib

    kaynak = (
        pathlib.Path(__file__).resolve().parents[1].parent
        / "services"
        / "order_service.py"
    ).read_text(encoding="utf-8")
    agac = ast.parse(kaynak)

    def cagrilar(fonksiyon_adi: str) -> set[str]:
        for d in ast.walk(agac):
            if isinstance(d, ast.AsyncFunctionDef) and d.name == fonksiyon_adi:
                return {
                    n.func.attr
                    for n in ast.walk(d)
                    if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                }
        raise AssertionError(f"{fonksiyon_adi} bulunamadı")

    assert "assert_digital_products_allowed" in cagrilar("create_order")
    assert "digital_blocked_for_kinds" in cagrilar("validate_cart")
