# İP-2a — Mağaza İade, Refund ve Stok Bütünlüğü Sözleşmesi

> **Durum: ÜRETİM UYGULAMASI KAPANDI** (bkz. §9). Aşağıdaki §1-§8 tarihsel
> kırmızı checkpoint kaydıdır ve OLDUĞU GİBİ korunur — geçmiş kırmızı
> sonuçlar silinmez veya yeniden yazılmaz.
>
> **Durum (tarihsel): KIRMIZI CHECKPOINT.** Bu doküman, mağaza sipariş iadelerinde para,
> stok, indirim ve durum bütünlüğünün **mevcut** davranışını ve **hedef**
> invariantlarını kayıt altına alır. Kırmızı kabul testleri
> (`backend/tests/integration/test_ip2a_*.py`) bu dokümandaki kusur
> kimliklerine (İP2A-XX) referans verir. Üretim düzeltmesi İP-2b'nin işidir;
> bu turda üretim kodu DEĞİŞTİRİLMEMİŞTİR.
>
> Kaynak: main (`26f30d8`) üzerindeki gerçek kod; 7 bağımsız keşif taraması +
> ana araştırmacının satır satır doğrulaması. Her kusur dosya:satır ile
> kanıtlıdır.

## 1. Mevcut mimari (özet)

İade üç ayrı durum ekseninde yaşar; merkezî bir iade FSM'i yoktur:

| Eksen | Kolon | Değerler | Terminal koruması |
|---|---|---|---|
| Talep | `order_returns.status` | PENDING → APPROVED \| REJECTED | Yalnız `approve_return`/`reject_return` içindeki iki `if` (`order_service.py:1578,1601`); `_settle_return:1808,1834` koşulsuz `APPROVED` yazar |
| Para (talep) | `order_returns.refund_status` | NONE → REFUNDING → REFUNDED | `escrow.claim` koşullu UPDATE (atomik) |
| Para (sipariş) | `orders.payment_status` | PAID → REFUNDING → REFUNDED | `escrow.claim` (ORDER_SPEC) |

- **Intent = satırın kendisi.** Ayrı refund-intent tablosu yok; niyet
  `refund_status/payment_status = REFUNDING` + `refund_requested_at` +
  `refund_attempts` kolonlarıyla taşınır ve **provider çağrısından önce commit
  edilir** (`escrow.begin_refund`, `_settle_return:1837`). Bu kısım sağlam.
- **İki fazlı akış:** claim → commit → ürün kilidi → `provider.refund` →
  başarısızsa REFUNDING'de bırak + 502 (durum geri alınmaz, stok artmaz) →
  başarılıysa telafiler (stok + kupon) → finalize → commit.
- **Stok defteri:** `stock_movements` append-only (trigger'lı); idempotency
  `uq_stock_movements_idem` unique index + anahtar formatları
  (`order_item:{id}:SALE_CANCEL`, `return_line:{id}:RETURN`). Kovalar yalnız
  `SALEABLE` ("rafta") ve `DAMAGED`; DB CHECK gereği `RETURN` hareketi
  DAMAGED kovaya YAZILAMAZ (`ck_stock_movements_bucket_type`) — hasarlı iade
  mimari olarak iki adımlıdır: `RETURN`(SALEABLE) + elle
  `damage_transfer(MUSTERI_IADESI_HASARLI)`.
- **Reconciler:** `escrow_reconciler.reconcile_refunding` 60 sn'lik leader
  döngüsünde (PG advisory lock) REFUNDING satırlarını tarar;
  `next_refund_action` → WAIT / FINALIZE / RETRY / ALERT.
  `REFUND_RECONCILE_MIN_AGE_MINUTES=15`, `REFUND_MAX_ATTEMPTS=3`.
- **Cayma/ayıplı ayrımı:** `ReturnType` CAYMA/AYIPLI/DIGER. CAYMA talebi
  admin'siz otomatik onaylanır ve parayı anında başlatır
  (`request_return:1549`); CAYMA reddedilemez (`reject_return:1603`).
  Pencere: `RETURN_WINDOW_DAYS=14`, yalnız `status=DELIVERED` iken uygulanır
  ve **türe bakmaz**.

## 2. İnvariant sözleşmesi (hedef)

Kırmızı testlerin ölçtüğü hedef durum. "M" = para, "S" = stok, "D" = durum,
"A" = audit/bildirim, "Y" = yarış.

- **M1.** Bir sipariş için sağlayıcıya giden iade tutarlarının toplamı, fiilen
  ödenen tutarı (`orders.total`) hiçbir sırada ve hiçbir yarışta aşamaz.
- **M2.** Refund intent'i (REFUNDING claim'i) oluşmadan hiçbir kayıt REFUNDED
  olamaz; provider başarısızken hiçbir kayıt REFUNDED görünemez.
