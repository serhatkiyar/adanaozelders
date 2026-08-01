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

> **Kademeli devreye alma (commit 3'te alınan karar).** Yukarıdaki üç değişiklik
> commit 3'te **paketi olan sipariş için** uygulanır: canlı paketi olan durak
> `add_stops`'ta SHIPPED YAPILMAZ ve `start_run` onun zimmetlenmiş olmasını
> ARAR; paketi **olmayan** (F30 öncesi akıştan gelen, elle `prepare` edilmiş)
> durak eski davranışı sürdürür. Sebep somut: `POST /delivery/orders/{id}/prepare`
> henüz kaldırılmadığı için (commit 5) "her siparişin paketi vardır" bugün
> **doğru değildir** ve koşulsuz dayatma mevcut operasyonu — ve S2'de sayılan
> mevcut teslimat testlerini — anında kilitlerdi. Koşulsuz hâline geçiş, elle
> hazırlama uçlarının kaldırılmasıyla **aynı commit'te** (5) yapılır; o zaman
> "paketi olmayan durak" diye bir şey kalmaz. Ara dönemin bilinen boşluğu:
> paketi `VOID` edilmiş bir sipariş `mark_prepared` ile hâlâ zimmetsiz
> gönderilebilir — commit 5'e kadar açık, kayıt altında.

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

> **`repack` AYNI paketi sürdürür — yeni paket açmaz.** Bu ayrım G3'ün
> kazancıdır: `repack` paketin `qr_token`'ını ve dolayısıyla **üstündeki basılı
> etiketi** korur, böylece ikinci turda aynı etiket okunur. "Eski paketi bozup
> yenisini aç" ayrı bir yoldur ve `void` + `open_package` ile yapılır (yeni
> `package_no`, yeni QR, yeni etiket baskısı). İkisi arasında hiçbir anda iki
> canlı paket oluşmaz: her iki adım da `Order` kilidi altında sırayla çalışır ve
> `uq_order_packages_live` son sözü söyler. `packed_at` `repack`'te
> **tazelenmez** — o damga "içeriğin kalem kalem doğrulandığı an"dır ve repack
> kutuyu açmaz; yeni kararın aktörü/zamanı `REPACK` olayında durur.

#### `RETURN_PENDING` yaşam döngüsü — kesin kurallar

Paketi kuryede bırakan **dört yol** vardır ve hepsi aynı sonuca varır:
`fail_stop` · `cancel_run` · `expire_stale_runs` (watchdog) · `postpone_delivery`
(müşteri ertelemesi). Bu dört yol için kurallar:

| Kural | Gerekçe |
|---|---|
| `RETURN_PENDING` paketi olan sipariş **`prep_queue`'da GÖRÜNMEZ** | Depoda olmayan paket için "topla ve paketle" görevi üretmek yanlış iştir; personel ikinci bir kopya toplamaya kalkar. Bugün `roll_promise_after_failed_attempt` `prepared_at`'i sıfırladığı için sipariş doğrudan prep kuyruğuna düşüyor — F30 bu davranışı **paket durumuna göre** daraltır. |
| Ayrı operasyon kuyruğunda **GÖRÜNÜR**: `GET /packing/return-queue` | Görünmezlik tek başına tehlikelidir: hiçbir yerde görünmeyen paket kimse tarafından aranmaz ve süresiz kaybolur (TB-7). Kuyruk paket kodunu, siparişi ve **hangi kuryede olduğunu** taşır. |
| `open_package` ikinci paket **AÇMAZ** → 409 + mevcut paketin durumu | İkinci paket, aynı ürünleri ikinci kez raftan almak demektir. 409 gövdesi mevcut durumu (`RETURN_PENDING`) bildirir; operatör "neden açamıyorum" sorusunun cevabını ekranda görür. |
| `add_stops` `RETURN_PENDING` paketi **KABUL ETMEZ** (409) ve `eligible_orders` göstermez | Araçta olan paket yeni tura yüklenemez. |
| `repack` yalnız `RETURNED`'dan sonra | Sıra atlanamaz: geri geldiği **okutularak** doğrulanmadan yeniden dağıtıma verilemez. Belirsiz fiziksel olayda tahmin yok. |
| `return_in` ve `repack` **defter hareketi yazmaz** | Konum olayı; `SALE` ödemede yazıldı, sipariş hâlâ `PAID`. |

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

