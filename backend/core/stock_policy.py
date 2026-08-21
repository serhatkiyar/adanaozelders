"""Stok eşiği — TEK KAYNAK.

Neden ayrı bir modül: eşik bu paketten önce **üç yerde** birbirinden bağımsız
gömülüydü — `services/admin_service.py` (`Product.stock <= 5` düşük stok
sayacı), `frontend/.../ProductDetailPage.tsx` (`const LOW_STOCK = 5`) ve
dashboard kartının açıklama metni ("stok 5 veya altında"). Üçü ayrı ayrı
değiştirilebiliyordu; biri kaydığında alarm kartı ile ürün listesi FARKLI ürün
kümesi gösterir ve aradaki fark hiçbir yerde görünmezdi.

Eşik bir **ürün kararıdır**, hesap değil: "kaç adet kalınca yeniden sipariş
verilmeli" sorusunun cevabı. Bu yüzden kodda tek bir yerde durur ve oradan
okunur. İleride ürün bazında ezilebilir hâle gelirse (bkz. araştırma raporu
B6) bu modül o kararın da doğal yeri olur.

Frontend kendi kopyasını taşıyamaz — değer `GET /store/config` üzerinden
sunucudan okunur; iki taraf aynı sayıyı ayrı ayrı yazarsa sorun geri gelir.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import and_, exists, or_

from models.store import Product, ProductKind, ProductStatus
from models.supplier import Supplier, SupplierProduct

#: Düşük stok eşiği (adet). Bu değeri **buradan başka hiçbir yere yazmayın**.
#:
#: Anlamı `<=` ile okunur: stok bu değere EŞİT olan ürün de "azalan"dır.
#: Sınırın kendisini dışarıda bırakmak, eşiği 5 belirleyen yöneticinin
#: "5 kaldı" uyarısını almamasına yol açardı.
LOW_STOCK_THRESHOLD = 5


#: Filtre değerleri. `kritik` diğer ikisinin BİRLEŞİMİDİR (`stock <= eşik`,
#: 0 dahil) ve bilerek örtüşür: dashboard "Düşük stok" kartı yeniden sipariş
#: kararını besler, o karar için stoğu bitmiş ürün de düşük stokludur — hatta
#: daha acildir. Liste filtresinde ikisi ayrı durur ("hangileri bitti" ile
#: "hangileri bitmek üzere" ayrı sorular), ama kartın sayısı ile kartın açtığı
#: listenin AYNI kümeyi göstermesi gerekir; `kritik` o köprüdür.
STOCK_FILTERS = ("tukendi", "azalan", "var", "kritik")


#: Stok kovalarının kapsadığı ürün evreni: **satışta olan** fiziksel ürün.
#:
#: Neden `ACTIVE` (P1-1): dashboard sayacı bu filtreyi uyguluyordu, ürün
#: listesi uygulamıyordu ve ölçümde sayaç 5, liste 7 çıkıyordu — fark bir
#: taslak ve bir gizli üründü. Dört ayrı yerde verilen "kartın sayısı ile
#: kartın açtığı liste aynı kümedir" sözü bu yüzden YANLIŞTI.
#:
#: Karar listeyi daraltmak yönünde verildi çünkü kart bir **yeniden sipariş
#: alarmıdır**: taslak veya gizli ürün zaten satışta değildir ve onun için
#: sipariş verilmez. Sayacı genişletmek, satılmayan ürünü "ikmal et" diye
#: göstermek olurdu.
#:
#: Yüklem TEK YERDE tanımlı ve hem `admin_service` sayacı hem
#: `store_service` liste filtresi buradan okur. İki yerde ayrı yazılması
#: zaten kusurun kökeniydi.
def satista_fiziksel():
    """Sayaç ve liste filtresinin PAYLAŞTIĞI yüklem."""
    return and_(
        Product.kind == ProductKind.PHYSICAL.value,
        Product.status == ProductStatus.ACTIVE.value,
    )


def stok_kovasi_yuklemi(kova: str):
    """``?stok=`` değerini SQL yüklemine çevirir (sayaçla ortak evren).

    ``var`` dijitali de kapsar: dijital ürün tükenmez, dolayısıyla "stokta"
    kovasına düşer — ama yine yalnız satıştakiler.
    """
    if kova == "tukendi":
        return and_(satista_fiziksel(), Product.stock <= 0)
    if kova == "azalan":
        return and_(
            satista_fiziksel(),
            Product.stock > 0,
            Product.stock <= LOW_STOCK_THRESHOLD,
        )
    if kova == "kritik":
        # `tukendi` + `azalan` birleşimi; dashboard kartının saydığı kümenin
        # ta kendisi.
        return and_(satista_fiziksel(), Product.stock <= LOW_STOCK_THRESHOLD)
    if kova == "var":
        return and_(
            Product.status == ProductStatus.ACTIVE.value,
            or_(
                Product.kind == ProductKind.DIGITAL.value,
                Product.stock > LOW_STOCK_THRESHOLD,
            ),
        )
    raise ValueError(f"bilinmeyen stok kovası: {kova}")


def stock_bucket(stock: int | None) -> str:
    """Bir stok değerini panelin üç kovasından birine yerleştirir.

    ``None`` → ``"var"``: dijital üründe stok kavramı yoktur ve tükenmez.
    0 yazmak "Tükendi" demek olurdu ki yanlıştır.

    Kovalar filtre değerleriyle (``?stok=``) aynı adları taşır: ekrandaki
    seçim, sunucudaki dal ve buradaki sınıflandırma tek bir sözlükten okunur.
    """
    if stock is None:
        return "var"
    if stock <= 0:
        return "tukendi"
    if stock <= LOW_STOCK_THRESHOLD:
        return "azalan"
    return "var"


# ═══════════════════ Satılabilirlik (tedarikçi dahil) ═══════════════════
#
# Sözleşme: `docs/tedarikci-senkron-sozlesme.md` D-2.
#
# ## Neden SQL ve Python ikizi AYNI dosyada
#
# Katalog araması kararı SQL'de verir (pencere fonksiyonuyla grup kartı),
# detay ve tekil listelemeler Python'da (`_in_stock`). İkisi ayrı dosyalara
# dağılsaydı biri güncellenip diğeri unutulurdu ve sonuç şudur: **liste
# "stokta" der, detay "tükendi" der** — ikisi de hata vermez. Bu projede bir
# kez yaşandı; ikizler o yüzden yan yana duruyor ve aynı testte ölçülüyor.
#
# ## Eşik neden `>= 1`
#
# Tedarikçi stoğu satış birimi cinsinden ve KESİRLİ olabilir (ölçümde 12.5
# düzine). 0,5 düzine "yarım paket" demektir ve sipariş karşılanamaz. `> 0`
# yazmak, karşılanamayacak siparişi kabul etmektir.


def _tedarikci_stok_var():
    """Ürüne bağlı, favoride, etkin tedarikçide **en az bir birim** var mı?"""
    return exists().where(
        SupplierProduct.product_id == Product.id,
        SupplierProduct.is_favorite.is_(True),
        SupplierProduct.stock_qty >= 1,
        Supplier.id == SupplierProduct.supplier_id,
        Supplier.is_enabled.is_(True),
        Supplier.deleted_at.is_(None),
    )


def tedarikci_temin_yuklemi():
    """"Kendi stoğum yok ama tedarikçiden getirebilirim" hâli (SQL).

    `supplier_backed` yöneticinin AÇIK kararıdır; bağın kurulmuş olması tek
    başına satışa yetmez. Tedarikçi kaydı kapalıysa veri BAYATTIR ve bayat
    stoğa güvenip satmak, karşılayamayacağımız sipariş almaktır.
    """
    return and_(
        Product.supplier_backed.is_(True),
        _tedarikci_stok_var(),
    )


def satilabilir_yuklemi():
    """Vitrinin "stokta" yüklemi (SQL) — `_in_stock`'un ikizi."""
    return or_(
        Product.kind == ProductKind.DIGITAL.value,
        Product.stock > 0,
        tedarikci_temin_yuklemi(),
    )


