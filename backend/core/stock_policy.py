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

from sqlalchemy import and_, or_

from models.store import Product, ProductKind, ProductStatus

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
