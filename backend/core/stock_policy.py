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
