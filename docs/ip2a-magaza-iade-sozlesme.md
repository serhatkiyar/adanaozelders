# İP-2a — Mağaza İade, Refund ve Stok Bütünlüğü Sözleşmesi

> **Durum: KIRMIZI CHECKPOINT.** Bu doküman, mağaza sipariş iadelerinde para,
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
