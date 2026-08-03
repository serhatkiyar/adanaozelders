# İP-1a — Ders Pazaryeri Para Güvenliği Sözleşmesi

> **Durum (güncel): ÜRETİM UYGULAMASI YAZILDI — 26 kabul testinin tamamı yeşil.**
> Sözleşme artık yalnız "ne olmalı"yı değil, **ne yapıldığını** da anlatır:
> uygulamanın kendisi ve ölçümleri §12'dedir. Kabul testleri değiştirilmedi,
> gevşetilmedi, silinmedi — yeşilliğin sebebi üretim kodudur.
>
> **Tarihsel kayıt (değiştirilmedi):** §1-§9 bölümleri *kırmızı checkpoint*
> turunda yazıldı ve o günkü gerçeği anlatır ("bugün şöyle çalışıyor" cümleleri
> ve satır numaraları o tura aittir). Kapanan her P0'ın karşılığı §12'de
> gösterilir; geçmiş bölümler geriye dönük düzeltilmez, çünkü hangi kusurun
> nasıl bulunduğu kaydın kendisidir.
>
> Doğrulama zemini: `ip1a-ders-para-kirmizi`. Kırmızı checkpoint `main` =
> `26f30d8` üzerinde yazıldı; uygulama turu `main` = `59afdac` merge'lenmiş
> zeminde (merge commit `220e46e`) koşuldu.

---

## 1. Mevcut gerçek akış

Ders parası tek bir tabloda yaşar: `payments` (`backend/models/payment.py`),
`bookings` ile 1:1 (`uq_payments_booking_active`, kısmi unique index —
`models/payment.py:80-85`). Booking üzerinde **hiçbir para damgası yoktur**;
`Booking`'de `price` (`models/booking.py:54`) ve `is_free_lesson` dışında para
alanı bulunmaz.

```
tutor accept ──► payment_service.create_for_booking  → Payment PENDING
client pay   ──► payment_service.pay                 → Payment HELD   (emanet)
complete     ──► payment_service.release             → Payment RELEASED (+released_at)
cancel       ──► payment_service.refund              → REFUNDING → REFUNDED
```

Hook'ların **tamamı** `booking_service` içindedir ve yalnız dört satırdır
(grep ile doğrulandı, `services/booking_service.py`):

| Satır | Çağrı | Hangi geçişte |
|---|---|---|
| 427 | `payment_service.create_for_booking` | `accept` |
| 460 | `payment_service.release` | `complete` (elle) |
| 597 | `payment_service.release` | `auto_complete_past_bookings` |
| 642 | `payment_service.refund` | `cancel` (taraf iptali) |

**Bu listede `reject` ve admin iptali yoktur.** İP-1a'nın çekirdek bulgusu budur.