def satilabilir_mi(
    kind: str,
    stock: int | None,
    *,
    supplier_backed: bool = False,
    supplier_qty: Decimal | None = None,
) -> bool:
    """`satilabilir_yuklemi`'nin Python ikizi.

    `supplier_qty` çağıranın TEK sorguda topladığı değerdir
    (`supplier_sync_service.availability_map`); burada lazy-load YOKTUR —
    async oturumda ilişki gezmek `MissingGreenlet` demektir.
    """
    if kind == ProductKind.DIGITAL.value:
        return True
    if (stock or 0) > 0:
        return True
    if not supplier_backed or supplier_qty is None:
        return False
    return int(supplier_qty) >= 1


def karsilanma_kaynagi(
    kind: str,
    stock: int | None,
    *,
    supplier_backed: bool = False,
    supplier_qty: Decimal | None = None,
) -> str:
    """Müşteriye GÜVENLE söylenebilecek karşılanma bilgisi.

    "Bizde var" ile "tedarikçiden getirilir" teslim süresi açısından farklı
    sözlerdir; ikincisini gizlemek, tutulamayacak bir söz vermektir. Maliyet
    ve tedarikçi kimliği ise public yanıta ASLA girmez (D-6) — bu alan yalnız
    dört değerden birini taşır.
    """
    if kind == ProductKind.DIGITAL.value:
        return "DIGITAL"
    if (stock or 0) > 0:
        return "OWN"
    if satilabilir_mi(
        kind, stock, supplier_backed=supplier_backed, supplier_qty=supplier_qty
    ):
        return "SUPPLIER"
    return "NONE"
