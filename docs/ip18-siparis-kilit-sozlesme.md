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
- **I-18/4 (kilit sırası)** — Düzeltme kilitle YAPILMAZ. Kanonik sıra
  `Product → Order → OrderReturn`; `complete_checkout` yoluna Order satır
  kilidi eklemek bu yolu `Order → Product` yapar.

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

| Yol | Sıra | Sonuç |
|---|---|---|
| Canlı sipariş | iş biter → commit → istisna savepoint **çıkışında** | Veri doğru; her başarılı kayıtta gürültülü `logger.exception`, `handled` artmıyor |
| **Ölü sipariş** | iade claim'i **COMMIT** → `db.refresh(order)` → **istisna** | `refund_unexpected_charge`'a hiç varılmıyor: satır `REFUNDED`, sağlayıcıya iade **SIFIR** |

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

| # | Mutasyon | Seçilen | Taban | Kırılan |
|---|---|---|---|---|
| IP18-1 | Yaşam döngüsü koşulu söküldü | 10 | yeşil | 6 (D1, D3, D4, D5, D6, D7b) |
| IP18-2 | Boğaz noktası atlandı | 22 | yeşil | 3 (AST nöbetçisi + 2 kilit sözleşmesi) |
| IP18-3 | Ölü-varlık iadesi söküldü | 10 | yeşil | 1 (D3) |
| IP18-4 | Claim sonucu yok sayıldı | 10 | yeşil | 6 (D4 dahil) |
| IP18-5 | Kilit sırası ters çevrildi | 26 | yeşil | 6 (**D9** dahil) |
| IP18-6 | Taze okuma bayatlatıldı | 10 | yeşil | 1 (D3) |
| IP18-7 | Reconciler'a status filtresi eklendi | 16 | yeşil | 2 (**D11** + İP-2b R11) |
| IP18-8 | `PARA_BAGLANABILIR_DURUMLAR += CANCELLED` | 16 | yeşil | 8 (6 davranış + 2 saf) |

**8/8 yakalandı.** Geri alma bayt yedeği + SHA-256 ile doğrulandı; her provadan
sonra HEAD ve `git status` başlangıçla karşılaştırıldı.

## 8. Denetçinin ilk bakacağı yerler

> Kendi zayıf noktalarımı işaretliyorum; `sm2-kaldirma` turunda bu işe yaradı.
> Aşağıdakiler "bilerek böyle" demek DEĞİL — "önce buraya bak" demektir.

1. **D9 tek nöbetçidir ve tek yöntemi vardır.** Kilit sırası iddiasını gerçek
   SQL'de yalnız o ölçüyor. Kaynak sözleşmesi (`test_stock_lock_contract`) aynı
   ihlalde **kırılmadı** (IP18-5 ile ölçüldü) — yani ikinci katman yok, sanılan
   ikinci katman kör. D9'un `before_cursor_execute` filtresi de dizgi eşleşmesine
   dayanır (`from products` / `update orders`); SQL üretimi değişirse sessizce
   hiçbir şey görmeyebilir. **Kurgu bozulursa test kırılır** (`"product" in
   kayit` / `"order" in kayit` assert'leri) ama filtre yanlış eşleşirse
   yakalamaz. Buraya ikinci bir yöntem gerekir.
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
   davranış olarak kapandı ama nöbetçisi yazılmadı ([[TB-38]]/(a)).

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

Kapanan: **TB-15** (tamamı) · Numara tahsisi ölçülerek yapıldı (tüm yerel +
uzak dallar tarandı; en yüksek **TB-36** → yeni kayıtlar 37'den).