Escrow çekirdeği (`services/escrow.py`) olgun ve doğrudur: her para geçişi
koşullu UPDATE ile claim edilir (`escrow.py:157-193`), iade iki fazlıdır
(`begin_refund` intent commit'i → `perform_refund` sağlayıcı → `finalize_refund`),
`released_at` dolu satır asla iadeye claim edilemez (`escrow.py:226-230`).
Sorun escrow katmanında **değil**, booking FSM'inin escrow'u çağırmadığı
bacaklarındadır.

---

## 2. P0 kök nedenleri (güncel main'de yeniden doğrulandı)

### P0-1 — Reschedule → reject: emanet kilidi

Üç ayrı doğru davranışın birleşimi bir açık üretir:

1. `reschedule` süre değişmediyse fiyatı da değiştirmez, bu yüzden
   `payment_service.sync_amount_with_booking` erken döner
   (`services/payment_service.py:95-96`) — **HELD ödeme olduğu gibi kalır**.
   (Fiyat değişirse HELD'de 409 verilir, `payment_service.py:111-116` — bu doğru.)
2. `reschedule` booking'i koşulsuz `PENDING`'e alır
   (`services/booking_service.py:492`, FSM tablosu atlanarak doğrudan atama).
3. `PENDING`'den `REJECTED`'a geçiş meşrudur (`booking_service.py:53-57`) ve
   `reject` **hiçbir para çağrısı yapmaz** (`booking_service.py:432-443`, tam
   gövde okundu — `payment_service` geçmiyor).

Sonuç: `Booking.REJECTED` (terminal) + `Payment.HELD`. Para ne öğrenciye döner,
ne eğitmene geçer. Üç arka plan tarayıcısının **hiçbiri** bu satırı görmez:

- `auto_complete_past_bookings` yalnız `status == ACCEPTED` tarar (`booking_service.py:575`);
- `reconcile_refunding` yalnız `status == REFUNDING` tarar (`escrow_reconciler.py:77`);
- `reconcile_stale_checkouts` yalnız `PENDING/FAILED` tarar (`escrow_reconciler.py:171`).

> Not: aynı kilit `PENDING` fiyatlı reschedule'da doğmaz — orada ödeme henüz
> tahsil edilmemiştir. Açık **yalnız HELD + süre-değişmeyen reschedule**
> yolunda doğar ve tam da bu yüzden gözden kaçmıştır.

### P0-2 — Admin booking iptali

`services/admin_service.py:397-404` (tam gövde):

```python
async def cancel_booking(db, booking, reason=None) -> Booking:
    booking.status = BookingStatus.CANCELLED
    ...
    await db.flush()
    return booking
```

- FSM guard'ı **yok** → `COMPLETED` (ödemesi `RELEASED`) bir ders bile
  `CANCELLED` yapılabilir. Kullanıcı yolu aynı geçişte 409 verir
  (`booking_service.py:609-613`).
- Refund **yok** → `admin_service.py` `payment_service`/`escrow` import bile
  etmez (import bloğu `admin_service.py:1-26`).
- Atomik claim / `FOR UPDATE` **yok** → read-modify-write.
- Bildirim ve WS push **yok**; audit **var** (`api/routers/admin.py:550-557`).
- Idempotent **değil** → ikinci istek 200 döner, gerekçeyi ezer, ikinci audit
  satırı yazar.

### P0-3 — Ders başlamadan tamamlama

`services/booking_service.py:446-462` (tam gövde okundu): `start_at`, `end_at`
ve `now()` **hiç okunmaz**. Router'da da kontrol yok (`api/routers/bookings.py:140-148`).

Sonuç: eğitmen kabul eder → öğrenci öder (HELD) → eğitmen dersten **haftalar
önce** `complete` çağırır → `release` HELD→RELEASED claim'ini yapar ve
`released_at` damgalanır. `escrow.begin_refund`'ın `released_at IS NULL` guard'ı
(`escrow.py:226-230`) yüzünden bu para **artık iade edilemez**. Kıyas:
`payment_service.pay` en azından `booking.status != ACCEPTED` kontrolü yapıyor
(`payment_service.py:141-145`); `complete`'te zamanın karşılığı yok.

### P0-4 — Dispute açıkken auto-complete/release

`auto_complete_past_bookings` sorgusu (`booking_service.py:573-581`) üç koşul
taşır: `status == ACCEPTED`, `deleted_at IS NULL`, `end_at <= cutoff`.
`is_disputed` **yoktur**.

Daha genel bulgu: `is_disputed` (`models/booking.py:78-80`) **hiçbir para veya
FSM kararında okunmaz**. Tek yazma yolu `admin_service.toggle_dispute`
(`admin_service.py:407-412`); okuma yolları yalnız admin listesi filtresi
(`admin_service.py:357-358`) ve dashboard sayacı (`admin_service.py:152`).
Yani dispute bugün **salt bir etikettir**: admin bir dersi ihtilaflı işaretlese
bile `AUTO_COMPLETE_GRACE_HOURS` (=12, `core/config.py:326`) sonra ders otomatik
COMPLETED olur ve para eğitmene geçer — geri dönüşü olmayacak biçimde.

Elle `complete` yolu da aynı boşluğu taşır (`booking_service.py:446-462`):
sözleşme her iki yolu birden bağlar, yalnız arka plan sorgusunu değil.

### P0-5 — Terminal booking + sahipsiz HELD, reconciler görünürlüğü

`escrow_reconciler.reconcile_refunding` (`escrow_reconciler.py:66-135`) yalnız
`status == spec.refunding` satırlarını tarar. `reconcile_stale_checkouts`
(`escrow_reconciler.py:138-280`) yalnız `PENDING/FAILED` + `provider_ref` dolu
satırları tarar. **Terminal booking ile eşleşen HELD ödeme hiçbir taramaya
girmez** ve hiçbir alarm üretmez.

P0-1 ve P0-2 bu durumu **üretir**; P0-5 ise onun **sessiz kalmasıdır**. İkisi
ayrı ayrı kapatılmalıdır: kaynak düzeltilse bile geçmişte oluşmuş satırlar ve
gelecekteki bilinmeyen yollar için bir ağ gerekir.

### P0-6 — accept/reject yarışları

`cancel` ve `complete` atomik claim kullanır (`_claim_transition`,
`booking_service.py:74-99`). **`accept` ve `reject` kullanmaz**
(`booking_service.py:413-443`): bellekteki nesne üzerinden `_transition` çağrılır
ve ORM'in ürettiği UPDATE yalnız `WHERE id = ...` ile gider. Yani bir taraf
`CANCELLED` claim'ini kazansa bile, yarışan `accept`/`reject` flush'ı bunu
**geri sürer** (lost update). `SELECT ... FOR UPDATE` booking yollarının
hiçbirinde yoktur.

`accept` için tesadüfi tek koruma `uq_payments_booking_active` kısmi unique
index'idir (iki eşzamanlı accept'in ikinci `create_for_booking`'i IntegrityError
→ 409). Bu bir tasarım değil, yan etkidir; `reject`'te karşılığı yoktur.

---

## 3. Booking × Escrow durum matrisi (hedef sözleşme)

`✅` = meşru ve kalıcı · `⛔` = oluşmamalı (invariant ihlali) · `⏳` = geçici,
reconciler sonuca sürer.

| Booking \ Payment | (yok) | PENDING | HELD | REFUNDING | REFUNDED | RELEASED | FAILED |
|---|---|---|---|---|---|---|---|
| PENDING | ✅ | ✅ | ⛔ **P0-1** | ⏳ | ✅ | ⛔ | ✅ |
| ACCEPTED | ✅ (ücretsiz/fiyatsız) | ✅ | ✅ | ⏳ | ✅ | ⛔ **P0-3** | ✅ |
| REJECTED | ✅ | ✅ | ⛔ **P0-1** | ⏳ | ✅ | ⛔ | ✅ |
| CANCELLED | ✅ | ✅ | ⛔ **P0-2** | ⏳ | ✅ | ⛔ | ✅ |
| COMPLETED | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ |

Okunuşu:

- **HELD yalnız ACCEPTED ile birlikte durabilir.** Booking terminal olduğu anda
  HELD para ya iade akışına girmeli ya da görünür alarma dönüşmelidir.
- **RELEASED yalnız COMPLETED ile birlikte durabilir**, ve COMPLETED ancak
  ders başladıktan sonra oluşabilir (P0-3).
- `PENDING`/`FAILED` ödeme her booking durumunda zararsızdır (tahsilat yok);
  bunlar `reconcile_stale_checkouts` kapsamındadır ve İP-1a kapsamı dışıdır.
- `payments` satırının yokluğu meşrudur: ücretsiz ilk ders ve eğitmenin saatlik
  ücreti tanımsızsa `create_for_booking` kayıt açmaz (`payment_service.py:49-50`).

---

## 4. Yetki matrisi

Prefix: `API_V1_PREFIX = "/api/v1"` (`core/config.py:17`).

| Uç | Metot | CLIENT | TUTOR | ADMIN | Anonim |
|---|---|---|---|---|---|
| `/bookings` | POST | ✅ sahibi + telefon doğrulu | 403 | 403 | 401 |
| `/bookings/{id}/accept` | POST | 403 | ✅ sahibi (+ ödeme kolu açık) | 403 | 401 |
| `/bookings/{id}/reject` | POST | 403 | ✅ sahibi | 403 | 401 |
| `/bookings/{id}/complete` | POST | 403 | ✅ sahibi | 403 | 401 |
| `/bookings/{id}/cancel` | POST | ✅ taraf | ✅ taraf | 403 | 401 |
| `/bookings/{id}/reschedule` | POST | ✅ sahibi | 403 | 403 | 401 |
| `/payments/booking/{id}/pay` | POST | ✅ sahibi + telefon doğrulu | 403 | 403 | 401 |
| `/admin/bookings/{id}/cancel` | POST | 403 | 403 | ✅ `bookings.manage` | 401 |
| `/admin/bookings/{id}/dispute` | POST | 403 | 403 | ✅ `bookings.manage` | 401 |

Notlar (davranış testiyle sabitlenecek):

- Booking var ama taraf değilsen **403** döner, 404 değil
  (`api/routers/bookings.py:55-65`). Teslimat tarafındaki "IDOR → 404" kararının
  tersi; **bilinçli mi, tutarsızlık mı — açık karar** (bkz. §10).
- Admin router'ı iki katmanlıdır: router seviyesinde `require_roles(ADMIN)`
  (`api/routers/admin.py:92-96`), uç seviyesinde
  `require_admin_permission("bookings.manage")` (`admin.py:545`). İzinsiz admin
  403 alır ve **SUPER_ADMIN bypass'ı yoktur** — izin rol-izin satırlarından okunur.
- `accept` onaylı eğitmen istemez (`get_current_approved_tutor` kullanılmıyor);
  yalnız `require_roles(TUTOR)`. İP-1a kapsamı dışı, ayrı not.

---

## 5. Idempotency ilkeleri

Bugün booking geçişlerinde **idempotency anahtarı yoktur**; korunan yerler
**durum sözleşmesiyle** korunur. Sözleşme bunu koruyup netleştirir:

1. **Para hareketi tetikleyen her geçiş koşullu UPDATE ile claim edilir.**
   Claim'i kaybeden taraf **hiçbir sağlayıcı çağrısı yapmaz**. (`escrow.claim`
   zaten böyle; `accept`/`reject`/admin-cancel bu disipline sokulmalıdır.)
2. **Aynı isteğin tekrarı çift para hareketi üretemez.** Ölçüt sağlayıcı çağrı
   sayısıdır (`StubProvider.refund_calls`), yanıt kodu değil.
3. **Tekrarın yanıtı sessiz başarı olmamalıdır.** Kullanıcı yolu 409 verir
   (`booking_service.py:609-613`); admin yolunun 200 dönüp gerekçeyi ezmesi
   (`admin_service.py:397-404`) bilinçli bir karar değil, guard eksikliğidir.
4. **İade niyeti (REFUNDING) kalıcıdır ve geri alınamaz.** `HELD`'e dönüş yoktur
   (`escrow.py:259-260`).
5. Test disiplini: sabit idempotency anahtarı testler arasında paylaşılmaz;
   her senaryo kendi `provider_ref`'ini üretir.

---

## 6. Concurrency / claim sözleşmesi

