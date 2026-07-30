# Stok Hareket Defteri + SKU — Uygulama Planı

**Dal:** `stok-hareket-defteri` · **Durum:** onay bekliyor, kod yazılmadı
**Hedef:** `products.stock` alanını **açıklanabilir** (her değişimin sebebi ve sahibi kayıtlı), **denetlenebilir** (geçmiş değiştirilemez ve tutar) ve **eşzamanlı işlemlerde güvenilir** (yarış hâlinde sayı kaybolmaz) hâle getirmek.

> Bu paket PK yol haritasının parçası **değildir**. PK-2 (iyzico Pazaryeri) hâricî cevapları beklerken bağımsız olarak ilerler; ödeme/hukuk katmanına hiç dokunmaz.

---

## 1. Bugünkü durum — stok mutasyonlarının tam envanteri

Aşağıdaki tablo `backend/` altındaki **tüm** `.stock` erişimlerinin taranmasıyla çıkarıldı (6 yazma + 8 okuma noktası). Yazma noktalarının hepsi tek tek okundu; kilit ve atomiklik davranışı satır satır doğrulandı.

### 1a. Yazma noktaları (stoğu değiştiren 6 yer)

| # | Konum | Ne yapıyor | Kilit / atomiklik | İz bırakıyor mu |
|---|---|---|---|---|
| **W1** | `services/order_service.py:687-688` (`_finalize_paid`) | Ödeme PAID olunca fiziksel kalem başına `p.stock = max(0, p.stock - item.quantity)` | ✅ Öncesinde `:606-613` her ürün için `SELECT ... FOR UPDATE` → `locked` dict; ardından `:632` `escrow.claim(from_statuses=["PENDING","FAILED"])` ile **tek transaction kazanır** | ❌ Hayır |
| **W2** | `services/order_service.py:1178-1179` (`_restock`) | İptal / tam iadede `p.stock += item.quantity` | ✅ Satır başına `FOR UPDATE` (`:1174`) | ❌ Hayır |
| **W3** | `services/order_service.py:1573-1574` (`_restock_items`) | Kısmi iade kabulünde yalnız `ret.items` için `p.stock += ri.quantity` | ✅ Satır başına `FOR UPDATE` | ❌ Hayır |
| **W4** | `services/store_service.py:558` (`create_product`) | Yeni üründe ilk stok (`payload.stock`, yalnız PHYSICAL) | — (yeni satır) | ❌ Hayır |
| **W5** | `services/store_service.py:652` (`bulk_import_products`) | CSV satırından ilk stok (`_int("stock")`, yalnız PHYSICAL) | Satır başına savepoint | ❌ Hayır |
| **W6** | `services/store_service.py:755` + `:742` + `:781` (`update_product`) | Admin **doğrudan** stok yazar: `editable.append("stock")` → `setattr`; `old_stock` yalnız 0→>0 stok bildirimi için okunur | ❌ **Kilit YOK** — `_load_full` `FOR UPDATE` kullanmıyor | ❌ Hayır (aynı fonksiyon **fiyat** değişimini `ProductPriceHistory`'ye yazıyor; stok için karşılığı yok) |

**W1 çağrı zinciri:** `_finalize_paid` ← ödeme callback'i (idempotent) ve escrow reconciler.
**W2 çağrı zinciri:** `_restock` ← `_refund_payment` (`:1207`) ← sipariş iptali (`:1231`) ve tam iade (`:1259`).
**W3 çağrı zinciri:** `_restock_items` ← `_settle_return` (`:1631`).

### 1b. Bilinçli olarak stok yazmayan yerler (doğru davranış, korunacak)

| Konum | Neden yazmıyor |
|---|---|
| `order_service.py:719-741` (`_out_of_stock_refund`) | Oversell tazmini. PAID **claim edilmediği** için düşüm de hiç olmadı → geri yükleme yapılmaması doğru. |
| `services/delivery_service.py` (0 eşleşme) | Teslim edilemeyen sipariş PAID'e döner, mal hâlâ tahsis edilmiştir; stok geri yüklenmez. Doğru. |

### 1c. Okuma noktaları (davranış değişmeyecek)

`order_service.py:278` (sepet doğrulama) · `order_service.py:618` (kilit altında oversell guard'ı) · `store_service.py:137` (`in_stock`) · `:399` (arama filtresi `stock > 0`) · `:486` (şema projeksiyonu) · `:687` (`delete_product` guard'ı: stok varken silinmez) · `services/admin_service.py:170` (`Product.stock <= 5` düşük stok sayacı).

### 1d. Envanterin gösterdiği somut boşluklar

1. **Hiçbir yazma noktası iz bırakmıyor.** "Bu kitabın stoğu neden 3?" sorusunun cevabı yok. Aynı fonksiyon (`update_product`) fiyat için `ProductPriceHistory` yazıyor — stok için yazmıyor.
2. **W6 kilitsiz ve delta değil, mutlak atama.** Admin `stock=50` yazarken eşzamanlı bir PAID 2 adet düşürürse, admin'in `setattr`'ı düşümü **ezer**. Kayıp sessizdir; bugün tespit edilemez.
3. **W1'deki `max(0, ...)` oversell'i sessizce yutuyor.** Guard'ı aşan bir durumda stok 0'a çekilir, kimse haberdar olmaz.
4. **Kilit sırası sabit değil.** `:607` `for pid in needed` — sıra `order.items` sırasıdır. Ürünleri ters sırada içeren iki eşzamanlı sipariş **deadlock** üretebilir.
5. **Barkod/SKU yok.** `products` tablosunda `sku` ve `barcode` sıfır eşleşme; tek kimlik `isbn` (`models/store.py:231`, `String(20)`, **unique değil**) ve `slug`.
6. **Çift işlemi engelleyen DB kısıtı yok.** W1 için `escrow.claim` atomikliği var; W2/W3 için hiçbir şey yok — `_refund_payment` iki yoldan çağrılabiliyor (`:1231`, `:1259`).

### 1e. Mevcut veri (canlı dev DB, 30 Tem 2026)

| kind | ürün | isbn dolu | tekil isbn | stock NULL | stock=0 |
|---|---|---|---|---|---|
| PHYSICAL | 6 | 4 | 4 | 0 | 0 |
| DIGITAL | 1 | 0 | — | 1 | — |

Tekrarlanan ISBN grubu: **0**. Backfill riski düşük; yine de kod tarafında tekrar ISBN kontrolü yapılacak (bkz. §6).
Alembic tek head: **`2df064134f6c`**.

---

## 2. Kapsam

**İçinde:** `products.sku` (benzersiz, insan tarafından okunabilir) · opsiyonel `products.barcode` · append-only `stock_movements` tablosu · tek yazma noktası `services/stock_ledger.py` · 6 mutasyon noktasının deftere taşınması · W6 kilit düzeltmesi + kilit sırası · açılış bakiyesi migration'ı · admin ürün bazlı hareket geçmişi ekranı + gerekçeli stok düzenleme · defter tutarlılık doğrulaması · test matrisi + guard mutasyon provası.

**Dışında (kullanıcı direktifi):** `CountSession`/`CountLine` (sayım), hasarlı stok konumu, paketleme QR FSM'i, çoklu depo, lot/seri, FIFO maliyetlendirme, dış kargo entegrasyonu. Sayım, hasarlı stok ve paketleme **ekranları** da dâhil değil.

**Ayrıca bu pakette yapılmayacaklar (gerekçeli):** rezervasyon/tahsis alanları (`reserved`/`available` — Medusa/Vendure formülü; sayım gelmeden anlamsız) · periyodik defter mutabakat job'u (doğrulama **fonksiyonu** yazılır, zamanlanmış koşum yazılmaz) · satın alma / mal kabul · maliyet (COGS) · barkod **tarama** arayüzü (paketleme FSM'iyle birlikte gelir; bu pakette yalnız çözümleme fonksiyonu testlenir) · SKU'nun paket etiketi çıktısına eklenmesi · `inventory.*` izin kodları (bkz. Karar 4) · ürün varyantı.

