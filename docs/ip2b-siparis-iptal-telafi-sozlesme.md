# İP-2b — Mağaza Sipariş İptali ve Telafi Bütünlüğü Sözleşmesi

**Durum:** Kırmızı checkpoint (üretim kodu bu pakette DEĞİŞTİRİLMEDİ).
**Taban:** Güncel `main` (`dc9771a`, F30 paketleme+QR+kurye zimmet dâhil) bu dala
`45c95b8` merge commit'iyle alındı. Merge, R16 kusurunu **devraldı ve kapattı**
(§3c); checkpoint o gerçeğe göre yeniden ölçüldü (§11 tarihçe tablosu).
**Kapsam:** Sipariş iptali (ödenmemiş / ödenmiş / hazırlanmış / dağıtımdaki),
iptal telafileri (para, stok, kupon, teslimat, audit, bildirim) ve bunların
yarış/başarısızlık davranışları.
**İP-2a sınırı:** Teslim sonrası ürün iadesi (RMA, kısmi refund) bu paketin
DIŞINDADIR. Bu sözleşme yalnız "teslim edilmiş sipariş iptal uçlarından
GEÇEMEZ, iade yoluna yönlenir" sınırını çivileyecek kadar RMA'ya değinir.
**F30 sınırı (GÜNCELLENDİ):** Bu satır checkpoint kurulurken `OrderPackage`
üretimde YOKKEN yazılmıştı. `45c95b8` merge'inden sonra model VARDIR; İP-2b
testleri yine de `Order.prepared_at/by` damgasına göre ölçer (R13'ün asgari
sözleşmesi değişmedi) ve paket üretmez — `add_stops` paketi olmayan siparişi
kabul etmeyi sürdürür (`_paket_gecmisi_var` boşsa geçer).

Testler: `backend/tests/integration/test_ip2b_cancel_*.py`
Fixture: `backend/tests/integration/ip2b_factory.py`

---

## 1. Mevcut mimarinin özeti (güncel koddan çıkarıldı)

- **FSM** (`services/order_fsm.py`): `PENDING→{PAID,CANCELLED}`,
  `PAID→{SHIPPED,CANCELLED,REFUNDED}`, `SHIPPED→{DELIVERED,PAID,REFUNDED}`,
  `DELIVERED→{REFUNDED}`; `CANCELLED`/`REFUNDED` terminal. `transition_order`
  tek yazıcıdır; `CANCELLED|REFUNDED` geçişinde açık (PENDING) duraklar
  `FOR UPDATE` ile `CANCELLED`'a kapatılır ve `order_status_history` yazılır.
- **Para** (`services/escrow.py` + `order_service._refund_payment`): iki fazlı
  iade. Faz 1 `begin_refund` = `PAID→REFUNDING` atomik claim + **hemen commit**
  (intent kalıcı). Faz 2 `perform_refund` = sağlayıcı iadesi → başarıda
  `REFUNDING→REFUNDED`. Telafiler (stok `_restock` + kupon `release`) yalnız
  sağlayıcı başarısından SONRA uygulanır.
- **Stok** (`services/stock_ledger.py`): tek yazım yolu defterdir;
  `SALE` = `order_item:{id}:SALE`, iptal telafisi `SALE_CANCEL` =
  `order_item:{id}:SALE_CANCEL` (UNIQUE idempotency anahtarı) + tavan
  (`satılan − şimdiye kadar geri yüklenen`, ürün kilidi altında okunur).
- **Kupon** (`services/coupon_service.py`): `evaluate` (sipariş kurulurken) →
  `redeem` (yalnız PAID'de, `FOR UPDATE` altında; limit doluysa **False** döner
  ve hiçbir iz yazmaz) → iptal/tam iadede `release`
  (`used_count--` + redemption satırı sil).
- **Reconciler** (`services/escrow_reconciler.py`): sarkan `REFUNDING`
  kayıtlarını (Order dâhil) karantina + sınırlı retry ile sonuca sürer; bayat
  checkout taraması kayıp callback'leri `complete_checkout`'a verir.
- **Teslimat**: `uq_delivery_stop_open` (sipariş başına tek PENDING durak) DB
  otoritesindedir; `start_run` iptal edilmiş siparişin kaçak durağını atlayıp
  kapatır; teslim yolları `Order→DeliveryStop` kilit sırasıyla `FOR UPDATE`
  alır.

Bu çekirdek büyük ölçüde sağlamdır — yeşil nöbetçiler (§9) bunu çiviler.
Kırmızılar, çekirdeğin ETRAFINDAKİ dikişlerde bulunan gerçek boşluklardır.

---