| Yarış | İzin verilen son durum kümesi | Escrow sonucu | Sağlayıcı çağrısı |
|---|---|---|---|
| accept ↔ client cancel | tam olarak biri: `{ACCEPTED}` **veya** `{CANCELLED}` | ACCEPTED ise PENDING ödeme; CANCELLED ise ödeme yoksa no-op | 0 |
| reject ↔ client cancel | tam olarak biri: `{REJECTED}` **veya** `{CANCELLED}` | HELD varsa **her iki dalda da** iade akışı | tam 1 |
| admin cancel ↔ tutor complete | tam olarak biri: `{CANCELLED}` **veya** `{COMPLETED}` | CANCELLED→REFUNDED / COMPLETED→RELEASED, **asla ikisi birden** | ≤ 1 |
| auto-complete ↔ dispute açılması | dispute kazanırsa `{ACCEPTED}`, aksi `{COMPLETED}` | dispute açıkken `released_at` **NULL** kalmalı | 0 |
| iki eşzamanlı reconciler worker'ı | tek claim | tek iade | tam 1 |

Kurallar:

- READ COMMITTED'da koşullu UPDATE yeterlidir: yarışan transaction satır
  kilidinde bekler, `WHERE` güncel satıra göre yeniden değerlendirilir. Testler
  bunu üretimle **aynı isolation seviyesinde** ölçer
  (`tests/integration/test_money_pg.py:30-34` zaten bunu nöbetçiliyor).
- "Sonuçlardan biri oldu" **yetersiz bir iddiadır**. Her yarış testi dört şeyi
  birlikte ölçer: son booking durumu · son escrow durumu · sağlayıcı çağrı
  **sayısı** · kayıp güncelleme olmadığı (yani terminal bir durumun üzerine
  yazılmadığı).
- Determinizm için `StubProvider.refund_gate` + `StubProvider.refund_entered`
  (`tests/integration/conftest.py`) ve test tarafındaki `okundu`/`kapi`
  event'leri kullanılır: iki transaction "durum okundu, henüz yazılmadı"
  penceresinde buluşturulur. **`test_ip1a_races_pg.py` içinde `asyncio.sleep`
  yoktur** — ardışıklığın her adımı açık bir event ile beklenir (bkz. §9c/4;
  bu iddia ilk yazıldığında henüz doğru değildi).

---

## 7. Provider başarısızlık politikası

Mevcut ve korunacak davranış (`escrow.py:250-276`):

- Sağlayıcı iadesi başarısızsa kayıt **REFUNDING'de bırakılır**, `HELD`'e geri
  dönülmez, `REFUNDED`'a da geçilmez. **Para durumu yalan biçimde
  kesinleştirilmez.**
- `NOT_REFUNDED` / `UNKNOWN` "iade yok" kanıtı **değildir**
  (`core/payments/base.py`, `RefundState`). Retry sınırlıdır ve emniyet kemeri
  sağlayıcının aşırı-iade reddidir.
- Pozitif kanıt (`REFUNDED`) yazma çağrısı yapmadan yalnız yerel finalize üretir
  (`ACTION_FINALIZE`).
- Deneme sınırı dolunca `ACTION_ALERT`: retry durur, kayıt ERROR logu ile
  **görünür** kalır (`escrow_reconciler.py:108-114`).

İP-1a bunu değiştirmez; yeni yazılacak yollar (reject/admin-cancel iadesi)
**aynı `escrow.refund_escrow` yoluna** bağlanmalıdır — paralel bir iade
uygulaması yazılmamalıdır.

---

## 8. Reconciler politikası (P0-5 için önerilen karar)

Üç seçenek değerlendirildi. Karar **geri döndürülebilirlik** ölçütüyle verildi.

| Seçenek | Risk |
|---|---|
| (a) Sessiz bırak (bugünkü hâl) | Para süresiz kilitli; kimse fark etmez. **Kabul edilemez.** |
| (b) Yalnız MANUAL_REVIEW alarmı | Güvenli ama parayı iade etmez; operasyon yükü her olayda insana biner. |
| (c) **Güvenli claim sonrası otomatik iade + ERROR logu** | Önerilen. |

**Öneri: (c).** Gerekçeler:

1. **Sistemin kendi precedent'i budur.** `payment_service.complete_checkout`
   tam olarak aynı durumda — para tahsil edilmiş, varlık ölü — otomatik iade
   başlatır ve ERROR loglar (`payment_service.py:273-310`). Terminal booking'de
   sarkan HELD, o senaryonun geç fark edilmiş hâlidir; farklı davranmak
   tutarsızlık olur.
2. **İade tek geri döndürülebilir yöndür.** Öğrenciye iade yanlışsa öğrenci
   yeniden ödeyebilir. Eğitmene release yanlışsa `released_at` guard'ı
   (`escrow.py:226-230`) yüzünden **geri alınamaz**. Belirsizlikte geri
   döndürülebilir yön seçilir.
3. **Yeni bir para yolu icat edilmez.** Aynı `escrow.refund_escrow` (claim +
   iki faz) kullanılır; idempotency, yarış ve sağlayıcı-başarısızlığı
   davranışı otomatik olarak devralınır.

Sözleşme maddeleri (kırmızı testlerin ölçtüğü):

- **S1.** Terminal booking (`REJECTED`/`CANCELLED`/soft-deleted) ile eşleşen
  `HELD` ödeme **sessiz kalamaz**: ya iade akışına girer ya da alarm üretir.
  Bugün ikisi de olmuyor.
- **S2.** Karantina penceresi uygulanır (`REFUND_RECONCILE_MIN_AGE_MINUTES`=15
  deseni): uçuşta olan bir transaction reconciler tarafından yakalanmaz.
- **S3.** Aynı reconciler turu aynı kaydı **iki kez işlemez**.
- **S4.** İki eşzamanlı worker'dan **yalnız biri** claim kazanır; sağlayıcıya
  tam **bir** iade emri gider.
- **S5.** Sağlayıcı çağrısı başarısızsa kayıt `REFUNDING`'de kalır; `REFUNDED`
  damgalanmaz, `HELD`'e de dönülmez.
- **S6.** `released_at` dolu kayıt **hiçbir koşulda** iadeye claim edilmez.

---

## 9. Test sözleşmesi (bu checkpoint'in ölçtükleri)

Ölçüm noktaları — her kabul testi bunların **birlikte** doğru olduğunu ölçer,
tek başına HTTP durum kodu yeterli sayılmaz:

1. `Booking.status` (DB'den taze okunur, ORM identity map'ten değil)
2. `Payment.status` + `released_at` / `refunded_at` / `refund_requested_at`
3. Sağlayıcı çağrı **sayısı** ve tutarı (`StubProvider.refund_calls`)
4. Hakediş: `payout_ledger` yalnız `RELEASED` ödemeleri "earned" sayar
   (`services/payout_ledger.py:96-107`) → payout yokluğu buradan ölçülür
5. `notifications` satırları — **kime** ve **ne anlama geldiği**. Para hareketi
   bildiriminde satır SAYISI dayatılmaz: tek birleşik mesaj da ayrı iade mesajı
   da meşrudur (bkz. §9c). Sayı yalnız "kaybeden taraf hiçbir yan etki
   üretmemeli" gibi **yan etki yokluğu** iddialarında ölçülür.
6. `audit_logs` satırları (admin yolları)

Altyapı kuralları:

- Gerçek PostgreSQL zorunlu; adı `test` içermeyen veritabanında suite
  **başlamaz** (`tests/integration/db_guard.py`).
