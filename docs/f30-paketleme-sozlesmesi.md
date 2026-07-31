# F30 — Sipariş Hazırlama, Paketleme ve QR Doğrulama Sözleşmesi

> Durum: **plan + kırmızı test matrisi** (üretim kodu yazılmadı).
> Zemin: `253f0db` (F29 kapanışı). Dal: `f30-paketleme-qr`.
>
> Bu belge F30'un **sözleşmesidir**. Kod ile belge çelişirse belge kazanır;
> davranış bilinçli değişiyorsa önce burası güncellenir.

---

## 1. Mevcut akış (koddan çıkarıldı, doğrulandı)

Ödenmiş fiziksel siparişin bugünkü yolculuğu:

```
create_order ─charge─> _finalize_paid                      order_service.py:589
  ├─ lock_products (FOR UPDATE, kanonik sıra)              order_service.py:618
  ├─ escrow.claim  PENDING|FAILED → payment_status=PAID    order_service.py:645
  ├─ order_fsm     PENDING → PAID                          order_service.py:660
  ├─ promised_delivery_date (16:00 cutoff + kapasite)      order_service.py:664
  └─ stock_ledger  SALE / SALEABLE / ORDER_PAID            order_service.py:703
        └─ idempotency: order_item:{id}:SALE

PAID + has_physical + ship_in_zone + prepared_at IS NULL
  → prep_queue                                             delivery_service.py:656
  → [ADMIN tek tık] mark_prepared → prepared_at damgası    delivery_service.py:743
PAID + prepared_at IS NOT NULL + açık durak yok
  → eligible_orders                                        delivery_service.py:780
  → add_stops → DeliveryStop(qr_token=token_urlsafe(24))   delivery_service.py:1015
  → start_run → HER durak: order PAID → SHIPPED            delivery_service.py:467
                tracking_no = ELDEN-R{run}-S{stop}
  → kapıda POST /delivery/scan (salt SELECT, iz yok)       delivery_service.py:1796
  → verify(OTP) / deliver_drop(foto) → DELIVERED           delivery_service.py:1626
  → fail_stop → SHIPPED → PAID, prepared_at = None         delivery_service.py:1720
```

F29 tarafında fiziksel gerçeğin muhasebesi:

```
reserved_on_premise = Σ order_items.quantity
  WHERE orders.payment_status='PAID' AND orders.status='PAID'   inventory_service.py:136
on_premise = saleable + damaged + reserved                      inventory_service.py:116
PHYSICAL_EFFECT["SALE"]            = (-1, 0, +1,  0, True)      inventory_rules.py:61
PHYSICAL_EFFECT["ORDER_PREPARED"]  = ( 0, 0,  0,  0, True)      inventory_rules.py:77
PHYSICAL_EFFECT["ORDER_SHIPPED"]   = ( 0, 0, -1, -1, True)      inventory_rules.py:78
PHYSICAL_EFFECT["DELIVERY_FAILED"] = ( 0, 0, +1, +1, True)      inventory_rules.py:80
```

**Okunması gereken sonuç:** F29 zaten "paketleme fiziksel mevcudu değiştirmez"
(`ORDER_PREPARED` = 0,0,0,0) ve "işletmeden çıkış anı SHIPPED'dir"
(`ORDER_SHIPPED` = reserved −1, on_premise −1) diyor. F30'un yeni bir muhasebe
kavramı icat etmesine gerek yok; **eksik olan, bu iki olayın fiziksel bir kanıta
dayanması.**

---

## 2. Bulunan gerçek boşluklar

