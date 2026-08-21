# Tedarikçi Senkronu (Yıldırım B2B) — Davranış Sözleşmesi

> Bu dosya paketin **karar kaydıdır**. Testler buradaki maddeleri ölçer; madde
> değişmeden test değişmez (kök `CLAUDE.md` → *Test Kalitesi ve Doğrulama
> Standardı* § D/J).

Kaynak ölçüm: `yildirim-b2b-rapor(1).md` (18 Ağustos 2026), cari 120.01.01.1184.

---

## 1. Amaç ve kapsam

Yıldırım Dağıtım bayi panelindeki (`b2b.yildirimdagitim.com/api/vitrin`, Keep2B)
**favori** ürünlerin stok ve maliyet verisi düzenli aralıklarla çekilir; mağaza
ürünlerine bağlanır; vitrindeki "stokta / tükendi" bilgisi tedarikçi stoğunu da
hesaba katar.

**Kapsam dışı (bilinçli):** favoriden ürün taslağı üretme · görsel indirme ·
Yıldırım'a sipariş verme · birim→adet dönüşümü · tedarikçi stoğunun
rezervasyonu. Bunlar Faz 2'dir; veri modeli hepsine kapı bırakır.

---

## 2. Değişmezler (invariants)

| # | Kural | Nerede korunur |
|---|---|---|
| **D-1** | Yıldırım stoğu `products.stock`'a **ASLA** yazılmaz. `products.stock` kendi rafımızdaki maldır; tek yazıcısı `services/stock_ledger.py`'dir. | `tests/acceptance/test_supplier_contract.py` (AST) |
| **D-2** | Vitrin uygunluğu = `DIGITAL` ∨ `stock > 0` ∨ (`supplier_backed` ∧ tedarikçi stoğu ≥ 1 ∧ favori ∧ tedarikçi etkin). Tek yüklem `core/stock_policy.py`; SQL ve Python ikizi ayrışamaz. | `test_supplier_storefront_pg.py` |
| **D-3** | Maliyet **yalnız** `kirilim[id]` içindeki `varsayilan == true` kırılımın `net` alanından hesaplanır. `fiyatlar[id].net` maliyet DEĞİLDİR (ölçümde %10,1 pahalı). | `test_supplier_pricing.py`, `test_supplier_parse.py` |
| **D-4** | Para ve stok `Decimal(str(x))` ile okunur; `float` yasaktır. `stokBakiye` kesirli olabilir → `Numeric`, `Integer` değil. | `test_supplier_contract.py` (AST), `test_supplier_parse.py` |
| **D-5** | API token'ı DB'de **şifreli** durur (`EncryptedText`), yanıtta dönmez, loglanmaz, hata metnine sızmaz. Env'de token YOKTUR. | `test_supplier_http_pg.py`, `test_supplier_client.py` |
| **D-6** | Tedarikçi maliyeti/marjı **public** yanıtlarda görünmez; yalnız admin yollarında doldurulur. | `test_supplier_storefront_pg.py` |
| **D-7** | Otomatik bağ yalnız **tek** ve **geçerli** barkod eşleşmesinde kurulur. Çoklu eşleşme bağ kurmaz, bayraklar. | `test_supplier_sync_pg.py` |
| **D-8** | Tedarikçiden karşılanan adet **deftere hiç girmez** (`qty_delta` yalnız kendi rafımızdan düşer); `order_items.supplier_quantity` o adedi taşır ve iptalde geri yükleme tavanından düşülür. | `test_supplier_order_pg.py` |
| **D-9** | Senkron sırasında **açık transaction içinde ağ beklenmez**: önce ağ, sonra DB. | `test_supplier_sync_pg.py` |
| **D-10** | Ayar değişikliği, bağlama ve çözme **gerekçeli** ve `audit_logs`'a yazılır. | `test_supplier_sync_pg.py` |
| **D-11** | Testlerde ağa çıkılmaz: `SUPPLIER_NETWORK_DISABLED` açıkken istemci ağ açmayı reddeder. | `test_supplier_client.py` |
| **D-12** | Döngü tek replikada koşar (Postgres advisory lock); elle senkron aynı kilidi ister, alamazsa 409. | `test_supplier_sync_pg.py`, `tests/test_background_jobs.py` |

---

## 3. Yetki

Yeni izinler: **`suppliers.view`** (durum, liste, eşleşmemişler) ve
**`suppliers.manage`** (ayar, token, elle senkron, bağla/çöz) — grup "Ticaret".