---

## 3. Veri modeli

### 3a. `products.sku` — format ve üretim

```python
sku: Mapped[str] = mapped_column(String(20), nullable=False)   # backfill sonrası NOT NULL
```

**Format:** `FZK-000042` (PHYSICAL) · `DIJ-000007` (DIGITAL). Gövde, `products_sku_seq` adlı Postgres sequence'ından 6 haneye sıfır dolgulu.

**Neden sıra tabanlı, ISBN tabanlı değil** (Karar 1'de alternatifi sunuluyor):
- SKU **bizim** stok kalemimizi tanımlar; ISBN bir **baskıyı** tanımlar. Aynı baskıyı iki tedarikçiden almak veya shrink'li set yapmak SKU'yu ayırmayı gerektirir, ISBN'i ayırmaz.
- SKU `NOT NULL UNIQUE` olmak zorunda; ISBN 6 üründen 2'sinde yok ve dijital üründe hiç olmayacak.
- Rafta/telefonda `FZK-000042` yazmak 13 haneli ISBN'den okunaklı ve daha az hata üretir.
- ISBN'in rolü kaybolmuyor: (i) CSV içe aktarmada tekrar tespiti (mevcut davranış, `:623-634`), (ii) ürün çözümlemede ikinci anahtar, (iii) barkod için **aday değer** (otomatik yazılmaz — §3b).

**Üretim:** uygulama tarafında `nextval('products_sku_seq')` okunarak (`stock_ledger.next_sku(kind)`). Sequence rollback'te geri sarmadığı için **boşluk oluşabilir** — SKU bir belge numarası değildir, boşluk sorun değil (fatura numaratörünün aksine `FOR UPDATE`'li boşluksuz seri gerekmez).

**Tekillik:** `uq_products_sku_active` kısmi unique index (`WHERE deleted_at IS NULL`) — projedeki `uq_products_slug_active` deseninin aynısı.

**Yüzeyler:** admin ürün listesi + editör (salt-okunur, otomatik) · CSV şablonuna `sku` kolonu (verilmişse doğrulanır ve kullanılır, verilmemişse üretilir) · ürün detay şeması. `kind` bugün düzenlenebilir alanlar arasında **değil** (`store_service.py:753-756`), dolayısıyla önek sonradan yalan söylemez.

### 3b. `products.barcode` — ISBN'den ayrımı

```python
barcode: Mapped[str | None] = mapped_column(String(32), nullable=True)
```

Model docstring'ine **kural olarak** yazılacak ayrım:

| Alan | Neyi tanımlar | Kaynağı | Otomatik doldurulur mu |
|---|---|---|---|
| `isbn` | **Eserin/baskının** bibliyografik kimliği. Müşteriye künyede gösterilir, içe aktarmada tekrar tespitinde kullanılır. | Yayıncı / tedarikçi kataloğu | — |
| `barcode` | **Elimizdeki fiziksel kalemin üzerinde okunan** dizgi (EAN-13/UPC vb.). Depoda okutulan şey budur. | Kalemin fiziksel üzerinden okuma | ❌ **ISBN'den asla otomatik kopyalanmaz** |

Neden birbirinin yerine geçmez: (i) kitap olmayan fiziksel ürünün (kalem, defter) EAN'ı var, ISBN'i yok; (ii) set/paket ürününün kendi barkodu vardır, içindeki kitapların ISBN'lerinden farklıdır; (iii) ISBN-10 basımlarda kapaktaki barkod ISBN'in EAN-13 dönüşümüdür, ISBN alanındaki dizginin kendisi değildir; (iv) bazı yayıncı baskıları promosyon barkodu taşır. **ISBN'i barkoda otomatik kopyalamak, "okuttum, eşleşti" güvenini yanlış bir eşleşmeye dayandırır** — bu yüzden `barcode` yalnız insan girdisiyle dolar.

