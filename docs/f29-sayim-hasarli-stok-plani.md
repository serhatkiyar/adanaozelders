# F29 — Stok Sayımı, Düzeltme ve Hasarlı Stok · Uygulama Planı (rev. 2)

> **Durum:** kod yazılmadı, kırmızı test yazılmadı — **onay bekliyor**.
> **Dal:** `f29-sayim-hasarli-stok` · **Taban:** `main @ 384b919` (TB-1 sonrası).
> **Kapsam dışı (direktif):** F30 paketleme/pick QR · çoklu depo/lokasyon · lot/seri ·
> FIFO ve her türlü **parasal değerleme** · kargo entegrasyonu · kurye akışı ·
> PK-2/iyzico · TB-2 yeniden tasarımı.
>
> **rev. 2 değişiklikleri:** "raf stoğu" terimi kaldırıldı → `ON_PREMISE_PHYSICAL_STOCK` ·
> rev. 1'in uzlaştırma formülü **reddedildi** (her hareket fiziksel mevcudu değiştirmez) ·
> olay etkisi tablosu eklendi · `SHIPPED` semantiği dosya:satır ile doğrulandı ·
> **iade stoğunun fiziksel kabulden önce yazıldığı** yeni kritik bulgu · sayım satırı
> kova bazlı · kilit grafiği yeniden çıkarıldı · maker-checker hazır ama zorunlu değil ·
> hasarlı kovada gereksiz sıfır `OPENING_BALANCE` üretilmeyecek.

---

## 0. Dört ürün kararının plana yansıması

| Karar | Yansıma |
|---|---|
| **1. Ayrı onaylayan** | Zorunlu **değil** (varsayılan). `counted_by/at`, `reviewed_by/at`, `applied_by/at` **ayrı** alanlar; `INVENTORY_REQUIRE_SEPARATE_APPROVER` ayarı `true` olunca aynı aktör REVIEW/APPLY yapamaz (409). Tek admin süreci baştan sona tamamlayabilir. §6 |
| **2. Kapsam** | Terim `ON_PREMISE_PHYSICAL_STOCK`. `SHIPPED`/kurye kontrolündeki ve teslim edilmiş ürünler **hariç**; hazırlanmış ama kurye almamış paketler **dâhil**. §2, §3 |
| **3. Atomik uygulama** | Kısmi uygulama **yok**. Tek transaction, hepsi-ya-hiçbiri, yarım `APPLIED` imkânsız (koşullu UPDATE claim). Büyük operasyon → küçük oturumlar. §7 |
| **4. Hasarlı değer** | **Parasal değerleme yok.** Miktar + hareket izi. Plana tutar/maliyet/zarar alanı eklenmedi. |

---

## 1. Kod tabanı envanteri (dosya:satır)

### 1.1 Stok yönetimi ve admin ürün ekranları
`models/store.py:229` `stock: int \| None` (NULL = takip yok) · tek yazıcı
`services/stock_ledger.py` (`lock_products:564` · `apply_movement:759` · `apply_many:806` ·
`verify_ledger:884` · `audit_products:1019` · `list_movements:1277`) ·
admin düzeltme `services/store_service.py:807-878` (`stock` `editable` listesinde **yok**, `:860`) ·
ekranlar `AdminStore.tsx:103,129,507` → `StockMovementsPanel.tsx` / `StockLedgerPanel.tsx` ·
salt-okunur uçlar `api/routers/store.py:1127,1166,1207` · stok bildirimi `store_service.py:753,901`.

### 1.2 Hareket türleri
`models/store.py:944-964`: `OPENING_BALANCE` · `INITIAL` · `SALE` · `SALE_CANCEL` · `RETURN` ·
`ADMIN_ADJUSTMENT`. Sayı kabul testiyle sabit (`:947`), CHECK `ck_stock_movements_type` (`:1053`).
**Yeni tür gerekiyor** — §5.

### 1.3 `ADMIN_ADJUSTMENT` bugün
Üretimde tek kanal: admin ürün formu (`store_service.py:833` doğrulama, `:873` hareket).
`idempotency_key` **NULL** (`models/store.py:1035`) → **retry güvenliği yok**.
Ayrıca geliştirme betiği `scripts/dev_rebase_stock.py:208`.

### 1.4 Sipariş yolunda stok
Sepet (bilgilendirme, kilitsiz) `order_service.py:279` · otorite (kilit + yeterlilik)
`:618` `lock_products` → `:630` `has_shortage` · düşüm `:703` `apply_many` (SALE) ·
yarış kurtarma `:721`. Rezervasyon/TTL yok (bilinçli).

### 1.5 Fiziksel yaşam döngüsü — dosya:satır kanıtı

| An | Kod | Fiziksel anlam |
|---|---|---|
| Ödeme | `order_service.py:703` `SALE` | Kitap **hâlâ işletmede**; yalnız satılabilirlikten düşer |
| Hazırlama | `delivery_service.py:764-766` `prepared_at`/`prepared_by`; model `models/store.py:511-517` | Paket toplandı + etiket basıldı → **hâlâ işletmede** |
| Tur başlangıcı | `delivery_service.py:467` `transition_order(..., "SHIPPED")` + `:468` `tracking_no=ELDEN-R{run}-S{stop}` | **İşletmeden çıkış** — kurye yüklendi, yola çıktı |
| Aktif tura sonradan durak | `delivery_service.py:1028` aynı geçiş | Aynı |
| Duraktan çıkarma | `delivery_service.py:1044-1048` `SHIPPED → PAID`, `tracking_no=None` | **Geri dönüş** (araca yüklenmemiş) |
| Teslim | `order_fsm` `DELIVERED` + `delivered_at` (`models/store.py:520`) | Çıkmış, bitmiş |
| Teslim edilemedi | `order_service.py:159-161` `prepared_at=None`, sipariş `PAID` | Paket **işletmeye geri döndü**, hazırlık damgası düşer |