## 2. İnvariant sözleşmesi

Sipariş iptali/iadesi hangi yoldan yürürse yürüsün:

- **I1 (para-tek):** Sağlayıcıya aynı sipariş için en fazla BİR tam iade
  çağrısı gider; iade ancak `payment_status=PAID`'den claim edilerek başlar.
- **I2 (para-dürüst):** Sağlayıcı iadesi kesinleşmeden sipariş "iade edildi"
  gösterilemez (`REFUNDED` yalnız sağlayıcı onayından sonra).
- **I3 (para-izlenebilir):** Kesinleşen tam iade `orders.refunded_amount`'a
  yazılır (ciro raporu + kısmi iade tavanı bu kolondan okur).
- **I4 (stok-defter):** Stok yalnız defter hareketiyle değişir; iptal edilen
  fiziksel miktar kadar ve YALNIZ BİR kez `SALE_CANCEL` yazılır; dijital kalem
  hareket üretmez; tekrar/retry ikinci hareket üretemez.
- **I5 (stok-fiziksel):** Paket müşteriye teslim edildiyse (durak DELIVERED)
  `SALE_CANCEL` yazılamaz — teslim edilmiş mal ancak İP-2a iade yolundan,
  fiziksel kabulle geri gelir.
- **I6 (kupon):** Tam iptal, YALNIZ bu siparişin gerçekten saydığı kullanımı
  geri açar (redemption satırı yoksa sayaç düşmez); geri açma en fazla bir kez
  uygulanır; `used_count` ile redemption satırları ayrışamaz.
- **I7 (teslimat):** Terminal (CANCELLED/REFUNDED) siparişin PENDING durağı
  OLAMAZ — yarışın her sıralamasında; eski QR/OTP ile teslim aksiyonu
  (SMS dahil) yürütülemez; kuyruktaki teslimat SMS'leri iptalle geçersizleşir.
- **I8 (tek kazanan):** iptal ↔ callback ↔ teslim ↔ ikinci iptal ↔ admin iadesi
  yarışlarının hepsinde tek işlem sahibi olur; DELIVERED hiçbir bayat yazımla
  ezilemez (lost update yasak).
- **I9 (görünürlük):** Hiçbir para/stok/kupon telafisi SESSİZCE kaybolamaz:
  ya otomatik retry/reconciler tamamlar ya kayıt MANUAL_REVIEW olarak görünür
  kalır. Reconciler'ın tamamladığı iade, iptalin TÜM telafilerini de tamamlar
  (stok + kupon + durum geçişi + bildirim).
- **I10 (yetki):** Müşteri yalnız kendi siparişini iptal eder; yabancı sipariş
  VARLIK SIZDIRMADAN reddedilir (404); admin iptal/iade uçları izinli +
  zorunlu gerekçeli + audit'lidir; FSM dışı doğrudan `orders.status` yazımı
  para/stok yolunu atlayamaz.
- **I11 (bildirim):** Müşteri iptal/iade bildirimi tam bir kez üretilir; e-posta
  outbox olayı durum değişikliğiyle atomik yazılır.

---

## 3. Doğrulanmış kusurlar → kırmızı kabul matrisi

Her satır güncel `main` kodundan satır kanıtıyla doğrulandı ve gerçek
PostgreSQL + gerçek servis/HTTP koşumuyla YENİDEN üretildi. Kırmızı testler
üretim düzeltmesi gelene dek KIRMIZI kalır.