`products.manage` bilinçli olarak **yeniden kullanılmadı**: tedarikçi ayarı bir
**sır** (API token'ı) ve "vitrin neyi otomatik satar" kararı taşır. Ürün metnini
düzenleyen kişinin token değiştirebilmesi görev ayrılığını bozar — aynı gerekçe
`inventory.*` ve `packing.*` için de verilmişti (`core/admin_permissions.py`).

Ürün başına `supplier_backed` anahtarı bir **ürün özniteliğidir** → `products.manage`.

Rol dağıtımı: `SUPER_ADMIN` her ikisi, `COMMERCE_MANAGER` her ikisi (mağaza
operasyonunu o yürütür; token da ticaret sırrıdır).

---

## 4. Veri modeli

### `suppliers`

Sağlayıcı başına tek aktif satır (`uq_suppliers_provider_active`). Ayarlar
**DB'de** yaşar (env'de değil): kullanıcı sıklığı panelden değiştirebilmeli ve
değişiklik yeniden başlatma istememeli.

Devre kesici (`consecutive_failures`, `cooldown_until`) da DB'dedir —
`core/routing._State`'in süreç-içi kesicisinden farklı olarak burada durum
**panelde görünmek** ve replikalar arası paylaşılmak zorundadır.

### `supplier_products`

Yıldırım kataloğunun bizdeki izdüşümü. `stock_qty` **`Numeric(12,3)`**
(kesirli stok ölçüldü: 12.5). `vat_rate` **oran** (0.20), `Product.tax_rate` ile
aynı birim. `product_id` FK **`ON DELETE SET NULL`** — `db_guard.purge_products`
ürünleri fiziksel siliyor, `RESTRICT` test izolasyonunu kırardı.

Karantina bayrakları (rapor §3.1 + bizim eklediklerimiz):
`KIRILIM_YOK` · `SIFIR_FIYAT` · `DOVIZ_TL_DEGIL` · `KDV_SIFIR_SUPHELI` ·
`NET_TABANDAN_YUKSEK` · `BARKOD_BOZUK` · `BARKOD_YOK` · `BIRIM_ADET_DEGIL` ·
`GORSEL_YOK` · `COKLU_ESLESME` · `URUN_ZATEN_BAGLI` · `FAVORI_DISI`.

### `products.supplier_backed`

**Product'ta yaşar**, bağ tablosunda değil. Gerekçe: (1) merchandising kararıdır,
bağ çözülüp yeniden kurulunca kaybolmamalı; (2) "temin açık ama bağlantı yok"
uyarısı ancak böyle ifade edilebilir; (3) vitrin SQL'inde planlayıcıya kısa devre
verir; (4) `stock` sözleşmesine dokunmaz.

### `order_items.supplier_quantity`

Ödeme anında, ürün satırı **kilitliyken** hesaplanan "tedarikçiden karşılanacak
adet". Bu kolon olmadan iptalde `_restock` hiç satılmamış malı rafa ekler.

---

## 5. Senkron algoritması

