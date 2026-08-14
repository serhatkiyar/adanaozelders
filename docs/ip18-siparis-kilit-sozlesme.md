# İP-18 — Sipariş ödeme kesinleştirmesi ↔ iptal yarışı (sözleşme)

**Dal:** `ip18-siparis-kilit` · **Durum:** üretim düzeltmesi tamam, bağımsız
audit bekliyor · **Ölçüm zemini:** tek kullanımlık `adana_ip18_test`,
`PAYMENT_PROVIDER=fake` elle (TB-21 kapandı ama guard duruyor), tek koşum.

---

## 1. Kusur

`order_service.complete_checkout` sipariş satırını **kilitlemiyordu** ve
`_finalize_paid`'in atomik PAID claim'i yalnız `payment_status`'ü
koşulluyordu. Aradaki pencerede iptal commit ederse:

1. ölü-varlık guard'ı (İP-2b R10) **bayat anlık görüntüyü** kontrol eder,
2. `escrow.claim` `payment_status IN (PENDING, FAILED)` gördüğü için geçer,
3. `transition_order` bayat ORM nesnesinin `PENDING`'ini okur ve satır
   `CANCELLED` iken `PAID` yazılır — **kayıp güncelleme**.

Deterministik olarak üretilen sonuç:

```
son durum: ('PAID', 'PAID')
geçmiş:    [('PENDING','CANCELLED','client'), ('PENDING','PAID','system:payment')]
sağlayıcı iade çağrıları: []
SALE hareketleri: [('SALE', -3)]   stok 10 → 7
```

Para tahsil edilmiş, iade edilmemiş, iptal ezilmiş ve **sonuç `PAID/PAID`
olduğu için anomali hiçbir sorgudan görünmüyor** — kayıp güncelleme kendi
kanıtını siliyor. Bu, kardeş yüzeylerden (deneme bileti, çalışma rezervasyonu)
farkın kaynağıdır: onlarda tek durum kolonu var, claim yaşam döngüsünü
kendiliğinden koşulluyor.

**Üç giriş noktası** aynı şekli taşıyordu: tarayıcı callback'i
(`complete_checkout`) · `pay()` → `_charge` → `_finalize_paid` ·
`escrow_reconciler.reconcile_stale_checkouts`.

## 2. İnvariantlar

- **I-18/1 (yasak bileşim)** — `orders.status IN (CANCELLED, REFUNDED)` iken
  `payment_status = 'PAID'` OLAMAZ; hiçbir giriş noktasından, hiçbir sıralamada.
- **I-18/2 (para kaybolmaz)** — İptal edilmiş siparişe gelen doğrulanmış
  tahsilat **aynen iade edilir** (İP-2b R10) ve iade **gerçekten sağlayıcıya
  gider**; satırın `REFUNDED` yazması yetmez.
- **I-18/3 (stok)** — İptal edilmiş siparişe **hiç** stok hareketi yazılmaz —
  ne `SALE` ne `SALE_CANCEL`. Satış hiç gerçekleşmedi; PK-α gereği stok yalnız
  fiziksel teslim/kabulle hareket eder. "Yanlış yaz + tersini yaz" telafi
  değildir: defter append-only'dir, iki kalıcı gürültü satırı kalır ve
  `SALE_CANCEL` "satılmış mal geri geldi" anlamına gelir.
- **I-18/4 (kilit sırası)** — Düzeltme kilitle YAPILMAZ. Kural şudur: **aynı
  transaction içinde hem Product hem Order kilidi tutan her yol
  `Product → Order` sırasını izler.**

  ⚠️ *Denetim düzeltmesi.* Önceki metin "kanonik sıra `Product → Order`" diyordu;
  bu **literal doğru değil**: `_cancel_order`, `refund_order` ve
  `request_return` işlem düzeyinde önce `_lock_order`'ı alır. Onlar aynı
  transaction'da ürün kilidi ALMAZ — iade yolunda araya `begin_refund`'ün
  COMMIT'i girer ve Order kilidi orada bırakılır. Güvenlik bir sıra
  disiplininden değil, **PAID yazıcılarının ürün kilidiyle serileşmesinden**
  gelir. `complete_checkout` yoluna Order satır kilidi eklemek, aynı
  transaction'da her iki kilidi tutan bir yolu ters sıraya sokar.

## 3. Çözüm — kilit değil **koşul**