**Tekillik:** `uq_products_barcode_active` kısmi unique index (`WHERE barcode IS NOT NULL AND deleted_at IS NULL`).

**Çözümleme sırası** (`stock_ledger.resolve_product_ref`, saf ve testli, bu pakette **arayüzü yazılmaz**): `barcode` tam eşleşme → `sku` tam eşleşme → `isbn` tam eşleşme. Sıra kasıtlı: elimizdeki kalemin üzerindeki dizgi, katalog kimliğinden önce gelir.

### 3c. `stock_movements` — append-only defter

```python
class StockMovementType(str, Enum):
    OPENING     = "OPENING"      # defter devreye alınırken mevcut bakiye (migration)
    INITIAL     = "INITIAL"      # ürün oluşturma / CSV içe aktarma ilk stoğu
    SALE        = "SALE"         # sipariş PAID → düşüm
    SALE_CANCEL = "SALE_CANCEL"  # iptal / tam iade → geri yükleme
    RETURN      = "RETURN"       # kısmi iade kabulü → geri yükleme
    ADJUSTMENT  = "ADJUSTMENT"   # admin elle düzeltme (gerekçe ZORUNLU)
```

| Kolon | Tip | Not |
|---|---|---|
| `id` | PK | Kronolojik sıra (monoton) |
| `product_id` | FK `products.id`, `ondelete="RESTRICT"`, NOT NULL, index | Ürün **soft-delete** edilir (`store_service.py:693`), bu yüzden RESTRICT hiç tetiklenmez; niyeti belgeler: defter yetim kalamaz |
| `qty_delta` | Integer NOT NULL | İşaretli. **Uygulanan gerçek değişim** (istenen değil — §5c) |
| `qty_after` | Integer NOT NULL | Bu hareketten **sonraki** `products.stock`. Aynı transaction'da hesaplanır (ERPNext *Stock Ledger Entry* deseni) |
| `movement_type` | String(20) NOT NULL | Yukarıdaki enum |
| `reason_code` | String(30) NULL | `ADJUSTMENT`'ta **zorunlu**: `SAYIM_FARKI` · `HASAR` · `KAYIP` · `HATALI_GIRIS` · `TEDARIK` · `DIGER`. Sistem tiplerinde sabit (`OVERSELL_CLAMP` dâhil) |
| `ref_type` | String(20) NULL | `order` · `order_return` · `product` · `migration` |
| `ref_id` | Integer NULL | Polimorfik → FK yok, `(ref_type, ref_id)` index'i var |
| `actor_type` | String(10) NOT NULL | `ADMIN` \| `SYSTEM` |
| `actor_admin_id` | Integer NULL | **FK yok** — `audit_logs.actor_id` deseninin aynısı; §3d'deki trigger'ın FK `SET NULL` UPDATE'iyle çakışmaması için de gerekli |
| `note` | Text NULL | `DIGER` gerekçesinde zorunlu; oversell clamp'inde otomatik doldurulur |
| `request_id` | String(64) NULL | `core/observability` bağlamından; `audit_logs.request_id` ile korelasyon |
| `created_at` | DateTime(tz) NOT NULL | `server_default=func.now()` |

**`deleted_at` YOK** — bilinçli. Projenin soft-delete konvansiyonundan sapma; gerekçe model docstring'ine yazılır: soft-delete edilebilen bir defter satırı, gizlenebilir bir defter satırıdır (`audit_logs` ile aynı duruş).

**CHECK kısıtları:**
```sql
ck_stock_movements_delta      CHECK (qty_delta <> 0 OR movement_type = 'OPENING')
ck_stock_movements_after      CHECK (qty_after >= 0)
ck_stock_movements_reason     CHECK (movement_type <> 'ADJUSTMENT' OR reason_code IS NOT NULL)
ck_stock_movements_actor      CHECK (actor_type <> 'ADMIN' OR actor_admin_id IS NOT NULL)
ck_stock_movements_ref        CHECK (movement_type NOT IN ('SALE','SALE_CANCEL','RETURN')
                                    OR (ref_type IS NOT NULL AND ref_id IS NOT NULL))
```
`OPENING` için `qty_delta = 0`'a izin verilmesinin sebebi: **stoğu 0 olan ürün de açılış satırı almalı**, yoksa zincirin tabanı olmaz. (Bugün 0 stoklu fiziksel ürün yok; kural gelecek için.)

**Index'ler:**
```
ix_stock_movements_product   (product_id, created_at DESC, id DESC)   -- geçmiş ekranı + tarih filtresi
ix_stock_movements_ref       (ref_type, ref_id)                       -- "bu siparişin stok etkisi"
uq_stock_movements_ref_once  UNIQUE (movement_type, ref_type, ref_id, product_id)
                             WHERE ref_id IS NOT NULL                 -- çift uygulama kalkanı
```
`uq_stock_movements_ref_once`, `ADJUSTMENT` ve `OPENING`'i kapsamaz (ikisinde de `ref_id` NULL) — admin aynı ürünü istediği kadar düzeltebilir. `SALE`/`SALE_CANCEL`/`RETURN`/`INITIAL` ise mantıksal olarak **referans başına bir kez** olur; index bunu DB'de zorlar.

**Ürün başına toplama:** bir siparişte aynı ürün iki satırda geçebileceği için (`_finalize_paid` bugün satır satır düşüyor) defter **ürün başına toplanmış tek satır** yazar (`qty_delta = -(o üründen toplam adet)`). Bu hem `uq_stock_movements_ref_once`'ı mümkün kılar hem de defteri okunur tutar. Mevcut `needed` sözlüğü (`:604-605`) zaten bu toplamayı yapıyor.