**`product_id IS NULL` olan geçmiş kalem**: SKU/barkod okunamaz. Satır
`scannable=False` işaretlenir ve **yalnız kontrollü manuel doğrulama** ile
kapanır: gerekçe zorunlu, `result='OK_MANUAL'`, `package_scan_events`'e ve
`audit_logs`'a yazılır. Sessiz geçiş yok.

> **Ürünün sert silinmesi — gerçek politika** (commit 2 denetimi, P2-1).
> Bu belgenin ilk hâli "ürün silinince `product_id` NULL olur, snapshot kalır,
> satır taranamaz olur" diyordu. **Gerçek DB davranışı bu değildir:** FK
> `SET NULL` `product_id`'yi boşaltmaya çalışır, ama snapshot doluysa
> `ck_order_package_items_scannable` ihlal edilir ve **sert `DELETE` tamamen
> reddedilir**. Üretimde bu yol zaten yoktur: ürün `store_service` üzerinden
> **soft-delete** edilir. Bu yüzden `packing_service` "product_id NULL
> olacaktır" varsayımı **kurmaz**; tarama dayanağı her zaman paket satırındaki
> SKU/barkod snapshot'ıdır. `scannable=False` satır pratikte, paket açılırken
> `order_items.product_id`'si zaten NULL olan (F30 öncesinden gelen) bir
> siparişten doğar. Kanıt:
> `test_f30_package_schema_pg.py::test_URUN_SERT_SILINMESI_TARANABILIR_PAKET_SATIRINDA_REDDEDILIR`.

`ISBN` barkod yerine **kullanılmaz** — `models/store.py:254-261` bunu zaten
gerekçelendiriyor (set ürün, ISBN-10 dönüşümü, promosyon barkodu). O gerekçeyi
delmiyoruz.

### 3.6b `Order` kilidi paket yaşam döngüsünün TAMAMINDA zorunludur

> Bağımsız denetimde açık bırakılan madde (P2-F). Karar burada kayıt altına
> alınır; uygulaması commit 3'tedir.

`open_package` ve `complete`'in siparişi `FOR UPDATE` ile alması apaçıktır
(iptalle yarışırlar). Denetçi haklı olarak sordu: `void`, `repack` ve
`return_in` yalnız **paket** satırını değiştiriyor; neden `Order` da kilitleniyor?

Üç somut sebep — üçü de bu koddan çıkarıldı:

1. **Bu üç işlem sipariş durumuna BAKAR.** `repack` `prepared_at`'i yeniden
   damgalar (§3.5), yani siparişi `eligible_orders` kuyruğuna geri sokar;
   `void` `prepared_at`'i sıfırlar. Siparişi kilitlemeden okunan durum bayattır:
   iptal edilmiş bir sipariş `repack` ile yeniden dağıtıma verilebilirdi. `G7`
   (`mark_prepared`'ın kilitsiz deseni) tam olarak bu hatadır ve
   kopyalanmayacaktır.
2. **Karşı taraf zaten `Order` kilidiyle geliyor.** `order_fsm` sipariş
   `CANCELLED`/`REFUNDED` olurken canlı paketi çözer (§3.5) ve o yol `Order`'ı
   kilitli tutar. Paket tarafı `Order`'ı atlarsa iki yol **farklı kilit
   kümeleriyle** aynı satır çiftine yazar; kilit sırası garantisi bir tarafta
   yokken deadlock'u önlemez.
3. **Tek kural, sıfır istisna.** "Hangi paket işlemi `Order` kilidi alır"
   sorusunun cevabı liste olursa, listeye girmeyi unutan bir sonraki fonksiyon
   sessizce yarışır. Kanonik sıra
   (`… → Order → OrderPackage → DeliveryStop`) ancak her yazan yol aynı yerden
   başlarsa bir sıradır.

Maliyeti ölçülü: kilit sipariş satırı üzerinde ve işlem kısa. Bu bilinçli bir
sözleşme kararıdır; test karşılığı
`tests/acceptance/test_f30_packing_contract.py::test_packing_service_KILIT_SIRASI_kanonik`
(beş fonksiyonun her biri için `Order` aranır) ve
`test_f30_packing_race_pg.py::test_kilit_sirasi_DEADLOCK_URETMEZ`.

### 3.7 Modül bağımlılık yönü (circular import sınırı)

F30 iki yönlü bir ihtiyaç doğuruyor: `packing_service` sipariş durumunu okumak
ve `prepared_at` damgalamak için `order_fsm`'e; `order_fsm` ise sipariş
`CANCELLED`/`REFUNDED` olurken canlı paketi çözmek için paket tarafına ihtiyaç
duyuyor (§3.5). Naif çözüm karşılıklı `import` — Python'da modül düzeyinde
**circular import** hatası, fonksiyon içinde ise gizli bir bağımlılık döngüsü.

**Karar — tek yönlü bağımlılık + ince olay modülü:**

```
packing_service ──import──▶ order_fsm          (izinli, tek yön)
packing_service ──import──▶ packing_rules      (saf)
order_fsm       ──import──▶ packing_events     (izinli; packing_service'i GÖRMEZ)
packing_events  ──import──▶ models + packing_rules
packing_events  ─X─▶ packing_service                     (YASAK)
delivery_service──import──▶ packing_service    (zimmet, kapı taraması)
```

* `services/packing_events.py` yalnız modelleri ve saf kuralları kullanan ince
  bir modüldür; tek işi `on_order_terminal(db, order, *, reason)` — canlı paketi
  konumuna göre `VOID` ya da `RETURN_PENDING` yapmak. İş mantığı (`open_package`,
  `complete`, `scan`) burada **yoktur**.
* `order_fsm` bu modülü **modül düzeyinde** import eder; gecikmeli (fonksiyon
  içi) import'a gerek kalmaz, çünkü döngü yoktur.
* `packing_service` tersine `packing_events`'i çağırmaz; `order_fsm`'i doğrudan
  kullanır.
* `delivery_service → packing_service` yönü tektir; `packing_service`
  `delivery_service`'i **import etmez** (durak bilgisine ihtiyaç duyduğu tek yer
  zimmet ve o `delivery_service` tarafındadır).

Bu sınır bir kabul testiyle korunur: `packing_events` ve `packing_rules`,
`packing_service`/`delivery_service` import ediyorsa test kırılır.

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

## 5. Model / migration (UYGULANDI — commit 2)

> Uygulama: `backend/models/packing.py` +
> `backend/migrations/versions/f30_paketleme_semasi.py`
> (`down_revision = f29c_damage_idem_actor_scope`, tek head).
> Aşağıdaki tablolar **gerçek şemadır**; plan değil.

### `order_packages`

| Kolon | Tip | Not |
|---|---|---|
| `id` | PK | `PKT-{id:06d}` türetilir |
| `order_id` | FK `orders.id` CASCADE | |
| `package_no` | Integer NOT NULL | sipariş içindeki sıra; UNIQUE `(order_id, package_no)` |
| `status` | String(16) NOT NULL, default `OPEN` | §3.2 FSM, CHECK'li |
| `qr_token` | String(64) **UNIQUE** NOT NULL | kalıcı; `secrets.token_urlsafe(24)` |
| `items_fingerprint` | String(64) NOT NULL | sha256; STALE tespiti |
| `packed_at` / `packed_by_admin_id` | | `complete` aktörü |
| `handed_over_at` / `handed_to_courier_id` (FK `couriers` SET NULL) / `handed_over_by_actor` | | zimmet aktörü |
| `delivered_at` | | teslim damgası |
| `returned_at` / `returned_by_admin_id` / `return_note` | | `return_in` |
| `void_at` / `void_by_admin_id` / `void_reason` | | `void` |
| `unpacked_at` / `unpacked_by_admin_id` | | fiziksel bozma damgası |
| `created_at` / `updated_at` | TimestampMixin | soft-delete **yok** (paket fiziksel izdir; `VOID` var) |