- Ham ORM nesnesini elle değiştirip "akış oldu" saymak yasak.
- Provider için gerçek ağ çağrısı yok; gözlenebilir `StubProvider`.
- Temizlik yalnız oluşturulan ID'lerle. Global TRUNCATE / trigger disable yok.
- `skip`/`xfail` yok. Koşmayan test kırmızıdır, yeşil değil.
- **Her test sonlu sürede sonuç üretmek zorundadır** — sonuçlanmayan test de
  kırmızıdır. Eşzamanlılık testlerindeki `asyncio.Event` kapıları çıplak
  `await event.wait()` ile beklenmez; hepsi süreli, açıklayıcı mesajlı ve
  üretici görevin hatasını gizlemeyen bir bariyerden geçer
  (`test_ip1a_races_pg.py::_event_bekle`, tek sabit `KAPI_TIMEOUT`). Gerekçe
  ölçülmüştür: sınırsız bekleme, A1 mutasyonunu kırmızıya değil **asılmaya**
  çeviriyordu (§9c/6, §9d A1 notu).
- Her P0 için en az bir **meşru yeşil nöbetçi** bulunur: doğru davranışın hâlâ
  çalıştığını kanıtlar ve mutasyon provasının hedefidir.

---

## 9b. Test envanteri (bu checkpoint'te oluşturulanlar)

| Dosya | Konu | Kırmızı | Yeşil nöbetçi |
|---|---|---:|---:|
| `test_ip1a_reschedule_reject_pg.py` | P0-1 | 4 | 4 |
| `test_ip1a_admin_cancel_pg.py` | P0-2 | 6 | 6 |
| `test_ip1a_complete_timing_pg.py` | P0-3 | 3 | 6 |
| `test_ip1a_dispute_autocomplete_pg.py` | P0-4 | 4 | 4 |
| `test_ip1a_orphan_escrow_pg.py` | P0-5 | 5 | 6 |
| `test_ip1a_races_pg.py` | P0-6 | 4 | 3 |
| `test_ip1a_factory_hygiene_pg.py` | zemin | 0 | 5 |
| **Toplam** | | **26** | **34** |

**Sayı değişikliğinin gerekçesi (bağımsız denetim turu, P1-2).** İlk envanter
`test_ip1a_admin_cancel_pg.py` için 4 kırmızı + 7 yeşil (11 node) diyordu;
şimdi 6 + 6 (12 node). Sebep, kırmızı azaltmak ya da yeşil eklemek DEĞİL:
yeşil sayılan `test_YESIL_servis_katmani_admin_yolunu_da_baglar` **yanlış
servisi** ölçüyordu (`booking_service.cancel`, yani öğrenci yolu). O node
kaldırıldı ve yerine `admin_service.cancel_booking`'i doğrudan çağıran iki
gerçek nöbetçi kondu; ikisi de üretimdeki mevcut boşluğu ölçtüğü için
**kırmızı**. Yani: −1 sahte yeşil, +2 gerçek kırmızı → toplam 59 → **60**.
Önceden var olan 24 üretim kırmızısının hiçbiri azaltılmadı.

Tür dağılımı (kök CLAUDE.md §H uyarınca dürüst sınıflandırma):

- **Gerçek PostgreSQL + gerçek servis**: 60 (hepsi)
- **Gerçek HTTP** (ASGI transport, gerçek yetki zinciri): 38
- **Gerçek eşzamanlılık** (birden çok bağlantı/transaction): 8
- **Servis katmanı, HTTP'siz** (kuralın router'da değil serviste yaşadığını
  sabitler): 2
- Saf yardımcı / birim: 0 · Kaynak-AST sözleşmesi: 0 · Snapshot: 0
- `skip` / `xfail`: **0** · collection error: **0** · `asyncio.sleep` ile kurulan
  yarış: **0**

Ortak fabrika: `tests/integration/ip1a_factory.py`. Emanet durumları
`booking_service.accept` + `payment_service.pay` **gerçekten koşularak** üretilir;
elle `status=HELD` yazılmaz (kanıt: `test_ip1a_factory_hygiene_pg.py`).

## 9c. Bu turda bulunan test kusurları (dürüst kayıt)

Mutasyon provası ve ardından gelen bağımsız denetim, İP-1a'nın kendi
nöbetçilerinde **dört** gerçek zayıflık buldu. Kök CLAUDE.md §D gereği her
birinde önce eksiklik kabul edildi, sonra regresyon testi eklendi/güçlendirildi,
sonra mutasyon tekrarlanıp kırıldığı gösterildi.

1. **Booking claim'i, ödeme claim'ini gölgeliyordu.** `payment_service.release`'in
   `from_statuses=[HELD]` kısıtını gevşetmek hiçbir testi kırmadı: ilk turdan
   sonra booking `COMPLETED` olduğu için auto-complete onu bir daha seçmiyor ve
   `release` tekrar çağrılmıyordu. → `test_YESIL_release_IKI_KEZ_cagrilsa_bile_damga_DEGISMEZ`
   eklendi (`release` doğrudan iki kez çağrılır).

2. **`escrow.begin_refund`'ın `released_at IS NULL` guard'ı davranışsal olarak
   hiç sınanmamış.** Guard silindiğinde ne İP-1a testleri ne de **mevcut paket**
   kırıldı — `test_money_pg.py::test_h2_cancel_session_skips_released_no_show`
   dahil. Sebep: her çağıran kendi sorgusunda zaten `released_at` filtresi
   taşıyor (ör. `library_exam_service.py:273`) ve ödeme yüzeyinde `RELEASED` ayrı
   bir durum olduğu için `from_statuses=[HELD]` kısıtı guard'ı gölgeliyor. Yani
   **dört para yüzeyinin paylaştığı çekirdekteki bir güvenlik hattı silinse kimse
   fark etmezdi.** → `test_YESIL_released_at_dolu_HELD_satiri_IADEYE_CLAIM_EDILEMEZ`
   eklendi (bozuk satır bilinçli olarak kurulur, guard doğrudan sınanır).

3. **Hijyen nöbetçisi ders-para tablolarını saymıyor** (kapsam dışı zemin
   kusuru). `tests/integration/conftest.py::_KRITIK_TABLOLAR` içinde `bookings`,
   `payments` ve `tutors` **yok**; teardown'u eksik bir ders-para testi satır
   biriktirse suite yine yeşil kalırdı. Bu turda listeye dokunulmadı (kapsam:
   yalnız sözleşme + fabrika + kırmızı testler); boşluk fabrika içinde
   `sizinti_var_mi()` ile ID bazında kapatıldı
   (`test_ip1a_factory_hygiene_pg.py::test_fabrika_temizligi_kendi_satirlarini_TAMAMEN_siler`).
   Kalıcı çözüm İP-1b'ye önerilir.

**Bağımsız denetim turu (üretim kodu DEĞİŞMEDİ) iki kusur daha buldu.** İkisi de
"yeşil ama yanlış şeyi ölçüyor" sınıfındandır — kök CLAUDE.md §E'nin sorduğu
"eski bozuk kod da bu testi geçer miydi?" sorusuna ikisi de **evet** cevabı
veriyordu.