> **Sonuç:** `SHIPPED` bu projede gerçekten "kurye kontrolüne geçti" demektir — status adına
> bakarak varsayılmadı, tek yazıcısı `start_run` (`delivery_service.py:440-467`) olduğu için
> doğrulandı. Dış kargo yolu **yazılmamıştır** (kök `CLAUDE.md`: "manuel takip-no akışı
> yazılmadı"), dolayısıyla `SHIPPED` üreten başka bir üretim yolu yoktur.

### 1.6 ⚠️ Yeni kritik bulgu — iade stoğu **fiziksel kabulden önce** yazılıyor

`approve_return` (`order_service.py:1567`) → `_settle_return` (`:1782`) → `_restock_items`
(`:1717`, kilit `:1741`). Yani `RETURN` hareketi **admin talebi onayladığında** yazılıyor;
kitabın işletmeye fiziksel olarak **ulaşıp ulaşmadığı bilinmiyor** — mal kabul akışı yok
(ekspertiz raporunda F12'nin ★ kalemi, kapsam dışı).

Etkisi: onaylanmış ama henüz gelmemiş her iade için `products.stock`, işletmedeki fiziksel
mevcuttan **fazladır**. Sayım bunu "eksik" olarak görür; oysa mal yolda olabilir.
Bu belirsizlik §4'te `STALE` sebebi olarak modellenir; sessizce düzeltilmez.

### 1.7 Sayım sırasında eşzamanlı satış — bugünkü davranış
Bugün sayım yok; en yakını adminin stok kutusuna sayı yazması. Delta **kilit altında ve taze
satırdan** hesaplanır (`store_service.py:819-822`), dolayısıyla sonuç "sessizce yanlış" değil,
**sessizce hiçbir şey yapmama**. Eksik olan: gördüğü sayının bayatladığını **söyleyen** mekanizma.

### 1.8 Roller ve izinler
`core/admin_permissions.py:34-35` `products.view` / `products.manage` (grup Ticaret).
Katalog tek doğruluk kaynağı; katalogda olmayan kod **SUPER_ADMIN dahil sessiz 403** (`:1-13`).
Roller `migrations/versions/7121d6785a32:50-55`: SUPER_ADMIN · EDUCATION_MANAGER ·
**COMMERCE_MANAGER** · MODERATOR · OPERATIONS_MANAGER; dağıtım `:58-63`.
Artımlı izin ekleme şablonu: `migrations/versions/266eeeac2a47` (idempotent INSERT + ROLE_GRANTS).

### 1.9 Audit
`services/audit_service.py:60-73`; `request_id` otomatik (`:78`), `before/after/meta` redaction'lı.
Ürün yolunda router seviyesinde kullanılıyor (`api/routers/store.py:212,238,256,270`).
`stock_movements.request_id` (`models/store.py:1043`) korelasyon için hazır.

### 1.10 Frontend ve test altyapısı
`components/admin/data-table/DataTable.tsx:13-38` (sunucu sayfalama) · `components/admin/ui/`
(`Badge/Button/ConfirmDialog/Dialog/PageState`) · hazır örnek `StockMovementTable.tsx`,
`StockMovementsPanel.tsx`, `hooks/useStock.ts`, `api/stock.ts`.
Migration DB fixture `tests/integration/test_stock_migration_pg.py:52` · suite DB + hijyen
nöbetçisi `tests/integration/conftest.py:320` · `db_guard.py` allowlist ·
`tests/integration/test_schema_defaults_pg.py` (TB-1 sapma nöbetçisi) ·
mutasyon sürücüsü `scripts/mutation_drill.py`.

---

## 2. Üç kavram ve `ON_PREMISE_PHYSICAL_STOCK`

### 2.1 Kesin tanımlar

1. **`products.stock` = SATILABİLİR miktar.** Sipariş verilebilir adet. `has_shortage`
   (`stock_ledger.py:221`) ve sepet kontrolü (`order_service.py:279`) bunu okur.
   **Fiziksel mevcut değildir.**
2. **`products.damaged_stock` = işletmede bulunan, hasarlı/kullanılamaz** miktar.
   Satılamaz; imha veya tedarikçi iadesiyle çıkar.
3. **`reserved_on_premise` = siparişe ayrılmış ama hâlâ işletmenin fiziksel kontrolünde**
   olan miktar. **Kolon değildir**, sorgudan türetilir (§2.3).

```
expected_on_premise = products.stock + products.damaged_stock + reserved_on_premise
```

### 2.2 `reserved_on_premise` neden `products.stock` dışında — SALE semantiğiyle kanıt

`SALE` hareketi `_finalize_paid` içinde, ödeme kesinleşirken yazılıyor
(`order_service.py:589-703`); `qty_delta` negatif ve `products.stock` **o anda** düşüyor.
Kitabın işletmeden çıkışı ise `start_run`'daki `SHIPPED` geçişidir
(`delivery_service.py:467`) — arada **hazırlama** adımı (`:764`) bile var ve o da paketi
işletmede tutuyor.

Dolayısıyla `PAID` (ödeme) ile `SHIPPED` (çıkış) arasındaki her kalem için:
* `products.stock`'tan **düşülmüştür** (satılamaz),
* fiziksel olarak **işletmededir** (sayılır).

İkisi ayrı büyüklüktür; aynı adet iki kez sayılmaz çünkü `SALE` onu `stock`'tan **çıkarmıştır**
ve `reserved_on_premise` onu **yalnız bir kez** geri ekler. Değişmez:

```
kalem PAID ve SHIPPED değil  ⟺  stock'ta YOK  ve  reserved_on_premise'te VAR
kalem SHIPPED/DELIVERED       ⟺  stock'ta YOK  ve  reserved_on_premise'te YOK
```

### 2.3 `reserved_on_premise` sorgusu (tek `GROUP BY`, N+1 yok)

```sql
SELECT oi.product_id, sum(oi.quantity)
FROM order_items oi JOIN orders o ON o.id = oi.order_id
WHERE o.deleted_at IS NULL
  AND o.payment_status = 'PAID'
  AND o.status = 'PAID'          -- SHIPPED/DELIVERED/CANCELLED/REFUNDED HARİÇ
GROUP BY oi.product_id
```

`status='PAID'` yeterlidir ve `SHIPPED`'i doğal olarak dışarıda bırakır: teslim edilemeyen
paket `PAID`'e geri döner (`order_service.py:158`) ve **işletmeye fiziksel olarak geri
gelmiştir**, yani doğru tarafta sayılır. Hazırlanmış (`prepared_at NOT NULL`) ama tura
girmemiş sipariş de `PAID`'dir → dâhil. ✔

`SUM` sonucu ayrıca satıra **snapshot**'lanır (`reserved_qty_snapshot`), çünkü o da uygulama
anına kadar değişir.

### 2.4 Kapsam listesi (direktif birebir)

| Dâhil | Hariç |
|---|---|
| Satışa açık, işletmedeki ürünler | Kurye teslim almış / turu başlamış / `SHIPPED` |
| `PAID`, işletmeden çıkmamış sipariş kalemleri | Teslim edilmiş (`DELIVERED`) |
| Paketlenmiş (`prepared_at NOT NULL`), kurye almamış | Tedarikçiye iade / imha ile fiziksel çıkmış |
| İşletmede duran hasarlı ürünler | |

> **Kapsam kısıtı (dürüst beyan):** F30 (pick/paketleme taraması) olmadığı için raf,
> paketleme masası ve hazırlanmış paket **ayrıştırılamaz**. F29 bunların toplamını tek
> büyüklük (`ON_PREMISE`) olarak sayar ve **çoklu lokasyon kurmaz**. F30 geldiğinde
> `ON_PREMISE` alt lokasyonlara bölünebilir; veri modeli buna engel değildir (kova boyutu
> zaten var, lokasyon üçüncü boyut olarak eklenir).

---

## 3. Olay etkisi tablosu

`S` = saleable (`products.stock`) · `D` = damaged (`products.damaged_stock`) ·
`R` = `reserved_on_premise` · `ON_P` = toplam işletme fiziksel mevcudu.

| Olay | S | D | R | ON_P | Yeniden oluşturma kaynağı | Otomatik uzlaştırmaya girer mi |
|---|:--:|:--:|:--:|:--:|---|---|
| `INITIAL` (ürün/CSV ilk stok) | +n | — | — | **+n** | `stock_movements.created_at`, `ref_type='product'` | ✅ evet |
| `SALE` (ödeme) | −n | — | **+n** | **0** | `stock_movements`, `ref_type='order'`, `ref_line_id=order_items.id` | ✅ evet |
| `SALE_CANCEL` (çıkıştan önce iptal) | +n | — | −n | **0** | `stock_movements` + `order_status_history` | ✅ evet |
| `SALE_CANCEL` (çıkıştan **sonra** iptal) | +n | — | 0 | **belirsiz** | mal geri geldi mi bilinmiyor | ❌ **STALE** |
| `RETURN` (iade onayı) | +n | — | — | **belirsiz** | `order_returns.resolved_at`; **fiziksel kabul kaydı YOK** (§1.6) | ❌ **STALE** |
| `ADMIN_ADJUSTMENT` | ± | — | — | **belirsiz** | niyet bilinmiyor: veri düzeltmesi mi fiziksel kayıp mı | ❌ **STALE** |
| `COUNT_ADJUSTMENT` | ± | ± | — | **0** | veriyi fiziğe hizalar, fiziği değiştirmez | ✅ evet |
| `DAMAGE_TRANSFER` | −n | +n | — | **0** | `stock_damage_events` | ✅ evet |
| `DAMAGE_RECOVERY` | +n | −n | — | **0** | `stock_damage_events` | ✅ evet |
| `DAMAGE_DISPOSAL` | — | −n | — | **−n** | `stock_damage_events` | ✅ evet |
| `SUPPLIER_RETURN` | −n *veya* — | — *veya* −n | — | **−n** | `stock_damage_events` (kova alanı) | ✅ evet |
| **Paketleme** (`prepared_at`) | — | — | 0 | **0** | `orders.prepared_at` (`delivery_service.py:765`) | ✅ evet (etkisiz) |
| **Kurye teslim alma / tur başlangıcı** (`SHIPPED`) | — | — | **−n** | **−n** | `order_status_history` → `SHIPPED`, `delivery_runs.started_at` | ✅ evet |
| **Teslimat** (`DELIVERED`) | — | — | 0 | **0** (zaten çıkmıştı) | `orders.delivered_at` | ✅ evet (etkisiz) |
| **Teslim edilemedi → geri dönüş** | — | — | **+n** | **+n** | `order_status_history` `SHIPPED→PAID` + `failed_delivery_count` | ✅ evet |
| **Duraktan çıkarma** (`SHIPPED→PAID`) | — | — | +n | +n | `order_status_history` (`delivery_service.py:1044`) | ✅ evet |
| **Müşteri iadesinin fiziksel kabulü** | — | — | — | **+n** | **KAYIT YOK** — akış mevcut değil | ❌ **kapsam dışı / STALE** |
| Manuel DB değişikliği | ? | ? | ? | ? | kayıt yok | ❌ **STALE** |

**Kural:** yalnız "✅" satırları sayım sonrası otomatik uzlaştırmaya girer. Bir ürün için
sayım anı ile uygulama anı arasında "❌" bir olay geçtiyse **o satır `STALE`** olur ve
yeniden sayılmadan uygulanamaz. Matematiksel olarak bir sayı üretilebiliyor olması,
fiziksel gerçeğin bilindiği anlamına gelmez.

---

## 4. Uzlaştırma algoritması (rev. 1'in formülü **reddedildi**)

### 4.1 Neden rev. 1 yanlıştı

rev. 1 `düzeltme = (counted + sayım_sonrası_hareketler) − güncel_stok` diyordu ve
`sayım_sonrası_hareketler`'i **tüm `stock_movements`** üzerinden topluyordu. Yanlış:
`SALE` `products.stock`'u düşürür ama **fiziksel mevcudu değiştirmez** (§3). Bu formül
her satışı "kitap işletmeden çıktı" sayar ve sayımı bozar.

### 4.2 Doğru kurgu — kova bazlı, fiziksel etkiye göre

Sayım satırı `(product_id, bucket)` başınadır (§5.1). Uygulama anında, **ürün kilidi altında**:

```
# 1) Sayım anında beklenen fiziksel (satır snapshot'ından)
beklenen_sayim_aninda = expected_qty_snapshot + (bucket == SALEABLE ? reserved_qty_snapshot : 0)

# 2) Personelin bulduğu fiziksel fark — sayım ANINA ait, değişmez bir gerçek
fiziksel_fark = counted_qty - beklenen_sayim_aninda

# 3) Sayımdan bu yana geçen olaylar: yalnız ✅ olanlar; ❌ varsa satır STALE (uygulama durur)
#    (fiziksel_fark zaten "o anki" fark olduğundan, aradaki BİLİNEN olaylar
#     hem beklenen hem gerçek tarafı AYNI miktarda değiştirir ve farkı taşımaz.)

# 4) Deftere yazılacak delta
qty_delta = fiziksel_fark          # bucket'ın kendi kovasına
```

`qty_after` daima **kilit altındaki güncel bakiyeden** türer (`stock_ledger.apply_movement`
zaten böyle çalışıyor). **Hiçbir yerde mutlak atama yoktur**; snapshot yalnız operatöre
gösterilir ve `STALE` tespitinde kullanılır.

Kullanıcının senaryosu (stok 10, sayım sırasında 2 satış, personel 8 sayıyor):
`SALE` fiziksel mevcudu değiştirmediği için beklenen ON_PREMISE **10 kalır**; personel 8
saydıysa **gerçekten 2 kitap eksiktir** ve `−2` doğru düzeltmedir. Sistem 6'ya düşmez:
`qty_after` uygulama anındaki gerçek `stock`'tan (8) türeyip **6** olur — ki bu **doğrudur**,
çünkü 2 kitap fiziksel olarak kayıptır ve 2'si de rezervedir. `expected_on_premise`
yeniden hesaplandığında `6 + 0 + 2 = 8` = sayılan. ✔

### 4.3 `counted_at` güvenilirliği

* **Sunucu zamanı.** İstemciden saat, saat dilimi veya cihaz zamanı **kabul edilmez**;
  miktar başarıyla kaydedildiğinde `counted_at = now()` yazılır (`_now()` deseni).
* **Yeniden sayım:** miktar üzerine yazılır, `counted_at` **yenilenir**, `counted_by`
  güncellenir. Önceki değer `stock_count_line_events` (append-only, satır id + eski/yeni
  miktar + aktör + zaman) kaydında **korunur**; ayrıca `audit_service.record`
  (`action="inventory.count_line_recount"`) yazılır. Satır `STALE` ise yeniden sayım onu
  `COUNTED`'a döndürür (belirsizlik giderildi).
* Sayım ekranı offline çalışmaz; kayıt sunucuya ulaşmadan sayı "sayılmış" görünmez.

### 4.4 `STALE` politikası

Satır `STALE` olur:
1. sayım sonrası ürün için **fiziksel etkisi belirsiz** bir olay (§3 "❌"),
2. `order_status_history` veya ilgili referans **eksik/okunamıyor**,
3. paketleme/kurye durumu belirsiz (ör. açık durak var ama tur durumu tutarsız),
4. defter zinciri o ürün+kova için bozuk (`verify_ledger` bulgusu),
5. ürün oturum sırasında silinmiş/dijitale çevrilmiş.

`STALE` satır **yeniden sayılmadan** ya da gözden geçiren kişi tarafından **açıkça**
çözülmeden (`RESOLVED`, kim/ne zaman/gerekçe kaydıyla) oturum `APPLIED` olamaz (409).

---

## 5. Veri modeli

### 5.1 Sayım satırı: kova ayrımı — **tercih edilen model seçildi**

| Model | Karar |
|---|---|
| **(A) Satır = `(product_id, bucket)`** | ✅ **Seçilen.** Fark hangi kovaya yazılacak belli; hasarlı sayımı bağımsız yapılabilir; `UNIQUE(session_id, product_id, bucket)`; defter zinciri zaten kova bazlı olacak → birebir eşleşme |
| (B) Tek satırda `counted_saleable_qty` + `counted_damaged_qty` | ❌ İki alan tek satırda; kısmi sayım (yalnız hasarlı) modellenemez; `STALE` durumu kova bazlı ayrışamaz |
| (C) Tek `counted_qty`, farkı otomatik saleable'a yaz | ❌ **Direktifle yasaklandı** — tahmin |

Operasyonel gerçek (hasarlı ürünler fiziksel olarak ayrı bir kutuda durmuyorsa) **arayüzde**
çözülür: sayım ekranı önce "hasarlı var mı?" sorar, yoksa `DAMAGED` satırı `SKIPPED` kalır
ve `damaged_stock` **değişmez**. Veri modelinde tahmin yapılmaz.

### 5.2 Tablolar

```
stock_count_sessions
  id · code (SAYIM-2026-0001) · status · scope (ALL|CATEGORY|MANUAL) · category_id?
  note? · created_by_admin_id · created_at
  started_at? · submitted_at?
  reviewed_by_admin_id? · reviewed_at?
  applied_by_admin_id?  · applied_at?
  apply_idempotency_key?          -- retry replay'i için (§7.3)
  cancelled_by_admin_id? · cancelled_at? · cancel_reason?
  updated_at · deleted_at

stock_count_lines
  id · session_id · product_id · bucket ('SALEABLE'|'DAMAGED')
  expected_qty_snapshot           -- satır üretilirken stock / damaged_stock
  reserved_qty_snapshot           -- yalnız SALEABLE'da anlamlı (§2.3)
  snapshot_movement_id            -- o andaki son stock_movements.id
  counted_qty?  · counted_at? · counted_by_admin_id?
  status ('PENDING'|'COUNTED'|'STALE'|'RESOLVED'|'SKIPPED')
  stale_reason? · resolved_by_admin_id? · resolved_at? · resolution_note?
  note? · applied_movement_id?
  created_at · updated_at
  UNIQUE (session_id, product_id, bucket)

stock_count_line_events        -- append-only, yeniden sayım izi
  id · line_id · old_qty? · new_qty · actor_admin_id · created_at · note?

stock_damage_events            -- hasar işlemlerinin doğal kaynağı (idempotency için)
  id · product_id · kind ('TRANSFER'|'RECOVERY'|'DISPOSAL'|'SUPPLIER_RETURN')
  qty (>0) · source_bucket · reason_code · note? · actor_admin_id · created_at
```

`difference` **kolon değildir** — `counted_qty − (expected_qty_snapshot + reserved_qty_snapshot)`
olarak türetilir; kalıcı kolon ikinci bir doğruluk kaynağı yaratır ve bayatlar.

### 5.3 `products` ve `stock_movements` değişiklikleri

* `products.damaged_stock` (INTEGER NULL) — `(stock IS NULL) = (damaged_stock IS NULL)` CHECK'i
  ile `stock`'un NULL semantiğine bağlanır; `damaged_stock >= 0`.
* `stock_movements.bucket` (`'SALEABLE'|'DAMAGED'`, mevcut satırlar `'SALEABLE'` backfill).
* Zincir değişmezi **kova başına**: `qty_after[i] == qty_after[i-1] + qty_delta[i]`
  (`product_id, bucket` bazında).
* **Boş hasarlı kova geçerlidir:** `DAMAGED` kovasında hiç hareket yoksa **ve**
  `damaged_stock = 0` ise bu **doğru** kabul edilir; migration **sıfır `OPENING_BALANCE`
  satırı üretmez** (direktif). `verify_ledger` bu durumu bulgu saymaz; `damaged_stock <> 0`
  iken hareket yoksa **bulgudur**.
* Zincir doğrulaması: `SALEABLE` son `qty_after == products.stock`,
  `DAMAGED` son `qty_after == products.damaged_stock` (hareket yoksa `0`).

### 5.4 Yeni hareket türleri

| Tür | `qty_delta` | `bucket` | `ref_type`/`ref_id`/`ref_line_id` | `idempotency_key` |
|---|---|---|---|---|
| `COUNT_ADJUSTMENT` | ±, asla 0 | satırın kovası | `stock_count` / `session_id` / `line_id` | `count:{line_id}` |
| `DAMAGE_TRANSFER` | −n / +n | SALEABLE / DAMAGED | `damage_event` / `event_id` / — | `damage:{event_id}:{bucket}` |
| `DAMAGE_RECOVERY` | −n / +n | DAMAGED / SALEABLE | `damage_event` / `event_id` / — | `damage:{event_id}:{bucket}` |
| `DAMAGE_DISPOSAL` | −n | DAMAGED | `damage_event` / `event_id` / — | `damage:{event_id}:DAMAGED` |
| `SUPPLIER_RETURN` | −n | seçilen | `damage_event` / `event_id` / — | `damage:{event_id}:{bucket}` |

Gerekçe kodları (mevcut `ADMIN_ADJUSTMENT_REASONS` **bozulmadan**, ayrı sözlük):
sayım → `SAYIM_FAZLA` | `SAYIM_EKSIK`; hasar → `KIRIK` | `ISLAK` | `BASKI_HATASI` |
`MUSTERI_IADESI_HASARLI` | `DIGER`. `DIGER` → not zorunlu (mevcut `ck_stock_movements_note`,
`models/store.py:1085`).

### 5.5 Hasar değişmezleri (direktif birebir)

1. `DAMAGE_TRANSFER`: aynı transaction'da `S −q` **ve** `D +q`.
2. `DAMAGE_RECOVERY`: `D −q` **ve** `S +q`.
3. `DAMAGE_DISPOSAL`: `D −q`, `ON_P −q`.
4. `SUPPLIER_RETURN`: çıkılan kova `−q`, `ON_P −q`.
5. Transfer çiftinin **yalnız yarısı yazılamaz** — `apply_many` tek transaction.
6. İki hareket ortak `stock_damage_events.id` ile bağlıdır (`ref_type='damage_event'`).
7. Retry **bütün çifti** replay eder (aynı iki anahtar).
8. **Kısmi idempotency durumu invariant hatasıdır** → `PartialIdempotencyState` (mevcut
   istisna, `core/exceptions.py` 409'a çeviriyor); sessiz yutma yok.
9. `S` ve `D` **asla negatif** olamaz (`qty_after >= 0` CHECK, kova bazlı).
10. Dijital ürün **hiçbir kovada** izlenmez (`stock IS NULL` → `damaged_stock IS NULL`).
11. **Sıfır miktarlı olay yazılmaz** (`qty > 0` CHECK + `ck_stock_movements_delta`).

---

## 6. Durum makinesi ve yetkiler

### 6.1 Geçişler

```
DRAFT ──> IN_PROGRESS ──> REVIEW ──> APPLIED   (terminal)
              ▲              │
              └──────────────┘   (REVIEW → IN_PROGRESS: düzeltme için geri dön)

DRAFT | IN_PROGRESS | REVIEW ──> CANCELLED     (terminal)
```

| Soru | Cevap |
|---|---|
| Ürün ekleme/silme | Yalnız **DRAFT** ve **IN_PROGRESS** |
| Miktar değiştirme | Yalnız **IN_PROGRESS** |
| REVIEW'da değişiklik gerekirse | Zorunlu olarak **REVIEW → IN_PROGRESS**; `reviewed_by/at` **temizlenir** (eski onay yeni sayıyı kapsamaz) |
| `STALE` satır REVIEW'ı engeller mi | **Hayır** — `STALE`'ler REVIEW'da görünür. **APPLY'ı engeller** (409) |
| Boş oturum | Hiç `COUNTED` satır yoksa **REVIEW'a geçemez** (400). Tüm farklar 0 ise APPLY **serbesttir**: sıfır hareket yazılır, oturum `APPLIED` olur ("sayıldı, fark yok" değerli bir sonuçtur) |
| APPLIED tekrar uygulanırsa | Aynı `Idempotency-Key` → **idempotent replay** (kayıtlı sonuç döner, yeni hareket yok). Farklı/eksik anahtar → **409 "zaten uygulandı"** |
| APPLIED/CANCELLED sonrası | Geçiş **yok** |

`REVIEW → APPLIED` geçişi **koşullu UPDATE claim**'i ile alınır (`services/escrow.py:157`
deseni: `WHERE status='REVIEW'`), böylece "yarım APPLIED" ve çift uygulama **veritabanı
seviyesinde** imkânsızdır.

### 6.2 Maker-checker (hazır, kapalı)

`counted_by/at` · `reviewed_by/at` · `applied_by/at` **ayrı** alanlar. Ayar
`INVENTORY_REQUIRE_SEPARATE_APPROVER` (varsayılan **`false`**):
`true` iken aynı admin, kendi saydığı satırı içeren oturumu **REVIEW veya APPLY edemez**
(409 + açık mesaj). Varsayılan davranış: **tek yetkili admin süreci baştan sona tamamlar.**
Karar her hâlde audit'e yazılır.

### 6.3 İzinler ve eksiksiz kablolama

| İzin | Kapsam |
|---|---|
| `inventory.view` | Oturum/satır/hasar geçmişini görme |
| `inventory.count` | Oturum açma, ürün ekleme, miktar girme, gönderme, kendi oturumunu iptal |
| `inventory.apply` | REVIEW'lama, farkı uygulama, hasar işlemi, başkasının oturumunu iptal |

**Reddedilen alternatif:** `products.view/manage` yeniden kullanımı. Stok defteri paketinde
(salt-okunur ekran) doğruydu; F29 *envanteri değiştiren* bir yetkidir ve ürün metni
düzenlemeyle aynı kutuya konmamalıdır.

**Kablolama listesi (yarım izin = sessiz 403; `core/admin_permissions.py:1-13`):**

| # | Yer | İş |
|---|---|---|
| 1 | `core/admin_permissions.py:52` (katalog sonu) | 3 kod, grup **Ticaret** |
| 2 | Yeni migration (`266eeeac2a47` şablonu) | `admin_permissions` idempotent INSERT + `ROLE_GRANTS` |
| 3 | Rol dağıtımı | `SUPER_ADMIN`: üçü de · **`COMMERCE_MANAGER`**: üçü de (mağaza operasyonunun sahibi, `7121d6785a32:59`) · `OPERATIONS_MANAGER`: `inventory.view` · diğerleri: yok |
| 4 | `api/routers/inventory.py` (yeni) | Her uçta `Depends(require_admin_permission(...))`, izin bağımlılığı **imzanın başında** (commit 6 deseni) |
| 5 | `api/router.py` | Router include |
| 6 | `frontend/src/lib/adminNavigation.ts` + `adminAreaAccess` | Yeni `inventory` alanı; menü görünürlüğü |
| 7 | `AdminStore.tsx` `TAB_AREA` | "Sayım" sekmesi izinle filtrelenir |
| 8 | Buton/aksiyon görünürlüğü | `canCount` / `canApply` ile "Uygula", "Hasar işlemi", "İptal" butonları |
| 9 | `tests/test_admin_permission_catalog.py` | Router↔katalog eşleşmesi (mevcut test otomatik kapsar) |
| 10 | Doğrulama paketi (`tests/verify`) | Katalog↔DB eşleşmesi |

**Gerçek HTTP testleri:** anonim → **401** · izinsiz admin → **403** · yalnız
`inventory.view` olan admin: liste **200**, miktar girme **403**, uygulama **403** ·
`inventory.count` olan: uygulama **403** · `inventory.apply` olan: hepsi **200**.
"Giriş yapabilen ama işlem yapamayan admin" senaryosu ayrı test.

---

## 7. Eşzamanlılık, kilit sırası, atomiklik

### 7.1 Mevcut kilit grafiği (yeniden çıkarıldı — dosya:satır)

| Yol | Sıra | Kanıt |
|---|---|---|
| Ödeme kesinleşmesi (`_finalize_paid`) | **Product → Order** | `order_service.py:618` `lock_products` → `:640` `escrow.claim` (Order UPDATE) |
| Sipariş iptali / iade (`_refund_payment`) | **Product → Order** | `_lock_order_products:1233` → `order_fsm` `:52` FOR UPDATE |
| Tam geri yükleme (`_restock`) | **Product** | `:1246`, `:1269` |
| Kısmi iade (`_restock_items`) | **Product → OrderReturn** | `:1717`, `:1741` |
| Sipariş durum geçişi | **Order** | `order_fsm.py:52` |
| Teslimat durak işlemleri | **Order → DeliveryStop** | `delivery_service.py:1464` → `:1467`; `order_service.py:975` → `:1053` |
| Kupon | **Coupon** | `coupon_service.py:115,155` |
| Admin ürün düzeltmesi | **Product** | `store_service.py:819` |
| Admin rol/izin | **AdminRole / Admin** (ayrık altsistem) | `admin_access_service.py:220,303,324` |

**Product kilidi alan tek yer** `stock_ledger.lock_products` (`:564`, `:598`); `apply_many`
(`:697`) onu çağırır ve **kilitlerin tek sahibidir**.

### 7.2 F29'un yeri

```
StockCountSession → Product → Order → OrderReturn → DeliveryStop → Coupon
StockDamageEvent  → Product
```

**Neden döngü yok — sadece "başa ekledik" değil:**
* Bugün **hiçbir** üretim yolu `StockCountSession` ya da `StockDamageEvent` kilitlemiyor
  (tablolar yok); yukarıdaki 9 yolun hiçbiri bu kaynaklara dokunmayacak.
* Ters yön (`Product → StockCountSession`) **yasaklanır**: sayım/hasar servisleri
  kilit almadan önce **daima** önce kendi kaynaklarını claim eder. Uygulama akışı:
  1. `REVIEW → APPLIED` koşullu UPDATE claim'i (session satır kilidi),
  2. `lock_products(db, sorted(ids))` — **tek çağrı**, artan `id`,
  3. hesap + `apply_many` (tek transaction),
  4. satır/oturum damgaları + audit.
* Uçlar session'ı **kilitsiz** ORM okumasıyla yükler (görüntüleme); kilit **yalnız** claim
  anında alınır. "Önce ORM ile session kilitle, sonra product" yolu **yazılmaz**.

**Sözleşme nasıl korunacak:** AST/kaynak taraması **tek başına yeterli sayılmaz** (repo
test standardı §C). Gerçek PostgreSQL **ters başlangıç sıralı** eşzamanlılık testleri
(`lock_timeout` + 40P01/deadlock ve 55P03/timeout kodlarının **yokluğu**), her çift için
3 tur:

| Çift | A yolu | B yolu (ters başlangıç) |
|---|---|---|
| 1 | Sayım uygula (Session→Product) | Ödeme kesinleşme (Product→Order) |
| 2 | Sayım uygula | Admin stok düzeltme (Product) |
| 3 | Sayım uygula | Kısmi iade geri yükleme (Product→OrderReturn) |
| 4 | Hasar transferi (DamageEvent→Product) | Ödeme kesinleşme |
| 5 | İki eşzamanlı sayım uygulaması (aynı ürün) | — |

### 7.3 Atomiklik ve retry

* **Tek transaction.** Tüm satırların hareketleri `apply_many` ile birlikte yazılır;
  herhangi biri geçersizse (STALE / dijital / yetersiz bakiye / çatışma) **hiçbiri** yazılmaz.
* `APPLIED` yalnız tüm hareketler **ve** bakiyeler yazıldıktan sonra oluşur (aynı transaction).
* **Retry:** istek `Idempotency-Key` taşır. Anahtar `stock_count_sessions.apply_idempotency_key`
  ile eşleşiyorsa **replay** (kayıtlı sonuç, yeni hareket yok). Satır bazlı anahtarlar
  (`count:{line_id}`) ikinci savunmadır: `apply_many` mevcut hareketi döndürür.
* **Kısmi uygulama yoktur.** Büyük operasyon → kategori/grup bazlı **birden fazla küçük oturum**.

---

## 8. Arayüz

| Ekran | İçerik |
|---|---|
| Sayım oturumları `/yonetim/magaza/sayim` | `DataTable` + sunucu sayfalama; durum/tarih/oluşturan filtresi |
| Yeni sayım | Kapsam (tüm katalog / kategori / elle seçim) + not |
| Sayım girişi (mobil) | SKU/barkod arama, odak-koru + `Enter` ile sıradaki, büyük dokunma hedefleri; kova sekmesi (satılabilir / hasarlı); "hasarlı var mı?" adımı |
| Gözden geçirme | `beklenen (S) + rezerve + hasarlı = beklenen ON_PREMISE` · sayılan · fark; `STALE` satırlar üstte, gerekçesiyle; "yeniden say" / "açıkça çöz" |
| Uygula onayı | `ConfirmDialog`: satır sayısı, net etki, geri alınamaz uyarısı; `STALE` varken **disabled** |
| Hasarlı işlem | Ürün + kova + adet + gerekçe + not; transfer / geri kazanım / imha / tedarikçi iadesi |
| Oturum geçmişi | Satırlar + üretilen hareketlere derin bağlantı (`…/stok-hareketleri?ref_type=stock_count&ref_id=…`) |

Barkod okuyucu klavye emülasyonuyla çalışır; **F30'un QR/pick akışı bu pakete girmez.**
`StockLedgerPanel` satılabilir/hasarlı ayrımını gösterecek şekilde genişler.
Karanlık mod pariteli, kart enflasyonsuz. **Parasal değer gösterilmez.**

---

## 9. Test matrisi

**Commit 1 = yalnız test matrisi, kırmızı.**

### 9.1 Gerçek PostgreSQL — eşzamanlılık ve fizik
| # | Senaryo | Beklenen |
|---|---|---|
| C1 | Sayım açık; arada **SALE**; personel beklenen ON_PREMISE kadar saymış | Fark **0**, hareket **yazılmaz** (SALE fiziği değiştirmez) |
| C2 | Aynı, personel 2 eksik saymış | `−2` yazılır; `expected_on_premise` sayılanla eşitlenir |
| C3 | Sayım sonrası **`RETURN`** (iade onayı) | Satır **STALE**, uygulama 409 |
| C4 | Sayım sonrası **`SHIPPED`** (tur başladı) | ✅ otomatik uzlaştırma; fark taşınmaz, uygulama geçer |
| C5 | Sayım sonrası **`ADMIN_ADJUSTMENT`** | Satır **STALE** |
| C6 | İki eşzamanlı "Uygula" | Biri APPLIED, diğeri 409; hareketler **tek kez** |
| C7 | Ters kilit sırası çiftleri (§7.2, 5 çift × 3 tur, `lock_timeout`) | Deadlock/timeout **yok** |
| C8 | Hasar transferi yarıda kesilip retry | Tek çift satır; `PartialIdempotencyState` **yok** |
| C9 | Hasarlı adedi aşan imha | `InsufficientStock` → **409**, 500 değil |
| C10 | Aynı ürüne ikinci açık oturum | Kısmi UNIQUE index → 409 |
| C11 | `APPLIED` oturumu aynı `Idempotency-Key` ile tekrar uygula | **Replay**, yeni hareket yok |
| C12 | `APPLIED` oturumu yeni istekle uygula | **409 "zaten uygulandı"** |
| C13 | Tüm farklar 0 olan oturum | `APPLIED`, **0 hareket** |
| C14 | Boş hasarlı kova (hiç hareket, `damaged_stock=0`) | `verify_ledger` **bulgu üretmez** |
| C15 | `damaged_stock<>0` ama hareket yok | `verify_ledger` **bulgu üretir** |

### 9.2 Gerçek HTTP + yetki
§6.3'teki 401/403/200 matrisi · maker-checker açıkken kendi oturumunu uygulama 409 ·
dijital üründe sayım satırı/hasar işlemi 400 · başkasının oturumunu iptal 403.

### 9.3 Gerçek DOM
`STALE` satır kırmızı + gerekçe görünür · "Uygula" butonu `STALE` varken **disabled** ·
üç bileşenli beklenen ON_PREMISE görünür · `ConfirmDialog` olmadan istek gitmez ·
kova sekmesi ayrımı · `isError` yolları · **hiçbir ekranda tutar/para alanı yok**.

### 9.4 Gerçek Chrome kabul turu
Oturum aç → 3 ürün + hasarlı kova say → arada gerçek sipariş öde (C1) → başka üründe iade
onayla (C3) → gözden geçir: biri temiz, biri STALE → STALE'i yeniden say → uygula →
DB'de hareketler/bakiyeler doğrula → hareket listesinde `ref_type=stock_count` ile bul →
hasar transferi yap → ürün detayında satılabilir/hasarlı ayrımını gör.

### 9.5 Nöbetçiler
Satır üretimi ve liste **N+1 yok** (`before_cursor_execute` sayacı; `reserved_on_premise`
**tek** `GROUP BY`) · zorunlu sayfalama + tavan · deterministik sıralama ·
hijyen nöbetçisi (`_KRITIK_TABLOLAR`'a 4 yeni tablo) · TB-1 sapma nöbetçisi yeni
kolonları da kapsar.

### 9.6 Mutasyon provası
| # | Mutasyon | Yakalayan |
|---|---|---|
| M1 | `lock_products` çağrısını kaldır | C7 |
| M2 | Snapshot farkını güncel stoğa **kör** uygula (rev. 1 formülü) | C1 |
| M3 | `APPLIED` claim kontrolünü kaldır | C6, C12 |
| M4 | Sıfır farkta hareket yaz | C13 + `ck_stock_movements_delta` |
| M5 | Dijital ürün kontrolünü kaldır | 9.2 |
| M6 | Aynı oturumu iki kez uygula | C6 |
| M7 | Hasar transferinin **karşı kovasını** yazma | C8 + kova zinciri |
| M8 | Yetki kontrolünü kaldır | 9.2 |
| M9 | `reserved_on_premise`'i hesaba katma | C1 |
| M10 | `RETURN`'ü "✅ otomatik uzlaştırılabilir" say | C3 |
| M11 | `counted_at`'i istemciden al | 9.2 (sunucu zamanı iddiası) |

Sürücü `scripts/mutation_drill.py`; **yalnız test DB'sine karşı**. Mutasyon **migration'a
mı DB'ye mi** uygulandığı ayırt edilir — TB-1'de `alembic downgrade` ile yapılan mutasyon,
conftest'in koşulsuz `upgrade head`'i yüzünden yakalanmıyordu; aynı tuzağa düşülmeyecek.

---

## 10. Migration ve geri alma

Tek revizyon, `down_revision = tb1_order_returns_reason_default`:

1. `products.damaged_stock` + backfill (`stock IS NOT NULL` → `0`) + 2 CHECK
2. `stock_movements.bucket` → `'SALEABLE'` backfill → NOT NULL + CHECK
3. `ck_stock_movements_type` DROP + yeniden yarat (5 yeni tür)
4. `ix_stock_movements_product` → `(product_id, bucket, created_at DESC, id DESC)`
5. `stock_count_sessions`, `stock_count_lines`, `stock_count_line_events`,
   `stock_damage_events` + index'ler (`UNIQUE(session_id, product_id, bucket)`;
   ürün başına tek açık oturum için kısmi UNIQUE)
6. `admin_permissions` 3 kod + `ROLE_GRANTS` (`266eeeac2a47` şablonu, idempotent)

**Sıfır `OPENING_BALANCE` üretilmez** (§5.3).

**Downgrade:** yeni türde **veya** `DAMAGED` kovasında hareket varsa `RuntimeError` ile
**reddeder** (append-only trigger DELETE'i zaten engelliyor; sessizce kırık şema
bırakmaktansa açıkça durur). Hareket yoksa 6→1 ters sırayla temiz döner.
Doğrulama: tek kullanımlık DB'de `upgrade → downgrade → upgrade` + "hareket varken
downgrade reddedilir" testi (TB-1'de kullanılan yöntem).

**Üretim rollback stratejisi:** uygulanmış sayım farkları **gerçek envanter olaylarıdır**,
veri geri alınmaz. Geri alma yalnız **kod** seviyesinde yapılır; migration DB'de kalır.
Eski kod `bucket`/`damaged_stock` kolonlarını hiç okumadığı için bozulmaz — bu, **"önce
migration, sonra kod"** dağıtım sırasını zorunlu kılar.

---

## 11. Commit serisi

| # | İçerik | Beklenen test durumu |
|---|---|---|
| 1 | **Bu plan** (docs) | — |
| 2 | Test matrisi (§9), çalıştırılabilir | **kırmızı** |
| 3 | Model + migration (§10); disposable DB'de up/down | 2 kırmızı kalır |
| 4 | `stock_ledger` kova boyutu (`verify_ledger`/`audit_products`/`list_movements`/index); mevcut 6 tür bozulmaz | mevcut 260 test yeşil kalır |
| 5 | Sayım servisi + FSM + uzlaştırma + kilit sırası | C1-C7, C10-C15 yeşil |
| 6 | Hasar olayları + 4 işlem + idempotency | C8, C9 yeşil |
| 7 | Uçlar + izin kablolaması (10 adım) + audit | 9.2 yeşil |
| 8 | Admin arayüzü (7 ekran) + hook/istemci | 9.3 yeşil |
| 9 | Mutasyon provası + gerçek Chrome turu + kapanış raporu | 9.4, 9.6 |

Her commit ayrı onay bekler.

---

## 12. Bilinen sınırlar (dürüst beyan)

1. **Mal kabul akışı yok** → onaylanmış ama fiziksel gelmemiş iade, sayımda belirsizlik
   üretir; ilgili satır `STALE` olur (§1.6, §3). Kalıcı çözüm F12/★ paketindedir.
2. **F30 olmadığı için** raf / paketleme masası / hazır paket ayrıştırılamaz; hepsi tek
   `ON_PREMISE` büyüklüğünde toplanır (§2.4).
3. **Parasal değerleme yok** (direktif). İleride "tahmini perakende karşılığı" gösterilecekse
   bu **maliyet/zarar/muhasebe değeri olarak kaydedilmez**; F29 veri modeline tutar alanı
   eklenmez.
4. Sayım, işletme sakinken yapılmalıdır; yoğun saatte yapılan sayımda `STALE` oranı artar —
   bu bir hata değil, **belirsizliğin dürüst raporlanmasıdır**.