Sözleşmenin ilk taslağına göre **eklenen** üç alan ve gerekçeleri:

* `package_no` — bir siparişin ömrü boyunca birden çok paketi olabilir
  (`void` → yeni paket). Sıra numarası olmadan operasyon "2. paket" diye
  konuşamaz ve etiket hangi denemeye ait olduğunu söyleyemez.
* `delivered_at` / `unpacked_by_admin_id` — her durum damgasının **aktörü ve
  zamanı** olsun diye; CHECK'ler bunlara dayanır (aşağı bakınız).

**Optimistic locking kolonu bilinçli olarak YOKTUR.** Yarış otoritesi
pesimisttir (`FOR UPDATE` + kısmi unique index); üçüncü bir eşzamanlılık
mekanizması hangisinin bağlayıcı olduğunu belirsizleştirirdi. Kalem listesinin
değişmesi ayrı bir sorudur ve `items_fingerprint` ile çözülür.

Kısıtlar (hepsi migration'da):

```sql
-- Yarış otoritesi. "Canlı" yükleminin TEK doğruluk kaynağı
-- models/packing.py::LIVE_PACKAGE_SQL'dir; migration metni onu tekrar eder.
-- ⚠️ `alembic check` bu WHERE yüklemini KARŞILAŞTIRMAZ (yalnız index'in
-- varlığını görür) → drift nöbetçisi ayrıca yazıldı: saf eşleşme
-- `test_f30_packing_contract.py::test_CANLI_PAKET_yuklemi_UCLU_AYRISAMAZ`,
-- uygulanmış index `test_f30_package_schema_pg.py::
-- test_CANLI_INDEX_YUKLEMI_TERMINAL_KUMESIYLE_AYNI` (pg_get_expr).
CREATE UNIQUE INDEX uq_order_packages_live ON order_packages (order_id)
  WHERE status NOT IN ('DELIVERED', 'VOID');
CREATE UNIQUE INDEX uq_order_packages_qr_token ON order_packages (qr_token);
UNIQUE (order_id, package_no)                      -- uq_order_packages_no
CREATE INDEX ix_order_packages_status ON order_packages (status, created_at DESC);
-- Geri dönüş kuyruğu (§3.5) ve "bozulmayı bekleyen paketler" (G8):
CREATE INDEX ix_order_packages_return_queue ON order_packages (handed_over_at)
  WHERE status = 'RETURN_PENDING';
CREATE INDEX ix_order_packages_unpack_queue ON order_packages (void_at)
  WHERE status = 'VOID' AND unpacked_at IS NULL;

CHECK (status IN (...7 durum...))                              -- ck_..._status
CHECK (package_no > 0)                                         -- ck_..._no_sign
-- Durum ↔ zaman tutarlılığı: fiziksel bir olayı iddia eden durum, o olayın
-- ZAMANI olmadan yazılamaz.
CHECK (status NOT IN ('PACKED','HANDED_OVER','RETURN_PENDING','RETURNED',
                      'DELIVERED') OR packed_at IS NOT NULL)
CHECK (status NOT IN ('HANDED_OVER','RETURN_PENDING','DELIVERED')
       OR handed_over_at IS NOT NULL)
CHECK (status <> 'DELIVERED' OR delivered_at IS NOT NULL)
CHECK (status <> 'RETURNED'  OR returned_at  IS NOT NULL)
CHECK (status <> 'VOID' OR (void_at IS NOT NULL AND btrim(void_reason) <> ''))
CHECK (unpacked_at IS NULL OR status = 'VOID')
```

> `handed_to_courier_id` **SET NULL**'dır ve hiçbir CHECK ona dayanmaz: kurye
> profili silinebilir, zimmetin izi `handed_over_by_actor` metninde yaşar.

### `order_package_items`

| Kolon | Tip | Not |
|---|---|---|
| `id` / `package_id` (CASCADE) / `order_item_id` (CASCADE) | | UNIQUE `(package_id, order_item_id)` |
| `product_id` | nullable, FK SET NULL | snapshot; NULL = taranamaz |
| `sku` (20) / `barcode` (32) / `title` (250) | String | snapshot (§3.6) |
| `expected_qty` / `scanned_qty` | Integer | |
| `created_at` / `updated_at` | TimestampMixin | |

```sql
CHECK (expected_qty > 0)
CHECK (scanned_qty >= 0 AND scanned_qty <= expected_qty)  -- fazla adet DB'de reddedilir
CHECK (product_id IS NOT NULL OR (sku IS NULL AND barcode IS NULL))
--   ↑ ürünü silinmiş satır KOD TAŞIYAMAZ: "okuttum, eşleşti" güveni bayat
--     bir koda dayanamaz (§3.6).
```

### `package_scan_events` (append-only)

Tablo yalnız taramaların değil, **paket yaşam döngüsünün tamamının** izidir
(`event_type` ile ayrılır). Aktör her zaman admin değildir — zimmeti kurye
yapar — bu yüzden aktör `audit_logs` deseniyle aynı **(actor_role, actor_id)**
çiftidir; tek bir `admins.id` FK'si kuryeyi dışarıda bırakırdı.

| Kolon | Not |
|---|---|
| `id` / `package_id` (**RESTRICT**) / `package_item_id` (nullable, RESTRICT — red edilen taramada NULL) |
| `event_type` String(20) — `OPEN·SCAN·UNDO_SCAN·COMPLETE·HANDOVER·DELIVER·RETURN_PENDING·RETURN_IN·REPACK·VOID·UNPACK` |
| `result` String(16) nullable — `OK·OK_MANUAL·WRONG_SKU·OVER_QTY·ALREADY_COMPLETE·UNSCANNABLE` |
| `code_scanned` String(64) · `qty_delta` Integer NOT NULL |
| `from_status` / `to_status` String(16) nullable — durum geçişinin iki ucu |
| `manual_reason` String(200) nullable — `OK_MANUAL`'da zorunlu |
| `actor_role` / `actor_id` (ikisi birlikte dolu ya da ikisi de NULL = sistem olayı) |
| `meta` JSONB · `idempotency_key` String(80) · `request_id` · `created_at` |

```sql
CREATE UNIQUE INDEX uq_package_scan_idem ON package_scan_events (package_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_package_scan_events_package ON package_scan_events (package_id, id);
-- F29 deseni: packing_append_only() trigger'ı ile UPDATE/DELETE reddi.
-- Fonksiyon F29'un inventory_append_only()'sinden AYRIDIR: downgrade'in başka
-- bir migration'ın nesnesine dokunması gerekmesin.
CHECK (event_type NOT IN ('SCAN','UNDO_SCAN') OR result IS NOT NULL)
CHECK (result <> 'OK_MANUAL' OR btrim(manual_reason) <> '')
CHECK ((actor_id IS NULL) = (actor_role IS NULL))
```

> **FK yönü bilinçlidir:** `package_id` `CASCADE` **değil `RESTRICT`**'tir.
> Paket (ya da sipariş) silindiğinde izin sessizce yok olması, "paketi kim, ne
> zaman, hangi kodla doğruladı" sorusunu bir daha cevaplanamaz hâle getirirdi.
> Testler bu yüzden paketleri `tests/integration/db_guard.py::purge_packages`
> ile temizler — trigger yalnız test veritabanında ve yalnız o işlem için
> geçici kapatılır (F29 `purge_products` deseni).

### Downgrade

Paket kaydı varsa downgrade **açıkça reddedilir** (F29 disiplini): append-only
bir izi tablo drop'uyla yok etmek sessiz bir veri kaybıdır. Boş şemada
`upgrade → downgrade → upgrade` doğrulanmıştır. Üç tablo da yenidir, hiçbir
mevcut tabloya kolon eklenmez ve hiçbir satır okunmaz/yazılmaz — backfill
gerekmez.

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
| `GET /packing/return-queue` | `packing.view` | "geri dönüş bekleniyor" (§3.5): paket kodu, sipariş, **hangi kuryede**, kaç gündür |
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
| **S1 / TB-7** | `RETURN_PENDING` penceresinde sipariş `PAID`'e döner, dolayısıyla F29 `reserved_on_premise` paketi **işletmede** sayar — oysa paket kuryededir. **Bu yalnız `fail_stop`'ta değil, dört yolun hepsinde oluşur:** `fail_stop` · `cancel_run` · `expire_stale_runs` (watchdog) · `postpone_delivery`. **Ve pencere sınırlı değildir:** `return_in` yapılmazsa sapma **süresiz** sürer — kurye paketi getirmez, kimse okutmaz, sayım her seferinde +1 fazla bekler. | F29 formülüne **dokunulmadı** (kapalı paket). Azaltıcı önlemler F30 içinde: (a) `GET /packing/return-queue` paketi görünür tutar ve **kaç gündür** beklediğini gösterir — sessizce kaybolamaz; (b) `open_package` 409 ile ikinci kopya toplanmasını engeller. Kalan risk `docs/teknik-borc.md` TB-7'de kalıcı olarak açılacak: "bekleyen geri dönüş varken yapılan sayım, o ürünlerde eksik sayar". |
| **S2** | `start_run` ve `add_stops`'un `SHIPPED` sorumluluğu zimmete taşınıyor → mevcut teslimat testlerinin fixture'ları paket+zimmet adımı eklemek zorunda. | Bilinçli kırıcı değişiklik. Commit 5'te mevcut testler güncellenir; hangi testin **neden** değiştiği kapanış raporunda tek tek yazılır. |
| **S3** | `POST /delivery/orders/{id}/prepare` ve `/unprepare` kaldırılıyor. | §3.5. Frontend "Hazırla" butonu paketleme istasyonuna yönlenir. |
| **S4** | Paket QR'ı kalıcı olduğu için **çalınan/kopyalanan etiket** riski. | Zimmet, paketin o kuryenin turundaki durağa ait olmasını arar (IDOR deseni: yabancı paket **404**). Teslim hâlâ OTP/foto ister — QR tek başına teslim kanıtı değildir. |
| **S5** | Sipariş kalemleri bugün değişmiyor (kalem ekleme/çıkarma ucu yok, `order_service.py:444` tek yazıcı) — STALE kontrolü teorik görünüyor. | Yine de uygulanıyor: kısmi iade satırları ve gelecekteki kalem düzenlemesi sessizce yanlış paket üretmesin. Fingerprint ucuz. |
| **S6** | `packing.*` izinleri yeni; migration'sız katalog işe yaramaz (SUPER_ADMIN dahil 403). | Katalog + migration **aynı commit'te** yazıldı (commit 2). Dağıtım: SUPER_ADMIN ve COMMERCE_MANAGER üçünü de; **OPERATIONS_MANAGER yalnız `view` + `pack`** (`manage` görev ayrılığı gereği verilmez). Gerçek DB'den ölçülür: `test_f30_permissions_pg.py`. Yan etki: izin kodu sözlüğü (`tests/test_admin_permission_catalog.py::_ALLOWED_ACTIONS`) `pack` eylemiyle genişletildi — `view`/`manage` çifti bu ayrımı ifade edemiyordu (F29'da `count`/`apply` için de aynı gerekçeyle genişletilmişti). |