### 3d. Değiştirilemezlik nasıl zorlanır

İki katman:

1. **Sözleşme:** UPDATE/DELETE ucu yazılmaz; servis yalnız `insert` yapar. `audit_logs` (`models/audit_log.py:17`) ve `dispute_evidence` planıyla aynı duruş.
2. **DB trigger'ı** (Karar 3'te onaya sunuluyor, önerim: **evet**):
```sql
CREATE FUNCTION stock_movements_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'stock_movements append-only tablodur: % engellendi', TG_OP; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_stock_movements_no_update BEFORE UPDATE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION stock_movements_immutable();
CREATE TRIGGER trg_stock_movements_no_delete BEFORE DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION stock_movements_immutable();
CREATE TRIGGER trg_stock_movements_no_truncate BEFORE TRUNCATE ON stock_movements
  FOR EACH STATEMENT EXECUTE FUNCTION stock_movements_immutable();
```
Projede trigger deseni yok; sapmanın gerekçesi: **bu trigger iş mantığı taşımıyor**, yalnız bir değişmezliği zorluyor (ekspertiz planı §8d'de trigger'ın reddedildiği yer *iki tablo arasında iş mantığı senkronizasyonu*ydu — burası o değil). `actor_admin_id`'nin FK'sız tutulmasının ikinci sebebi de bu: admin satırı fiziksel silinse `ON DELETE SET NULL` bir UPDATE olurdu ve trigger'a çarpardı.

**Kaçış kapısı yoktur** (`current_setting` tabanlı bypass **bilinçli olarak eklenmiyor** — uygulamanın yanlışlıkla açabileceği bir arka kapı, korumanın kendisini değersizleştirir). Test temizliği için `assert_test_database()` (mevcut `tests/integration/db_guard.py`) ile kapılı, **yalnız test** fixture'ı `ALTER TABLE ... DISABLE TRIGGER USER` kullanır. Bunun yan etkisi kabul ediliyor ve bir disipline dönüştürülüyor: entegrasyon testleri **mutlak satır sayısı değil delta** doğrular (outbox/dispatch testlerinde öğrenilen ders).

Sonuç: ileride `stock_movements` üzerinde UPDATE gerektiren bir migration yazılırsa **açıkça** trigger'ı devre dışı bırakmak zorunda kalır. İstenen davranış bu.

---

## 4. Servis katmanı — tek yazma noktası

Yeni dosya `backend/services/stock_ledger.py`. **`products.stock`'a doğrudan atama yapan tek dosya burası olacak.**

```python
async def apply_movement(
    db, product_id: int, *, qty_delta: int, movement_type: StockMovementType,
    reason_code: str | None = None, ref_type: str | None = None, ref_id: int | None = None,
    actor_type: str = "SYSTEM", actor_admin_id: int | None = None,
    note: str | None = None, allow_negative: bool = False,
) -> StockMovement | None
```

Davranış (tek transaction, çağıranın transaction'ı içinde — **kendi `commit`'ini atmaz**):

1. `SELECT ... FROM products WHERE id = :id FOR UPDATE`. Çağıran satırı zaten kilitlemişse aynı transaction içinde yeniden kilitlemek **no-op**'tur (yeniden girişli) → fonksiyon yanlış çağrılamaz, kilit kurulumu çağırana bırakılmaz.
2. `product.stock IS NULL` ise (dijital ürün, veya stok takibi olmayan fiziksel ürün) hareket **yazılmaz**, `None` döner, `logger.warning`. Defter yalnız bakiyesi bilinen ürünler için tutulur.
3. `qty_delta == 0` ve tip `OPENING` değilse `None` döner (gürültü satırı yazılmaz — örn. admin stoğu aynı değerle kaydetti).
4. Hedef bakiye `product.stock + qty_delta`; negatif çıkarsa ve `allow_negative=False` ise **clamp** uygulanır: `qty_delta` gerçekten uygulanan değere (`-product.stock`) düşürülür, `reason_code="OVERSELL_CLAMP"`, `note` otomatik doldurulur (`istenen X, uygulanan Y`), `logger.error` + admin bildirimi. Defter değişmezi (`qty_after == önceki + qty_delta`) böylece **hiçbir koşulda** bozulmaz; sapma da sessiz kalmaz.
5. `INSERT INTO stock_movements ... ON CONFLICT DO NOTHING RETURNING id`.
   - Satır dönmediyse (aynı referansla hareket zaten var) → **`products.stock`'a dokunulmaz**, `None` döner, `logger.info`. Ürün satırı kilitli olduğu için bu kontrol yarışa kapalıdır. Çift uygulama böylece hem engellenir hem de akışı 409 ile patlatmaz.
   - Satır döndüyse → `product.stock = qty_after`.
6. Dönen `StockMovement`.