4. **Eşzamanlı tamamlama testi atomik claim'i hiç sınamıyordu (P1-1).**
   `test_YESIL_iki_esZamanli_tamamlama_TEK_release_uretir` iki `complete`
   görevini `asyncio.gather` ile başlatıyordu. Bu yarış KURMUYOR: ikinci görev
   booking satırını ilk görev **commit ettikten sonra** okuyor, dolayısıyla
   409'u `_claim_transition`'ın koşullu UPDATE'i değil bellekteki `_transition`
   üretiyordu. Kanıtlandı: `complete()` içindeki claim çağrısı bellek içi
   `_transition` + `flush()` ile değiştirildiğinde **eski test yeşil kalıyor**
   (koşuldu, gözlendi). → Test, gerçek üretim interleaving'ini modelleyen
   **bayat okuma** kurulumuna çevrildi: kaybeden taraf satırı okur ve `okundu`
   event'ini set eder, kazanan tam transaction'ını commit eder, ancak ondan
   sonra kaybeden elindeki bayat `ACCEPTED` ile yazmayı dener. Bu kurulumda
   bellek içi FSM kaybedeni GEÇİRİR; onu yalnız koşullu UPDATE durdurabilir.
   Ölçüm de genişletildi: tek final durum · **`released_at` damgası değişmedi** ·
   tek hakediş · kaybedende **hiçbir yan etki** (bildirim sayısı dahil) ·
   kaybedene 409.