---

## 8. Commit planı

| # | Commit | İçerik | Durum |
|---|---|---|---|
| **1** | `test(f30): paketleme sozlesmesi + kirmizi test matrisi` | Bu belge + 6 kırmızı test dosyası. Üretim kodu YOK. | bitti |
| **2** | `feat(f30): paket modelleri migration ve izin katalogu` | 3 tablo + append-only trigger + kısmi index'ler + `models/__init__` + `_KRITIK_TABLOLAR` + `db_guard.purge_packages` + `packing.*` katalog & rol dağıtımı + şema invariant testleri | bitti |
| 2b | `test(f30): commit 2 denetim borclarini kapat` | ruff B905 · canlı-paket yüklemi drift nöbetçisi (saf + `pg_get_expr`) · anahtarsız olay testinin gerekçesi · ürün sert-silme politikası | bitti |
| **3** | `feat(f30): paketleme servisi ve yasam dongusu` | `services/packing_rules.py` (saf FSM + işlem tablosu) · `services/packing_events.py` (ince kanca modülü) · `services/packing_service.py` (kilit sırası, idempotency, STALE) · `order_fsm` terminal kancası · `handover_scan` + dört geri dönüş yolunun kablolaması · `prep_queue`/`eligible_orders`/`add_stops` paket farkındalığı | **bu commit** |
| 4 | `feat(f30): paketleme HTTP uclari ve audit` | `schemas/packing.py` + `api/routers/packing.py` + `api/router.py` + audit kablolaması | bekliyor |
| 5 | `feat(f30): kurye zimmeti ve SHIPPED gecisinin tasinmasi` | `handover_scan`, `start_run` ön koşulu, `add_stops`/`fail_stop`/`cancel_run`/`watchdog`/`postpone` paket kablolaması, `prepare`/`unprepare` kaldırma, **etkilenen mevcut testlerin güncellenmesi** | bekliyor |
| 6 | `feat(f30): admin paketleme ekranlari` | `/yonetim/paketleme` (kuyruk · istasyon · paketler) + API/hook/types + saf `lib/packing.ts` | bekliyor |
| 7 | `feat(f30): paket etiketi ve kurye zimmet ekrani` | `PackageLabel` (baskı sözleşmesi) + `LabelSheet` paket QR'ına geçiş + saha zimmet adımı | bekliyor |
| 8 | `test(f30): mutasyon provasi, Chrome kabul turu ve kapanis` | `mutation_drill` girdileri, izole Chrome/DevTools turu (§9.1), kapanış raporu | bekliyor |