Yaşam döngüsü koşulu `escrow.claim`'in zaten var olan `extra_where`'ine biner:
claim'in kendi UPDATE'i satırı nasılsa kilitler, ek kilit alınmaz, kanonik sıra
bozulmaz.

Kural **tek kaynakta** (`services/order_service.py`):

| Ad | Anlam |
|---|---|
| `PARA_BAGLANABILIR_DURUMLAR` | `frozenset({"PENDING"})` — `order_fsm`'in tek ödeme kenarı |
| `OLU_SIPARIS_DURUMLARI` | `frozenset({"CANCELLED", "REFUNDED"})` — geç tahsilat iade edilir |
| `canli_siparis_kosulu()` / `olu_siparis_kosulu()` | `extra_where` üreticileri |
| `_siparis_para_claimi(...)` | **Boğaz noktası.** `escrow.claim` doğrudan çağrılmaz |
| `_taze_siparis_durumu(...)` | Claim kaybedilince "neden" sorusunun cevabı — bayat nesneden okunmaz |

İki tasarım kararı:

- **Varsayılan güvenli tarafta.** `_siparis_para_claimi(yasam_dongusu="canli")`
  en dar koşuldur; dördüncü bir giriş noktası parametreyi hiç düşünmezse claim
  fazladan geçmez, **eksik** geçer (fail-closed).
- **Çağıran kuralı gevşetemez.** `extra_where` yaşam döngüsü koşuluna
  **eklenir**, yerine geçmez.

Yapısal nöbetçi (`tests/test_ip18_odeme_kosulu.py`): `payment_status='PAID'`
yazan **doğrudan** bir `escrow.claim` çağrısı kod tabanında kalmadı; biri
eklenirse AST taraması kırılır. Düşük güçlüdür ve docstring'inde öyle yazar.

## 4. Kapanan borç — TB-15(b)

Ölü-varlık dalı `refunded_amount`'a **mutlak atama** yapıyordu; artırımlı
değildi, `LEAST(..., total)` tavanı yoktu, `refund_reserved`'a dokunmuyordu.
Satır `refunded_amount=total, refund_reserved=0` gibi kendi içinde tutarsız
kalıyordu — oysa `escrow.order_inflight_refund` bu ikiliyi birlikte okur.

Artık diğer iade yollarıyla aynı: rezervasyon niyetle **aynı atomik UPDATE'e
biner**, tavan claim'in kendi koşulundadır (`refund_reserved + tutar <= total`)
ve tutar tek yazıcıdan geçer (`apply_refunded_amount`, M6). İkisi de
`commit`'ten önce, aynı transaction'da — çökme semantiği değişmedi.

## 5. Faz 5'te bulunan İKİNCİ P0 — reconciler savepoint'i para kaybettiriyordu

D11 düğümü yazılırken çıktı ve İP-18'in kendi kusurundan **bağımsızdır**
(`2e4fefc`, 3 Ağu'dan beri açıktı).

`reconcile_stale_checkouts` her kaydı `async with db.begin_nested()`
(SAVEPOINT) içinde işliyordu; ama `complete_checkout` **kendi transaction'ını
yönetir ve içeride COMMIT eder**. SQLAlchemy, savepoint bağlamında dış
transaction commit edildikten sonra oturuma dokunmayı reddeder
(`InvalidRequestError: Can't operate on closed transaction inside context
manager`).

Belirleyici olan commit'in kendisi değil, **commit'ten sonra oturumla iş
yapılıp yapılmadığıdır**:

| Yol | Sıra | Sonuç |
|---|---|---|
| Canlı sipariş | iş biter → commit → **hemen döner** | İstisna **YOK**. Ölçüldü (savepoint geri konup koşuldu): `handled = 1`, ERROR kaydı **0**, sipariş `PAID/PAID`. Bu yol savepoint ile de sorunsuz çalışıyordu |
| **Ölü sipariş** | iade claim'i **COMMIT** → `db.refresh(order)` → **istisna** | `refund_unexpected_charge`'a hiç varılmıyor: satır `REFUNDED`, sağlayıcıya iade **SIFIR** |

> ⚠️ **Denetim düzeltmesi.** Bu tablonun ilk hâli "canlı siparişte de istisna
> doğuyor, `handled` artmıyor, her başarılı kayıtta gürültülü
> `logger.exception` yazılıyor" diyordu. **Yanlıştı**; denetçi tersini ölçtü ve
> ben de savepoint'i geçici geri koyup bağımsız olarak doğruladım (yukarıdaki
> sayılar o ölçümden). Aynı yanlış iddia `escrow_reconciler.py` üretim
> yorumunda da vardı; ikisi birlikte düzeltildi. Kusurun kendisi ve düzeltmenin
> gerekçesi değişmedi — yalnız kusurun **kapsamı daraldı**: savepoint canlı
> yolu bozmuyordu, ölü yolu bozuyordu.