| Döngü | Sorgu | Varsayılan sıklık | Alt sınır |
|---|---|---|---|
| Stok | `GET /favoriler/urunler` (1 istek) | 60 sn | 30 sn |
| Fiyat | `POST /fiyat` (100'lük batch) | 6 saat | 1 saat |
| Token | `POST /oturum/yenile` | vade < 7 gün, günde 1 | — |

Ağ disiplini (rapor §2.11): istekler arası **800 ms**; 502/503/504/429 için
**2 → 4 → 8 → 16 sn** backoff, 4 deneme; **400 kalıcı**, retry yok; JSON olmayan
yanıt (Cloudflare HTML) ayrı hata sınıfı.

Hata sonrası **üstel cooldown**: `min(30 sn × 2^n, 30 dk)`. 60 saniyelik stok
aralığı, origin 502 verirken onu dövmemeli.

Otomatik bağlama: `product_id IS NULL ∧ is_favorite ∧ barcode_valid` satırları
için `products` içinde `barcode = X OR replace(isbn,'-','') = X`; **tam bir**
eşleşme ve ürün başka bir satıra bağlı değilse `AUTO`.

---

## 6. Sipariş akışı (Faz 1)

Kural: tedarikçiden karşılanan adet rafa uğramaz, doğrudan pakete gider.

1. Sepet doğrulaması: `kullanılabilir = max(stock,0) + floor(tedarikçi stoğu)`
   (yalnız `supplier_backed` ise).
2. Ödeme (`_finalize_paid`, kilit altında): `kendi_eksik = max(0, qty − max(stock,0))`.
   Eksik tedarikçiyle kapanmıyorsa **mevcut** `_out_of_stock_refund` yolu aynen.
3. `SALE` hareketi yalnız kendi payı için (`qty_delta = −(qty − kendi_eksik)`);
   kendi payı 0 ise hareket yazılmaz. `item.supplier_quantity = kendi_eksik`.
4. İptal/tam iade: geri yüklenecek tavan `qty − supplier_quantity − geri_yüklenen`.
5. Fiziksel iade (`_restock_items`) **değişmez** — iade edilen mal rafa girer.

**Kabul edilen risk (Faz 1):** tedarikçi stoğu rezerve edilmez; iki sipariş aynı
son adedi görebilir. Faz 2 satın alma kuyruğu bunu yönetir.

---

## 7. Test matrisi

| Sınıf | Dosya | Neyi kanıtlar |
|---|---|---|
| Saf birim | `tests/test_supplier_parse.py` | Gerçek yanıt şekli → dataclass; kesirli stok; varsayılan kırılım |
| Saf birim | `tests/test_supplier_pricing.py` | Maliyet/marj matematiği, karantina bayrakları |
| Saf birim | `tests/test_supplier_barcode.py` | EAN-8/13, UPC-A, ITF-14 checksum |
| Gerçek HTTP (MockTransport) | `tests/test_supplier_client.py` | Backoff, aralık, başlık, token sızmaması, ağ guard'ı |
| AST sözleşmesi | `tests/acceptance/test_supplier_contract.py` | D-1, D-4 (düşük güçlü — yanında davranış testi var) |
| Şifreli kolon | `tests/acceptance/test_encrypted_column_widths.py` | Token kolonu şişmeyi taşır |
| Gerçek PG | `tests/integration/test_supplier_migration_pg.py` | CHECK/unique/seed gerçekten var |
| Gerçek PG | `tests/integration/test_supplier_sync_pg.py` | Upsert, auto-link, batch, hata/cooldown, audit, kilit |
| Gerçek PG | `tests/integration/test_supplier_storefront_pg.py` | D-2, D-6, varyant grubu |
| Gerçek PG | `tests/integration/test_supplier_order_pg.py` | D-8, iade akışı bozulmuyor |
| Gerçek PG | `tests/integration/test_supplier_back_in_stock_pg.py` | Abonelere bildirim |
| Gerçek HTTP + PG | `tests/integration/test_supplier_http_pg.py` | 401/403/200, token at-rest, 409/400 |
| Gerçek DOM | `frontend/src/components/admin/store/SupplierPanel.test.tsx` | Panelin kullanıcıya değen davranışı |
| Gerçek istek | `frontend/src/api/suppliers.test.ts` | Gönderilen payload |

### Mutasyon provası (S1–S8)

| # | Mutasyon | Yakalayan test |
|---|---|---|
| S1 | Yüklemden `supplier_backed` koşulunu kaldır | storefront |
| S2 | `stock_qty >= 1` → `> 0` | storefront (kesirli) |
| S3 | Hata metni redaksiyonunu kaldır | sync (token sızıntısı) |
| S4 | PATCH'ten `suppliers.manage` kaldır | http (izin) |
| S5 | `_finalize_paid` tedarikçi kapsamasını kaldır | order (iade) |
| S6 | `_restock` tavanından `supplier_quantity` çıkar | order (iptal) |
| S7 | Varsayılan kırılım yerine `fiyatlar[id].net` | pricing |
| S8 | Link payload'ından `reason` düşür | frontend api |

---

## 8. Bilinen açıklar

1. Rapor `GET /favoriler/urunler` için auth'u çelişkili yazıyor (§2.3 evet /
   §2.10 hayır). Karar: Bearer **hep** gönderilir; 401/403 → `SupplierAuthError`.
2. Cloudflare kalıcı challenge (cf_clearance) çözülmez; panelde görünür.
3. Birim ≠ Adet (Düzine/Paket/Set) ürünlerde stok ve maliyet o birim cinsindendir.
   Bayrak konur, dönüşüm yapılmaz.
4. `FIELD_ENCRYPTION_KEY` rotasyonu token'ı çözülemez kılar → yeniden yapıştırma.