> Commit 1'in denetimi bir düzeltme commit'i doğurdu
> (`test(f30): kirmizi matris denetim duzeltmeleri`): kilit sırası testinin
> uygulanabilir hâle getirilmesi, izin dağıtımının gerçek DB'den ölçülmesi,
> kapı taraması ve `RETURN_PENDING` yaşam döngüsü kapsaması, fabrika temizliği,
> etiket QR'ının gerçek prop'tan doğrulanması, kurye saha ekranı matrisi ve
> §3.7 import sınırı kararı.

**Commit 2'de bulunan iki test kusuru** (kök `CLAUDE.md` §I — gizlenmez):

1. `test_f30_packing_http_pg.py::test_YOK_paket_404` **yalancı yeşile düştü**.
   İzinler kataloğa girince fixture çalışmaya başladı ve test geçti — ama 404
   "paket bulunamadı"dan değil, **router hiç olmadığı için** geliyordu. Ayırt
   edici bir gözlemle güçlendirildi: kimlik doğrulamasız istek, uç varsa 404
   dışında bir şey döner. Düğüm yeniden kırmızıdır.
2. `test_inventory_migration_pg.py::test_F29_zinciri_...` `head`'in adının
   `f29c_damage_idem_actor_scope` olmasını arıyordu. F29'un üstüne konan **ilk**
   migration (F30) bu testi F29'la ilgisiz bir sebeple kırdı. İddia
   "F29 zinciri uygulanan yolun içinde" biçiminde yeniden yazıldı; zincirin
   gerçekten kurulduğunu kanıtlayan şema iddiaları (tablolar, index, backfill)
   olduğu gibi durmaktadır.