| # | Kusur (kanıt) | İhlal | Kırmızı test |
|---|---|---|---|
| R1 | Sahiplik ihlali 403 "Sizin siparişiniz değil" döner (`order_service.py:918-924`) — geçerli ID doğrulanır, ID uzayı taranabilir | I10 | `http::test_kirmizi_baskasinin_siparisi_varlik_sizdirmaz` |
| R2 | Admin sipariş **iptal** ucu yok (store.py admin uçları: list/ship/deliver/refund) — admin ödenmemiş/sorunlu siparişi kapatamaz | I10 | `http::test_kirmizi_admin_iptal_ucu_gerekceli_calismali` |
| R2b | Aynı boşluğun ikinci yarısı: uç eklenirken `reason` **opsiyonel** bırakılırsa gerekçesiz admin iptali sessizce mümkün olur (R2 gövdede gerekçe gönderdiği için zorunluluğu ölçemez) | I10 | `http::test_kirmizi_admin_iptal_gerekcesiz_reddedilmeli` |
| R3 | `POST /store/admin/orders/{id}/refund` gövdesiz; audit `reason=NULL` (`store.py:418-429`) | I10 | `http::test_kirmizi_admin_refund_gerekce_ve_audit_reason` |
| R4 | `refund_order` yalnız `payment_status`'a bakar (`order_service.py:1391`): DELIVERED sipariş tek çağrıyla REFUNDED + kitap müşterideyken kör SALE_CANCEL (kusur üretimde belgeli: `inventory_service.py:800-812`) | I5, I10 | `http::test_kirmizi_delivered_admin_refund_rma_atlanamaz` |
| R6 | Reconciler `Order` için yalnız `perform_refund/finalize_refund` çağırır (`escrow_reconciler.py:96-135`); `_restock` + kupon `release` HİÇ koşmaz. `order_service.py:1364-1366` yorumu kodla ÇELİŞİR | I9, I4, I6 | `money::test_kirmizi_reconciler_stok_ve_kupon_telafisi` |
| R7 | Reconciler iadeyi kapatınca sipariş `status=PAID` + `payment=REFUNDED` asılı kalır; geçmiş satırı ve müşteri bildirimi yok | I9, I11 | `money::test_kirmizi_reconciler_sonrasi_durum_ve_bildirim` |
| R8 | 502 sonrası ikinci müşteri iptali `payment_status!=PAID` diye telafi bloğunu atlayıp CANCELLED yazar — stok telafisi hiçbir yolda kalmaz | I4, I9 | `money::test_kirmizi_502_sonrasi_retry_telafisiz_iptal` |
| R9 | Tam iptal/iade `refunded_amount` yazmaz (yalnız RMA `_settle_return:1878` yazar); ciro raporu (`revenue_service.py:160`) iadeyi görmez | I3 | `money::test_kirmizi_tam_iade_refunded_amount_gunceller` |
| R10 | `complete_checkout` `order.status`'a bakmaz: CANCELLED siparişin doğrulanmış tahsilatı `CANCELLED→PAID` 409'una çarpar, para NE bağlanır NE iade edilir (deneme bileti yüzeyinde emsal çözüm VAR: `library_exam_service.py:604-624`) | I8, I2 | `callback::test_kirmizi_iptal_edilen_siparise_gec_callback_iade` |
| R11 | Aynı 409 `reconcile_stale_checkouts` döngüsünü öldürür (sipariş dalında per-kayıt try/except yok) → partideki meşru kayıp-callback siparişleri işlenmez | I9 | `callback::test_kirmizi_reconciler_partisi_zehirlenmez` |
| R12 | `release` koşulsuz `used_count--` yapar (`coupon_service.py:157-158`); `redeem`-False (limitte) kalan siparişin iptali BAŞKA siparişin kullanımını serbest bırakır; sayaç↔satır kalıcı ayrışır | I6 | `stock_coupon::test_kirmizi_sayilamamis_kupon_iptalde_sayaci_dusuremez` |
| R13 | İptal `prepared_at`'i sıfırlamaz (yalnız başarısız-teslim yolu sıfırlar, `order_service.py:159-161`): paketlenmiş kitap masada, defter rafta sayar, söküm sinyali yok | I5 | `delivery::test_kirmizi_hazirlanmis_siparis_iptali_damgayi_sokmeli` |
| R14 | `send_otp`/`scan` sipariş yaşam döngüsüne bakmaz (`delivery_service.py:1449-1454, 1498-1522, 1796-1811`): iptal edilmiş siparişin müşterisine teslim OTP SMS'i gider | I7 | `delivery::test_kirmizi_cancelled_siparise_teslim_otp_smsi_gitmez` |
| R15 | Outbox olayları iptalle geçersizleşmez (purge/cancel yolu yok, `core/outbox.py`): iade edilmiş siparişe kuyruktaki "kuryen yola çıktı" SMS'i gönderilir (sessiz saat ertelemesi pencereyi saatlere büyütür) | I7 | `delivery::test_kirmizi_iptal_bekleyen_takip_smsini_iptal_eder` |
| ~~R16~~ | **KAPANDI — F30 tarafından devralındı** (bkz. §3c) | I7, I8 | ~~`delivery::test_kirmizi_iptal_ile_tura_ekleme_yarisi`~~ |
| R17 | `begin_refund` commit'i Order kilidini bırakır; sağlayıcı penceresi sırasında tur başlar + kurye teslim eder; iptal BAYAT bellek durumuyla (`status='PAID'`) FSM'den geçip **DELIVERED'ı CANCELLED ile ezer** — para iade + kitap müşteride + kör SALE_CANCEL, üçü birden (gerçek PG'de üç ihlal de ölçüldü) | I5, I8, I1 | `races::test_kirmizi_iptal_ile_kurye_teslim_yarisi` |