| # | Boşluk | Kanıt | Sonuç |
|---|---|---|---|
| **G1** | Toplama doğrulaması yok. `prepared_at` tek tıkla damgalanır; hangi kalemin toplandığı hiçbir yerde tutulmaz. | `delivery_service.py:743-777` | Eksik/yanlış/fazla ürün sistemsel olarak imkânsız değil — hiç kontrol edilmiyor. |
| **G2** | Kalemde okutulabilir kimlik yok. `OrderItem` yalnız `title`/`quantity` taşır; `product_id` **nullable + SET NULL**. Durak/eligible çıktısı da yalnız `title`+`quantity`. | `models/store.py:625-676`, `delivery_service.py:149-153,634-638` | Paketleme ekranı "ne okutulacak"ı üretemez. |
| **G3** | Paket kimliği yok; QR **durağa** ait. `qr_token` durak yaratılırken doğar, durak silinince/tur iptal olunca kaybolur. | `delivery_service.py:1015-1021`, `models/delivery.py:207` | 2. teslim denemesinde **fiziksel paketin üstündeki basılı etiket geçersizdir** — kurye 404 alır. |
| **G4** | Kurye zimmeti yok. `start_run` (ADMIN butonu) tek hamlede tüm siparişleri SHIPPED yapar; hiçbir paket okutulmaz. Kurye `start_run`'a erişemez bile. | `delivery_service.py:439-495`, `routers/delivery.py:420` | Sistem "işletmeden çıktı" der; fiziksel kanıt sıfır. Eksik paket görünmez. |
| **G5** | Geri dönüş kaydı yok. `fail_stop` `prepared_at=None` yazar — yorumu "paket depoya geri döndü" der ama bu bir **varsayımdır**, doğrulama değil. | `order_service.py:158-161` | Araçta unutulan/kaybolan paket envanterde "işletmede" görünür. |
| **G6** | `POST /delivery/scan` hiçbir iz bırakmaz (salt SELECT); audit yok, "tarandı" damgası yok, çift tarama kavramı yok. | `delivery_service.py:1796-1811`, `routers/delivery.py:548` | Tarama bir olay değil, bir arama. |
| **G7** | `mark_prepared` `FOR UPDATE` almaz; iptal ile yarışabilir. | `delivery_service.py:750-775` | İptal edilen sipariş "hazır" damgalanabilir. |
| **G8** | CANCELLED/REFUNDED hazırlanmış paketi fiziksel olarak çözmez. `order_fsm` yalnız durağı kapatır. | `order_fsm.py:41-57,91-92` | Raflara dönmesi gereken paket kimsenin görevi değil. |
| **G9** | Etikette basılı ölçü sözleşmesi yok: `size=96`, `level` varsayılan (`"L"`), sabit fiziksel boyut yok. | `LabelSheet.tsx:60` | Aynı sınıf hata daha önce yaşandı (uzun başlık QR'ı ezdi). |

---

## 3. Kararlar (denetçi sorularına doğrudan cevap)

### 3.1 Paket ayrı bir tablo/varlık mı? → **EVET, ayrı varlık.**

`Order`'a kolon eklemek yetmez, üç sebeple:

1. **Ömür farkı.** Bir siparişin ömrü boyunca birden çok paket olabilir (paket
   bozulur → yeni paket). Kolon tek örneği tutar, geçmişi kaybeder.
2. **Yarış otoritesi.** "İki operatör aynı siparişi paketleyemez" garantisinin
   DB'de bir yeri olmalı. Kısmi unique index bunu yapar; kolon yapamaz
   (`uq_order_packages_live`).
3. **Kalem bazlı iz.** Toplanan adet satır bazlıdır; kolona sığmaz.

Üç yeni tablo:

| Tablo | Ne tutar |
|---|---|
| `order_packages` | Paketin kimliği, FSM durumu, QR token'ı, aktör+zaman damgaları |
| `order_package_items` | Paket satırı: `expected_qty` / `scanned_qty` + SKU/barkod snapshot'ı |
| `package_scan_events` | Append-only tarama izi (kabul + **red** dahil), idempotency |

### 3.2 Sipariş durumu ekleniyor mu? → **HAYIR. Ayrı paket FSM'i.**

`OrderStatus`'e `PACKED`/`PREPARED` **eklenmez**. Gerekçe koddan:

- `reserved_on_premise` yalnız `status='PAID'` sayar (`inventory_service.py:134`).
  Yeni bir ara statü, paketlenmiş siparişi sessizce rezerveden düşürür →
  **stok farkı**.
- `ix_orders_fulfillment_queue` kısmi index'i `status='PAID'` ile tanımlı
  (`models/store.py:574-581`); yeni statü index'i devre dışı bırakır.
- `prep_queue` / `eligible_orders` / `attention_orders` / `outsourced_orders` /
  `dispatch_day` kapasite sorguları — hepsi `Order.status == "PAID"` yazar
  (`delivery_service.py:668,805,708,963`).
- `ALLOWED_ORDER_TRANSITIONS` tek geçiş otoritesidir (`order_fsm.py:24`);
  araya statü sokmak dört ayrı geri-sarım yolunu (fail/cancel_run/watchdog/
  postpone) yeniden yazmayı gerektirir.

Paket FSM'i **sipariş FSM'inden bağımsız** yaşar ve sipariş durumuna yalnız
tek noktada dokunur (§3.4).

```
        ┌──────────── void ───────────┐
        ▼                             │
OPEN ──complete──▶ PACKED ──handover──▶ HANDED_OVER ──deliver──▶ DELIVERED ✦
 │                  ▲  │                     │
 │                  │  └──── void ───▶ VOID ✦│
 │                  │                        │
 │              repack                  fail / cancel_run /
 │                  │                   watchdog / postpone
 │                  │                        │
 └─ void ─▶ VOID ✦  └── RETURNED ◀─return_in─┴─▶ RETURN_PENDING
                         │
                         └── void ──▶ VOID ✦          ✦ = terminal
```

**Fiziksel anlam tablosu** (`packing_rules.PACKAGE_LOCATION`, saf veri):

| Durum | Konum | İşletmede sayılır mı |
|---|---|---|
| `OPEN` | ON_PREMISE | evet (henüz raftan toplanıyor) |
| `PACKED` | ON_PREMISE | evet (hazır, çıkış bekliyor) |
| `HANDED_OVER` | OFF_PREMISE | **hayır** (kuryede) |
| `RETURN_PENDING` | OFF_PREMISE | **hayır** (kuryede, geri bekleniyor) |
| `RETURNED` | ON_PREMISE | evet (geri geldi, doğrulandı) |
| `DELIVERED` | CUSTOMER | hayır |
| `VOID` | DISSOLVED | paket yok (içerik rafta) |

Canlı küme = `{OPEN, PACKED, HANDED_OVER, RETURN_PENDING, RETURNED}`.

### 3.3 Paket QR'si ne zaman oluşur, ne zaman geçersizleşir?

- **Oluşur:** paket açılırken (`OPEN`), `secrets.token_urlsafe(24)`,
  `order_packages.qr_token` UNIQUE. Durağa değil **pakete** aittir.
- **Geçersizleşir:** yalnız paket terminal olunca (`DELIVERED` / `VOID`).
  Tur iptali, durak silme, teslim edilememe, yeniden planlama QR'ı
  **geçersizleştirmez** — G3 tam olarak budur. Aynı fiziksel etiket paketin
  ömrü boyunca geçerlidir.
- **Format (sürümlü, ayrı uzay):**

  ```
  paket : PKG1:{package_id}:{token}     ← F30, yeni
  durak : {stop_id}:{token}             ← mevcut, DEĞİŞMEZ
  ```

  `delivery_service.parse_qr_token` (`delivery_service.py:74`) `":"`'dan böler;
  önek olmasa paket token'ı sessizce durak token'ı gibi ayrıştırılırdı.
  `PKG1:` öneki bu çakışmayı **yapısal olarak** kapatır:
  `packing_rules.parse_package_qr(payload)` yalnız bu önekle çözer, aksi
  `None` döner. `POST /delivery/scan` önce paketi dener, `None` ise mevcut
  durak yoluna düşer (geriye uyum: basılmış eski etiketler çalışmaya devam eder).

- **İnsan okunur kod:** `PKT-{id:06d}` — **türetilmiş**, kolon değil (etikette
  ve telefonda okunur; tekilliği `id` sağlar).

### 3.4 Kurye teslim alma ile SHIPPED ilişkisi

**SHIPPED, zimmet anına taşınır.** F29'un `ORDER_SHIPPED` tanımı
(`reserved −1, on_premise −1`) ancak o zaman fiziksel gerçeğe karşılık gelir.

| Bugün | F30 |
|---|---|
| `start_run` (ADMIN butonu) tüm durakları toplu `PAID→SHIPPED` yapar | `handover_scan` (kurye QR okutur) **paket başına** `PAID→SHIPPED` yapar |
| `tracking_no` + takip SMS'i `start_run`'da | `tracking_no` + takip SMS'i zimmette |
| `add_stops` aktif tura eklerken de SHIPPED yapar | `add_stops` **SHIPPED yapmaz** |
| `start_run` ön koşulsuz | `start_run` PENDING durakların **hepsi zimmetli** değilse 409 + eksik paket listesi |

Sonuç: `on_premise` çıkışı artık bir butona değil, kuryenin elindeki paketi
okutmasına bağlı.

### 3.5 İptal / refund / tur iptali / teslim edilemeyen paket nasıl geri döner?

Tek kural: **paket, konumu neyse ona uygun yola girer.** ON_PREMISE ise
doğrudan çözülür; OFF_PREMISE ise önce geri gelmesi beklenir.

| Olay | Paket ON_PREMISE (`OPEN`/`PACKED`/`RETURNED`) | Paket OFF_PREMISE (`HANDED_OVER`) |
|---|---|---|
| Sipariş `CANCELLED` / `REFUNDED` | → `VOID` (`order_fsm` içinde, `_close_open_stops` ile aynı yerde) | → `RETURN_PENDING` (kurye geri getirecek), dönüşte `RETURNED` → operatör `void` |
| `fail_stop` (teslim edilemedi) | — | → `RETURN_PENDING` |
| `cancel_run` / `expire_stale_runs` | — | → `RETURN_PENDING` |
| `postpone_delivery` (müşteri erteledi) | — | → `RETURN_PENDING` |

Geri dönüş fiziksel olarak **okutularak** kapanır:

```
RETURN_PENDING ──[depo: QR okut] return_in──▶ RETURNED   (ON_PREMISE'a döner)
RETURNED ──[operatör onayı] repack──▶ PACKED             (prepared_at yeniden damgalanır → eligible)
RETURNED ──[operatör onayı] void──▶ VOID                 (paket bozulacak)
```

`VOID` paketin fiziksel çözülmesi ayrı bir damgadır: `unpacked_at`. Ekranda
"bozulmayı bekleyen paketler" = `status='VOID' AND unpacked_at IS NULL`.
G8 bu kuyrukla kapanır. **Stok hareketi yazılmaz** — iptal/iade yolunda
`_restock` zaten `SALE_CANCEL` yazmıştır (`order_service.py:1249`); paketi
bozmak muhasebesel değil fiziksel bir iştir.

`prepared_at` yazıcıları F30'dan sonra **yalnız** `complete` ve `repack`;
sıfırlayıcıları `roll_promise_after_failed_attempt` (mevcut, değişmez) ve
`void`. Elle `POST /delivery/orders/{id}/prepare` ve `/unprepare` **kaldırılır**
— iki kapı bırakmak "eksik kalem kabul edilmez" ilkesini boşa çıkarır.

### 3.6 SKU / barkod snapshot stratejisi

**`OrderItem`'a kolon EKLENMEZ.** Gerekçe: `OrderItem` mali snapshot'tır (fatura
tutarlılığı); geçmiş yüz binlerce satırı geriye dönük dolduramayız ve
dolduramadığımız satır yalancı güven üretir.

Snapshot **paket satırında** alınır — paket açılırken, o anki üründen:

```
order_package_items.sku      ← products.sku      (NOT NULL, trigger üretir, immutable)
order_package_items.barcode  ← products.barcode  (nullable, yalnız insan girdisi)
order_package_items.title    ← order_items.title (mali snapshot'tan)
```

Eşleştirme sırası (`packing_rules.match_code`, saf):

1. `barcode` birebir (varsa) — fiziksel kalemin üstündeki EAN/UPC
2. `sku` birebir (`FZK-000042`) — bizim ürettiğimiz, her zaman dolu
3. eşleşme yok → `WRONG_SKU`

**`product_id IS NULL` olan geçmiş kalem** (ürün silinmiş): SKU/barkod okunamaz.
Satır `scannable=False` işaretlenir ve **yalnız kontrollü manuel doğrulama** ile
kapanır: gerekçe zorunlu, `result='OK_MANUAL'`, `package_scan_events`'e ve
`audit_logs`'a yazılır. Sessiz geçiş yok.

`ISBN` barkod yerine **kullanılmaz** — `models/store.py:254-261` bunu zaten
gerekçelendiriyor (set ürün, ISBN-10 dönüşümü, promosyon barkodu). O gerekçeyi
delmiyoruz.

---

## 4. F30 sözleşmesi (kapsam)

### 4.1 Kapsam İÇİ

1. Paket varlığı + kalem bazlı toplama doğrulaması (barkod/SKU/kontrollü manuel)
2. Eksik / yanlış / fazla ürün reddi (uygulama **ve** DB CHECK seviyesinde)
3. Kalıcı paket QR'ı + tek paket etiketi (baskı sözleşmesiyle)
4. Kurye zimmeti (QR ile) + `SHIPPED`'in zimmete taşınması
5. Geri dönüş akışı (`RETURN_PENDING → RETURNED → repack|void`)
6. İptal/iade sonrası paket çözümü + "bozulacak paketler" kuyruğu
7. Idempotency (tarama, tamamlama, zimmet) + STALE/conflict tespiti
8. `packing.view` / `packing.pack` / `packing.manage` izinleri (katalog + migration)
9. Kritik işlemlerin tamamında aktör + zaman + gerekçe audit'i
10. Admin paketleme ekranları + kurye zimmet ekranı

### 4.2 Kapsam DIŞI (bilinçli)

| Konu | Neden |
|---|---|
| Çoklu paket / parça bölme (1 sipariş = N kutu) | Bir sipariş = bir paket varsayımı. Adana içi kitap siparişi tek kutuya sığıyor; V2. |
| Bölge dışı (dış kargo) siparişlerin paketlenmesi | O kuyruk zaten manuel (`outsourced_orders`); kargo API'si şirket+sandbox sonrası. |
| Desi / ağırlık / ambalaj malzemesi yönetimi | Tarife işi; F30 fiziksel doğrulama paketi. |
| Seri no / IMEI / parti-lot takibi | Ürün tipimizde yok. |
| Raf adresi / toplama rotası (pick path) | F29 "tek fiziksel havuz" varsayımını değiştirir (`f29-envanter-sozlesmesi.md:223`). |
| 1D barkod **üretimi** | Okutmada EAN kabul edilir; ürettiğimiz etikette QR var. |
| `OrderItem`'a SKU kolonu | §3.6. |
| Müşteri iadesinin (RMA) fiziksel kabulü | F29'da da yok (`RETURN_RECEIVED` kaydı yok); ayrı paket. |
| `reserved_on_premise` formülünün değiştirilmesi | F29 kapalı; §7 sapması bilinçli borç olarak taşınıyor. |

---

## 5. Model / migration ihtiyacı

### `order_packages`

| Kolon | Tip | Not |
|---|---|---|
| `id` | PK | `PKT-{id:06d}` türetilir |
| `order_id` | FK `orders.id` CASCADE, index | |
| `status` | String(16) NOT NULL | §3.2 FSM |
| `qr_token` | String(64) **UNIQUE** NOT NULL | kalıcı |
| `items_fingerprint` | String(64) NOT NULL | sha256; STALE tespiti |
| `packed_at` / `packed_by_admin_id` | | `complete` aktörü |
| `handed_over_at` / `handed_to_courier_id` (FK `couriers` SET NULL) / `handed_over_by_actor` | | zimmet aktörü |
| `returned_at` / `returned_by_admin_id` / `return_note` | | `return_in` |
| `void_at` / `void_by_admin_id` / `void_reason` | | `void` |
| `unpacked_at` | | fiziksel bozma damgası |
| `created_at` / `updated_at` | TimestampMixin | soft-delete **yok** (paket fiziksel izdir; `VOID` var) |

Kısıtlar:

```sql
-- Bir siparişin aynı anda TEK canlı paketi olur (yarış otoritesi).
CREATE UNIQUE INDEX uq_order_packages_live ON order_packages (order_id)
  WHERE status NOT IN ('DELIVERED', 'VOID');
CREATE INDEX ix_order_packages_status ON order_packages (status);
```

### `order_package_items`

| Kolon | Tip | Not |
|---|---|---|
| `id` / `package_id` (CASCADE) / `order_item_id` (CASCADE) | | UNIQUE `(package_id, order_item_id)` |
| `product_id` | nullable | snapshot; NULL = taranamaz |
| `sku` / `barcode` / `title` | String | snapshot (§3.6) |
| `expected_qty` / `scanned_qty` | Integer | |

```sql
CHECK (expected_qty > 0)
CHECK (scanned_qty >= 0 AND scanned_qty <= expected_qty)  -- fazla adet DB'de reddedilir
```

### `package_scan_events` (append-only)

| Kolon | Not |
|---|---|
| `id` / `package_id` (CASCADE) / `package_item_id` (nullable — red edilen taramada NULL) |
| `code_scanned` String(64) · `result` String(16) · `qty_delta` Integer |
| `manual_reason` String(200) nullable — `OK_MANUAL`'da zorunlu |
| `actor_admin_id` · `idempotency_key` String(80) nullable · `request_id` · `created_at` |

```sql
CREATE UNIQUE INDEX uq_package_scan_idem ON package_scan_events (package_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
-- F29 deseni: inventory_append_only() trigger'ı ile UPDATE/DELETE reddi
```

**Stok defteri değişmez:** yeni `StockMovementType` **yok**, yeni
`PHYSICAL_EFFECT` girdisi **yok** (`ORDER_PREPARED` / `ORDER_SHIPPED` /
`DELIVERY_FAILED` zaten karşılıyor), `products.stock` / `damaged_stock`'a
dokunulmaz, `stock_ledger` F30 servislerinden **hiç çağrılmaz**.

### Kanonik kilit sırası (güncellenir)

```
StockCountSession → Product → Order → OrderReturn → OrderPackage → DeliveryStop
```

`OrderPackage`, `Order`'dan sonra ve `DeliveryStop`'tan önce girer; zimmet üçünü
birden alan tek akıştır. `mark_prepared`'ın kilitsiz deseni (G7) kopyalanmaz —
her yazan yol `Order`'ı `FOR UPDATE` ile alıp **taze** durum okur.

---

## 6. API ve yetki matrisi

| Uç | İzin | Not |
|---|---|---|
| `GET /packing/queue` | `packing.view` | paketlenecek siparişler (söz gününe göre) |
| `GET /packing/packages` | `packing.view` | filtre + zorunlu sayfalama tavanı |
| `GET /packing/packages/{id}` | `packing.view` | satırlar + tarama izi |
| `POST /packing/orders/{order_id}/open` | `packing.pack` | idempotent: canlı paket varsa onu döner |
| `POST /packing/packages/{id}/scan` | `packing.pack` | `{code, manual?, manual_reason?, idempotency_key}` |
| `POST /packing/packages/{id}/undo-scan` | `packing.pack` | gerekçeli düzeltme |
| `POST /packing/packages/{id}/complete` | `packing.pack` | idempotent; `PACKED` + `prepared_at` |
| `POST /packing/packages/{id}/void` | `packing.pack` (OPEN) / `packing.manage` (diğer) | gerekçe zorunlu |
| `POST /packing/packages/{id}/unpack` | `packing.manage` | `unpacked_at` damgası |
| `POST /packing/packages/{id}/return-in` | `packing.manage` | `RETURN_PENDING → RETURNED` |
| `POST /packing/packages/{id}/repack` | `packing.manage` | `RETURNED → PACKED` |
| `POST /delivery/handover/scan` | field: `delivery.manage` **veya** COURIER | zimmet |
| `GET /delivery/handover/manifest/{run_id}` | field: `delivery.view` **veya** COURIER | N/M + eksik liste |

**Tarama ucunun yanıt sözleşmesi:** iş sonucu (`OK`, `OK_MANUAL`, `WRONG_SKU`,
`OVER_QTY`, `ALREADY_COMPLETE`, `UNSCANNABLE`) **200 + `result`** ile döner —
red de bir olaydır ve `package_scan_events`'e yazılabilmesi için transaction
commit edilmelidir. Yapısal hatalar (paket yok, paket `OPEN` değil, yetkisiz,
idempotency çakışması, STALE) **4xx**'tir.

Kurye paketleme uçlarının **hiçbirine** erişemez; admin `handover` yapabilir
(operatör kurye adına zimmetleyebilmeli) ama `override-deliver` gibi
`field_router` dışı bırakılmaz — zimmet zaten kanıt üretir.

Audit (`audit_service.record`, `actor` + `reason` + `before/after`):
`package.open` · `package.complete` · `package.scan_manual` · `package.undo_scan` ·
`package.void` · `package.unpack` · `package.return_in` · `package.repack` ·
`package.handover`. Sıradan başarılı tarama audit'e **yazılmaz** (gürültü);
izi `package_scan_events`'tedir.

---

## 7. Bilinen sapma ve riskler

| # | Konu | Karar |
|---|---|---|
| **S1** | `RETURN_PENDING` penceresinde sipariş `PAID`'e döner (`fail_stop`), dolayısıyla F29 `reserved_on_premise` paketi **işletmede** sayar — oysa paket kuryededir. Pencere: teslim denemesi → akşam `return_in`. | F29 formülüne **dokunulmadı** (kapalı paket). Bilinen sapma; `docs/teknik-borc.md` TB-7 olarak açılacak. Sayım bu pencerede yapılırsa fark çıkar; sayımlar gece/sabah yapılır. |
| **S2** | `start_run` ve `add_stops`'un `SHIPPED` sorumluluğu zimmete taşınıyor → mevcut teslimat testlerinin fixture'ları paket+zimmet adımı eklemek zorunda. | Bilinçli kırıcı değişiklik. Commit 5'te mevcut testler güncellenir; hangi testin **neden** değiştiği kapanış raporunda tek tek yazılır. |
| **S3** | `POST /delivery/orders/{id}/prepare` ve `/unprepare` kaldırılıyor. | §3.5. Frontend "Hazırla" butonu paketleme istasyonuna yönlenir. |
| **S4** | Paket QR'ı kalıcı olduğu için **çalınan/kopyalanan etiket** riski. | Zimmet, paketin o kuryenin turundaki durağa ait olmasını arar (IDOR deseni: yabancı paket **404**). Teslim hâlâ OTP/foto ister — QR tek başına teslim kanıtı değildir. |
| **S5** | Sipariş kalemleri bugün değişmiyor (kalem ekleme/çıkarma ucu yok, `order_service.py:444` tek yazıcı) — STALE kontrolü teorik görünüyor. | Yine de uygulanıyor: kısmi iade satırları ve gelecekteki kalem düzenlemesi sessizce yanlış paket üretmesin. Fingerprint ucuz. |
| **S6** | `packing.*` izinleri yeni; migration'sız katalog işe yaramaz (SUPER_ADMIN dahil 403). | Katalog + migration **aynı commit'te** (commit 2). |

---

## 8. Commit planı

| # | Commit | İçerik | Durum |
|---|---|---|---|
| **1** | `test(f30): paketleme sozlesmesi + kirmizi test matrisi` | Bu belge + 6 kırmızı test dosyası. Üretim kodu YOK. | **bu commit** |
| 2 | `feat(f30): paket modelleri, migration ve izin katalogu` | 3 tablo + trigger + kısmi index'ler + `models/__init__` + `_KRITIK_TABLOLAR` + `packing.*` katalog & rol dağıtımı | bekliyor |
| 3 | `feat(f30): paketleme kurallari ve servis katmani` | `services/packing_rules.py` (saf) + `services/packing_service.py` (kilit sırası, idempotency, STALE) | bekliyor |
| 4 | `feat(f30): paketleme HTTP uclari ve audit` | `schemas/packing.py` + `api/routers/packing.py` + `api/router.py` + audit kablolaması | bekliyor |
| 5 | `feat(f30): kurye zimmeti ve SHIPPED gecisinin tasinmasi` | `handover_scan`, `start_run` ön koşulu, `add_stops`/`fail_stop`/`cancel_run`/`watchdog`/`postpone` paket kablolaması, `prepare`/`unprepare` kaldırma, **etkilenen mevcut testlerin güncellenmesi** | bekliyor |
| 6 | `feat(f30): admin paketleme ekranlari` | `/yonetim/paketleme` (kuyruk · istasyon · paketler) + API/hook/types + saf `lib/packing.ts` | bekliyor |
| 7 | `feat(f30): paket etiketi ve kurye zimmet ekrani` | `PackageLabel` (baskı sözleşmesi) + `LabelSheet` paket QR'ına geçiş + saha zimmet adımı | bekliyor |
| 8 | `test(f30): mutasyon provasi, Chrome kabul turu ve kapanis` | `mutation_drill` girdileri, izole Chrome/DevTools turu (baskı + QR okunabilirliği), kapanış raporu | bekliyor |

---

## 9. Test çalıştırma

```powershell
# Gerçek PostgreSQL (docker compose, host 5433). Asıl dev DB'si (5432/ceyhandb) KULLANILMAZ.
Set-Location C:\Users\kiyar\desktop\adana-f30\backend
$env:POSTGRES_USER='postgres'; $env:POSTGRES_PASSWORD='postgres'
$env:POSTGRES_HOST='localhost'; $env:POSTGRES_PORT='5433'
$env:POSTGRES_DB='adana_f30_test'          # adında 'test' GEÇMEK ZORUNDA (db_guard)
$env:AUTO_CREATE_DB='False'; $env:ENVIRONMENT='development'

python -m pytest tests/integration -q -k f30      # F30 entegrasyon
python -m pytest tests/acceptance -q -k f30       # F30 yapısal sözleşme
python -m pytest -q --ignore=tests/integration --ignore=tests/verify   # birim + kabul
```

```bash
cd frontend
npx vitest run src/lib/packing.test.ts
npx vitest run src/pages/admin/packing
```

> `--ignore=tests/verify` **şarttır**: `tests/verify/conftest.py` `POSTGRES_DB`
> `adana_verify` değilse tüm oturumu `pytest.exit(1)` ile düşürür. Aynı sebeple
> `.github/workflows/ci.yml:77` bugün verify paketini yanlışlıkla topluyor
> (o adım verify eklendiğinden beri hiç yeşil koşmadı) — commit 8'de düzeltilecek.