**Saf (DB'siz, testlenebilir) yardımcılar aynı modülde:** `next_sku_body(seq_value)` / `sku_prefix(kind)` · `clamp_delta(current, requested)` · `reason_required(movement_type, reason_code, note)` · `resolve_product_ref(...)` sorgu üreteci · `verify_chain(rows, current_stock)` → `(tutarlı: bool, ilk_sapma_id: int | None)`.

**Doğrulama fonksiyonu:** `verify_ledger(db, product_id)` → son `qty_after` ile `products.stock` karşılaştırması + zincir sürekliliği (`qty_after[i] == qty_after[i-1] + qty_delta[i]`). Admin ucundan ve testlerden çağrılır. **Zamanlanmış mutabakat job'u bu pakette yazılmaz** (kapsam dışı).

### 4a. Çağrı yerlerinin taşınması

| # | Bugün | Yeni çağrı |
|---|---|---|
| W1 | `order_service.py:687-688` | `sorted(needed)` sırasıyla ürün başına tek `apply_movement(qty_delta=-toplam, movement_type=SALE, ref_type="order", ref_id=order.id, actor_type="SYSTEM")`. `max(0, ...)` kalkar — clamp artık deftere kaydedilerek yapılır. |
| W2 | `order_service.py:1178-1179` | Ürün başına toplanmış `SALE_CANCEL`, `ref=("order", order.id)`, `sorted` |
| W3 | `order_service.py:1573-1574` | Ürün başına toplanmış `RETURN`, `ref=("order_return", ret.id)`, `sorted` |
| W4 | `store_service.py:558` | Ürün `flush` edildikten sonra `INITIAL`, `ref=("product", p.id)`, `actor_type="ADMIN"`, `actor_admin_id=admin.id` |
| W5 | `store_service.py:652` | Aynı savepoint içinde `INITIAL`, `note="CSV içe aktarma"` |
| W6 | `store_service.py:742/755/781` | `stock` payload'da ise: ürün satırı **`FOR UPDATE` ile kilitlenir**, `stock` `editable` listesinden çıkarılır, yeni değer `apply_movement(qty_delta = yeni - eski, ADJUSTMENT, reason_code, note, actor=ADMIN)` üzerinden uygulanır. `_notify_back_in_stock` tetikleyicisi (0→>0) **korunur** — artık `movement.qty_after` üzerinden. |

### 4b. Şema / API değişikliği (W6'nın gerektirdiği)

`ProductUpdate`'e iki alan: `stock_reason_code: str | None`, `stock_note: str | None`.
Kural: `stock` payload'da **ve** mevcut değerden farklıysa `stock_reason_code` zorunlu (yoksa 422/400); `DIGER` seçildiyse `stock_note` da zorunlu. `stock` gönderilmemişse veya değer aynıysa gerekçe istenmez. Bu, "açıklanabilirlik" hedefinin kullanıcıya değen kısmıdır: **stok artık gerekçesiz değişmez.**

### 4c. Düzeltilen iki mevcut hata (kapsam içi, kanıtlı)

1. **W6 kayıp düşüm** (`store_service.py:742-757`): kilit yok + mutlak atama → eşzamanlı satış düşümü eziliyor. Düzeltme: `FOR UPDATE` + delta tabanlı yazım. Defter olmadan bu hatanın **tespiti** de mümkün değildi.
2. **Kilit sırası** (`order_service.py:607`, `:1172`, `:1567`): `product_id`'ye göre `sorted` → çapraz ürünlü eşzamanlı siparişlerde deadlock kalkar.

Bu iki düzeltme pakete dâhil çünkü ikisi de **defterin doğruluğunun ön koşulu**; ayrı pakete bırakılırsa defter ilk günden yanlış sayı kaydeder.

### 4d. Regresyon kalkanı — AST envanter testi

PK-1'de işe yarayan desen (`test_payment_gate_wiring.py`) burada da kullanılacak: `backend/tests/acceptance/test_stock_ledger_contract.py`, `services/*.py` ve `api/routers/*.py` dosyalarını **AST ile** tarayıp `stock` niteliğine yapılan **atamaları** (`Attribute(attr="stock")` hedefli `Assign`/`AugAssign`) toplar ve izin verilen tek yerin `services/stock_ledger.py` olduğunu doğrular. Yeni bir doğrudan mutasyon eklenirse test kırılır — "unuttum" hâli sessiz kalmaz.

---

## 5. Failure senaryoları

| # | Senaryo | Bugün | Plandan sonra |
|---|---|---|---|
| F1 | İki eşzamanlı ödeme callback'i (tarayıcı çift POST / reconciler yarışı) | `escrow.claim` tek kazananı seçer | Aynı + `uq_stock_movements_ref_once` ikinci `SALE`'i emer (`ON CONFLICT DO NOTHING`, stok ikinci kez düşmez) |
| F2 | Admin stok düzenlemesi ⟂ eşzamanlı PAID düşümü | **Düşüm sessizce kaybolur** | Satır kilidi + delta yazımı → ikisi de uygulanır, ikisi de deftere düşer |
| F3 | Aynı üründen iki sipariş satırı | İki ayrı düşüm | Ürün başına toplanmış tek `SALE` satırı |
| F4 | Guard'ı aşan oversell | `max(0, ...)` sessiz | Clamp + `qty_delta` gerçek değer + `OVERSELL_CLAMP` + ERROR log + admin bildirimi |
| F5 | `stock IS NULL` fiziksel ürün | Düşüm atlanır (sessiz) | Hareket yazılmaz + WARNING; zincir tutarlılığı bozulmaz |
| F6 | Dijital ürün | Dokunulmaz | Aynı (hareket üretilmez) |
| F7 | `_refund_payment` iki yoldan iki kez tetiklenirse (`:1231`/`:1259`) | **Çift geri yükleme** mümkün | Unique index + `ON CONFLICT` emer; log'a düşer |
| F8 | Aynı `OrderReturn` iki kez settle edilirse | Çift geri yükleme | `ref=("order_return", ret.id)` tekil → emilir |
| F9 | Defter INSERT'i patlarsa (CHECK ihlali, bağlantı) | — | Transaction tamamen geri alınır → **stok da değişmez**. Ödeme tamamlama hata döner, mevcut reconciler tekrar dener. Tutarlılık, erişilebilirliğin önünde (bilinçli; §8) |
| F10 | Migration yarıda kalırsa | — | Alembic tek transaction → ya hep ya hiç |
| F11 | Ürün soft-delete edilip yeniden stoklanırsa | — | Hareketler kalır, `sku` değişmez, zincir devam eder |
| F12 | `products.stock` DB'den elle değiştirilirse | Tespit edilemez | `verify_ledger` sapmayı raporlar (engelleme değil, **tespit**) |
| F13 | Defter satırını UPDATE/DELETE denemesi | — | Trigger exception (Karar 3 onaylanırsa) |
| F14 | Çapraz ürünlü iki eşzamanlı sipariş | Deadlock mümkün | `sorted(product_id)` |
| F15 | SKU sequence boşluğu (rollback) | — | Kabul; SKU belge numarası değil |
| F16 | İçe aktarmada aynı SKU iki satırda | — | Kısmi unique index → o satır `errors[]`'a düşer (mevcut savepoint deseni), diğerleri devam eder |

---

## 6. Migration ve backfill

**Tek revizyon:** `stok_hareket_defteri_sku`, `down_revision = "2df064134f6c"`.

**Upgrade adımları:**
1. `CREATE SEQUENCE products_sku_seq`.
2. `products.sku` (nullable) + `products.barcode` kolonları.
3. **Backfill — SKU:** `deleted_at`'e bakılmaksızın **tüm** ürünler, `ORDER BY (isbn IS NULL), isbn, id` deterministik sırasıyla `nextval` alır. Sıranın ISBN'i öne almasının sebebi: içe aktarılmış katalog kayıtları (kalıcı kimliği olanlar) düşük numaraları alır, elle açılmış tek kayıtlar sona kalır → numaralar kataloğun yaşıyla anlamlı biçimde artar. Ayrıca sıra deterministik olduğu için **downgrade + upgrade aynı SKU'ları üretir** (test edilecek).
4. **Tekrarlanan ISBN kontrolü:** aynı aktif ISBN'e sahip birden çok ürün varsa migration **durur** ve grupları listeler (bugün 0 grup var; ileride bir DB'de varsa iki farklı SKU üretip kalıcılaştırmak yerine insan kararı istenir).
5. `sku` → `NOT NULL` + `uq_products_sku_active` + `uq_products_barcode_active`.
6. `stock_movements` tablosu + 5 CHECK + 3 index.
7. Değiştirilemezlik trigger'ı (fonksiyon + 3 trigger).
8. **Backfill — açılış bakiyesi:** `stock IS NOT NULL` olan her ürün (soft-delete edilmişler dâhil — geçmişin okunabilirliği için) için bir satır:
   `movement_type='OPENING'`, `qty_delta = stock`, `qty_after = stock`, `actor_type='SYSTEM'`, `ref_type='migration'`, `ref_id=NULL`, `note='Açılış bakiyesi — stok defteri devreye alınmadan önceki mevcut'`, `created_at = now()`.
   `created_at`'in `now()` olması bilinçli (Karar 6): defterin **bilgisi** bugün başlıyor; ürünün oluşturma tarihine geri yazmak, o tarihten bugüne kadarki hareketleri biliyormuş gibi bir izlenim verirdi.