- **M3.** Aynı iade talebi için provider'a en fazla BİR refund çağrısı gider
  (retry'lar dahil, yarışlar dahil). İdempotency kapsamı: sipariş
  (`payment_status` claim'i), iade talebi (`refund_status` claim'i), iade
  kalemi (`return_line:{id}:RETURN` stok anahtarı) düzeylerinde ayrı ayrı
  tanımlıdır; provider çağrısının kendisi de bu kapsama bağlanmalıdır.
- **M4.** Kısmi iadede yalnız iade edilen kalemlerin **gerçekten ödenmiş payı**
  iade edilir: brüt satır tutarı − orantısal kupon payı; kargo yalnız seçim
  siparişin TAMAMINI kapsıyorsa eklenir.
- **M5.** Birden çok kısmi iadenin kümülatif sonucu (toplam tutar, kupon
  durumu, stok) tek seferlik eşdeğer tam iadeyle kuruşu kuruşuna tutarlıdır;
  yuvarlama farkı para yaratamaz/kaybettiremez.
- **M6.** `orders.refunded_amount`, sipariş üzerinden çıkan HER iade yolunda
  (RMA, admin tam iade, müşteri iptali, reconciler) artar;
  `payment_status=REFUNDED ⇒ refunded_amount = iade edilen toplam` invariantı
  çalışma zamanında korunur.
- **S1.** Stok yalnız stok defteri (`stock_ledger.apply_many`) yoluyla değişir
  (mevcut ve korunuyor — AST sözleşmesi).
- **S2.** Refund işleminin tekrarı, retry'ı veya reconciler devralması ikinci
  stok hareketi üretmez; kısmi miktar yalnız o miktar kadar ekler.
- **S3.** Para iadesi tamamlanan her iade için stok telafisi de (aynı
  idempotency anahtarıyla, tam bir kez) uygulanır — reconciler yolu dahil.
- **S4.** İade edilen fiziksel ürün, teslim alınıp uygun bulunmadan satılabilir
  (SALEABLE) stoğa dönmez; hasarlı/yeniden satılamaz ürün SALEABLE'a değil
  DAMAGED kovasına gider. *(Mevcut mimaride teslim alma adımı hiç yok — bkz.
  İP2A-10 ve §5/PK-α.)*
- **D1.** Terminal iade (APPROVED/REJECTED) tekrar onaylanamaz/reddedilemez;
  REJECTED bir talebin üstüne hiçbir yol APPROVED yazamaz.
- **A1.** Para hareketi üreten HER karar (admin onayı, CAYMA otomatik onayı,
  reconciler finalize/retry, 502 ile REFUNDING'de bırakma) audit izine sahiptir.
- **A2.** Müşteri, iade kararında tam bir kez bilgilendirilir; para hareketi
  olmayan kapanışta "ödemen iade edildi" denmez.
- **Y1.** Her yarışta (iki admin, approve↔reject, retry↔reconciler, çift
  worker, kısmi↔kısmi, kısmi↔tam) tek işlem sahibi olur; provider çağrı
  sayısı, para tutarı, stok hareketi sayısı, audit ve bildirim tekrarları
  yukarıdaki invariantları korur; kayıp güncelleme oluşmaz.
- **R1.** Reconciler görünürlüğü: "intent var sonuç belirsiz", "provider ok
  yerel eksik", "terminal talep ama para bekliyor", "para dönmüş stok eksik"
  durumlarının hiçbiri sessizce kaybolmaz; çözümsüz kayıt kalıcı ve
  sorgulanabilir bir işaret taşır (bkz. §5 reconciler kararı).

## 3. Doğrulanmış kusur kataloğu

Her madde ana araştırmacı tarafından koddan bizzat doğrulandı. "Kanıt" sütunu
mevcut davranışın satırıdır; "Test" sütunu kırmızı kabul matrisindeki karşılığı.

| ID | Kusur | Kanıt | İhlal | Test |
|---|---|---|---|---|
| **İP2A-01** | Reconciler, iadeyi FINALIZE/RETRY ederken telafilerin hiçbirini uygulamaz: stok geri konmaz, kupon serbest kalmaz, `refunded_amount` artmaz, sipariş FSM'i işlemez, müşteri bildirilmez. Sonrası kapalıdır: sipariş artık PAID olmadığından hiçbir yol telafiyi tamamlayamaz. `order_service.py:1364-1366` ve `:1856-1857` yorumları ("reconciler bu fonksiyonu tekrar çağırır") gerçeği yansıtmaz. | `escrow_reconciler.py:98-134` yalnız `escrow.finalize_refund`/`perform_refund` çağırır; `escrow.py:279-301` yalnız durum+damga yazar | S3, M6, A2 | R-01a, R-01b |
| **İP2A-02** | `order_returns.provider_ref` HİÇBİR yerde yazılmaz (`_settle_return` provider'a `order.provider_ref` ile gider, `escrow.begin_refund` kullanılmaz). Reconciler sarkan talebi `provider_ref=None` + yanlış referans (`return:{id}`; charge'daki conversationId `order:{id}`) ile dener → iyzico'da anında False / UNKNOWN → 3 denemede kalıcı ALERT. Kısmi iadenin "reconciler devralır" güvencesi fiilen ölüdür; fake provider `provider_ref`'e bakmadığı için hiçbir mevcut test yakalamaz. | `models/store.py:794` (ölü kolon), `order_service.py:1854`, `escrow_reconciler.py:49-52,85-87,132`, `iyzico.py:258-260` | M3, R1 | R-02 |
| **İP2A-03** | Kısmi iade sonrası tam iade çifte ödeme: `refund_order`/`cancel_by_client` yalnız `payment_status=="PAID"` kontrol eder, `refunded_amount`'a bakmaz; `ORDER_SPEC.amount_attr="total"` olduğundan provider'a daima `order.total` gider. 300 TL sipariş → 100 kısmi + 300 tam = 400 TL. Tek koruma provider'ın aşırı-iade reddi — kısmi iadelerde geçersiz. | `order_service.py:1391,1420`, `escrow.py:137` | M1 | R-03 |
| **İP2A-04** | Eşzamanlı CAYMA/kısmi iade tavan aşımı: `request_return` sipariş kilidi almadan bayat `refunded_amount` okur; `uq_order_returns_open` yalnız `status='PENDING'` kapsar, CAYMA `APPROVED` doğar → DB koruması yok. Ayrıca `_settle_return:1837` commit'i Order kilidini düşürür; `:1878` `refunded_amount` artışı kilitsiz read-modify-write → kayıp güncelleme. | `order_service.py:1512-1521,1688-1691,1698-1702,1837,1878`; `models/store.py:811-816` | M1, Y1 | R-04a, R-04b |
| **İP2A-05** | `is_full_return` yalnız GÖNDERİLEN seçimi denetler, sipariş kapsamını değil. Çok kalemli siparişte tek kalemi tam adediyle iade eden müşteri: kargo bedelini de alır (`is_full=True`) VE kupon serbest bırakılır (`is_partial=False`). Satıcı aleyhine para sızıntısı + tek kullanımlık kupon yeniden kullanılır. | `returns.py:108-112`, `order_service.py:1654-1678,1871-1874` | M4, M5 | R-05a, R-05b |
| **İP2A-06** | Reconciler RETRY claim'i exclusive değil: `REFUNDING→REFUNDING` UPDATE'i durumu değiştirmediğinden WHERE ikinci yarışçı için de sağlanır; canlı istek provider çağrısında asılıyken reconciler aynı satır için ikinci gerçek provider refund'ı başlatabilir. Reconciler retry'ı ürün kilidi sözleşmesini de atlar. | `escrow_reconciler.py:117-132` (values yalnız damga+sayaç), `escrow.py:157-193` | M3, Y1 | R-06 |
| **İP2A-07** | `reject_return` hiçbir kilit/claim kullanmaz; `_settle_return:1834` `ret.status`'ü KOŞULSUZ `APPROVED` yazar. approve↔reject yarışında reject kazanıp commit etse bile approve üstüne yazar ve parayı gönderir → REJECTED talep hem APPROVED olur hem para çıkar. İki eşzamanlı reject de ikisi birden 200 döner (çift bildirim+audit). | `order_service.py:1594-1625,1808,1834` | D1, Y1 | R-07 |
| **İP2A-08** | Audit'siz para hareketleri: (a) CAYMA otomatik onayı hiçbir audit satırı üretmez (`order_service` `audit_service`'i hiç import etmez; audit yalnız router'da); (b) provider 502 dalında talep APPROVED+REFUNDING commit'lenmiş ama router'daki `audit_service.record`'a hiç ulaşılmaz — "kim onayladı" izi yok; (c) reconciler finalize yalnız `logger.warning`. | `store.py:456-460` (yalnız başarı yolu), `order_service.py:1549,1834-1867`, `escrow_reconciler.py:103-106` | A1 | R-08a, R-08b |
| **İP2A-09** | `refunded_amount` tam iade yollarında (admin refund, müşteri iptali, oversell, reconciler) hiç artmaz; tek yazan `_settle_return:1878`. Gelir raporu (`revenue_service.py:160`) iade cirosunu buradan okur → tam iadeler raporda görünmez; migration `75676a6e5a81`'in backfill ettiği invariant çalışma zamanında kırılır. Ayrıca kısmi iade tavanı (`remaining_refundable`) tam-iade-sonrası durumda yalnız `payment_status` kontrolüne yaslanır. | `order_service.py:1314-1382` (yazmaz), `revenue_service.py:160` | M6 | R-09 |
| **İP2A-10** | Fiziksel kabul/muayene adımı YOK: `RETURN_RECEIVED` bilinçli kapsam dışı (`inventory_rules.py:82-85`). Para ve stok, mal işletmeye ulaşmadan kesinleşir; iade edilen ürün ANINDA SALEABLE stokta satılabilir görünür. Hasarlı gelen iadenin DAMAGED'a taşınması tamamen elle, zorlanmayan bir adımdır. | `order_service.py:1766,1870`, `inventory_rules.py:66-67,82-85` | S4 | R-10 |
| **İP2A-11** | Kısmi iadede kalem-adet kümülatifi denetlenmez: `sel.quantity` yalnız `item.quantity` ile karşılaştırılır; önceki taleplerin aynı kalemden iade ettiği adet sorgulanmaz. Para tavanı `remaining_refundable`, stok tavanı `restored_quantity_by_order_item` ile ayrı ayrı korunur; `OrderReturnItem.quantity` kaydı gerçekte geri yüklenenden büyük kalabilir (sessiz `logger.error` + kırpma). Ek: `request_return` rate-limit'siz. | `order_service.py:1664-1668,1753-1759`; `store.py:870-888` | M5, S2 | R-11 |
| **İP2A-12** | Görev ayrılığı deliği: `POST /store/admin/orders/{id}/refund` yalnız `orders.manage` ister ve RMA kuyruğunu tamamen atlayarak DELIVERED siparişin tamamını iade eder — `returns.manage` ayrımı bu uç yüzünden etkisizdir. Ayrıca `GET /store/admin/returns` her satıra tam `OrderOut` (adres, telefon, `track_token`) gömer. | `store.py:418-429`, `order_service.py:1385-1405,1568` | A1 (yetki) | R-12 |
| **İP2A-13** | Bildirim kusurları: admin approve yolunda müşteri AYNI karar için İKİ bildirim alır (`_settle_return:1892` + `approve_return:1582`); `_settle_return` erken-çıkış dalı (para hareketi yok) sonrasında `approve_return` yine "ödemen iade edildi" der. `reject` bildirimi `admin_note`'u maskesiz gömer. | `order_service.py:1582-1588,1806-1812,1892-1902,1621` | A2 | R-13 |
| **İP2A-14** | Kuruş tutarlılığı: çoklu kısmi iadede indirim payları bağımsız yuvarlanır, artık hiçbir satıra atanmaz → N parçalı iade toplamı tek seferlik iadeden sapar (ör. 3×100 TL + 10 TL kupon: 3×3,33 = 9,99 ≠ 10,00). Ayrıca para yolunda iki yuvarlama standardı yaşar: `returns/tax/commission` ROUND_HALF_UP, `coupon_service.compute_discount` ve `order_service` toplamları context-default ROUND_HALF_EVEN. | `returns.py:64-76`, `coupon_service.py:41`, `order_service.py:242-244,326,396` | M5 | R-14 |
| **İP2A-15** | `OrderReturnItem.amount` brüt yazılır (kupon payı düşülmemiş, tavan uygulanmamış) → kuponlu siparişte `Σ items.amount ≠ refund_amount`; bu tutarsız değerler `OrderReturnOut.items[]` ile müşteriye/admin'e döner. | `order_service.py:1706-1717`, `schemas/store.py:395-399` | M4 | R-15 |
| **İP2A-16** ✅ **KAPANDI** *(güncel main'de İP-2b tarafından — bkz. §8)* | `coupon_service.release` silinecek `CouponRedemption`'ın varlığına bakmadan `used_count`'u düşürür. `redeem` başarısız olmuş (limit dolu) ama `coupon_id`'li PAID siparişin iadesi, BAŞKA müşterinin kullanımını sayaçtan siler. | `coupon_service.py:152-168`, `order_service.py:684-693,1380-1382` | M5 | R-16 |
| **İP2A-17** | Cayma/ayıplı süre ayrımı uygulanmaz: 14 günlük pencere `type`'a bakmadan tüm türlere uygulanır; süresi geçen cayma ile birlikte AYIPLI yolu da kapanır (`ReturnType` docstring'i "ayıplı malda süre daha uzundur" der, kod uygulamaz). Ayrıca `returns.py`'deki pencere fonksiyonları ölü koddur; pencere yalnız DELIVERED'da işler, SHIPPED'de süresizdir. | `order_service.py:90,1530-1535`; `returns.py:23-50` (ölü); `models/store.py:122-123` | (ürün kuralı) | R-17 |
| **İP2A-18** | **Bu checkpoint'in bulduğu yeni üretim hatası:** AYIPLI/DIGER iadenin admin onayında BAŞARILI yol, sağlayıcıdan para istendikten SONRA `MissingGreenlet` ile 500 verir. Mekanizma: `approve_return` → `_load_return` (selectinload `items`) → `_settle_return` → `_lock_order`'ın `populate_existing`'li refresh'i (`db.refresh(order, ["items","returns"])`) identity map'teki `ret` nesnesinin yüklü `items` koleksiyonunu expire eder → `_restock_items:1731` `ret.items` lazy-load → async oturumda MissingGreenlet. Sonuç: provider.refund ÇAĞRILDI (para çıktı), stok/finalize/bildirim koşmadı, talep REFUNDING'de sarkık, admin 500 gördü. CAYMA yolunda görünmez (talep aynı session'da taze yaratılır, `_load_return` devrede değildir); mevcut suite AYIPLI onayın başarılı yolunu hiç koşmadığından bugüne dek gizli kalmıştır. Gerçek PG reprosuyla doğrulandı. | `order_service.py:971-983,1575,1731,1870` | M2, S3, A2 | R-18 |

### Mevcut test altyapısında bulunan kusurlar (İP-2a kapsamında rapor edilir, düzeltme İP-2b)

- `tests/verify/test_verify_coupon_stock.py:174` `<= 1` iddiası trivial-pass
  (iki sipariş de başarısız olsa yeşil).
- `tests/verify/test_verify_returns.py` B5: kaç iadenin başarılı olduğu asserte
  edilmiyor; ilk iterasyon patlarsa `0 <= total` trivial geçer. Tüm B
  senaryoları tek kalemli sipariş kullanır → İP2A-05 görünmez; kuponlu iade
  hiç test edilmez.
- `tests/verify` paketinin hijyen nöbetçisi yok; verify factory'si ürünü ham
  `stock=n` ile doğurur (defter zinciri doğuştan kırık).
- İade uçlarının HTTP/yetki katmanının HİÇ testi yok (403/401/sahiplik/izin).
- `test_verify_cancel_and_reconcile.py` E4 ile `test_return_escrow_spec.py`
  birebir aynı introspection testi (mükerrer, davranış kanıtlamaz).
- `_KRITIK_TABLOLAR` nöbetçisi `payments`, `coupons`, `coupon_redemptions`,
  `notifications`, `outbox_events` tablolarını saymaz.

## 4. Kırmızı kabul matrisi

Dosyalar `backend/tests/integration/` altında; seçim yol bazlıdır:
`pytest tests/integration -q -k ip2a`. Sahte sağlayıcı çağrı kaydeder
(`refund_calls`) ve `refund_gate` (asyncio.Event) ile deterministik yarış
penceresi açar; gerçek ağ çağrısı yoktur. Tüm kurulum/temizlik
`ip2a_factory.py` üzerinden ID bazlıdır.

**Beklenen durum: KIRMIZI testler bugün FAIL eder (kusur kanıtı), YEŞİL
nöbetçiler PASS eder (meşru davranış koruması). skip/xfail YOKTUR.**

| Test ID | Dosya | Senaryo | Ölçülen | Bugün |
|---|---|---|---|---|
| R-01a | test_ip2a_refund_two_phase_pg.py | Sarkan REFUNDING iade + reconciler RETRY başarılı → stok geri konmalı, `refunded_amount` artmalı | provider çağrısı, stok hareketi, kolonlar | KIRMIZI |
| R-01b | test_ip2a_refund_two_phase_pg.py | Reconciler FINALIZE (provider'da iade pozitif) → sipariş/talep bütünlüğü tamamlanmalı | `refunded_amount`, stok, FSM | KIRMIZI |
| R-02 | test_ip2a_refund_two_phase_pg.py | `_settle_return` provider çağrısında talebin kendi `provider_ref`'i kaydedilmeli; reconciler dolu ref ile denemeli | `order_returns.provider_ref`, `refund_calls[i].provider_ref` | KIRMIZI |
| R-03 | test_ip2a_refund_two_phase_pg.py | 100 TL kısmi iade sonrası admin tam iade → provider'a giden toplam ≤ `total` | `refund_calls` toplamı | KIRMIZI |
| R-08c | test_ip2a_refund_two_phase_pg.py | `REFUND_MAX_ATTEMPTS` aşan sarkan iade sorgulanabilir kalıcı iz taşımalı (yalnız log değil) | `refund_status`/`refund_attempts` | KIRMIZI |
| R-09 | test_ip2a_refund_two_phase_pg.py | Admin tam iadesi `refunded_amount = total` bırakmalı | kolon | KIRMIZI |
| G-01 | test_ip2a_refund_two_phase_pg.py | Provider başarısız → talep REFUNDING kalır, REFUNDED görünmez, stok artmaz, sipariş PAID | kolonlar + defter | YEŞİL |
| G-02 | test_ip2a_refund_two_phase_pg.py | Sonuçlanmış (CAYMA-otomatik-onaylı) talebin admin approve'u → 409, provider çağrısı 1'de kalır | HTTP-dışı servis; `refund_calls` | YEŞİL |
| R-05a | test_ip2a_partial_math_pg.py | 2 kalemli sipariş, tek kalem tam adet iade → kargo EKLENMEMELİ | `refund_amount` | KIRMIZI |
| R-05b | test_ip2a_partial_math_pg.py | Aynı senaryo → kupon SERBEST BIRAKILMAMALI | `used_count`, redemption | KIRMIZI |
| R-14 | test_ip2a_partial_math_pg.py | 3 kalem tek tek iade toplamı == tek seferlik tam iade tutarı | kuruş | KIRMIZI |
| R-15 | test_ip2a_partial_math_pg.py | Kuponlu iadede `Σ OrderReturnItem.amount == OrderReturn.refund_amount` | kalem tutarları | KIRMIZI |
| R-16 | test_ip2a_partial_math_pg.py | redeem edilmemiş kuponlu siparişin iadesi `used_count`'u düşürmemeli | sayaç + redemption satırı | KIRMIZI |
| R-11 | test_ip2a_partial_math_pg.py | Önceden iade edilmiş adet ikinci talepte yeniden kabul edilmemeli (kümülatif kalem-adet) | talep kaydı vs defter | KIRMIZI |
| G-03 | test_ip2a_partial_math_pg.py | Kuponlu tek kalem kısmi iade: brüt − orantısal kupon payı, kargo yok | `refund_amount` | YEŞİL |
| G-04 | test_ip2a_partial_math_pg.py | Gerçek tam iade (tüm kalemler): kargo dahil, sipariş REFUNDED, kupon serbest | tutar + durum | YEŞİL |
| R-10 | test_ip2a_restock_pg.py | CAYMA sonucu para iadesi anında SALEABLE stok ARTMAMALI (fiziksel kabul yok) | defter + `products.stock` | KIRMIZI |
| G-05 | test_ip2a_restock_pg.py | `_restock_items` tekrarı ikinci hareket üretmez (idempotent replay) | hareket sayısı | YEŞİL |
| G-06 | test_ip2a_restock_pg.py | Kısmi miktar yalnız o miktar kadar SALEABLE ekler | `qty_delta` | YEŞİL |
| G-07 | test_ip2a_restock_pg.py | Hasarlı iade düzeltmesi: RETURN sonrası `damage_transfer(MUSTERI_IADESI_HASARLI)` SALEABLE→DAMAGED taşır; `RETURN` hareketi DAMAGED kovaya yazılamaz (DB CHECK) | iki bacak + CHECK | YEŞİL |
| G-08 | test_ip2a_restock_pg.py | Reddedilen (uygun olmayan) iade hiçbir stok hareketi üretmez | defter boş | YEŞİL |
| R-04a | test_ip2a_races_pg.py | İki eşzamanlı CAYMA talebi (refund_gate ile) → toplam iade ≤ total | `refund_calls`, `refunded_amount` | KIRMIZI |
| R-04b | test_ip2a_races_pg.py | İki PENDING kısmi iadenin eşzamanlı approve'u → `refunded_amount` kayıp güncelleme olmadan a1+a2 | kolon + çağrı sayısı | KIRMIZI |
| R-06 | test_ip2a_races_pg.py | Canlı settle provider'da asılıyken reconciler RETRY → provider çağrısı 1'de kalmalı | `refund_calls` | KIRMIZI |
| R-07 | test_ip2a_races_pg.py | approve ↔ reject yarışı → tek terminal sonuç; REJECTED üstüne para çıkmamalı | durum + `refund_calls` | KIRMIZI |
| G-09 | test_ip2a_races_pg.py | İki eşzamanlı approve → tek kazanan, tek provider çağrısı, tek stok seti (escrow.claim nöbeti) | `refund_calls`, defter | YEŞİL |
| G-10 | test_ip2a_admin_http_pg.py | Geçerli tam iade uçtan uca (müşteri HTTP CAYMA → 201; para+stok+sipariş bütünü; `returns.view` listede görür) | uçtan uca | YEŞİL |
| R-18 | test_ip2a_admin_http_pg.py | `returns.manage` izinli adminin AYIPLI onayı 500 vermeden tamamlanmalı (para çıktıysa stok+finalize de) | HTTP + DB | KIRMIZI |
| G-11 | test_ip2a_admin_http_pg.py | `returns.view`-yalnız admin approve → 403; hiçbir yan etki yok | HTTP + DB | YEŞİL |
| G-12 | test_ip2a_admin_http_pg.py | CLIENT token'ı admin iade uçlarına → 403; token'sız → 401 | HTTP | YEŞİL |
| G-13 | test_ip2a_admin_http_pg.py | Terminal (REJECTED) talebe ikinci approve/reject → 409; audit/bildirim/para tekrarı yok | HTTP + DB | YEŞİL |
| R-08a | test_ip2a_admin_http_pg.py | CAYMA otomatik onayı (müşteri HTTP isteği) audit izi üretmeli | `audit_logs` | KIRMIZI |
| R-08b | test_ip2a_admin_http_pg.py | Provider 502 dalında karar audit'e yazılmalı (talep APPROVED commit'leniyor) | `audit_logs` | KIRMIZI |
| R-12 | test_ip2a_admin_http_pg.py | `returns.manage`'sız admin `/admin/orders/{id}/refund` ile DELIVERED siparişi iade EDEMEMELİ (görev ayrılığı) | HTTP + `refund_calls` | KIRMIZI |
| R-13 | test_ip2a_admin_http_pg.py | Admin approve müşteriye TEK bildirim üretmeli | `notifications` sayısı | KIRMIZI |
| R-17 | test_ip2a_admin_http_pg.py | Teslimden 14+ gün sonra AYIPLI talebi cayma penceresine takılmamalı | HTTP 201 beklenir | KIRMIZI |

Toplam: **23 kırmızı, 13 yeşil** kabul testi (36).

Not: İP2A-18 (AYIPLI onayında 500) yüzünden approve yoluna dayanan bazı testler
CAYMA yolu üzerinden kurulur; R-13 bugün "2 bildirim" yerine "0 bildirim"
(500, bildirime hiç ulaşmıyor) gözlemler — her iki hâl de A2 ihlalidir. G-09 ve
R-07, kazanan tarafın bilinen İP2A-18 istisnasını açık yorumla tolere eder;
ölçtükleri iddia (claim tekliği / durum bütünlüğü) bundan bağımsızdır.

## 5. Reconciler ve açık ürün/hukuk kararları

### Reconciler kararı (mimarinin mevcut araçlarıyla, para-güvenli)

Mevcut mimaride kalıcı bir MANUAL_REVIEW durumu yoktur; ALERT yalnız log'dur.
Sözleşme olarak hedef davranış:

1. **Intent var, provider sonucu bilinmiyor** → mevcut WAIT/RETRY karantinası
   doğru; ancak RETRY claim'i exclusive olmalı (İP2A-06) ve talebin KENDİ
   `provider_ref`'i ile yapılmalı (İP2A-02).
2. **Provider başarılı, yerel kayıt eksik** → FINALIZE doğru karar; fakat
   finalize telafileri de (stok, kupon, `refunded_amount`, FSM, bildirim)
   idempotency anahtarlarıyla uygulamak ZORUNDA (İP2A-01). Telafiler zaten
   idempotent olduğundan bu güvenlidir.
3. **`REFUND_MAX_ATTEMPTS` aşıldı** → kayıt sessiz ALERT log'unda değil,
   sorgulanabilir bir yerde durmalı (öneri: `refund_status=MANUAL_REVIEW`
   değeri VEYA admin ucundan listelenebilir "sarkan iadeler" görünümü).
   Log-tek-başına kabul edilemez; hangi mekanizmanın seçileceği İP-2b tasarım
   kararıdır. Para-güvenli taban çizgisi: asla otomatik REFUNDED yazma,
   pozitif kanıt (`refund_state=REFUNDED`) olmadan finalize etme — bu ilke
   bugün de doğru uygulanıyor ve korunmalıdır.
4. **Para dönmüş, stok eksik / stok var, refund belirsiz** → tespit sorgusu
   mümkündür (defter anahtarı `return_line:{id}:RETURN` ⋈ `refund_status`);
   reconciler kapsamına alınması İP-2b işi. Bu checkpoint yalnız kusuru ölçer.

### Ürün/hukuk kararı gerektiren açık maddeler (bu turda karar VERİLMEDİ)

- **PK-α (fiziksel kabul):** "Stok yalnız teslim alınıp uygun bulununca döner"
  hedefi (S4/İP2A-10) bir kabul/muayene adımı gerektirir: kim işaretler
  (operasyon ekranı?), CAYMA parasının iadesi kabulden önce mi sonra mı
  (Mesafeli Sözleşmeler Yönetmeliği m.12: iade, malın ulaşmasından itibaren
  14 gün içinde — para iadesini kabule bağlamak hukuken mümkündür), kanıt
  (foto) zorunlu mu. R-10 hedef davranışı "kabul olmadan stok artmaz" olarak
  ölçer; ödeme zamanlaması ürün kararıdır.
- **PK-β (ayıplı süre penceresi):** AYIPLI için pencere kaç gün (TKHK m.10:
  2 yıl zamanaşımı; teslimden 6 ay içinde ispat yükü satıcıda)? Kanıt/foto
  isteniyor mu? R-17 yalnız "cayma penceresi ayıplıyı kapatmasın" der; süre
  üst sınırı ürün/hukuk kararıdır.
- **PK-γ (görev ayrılığı):** `/admin/orders/{id}/refund` DELIVERED sipariş
  için de açık kalmalı mı, yoksa teslim sonrası her iade RMA'dan mı geçmeli?
  R-12 "returns.manage'sız admin teslim edilmiş siparişi iade edemez" hedefini
  ölçer; ucun tamamen kaldırılması ayrı karar.
- **PK-δ (MANUAL_REVIEW mekanizması):** yeni enum değeri mi, ayrı tablo mu,
  admin görünümü mü — İP-2b tasarımı.
- **PK-ε (yasal metin uyumu):** `legalContent.ts` iade politikası ile kodun
  cömert davranışı arasındaki fark (ekspertiz Hafta 14 kararı) hâlâ açık.
- **PK-ζ (kargo iade politikası):** Ayıplı üründe iade kargo masrafı satıcıya
  aittir (TKHK m.11); kodda iade kargo maliyeti hiç modellenmemiştir.

## 6. Test altyapısı sözleşmesi

- **DB:** yalnız adı `test` içeren / allowlist'teki tek kullanımlık PG
  (`db_guard.assert_test_database`); şema `alembic upgrade head` ile.
- **Factory:** `tests/integration/ip2a_factory.py`. Ürünler İNİTİAL defter
  hareketiyle doğar (zincir doğuştan sağlam); siparişler gerçek modellerle
  (Order+OrderItem+kupon+SALE hareketi) kurulur; admin'ler gerçek rol+izin
  satırları ve gerçek JWT ile. Temizlik YALNIZ factory'nin kaydettiği ID'lerle,
  FK sırasına göre; ürünler `db_guard.purge_products` ile. Global TRUNCATE,
  trigger disable (purge_products'ın kendi kontrollü kullanımı hariç),
  skip/xfail YOK.
- **Provider:** `tests/integration/conftest.py::StubProvider` — çağrı kaydeder
  (`refund_calls`), `refund_gate` ile deterministik yarış penceresi,
  `refund_result` ile başarısızlık senaryosu. Gerçek ağ çağrısı yok.
- **İdempotency anahtarları koşuma özgü** (ürün/sipariş ID'leri her koşumda
  yeni; sabit anahtar paylaşılmaz).
- **Yarışlar:** `asyncio.gather` + ayrı `AsyncSessionLocal` oturumları +
  `SET LOCAL lock_timeout='4s'`; 40P01/55P03 ayrı raporlanır; beklenmeyen
  istisnalar yeniden yükseltilir (sessiz yutma yok).
- **HTTP:** `httpx.AsyncClient(transport=ASGITransport(app))`; gerçek token,
  gerçek izin çözümü, gerçek dependency zinciri.
- Kırmızı testler `KNOWN-RED(İP2A-XX)` işaretli assert mesajları taşır; İP-2b
  düzeltmeleri sonrasında aynı testler değiştirilmeden yeşile dönmelidir.

## 7. Mutasyon prova raporu (yeşil nöbetçiler)

Her mutasyon geçici uygulandı, ilgili yeşil testin GERÇEKTEN kırıldığı
gösterildi, sonra eksiksiz geri alındı (`git diff` boş doğrulandı). Kalıcı
üretim değişikliği yapılmadı.

| # | Mutasyon (geçici) | Kıran test | Sonuç |
|---|---|---|---|
| M1 | `_settle_return` claim'inin `from_statuses`'una REFUNDING/REFUNDED eklendi (idempotency kalktı) | G-09 | KIRILDI ✓ (G-02'yi kırmadı — G-02'nin nöbetçisi status guard'ı; bkz. M1b) |
| M1b | `approve_return`'ün `status != PENDING → 409` guard'ı kaldırıldı | G-02, G-13 | KIRILDI ✓ |
| M2 | `compute_refund` kupon payını düşmeden liste fiyatından hesapladı | G-03 | KIRILDI ✓ (G-04 tavan kırpması sayesinde etkilenmez — bilinçli not) |
| M3 | Yalnız restock idempotency anahtarı çağrıya-özgü yapıldı | — | Yakalanmadı ve YAKALANMAMALI: ikinci bağımsız koruma (kilit altındaki `restored_quantity_by_order_item` tavanı) davranışı korudu; davranış bozulmadı |
| M3′ | Anahtar + tavan birlikte bozuldu (davranış gerçekten bozuldu) | G-05 | KIRILDI ✓ |
| M4 | `damage_transfer`'ın DAMAGED bacağı kaldırıldı (hasar hasarlı kovaya yazılmıyor) | G-07 | KIRILDI ✓ |
| M5 | Provider başarısızlığı yutulup akış REFUNDED'a sürüldü | G-01 | KIRILDI ✓ |
| M6 | `escrow.claim` koşullu UPDATE sonucu yok sayıldı (`return True` — FOR-UPDATE-eşdeğeri atomik nöbet kalktı) | G-09 | KIRILDI ✓ |
| M7 | Approve ucunun izni `returns.manage` → `returns.view` düşürüldü | G-11 | KIRILDI ✓ |

## 8. Güncel main adaptasyonu

> **Bu bölüm §1-§7'yi GEÇERSİZ KILMAZ.** Yukarısı `26f30d8` zemini üzerinde
> alınmış tarihsel kırmızı checkpoint kaydıdır ve bağımsız denetimden geçmiştir;
> olduğu gibi korunur. Bu bölüm, aynı kabul matrisinin **güncel main** üzerinde
> yeniden ölçülmüş halini kaydeder.

### Adaptasyon künyesi

| | |
|---|---|
| Adaptasyon öncesi checkpoint | `295ffb6` (tarihsel zemin `26f30d8`) |
| Adaptasyona alınan main | `3cf40f2` (F30 + İP-2b + İP-1a merge'leri dahil) |
| Merge commit | `0be5edc` — `merge(ip2a): guncel main'i magaza iade checkpointine al` (parent1 `295ffb6`, parent2 `3cf40f2`; no-ff, çatışmasız) |
| Güvenlik dalı | `ip2a-checkpoint-295ffb6` (tarihsel HEAD'i işaret eder) |
| Yön | yalnız main → İP-2a dalı. Main'e merge YAPILMADI, rebase/squash YOK, push YOK |

### Güncel matris: **22 kırmızı + 14 yeşil** (36 node)

Gerçek PostgreSQL (`adana_ip2a_current_checkpoint_test`, tek kullanımlık) +
`PAYMENT_PROVIDER=fake` ile ölçüldü:

| Ölçüm | Tarihsel (`26f30d8`) | Güncel main (`3cf40f2`) |
|---|---|---|
| Toplam node | 36 | **36** (birebir aynı node adları) |
| Kırmızı | 23 | **22** |
| Yeşil | 13 | **14** |
| Skip / xfail / collection error | 0 / 0 / 0 | **0 / 0 / 0** |
| İP-2a dışı başarısızlık | 0 | **0** (tam paket: 22 failed / 953 passed / 16 skipped) |

- **Eski 36 node'un tamamı korundu.** Node listesi `295ffb6` ile birebir
  karşılaştırıldı: silme, yeniden adlandırma, parametrizasyonla gizleme,
  skip/xfail ekleme YOK.
- **Tarihsel 13 yeşil nöbetçinin hiçbiri kırmızıya dönmedi** — F30, İP-2b ve
  İP-1a merge'leri (`order_service.py`'ye +394 satır dahil) bu paket açısından
  regresyon üretmedi.
- **Yeni/beklenmeyen başarısızlık yok.**

### Kırmızıdan yeşile dönen tek node: R-16 (İP2A-16)

`test_ip2a_partial_math_pg.py::test_r16_tuketilmemis_kupon_iadesi_baskasinin_kullanimini_silmemeli`
**testi değiştirilmeden** yeşile döndü. Kapanış test tesadüfü değil, gerçek bir
üretim değişikliğidir:

- Commit: **`f2eb729`** — `fix(ip2b): stok kupon ve teslimat iptal yan etkilerini kapat`
- Dosya: `services/coupon_service.py` → `release()`
- Değişen davranış: `used_count` artık **koşulsuz azaltılmıyor**. Sayaç yalnız
  bu siparişe ait `CouponRedemption` satırı gerçekten varsa düşürülüyor; satır
  yoksa sayaca dokunulmadan `False` dönülüyor. Yan fayda: satır bir kez
  silindikten sonra ikinci çağrı no-op — **idempotent** (retry/çift iptal
  sayacı ikinci kez düşüremez). Dönüş tipi `None` → `bool` oldu.
- Böylece "limit dolu olduğu için `redeem` False dönmüş ama `coupon_id` taşıyan
  siparişin iadesi BAŞKA müşterinin kullanımını siler" kusuru ortadan kalktı.

### Kalan 22 kusur — hâlâ açık

İP2A-01, -02, -03, -04, -05, -06, -07, -08, -09, -10, -11, -12, -13, -14, -15,
-17, -18 (§3'teki kanıt satırları geçerliliğini koruyor).

**İP2A-18 güncel main'de hâlâ yeniden üretiliyor:** `returns.manage` izinli
adminin AYIPLI onayı, sağlayıcıya para emri verildikten SONRA çöküyor —
R-18 ölçümü: *"AYIPLI onayının başarılı yolu 500 döndü — sağlayıcıya para emri
verildikten sonra süreç çöküyor (provider çağrısı: 1); stok geri konmadı, talep
REFUNDING'de sarkık kaldı"*. İP2A-02 ile birleşince sarkan kayıt
`provider_ref=None` taşıdığı için reconciler de kurtaramıyor.

### Bu turun kapsamı ve sonraki tur

- **Bu tur üretim düzeltmesi İÇERMEZ.** Üretim koduna, test dosyalarına ve test
  assertion'larına dokunulmadı; yalnız main merge'i + bu doküman bölümü eklendi.
- **PK-α** (fiziksel kabul adımı ve ödeme zamanlaması) ve **PK-δ**
  (MANUAL_REVIEW mekanizması) kararları **üretim uygulamasından önce
  kesinleştirilecek** — R-10 ve R-08c bu kararlar olmadan yeşillenemez. PK-δ'da
  "admin sarkan-iadeler görünümü" seçeneği tercih edilirse R-08c'nin bugünkü
  assert'i (`refund_status != 'REFUNDING'`) o çözümle yeşillenmez; testin
  uyarlanması bilinçli bir karar olarak kaydedilmelidir.
- Bağımsız denetimin bulduğu **P2-1** (G-09'un M1 mutasyonunu yakalaması
  `sleep(0.1)` penceresine bağlı — 5 turda 1 kaçırma) ve **P2-2** (R-18 yalnız
  `kod == 200` assert ediyor; stok/finalize/bildirim ölçülmüyor) test borçları
  **üretim uygulaması sırasında** ele alınacak.

## 9. Üretim uygulaması kapanışı

> **Bu bölüm §1-§8'i GEÇERSİZ KILMAZ.** Yukarısı kırmızı checkpoint kaydıdır ve
> tarihsel belge olarak korunur. Burada, aynı kusur kataloğunun **üretim kodu
> ile kapatılmış** hâli ve bu turda alınan kesin ürün kararları kayda geçer.

### Künye

| | |
|---|---|
| Başlangıç HEAD | `5fc9a95` (docs: güncel main checkpoint matrisi) |
| Adaptasyona alınan main | `3cf40f2` (main'e merge YAPILMADI) |
| Tarihsel kırmızı checkpoint | `295ffb6` · güvenlik dalı `ip2a-checkpoint-295ffb6` |
| Alembic | tek head `ip2a_iade_para_guvenligi` (revises `ip2b_terminal_history_guard`) |
| Yön | yalnız İP-2a dalı; rebase/squash/force/push YOK |

### Kesinleşen ürün kararları

#### PK-α — fiziksel kabul ve stok zamanı (ONAYLANDI)

Para ve mal **ayrı eksenlerde** yürür:

- Para iadesi, talebin yetkili biçimde onaylanması ve **sağlayıcının iadeyi
  tamamlaması** ile kesinleşir. Depo kabulüne veya muayeneye BAĞLANMAZ.
- Stok, para iadesi sırasında geri EKLENMEZ. Ürün ancak fiziksel olarak teslim
  alınıp kabul/muayene adımı tamamlanınca stoğa döner.
- Dönüş **tam bir kez** gerçekleşir; tekrarlı kabul ikinci stok hareketi
  üretmez. Hasarlı adet DAMAGED, sağlam adet SALEABLE kovasına gider; kabul
  edilmemiş (gelmemiş) adet **hiçbir kovaya** girmez.

Mevcut FSM en dar biçimde genişletildi — paralel bir iade sistemi kurulmadı:

```
order_returns.status         PENDING → APPROVED | REJECTED       (atomik claim)
order_returns.refund_status  NONE → REFUNDING → REFUNDED | MANUAL_REVIEW
order_returns.received_at    NULL → damga (tek seferlik, terminal)
order_return_items.accepted_quantity / damaged_quantity
        toplam ≤ quantity  (DB CHECK: ck_order_return_items_received)
```

Üç eksen birbirinden bağımsızdır: bir talep APPROVED + REFUNDED olup malı hâlâ
gelmemiş olabilir (`received_at IS NULL`) — ve katalog o kitabı "stokta" GÖSTERMEZ.

#### PK-δ — MANUAL_REVIEW (ONAYLANDI)

Otomatik deneme tavanı (`REFUND_MAX_ATTEMPTS=3`) dolduğunda kayıt REFUNDING'de
bırakılmaz; `MANUAL_REVIEW`'a geçer. Sözleşme:

- otomatik reconciler kaydı bir daha sağlayıcıya **göndermez**;
- `REFUNDED` **yazılmaz** — para gerçekten döndü mü bilinmiyor, bu durum ne
  kesin başarısızlık ne kesin iadedir;
- stok / kupon / bildirim / finalize gibi "başarı" yan etkileri **oluşmaz**;
- kayıt admin kuyruğundan sorgulanabilir: `GET /store/admin/returns?refund_status=MANUAL_REVIEW`
  (mevcut kuyruk filtreyle genişletildi — ikinci bir admin sistemi kurulmadı);
- geçiş `audit_logs`'a (`refund.manual_review`) yazılır ve yöneticilere bildirim
  gider. Sorgulanabilir bir durum tek başına yetmez: kimsenin bakmadığı kuyruk
  sessiz log'dan yalnız biraz iyidir.

Sipariş düzeyinde de aynı değer tanımlıdır (`orders.payment_status`);
`_cancel_order` MANUAL_REVIEW'ü de 409'lar (parası havada olan sipariş elle
CANCELLED'a çevrilemez).

### Kusurların kapanış yöntemi

| ID | Kapanış |
|---|---|
| **İP2A-01** | `reconcile_refunding` yeniden yazıldı: kayıt-başı transaction + advisory kilit; başarıda `Order` için stok/kupon/FSM/bildirim, `OrderReturn` için `settle_completed_return` (refunded_amount + kupon + FSM + audit + bildirim). Bir kaydın hatası partiyi düşürmez (`logger.exception`, sessiz yutma yok). |
| **İP2A-02** | `order_returns.provider_ref` niyet anında siparişin `provider_ref`'inden (tahsilatın `paymentTransactionId`'si) yazılır. `RETURN_SPEC.reference_prefix` `return` → `order` + `reference_id_attr="order_id"`: iyzico `payment/detail` yalnız charge'ın conversationId'sini tanır. |
| **İP2A-03** | `perform_refund(amount=...)`; sipariş yolunda tutar `total` değil `total − refund_reserved`. Reconciler retry'ında `order_inflight_refund` (fail-safe: fark 0 çıkarsa `total − refunded_amount`, çünkü 0 göndermek parayı iade etmeden REFUNDED yazmak olurdu). |
| **İP2A-04** | `orders.refund_reserved` + koşullu UPDATE (`reserved + tutar <= total`) + `request_return`/`_settle_return`'de tavanın sipariş kilidi altında TAZE okunması. `refunded_amount` artışı atomik SQL (Python `+=` kalktı). |
| **İP2A-05** | `returns.covers_whole_order`: "tam iade" = seçimden sonra müşteride iade edilebilir adet KALMAMASI. Kargo yalnız siparişi boşaltan talebe eklenir; kupon yalnız o talepte serbest kalır. |
| **İP2A-06** | Advisory `pg_try_advisory_xact_lock` / `pg_advisory_xact_lock` (spec başına tekil `lock_class`) sağlayıcı çağrısı boyunca tutulur; `perform_refund` kilidi aldıktan sonra TAZE durumu yeniden okur. Retry claim'i karantina koşulunu da WHERE'e alır. Satır kilidi kullanılmadı: Order↔OrderReturn döngüsü kurup iki eşzamanlı iadede gerçek deadlock üretiyordu. |
| **İP2A-07** | `_settle_return` ve `reject_return` talep durumunu `PENDING`'den **atomik claim** eder; koşulsuz `APPROVED` yazımı kalktı. CAYMA talebi de PENDING doğar ve aynı claim'den geçer. |
| **İP2A-08** | Audit servise taşındı (`_audit_return`) ve **kararı taşıyan transaction'ın içinde** yazılır: CAYMA otomatik onayı iz bırakır, sağlayıcı 502'sinde karar audit'i kaybolmaz. Router'daki ikinci yazım kaldırıldı (aynı karar iki kez kaydedilmez). |
| **İP2A-09** | `apply_refunded_amount` tek yazıcı (atomik SQL, `LEAST` ile tavan). RMA, admin tam iadesi, müşteri iptali ve reconciler aynı muhasebeyi kullanır. Artışlar yalnız `finalize_refund`'un atomik claim'ini KAZANAN yoldan çağrılır → tam bir kez. |
| **İP2A-10** | PK-α: `receive_return` + `ReceiveLine` + `POST /store/admin/returns/{id}/receive` (`returns.manage`). `_restock_items` kabul edilen adedi yazar ve para yolundan hiç çağrılmaz. |
| **İP2A-11** | `_returned_quantities`: kalem başına kümülatif adet (PENDING+APPROVED talepler) tavan olur. `POST /orders/{id}/return` kullanıcı bazlı rate-limit (`RATE_LIMIT_RETURN`). |
| **İP2A-12** | `/admin/orders/{id}/refund` DELIVERED siparişi 409'lar (İP-2b R4, korunuyor) ve `returns.manage`'sız admin RMA'yı atlayamaz; yan etkisizlik testte ölçülür. `refund_status` filtresi eklendi. |
| **İP2A-13** | Müşteri bildirimi TEK yerden — para hareketi gerçekleşen yoldan — çıkar. Para hareketi olmayan kapanışta "ödemen iade edildi" DENMEZ. Ret bildiriminde admin notu `mask_contact_info`'dan geçer. |
| **İP2A-14** | Tek yuvarlama standardı ROUND_HALF_UP (`coupon_service.compute_discount` dahil). `allocate_discount_shares` en-büyük-artık; `line_discount_portion` satır içi kümülatif. |
| **İP2A-15** | Kalem tutarları NET yazılır; kargo `shipping_refund` kolonunda ayrışır. Özdeşlik: `refund_amount = Σ items.amount + shipping_refund` (tavan kırpması `_tavana_kirp` ile özdeşliği bozmadan yapılır). |
| **İP2A-16** | **Zaten kapalıydı** — güncel main'de İP-2b commit `f2eb729` (`coupon_service.release` yalnız gerçek `CouponRedemption` satırı varsa sayacı düşürür). Bu turda YENİDEN YAZILMADI; R-16 değiştirilmeden yeşil kaldı. |
| **İP2A-17** | `RETURN_WINDOW_BY_TYPE` + `return_window_days`: CAYMA/DIGER 14 gün, AYIPLI `RETURN_DEFECT_WINDOW_DAYS=730` (TKHK m.12 zamanaşımı tabanı). Üst sınır hâlâ ürün/hukuk kararı (PK-β), ama cayma penceresi artık ayıplı yolunu KAPATMAZ. |
| **İP2A-18** | Kök neden: `_lock_order`'ın refresh'i identity map'teki `OrderReturn`'ün yüklü `items` koleksiyonunu expire ediyor; `_restock_items` ona dokununca async oturumda lazy-load → `MissingGreenlet` → 500 (para emri VERİLDİKTEN sonra). Düzeltme async lazy-load'a hiç güvenmiyor: kalem satırları her ihtiyaçta `_return_lines` ile açıkça sorgulanır, `_return_to_out` gerektiğinde onları dışarıdan alır. |

### Sözleşme özetleri

- **`refunded_amount` tek yazıcı:** `apply_refunded_amount` (atomik `UPDATE … LEAST(refunded_amount + :a, total)`). Yalnız `finalize_refund` claim'ini kazanan yol çağırır. Değişmez: `refunded_amount ≤ refund_reserved ≤ total`.
- **`provider_ref`:** talebin kolonu **tahsilatın** işlem kimliğidir; iade idempotency'si bu kolonda değil `refund_status` claim'inde + advisory kilitte yaşar. Aynı talep retry edilirse aynı referans kullanılır.
- **Reconciler:** WAIT / FINALIZE / RETRY / **MANUAL_REVIEW**. Her kayıt kendi transaction'ında ve kendi advisory kilidiyle; RETRY'da sağlayıcı başarısız olsa bile commit edilir (deneme sayacı kalıcı olmazsa kayıt tavana hiç ulaşmaz → sonsuz sessiz retry).
- **Kilit sırası:** Product → Order → OrderReturn. Sağlayıcı çağrısı boyunca hiçbir SATIR kilidi tutulmaz (kurye teslimi bloke olmasın — İP-2b R17); eşzamanlılık nöbetini advisory kilit tutar.
- **Para matematiği:** ROUND_HALF_UP; indirim satırlara en-büyük-artıkla bir kez dağıtılır; kargo yalnız siparişi boşaltan talepte; kalem tutarları net.

### Test matrisi

Gerçek PostgreSQL (`adana_ip2a_impl_test`, tek kullanımlık) + `PAYMENT_PROVIDER=fake`.

| Dosya | Node |
|---|---|
| `test_ip2a_refund_two_phase_pg.py` | 10 |
| `test_ip2a_partial_math_pg.py` | 11 |
| `test_ip2a_restock_pg.py` | 8 |
| `test_ip2a_races_pg.py` | 10 |
| `test_ip2a_admin_http_pg.py` | 10 |
| **Toplam** | **49 — 49 passed / 0 failed / 0 skip / 0 xfail / 0 collection error** |

**Eski 36 node'un tamamı korundu** (node adları `5fc9a95` ile karşılaştırıldı:
silme, yeniden adlandırma, parametrizasyonla gizleme, skip/xfail YOK). 13 yeni
node eklendi.

#### Ürün kararı nedeniyle içeriği değişen node'lar (gizlenmedi, kaydedildi)

| Node | Değişiklik ve gerekçe |
|---|---|
| R-10 | İkinci bacak eklendi: kabulden sonra dönüşün TAM BİR KEZ ve doğru kovada olması. Tarihsel hâli yalnız "para iadesinde stok artmasın" diyordu, doğru davranışı ölçmüyordu. |
| R-08c | Artık kesin `MANUAL_REVIEW` bekler. Eski "REFUNDING olmasın" iddiası, kaydı yanlışlıkla REFUNDED yazan bir uygulamayı da GEÇİRİRDİ. |
| R-01a | Stok yerine reconciler'ın tamamlaması gereken her telafi tek tek ölçülüyor; stoğu geri KOYMADIĞI ayrıca doğrulanıyor (PK-α). |
| R-04a | Ara adım "ikinci talep kabul edilmeli (kusurun kendisi)" idi; kusur kapandığında bu bekleme gerçekleşemez. Ölçülen iddia (M1) aynı, test "kaybeden yan etki üretmez" ile güçlendi. |
| R-03, R-09 | SHIPPED siparişe kuruldu + zorunlu `reason`. DELIVERED sipariş `refund_order`'dan zaten 409 alıyordu (İP-2b R4) ve gövdesiz çağrı TypeError üretiyordu — yani uç HİÇ koşmuyor, tavan hiç ölçülmüyordu. |
| R-12 | Gerekçe gövdesiyle çağrılıyor: gövdesiz POST 422 üretiyor ve görev ayrılığı iddiası hiç sınanmıyordu. |
| R-18 | Bağımsız denetimin **P2-2** borcu kapandı: yalnız `kod == 200` ölçen hâli, 200 dönüp parayı yarım bırakan uygulamayı da geçirirdi. Artık para emrinin bütün sonuçları ölçülüyor. |
| G-02/05/06/07/10 | Stok ölçen nöbetçiler `fab.teslim_al(...)` adımını açıkça geçiyor; ölçtükleri iddialar aynı, hareketi doğuran adım değişti. G-10 kabulü gerçek HTTP ucundan geçiriyor. |
| G-09, R-07 | Bağımsız denetimin **P2-1** borcu kapandı: `asyncio.sleep(0.1)` yerine ardışıklığı ÖLÇEN `SiralamaKapisi`. `_yalniz_beklenenler`'in `ip2a18_tolere` kapısı kaldırıldı — İP2A-18 kapandığı için MissingGreenlet'i tolere etmek gerçek regresyonu yutardı. |

#### Yeni node'lar

`test_r02b` (provider_ref ilk denemede yazılır) · `test_r08d` (MANUAL_REVIEW
admin kuyruğunda) · `test_r10b/c/d` (hasarlı kabul kovası · kabul edilmeyen adet
+ tekrarlı kabul · onaysız talebin malı alınamaz) ·
`test_kismi_ve_tam_iade_iki_siralamada_da_tavani_korur` ·
`test_ardisik_iki_kismi_iade_kalem_adedi_ve_tavani_asamaz` ·
`test_reconciler_bir_kaydin_hatasinda_partiyi_dusurmez` ·
`test_onay_ile_tam_iade_yarisinda_tavan_korunur` ·
`test_iki_reconciler_worker_ayni_iadeyi_iki_kez_gondermez` ·
`test_kupon_kargo_ve_kurus_matematigi_parcali_iadede_de_tutar` ·
`test_satir_ici_kismi_adetlerde_kupon_payi_kaybolmaz` ·
`test_tek_seferlik_tam_iade_parcali_toplamla_ayni_kurusu_uretir`.

#### İP-2a dışı, bilinçli olarak güncellenen testler

| Dosya | Neden |
|---|---|
| `tests/test_return_escrow_spec.py` | `reference_prefix == "return"` iddiası İP2A-02'yi SABİTLİYORDU; doğru sözleşmeyle değiştirildi, gerekçe testin docstring'ine yazıldı. |
| `tests/test_order_refund_two_phase.py` | Sahte oturum tavan sorgusunu cevaplayabiliyor (tavan kararı bayat ORM nesnesine bırakılamaz); gönderilen tutarın KALAN olduğu ve rezervasyonun niyetle aynı UPDATE'e bindiği ayrıca ölçülüyor. |
| `tests/acceptance/test_stock_lock_contract.py` | Kilit sırası sözleşmesi `_settle_return` → `receive_return` TAŞINDI. Stok yazan yol hâlâ ürün kilidini karardan önce almak zorunda; sözleşme gevşemedi, yolun adı değişti. |
| `tests/verify/test_verify_reconciler.py` | Tavan dolunca MANUAL_REVIEW (PK-δ). Korunan çekirdek aynı: REFUNDED yazılmaz, sağlayıcıya bir daha gidilmez. |
| `tests/verify/test_verify_returns.py` (B3) | "Yalnız 1 adet geri gelmeli" iddiası korundu; kabulden ÖNCE stoğun artmadığı ayrıca doğrulanıyor. |
| `tests/integration/test_stock_writers_pg.py` | Fabrika kabul adedini açıkça dolduruyor: o dosyanın konusu defter YAZICISININ sözleşmesi, kabul kapısı değil. Kabul adedini set etmemek, yazıcıyı hiç çalıştırmadan "hareket yok" ölçmek olurdu. |

### Mutasyon prova raporu (İP-2a)

Sürücü: `backend/scripts/mutation_drill.py` (byte-yedekli `GeciciYama`, kirli
ağaçta ret, her mutasyondan sonra HEAD + `git status` eşitliği doğrulanır).
Sürücüye `Mutasyon.ek` alanı eklendi: katmanlı korumanın olduğu yerde tek-yama
zorunluluğu provayı kör bırakıyordu.

| # | Mutasyon | Sonuç |
|---|---|---|
| M23 | `refunded_amount` artışı kaldırıldı | KIRILDI ✓ (10 node) |
| M24 | rezervasyon tavanı koşullu UPDATE'ten kaldırıldı | **Yakalanmadı** — tavan dört bağımsız guard'la korunuyor (satır kilidi · kilit altında taze okuma · `payment_status == PAID` · koşullu UPDATE); hiçbirini tek başına sökmek ulaşılabilir aşırı iade üretmiyor |
| M24b | tavan hesabı tarihsel/bayat hâline döndürüldü + koşullu UPDATE söküldü (= İP2A-03/04) | KIRILDI ✓ (`test_onay_ile_tam_iade_yarisinda_tavan_korunur`) |
| M25 | talebin `provider_ref`'i yazılmıyor | KIRILDI ✓ (R-02, R-02b, R-18) |
| M26 | reconciler final telafileri atlanıyor | KIRILDI ✓ (R-01a) |
| M27 | retry claim'inin karantina koşulu söküldü | **Yakalanmadı** — advisory nöbeti zaten ikinci worker'ı dışarıda tutuyor |
| M27b | retry claim'i **ve** advisory nöbeti birlikte söküldü | KIRILDI ✓ (R-06) |
| M27d | `perform_refund`'un kilit + taze durum nöbeti söküldü | KIRILDI ✓ (R-06) |
| M28 | reconciler'ın uçuş-içi nöbeti kaldırıldı | KIRILDI ✓ (R-06) |
| M29 | tam iade hesabı yalnız seçilen satırlara indirildi | KIRILDI ✓ (R-05a, R-05b, G-03, kuruş nöbetçisi) |
| M30 | yuvarlama artığının dağıtımı kaldırıldı | KIRILDI ✓ (kupon+kargo+kuruş nöbetçisi) |
| M31 | fiziksel kabul olmadan para yolunda stok geri ekleniyor | KIRILDI ✓ (6 node) |
| M32 | kabul idempotency anahtarı çağrıya özgü yapıldı | **Yakalanmadı ve YAKALANMAMALI** — ikinci bağımsız koruma (kilit altındaki fazla geri yükleme tavanı) davranışı korudu; tarihsel M3/M3′ ile aynı desen |
| M32b | anahtar **ve** tavan birlikte bozuldu | KIRILDI ✓ (G-05) |
| M33 | tavanda MANUAL_REVIEW yerine REFUNDING bırakılıyor | KIRILDI ✓ (R-08c, R-08d) |
| M34 | MANUAL_REVIEW kaydı otomatik retry'a yeniden dahil edildi | **Yakalanmadı** — davranış BOZULMADI: tarama koşulunun üstünde iki bağımsız guard var (kilit sonrası taze durum okuması · `mark_manual_review` claim'inin `from REFUNDING` şartı), gözlemlenebilir sözleşme (yeni sağlayıcı çağrısı yok, sayaç sabit) korundu |
| M35 | para emri sonrası ORM ilişkisine (lazy-load) dönüldü | KIRILDI ✓ (6 node — İP2A-18 regresyonu) |
| M36 | sağlayıcı reddettiği hâlde iade kesinleşmiş sayılıyor | KIRILDI ✓ (7 node) |
| M37 | karar audit'i kararla aynı transaction'dan çıkarıldı | KIRILDI ✓ (R-08a, R-18) |
| M38 | talep durumu koşulsuz APPROVED yazılıyor | KIRILDI ✓ (G-09, R-07) |

Kaçan üç mutasyonun tamamı **ikinci bağımsız koruma** yüzünden kaçtı ve
davranış hiçbirinde bozulmadı; her biri için birleşik varyant (M24b, M27b/M27d,
M32b) davranışın gerçekten bozulduğu hâli gösterdi. Ölçüm sonucu kanıt
üretmeyen iki taslak mutasyon (dört/üç guard'ı birden söken varyantlar)
katalogda **bırakılmadı**: amacı "nöbetçinin dişini ölçmek" olan bir giriş,
ölçüm başarısız olduğunda katalogda kalırsa yanıltır.

`test_iki_reconciler_worker_ayni_iadeyi_iki_kez_gondermez` bir **değişmez
kaydıdır**, yüksek güçlü nöbetçi değil: senaryo beş bağımsız mekanizmayla
korunuyor (docstring'inde sayılıyor) ve hiçbirini tek başına sökmek testi
kırmıyor. Aynı kusur sınıfının yüksek güçlü nöbetçisi R-06'dır. Bu sınır
gizlenmedi, testin kendi docstring'ine yazıldı.

### Yarış tekrarları (5 tur)

`tests/integration/test_ip2a_races_pg.py`, gerçek PG:

| Tur | Node | Süre | 40P01 | 40001 | 55P03 | 57014 | pending/destroyed task | never retrieved |
|---|---|---|---|---|---|---|---|---|
| 1 | 10 passed | 14,20 sn | 0 | 0 | 0 | 0 | 0 | 0 |
| 2 | 10 passed | 13,89 sn | 0 | 0 | 0 | 0 | 0 | 0 |
| 3 | 10 passed | 14,40 sn | 0 | 0 | 0 | 0 | 0 | 0 |
| 4 | 10 passed | 14,47 sn | 0 | 0 | 0 | 0 | 0 | 0 |
| 5 | 10 passed | 14,15 sn | 0 | 0 | 0 | 0 | 0 | 0 |

Deadlock/timeout yok. Para değişmezleri (çift refund · tavan aşımı · kayıp
`refunded_amount` güncellemesi · çift stok dönüşü · çift kupon release · çift
audit · çift bildirim) testlerin kendi assertion'larıdır; beş turun tamamı
yeşil olduğu için hepsi her turda korundu.

### Kalan borç

- **P0 / P1: yok.**
- **P2-1 ve P2-2 KAPANDI** (yukarıda: `SiralamaKapisi`, R-18 genişletmesi).
- **P2 (yeni):** `inventory_rules.PHYSICAL_EFFECT["RETURN"]` muhafazakâr
  bırakıldı (`on_premise=None`, `auto_reconcilable=False`). PK-α ile `RETURN`
  artık fiziksel kabulde yazıldığından malın işletmede olduğu ARTIK BİLİNİYOR;
  yani etki `(+1, 0, 0, +1, True)` olabilir. Değişiklik F29 sayım sözleşmesini
  (`tests/test_inventory_rules_pure.py` + acceptance nöbetçisi) etkilediği için
  bu turun kapsamına alınmadı. Yön güvenli: muhafazakâr kayıt sayımı STALE
  yapar, yanlış otomatik uzlaştırma üretmez.
- **P2:** Sipariş düzeyinde MANUAL_REVIEW için ayrı bir admin görünümü yok
  (RMA kuyruğunda filtre var, sipariş listesinde yok); yönetici bildirimi +
  audit satırı üzerinden bulunabilir.
- **PK-β** (ayıplı pencere üst sınırı), **PK-γ** (`/admin/orders/{id}/refund`
  ucunun tamamen kaldırılması), **PK-ε** (`legalContent.ts` ↔ kod farkı) ve
  **PK-ζ** (iade kargo masrafı modeli) hâlâ ürün/hukuk kararı bekliyor.
- `tests/verify` paketinin çalıştığı `adana_verify` veritabanı bu turda başka
  bir dalın (İP-3) revizyonuna damgalı bulundu ve `alembic stamp --purge
  ip2b_terminal_history_guard` + `upgrade head` ile bu dalın şemasına alındı.
  İP-3'ün eklediği `auth_version` kolonları yerinde bırakıldı (zararsız).
  *(Bu kestirme §10'da giderildi: veritabanı sıfırdan yeniden kuruldu.)*

## 10. İP-3 sonrası güncel-main adaptasyonu

> **Bu bölüm §1-§9'u GEÇERSİZ KILMAZ.** Yukarısı tarihsel kırmızı checkpoint
> (`295ffb6`) ve üretim uygulaması (`ab60c0c`) kayıtlarıdır; olduğu gibi
> korunur. Bu bölüm, aynı paketin **İP-3 merge'i sonrası güncel main** üzerinde
> yeniden ölçülmüş halini kaydeder. **Bu turda yeni İP-2a işlevi
> GELİŞTİRİLMEMİŞTİR.**

### Künye

| | |
|---|---|
| Adaptasyon öncesi İP-2a HEAD | `ab60c0c` |
| Alınan main | `3e6a24d` — `merge(ip3): yetki tenant kvkk ve auth version guvenligini tamamla` |
| Merge-base | `3cf40f2` (divergence: main 18 ← / İP-2a 10 →) |
| Merge commit | `19f7094` — `merge(ip2a): ip3 sonrasi guncel main'i iade dalina al` (parent1 `ab60c0c`, parent2 `3e6a24d`; no-ff, **çatışmasız**) |
| Migration commit | `cf052e8` — `fix(ip2a): iade migrationini ip3 zincirinin ucuna bagla` |
| Entegrasyon düzeltmesi | `c99c67a` — `fix(ip2a): iade fabrikasinin tokenini ip3 auth_version sozlesmesine bagla` |
| Güvenlik dalı | `ip2a-pre-ip3-main-merge-ab60c0c` |
| Yön | yalnız main → İP-2a dalı. Main'e merge YAPILMADI, rebase/squash/force YOK, push YOK |

### Migration zinciri tek head'e alındı

Merge sonrası zincir `ip2b_terminal_history_guard`'da ÇATALLANDI — `alembic
heads` iki head raporladı (`ip3_auth_version_all_roles`,
`ip2a_iade_para_guvenligi`). Boş bir veritabanında `upgrade head` "Multiple head
revisions" ile düşerdi; hem `ensure_schema` hem entegrasyon testlerinin DB
kurulumu kırılırdı.

**Seçilen çözüm — doğrusal yeniden bağlama** (merge revizyonu ÜRETİLMEDİ):

```
f29c → f30_paketleme_semasi → ip2b_terminal_history_guard
     → ip3_auth_version_all_roles → ip2a_iade_para_guvenligi (head)
```

Gerekçe (hepsi koddan doğrulandı): İP-3 yalnız `admins`/`tutors`/`clients`/
`library_operators` tablolarına `auth_version` kolonu ekler; İP-2a yalnız
`orders`/`order_returns`/`order_return_items` şemasına dokunur — **ortak nesne
yok**. İP-2a'nın backfill'leri İP-3'ün dokunduğu tabloları hiç okumaz ve İP-3'ün
backfill'i yoktur; yani iki revizyonun sırası değiş-tokuşludur. DDL gövdesinde
başka değişiklik gerekmedi. (Aynı gerekçeyle İP-3 de kendi zincirini main ucuna
bağlamıştı.)

**Bağımsız doğrulama** (tek kullanımlık `adana_ip2a_ip3_merge_migration_test`):

| Adım | Sonuç |
|---|---|
| `alembic heads` | tek head `ip2a_iade_para_guvenligi` |
| `upgrade head` (boş DB) | zincir sırayla koştu; 5 tabloda `auth_version`, 6 İP-2a kolonu, `ck_order_return_items_received`, 3 F30 tablosu, `orders_terminal_history_guard` trigger'ı mevcut; `payment_status`/`refund_status` = String(20) |
| `downgrade -1` | **yalnız** İP-2a değişiklikleri geri alındı; `auth_version` (5), F30 (3), İP-2b trigger korundu; kolonlar String(10)'a döndü; yarım şema YOK |
| `upgrade head` + `alembic check` | "No new upgrade operations detected." |
| `AUTO_CREATE_DB=true` açılış probu (yeni boş DB) | `ensure_schema` tek head'e kadar migrate etti, 94 tablo, `/health/live` → **200**. "Multiple head revisions" YOK. (MinIO bağlantı hataları altyapı eksikliğidir, açılışı engellemedi.) |

### Bulunan gerçek entegrasyon kusuru — merge'in ürettiği tek kusur

İP-3 §6 ile `auth_ver` claim'i **bütün rollerde** denetleniyor. İP-3, F30/İP-2b/
İP-1a fabrikalarını ortak `tests/integration/auth_headers.py` sözleşmesine
bağlamıştı — ama **İP-2a fabrikası o sırada main'de yoktu** ve token'ını hâlâ
claim'siz `create_access_token` ile üretiyordu. Sonuç: birleşik ağaçta
`test_ip2a_admin_http_pg.py`'nin **10 node'u da** `401 Could not validate
credentials` aldı.

Düzeltme (`c99c67a`) en dar biçimde yapıldı: fabrika `auth_headers.bearer_headers`
kullanır oldu — değer DB'deki gerçek `auth_version`'dan okunur (sabit `1`
yazılmadı; sabit değer, sürüm artıran bir senaryo eklendiği gün testi sessizce
yanlış yeşile çevirirdi). **Hiçbir assertion değiştirilmedi, test silinmedi,
skip/xfail eklenmedi.** Düzeltme sonrası İP-2a 49/49 yeşil.

### Test matrisi — birleşik ağaç

Gerçek PostgreSQL + gerçek Redis + `PAYMENT_PROVIDER=fake`. Dar paketler ayrı
`POSTGRES_DB` + ayrı `REDIS_DB` ile **paralel**; tam matrisler, yarışlar ve DB
işlemleri **sırayla**.

| Paket | Sonuç |
|---|---|
| İP-2a | **49 passed** |
| İP-3 | **115 passed** |
| İP-2b | **39 passed** |
| İP-1a | **63 passed** |
| F30 | **314 passed** |
| Tam integration | **1103 passed, 16 skipped, 0 failed** |
| Verify (`adana_verify`) | **126 passed, 6 skipped** |
| Acceptance | **197 passed** |
| Unit | **685 passed** |
| Frontend (Vitest) | **694 passed / 3 failed (697)** — flaky, aşağıda |
| TypeScript (`tsc -b`) | temiz (exit 0) |
| `ruff check .` | All checks passed |
| `git diff --check` | temiz |

Skip'lerin tamamı **altyapı**: 16 integration skip'i VROOM/OSRM ayakta olmadığı
için, 6 verify skip'i MinIO erişilemediği için. Üretim hatası değildir.

**Frontend 3 hatası merge kaynaklı DEĞİLDİR:** İP-2a dalı `3cf40f2 → ab60c0c`
aralığında `frontend/` altında **hiçbir dosyaya dokunmadı**; birleşik ağacın
frontend'i main (`3e6a24d`) ile **birebir aynıdır** (`git diff 3e6a24d HEAD --
frontend/` boş). Hatalar `inventoryScreens.acceptance.test.tsx`'te `waitFor`
zaman aşımı; aynı dosya tek başına koşturulduğunda **57/57 geçiyor** — ağır
paralel yük altında flaky.

### Node koruma

`ab60c0c` ile birleşik HEAD'in `--collect-only` listeleri karşılaştırıldı
(ayrı detached worktree'de; ana ağaçta checkout yapılmadı, iş bitince worktree
kaldırıldı):

- Toplam node 2012 → 2133; **KAYIP node: 0**
- `ip2a` node sayısı **49 → 49** (admin_http 10 · partial_math 11 · races 10 ·
  refund_two_phase 10 · restock 8)
- Tarihsel checkpoint'in (`295ffb6`) **36 node'unun tamamı** hâlâ mevcut
- Yeni 121 node'un 115'i `ip3`, 6'sı `test_auth_version_token_contract.py`
- `test_ip2a_*.py` ve `ip2a_factory.py` merge'de **bit düzeyinde değişmedi**
  (`c99c67a` öncesi); skip/xfail/`collect_ignore` eklenmedi

### Yarış tekrarları (5 tur)

`test_ip2a_races_pg.py` — 10 node, sırayla 5 tur:

| Tur | Sonuç | Süre |
|---|---|---|
| 1 | 10 passed | 22,2 sn |
| 2 | 10 passed | 18,2 sn |
| 3 | 10 passed | 21,3 sn |
| 4 | 10 passed | 17,9 sn |
| 5 | 10 passed | 27,5 sn |

Beş turun tamamında `40P01` · `40001` · `55P03` · `57014` · deadlock · timeout ·
pending/destroyed task · `Event loop is closed` · `MissingGreenlet` · "Multiple
head revisions" **sayısı 0**. Çift provider refund, refund tavan aşımı, kayıp
`refunded_amount`, çift stok dönüşü, çift audit ve çift bildirim iddiaları
testlerin kendi assertion'ları olduğundan her turda korundu.

### `adana_verify` sıfırdan kuruldu

§9'daki `stamp --purge` kestirmesi bu turda giderildi. Veritabanı önce
doğrulandı: gerçek bir test DB'si, **kullanıcı/üretim verisi YOK**
(`orders`/`order_items`/`products`/`clients`/`tutors`/`admins`/`payments`/
`bookings`/`notifications` = 0; yalnız 55 satır test artığı `audit_logs`).
Boş ve güvenli olduğu için `DROP DATABASE` + `CREATE DATABASE` +
`alembic upgrade head` ile **sıfırdan** kuruldu — `stamp --purge` gibi şema ile
revizyon kaydını ayrıştıran kestirme KULLANILMADI. Sonuç: 94 tablo, tek head
`ip2a_iade_para_guvenligi`, 126 passed / 6 altyapı skip. `ceyhandb`'ye
dokunulmadı.

### Kalan borç

- **P0: yok. P1: yok.**
- **P2 (ölçüldü, bu turda düzeltilmedi — kapsam dışı):** tam integration koşusu
  `notifications` ve `outbox_events` tablolarında kalıcı satır bırakıyor.
  Sıfırdan kurulmuş bir DB'de tam koşum sonrası ölçüm: `notifications=6`,
  `outbox_events=16`; hijyen nöbetçisinin **saydığı** tablolar (orders,
  order_returns, products, clients, audit_logs, payments) 0'da kaldı. Kaynak
  teslimat/oversell paketleridir, İP-2a değil; iki tablo `_KRITIK_TABLOLAR`
  nöbetçisinde olmadığı için görünmüyor.
- **P2:** frontend `inventoryScreens.acceptance.test.tsx` ağır paralel yük
  altında `waitFor` zaman aşımıyla flaky (tek başına 57/57 geçiyor). İP-2a
  kapsamı dışı — frontend bu dalda hiç değişmedi.
- §9'daki diğer P2'ler (`inventory_rules` RETURN etkisi, sipariş düzeyinde
  MANUAL_REVIEW görünümü) ve **PK-β / PK-γ / PK-ε / PK-ζ** ürün-hukuk kararları
  değişmeden duruyor.

### Durum

Birleşik ağaçta P0/P1 yoktur; migration tek head'dir, komşu paketlerin
(İP-3/İP-2b/İP-1a/F30) tamamı yeşildir ve İP-2a'nın 49 node'u ile tarihsel 36
node'u korunmuştur. **Final bağımsız audit'e hazırdır.**