Yani "iade edildi" yazan ama parayı döndürmemiş kayıt. **Neden bugüne kadar
görülmedi:** İP-2b'nin `reconciler_partisi_zehirlenmez` iddiası ayrıktır —
"iade edildi **ya da** görünür hata kaydı var". İstisna `logger.exception`
yazdığı için ikinci şık sağlanıyor ve test yeşil kalıyordu. Oluşan durum
sözleşmenin iki şıkkından da değildi. Kayıt: [[TB-39]].

Düzeltme: savepoint kaldırıldı; R11'in gereği (kayıt-başı `try/except` +
`rollback` + `continue`) korundu — savepoint zaten ek izolasyon sağlamıyordu,
çağrılan fonksiyon her kaydı kendi commit'iyle sınırlıyor. **Komşu paketin
kabul iddiasına dokunulmadı**; daha dar nöbetçi kendi paketimizde (D11).

## 6. Kabul matrisi

Dosyalar: `tests/integration/test_ip18_siparis_kilit_pg.py` (gerçek PG),
`tests/test_ip18_odeme_kosulu.py` (saf + AST).

| Düğüm | Sınıf | Ölçülen kırmızı (düzeltme öncesi) |
|---|---|---|
| D1 | gerçek PG | `'PAID' == 'CANCELLED'` değil; geçmiş `[…CANCELLED…, …PAID…]` |
| D2 (5 test) | saf/yapısal | `PARA_BAGLANABILIR_DURUMLAR` / `OLU_SIPARIS_DURUMLARI` / iki koşul yardımcısı **YOK** |
| D3 | gerçek PG | `geç tahsilat iade edilmedi (refund_calls == [])` |
| D4 | gerçek PG | `stok hareketi yazıldı: [('SALE', -3)]` |
| D5 | gerçek PG | `pay()` yolu — `'PAID' == 'CANCELLED'` değil |
| D6 | gerçek PG | reconciler yolu — `'PAID' == 'CANCELLED'` değil |
| D7b | gerçek PG | `PAID kazandı ama geçmişte CANCELLED var — iptal EZİLDİ` |
| D11 | gerçek PG | `('CANCELLED','REFUNDED')` ama `refund_calls == []` (Faz 5'te eklendi) |

Yeşil nöbetçiler: **D7a** (iptal-önce sıralaması / R10) · **D8** (mutlu yol
bozulmasın: `PAID/PAID`, `SALE −2`, tek geçmiş satırı, iade yok — **her
uygulama fazından sonra koşuldu**) · **D9** (kilit sırası, gerçek SQL) ·
**D10** (booking sahipsiz-emanet kemeri).

**Determinizm:** hiçbir düğümde `asyncio.gather` yok, `sleep` yok. Pencere
`stock_ledger.lock_products` kancasıyla (guard'dan sonra, claim'den önce) ve
`pay()` yolunda gerçek sağlayıcı `charge` kapısıyla açılır. Her düğüm kancanın
ateşlendiğini ayrıca assert eder — yalancı yeşil kapısı.

### 6b. `gather` testi hakkında karar (TB-36)

Bu yarışı bugün ölçebilen tek MEVCUT test
`callback::test_yesil_iptal_callback_yarisinda_cift_durum_yok` ve `gather` ile
kurulu: 13 Ağu'da CI'da düştü, bu makinede **10/10 yeşil**.
`races::test_yesil_cift_musteri_iptali_tek_kazanan` ise bu yarışa **yapısal
olarak erişemiyor** — ölçüldü, `complete_checkout` çağrı sayısı **0**.

**Karar:** mevcut `gather` testine dokunulmadı (İP-2b `59afdac` kararı: nöbetçi
yanına konur, mevcut olan değiştirilmez) ve **borç sayılmadı** — deterministik
ikizi (D7b) yanında durduğu sürece ucuz bir ek kapsamdır. Koşul: TB-36 kuralı
gereği bir `gather` testinin yeşilliği **tek başına** "geçti" kanıtı değildir;
yanında deterministik ikiz olmadan hiçbir yarış testi kabul edilmez.

## 7. Mutasyon provaları

Sürücü `backend/scripts/mutation_drill_ip18.py` — ip16 deseni; **ortak sürücü
değiştirilmedi** (yedi paketin ölçüm aracıdır, TB-29 gerekçesi kayıtta). Üç ek
nöbetçi: `ERROR` sayan `_kirilanlar`, seçilen test > 0 kapısı, **yeşil taban
çizgisi**.

Aşağıdaki sayılar **son koşumdan** alınmıştır (D11-D14 eklendikten sonra
yeniden ölçüldü; önceki tablo bayat ve iç tutarsızdı — denetim bulgusu).

| # | Mutasyon | Seçilen | Taban | Kırılan |
|---|---|---|---|---|
| IP18-1 | Yaşam döngüsü koşulu söküldü | 14 | yeşil | 6 (D1, D3, D4, D5, D6, D7b) |
| IP18-2 | Boğaz noktası atlandı | 22 | yeşil | 3 (AST nöbetçisi + 2 kilit sözleşmesi) |
| IP18-3 | Ölü-varlık iadesi söküldü | 14 | yeşil | 1 (D3) |
| IP18-4 | Claim sonucu yok sayıldı | 14 | yeşil | 6 (D4 dahil) |
| IP18-5 | Kilit sırası ters çevrildi | 30 | yeşil | 6 (**D9** dahil) |
| IP18-6 | Taze okuma bayatlatıldı | 14 | yeşil | 1 (D3) |
| IP18-7 | Reconciler'a status filtresi eklendi | 19 | yeşil | 2 (**D11** + İP-2b R11) |
| IP18-8 | `PARA_BAGLANABILIR_DURUMLAR += CANCELLED` | 20 | yeşil | 8 (6 davranış + 2 saf) |
| IP18-9 | **TB-15(b)**: tavan claim koşulundan söküldü | 14 | yeşil | 2 (**D13**, **D14**) |
| IP18-10 | **TB-15(b)**: `apply_refunded_amount` çağrılmıyor | 14 | yeşil | 1 (**D12**) |
| IP18-11 | **TB-15(b)**: `refund_reserved` rezervasyonu söküldü | 14 | yeşil | 1 (**D12**) |

**11/11 yakalandı.** Geri alma bayt yedeği + SHA-256 ile doğrulandı; her provadan
sonra HEAD ve `git status` başlangıçla karşılaştırıldı.

Seçilen sayıların farklı olmasının sebebi hedef test kümesidir: `14` = yalnız
PG dosyası, `20` = PG + saf/AST, `22` = saf/AST + kilit sözleşmesi, `19` = PG +
İP-2b callback, `30` = PG + kilit sözleşmesi.

**IP18-9/10/11 neden var:** bağımsız denetim TB-15(b)'nin davranış olarak
kapatıldığını ama **nöbetsiz** bırakıldığını ölçtü — bu üç mutasyonu koştu ve
üçü de 1311 testin hiçbirini kırmadı. D12/D13/D14 o boşluğu kapatır.

## 8. Denetçinin ilk bakacağı yerler

> Kendi zayıf noktalarımı işaretliyorum; `sm2-kaldirma` turunda bu işe yaradı.
> Aşağıdakiler "bilerek böyle" demek DEĞİL — "önce buraya bak" demektir.

1. **D9 tek nöbetçidir, tek yöntemi vardır ve kör noktası ÖLÇÜLDÜ.** Kilit
   sırası iddiasını gerçek SQL'de yalnız o ölçüyor. Kaynak sözleşmesi
   (`test_stock_lock_contract`) aynı ihlalde **kırılmadı** (IP18-5 ile
   ölçüldü) — yani ikinci katman yok, sanılan ikinci katman kör.
   D9'un `before_cursor_execute` filtresi dizgi eşleşmesine dayanır
   (`from products` / `update orders`). Bağımsız denetim çalışan bir kaçış
   üretti: Order kilidi `SELECT … FROM <başka tablo> JOIN orders …
   FOR UPDATE OF o` biçiminde alınırsa `from orders` geçmez ve **iki nöbetçi
   de sessiz kalır**. Kurgusal değil — `select(Order).join(OrderItem)
   .with_for_update(of=Order)` tam bu SQL'i üretir ve kod tabanında benzer
   desen zaten var (`delivery_service.handover_scan`). Kayıt: [[TB-40]].
   Kurgu bozulursa test kırılır (`"product" in kayit` / `"order" in kayit`
   assert'leri) ama filtre yanlış eşleşirse yakalamaz.
2. **Deadlock iddiası Faz 2'de daraltıldı.** Faz 1'de "Order kilidi eklemek
   gerçek deadlock döngüsü kurar" dedim; ölçünce **bugünkü FSM'de erişilebilir
   bir döngü üretilemedi** (aynı sipariş satırının hem `PENDING` hem `PAID`
   olmasını gerektiriyor). `_lock_order_products`'ın kendi yorumu ve
   `test_stock_lock_contract` docstring'i de aynı iddiaya dayanıyordu; ikisi de
   dürüstleştirildi. Sonuç: çözümün "kilit değil koşul" olmasının gerekçesi
   "deadlock çıkar" **değil**, "gereksiz risk + gereksiz kilit". Denetçi bu
   daraltmayı sorgulamalı — ben aksini kanıtlayamadım, kanıtlayan biri çıkarsa
   sözleşme metni yanlış olur.
3. **`complete_checkout`'un `FAILED` claim'i bilinçli olarak dışarıda
   bırakıldı.** Hâlâ doğrudan `escrow.claim`'dir ve yaşam döngüsüne bakmaz.
   Gerekçe: para bağlamaz ve reconciler zaten hem `PENDING` hem `FAILED` tarar,
   yani davranış farkı yok. AST nöbetçisi bu yüzden **yalnız `PAID` yazan**
   claim'leri kapsıyor. Bu bir kapsam kararıdır; yanlışsa nöbetçi de dar
   kalmıştır.
4. **Booking yüzeyi aynı şekli taşımaya devam ediyor.**
   `payment_service.complete_checkout:273-279` — `booking_dead` okuması
   kilitsiz, HELD claim'i booking durumunu koşullamıyor. Orada kayıp güncelleme
   değil **sahipsiz emanet** oluşur ve kemeri var
   (`reconcile_orphaned_escrow`). D10 kemeri gerçekten ölçüyor (sahipsiz emanet
   üretiliyor, 1 kayıt işleniyor, `REFUNDED`, tek sağlayıcı çağrısı). Ama
   kemer **karantina penceresine** bağlıdır: `REFUND_RECONCILE_MIN_AGE_MINUTES`
   dolana kadar para emanette kilitli durur. İP-18 bunu düzeltmedi.
5. **Çapraz-paket bağımlılığı (artık iki nöbetçili).** "Reconciler taramasına
   `orders.status` filtresi eklenmemeli" kuralının nöbetçisi başlangıçta yalnız
   İP-2b'deydi (`reconciler_partisi_zehirlenmez`); D11 ile kendi paketimize de
   kondu. Ama İP-2b'nin o testi hâlâ **ayrık** iddia kullanıyor ([[TB-39]]) —
   yani ikinci nöbetçi birinciden daha zayıf.
6. **`_out_of_stock_refund` bayat yaşam döngüsü okuyor** ([[TB-37]]). Para
   etkisi yok, ama çift `CANCELLED` geçmişi + çift bildirim (I11) üretebilir.
   Kırmızı testi olmadığı için **bilerek** dokunulmadı.
7. **Pencere kancası white-box'tır.** `stock_ledger.lock_products`'ı
   monkeypatch'lemek üretim fonksiyonuna test kancası takmaktır. Gerekçe: başarı
   yolunda `complete_checkout` ile claim arasında hiçbir sağlayıcı çağrısı
   yoktur, yani black-box bir kapı yoktur. Kanca yeri değişirse düğümler pencere
   kurmadan yeşile dönebilir — bu yüzden hepsi `tetik["oldu"]` assert eder.
   Denetçi o assert'i sökerek testlerin gerçekten pencere kurduğunu doğrulamalı.
8. **`refunded_amount` için "tek yazıcı" yapısal nöbetçisi hâlâ yok.** TB-15(b)
   davranış olarak kapandı, **davranış nöbetçileri de eklendi** (D12/D13/D14,
   IP18-9/10/11 ile kanıtlandı) — ama "kod tabanında bu kolona yazan tek yer"
   diyen yapısal nöbetçi yok ([[TB-38]]/(a)).
9. **Ölü-varlık iadesi `refunded_amount`'ı sağlayıcıdan ÖNCE yazıyor ve
   sağlayıcının sonucunu YOK SAYIYOR.** `_olu_varlik_tahsilatini_iade_et`
   sırası şudur: claim → `apply_refunded_amount` → `commit` → **sonra**
   `refund_unexpected_charge` → audit → `commit`. Yani sağlayıcı iadeyi
   reddederse satır yine `REFUNDED` + `refunded_amount = total` kalır ve
   `refund_unexpected_charge`'ın `bool` dönüşü hiçbir yerde okunmaz.
   `apply_refunded_amount`'ın kendi docstring'i ise **"yalnız sağlayıcı
   BAŞARISINDAN sonra çağrılmalıdır"** diyor — açık çelişki. Bu şekil tabanda
   da vardı (dal `refunded_amount`'ı claim'in içinde, sağlayıcıdan önce
   yazıyordu) ama hiçbir yerde **beyan edilmemişti**; İP-18 onu merkezî
   yazıcıya taşırken çelişkiyi devraldı, düzeltmedi. İki fazlı yapmak
   (`REFUNDING` → sağlayıcı → `REFUNDED`) bu dalın replay idempotency'sini
   değiştirir — bugün "sağlayıcının aşırı-iade reddi"ne yaslanıyor — yani ürün
   kararı ister. **Kırmızı testi yok, düzeltilmedi.**
10. **AST nöbetçisi kandırılabilir.** `values` sözlüğü satır içi değil bir
    DEĞİŞKENE alınırsa dedektör göremez; denetim bunu çalışan bir örnekle
    gösterdi ve o kaçış hem AST nöbetçisini hem 21 davranış testini geçti
    ([[TB-41]]). Bu turda **pozitif kontrol** eklendi (dedektör bilinen kötü
    örneği gerçekten buluyor mu) — bu, "dedektör bozulursa sonsuza dek yeşil
    kalır" hâlini kapatır ama **kaçışı kapatmaz**.
11. **Mutasyon sürücüsünün `ERROR` gölgelemesi kısmen kör.** Düğüm ayracı
    (`::`) olmayan koleksiyon hatası sayılmıyor ([[TB-42]]). Yön güvenlidir
    (eksik sayar, fazla saymaz) — yani "11/11 yakalandı" sonucu bu kusurdan
    şişmiş değildir; ama bir mutasyon suite'i hiç koşturamazsa "yakalanmadı"
    görünebilir. Bu turda yalnız docstring'in fazla geniş iddiası daraltıldı.

## 9. Koşum reçetesi

```powershell
cd backend
$env:POSTGRES_DB='adana_ip18_test'; $env:PAYMENT_PROVIDER='fake'
$env:POSTGRES_HOST='localhost'; $env:POSTGRES_PORT='5432'
$env:POSTGRES_USER='postgres'; $env:POSTGRES_PASSWORD='<parola>'

python -m pytest tests/integration/test_ip18_siparis_kilit_pg.py tests/test_ip18_odeme_kosulu.py -q
python -m pytest tests/integration -q                    # tam regresyon, TEK koşum
python -m pytest tests -q --ignore=tests/integration --ignore=tests/verify
python -m scripts.mutation_drill_ip18                    # 8 prova
```

`ceyhandb`'ye **koşulmaz** (TB-35: alembic açısından erişilemez durumda).

## 10. Açılan borç kayıtları

| # | Konu |
|---|---|
| [[TB-37]] | `_out_of_stock_refund` bayat yaşam döngüsü — çift `CANCELLED` geçmişi + çift bildirim (I11) |
| [[TB-38]] | Kaynak sözleşmesi testleri ada duyarlı, davranışa kör — üç vaka, iki maddeli kural |
| [[TB-39]] | İP-2b'nin ayrık kabul iddiası bir P0'ı 11 gün maskeledi |
| [[TB-40]] | D9 kandırılabilir: `FOR UPDATE OF o` (JOIN'de orders ikinci tablo) hem D9'u hem kaynak sözleşmesini geçiyor |
| [[TB-41]] | AST nöbetçisi kandırılabilir: `values` değişkene alınırsa görülmüyor |
| [[TB-42]] | Mutasyon sürücüsünün `ERROR` gölgelemesi düğüm ayracı olmayan koleksiyon hatasını saymıyor |

Kapanan: **TB-15** (tamamı) · Numara tahsisi **iki kez** ölçülerek yapıldı (tüm
yerel + uzak dallar tarandı): ilk turda en yüksek **TB-36** → 37/38/39;
denetim sonrası turda en yüksek **TB-39** → 40/41/42.