**Commit 3'te bulunan üç kusur** (aynı kural — gizlenmez):

1. `test_YANLIS_SKU_taramasi_REDDEDILIR` ve
   `test_CIFT_TARAMA_ayni_key_ile_adedi_IKI_KEZ_ARTIRMAZ` paketin **bütün**
   olaylarını sayıyordu (`izler == ["WRONG_SKU"]`, `count(*) == 1`). Oysa iz
   tablosu yalnız taramaların değil, yaşam döngüsünün tamamının kaydıdır (§5) ve
   paket açılışı da bir olaydır (`OPEN`). İki test `event_type` ile daraltıldı;
   birincisine ayrıca "açılış olayı gerçekten yazıldı" iddiası **eklendi** —
   yani test zayıflatılmadı, ayırt ediciliği artırıldı.
2. `f30_factory.tur()` her turu **aynı gün + `LADA`** ile açıyordu; oysa
   `uq_delivery_run_planned` gün+araç başına tek PLANLI tura izin verir. İki
   turlu senaryolar (yabancı kurye, ikinci tura yükleme) kendi iddialarına
   varamadan `IntegrityError` ile düşüyordu. Commit 1'de görünmemişti, çünkü o
   testler `handover_scan` yokluğundan daha önceki satırda kırılıyordu. Fabrika
   artık her tura bir gün ileri tarih verir.