9. `verify_ledger` mantığının SQL karşılığıyla sağlık kontrolü: açılış satırı sayısı == `stock IS NOT NULL` ürün sayısı; her ürün için `MAX(qty_after) == products.stock`.

**Downgrade:** trigger'lar + `stock_movements` + iki index + iki kolon + sequence düşürülür. **Yıkıcıdır** — defter geçmişi kaybolur. Bu, tabloyu düşüren her downgrade'in doğasıdır ve belgede açıkça yazılıdır; rollback stratejisi bu yüzden downgrade'i **son seçenek** sayar (§9).

**Migration testi** (`tests/integration/test_stock_migration_pg.py`): (a) boş DB'de `upgrade head` → tablo/kısıt/trigger var; (b) tohumlanmış DB'de upgrade → açılış satırları ve zincir doğru; (c) `downgrade -1` → kolonlar/tablo yok, ürün verisi bozulmamış; (d) tekrar `upgrade` → **aynı SKU'lar** (determinizm); (e) tekrarlanan ISBN enjekte edilmiş DB'de upgrade → migration durur ve grupları bildirir.

---

## 7. Admin yüzeyi

**Backend uçları** (`api/routers/store.py` admin bölümü):

| Uç | İzin | Döner |
|---|---|---|
| `GET /admin/products/{id}/stock-movements?limit&offset&movement_type&from&to` | `products.view` | Sayfalı hareket listesi + `total` |
| `GET /admin/products/{id}/stock-verify` | `products.view` | `{consistent, current_stock, ledger_stock, first_divergent_id}` |

