# Stok Hareket Defteri + SKU — Uygulama Planı (rev. 2)

**Dal:** `stok-hareket-defteri` · **Durum:** rev. 2 onay bekliyor · **Üretim kodu yazılmadı**
**Hedef:** `products.stock` alanını **açıklanabilir** (her değişimin sebebi, sahibi ve ticari kaynağı kayıtlı), **denetlenebilir** (geçmiş DB seviyesinde değiştirilemez ve zinciri tutar) ve **eşzamanlı işlemlerde güvenilir** (yarış hâlinde sayı ne kaybolur ne iki kez uygulanır) hâle getirmek.

> **rev. 2 değişiklikleri (kullanıcının 9 maddelik kararı işlendi):**
> 1. SKU `product.id` üzerinden deterministik; **ayrı sequence yok**; immutable + unique + NOT NULL. Tekrarlanan ISBN migration'ı **durdurmaz**, veri kalitesi bulgusu olarak raporlanır.
> 2. Aktör modeli `actor_type` + **`actor_id`** (admine özel alan yok); ticari kaynak `ref_type`/`ref_id`/**`ref_line_id`**.
> 3. Append-only DB trigger'ı **kesinleşti** (UPDATE + DELETE reddi); downgrade önce trigger'ı düşürür; trigger + migration testleri yazılır.
> 4. İzinler mevcut `products.view` / `products.manage`; `inventory.*` tam envanter modülüne bırakıldı.
> 5. **Clamp kaldırıldı.** `current_stock + qty_delta < 0` → hareket yazılmaz, stok değişmez, transaction `InsufficientStock` ile sonlanır. `max(0, …)`, sessiz eksik delta ve `OVERSELL_CLAMP` **yok**.
> 6. Açılış hareketi `OPENING_BALANCE`, tarih migration anındaki `now()`, `reason_code` + migration kaynağı açıkça kayıtlı.
> 7. **`ON CONFLICT DO NOTHING` kaldırıldı.** Ayrı `idempotency_key`: aynı anahtar + aynı payload → mevcut hareket döner; aynı anahtar + farklı payload → conflict hatası. `(ref_type, ref_id)` tek başına unique **değil**; kısmi iadede `ref_line_id` idempotency kaynağı.
> 8. `apply_movement` her ürün için `FOR UPDATE`; çok ürünlü işlemde artan `product_id` sırası. Admin **mutlak atama yapmaz**; kilit altında delta hesaplanır → `ADMIN_ADJUSTMENT` + zorunlu `reason_code`.
> 9. `products.stock` ve hareket satırı aynı transaction; `qty_after` = gerçekten yazılan stok. Retry / eşzamanlı sipariş / iptal+iade yarışı / aynı anahtarın eşzamanlı iki çağrısı / payload çatışması PG entegrasyon testlerinde doğrulanır.

> Bu paket PK yol haritasının parçası **değildir** ve ödeme/hukuk katmanına dokunmaz.

---

## 1. Bugünkü durum — stok mutasyonlarının tam envanteri

`backend/` altındaki **tüm** `.stock` erişimleri tarandı (6 yazma + 8 okuma). Yazma noktalarının hepsi okundu; kilit ve atomiklik davranışı satır satır doğrulandı.

### 1a. Yazma noktaları (6)

| # | Konum | Ne yapıyor | Kilit / atomiklik | İz |
|---|---|---|---|---|
| **W1** | `services/order_service.py:687-688` (`_finalize_paid`) | PAID'de kalem başına `p.stock = max(0, p.stock - item.quantity)` | ✅ `:606-613` her ürün için `SELECT … FOR UPDATE` → `locked`; `:632` `escrow.claim(from_statuses=["PENDING","FAILED"])` tek kazanan | ❌ |
| **W2** | `order_service.py:1178-1179` (`_restock`) | İptal / tam iadede `p.stock += item.quantity` | ✅ satır başına `FOR UPDATE` (`:1174`) | ❌ |
| **W3** | `order_service.py:1573-1574` (`_restock_items`) | Kısmi iadede yalnız `ret.items` için `p.stock += ri.quantity` | ✅ satır başına `FOR UPDATE` (`:1569`) | ❌ |
| **W4** | `services/store_service.py:558` (`create_product`) | Yeni üründe ilk stok (yalnız PHYSICAL) | — | ❌ |
| **W5** | `store_service.py:652` (`bulk_import_products`) | CSV satırından ilk stok | satır başına savepoint | ❌ |
| **W6** | `store_service.py:755` + `:742` + `:781` (`update_product`) | Admin **mutlak** yazar: `editable.append("stock")` → `setattr`; `old_stock` yalnız 0→>0 bildirimi için | ❌ **kilit YOK** (`_load_full` `FOR UPDATE` kullanmıyor) | ❌ (aynı fonksiyon **fiyatı** `ProductPriceHistory`'ye yazıyor) |

**Çağrı zincirleri:** W1 ← ödeme callback'i + escrow reconciler. W2 ← `_restock` ← `_refund_payment` (`:1207`) ← sipariş iptali (`:1231`) **ve** tam iade (`:1259`). W3 ← `_restock_items` ← `_settle_return` (`:1631`).

### 1b. Bilinçli olarak stok yazmayan yerler (doğru, korunacak)

| Konum | Neden |
|---|---|
| `order_service.py:719-745` (`_out_of_stock_refund`) | Oversell tazmini. PAID **claim edilmedi** → düşüm de olmadı; docstring bunu açıkça yazıyor (`:724-726`). Geri yükleme yapılmaması doğru. |
| `services/delivery_service.py` (0 eşleşme) | Teslim edilemeyen sipariş PAID'e döner, mal hâlâ tahsisli; stok geri yüklenmez. |

### 1c. Okuma noktaları (davranış değişmeyecek)

`order_service.py:278` (sepet doğrulama) · `:618` (kilit altında oversell guard'ı) · `store_service.py:137` (`in_stock`) · `:399` (arama filtresi) · `:486` (şema projeksiyonu) · `:687` (`delete_product` guard'ı) · `services/admin_service.py:170` (`stock <= 5` düşük stok sayacı).

### 1d. Envanterin gösterdiği somut boşluklar

1. **Altı yazma noktasının hiçbiri iz bırakmıyor.** "Bu kitabın stoğu neden 3?" cevaplanamıyor. Aynı fonksiyon fiyat için geçmiş yazıyor, stok için yazmıyor.
2. **W6 kilitsiz ve mutlak atama.** Admin `stock=50` yazarken eşzamanlı bir PAID 2 düşürürse `setattr` düşümü **ezer**. Kayıp sessizdir; defter olmadan **tespiti de imkânsız**.
3. **W1'deki `max(0, …)` oversell'i sessizce yutuyor.**
4. **Kilit sırası sabit değil** (`:607` `for pid in needed` = `order.items` sırası) → çapraz ürünlü iki eşzamanlı siparişte deadlock.
5. **SKU/barkod yok.** `sku`/`barcode` sıfır eşleşme; tek kimlikler `isbn` (`models/store.py:231`, `String(20)`, **unique değil**) ve `slug`.
6. **Çift uygulamayı engelleyen DB kısıtı yok.** W1'de `escrow.claim` var; W2/W3'te hiçbir şey yok — `_refund_payment` iki yoldan çağrılabiliyor.

### 1e. Doğrulanmış kod gerçekleri (planın dayandığı ölçümler)

| Soru | Cevap | Kanıt |
|---|---|---|
| `_finalize_paid` içinde PAID claim'i ile stok düşümü arasında **commit var mı?** | **Yok** | `:595-780` aralığında `db.commit()`/`flush()` sıfır eşleşme |
| `coupon_service.redeem` commit ediyor mu? | Hayır | `services/coupon_service.py:99+` içinde commit yok |
| Kısmi iade satırının kendi kimliği var mı? | **Var** | `OrderReturnItem.id` (`models/store.py:767`) → `ref_line_id` kaynağı |
| `delete_product` fiziksel mi? | Soft | `store_service.py:693` `p.deleted_at = _now()` |
| Alembic head | tek: **`2df064134f6c`** | `alembic heads` |

**Bunun sonucu (Karar 5 için kritik):** ürün satırları `:606`'da kilitlenip commit'e kadar tutulduğu ve arada commit olmadığı için, PAID claim'inden sonra atılan bir `InsufficientStock` **tüm transaction'ı** (claim dâhil) geri alır — kısmi durum oluşamaz.

### 1f. Mevcut veri (canlı dev DB, 30 Tem 2026)

| kind | ürün | isbn dolu | tekil isbn | stock NULL | stock=0 |
|---|---|---|---|---|---|
| PHYSICAL | 6 | 4 | 4 | 0 | 0 |
| DIGITAL | 1 | 0 | — | 1 | — |

Tekrarlanan ISBN grubu: **0**.

---

## 2. Kapsam

**İçinde:** `products.sku` (deterministik, immutable, unique, NOT NULL) · opsiyonel `products.barcode` · append-only `stock_movements` + DB trigger'ı · `idempotency_key` sözleşmesi · tek yazma noktası `services/stock_ledger.py` · 6 mutasyon noktasının taşınması · W6 kilit + delta düzeltmesi · kilit sırası düzeltmesi · `OPENING_BALANCE` migration'ı · admin hareket geçmişi + gerekçeli düzenleme · defter doğrulama · test matrisi + guard mutasyon provası.

**Dışında (kullanıcı direktifi):** `CountSession`/`CountLine` (sayım), hasarlı stok konumu, paketleme QR FSM'i, çoklu depo, lot/seri, FIFO, dış kargo entegrasyonu; sayım/hasar/paketleme **ekranları**.

**Ayrıca bu pakette yapılmayacaklar (gerekçeli):** `inventory.*` izinleri (Karar 4 → tam envanter modülü) · rezervasyon/tahsis (`reserved`/`available`) · periyodik mutabakat job'u (doğrulama **fonksiyonu** yazılır, zamanlanmış koşum yazılmaz) · satın alma/mal kabul · COGS · barkod **tarama arayüzü** (yalnız çözümleme fonksiyonu testlenir) · SKU'nun paket etiketine eklenmesi · ürün varyantı · ISBN tekilliğinin zorlanması (§3b) · `AdminStore.tsx`'in route bazlı bölünmesi (F37).

---

## 3. Veri modeli

### 3a. `products.sku` — deterministik, sequence'sız

```python
sku: Mapped[str] = mapped_column(String(20), nullable=False)   # backfill sonrası NOT NULL
```

**Kural:** `sku = f"{prefix}-{product.id:06d}"`, `prefix = "FZK"` (PHYSICAL) | `"DIJ"` (DIGITAL).
Örnek: id=42 & PHYSICAL → `FZK-000042`; id=7 & DIGITAL → `DIJ-000007`. id 999999'u aşarsa dolgu doğal olarak büyür (`FZK-1000000`), `String(20)` fazlasıyla yeterli.

- **Sequence yok.** Değer tamamen `(kind, id)`'nin fonksiyonu → boşluk/rollback kaygısı ortadan kalkar, migration ve yeni satır aynı formülü kullanır, backfill idempotenttir.
- **Immutable.** Bir kez yazılır, asla yeniden hesaplanmaz. Ön koşulu: `kind` düzenlenebilir alanlar arasında **değil** (`store_service.py:753-756`). Bu ön koşul bir kabul testiyle kilitlenir — ileride `kind` düzenlenebilir yapılırsa test kırılır (aksi hâlde SKU sessizce yalan söylerdi).
- **Unique + NOT NULL.** `uq_products_sku` **tam** UNIQUE (kısmi değil). Slug'dan farkı: slug insan tarafından düzenlenebilir ve yeniden kullanılabilir olduğu için `WHERE deleted_at IS NULL` ile kısmi; SKU `id`'nin fonksiyonu olduğundan silinmiş satırla çakışması **imkânsızdır** ve tam UNIQUE daha güçlü bir garanti verir.
- **Yeni satırlar:** `id` INSERT'te atandığı için SKU `flush()` sonrası yazılır (`db.add(p)` → `await db.flush()` → `p.sku = make_sku(p.kind, p.id)`). Aynı desen `bulk_import_products`'ta savepoint içinde.
- **CSV:** şablona (`AdminStore.tsx:438`) `sku` **eklenmez** — SKU türetilmiş bir değerdir, içe aktarmadan gelmez. (rev. 1'de eklenecekti; deterministik formül bunu gereksiz ve çelişkili kılıyor.)

### 3b. ISBN — SKU'dan ayrı yayın kimliği

`isbn` **olduğu gibi kalır**: eserin/baskının bibliyografik kimliği, müşteri künyesinde gösterilir, CSV içe aktarmada tekrar tespitinde kullanılır (`store_service.py:623-634`). SKU ISBN'den üretilmediği için:

- **Tekrarlanan ISBN stok migration'ını DURDURMAZ.** Migration ilerler; tekrarlanan aktif ISBN grupları bulunursa `WARNING` olarak loglanır ve sayısı migration çıktısına yazılır.
- ISBN tekilliği **ayrı bir veri kalitesi + iş kuralı konusudur** ve bu paketin kapsamı dışındadır. Rapor edilecek şekli: `GET /admin/products/stock-verify` yanıtına değil, ayrı bir teşhis satırı olarak migration çıktısına ve §7'deki admin geçmiş penceresinde ürün künyesi altında "aynı ISBN'e sahip N ürün var" uyarısı olarak. **Zorlayıcı kısıt (unique index) eklenmez** — hangi durumda aynı ISBN'in meşru olduğu (farklı ciltleme, set içi kitap, yeniden basım) bir iş kararıdır ve karar verilmeden DB'de kilitlenmemelidir.

### 3c. `products.barcode` — ISBN'den model düzeyinde ayrımı

```python
barcode: Mapped[str | None] = mapped_column(String(32), nullable=True)
```

| Alan | Neyi tanımlar | Kaynağı | Otomatik doldurulur mu |
|---|---|---|---|
| `isbn` | **Eserin/baskının** bibliyografik kimliği (katalog) | Yayıncı / tedarikçi kataloğu | — |
| `sku` | **Bizim** stok kalemi kimliğimiz | `(kind, id)` formülü | ✅ türetilir |
| `barcode` | **Elimizdeki fiziksel kalemin üzerinde okunan** dizgi (EAN-13/UPC…) | Kalemin fiziği üzerinden okuma | ❌ **ISBN'den asla kopyalanmaz** |

Neden birbirinin yerine geçmez: (i) kitap olmayan fiziksel ürünün (kalem, defter) EAN'ı var, ISBN'i yok; (ii) set/paket ürünün kendi barkodu içindeki kitapların ISBN'lerinden farklıdır; (iii) ISBN-10 basımlarda kapaktaki barkod ISBN'in EAN-13 dönüşümüdür, ISBN alanındaki dizginin kendisi değildir; (iv) bazı baskılar promosyon barkodu taşır. **ISBN'i barkoda otomatik kopyalamak, "okuttum, eşleşti" güvenini yanlış eşleşmeye dayandırır** → `barcode` yalnız insan girdisiyle dolar.

**Tekillik:** `uq_products_barcode_active` kısmi UNIQUE (`WHERE barcode IS NOT NULL AND deleted_at IS NULL`).
**Çözümleme sırası** (`resolve_product_ref`, saf + testli; **arayüzü bu pakette yazılmaz**): `barcode` → `sku` → `isbn`. Elimizdeki kalemin üzerindeki dizgi, katalog kimliğinden önce gelir.

### 3d. `stock_movements` — append-only defter

```python
class StockMovementType(str, Enum):
    OPENING_BALANCE  = "OPENING_BALANCE"   # defter devreye alınırken mevcut bakiye (migration)
    INITIAL          = "INITIAL"           # ürün oluşturma / CSV içe aktarma ilk stoğu
    SALE             = "SALE"              # sipariş PAID → düşüm
    SALE_CANCEL      = "SALE_CANCEL"       # iptal / tam iade → geri yükleme
    RETURN           = "RETURN"            # kısmi iade kabulü → geri yükleme (satır bazlı)
    ADMIN_ADJUSTMENT = "ADMIN_ADJUSTMENT"  # admin düzeltmesi (gerekçe ZORUNLU)
```

| Kolon | Tip | Not |
|---|---|---|
| `id` | PK | Kronolojik sıra (monoton) |
| `product_id` | FK `products.id`, `ondelete="RESTRICT"`, NOT NULL, index | Ürün soft-delete edilir → RESTRICT hiç tetiklenmez; niyeti belgeler: defter yetim kalamaz |
| `qty_delta` | Integer NOT NULL | İşaretli, **uygulanan gerçek değişim**. Eksik/kırpılmış delta yazılmaz (Karar 5) |
| `qty_after` | Integer NOT NULL | Bu hareketten sonraki `products.stock`; **aynı transaction'da gerçekten yazılan değer** |
| `movement_type` | String(20) NOT NULL | Yukarıdaki 6 değer |
| `reason_code` | String(30) **NOT NULL** | Her hareket kendini açıklar. Sistem tipleri sabit kod taşır; `ADMIN_ADJUSTMENT` beyaz listeden seçer |
| `ref_type` | String(20) NULL | `order` · `order_return` · `product` · `migration` |
| `ref_id` | Integer NULL | Polimorfik → FK yok |
| `ref_line_id` | Integer NULL | Satır bazlı kaynak (kısmi iadede `order_return_items.id`) |
| `idempotency_key` | String(160) NULL, **UNIQUE** | §3f. `ADMIN_ADJUSTMENT`'ta NULL (PG'de NULL'lar birbirinden farklı sayılır) |
| `actor_type` | String(10) NOT NULL | `SYSTEM` \| `ADMIN` (genişletilebilir) |
| `actor_id` | Integer NULL | `SYSTEM`'de NULL olabilir; `ADMIN`'de zorunlu. **FK yok** (`audit_logs.actor_id` deseni; trigger'ın FK `SET NULL` UPDATE'iyle çakışmaması için de gerekli) |
| `note` | Text NULL | `DIGER` gerekçesinde zorunlu |
| `request_id` | String(64) NULL | `core/observability` bağlamı; `audit_logs.request_id` ile korelasyon |
| `created_at` | DateTime(tz) NOT NULL | `server_default=func.now()` |

**`deleted_at` YOK** — bilinçli sapma; gerekçe docstring'de: soft-delete edilebilen defter satırı, gizlenebilir defter satırıdır (`audit_logs` ile aynı duruş).

**Reason code sözlüğü:**

| Tip | `reason_code` |
|---|---|
| `OPENING_BALANCE` | `MIGRATION_OPENING` |
| `INITIAL` | `PRODUCT_CREATE` · `CSV_IMPORT` |
| `SALE` | `ORDER_PAID` |
| `SALE_CANCEL` | `ORDER_CANCELLED` · `ORDER_REFUNDED` |
| `RETURN` | `RETURN_ACCEPTED` |
| `ADMIN_ADJUSTMENT` | `SAYIM_FARKI` · `HASAR` · `KAYIP` · `HATALI_GIRIS` · `TEDARIK` · `DIGER` (beyaz liste, DB CHECK'iyle zorlanır) |

**CHECK kısıtları:**
```sql
ck_stock_movements_type      movement_type IN (6 değer)
ck_stock_movements_actor_t   actor_type IN ('SYSTEM','ADMIN')
ck_stock_movements_actor_id  actor_type <> 'ADMIN' OR actor_id IS NOT NULL
ck_stock_movements_delta     qty_delta <> 0 OR movement_type = 'OPENING_BALANCE'
ck_stock_movements_after     qty_after >= 0
ck_stock_movements_ref       movement_type NOT IN ('SALE','SALE_CANCEL','RETURN')
                             OR (ref_type IS NOT NULL AND ref_id IS NOT NULL)
ck_stock_movements_refline   movement_type <> 'RETURN' OR ref_line_id IS NOT NULL
ck_stock_movements_adjust    movement_type <> 'ADMIN_ADJUSTMENT'
                             OR reason_code IN ('SAYIM_FARKI','HASAR','KAYIP',
                                                'HATALI_GIRIS','TEDARIK','DIGER')
ck_stock_movements_note      reason_code <> 'DIGER'
                             OR (note IS NOT NULL AND length(btrim(note)) > 0)
```
`OPENING_BALANCE`'ta `qty_delta = 0`'a izin verilmesinin sebebi: **stoğu 0 olan ürün de açılış satırı almalı**, yoksa zincirin tabanı olmaz.

**Index'ler:**
```
ix_stock_movements_product   (product_id, created_at DESC, id DESC)
ix_stock_movements_ref       (ref_type, ref_id)
uq_stock_movements_idem      UNIQUE (idempotency_key)
```
`(ref_type, ref_id)` **unique DEĞİL** (Karar 7): aynı siparişte çok ürün, aynı iadede çok satır → referans başına birden çok geçerli hareket olur.

### 3e. Değiştirilemezlik — DB trigger'ı (kesin)

```sql
CREATE FUNCTION stock_movements_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements append-only tablodur: % reddedildi', TG_OP;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_movements_no_update BEFORE UPDATE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION stock_movements_immutable();
CREATE TRIGGER trg_stock_movements_no_delete BEFORE DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION stock_movements_immutable();
```

- **UPDATE ve DELETE reddedilir.** `TRUNCATE` bilinçli olarak engellenmez (ORM'den erişilemez, tablo sahibi gerektirir) ama **testler de onu kullanmaz**: entegrasyon testleri kendi ürününü üretip **ürün bazlı** doğrulama yapar ve teardown'da ürünü **soft-delete** eder; defter satırları kalır (append-only'nin doğal sonucu). Böylece ne "trigger'ı devre dışı bırak" kaçışı ne de dev DB'nin gerçek defterini silecek bir `TRUNCATE` gerekir. **Üretimde arka kapı yok** (`current_setting` tabanlı bypass eklenmiyor).
- Projede trigger deseni yoktu; sapmanın gerekçesi: bu trigger **iş mantığı taşımıyor**, yalnız bir değişmezliği zorluyor (ekspertiz planı §8d'de reddedilen şey iki tablo arası iş mantığı senkronizasyonuydu — burası o değil).
- `actor_id`'nin FK'sız olmasının ikinci sebebi budur: admin satırı fiziksel silinse `ON DELETE SET NULL` bir UPDATE olur ve trigger'a çarpardı.
- **Downgrade önce trigger'ları düşürür** (§6). İleride `stock_movements` üzerinde UPDATE gerektiren bir migration yazılırsa trigger'ı **açıkça** düşürmek zorunda kalır — istenen davranış.

### 3f. Idempotency sözleşmesi (Karar 7)

`idempotency_key` **anlamlı ve deterministik**tir; ticari kaynaktan türetilir:

| Tip | Anahtar | Neden bu granülerlik |
|---|---|---|
| `SALE` | `order:{order_id}:product:{product_id}:SALE` | Sipariş **ürün başına** tek düşüm; aynı ürün iki satırda geçiyorsa adetler toplanır (mevcut `needed` sözlüğü `:604-605` zaten topluyor) |
| `SALE_CANCEL` | `order:{order_id}:product:{product_id}:SALE_CANCEL` | `_refund_payment`'ın iki çağrı yolu (`:1231`/`:1259`) aynı anahtarı üretir → çift geri yükleme imkânsız |
| `RETURN` | `return_line:{order_return_item_id}:RETURN` | **Satır bazlı** (`OrderReturnItem.id`, `models/store.py:767`). Aynı üründen iki iade satırı → iki geçerli hareket, iki farklı anahtar |
| `INITIAL` | `product:{product_id}:INITIAL` | Ürün bir kez oluşur |
| `OPENING_BALANCE` | `migration:{revision}:product:{product_id}` | Backfill idempotent; migration iki kez koşsa ikinci kez yazmaz |
| `ADMIN_ADJUSTMENT` | **NULL** | Her elle düzeltme ayrı bir olaydır; doğal anahtarı yoktur. Çift tıklama zaten doğal olarak idempotenttir: hedef mutlak verilir, kilit altında delta `hedef − mevcut` hesaplanır; ikinci istekte delta 0 → hareket yazılmaz |

**`apply_movement` davranışı (ürün satırı kilitli iken):**
1. `idempotency_key` verilmişse anahtarla mevcut hareket aranır.
2. **Bulundu + payload aynı** (`product_id`, `qty_delta`, `movement_type`, `ref_type`, `ref_id`, `ref_line_id`) → **mevcut hareket döner**, stok değişmez. (Retry'ın doğru cevabı.)
3. **Bulundu + payload farklı** → `IdempotencyConflict` (HTTP 409). **Sessizce yutulmaz**; hangi alanın çeliştiği hata gövdesinde.
4. Bulunmadı → INSERT. Eşzamanlı bir INSERT unique index'i ihlal ederse (`IntegrityError`) satır yeniden okunur ve 2/3 kuralı uygulanır. Ürün satırı kilitli olduğundan aynı ürün için bu yarış zaten serileşir; bu dal ikinci kuşaktır ve testlenir.

### 3g. Negatif stok — `InsufficientStock` (Karar 5)

`current_stock + qty_delta < 0` ise:
- Hareket **yazılmaz**, `products.stock` **değişmez**.
- `InsufficientStock` yükseltilir → transaction geri alınır → çağıran zincir açık bir hatayla sonlanır.
- `logger.error` + operasyon alarmı üretilebilir; **deftere uygulanmış hareket gibi hiçbir şey yazılmaz.**
- `max(0, …)`, kırpılmış delta ve `OVERSELL_CLAMP` **yok**.
- HTTP eşlemesi: uygulama seviyesinde bir exception handler `InsufficientStock` → **409** (mevcut `core/exceptions.py` `IntegrityError` → 409 deseninin yanına). Opak 500 dönmez.

**Sipariş akışına yönlendirme:** stok yetersizliğinin **normal** yolu bugün de var ve korunuyor — `_finalize_paid`'deki ön kontrol (`:614-621`) kilit altında eksiği görür ve PAID **claim edilmeden** `_out_of_stock_refund`'a (tam iade + CANCELLED) gider. Bu kontrolün aritmetiği defterle **aynı saf yardımcıya** (`shortage_for`) bağlanacak; ikisinin ayrışması mümkün olmayacak.

Claim'den **sonra** `InsufficientStock` atılması, ürün satırları `:606`'dan commit'e kadar kilitli tutulduğu ve arada commit olmadığı için (§1e) **yapısal olarak ulaşılamazdır**. Yine de dal yazılır ve testlenir; oluşursa davranış: tüm transaction geri alınır (PAID claim'i dâhil) → kısmi durum yok → mevcut callback idempotensisi/reconciler tekrar dener → tekrar denemede ön kontrol eksiği görür ve `_out_of_stock_refund`'a yönlendirir. **Tutarlılık, erişilebilirliğin önündedir** (bilinçli; PK-1'in fail-closed duruşuyla aynı yön).

---

## 4. Servis katmanı — tek yazma noktası

Yeni dosya `backend/services/stock_ledger.py`. **`products.stock`'a atama yapan tek dosya burasıdır** (§4d ile zorlanır).

```python
async def apply_movement(
    db, product_id: int, *, qty_delta: int, movement_type: StockMovementType,
    reason_code: str, ref_type: str | None = None, ref_id: int | None = None,
    ref_line_id: int | None = None, idempotency_key: str | None = None,
    actor_type: str = "SYSTEM", actor_id: int | None = None,
    note: str | None = None,
) -> StockMovement | None
```

Davranış — **çağıranın transaction'ı içinde, kendi `commit`'ini atmaz** (Karar 9):

1. `SELECT … FROM products WHERE id = :id FOR UPDATE`. Çağıran satırı zaten kilitlemişse aynı transaction'da yeniden kilitlemek no-op'tur (yeniden girişli) → fonksiyon yanlış çağrılamaz.
2. `product.stock IS NULL` (dijital / stok takibi olmayan) → hareket yazılmaz, `None`, `logger.warning`.
3. `qty_delta == 0` ve tip `OPENING_BALANCE` değil → `None` (gürültü satırı yok).
4. **Idempotency** (§3f, 2/3/4 kuralları).
5. `new_stock = product.stock + qty_delta`; `new_stock < 0` → **`InsufficientStock`** (§3g).
6. `INSERT INTO stock_movements (…, qty_after=new_stock)` ve `product.stock = new_stock` — **aynı değişkenden, aynı transaction'da**. `qty_after` ile yazılan stok tanım gereği eşittir; bir test bunu commit sonrası okuyarak da doğrular.

**Çok ürünlü işlemler (Karar 8):** ikinci bir fonksiyon,

```python
async def apply_many(db, specs: list[dict]) -> list[StockMovement | None]
```

`specs`'i **artan `product_id`** sırasına dizer ve her biri için `apply_movement` çağırır. Kilit sırası disiplini böylece **tek yerde** yaşar; üç çağıranın (`order_service.py:607`, `:1172`, `:1567` — bugün sırasız döngüler) üçünde tekrarlanmaz ve biri unutulduğunda sessizce deadlock'a dönüşmez. Tek ürünlü çağrılar (W4/W5/W6) doğrudan `apply_movement` kullanır. Kabul testi bu ayrımı çivileyerek korur.

**Saf (DB'siz) yardımcılar aynı modülde:** `sku_prefix(kind)` · `make_sku(kind, product_id)` · `shortage_for(current, needed)` · `validate_reason(movement_type, reason_code, note)` · `idempotency_key_for(...)` · `verify_chain(rows, current_stock)` · `resolve_product_ref(...)` sorgu üreteci.

**Doğrulama:** `verify_ledger(db, product_id)` → son `qty_after` ile `products.stock` karşılaştırması + zincir sürekliliği (`qty_after[i] == qty_after[i-1] + qty_delta[i]`). Admin ucundan ve testlerden çağrılır; **zamanlanmış mutabakat job'u yazılmaz** (kapsam dışı).

### 4a. Çağrı yerlerinin taşınması

| # | Yeni çağrı |
|---|---|
| W1 | `apply_many` ile ürün başına tek `SALE`; `qty_delta = -toplam`, `reason_code="ORDER_PAID"`, `ref=("order", order.id)`, key `order:{id}:product:{pid}:SALE`, `actor_type="SYSTEM"`. `max(0, …)` **kalkar** |
| W2 | `apply_many` ile ürün başına toplanmış `SALE_CANCEL`; `reason_code` = iptal mi tam iade mi (`ORDER_CANCELLED`/`ORDER_REFUNDED`), key `order:{id}:product:{pid}:SALE_CANCEL` |
| W3 | `apply_many` ile **satır başına** `RETURN`; `ref=("order_return", ret.id)`, `ref_line_id=ri.id`, key `return_line:{ri.id}:RETURN`, `reason_code="RETURN_ACCEPTED"` |
| W4 | `Product(...)` **`stock=0`** ile kurulur (PHYSICAL; DIGITAL'de `None`) → `flush()` → `sku` yazılır → `INITIAL`, `qty_delta=payload.stock or 0`, `reason_code="PRODUCT_CREATE"`, `ref=("product", p.id)`, key `product:{id}:INITIAL`, `actor_type="ADMIN"`, `actor_id=admin.id`. **Neden `stock=0`:** ilk stoğu constructor'da yazmak, `apply_movement`'ın `mevcut + delta` aritmetiğiyle çift sayardı; defterin tek yazıcı olması ancak başlangıç bakiyesinin de deftere yazılmasıyla mümkündür. `payload.stock` 0/None ise delta 0 → satır yazılmaz, stok 0 kalır |
| W5 | Aynı savepoint'te aynı desen (`stock=0` → flush → sku → `INITIAL`, `reason_code="CSV_IMPORT"`) |
| W6 | `stock` payload'da ise: ürün satırı **`FOR UPDATE`** ile kilitlenir; `stock` `editable` listesinden **çıkarılır**; `delta = hedef − mevcut` kilit altında hesaplanır; `ADMIN_ADJUSTMENT` + zorunlu `reason_code` + `actor_type="ADMIN"`. `_notify_back_in_stock` (0→>0) tetikleyicisi **korunur**, artık `movement.qty_after` üzerinden |

### 4b. Şema / API değişikliği (W6'nın gerektirdiği)

`ProductUpdate` + iki alan: `stock_reason_code: str | None`, `stock_note: str | None`.
Kural: `stock` payload'da **ve** mevcut değerden farklıysa `stock_reason_code` zorunlu (beyaz listeden); `DIGER` ise `stock_note` da zorunlu. `stock` gönderilmemişse veya değer aynıysa gerekçe istenmez. Hedef 0'ın altındaysa `InsufficientStock` → 409.

### 4c. Düzeltilen iki mevcut hata (kapsam içi, kanıtlı)

1. **W6 kayıp düşüm** (`store_service.py:742-757`): kilit yok + mutlak atama. Düzeltme: `FOR UPDATE` + delta yazımı. Defter olmadan bu hatanın **tespiti** de imkânsızdı.
2. **Kilit sırası** (`order_service.py:607`, `:1172`, `:1567`): üç sırasız döngü `apply_many`'ye devredilir → çapraz deadlock kalkar.

İkisi de defterin doğruluğunun ön koşulu; ayrı pakete bırakılırsa defter ilk günden yanlış sayı kaydeder.

### 4d. Regresyon kalkanı — AST envanter testi

PK-1'de işe yarayan desen (`test_payment_gate_wiring.py`): `tests/acceptance/test_stock_ledger_contract.py`, `services/*.py` + `api/routers/*.py` dosyalarını **AST ile** tarar, `stock` niteliğine yapılan `Assign`/`AugAssign` hedeflerini toplar ve izin verilen tek yerin `services/stock_ledger.py` olduğunu doğrular. Ayrıca `max(0` kalıbının stok bağlamında bulunmadığını ve `ON CONFLICT` dizgisinin defter kodunda geçmediğini doğrular.

---

## 5. Failure senaryoları

| # | Senaryo | Bugün | Plandan sonra |
|---|---|---|---|
| F1 | İki eşzamanlı ödeme callback'i | `escrow.claim` tek kazanan | Aynı + aynı `idempotency_key` → ikinci çağrı **mevcut hareketi döndürür**, stok ikinci kez düşmez |
| F2 | Admin düzenlemesi ⟂ eşzamanlı PAID | **Düşüm sessizce kaybolur** | Satır kilidi + delta → ikisi de uygulanır, ikisi de deftere düşer |
| F3 | Aynı üründen iki sipariş satırı | İki ayrı düşüm | Ürün başına toplanmış tek `SALE` (anahtar bunu zorunlu kılar) |
| F4 | Stok yetersizliği (guard'ı aşan) | `max(0, …)` sessiz | `InsufficientStock` → hareket yok, stok değişmez, transaction geri alınır; normal yol zaten claim öncesi `_out_of_stock_refund` |
| F5 | `stock IS NULL` fiziksel ürün | Düşüm sessizce atlanır | Hareket yazılmaz + WARNING; zincir bozulmaz |
| F6 | Dijital ürün | Dokunulmaz | Aynı |
| F7 | `_refund_payment` iki yoldan iki kez (`:1231`/`:1259`) | **Çift geri yükleme** mümkün | Aynı anahtar → mevcut hareket döner |
| F8 | Aynı `OrderReturn` iki kez settle | Çift geri yükleme | `return_line:{id}` tekil → mevcut hareket döner |
| F9 | Aynı anahtar **farklı** payload (kod hatası / bozuk retry) | — | `IdempotencyConflict` 409; sessizce yutulmaz |
| F10 | Aynı anahtarın **eşzamanlı iki** çağrısı | — | Ürün kilidi serileştirir; kaybeden 2/3 kuralına düşer; unique index son savunma |
| F11 | Defter INSERT'i patlarsa | — | Transaction tamamen geri alınır → stok da değişmez; reconciler tekrar dener |
| F12 | Migration yarıda kalırsa | — | Alembic tek transaction → ya hep ya hiç; ayrıca `OPENING_BALANCE` anahtarı idempotent |
| F13 | Ürün soft-delete → yeniden stoklanma | — | Hareketler kalır, `sku` **değişmez** (id'nin fonksiyonu), zincir devam eder |
| F14 | `products.stock` DB'den elle değiştirilirse | Tespit edilemez | `verify_ledger` sapmayı raporlar (**tespit**, engelleme değil) |
| F15 | Defter satırı UPDATE/DELETE denemesi | — | Trigger exception |
| F16 | Çapraz ürünlü iki eşzamanlı sipariş | Deadlock mümkün | `sorted(product_id)` |
| F17 | Tekrarlanan aktif ISBN | Sessiz | Migration **durmaz**; WARNING + admin yüzeyinde veri kalitesi uyarısı (§3b) |
| F18 | İptal + iade yarışı (aynı sipariş) | Belirsiz | İki farklı anahtar (`SALE_CANCEL` vs `return_line:*`) → ikisi de geçerli, ikisi de kayıtlı; `qty_after` zinciri sırayı gösterir |

---

## 6. Migration ve backfill

**Tek revizyon:** `stok_hareket_defteri_sku`, `down_revision = "2df064134f6c"`.

**Upgrade:**
1. `products.sku` (nullable) + `products.barcode` kolonları.
2. **SKU backfill (saf SQL, sequence'sız):**
   ```sql
   UPDATE products SET sku =
     CASE kind WHEN 'PHYSICAL' THEN 'FZK-' ELSE 'DIJ-' END || lpad(id::text, 6, '0');
   ```
   Soft-delete edilmiş satırlar **dâhil** (NOT NULL için ve geçmişin okunabilirliği için). Deterministik → tekrar koşumda aynı değerler.
3. Tekrarlanan aktif ISBN grupları **sayılır ve loglanır**; migration **durmaz** (Karar 1).
4. `sku` → `NOT NULL`; `uq_products_sku` (tam UNIQUE); `uq_products_barcode_active` (kısmi).
5. `stock_movements` tablosu + 9 CHECK + 3 index.
6. Değiştirilemezlik trigger'ı (fonksiyon + 2 trigger).
7. **`OPENING_BALANCE` backfill:** `stock IS NOT NULL` olan her ürün (soft-delete dâhil) için bir satır —
   `movement_type='OPENING_BALANCE'`, `qty_delta = stock`, `qty_after = stock`,
   `reason_code='MIGRATION_OPENING'`, `ref_type='migration'`, `ref_id=NULL`,
   `idempotency_key='migration:<revision>:product:<id>'`,
   `actor_type='SYSTEM'`, `actor_id=NULL`,
   `note='Alembic <revision> — stok defteri devreye alınmadan önceki mevcut bakiye'`,
   `created_at = now()` (**migration anı; geçmiş tarih uydurulmaz** — Karar 6).
8. Sağlık kontrolü: açılış satırı sayısı == `stock IS NOT NULL` ürün sayısı; her ürün için `MAX(qty_after) == products.stock`.

**Downgrade (Karar 3):** sıra **önce trigger'lar** → sonra `stock_movements` → index'ler → kolonlar. Tabloyu düşürmek defteri yok eder; bu, tablo düşüren her downgrade'in doğasıdır ve rollback stratejisi bu yüzden downgrade'i **son seçenek** sayar (§9).

**Migration testleri:** (a) boş DB'de `upgrade head` → tablo/kısıt/trigger var; (b) tohumlanmış DB'de upgrade → açılış satırları + zincir doğru; (c) `downgrade -1` → trigger/tablo/kolonlar yok, ürün verisi bozulmamış; (d) tekrar `upgrade` → **aynı SKU'lar**; (e) tekrarlanan ISBN enjekte edilmiş DB'de upgrade → **durmaz**, uyarı üretir.

---

## 7. Admin yüzeyi

**Backend uçları** (`api/routers/store.py` admin bölümü):

| Uç | İzin | Döner |
|---|---|---|
| `GET /admin/products/{id}/stock-movements?limit&offset&movement_type&from&to` | `products.view` | Sayfalı hareket listesi + `total` |
| `GET /admin/products/{id}/stock-verify` | `products.view` | `{consistent, current_stock, ledger_stock, first_divergent_id, duplicate_isbn_count}` |

Stok düzenlemesi mevcut `PATCH /admin/products/{id}` (`products.manage`) üzerinden — yeni uç yok, yalnız gerekçe alanları. **`inventory.*` izin kodu eklenmiyor** (Karar 4): kimseye verilmemiş yeni izin kodu bu kod tabanında **sessiz 403** üretiyor (backend/CLAUDE.md'de kayıtlı tuzak); `inventory.*` tam envanter modülüyle, rollerle birlikte gelecek.

Stok değişikliği ayrıca `audit_service.record` ile `audit_logs`'a yazılır (`action="product.stock_adjust"`, `before/after`, `reason`) — defter *ne olduğunu*, audit *kimin hangi istekle yaptığını* anlatır; `request_id` ikisini bağlar.

**Frontend** (`pages/dashboards/AdminStore.tsx`; dosya **bölünmez**, F37 ayrı iş):
- Ürün satırında `sku`; editörde `sku` salt-okunur, `barcode` düzenlenebilir + ISBN ayrımını anlatan yardım metni.
- Stok alanı değişince **gerekçe seçici** (zorunlu) + `DIGER`'de not; gerekçesiz kaydetme hem istemcide hem sunucuda engelli.
- "Stok geçmişi" penceresi: tarih · tip rozeti · delta (±, renk = yalnız işaret) · sonuç bakiye · gerekçe · aktör · referans linki (sipariş / iade satırı). Üstte mevcut stok + **"defter tutarlı / sapma var"** rozeti + tekrarlanan ISBN uyarısı. Filtre: tip + tarih; sayfalama.
- Tasarım: `components/admin/ui/*`, kart yerine saç-teli çizgili satır ritmi, nötr palet, **her sorguda `ErrorState`**, dark-mode paritesi, hover-only aksiyon yok, tam ekran pencere `createPortal(body)`.
- Saf mantık `lib/stockMovements.ts` (+ Vitest).

---

## 8. Test matrisi

**Disiplin:** test matrisi **koddan önce ayrı commit** olarak gelir ve **kırmızı** koştuğu rapora eklenir. `tests/acceptance/` ve `*.acceptance.test.ts` bilinçli karar olmadan değiştirilmez.

| Katman | Dosya | Kapsam |
|---|---|---|
| Saf birim | `tests/test_stock_ledger_pure.py` | `make_sku`/`sku_prefix` (id 1 · 42 · 999999 · 1000000, iki kind) · `shortage_for` (tam sınır `stock == needed`) · `validate_reason` matrisi (6 tip × beyaz liste × `DIGER`+not) · `idempotency_key_for` (5 tip, satır bazlı iade) · `verify_chain` (tutarlı / kopuk halka / son bakiye sapması) |
| Kabul (sözleşme) | `tests/acceptance/test_stock_ledger_contract.py` | **AST envanteri**: `products.stock`'a atama yapan tek dosya `stock_ledger.py` · 6 çağrı yerinin `apply_movement` çağırdığı · `max(0` kalıbının stok bağlamında yokluğu · `ON CONFLICT` dizgisinin defter kodunda yokluğu · `OVERSELL_CLAMP` dizgisinin **hiç** bulunmaması · enum tam olarak 6 değer · `stock_movements` için UPDATE/DELETE servis fonksiyonu ve ucu yok · **`kind`'in düzenlenebilir alanlar arasında olmadığı** (SKU immutability ön koşulu) · `inventory.` izin kodunun eklenmemiş olması |
| Değişmez (PG) | `tests/integration/test_stock_ledger_pg.py` | Zincir `qty_after[i] == qty_after[i-1] + qty_delta[i]` · `MAX(qty_after) == products.stock` · 9 CHECK'in her biri ihlalde reddediyor · trigger UPDATE **ve** DELETE'i reddediyor · `InsufficientStock`: hareket **yazılmadı** + stok **değişmedi** · idempotency: aynı payload → mevcut hareket, satır sayısı artmıyor · farklı payload → `IdempotencyConflict` · `stock IS NULL` üründe hareket yok · `qty_after` == commit sonrası okunan `products.stock` |
| Eşzamanlılık (PG) | `tests/integration/test_stock_concurrency_pg.py` | İki eşzamanlı PAID → tek düşüm · **admin düzenlemesi ⟂ PAID → ikisi de uygulanıyor** (F2) · aynı `idempotency_key`in **eşzamanlı** iki çağrısı → tek satır · iptal + iade yarışı → iki geçerli hareket, zincir tutarlı · ters ürün sıralı iki sipariş → deadlock yok (tekrarlı koşum) · retry (aynı çağrı iki kez) → tek satır |
| Migration (PG) | `tests/integration/test_stock_migration_pg.py` | §6'daki (a)–(e) |
| Yetki (PG) | `tests/integration/test_stock_authorization_pg.py` | Eğitmen kendi ürününde stok düzenleyemiyor (regresyon kalkanı) · eğitmen/öğrenci/kurye/operatör `stock-movements`'ta 403 · `products.view` olmayan alt admin rolü 403 · IDOR: başka ürünün hareketleri sızmıyor |
| Vitest | `lib/stockMovements.test.ts` | Tip etiketleri · delta biçimi · tutarsız defterde rozet uyarıyor · gerekçesiz kaydetme engelli |

### 8a. Gerçek dev ortam kabul senaryoları (yerel uvicorn + 5432 dev DB)

1. Ürün oluştur (stok 10) → tek `INITIAL`, bakiye 10, SKU `FZK-0000xx` = id'nin fonksiyonu.
2. Sipariş + ödeme (2 adet) → `SALE −2`, bakiye 8; referans linki siparişi açıyor.
3. Aynı üründen iki satırlı sipariş → **tek** `SALE`, toplu delta.
4. Siparişi iptal et → `SALE_CANCEL +2`, bakiye 10; iptali tekrar tetikle → **yeni satır yok**.
5. Kısmi iade (2 satır, aynı ürün) → **iki** `RETURN` satırı, iki farklı `ref_line_id`.
6. Admin 10 → 25: gerekçe seçmeden kaydedilemiyor; `TEDARIK` ile `ADMIN_ADJUSTMENT +15`.
7. `DIGER` seçilince not zorunlu; hedefe `-5` yazılınca **409** ve stok değişmiyor.
8. CSV ile 3 ürün → 3 `INITIAL`; `stock-verify` üçünde de tutarlı.

### 8b. Guard mutasyon provası

| # | Bozulan koruma | Kırılması beklenen test |
|---|---|---|
| 1 | `uq_stock_movements_idem` düşürülür | eşzamanlı aynı anahtar → tek satır |
| 2 | `ck_stock_movements_after` düşürülür | negatif bakiye reddi |
| 3 | UPDATE trigger'ı düşürülür | UPDATE reddi |
| 4 | DELETE trigger'ı düşürülür | DELETE reddi |
| 5 | `InsufficientStock` yerine clamp konur | "hareket yazılmadı + stok değişmedi" testi |
| 6 | Payload karşılaştırması kaldırılır (her zaman mevcut hareketi döndür) | `IdempotencyConflict` testi |
| 7 | `update_product`'tan `FOR UPDATE` çıkarılır | F2 kayıp-düşüm testi |
| 8 | `apply_many`'deki `sorted` kaldırılır | ters sıralı deadlock testi (tekrarlı koşum) |
| 9 | `ADMIN_ADJUSTMENT` gerekçe zorunluluğu kaldırılır | gerekçe matrisi + CHECK testi |
| 10 | Bir servise kasten doğrudan `p.stock = …` eklenir | AST envanter testi |

### 8c. Bağımsız gözden geçirme

`security-reviewer` (yetki + IDOR + eşzamanlılık) ve `design-reviewer` (geçmiş penceresi + gerekçe akışı) çalıştırılır; kırmaya çalışan ek testleri pakete dâhil edilir. Katılmadığım bulgu uygulanmaz, sapma gerekçesiyle raporlanır.

---

## 9. Commit bölümlemesi ve rollback

| # | Commit | İçerik |
|---|---|---|
| **1** | `test(stok): stok hareket defteri kabul matrisi (kırmızı)` | **Yalnız testler.** Üretim kodu yok. Kırmızı koşu çıktısı raporlanır → **burada durulur, onay beklenir** |
| 2 | `feat(stok): StockMovement modeli + sku/barcode + migration` | Model, `models/__init__`, şemalar, tek revizyon, trigger, backfill |
| 3 | `feat(stok): stock_ledger servisi (tek yazma noktası)` | `apply_movement`, saf yardımcılar, `InsufficientStock`/`IdempotencyConflict`, 409 handler, `verify_ledger` |
| 4 | `fix(stok): update_product satır kilidi + kilit sırası` | §4c |
| 5 | `refactor(stok): 6 doğrudan stok mutasyonu deftere taşındı` | W1–W6 |
| 6 | `feat(stok): admin hareket geçmişi + doğrulama uçları` | İki GET ucu, `ProductUpdate` gerekçe alanları, audit |
| 7 | `feat(magaza): admin panel stok geçmişi + gerekçeli düzenleme` | Frontend + `lib/stockMovements.ts` |
| 8 | `test(stok): mutasyon provası + reviewer bulguları` | §8b/8c |

Commit'lerde **Claude imzası yok**.

**Rollback:**
- **7 → 6 → 5** tek tek `git revert` edilebilir. 5 geri alınırsa kod eski doğrudan mutasyona döner; `stock_movements` boşa çalışan tablo olarak kalır (zararsız). Tekrar ileri alınırken defterde boşluk olacağı için `verify_ledger` sapma gösterir → bilinçli bir `ADMIN_ADJUSTMENT` (`HATALI_GIRIS`) ile kapatılır; bu kayıt "geri aldık" gerçeğinin defterdeki izidir.
- **4** bağımsız geri alınabilir (yalnız kilit).
- **2**'nin downgrade'i **defteri yok eder**; yalnız paketin yeni uygulandığı bir DB'de kullanılır. Üretim benzeri ortamda sorun çıkarsa yol geriye alma değil, ileri düzeltme.
- **Feature flag yok** — bilinçli. Defter yazımını atlatan bayrak, tam olarak kaldırmaya çalıştığımız açıklanamayan boşluğu üretir. PK-1'de bayrak vardı çünkü orada kapatılan şey **hâricî bir bağımlılıktı**; burada kapatılacak hâricî bir şey yok.

---

## 10. rev. 2'de kapanan kararlar

| # | Karar | Sonuç |
|---|---|---|
| 1 | SKU | `FZK-000042`/`DIJ-000007`, `(kind, id)` formülü, sequence yok, immutable + tam UNIQUE + NOT NULL. ISBN ayrı yayın kimliği; tekrarı migration'ı durdurmaz, veri kalitesi bulgusu olarak raporlanır |
| 2 | Aktör | `actor_type` + `actor_id` (SYSTEM'de NULL olabilir); admine özel alan yok. Ticari kaynak `ref_type`/`ref_id`/`ref_line_id` |
| 3 | Değişmezlik | DB trigger'ı: UPDATE + DELETE reddi. Downgrade önce trigger'ı düşürür. Trigger + migration testleri yazılır. TRUNCATE bilinçli açık (test temizliği; arka kapı yok) |
| 4 | İzin | `products.view` / `products.manage`. `inventory.*` tam envanter modülünde |
| 5 | Oversell | `InsufficientStock`; hareket yazılmaz, stok değişmez, transaction sonlanır. Clamp / sessiz eksik delta / `OVERSELL_CLAMP` yok. Yönlendirme claim öncesi mevcut `_out_of_stock_refund` yolu |
| 6 | Açılış | `OPENING_BALANCE`, `now()`, `reason_code='MIGRATION_OPENING'`, migration kaynağı `note` + anahtarda kayıtlı |
| 7 | Idempotency | Anlamlı `idempotency_key` (UNIQUE); aynı payload → mevcut hareket, farklı payload → `IdempotencyConflict`. `ON CONFLICT DO NOTHING` yok. `(ref_type, ref_id)` unique değil; kısmi iadede `ref_line_id` |
| 8 | Kilit | Her üründe `FOR UPDATE`; artan `product_id` sırası `apply_many` içinde **tek yerde** garanti. Admin mutlak atama yapmaz; kilit altında delta + zorunlu gerekçe |
| 9 | Transaction | Stok ve hareket aynı transaction; `qty_after` = yazılan stok. Retry / eşzamanlılık / yarış / anahtar çatışması PG testlerinde |

## 11. Bu pakette yapılmayacaklar (tekrar)

Sayım (`CountSession`/`CountLine`) · hasarlı stok konumu · paketleme QR FSM'i · çoklu depo · lot/seri · FIFO · dış kargo entegrasyonu · sayım/hasar/paketleme ekranları · rezervasyon-tahsis · periyodik mutabakat job'u · satın alma/mal kabul · COGS · barkod tarama arayüzü · SKU'nun paket etiketine eklenmesi · `inventory.*` izinleri · ürün varyantı · ISBN unique kısıtı · `AdminStore.tsx` bölünmesi (F37).

**PK-2 ve diğer paketlere geçilmeyecek.**