3. `SCAN_RESULTS` sözlüğündeki `ALREADY_COMPLETE` ve `UNSCANNABLE` **hiçbir yol
   tarafından üretilmiyor**. Kabul testleri dolu satırda `OVER_QTY`, kodsuz
   satırda `WRONG_SKU` bekliyor; ikisini uydurmak o davranışları bozardı. DB
   CHECK'i onları kabul etmeye devam ediyor ve `packing_rules.ScanOutcome`
   docstring'inde bu boşluk açıkça yazılı. Commit 4'te HTTP katmanının daha
   bağışlayıcı yolları için kullanılacak ya da sözlükten çıkarılacaklar.

---

## 9. Test çalıştırma

```powershell
# Gerçek PostgreSQL. DB adı 'test' İÇERMEK ZORUNDA (db_guard); asıl dev
# kataloğu `ceyhandb` allowlist DIŞIDIR ve hiçbir koşulda kullanılmaz.
#   • docker compose:  PORT=5433, parola 'postgres'
#   • yerel Postgres:  PORT=5432, parola .env'deki değer
# İkisi de olur — yalnız ayrı bir `adana_f30_test` kataloğu oluşturulur.
Set-Location C:\Users\kiyar\desktop\adana-f30\backend
$env:POSTGRES_USER='postgres'; $env:POSTGRES_PASSWORD='<parola>'
$env:POSTGRES_HOST='localhost'; $env:POSTGRES_PORT='5432'
$env:POSTGRES_DB='adana_f30_test'
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
> `adana_verify` değilse tüm oturumu `pytest.exit(1)` ile düşürür.
>
> **CI notu:** `.github/workflows/ci.yml` düzeltmesi **başka bir dalda
> tamamlandı**. F30 dalı CI üretim dosyalarına dokunmaz; bu dal daha sonra
> güncel `main` ile **rebase/merge edilerek hizalanmalıdır** — aksi hâlde F30
> PR'ı düzeltilmemiş CI tanımıyla koşar.

### 9.1 Chrome kabul turu — açık kriterler (commit 8)

Vitest'te `qrcode.react` mock'lanır ve **iletilen prop'lar** doğrulanır
(`PackageLabel.test.tsx`); bu, QR'ın gerçekten çizildiğini ve **okunabildiğini**
kanıtlamaz. jsdom yerleşim de hesaplamaz. Aşağıdakiler gerçek Chrome + DevTools
Protocol turunda ölçülür ve kabul kriteridir:

1. Etiket sayfası **PDF'e basılır** ve çıktı boş değildir (dosya boyutu +
   görünür içerik) — F26'da 1 KB'lık boş PDF üretilmişti.
2. Basılı PDF'ten QR **decode edilir** ve çözülen dizgi paketin
   `PKG1:{id}:{token}` payload'una **birebir** eşittir.
3. Decode, etiket **%15 küçültülmüş** ve **gri tonlamalı** basıldığında da
   başarılıdır (depo yazıcısı ve fotokopi toleransı).
4. QR'ın basılı kenar uzunluğu **≥ 20 mm** ve **kare**dir (en/boy oranı 1.0 ±
   %2) — uzun ürün başlığıyla birlikte basıldığında da (flex ezilmesi, F26).
5. Üretilen QR'ın hata düzeltme düzeyi **M**'dir (decode kütüphanesinin
   raporladığı EC seviyesi).
6. Kurye ekranında kamera akışıyla **canlı okuma** başarılıdır (secure context)
   ve `BarcodeDetector` yoksa manuel giriş kutusu görünür (`qrCapability.ts`).
7. Zimmet ekranı ile kapı ekranı **görsel olarak ayırt edilebilir** (başlık +
   aksiyon dili), dark-mode dahil.