Stok düzenlemesi mevcut `PATCH /admin/products/{id}` üzerinden (`products.manage`) — yeni uç yok, yalnız gerekçe alanları eklenir. **İzin kodu olarak `inventory.*` eklenmiyor** (Karar 4): kimseye verilmemiş yeni bir izin kodu bu kod tabanında **sessiz 403** üretiyor (backend/CLAUDE.md'de kayıtlı tuzak); `inventory.*` sayım/hasar ekranları gelirken tek seferde ve rollerle birlikte eklenmeli.

Stok değişikliği ayrıca `audit_service.record` ile `audit_logs`'a yazılır (`action="product.stock_adjust"`, `before/after`, `reason`) — defter *ne olduğunu*, audit *kimin hangi istekle yaptığını* anlatır; `request_id` ikisini birbirine bağlar.

**Frontend** (`pages/dashboards/AdminStore.tsx` — bu paket dosyayı **bölmez**, F37 ayrı iş):
- Ürün satırında `sku` görünür; ürün editöründe `sku` salt-okunur, `barcode` düzenlenebilir + ISBN ayrımını anlatan yardım metni.
- Stok alanı değiştirilince **gerekçe seçici** (zorunlu) + `DIGER`'de not alanı belirir; gerekçesiz kaydetme engellenir (istemci tarafı da, sunucu tarafı da).
- "Stok geçmişi" — ürün satırından açılan pencere: tarih · tip rozeti · delta (±, renk = yalnız işaret) · sonuç bakiye · gerekçe · aktör · referans linki (sipariş/iade). Üstte mevcut stok + **"defter tutarlı / sapma var"** rozeti (`stock-verify`). Filtre: tip + tarih aralığı; sayfalama.
- Tasarım: `components/admin/ui/*` (Button/Badge/PageState/ErrorState), kart yerine saç-teli çizgili satır ritmi, nötr palet, **her sorguda `ErrorState`** (hata ≠ boş ekran), dark-mode paritesi, hover-only aksiyon yok. Tam ekran pencere `createPortal(body)` ile (navbar `backdrop-blur` tuzağı).
- CSV şablonu (`AdminStore.tsx:438`) başına `sku` eklenir.
- Saf mantık `lib/stockMovements.ts` (+ Vitest): tip etiketleri, delta biçimlendirme, tutarlılık rozeti metni.

---

## 8. Test matrisi

**Disiplin:** test matrisi **koddan önce ayrı commit** olarak gelir ve **kırmızı** koştuğu rapora eklenir. `tests/acceptance/` ve `*.acceptance.test.ts` altındaki dosyalar bilinçli karar olmadan değiştirilmez.

| Katman | Dosya | Kapsam |
|---|---|---|
| Saf birim | `tests/test_stock_ledger_pure.py` | `sku_prefix`/`next_sku_body` formatı · `clamp_delta` (tam sınır: `stock == qty`) · `reason_required` matrisi · `verify_chain` (tutarlı / kopuk / son bakiye sapması) |
| Kabul (sözleşme) | `tests/acceptance/test_stock_ledger_contract.py` | **AST envanteri**: `products.stock`'a atama yapan tek dosya `stock_ledger.py` · 6 çağrı yerinin `apply_movement` çağırdığının AST'te doğrulanması · `ADJUSTMENT`'ta gerekçe zorunluluğu · `stock_movements` için UPDATE/DELETE uç ve servis fonksiyonunun **yokluğu** |
| Değişmez | `tests/integration/test_stock_ledger_pg.py` | Zincir: `qty_after[i] == qty_after[i-1] + qty_delta[i]` · `MAX(qty_after) == products.stock` · 5 CHECK'in her biri ihlal edildiğinde reddediliyor · `uq_stock_movements_ref_once` çift `SALE`'i emiyor (409 değil, no-op) · trigger UPDATE/DELETE/TRUNCATE'i reddediyor · oversell clamp gerçek delta yazıyor + alarm üretiyor · `stock IS NULL` üründe hareket yok |
| Eşzamanlılık (PG) | `tests/integration/test_stock_concurrency_pg.py` | İki eşzamanlı PAID → tek düşüm · **admin düzenlemesi ⟂ PAID → ikisi de uygulanıyor** (F2, bugünkü hata) · ters ürün sıralı iki sipariş → deadlock yok (tekrarlı koşum) · aynı `OrderReturn` iki kez settle → tek `RETURN` |
| Migration | `tests/integration/test_stock_migration_pg.py` | §6'daki (a)-(e) |
| Yetki | `tests/integration/test_stock_authorization_pg.py` | Eğitmen kendi ürününde stok düzenleyemiyor (bugün de öyle — regresyon kalkanı) · eğitmen/öğrenci/kurye/operatör `stock-movements` ucunda 403 · `products.view` olmayan alt admin rolü 403 · IDOR: başka ürünün hareketleri sızmıyor |
| Vitest | `lib/stockMovements.test.ts` · `AdminStore` gerekçe testi | Etiket/biçim · gerekçesiz kaydet engelli · tutarsız defterde rozet uyarıyor |
| Gerçek dev ortam kabulü | elle, §8a | Aşağıdaki 8 senaryo |

### 8a. Gerçek dev ortam kabul senaryoları (yerel uvicorn + 5432 dev DB)

1. Ürün oluştur (stok 10) → geçmişte tek `INITIAL` satırı, bakiye 10.
2. Sipariş ver + öde (2 adet) → `SALE −2`, bakiye 8; sipariş referansı linkten açılıyor.
3. Aynı üründen iki satırlı sipariş → **tek** `SALE` satırı, toplu delta.
4. Siparişi iptal et → `SALE_CANCEL +2`, bakiye 10.
5. Kısmi iade (1 adet) → `RETURN +1`; ikinci kez settle denemesi bakiyeyi değiştirmiyor.
6. Admin stok 10 → 25 düzenlemesi: **gerekçe seçmeden kaydedilemiyor**; `TEDARIK` ile `ADJUSTMENT +15`.
7. `DIGER` gerekçesi seçilince not zorunlu.
8. CSV ile 3 ürün içe aktar → 3 `INITIAL`; SKU'lar `FZK-0000xx` ve tekil; `stock-verify` üçünde de tutarlı.

### 8b. Guard mutasyon provası (koruma gerçekten koruyor mu)

Her biri geçici olarak bozulur, ilgili testin **gerçekten kırıldığı** gösterilir, geri alınır; sonuç rapora tablo olarak girer.

| # | Bozulan koruma | Kırılması beklenen test |
|---|---|---|
| 1 | `uq_stock_movements_ref_once` düşürülür | çift `SALE` emilme testi |
| 2 | `ck_stock_movements_after` düşürülür | negatif bakiye reddi |
| 3 | Değiştirilemezlik trigger'ı düşürülür | UPDATE/DELETE reddi |
| 4 | `ON CONFLICT DO NOTHING` → düz INSERT | idempotency testi (409'a düşer) |
| 5 | `update_product`'tan `FOR UPDATE` çıkarılır | F2 kayıp-düşüm eşzamanlılık testi |
| 6 | `sorted(product_id)` kaldırılır | ters sıralı deadlock testi (tekrarlı koşum) |
| 7 | `ADJUSTMENT` gerekçe zorunluluğu kaldırılır | gerekçe matrisi + kabul testi |
| 8 | Bir servise **kasten** doğrudan `p.stock = ...` eklenir | AST envanter testi |

### 8c. Bağımsız gözden geçirme

Paket bittikten sonra `security-reviewer` (yetki + IDOR + eşzamanlılık) ve `design-reviewer` (admin geçmiş penceresi + gerekçe akışı) çalıştırılır; **kırmaya çalışan** ek testleri pakete dâhil edilir. Katılmadığım bulgu uygulanmaz, sapma gerekçesiyle raporlanır.

---

## 9. Commit bölümlemesi ve rollback

| # | Commit | İçerik |
|---|---|---|
| 1 | `test(stok): stok hareket defteri kabul matrisi (kırmızı)` | §8'deki test dosyaları, implementasyon yok |
| 2 | `feat(stok): StockMovement modeli + sku/barcode + migration` | Model, `models/__init__` kaydı, şemalar, tek revizyon, backfill |
| 3 | `feat(stok): stock_ledger servisi (tek yazma noktası)` | `apply_movement`, saf yardımcılar, `verify_ledger` |
| 4 | `fix(stok): update_product satır kilidi + kilit sırası` | §4c'deki iki mevcut hata |
| 5 | `refactor(stok): 6 doğrudan stok mutasyonu deftere taşındı` | W1-W6 |
| 6 | `feat(stok): admin hareket geçmişi + doğrulama uçları` | İki GET ucu, `ProductUpdate` gerekçe alanları, audit |
| 7 | `feat(magaza): admin panel stok geçmişi + gerekçeli düzenleme` | Frontend + `lib/stockMovements.ts` |
| 8 | `test(stok): mutasyon provası + reviewer bulguları` | §8b/8c çıktıları |

Commit'lerde **Claude imzası yok** (ne `Co-Authored-By` ne dipnot).

**Rollback stratejisi** — ileri düzeltme tercih edilir, downgrade son seçenek:
- **7 → 6 → 5** tek tek `git revert` edilebilir; 5 geri alınırsa kod eski doğrudan mutasyona döner, `stock_movements` tablosu boşa çalışan bir tablo olarak kalır (zararsız). Tekrar ileri alınırken defterde boşluk oluşacağı için `verify_ledger` sapma gösterir → bilinçli bir `ADJUSTMENT` (`reason_code=HATALI_GIRIS`) ile kapatılır. Bu kayıt, "geri aldık" gerçeğinin defterdeki izidir.
- **4** bağımsız geri alınabilir (yalnız kilit).
- **2**'nin downgrade'i **defteri yok eder**; yalnız paketin henüz uygulandığı bir DB'de kullanılır. Üretim benzeri bir ortamda sorun çıkarsa yol: geriye alma değil, hatalı davranışı düzelten ileri commit.
- **Feature flag yok** — bilinçli. Defter yazımını atlatan bir bayrak, tam olarak ortadan kaldırmaya çalıştığımız "açıklanamayan boşluk"u üretir. PK-1'de bayrak vardı çünkü orada kapatılan şey **hâricî bir bağımlılıktı**; burada kapatılacak hâricî bir şey yok.

---

## 10. Onay bekleyen kararlar

Hepsinde bir önerim var; onaylarsanız plan olduğu gibi uygulanır.

| # | Karar | Öneri | Alternatif |
|---|---|---|---|
| 1 | SKU formatı | **`FZK-000042` / `DIJ-000007`** (sequence tabanlı, ISBN yalnız backfill sırası + tekrar tespiti + çözümleme anahtarı) | ISBN tabanlı `KTP-9786051234567` — yalnız §3a ve §6/3 değişir; ISBN'i olmayan ürünlere ayrıca sıra numarası gerekir (karma format) |
| 2 | `actor` alanı | **`actor_type` + `actor_admin_id` (FK'sız)** — filtrelenebilir, `audit_logs` deseniyle uyumlu, trigger'la çakışmaz | Tek `actor: String` alanı (istediğiniz alan listesindeki hâli) — filtreleme/birleştirme kaybolur |
| 3 | Değiştirilemezlik | **Sözleşme + DB trigger'ı** | Yalnız sözleşme (`audit_logs` ile birebir tutarlılık; projeye trigger sokmama) |
| 4 | İzin kodu | **`products.view` / `products.manage` yeniden kullanılsın** | Yeni `inventory.view/manage` — rollere kablolanmazsa sessiz 403 riski; sayım/hasar paketiyle birlikte eklenmesi daha güvenli |
| 5 | Oversell | **Clamp + gerçek delta + `OVERSELL_CLAMP` + ERROR log + admin bildirimi** | Negatif bakiyeye izin (`qty_after >= 0` CHECK'i kalkar) — gerçek WMS davranışı ama bu ölçekte gereksiz karmaşa |
| 6 | Açılış satırı tarihi | **`now()`** (defterin bilgisi bugün başlar) | `products.created_at` — geçmişi biliyormuş izlenimi verir |

---

## 11. Bu pakette yapılmayacaklar (tekrar)

`CountSession`/`CountLine` (sayım) · hasarlı stok konumu / disposition · paketleme QR FSM'i · çoklu depo · lot/seri · FIFO maliyetlendirme · dış kargo entegrasyonu · sayım/hasar/paketleme **ekranları** · rezervasyon-tahsis (`reserved`/`available`) · periyodik mutabakat job'u · satın alma / mal kabul · COGS · barkod tarama arayüzü · SKU'nun paket etiketine eklenmesi · `inventory.*` izin kodları · ürün varyantı · `AdminStore.tsx`'in route bazlı bölünmesi (F37).

**PK-2 ve diğer paketlere geçilmeyecek.** Bu paket onay + uygulama + test raporu + diff özetiyle kapandıktan sonra sıradaki iş ayrıca kararlaştırılır.