5. **Admin servis-katmanı nöbetçisi yanlış servisi çağırıyordu (P1-2).**
   `test_YESIL_servis_katmani_admin_yolunu_da_baglar`, adı "admin yolunu da
   bağlar" demesine rağmen `booking_service.cancel` çağırıyordu — o ÖĞRENCİ
   yoludur, zaten doğru çalışır ve `admin_service.cancel_booking` hakkında
   hiçbir şey söylemez. Yeşilliği bedavaydı. → Node kaldırıldı; yerine admin
   servisini **doğrudan** çağıran iki test kondu (HELD emanetin iadesi + terminal
   geçişin 409'u). **Router-only provası koşuldu**: düzeltme geçici olarak yalnız
   `api/routers/admin.py` ucuna konup `admin_service` bozuk bırakıldığında HTTP
   nöbetçilerinin 3'ü yeşile döndü ama **yeni servis testlerinin ikisi de kırmızı
   kaldı** — yani matris artık router'a konan bir yamayla kandırılamaz. Eski
   nöbetçi bu provada yeşil olurdu.

Aynı turda düzeltilen üç küçük doğruluk kusuru (davranış iddiası değişmedi):

- **Aşırı kısıtlayan bildirim testi.**
  `test_reschedule_sonrasi_reject_OGRENCIYI_BILGILENDIRIR` `once + 2` dayatıyor,
  yani "red bildirimi" ile "iade bildirimi"nin AYRI satırlar olmasını şart
  koşuyordu. Tek birleşik "dersin reddedildi ve ödemen iade edildi" mesajı da
  meşrudur; sayıyı dayatan test doğru bir uygulamayı kırmızıya düşürürdü. Test
  artık üç parçalı invariant'a bağlı: doğru kullanıcı (öğrenci) · içerikte
  para/iade anlamı · en az bir bildirim. (Yardımcı: `Ip1aFabrika.bildirimler`,
  id'li — aynı metnin ikinci kez yazılması küme farkıyla görünmez kalmasın.)
- **Yanlış hata mesajı.**
  `test_saglayici_basarisizsa_para_durumu_YALAN_KESINLESMEZ` kırmızıyken
  "HELD'e geri döndürüldü" diyordu; bugünkü gerçek sebep tarayıcının kayda
  **hiç dokunmamasıdır**. Mesaj artık iki güvensiz hâli birden adlandırıyor.
- **Var olmayan yardımcıya atıf.** `test_ip1a_orphan_escrow_pg.py` docstring'i
  hiç yazılmamış bir `_sahipsiz_cozuldu_mu` yardımcısına yönlendiriyordu; tek
  ayar noktası modül düzeyindeki `COZULMUS` sabitidir, docstring düzeltildi.

**Üçüncü (dar) denetim turu bir kusur daha buldu: P1-3.** Bu kusur "yanlış şeyi
ölçüyor" sınıfından değil, daha sinsi bir sınıftandır: **hiçbir şey ölçmüyor,
çünkü sonuçlanmıyor.**

6. **Sınırsız `Event` beklemeleri, mutasyonda test SONUCU değil ASILMA
   üretiyordu (P1-3).** `test_ip1a_races_pg.py` sleep'siz determinizmi
   `asyncio.Event` kapılarıyla kuruyor, ama kapıları çıplak
   `await <event>.wait()` ile bekliyordu. A1 mutasyonu altında (`cancel`
   içindeki `payment_service.refund` no-op) kapıyı açacak kimse kalmıyor ve
   test **süresiz asılıyordu**. (Denetim kaydına göre bir önceki, `sleep`
   tabanlı sürüm aynı mutasyonda hızlı ve açıklayıcı kırılıyordu; yani kapıya
   geçişin yan etkisi, determinizmi kazanırken **sonlu sonucu** kaybetmekti.)
   Aynı boşluk her kapıda vardı — üretici görev
   `Event.set()` öncesinde bir assert/exception ile düşerse ana test yine
   sonsuza dek bekliyor, üstelik **asıl hata hiç görünmüyordu**. `pytest.ini`'de
   global timeout olmadığı için koşu kendiliğinden bitmez: CI'da iş ancak
   `timeout-minutes: 30` sınırında, hangi testin astığını söylemeyen bir iptalle
   ölürdü.

   Ölçüldü, tahmin edilmedi: A1 altında eski dosya dış `timeout 60` ile
   öldürüldü (exit 124, 61 sn, sonuç YOK); yeni dosya aynı mutasyonda **0,24 sn**
   içinde açıklayıcı FAILED verdi.

   → Bütün kapılar `_event_bekle` / `_gorev_bekle` / `_gorevleri_bekle`
   yardımcılarına bağlandı (tek sabit `KAPI_TIMEOUT = 12.0` sn; gerekçesi
   dosyanın kendi yorumundadır: `LOCK_TIMEOUT`'un iki katından büyük, soğuk CI
   Postgres'i için geniş, gerçek asılmayı yakalayacak kadar dar). Yardımcı üç
   şeyi birden yapar: (a) süre dolarsa **hangi kapının** açılmadığını söyleyen
   `pytest.fail`; (b) üretici görev kapıyı açmadan düştüyse **asıl exception**
   zincirlenerek yükseltilir (`from hata`) — "kapı açılmadı" gürültüsünün
   arkasına saklanmaz; (c) izlenen üreticilerin hepsi kapıyı açmadan bittiyse
   süre beklenmez, hata anında verilir. Her iki yolda da başlatılmış görevler
   iptal edilip `gather(..., return_exceptions=True)` ile toplanır;
   `TimeoutError` yutulup akışa devam **edilmez** (yutulan timeout, yarışı hiç
   kurmamış bir testi yeşil gösterirdi). Görevler `yaris` fixture'ında
   kayıtlıdır: test kırmızı bitse de pending görev ve "Task was destroyed"
   uyarısı kalmaz (üç tekrarlı koşuda 0 uyarı).

**Kural olarak yazılıyor:** sözleşmenin "koşmayan test kırmızıdır" maddesinin
kardeşi, **"sonuçlanmayan test de kırmızıdır"**dır. Bir test yalnız doğru şeyi
ölçmek zorunda değil, **sonlu sürede sonuç üretmek** zorundadır. Asılan test,
kırmızı testten daha kötüdür: hiçbir şey söylemez, CI'yı tavana kadar meşgul
eder ve mutasyon provasını sessizce anlamsızlaştırır.

## 9d. Mutasyon provası sonuçları

Sürücü disiplini `backend/scripts/mutation_drill.py` ile aynıdır: dosya baytları
diske yedeklenir (`git checkout --` KULLANILMAZ), her mutasyondan sonra dosya
SHA-256'sı ve `git status --porcelain` başlangıçla karşılaştırılır. Çalışma ağacı
her provada byte düzeyinde başlangıç durumuna döndü.

**Sonuç dürüstçe: ilk turda 9/10 yakalandı, 1 mutasyon (A2) KAÇTI.** İkinci
turda (bağımsız denetim) ilgili nöbetçi güçlendirildi ve A2 yakalanır hâle
geldi → **10/10**. Ayrıntı A2 satırının altındadır; "10/10" ilk turda da
geçerliymiş gibi okunmamalıdır.

| # | Mutasyon | Kırdığı nöbetçi |
|---|---|---|
| A1 | `cancel()`'daki `payment_service.refund` çağrısı no-op | taraf iptali iadesi + eşzamanlı iptal (**süreli ve açıklayıcı** kırmızı — bkz. A1 notu) |
| A2 | `complete()`'in atomik claim'i sıradan atamaya çevrildi | ⚠️ İLK TURDA YAKALANMADI — aşağıya bakınız |
| A3 | `release()`'in `from_statuses=[HELD]` kısıtı gevşetildi | release iki kez → damga değişmez |
| A4 | `begin_refund()`'daki `released_at` guard'ı silindi | `released_at` dolu HELD satırı claim edilemez |
| A5 | `auto_complete`'ten `end_at <= cutoff` filtresi silindi | gelecekteki ders otomatik tamamlanmaz |
| A6 | Admin iptal ucundan `bookings.manage` izni düşürüldü | izinsiz admin iptal edemez |
| A7 | `perform_refund()` sağlayıcıyı iki kez çağırıyor | tek iade emri nöbetçileri (2 test) |
| A8 | `sync_amount_with_booking`'deki HELD 409'u kaldırıldı | ödenmiş dersin ücreti değiştirilemez |
| A9 | `complete` ucundan `_assert_owner_tutor` düşürüldü | başkasının dersi tamamlanamaz |
| A10 | `create_for_booking`'de komisyon kırılımı sıfırlandı | emanet üretim yolundan gelir |
| A11 | Admin iptal düzeltmesi YALNIZ `api/routers/admin.py` ucuna kondu, `admin_service.cancel_booking` bozuk bırakıldı | servis-katmanı admin nöbetçileri (2 test) |

### A1 — kayıt düzeltmesi: "asar" değil, "süreli ve açıklayıcı kırılır"

İlk kayıtta A1 yalnız "kırdığı nöbetçi" sütunuyla geçiyordu. Dar denetim turu
bunun **eksik bir kayıt** olduğunu gösterdi: kapı tabanlı kuruluma geçildikten
sonra A1 altında hedef nöbetçiler kırılmıyor, **asılıyordu** (bkz. §9c/6). Kayıt
artık gerçeği söylüyor ve ölçümle birlikte durur:

| Test hâli | A1 mutasyonu altında |
|---|---|
| Sınırsız `await event.wait()` | **ASILDI** — dış `timeout 60` ile öldürüldü (exit 124), sonuç yok |
| Sonlu kapı (`_event_bekle`) | **FAILED, 0,24 sn** — "KAPI AÇILMADI — refund sağlayıcı kapısına hiç ulaşılmadı: iptal yolu iade emri üretmiyor (emanetteki para sahipsiz kalır). Üretici görevlerin hepsi (iptal-0, iptal-1) kapıyı hiç açmadan bitti." |

Aynı mutasyon altında dosyanın tamamı (7 node) 11,5 sn'de sonuçlandı: 6 kırmızı
(4 üretim kırmızısı + A1'in düşürdüğü 2 nöbetçi) + 1 yeşil, asılma yok, pending
görev uyarısı yok. Mutasyon geri alındı; `services/booking_service.py` SHA-256'sı
başlangıçla birebir aynı.

Ayrıca **kurulum hatası provası** koşuldu (üretim kodu bozulmadan): kaybeden
görevin `Event.set()` ÖNCESİNDEKİ kurulum assert'i bilinçli olarak ters
çevrildi. Ana test asılmadı; hata `AssertionError: KAPI AÇILMADI çünkü üretici
görev 'kaybeden-tamamlama' daha önce düştü — ...` olarak, **asıl assert'i
"direct cause" zinciriyle göstererek** düştü.

### A2 — ilk turda neden kaçtı, nasıl kapatıldı

İlk turda A2'nin "yakalandı" sayılması bir **ölçüm hatasıydı**. Mutasyon
uygulanınca hedef nöbetçi
(`test_YESIL_iki_esZamanli_tamamlama_TEK_release_uretir`) kırılmıyordu, çünkü o
test `asyncio.gather` ile iki `complete` başlatıyor ve **yarış hiç
doğmuyordu**: ikinci görev satırı ilk görev commit ettikten sonra okuyor,
bellekteki `_transition` zaten 409 veriyor ve mutasyon görünmez kalıyordu. Kısaca
"eski bozuk kod da testi geçiyordu" (kök CLAUDE.md §E).

Bağımsız denetim turunda prova yeniden koşuldu ve şu ikisi **aynı mutasyon
altında** ölçüldü:

| Test hâli | A2 mutasyonu altında |
|---|---|
| Eski (`gather`, kapısız) | **PASSED** — yalancı yeşil |
| Yeni (bayat okuma + `okundu`/kapı event'leri) | **FAILED** — "KAYIP GÜNCELLEME: bayat ACCEPTED okumasıyla gelen ikinci tamamlama başarıyla yazdı" |

Sonra mutasyon geri alındı (`services/booking_service.py` SHA-256 başlangıçla
birebir aynı) ve temiz üretim kodunda yeni test **geçti**. Kurulumun ayrıntısı
§9c/4 ve testin kendi docstring'indedir.

İP-1b önerisi: bu mutasyonlar `backend/scripts/mutation_drill.py` kataloğuna
M9+ olarak eklenmelidir — katalog bugün tamamen envanter/stok odaklıdır ve para
yolunda tanımlı tek bir mutasyon yoktur.

## 9e. Açık P2 notları (bu commit'te bilinçli olarak BÜYÜTÜLMEDİ)

Dar denetim turunda görülen, ama bu küçük commit'in kapsamına alınmayan üç
nokta. Hiçbiri para invariant'ını korumasız bırakmıyor; hepsi "daha iyi
olabilir" sınıfında ve ayrı kararı hak ediyor:

1. **Bildirim testi para invariant'ını kardeş testlere bırakıyor.**
   `test_YESIL_iki_esZamanli_tamamlama_TEK_release_uretir` bildirim sayısını
   yan etki yokluğu olarak ölçüyor; parayı ölçen asıl iddia aynı dosyadaki ve
   `test_money_pg.py`'deki kardeş nöbetçilerde. Tek bir testin her şeyi
   ölçmesi gerekmez, ama bu bağımlılık yazılı olmadan görünmüyordu — burada
   yazılıdır.
2. **Dispute ↔ auto-complete testi sıra-bağımsız `gather` kullanıyor.** Bu
   bilinçlidir (invariant zaman sıralamasından bağımsızdır: "ihtilaflı ders
   serbest bırakılmış olamaz"), ama diğer yarışların bayat-okuma kurulumu kadar
   güçlü bir interleaving kurmuyor. İP-1b'de kapı tabanlı kuruluma çevrilebilir.
3. **Proje genelinde global pytest timeout politikası yok** (zemin borcu).
   `backend/pytest.ini` bir `timeout` tanımlamaz ve `pytest-timeout` bağımlılık
   listesinde değildir; yani asılan HERHANGİ bir test CI'yı üst sınıra kadar
   meşgul eder. Bu commit sorunu **kaynağında** çözdü (kapılar sonlu), fakat
   ağ/DB/dış servis kaynaklı asılmalar için genel bir emniyet ağı hâlâ yok.
   Aynı desendeki sınırsız beklemeler başka dosyalarda da duruyor:
   `tests/integration/test_inventory_closing_pg.py` ve
   `test_stock_concurrency_pg.py`. Bütün paketin pytest.ini davranışını
   değiştirmek bu commit'in kapsamı değildir; ayrı bir zemin paketi olarak
   önerilir.

## 10. Açık ürün kararları

Bunlar İP-1b'de (üretim uygulaması) karara bağlanmalıdır. Kırmızı testler
**karar gerektirmeyen** çekirdeği ölçer; karara bağlı olanlar aşağıda açıkça
işaretlidir.

1. **Reschedule sonrası reject'in para politikası.** Emanetteki para iade mi
   edilmeli (öneri: evet, tam iade — ders hiç yapılmadı ve reddeden taraf
   eğitmendir), yoksa ceza/kesinti mi uygulanmalı? Kırmızı test yalnız
   "**HELD sahipsiz kalamaz**" invariant'ını ölçer; kesinti oranına bağlı
   değildir.
2. **Admin'in COMPLETED/RELEASED bir dersi iptali.** Öneri: **409 ile
   reddedilmeli** — `released_at` terminal tasarlanmıştır ve kısmi geri alma
   yolu yoktur. Alternatif (iptal + elle mutabakat kaydı) settlement ekranı
   gerektirir ve kapsam dışıdır.
   **Bu kararı ölçen testler:** `test_admin_TAMAMLANMIS_dersi_iptal_EDEMEZ`
   (HTTP) ve `test_servis_katmani_admin_TAMAMLANMIS_dersi_iptal_EDEMEZ`
   (servis). Karar değişirse bu iki beklenti ve bu madde **birlikte** güncellenir;
   testi tek başına gevşetmek kararı belgesiz bırakır.
3. **`complete` için meşru zaman eşiği.** Öneri: `start_at`'ten önce yasak.
   `end_at` mi yoksa `start_at` mi eşik olmalı — eğitmenin ders ortasında
   tamamlaması meşru sayılacaksa `start_at` doğrudur. Kırmızı test `start_at`
   eşiğini varsayar; karar değişirse test tek satırda güncellenir.
4. **Dispute açıkken auto-complete.** Öneri: auto-complete **atlanır**, para
   HELD'de bekler, admin çözer. Süre sınırı (dispute sonsuza dek parayı
   kilitlemesin) ayrı bir karardır ve kapsam dışıdır.
5. **Öğrenci/eğitmenin dispute açabilmesi.** Bugün yalnız admin işaretleyebilir;
   kullanıcı tarafında dispute ucu yoktur. Kapsam dışı, not edildi.
6. **Booking'de 403 vs 404 (IDOR).** Teslimat tarafı 404 seçmiş, booking 403
   veriyor. Tutarlılık kararı gerekiyor; İP-3 kapsamı.

---

## 11. Kapsam dışı (bilinçli)

Bu checkpoint'e **dahil edilmedi**; her biri ayrı pakettir:

- iyzico Pazaryeri / submerchant gerçek entegrasyonu (PK-2)
- Settlement mutabakat ekranı
- Vergi / stopaj / gider pusulası
- Kütüphane exam / study kontenjanı ve escrow'u (ayrı `EXAM_SPEC` / `STUDY_SPEC`)
- Mağaza `Order` / `OrderReturn` iadeleri (`ORDER_SPEC` / `RETURN_SPEC`)
- TB-3 mağaza stok / kupon telafisi
- İP-3 güvenlik / KVKK üretim düzeltmeleri
- Frontend'in tamamı (yalnız admin iptalinin HTTP kablolaması test edilir)
- `accept` ucunun onaylı eğitmen istememesi (ayrı not, §4)
- `iyzico/callback` ucunun anonim ve rate-limit'siz olması (İP-3)

---

## 12. Üretim uygulaması — kapanış kaydı

> Bu bölüm, §1-§11'in tanımladığı sözleşmenin **gerçekten yazıldığı** turun
> kaydıdır. §1-§9 tarihsel kayıttır ve geriye dönük düzeltilmemiştir; aşağıdaki
> her madde hangi kırmızının nasıl kapandığını gösterir.

### 12.1 Zemin

| | |
|---|---|
| Kırmızı checkpoint (son) | `b92f6f2` — 60 node / 26 bilinçli kırmızı / 34 yeşil |
| Güncel-main merge | `220e46e` (parents `b92f6f2` + `59afdac`) |
| Üretim commit'leri | `aaa61a2` · `613f467` · `c45d3f6` |
| Mutasyon kataloğu | `48dd1ad` |
| Test dosyaları | **değiştirilmedi** — silme, yeniden adlandırma, `skip`/`xfail`, assertion gevşetme YOK |

### 12.2 Altı kırmızı grubun kapanışı

**P0-1 — Reschedule → reject emanet kilidi.** `reject` artık atomik claim
kullanır ve emanetteki parayı **taraf iptaliyle aynı** `escrow.refund_escrow`
yolundan tam iade eder (paralel bir iade uygulaması yazılmadı). Karar: reschedule
sonrası reddedilen ödenmiş ders için güvenli varsayılan **tam iadedir** — ders
hiç yapılmadı ve reddeden taraf eğitmendir. Tekrarlanan `reject` claim'i
kaybeder → 409; ikinci sağlayıcı çağrısı ve ikinci para bildirimi oluşmaz.

**P0-2 — Admin booking iptali.** `admin_service.cancel_booking` tek satırla
`booking_service.cancel_by_admin`'e devreder. Ortak yol atomik claim + aynı iade
yolu + **her iki tarafa** bildirim uygular. Hakedişi dağıtılmış ders üç ölçütün
herhangi biriyle **409** alır: booking `COMPLETED`, ödeme `RELEASED`, ya da
`released_at` dolu (kısmi/bozuk satır hâli). Ters hakediş / reverse payout bu
paketin kapsamı dışındadır (§10/2). Audit yazımı router'da kaldığı için tek satır
üretir; 409'da hiç yazılmaz.

**P0-3 — Ders başlamadan tamamlama.** `_assert_completable` eşiği **`start_at`**
alır (§10/3): `now < start_at` iken `complete` 409 verir, booking `ACCEPTED`
kalır, `release` çağrılmaz, `released_at` yazılmaz, payout defterine hiçbir şey
düşmez. Karşılaştırma timezone-aware'dir (kolon `timestamptz`; naive değer
gelirse UTC varsayılır). Eşik geçilince (`now >= start_at`) meşru tamamlama
çalışmaya devam eder.

**P0-4 — Dispute açıkken auto-complete/release.** İhtilaf koşulu **tek
kaynaktan** gelir (`_IHTILAFSIZ`) ve iki yerde birden uygulanır: auto-complete
sorgusunda (gereksiz satır okunmasın) ve `COMPLETED` claim'inin `WHERE`'inde
(karar satırın kendisinde verilsin). Sorgu filtresi tek başına güvenlik
sayılmaz: sorgu ile claim arasında ihtilaf açılırsa claim 0 satır günceller ve
tamamlama kazanamaz. Simetrik olarak `toggle_dispute` **açma** yönünde koşullu
UPDATE'tir — tamamlanmış/iptal edilmiş derste ihtilaf açılamaz (409). İki
koşullu UPDATE aynı `bookings` satırında yarıştığı için READ COMMITTED'da
serileşir; **"ihtilaflı ders + serbest bırakılmış para" kombinasyonu hiçbir
sıralamada oluşamaz.** İhtilaf kapatıldıktan sonra geçmiş ders yeniden
tamamlanabilir (kilit kalıcı değildir).

**P0-5 — Sahipsiz HELD emanet.** Yeni
`escrow_reconciler.reconcile_orphaned_escrow`: terminal derse
(REJECTED/CANCELLED/soft-deleted) bağlı `HELD` ödeme, karantina penceresi
dolduktan sonra ERROR loguyla görünür kılınır ve aynı `escrow.refund_escrow`
yolundan **otomatik tam iade** edilir (§8/c kararı). `main.py` arka plan escrow
döngüsüne bağlandı; mevcut `reconcile_refunding` ve `reconcile_stale_checkouts`
çağrıları yerinde durur ve **İP-2b Order kolu (`_order_telafisi`, kayıt-başı
savepoint izolasyonu) değiştirilmedi** — yeni kol yalnız `Payment` × `Booking`
join'i üzerinden çalışır, Order sorgularını filtrelemez.

**P0-6 — accept/reject yarışları.** `accept` ve `reject` artık koşulsuz ORM
ataması değil `_claim_transition` kullanır. Kaybeden taraf 409 alır ve **hiçbir**
yan etki üretmez: ödeme yükümlülüğü doğmaz, iade emri gitmez, bildirim yazılmaz.
Claim başarısızlığında bayat ORM nesnesi kullanılmaz (`db.refresh` ile taze durum
okunur, hata mesajı ondan üretilir).

### 12.3 Para davranışı — kesin kurallar

- **Tek sahip, tek para hareketi.** Her para geçişi koşullu UPDATE ile claim
  edilir; claim'i kaybeden sağlayıcıya hiçbir emir göndermez.
- **Sağlayıcı `False` veya exception.** `REFUNDED` **yalnız** sağlayıcı pozitif
  döndüğünde yazılır. Reddedilirse kayıt `REFUNDING`'de kalır (`HELD`'e dönüş
  yoktur) — güvenli yeniden deneme durumudur ve `reconcile_refunding` sonraki
  turda devralır. Exception hâlinde de aynı: `begin_refund` claim'i commit'li
  olduğu için kayıt `REFUNDING`'dedir. Yalan "iade edildi" bildirimi ya da audit
  oluşmaz — bildirim `finalize_refund` içinden, yani ancak iade kesinleşince
  gönderilir.
- **İki worker.** Sahipsiz emanet iadesinde tek kazanan `begin_refund`'ın
  koşullu UPDATE'idir; ikinci worker `not_claimed` alır ve sağlayıcıya dokunmaz —
  doğruluk advisory lock'a değil **claim'e** yaslanır.
- **Batch izolasyonu.** Sahipsiz emanet döngüsünde her kayıt kendi
  `try/except`'indedir (İP-2b R11 disiplini): tek kaydın hatası partinin kalanını
  öldürmez, hata `logger.exception` ile görünür kalır, oturum kullanılabilir
  kalır ve kayıt sonraki turda yeniden ele alınır.
- **Tekrar güvenliği.** Başarıyla iade edilmiş kayıt sonraki turlarda seçilmez
  (artık `HELD` değildir). `released_at` dolu / `RELEASED` kayıt taramaya hiç
  girmez; ikinci savunma hattı `begin_refund`'ın kendi guard'ıdır.

### 12.4 M9-M20 mutasyon provası — GERÇEK sonuçlar

Sürücü: `backend/scripts/mutation_drill.py` (bayt yedeği + geri yazma;
`git checkout --` KULLANILMAZ). Her mutasyondan sonra dosya SHA-256'sı ve
`git status --porcelain` başlangıçla karşılaştırıldı; **hepsi birebir aynı
döndü**, çalışma ağacında mutasyon artığı kalmadı.

| # | Mutasyon | Sonuç | Kırılan nöbetçi(ler) |
|---|---|---|---|
| M9 | red yolundan emanet iadesi kaldırıldı | ÖLDÜ | reschedule→reject: sahipsiz emanet · tam bir iade · idempotency · öğrenci bildirimi (4) |
| M10 | admin iptali ortak yolu atlıyor | ÖLDÜ | admin cancel: emanet iadesi · tamamlanmış ders 409 · bildirim · idempotency + **servis katmanı 2 nöbetçi** (6) |
| M11 | complete'in `start_at` eşiği kaldırıldı | ÖLDÜ | gelecekteki ders · hakediş · sınır (1 dk) (3) |
| M12 | ihtilaf koşulu kaldırıldı | ÖLDÜ | otomatik tamamlanmaz · emanet açılmaz · ihtilaf kalkınca devam (3) |
| M13 | atomik claim → koşulsuz ORM ataması (accept) | ÖLDÜ | accept ↔ iptal yarışında kayıp güncelleme (1) |
| M14 | sahipsiz emanet iadesi claim'siz | ÖLDÜ | iki worker tek claim · idempotency · yalan kesinleşme · mutabakat görünürlüğü (4) |
| M15 | sağlayıcı reddettiği hâlde `REFUNDED` | ÖLDÜ | yalan kesinleşme · sarkan REFUNDING devralma (2) |
| M16 | `release`'in HELD kısıtı gevşetildi | ÖLDÜ | release iki kez → damga değişmez (1) |
| M17 | `begin_refund`'ın `released_at` guard'ı silindi | ÖLDÜ | `released_at` dolu HELD satırı claim edilemez (1) |
| M18 | sahipsiz emanet karantinası kaldırıldı | ÖLDÜ | taze sahipsiz emanete dokunulmaz (1) |
| M19 | ihtilaf açma koşulsuz | ÖLDÜ | dispute ↔ auto-complete yarışı (1) |
| M20 | sahipsiz emanet taraması ölü | ÖLDÜ | P0-5'in beş nöbetçisi (5) |

**12/12 yakalandı.** Kaçan mutasyon yoktur; bu turda "yakalanmadı" kaydı ve buna
bağlı yeni regresyon testi gerekmedi. Kabul testlerine tek satır eklenmedi.

### 12.5 Kalan P2 borçlar (bilinçli, kapsam dışı)

1. **Dispute ↔ auto-complete testi sıra-bağımsız `gather` kullanıyor** (§9e/2).
   M19 bu kurulumda öldü, ama hangi tarafın önce başladığı testin kendi
   kurulumundan değil olay döngüsünden gelir; kapı tabanlı bir kurulum ölçümü
   sıralamadan tamamen bağımsız kılardı. Ölçülen invariant ("ihtilaflı + serbest
   bırakılmış birlikte olamaz") her iki sırada da doğrudur.
2. **Sahipsiz emanet döngüsünün batch izolasyonu davranışsal testle
   ölçülmüyor.** Kod İP-2b R11 desenini uygular ve M14/M20 taramanın kendisini
   nöbetçiler; ama "bir kaydın hatası partiyi öldürmez" iddiasının kendi testi
   yoktur (çok kayıtlı + seçici patlayan bir sağlayıcı kurulumu gerekir).
3. **Global pytest timeout politikası yok** (§9e/3) — değişmedi.
4. **`accept` ucu onaylı eğitmen istemiyor** (§11) — değişmedi.
5. **Booking'de 403 ↔ teslimatta 404 tutarsızlığı** (§10/6) — İP-3 kapsamı.