### 3b. Sertleştirme talebi (kusur DEĞİL) — R5

R5 bilinçli olarak yukarıdaki matristen **AYRILMIŞTIR**. Diğer satırların hepsi
API/servis yüzeyinden **erişilebilir** ve gerçek bir aktörle yeniden üretilen
kusurlardır; R5 ise erişilebilir bir kusur değil, **savunma derinliği** talebidir:

| # | Talep | Bugünkü durum | Kırmızı test |
|---|---|---|---|
| R5 | `orders.status` terminal geçişleri DB seviyesinde de FSM dışı yazıma kapalı olsun (CHECK/trigger; karşılaştır: `stock_movements` append-only trigger'lı) | Uygulama katmanında tek yazıcı `order_fsm.transition_order`'dır; bilinen hiçbir uç ham `UPDATE orders SET status=...` yapmaz. Koruma DB'de YOKTUR: elle SQL, ileride yazılacak bir betik ya da FSM'i atlayan yeni bir servis yolu para/stok/audit zincirini sessizce atlar | `http::test_kirmizi_orm_dogrudan_terminal_yazim_reddedilmeli` |

Testin kırmızı kalması bugün müşteriye ulaşan bir zararı DEĞİL, eksik bir
emniyet kemerini gösterir; önceliklendirilirken R1-R4/R6-R17 ile aynı kefeye
konmamalıdır. (Kırmızı sayısına dâhildir; §11.)

### 3c. F30 tarafından devralınarak KAPANAN kusur — R16

Güncel `main` (`dc9771a`, F30 paketleme+zimmet) bu dala `45c95b8` merge'iyle
alındı. F30, R16'nın belgelediği kusuru **kendi kapsamı içinde çözdü**:
`delivery_service.add_stops` artık sipariş satırlarını `_lock_orders_ascending`
ile **artan `order_id` sırasında `FOR UPDATE`** kilitler ve uygunluk kontrolünü
(`order.status != "PAID"`) kilit altında, `populate_existing` ile **taze**
okumayla yapar. Böylece "oku → karar ver → yaz" penceresi kapanır.

**R16 assertion gevşetilerek kapatılmadı.** Eski test, kusurun kendisine
(kilitsiz `add_stops`) yaslanan bir kurgu kullanıyordu — `_has_open_stop`
kapıda tutulurken iptal aynı satırı istiyordu. Yeni kilit sözleşmesinde bu
kurgu **dairesel bekleme** üretiyor, `statement_timeout` doluyor, askıda task +
açık transaction teardown'ı düşürüyor ve her koşumda
`orders/order_items/products/stock_movements/clients/delivery_runs` satırı
sızdırıyordu (sızan `delivery_runs` satırı `uq_delivery_run_planned`'ı
doldurduğu için R15 de kendi iddiası yerine `IntegrityError` ölçmeye
başlamıştı). Nöbetçi bu yüzden **iş invariant'ına** göre yeniden yazıldı:

| | |
|---|---|
| **İnvariant** | İptal edilen sipariş, yarışın HER sıralamasında açık (`PENDING`) teslimat durağıyla bırakılamaz: `order=CANCELLED` **ve** `stop=PENDING` bileşimi yasaktır |
| **Nöbetçi** | `delivery::test_yesil_iptal_ile_tura_ekleme_yarisi_acik_durak_birakmaz[ekleme_once, iptal_once]` (gerçek PG, iki ayrı session/transaction, sonlu `lock_timeout`, `sleep`süz, 3 tur) |
| **ekleme_once** | Kapı `_has_open_stop`'ta (sipariş kilidi ALINDIKTAN sonra). İptal bu pencerede başlatılır ve *bitene ya da satır kilidinde bekler duruma gelene* dek `pg_stat_activity` ile gözlenir. Gözlem `kilitte` → durak yazılır, iptal onu kanonik kapanışa (`CANCELLED`) alır |
| **iptal_once** | Kapı `_lock_orders_ascending`'in ÖNÜNDE (kilit alınmadan). İptal pencerede TAMAMEN biter; kapı açılınca `add_stops` durumu kilit altında yeniden okur ve **409** ile reddeder, hiç durak yazmaz |
| **Ölçülen sonuç** | İki yönde de yasak bileşim **0 kez**; deadlock (40P01) / kilit (55P03) / ifade (57014) zaman aşımı **0**; teardown hatası **0**; kritik tablo deltası **0**; 10 ardışık tekrarda 10/10 yeşil |

Bu yüzden R16 kırmızı matristen çıkarıldı ve **devralınan yeşil regresyon
nöbetçisi** olarak kaydedildi (§9, §11).

Test dosyası kısaltmaları: `http` = `test_ip2b_cancel_http_pg.py`,
`money` = `test_ip2b_cancel_money_pg.py`, `callback` =
`test_ip2b_cancel_callback_pg.py`, `stock_coupon` =
`test_ip2b_cancel_stock_coupon_pg.py`, `delivery` =
`test_ip2b_cancel_delivery_pg.py`, `races` = `test_ip2b_cancel_races_pg.py`.

---

## 4. Ödenmemiş sipariş iptali (senaryo 1) — büyük ölçüde SAĞLAM

Yeşil çivilenen mevcut davranış: PENDING iptalde sağlayıcıya gidilmez, stok
hareketi üretilmez (SALE zaten yazılmamıştı), kupon kotasına dokunulmaz
(redeem yalnız PAID'de sayıldığından release da gerekmez), bildirim tam bir
kez, tekrarlanan iptal 409 + yan etkisiz. Açık boşluk: iptal ↔ geç callback
(R10) ve varlık sızıntısı (R1).

**Duplicate iptal semantiği (karar çivisi):** "no-op/idempotent" gereksinimi
bu kod tabanında **"409 + sıfır yan etki"** olarak yorumlanmıştır (mevcut
davranış; `escrow.begin_refund` claim'i para hareketini zaten tekilleştirir).
200 dönen gerçek no-op istenirse ürün kararıdır; yan etki iddiaları değişmez.

## 5. Kupon telafi politikası (senaryo 6) — koddan çıkarılan gerçek

1. **Tam iptal kullanımı geri açar** (`release`): sayaç düşer, satır silinir,
   tek kullanımlık kupon YENİDEN kullanılabilir olur (yeşil çivi:
   `test_yesil_iptal_kupon_kotasini_geri_acar`).
2. **Kısmi iade kuponu geri AÇMAZ** (İP-2a alanı; `order_service.py:1871-1874`
   "kupon yalnız TAM iadede serbest bırakılır").
3. **Süresi dolmuş kupon**: release yine kota düşürür ama `evaluate` 409
   verdiğinden fiilen kullanılamaz; admin süreyi uzatırsa kota dolaşıma döner
   (yeşil çivi: `test_yesil_suresi_dolmus_kupon_iptalde`).
4. **Eşzamanlı kullanım**: `redeem` kupon satırını `FOR UPDATE` alıp limitleri
   yeniden doğrular; PAID claim'i çift callback'i tekilleştirir (verify
   paketinde kapsanmış: `test_verify_coupon_stock.py`, `test_verify_order_payment.py`).
5. **Sayaç sızıntısı** (R12): redeem-False + iptal → BAŞKA kullanım serbest
   kalır. Kırmızı sözleşme: redemption satırı olmayan sipariş sayaç düşüremez.
6. `release` kendisi idempotent DEĞİLDİR; bugün tek gerçek tetikleyicisi
   R12'dir (normal yollarda escrow claim'i çift release'i engeller). Düzeltme
   release'i satır-varlığına bağlarsa bu da kapanır.

## 6. Para / başarısızlık / retry (senaryo 2 ve 9)

- Sağlayıcı reddi: 502 + `REFUNDING` + `refund_requested_at/attempts` damgalı,
  stok ARTMAZ, kupon açılmaz, sipariş "iade edildi" gösterilmez (yeşil:
  `test_yesil_saglayici_reddi_refunding_dogru`).
- "Sağlayıcı başarılı, yerel commit düştü": intent `REFUNDING`'de kalır;
  reconciler pozitif kanıt/retry ile kapatır; `SALE_CANCEL` idempotency
  anahtarı retry'de teklik sağlar (mevcut mimari, iki fazlı tasarımın amacı).
- **Boşluk R6/R7/R8**: reconciler yalnız PARAYI kapatır; iptalin geri kalanı
  (stok, kupon, CANCELLED geçişi, bildirim) hiçbir yolda tamamlanmaz.
  Sözleşme: reconciler Order iadelerinde `order_service` seviyesindeki telafi
  fonksiyonunu çağırmalı (idempotency anahtarları çift uygulamayı zaten
  engeller) YA DA kayıt MANUAL_REVIEW kuyruğunda görünür kalmalıdır.
- **R10/R11**: iptal edilmiş siparişin doğrulanmış tahsilatı için sözleşme,
  deneme bileti emsalidir: `CANCELLED` + doğrulanmış tahsilat → otomatik tam
  iade (`refund_unexpected_charge` veya `CANCELLED→REFUNDING` geçişi);
  reconciler döngüsü kayıt başına hata izolasyonu yapar.
  **R11 R10'a bağlı DEĞİLDİR** (bağımsız denetim P1'i): parti testinde partiyi
  bozan kayıt, iptal/FSM ile ilgisi olmayan bir sağlayıcı arızasıdır
  (`retrieve_checkout` yalnız o token'da `RuntimeError`). Böylece FSM'e
  `CANCELLED→PAID` eklemek — kayıt-başı izolasyon yazılmadan — testi
  yeşillendiremez. Parti bütünlüğü **satır sırasından bağımsız** ölçülür:
  üretim sorgusunda `ORDER BY` olmadığı için id sırasına yaslanmak testi
  PostgreSQL yığın düzenine bağlardı; onun yerine "hiçbir istisna dışarı
  kaçmaz" + "partideki HER kayıt sağlayıcıya sorulmuş olur" birlikte ölçülür
  (ölen döngü kendisinden sonraki kaydı hiç soramaz). R10 kaydı için kabul
  edilen güvenli sonuç: otomatik tam iade **ya da** görünür (ERROR seviyeli)
  hata kaydı — sessizce kaybolmak değil.
- Deneme sınırı dolunca (`REFUND_MAX_ATTEMPTS`) kayıt ALERT loguyla kalır —
  MANUAL_REVIEW görünürlüğü bugün YALNIZ log satırıdır; admin paneli
  görünürlüğü ürün kararıdır (§8.6).

## 7. Teslimat etkileri (senaryo 4)

Yeşil (mevcut, başka dosyalarda da çivili): iptal PENDING durağı CANCELLED'a
kapatır (FAILED değil — kurye metriğine sayılmaz), kaçak durak turu bloklamaz,
CANCELLED durağın teslimi FSM duvarına çarpar (bu pakette yeniden çivilendi:
`test_yesil_cancelled_siparisin_duragi_teslim_edilemez`).

Kırmızı boşluklar: R13 (prepared damgası), R14 (OTP/scan kapıda durum
doğrulamıyor), R15 (bayat outbox SMS'i), R17 (iptal ↔ teslim yarışı —
DELIVERED ezilir). **R16 artık kırmızı DEĞİLDİR** — F30'un `add_stops` Order
kilidi kusuru kapattı; iki yönlü yarış nöbetçisi bunu kanıtlar (§3c).

Sözleşmeye not: iptal edilen durak `remove_stop` ile turdan çıkarılamaz ve
`optimize_run` sequence'ında yer işgal eder; public takip sayfası CANCELLED
siparişte yanıltıcı `NOT_DISPATCHED` gösterir; `cancel_run`/watchdog durakları
`fail_reason=NULL` FAILED yazıp kurye KPI'ını kirletir. Bunlar İP-2b'de test
edilmedi (kozmetik/raporlama); teknik borç olarak kayıt altındadır (§10).

## 8. Ürün kararı gerekli (kod cevaplamıyor — keyfî karar VERİLMEDİ)

1. **Geri açılan kupon hakkı kime ait?** `max_uses=1` kuponun iptalle boşalan
   hakkını başka müşteri kapabilir. (Kod: ilk gelen alır.)
2. **Aç–öde–iptal döngüsü** için kötüye kullanım sınırı (iptal sayacı,
   cooldown) yok.
3. **Süresi dolmuş kuponda müşteri telafisi** (eşdeğer kupon/uzatma) yok;
   bugün kota açılır ama hak fiilen yanar (§5.3 çivisi).
4. **Hazırlanmış paketin sökümü**: `prepared_at` temizliği asgari sözleşmedir
   (R13); ayrıca "söküm iş emri" kuyruğu isteniyor mu?
5. **Ardışık kısmi iadeler toplamda tama ulaşınca** kupon serbest kalmalı mı?
   (İP-2a sınırında; bugün kalmıyor.)
6. **MANUAL_REVIEW yüzeyi**: ALERT'e düşen iadeler admin panelinde
   listelenmeli mi, yoksa log yeterli mi?
7. **Duplicate iptalin 409 mu 200-no-op mu** olduğu (bkz. §4).
8. **`used_count` semantiği** ("aktif kullanım" vs "toplam dağıtım") ve
   redemption satırının hard-delete yerine `revoked_at` ile korunması
   (kampanya analitiği/denetim izi bugün siliniyor).

## 9. Yeşil nöbetçiler (21 düğüm)

`http`: ödenmemiş iptal · ödenmiş iptal tam telafi · duplicate 409 yan etkisiz ·
401/403 · DELIVERED→iade yönlendirmesi · yetkili admin refund + audit ·
eksik izinli admin reddi.
`money`: sağlayıcı reddi REFUNDING dürüstlüğü.
`callback`: replay yan etkisiz · eşzamanlı çift callback tek yan etki (claim
nöbetçisi) · iptal↔callback çift durum yok.
`stock_coupon`: PENDING iptal hareketsiz · karışık sepette dijital hareketsiz ·
iki worker tek telafi · kupon kotası geri açılır · süresi dolmuş kupon çivisi.
`delivery`: CANCELLED durak teslim edilemez · **iptal ↔ tura ekleme yarışı açık
durak bırakmaz** (2 düğüm: `ekleme_once`/`iptal_once` — F30'dan DEVRALINAN
düzeltmenin nöbetçisi, §3c).
`races`: çift iptal tek kazanan · müşteri↔admin tek para hareketi.

Ayrıca mevcut kapsamla bilinçli ÇAKIŞMAMA: verify paketindeki E1-E3 (iptal +
stok geri + kayıp callback) ve C1-C3/D1 (kupon limitleri, son stok yarışı)
yeniden yazılmadı.

## 10. Kapsam dışı / bilinen riskler

- `OrderReturn.provider_ref` hiç yazılmıyor → kısmi iade reconciler'da
  üretimde tamamlanamaz; reconciler'ın OrderReturn pozitif-kanıt referansı
  (`return:{id}`) iyzico'daki `order:{id}` ile eşleşmez. (İP-2a alanı; İP-2b
  testi yazılmadı, kayıt için burada.)
- İade e-postası son commit'ten SONRA enqueue ediliyor (`refund_order`,
  `cancel_by_client` → `_email_order` çağrı sırası) — süreç ölürse e-posta
  olayı kaybolur; kısmi iadede e-posta hiç yok.
- `POST /store/orders` idempotency anahtarı yok (çift submit = iki PENDING
  sipariş + iki CF oturumu); `/orders/{id}/cancel` ucunda rate-limit yok.
- Kupon indirimi eğitmen hakedişinden düşülmüyor (indirimi platform finanse
  ediyor) — iade tarafıyla asimetrik; muhasebe kararı.
- `SALE_CANCEL` satırlarında `ref_type='order_item'` model sözlüğü dışıdır ve
  `SALE` (`ref_type='order'`) ile asimetriktir; `ref_line_id` DB'de yalnız
  RETURN için zorunludur (tavan sorgusunun korumasız değişmezi).
- Soft-delete edilmiş ürün `audit_ledger`'da taranır ama sayım/hasar akışına
  giremez → düzeltilemeyen kalıcı denetim bulgusu üretebilir.
- Kurye/teslimat kozmetikleri (§7 notu).

## 11. Koşum

```powershell
cd backend
$env:POSTGRES_DB='adana_ip2b_test'   # adı 'test' içermeli (db_guard)
python -m pytest tests/integration/test_ip2b_cancel_http_pg.py `
  tests/integration/test_ip2b_cancel_money_pg.py `
  tests/integration/test_ip2b_cancel_callback_pg.py `
  tests/integration/test_ip2b_cancel_stock_coupon_pg.py `
  tests/integration/test_ip2b_cancel_delivery_pg.py `
  tests/integration/test_ip2b_cancel_races_pg.py -q
```

Beklenen (merge `45c95b8` sonrası): **21 yeşil + 17 kırmızı = 38 düğüm**
(kalan kırmızılar üretim düzeltmesi gelene dek kırmızı kalır).

Sayıların tarihçesi — hiçbir kırmızı assertion gevşetilerek kapatılmadı:

| Aşama | Toplam | Kırmızı | Yeşil | Neden |
|---|---|---|---|---|
| Kırmızı checkpoint (`50607e9`) | 36 | 17 | 19 | ilk kabul matrisi |
| Bağımsız denetim P2 (`cd592ea`) | 37 | 18 | 19 | R2b eklendi (gerekçesiz admin iptalinin reddi) |
| main+F30 merge sonrası (`45c95b8`+) | **38** | **17** | **21** | R16 kırmızısı **F30 düzeltmesiyle** kapandı ve yerine 2 düğümlü (iki başlatma yönü) yeşil yarış nöbetçisi geldi: −1 kırmızı, −1 düğüm, +2 düğüm |

Koşum deterministiktir (iki ardışık koşumda düğüm ve sonuç bazında aynı);
yarışlar `sleep` yerine `asyncio.Event` kapıları ve `pg_stat_activity` kilit
gözlemiyle kurulur. Suite hijyen nöbetçisinden temiz çıkar — kritik tablo
deltası 0 (`-k ip2b`, `-k f30` ve yeni yarış nöbetçisi ayrı ayrı ölçüldü).
Tam `tests/integration` koşumunda kalan tek delta `outbox_events (+10)` ve
`notifications (+4)`; ikisi de nöbetçinin listesinde DEĞİL ve kaynağı İP-2b/F30
değil — kaydı: `docs/teknik-borc.md` → TB-8.

**Mutasyon provası (8/8 yakalandı, tamamı geri alındı):** refund no-op →
`http` ödenmiş-iptal yeşili · restock tavansız+anahtar benzersiz → iki-worker
yeşili · kupon release kaldırıldı → kota yeşili · `_close_open_stops`
kaldırıldı → `test_delivery_invariants_pg` · `escrow.claim` koşulsuz True →
çift-callback yeşili (bu nöbetçi prova sırasında EKLENDİ: çift-iptal yeşili
claim'i değil Order kilidini test ediyordu) · admin izni manage→view →
eksik-izin yeşili · FSM'e `CANCELLED→PAID` eklendi → `tests/test_order_fsm.py` ·
teslim FSM atlaması → CANCELLED-durak-teslim-edilemez yeşili.

**Ek mutasyon provası — parti izolasyonu nöbetçisi (10/10, tamamı geri alındı):**

| Mutasyon | Beklenen | Ölçülen |
|---|---|---|
| M9: `order_fsm.ALLOWED_ORDER_TRANSITIONS["CANCELLED"] = {"PAID"}` (yalnız FSM) | Parti testi KIRMIZI kalmalı | Kırmızı — `RuntimeError(token=ip2b-tok-bozuk)`, yani artık R10'un 409'u değil bağımsız arıza ölçülüyor. Aynı mutasyon altında testin **eski hâli** (HEAD:50607e9) YEŞİLE döndü — bağımsız denetimin P1 bulgusu böylece kanıtlandı ve kapatıldı. `tests/test_order_fsm.py::test_terminal_states_have_no_exit` de kırıldı |
| M10: sipariş dalına kayıt-başı `try/except → rollback + logger.exception + continue` | Parti testi YEŞİL olmalı | Yeşil; sağlam kayıt PAID/PAID + tek `SALE`, bozuk kayıt PENDING/PENDING ve yan etkisiz, R10 kaydı görünür ERROR kaydı bıraktı. R10 testi (para bağlanmıyor/iade edilmiyor) beklendiği gibi kırmızı kaldı — izolasyon R10'u ÇÖZMEZ |

M10 yazılırken not: `db.rollback()` ORM nesnelerini expire ettiği için döngü
satırları önce anlık görüntüye alınmalıdır; aksi hâlde bayat nesnenin alanına
erişmek async oturumda lazy-load (`MissingGreenlet`) üretir. Gerçek düzeltme
yazılırken bu tuzak geçerlidir.

**Ek mutasyon provası — iptal ↔ tura ekleme yarış nöbetçisi (3/3, tamamı geri
alındı; üretim dosyalarının SHA-256'sı başlangıçla birebir aynı):**

| Mutasyon | Yer | Ölçülen |
|---|---|---|
| M-R16-1: `add_stops`'un Order kilidi (`_lock_orders_ascending`) kaldırıldı | `delivery_service.py` | **KIRMIZI** — `ekleme_once` yönü: `gözlem=bitti` (iptal pencerede tamamlandı) → `duraklar=['PENDING']` + `order=CANCELLED`, yani yasak bileşim. Yapısal metin kontrolü DEĞİL, gerçek son durum |
| M-R16-2: durum kontrolü kilitten ÖNCEYE alındı (bayat okuma) | `delivery_service.py` | **KIRMIZI** — `iptal_once` yönü: iptal tamamen bittikten sonra `add_stops` bayat `PAID`'e güvenip ölü siparişe `PENDING` durak yazdı |
| M-R16-3: iptal yolunda `_close_open_stops` kaldırıldı | `order_fsm.py` | **KIRMIZI** — `ekleme_once` yönü: `gözlem=kilitte` (kilit doğru çalıştı) ama iptal durağı kapatmadı → `CANCELLED` + `PENDING` |

⚠️ Nöbetçinin İLK hâli M-R16-1'i **yakalayamadı** (yalnız `asyncio.gather` ile
başlatmak tehlikeli pencereyi açmıyordu). Kural gereği önce test güçlendirildi
(yön başına deterministik kapı + `pg_stat_activity` kilit gözlemi), sonra
mutasyon tekrarlandı ve kırıldığı gösterildi. "Geçen test" ile "nöbetçilik eden
test" arasındaki fark tam olarak budur.
