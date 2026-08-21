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


# ── Ürün OLUŞTURMA kapısı ────────────────────────────────────────────────────
#
# Satış kapısı yalnız checkout'ta çalışıyordu. Bayrak kapalıyken oluşturulan
# dijital ürün kaydediliyor, vitrine çıkıyor, sepete giriyor ve ancak ödemede
# 503 alıyordu — üstelik `products_identity_immutable` trigger'ı `kind`'ı
# değiştirilemez kıldığı için o satır DÜZELTİLEMİYORDU. Davranışın gerçek DB +
# gerçek HTTP kanıtı: tests/integration/test_digital_create_gate_pg.py.


@pytest.mark.asyncio
async def test_dijital_urun_OLUSTURMA_varsayilan_olarak_REDDEDILIR():
    with pytest.raises(HTTPException) as exc:
        await payment_gates.assert_digital_product_creatable(None, "DIGITAL")
    assert exc.value.status_code == 503
    assert exc.value.detail["code"] == "DIGITAL_PRODUCTS_CLOSED"
    # Mesaj yöneticiye ne yapacağını söylemeli: sepetten kalem çıkarmasını
    # isteyen müşteri metni burada yanlış olurdu.
    assert "bayrağ" in exc.value.detail["message"].lower()


@pytest.mark.asyncio
async def test_fiziksel_urun_olusturma_kapidan_ETKILENMEZ():
    """Kitap/kırtasiye satışı ASIL iştir; kapı onu durdurmamalı."""
    await payment_gates.assert_digital_product_creatable(None, "PHYSICAL")
    await payment_gates.assert_digital_product_creatable(None, None)


@pytest.mark.asyncio
async def test_olusturma_kapisi_da_bicimden_bagimsiz_yakalar():
    for bicim in ("digital", " Digital ", "DIGITAL"):
        with pytest.raises(HTTPException):
            await payment_gates.assert_digital_product_creatable(None, bicim)


def test_urun_yazan_UC_YOLUN_HEPSI_kapiyi_cagiriyor():
    """Kablolama sözleşmesi (düşük güçlü — yukarıdaki davranış testlerinin ve
    entegrasyon testinin yanında durur).

    Üç yol da yeni bir ürün SATIRI yazar ve `kind`'ı çağırandan/kaynaktan alır:
      • `create_product`        — admin formu
      • `bulk_import_products`  — AYNI ekranın CSV kapısı
      • `derive_variant`        — `kind=kaynak.kind` kopyalar
    Biri açık kalırsa kapı tiyatrodur. AST ile fonksiyon gövdesinde aranır;
    yorum satırı ya da docstring yanlış pozitif üretmez.
    """
    import ast
    import pathlib

    kaynak = (
        pathlib.Path(__file__).resolve().parents[1].parent
        / "services"
        / "store_service.py"
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

    assert "assert_digital_product_creatable" in cagrilar("create_product")
    assert "assert_digital_product_creatable" in cagrilar("derive_variant")
    # CSV yolu satır satır ilerler: tek bir satırın reddi dosyanın kalanını
    # düşürmemeli, bu yüzden `HTTPException` değil bayrak OKUMASI kullanılır.
    assert "digital_products_open" in cagrilar("bulk_import_products")


def test_public_uygunluk_semasi_dijital_durumu_TASIR():
    """İstemci fail-closed olabilmek için bayrağı okuyabilmeli; alan şemadan
    düşerse admin formu DIGITAL'i sessizce yeniden açardı."""
    from schemas.feature_flag import PaymentAvailabilityOut

    alan = PaymentAvailabilityOut.model_fields.get("digital_products_open")
    assert alan is not None, "public uygunluk şeması dijital durumu taşımıyor"
    # Varsayılan FAIL-CLOSED: alan gelmezse "kapalı" sayılmalı.
    assert alan.default is False
