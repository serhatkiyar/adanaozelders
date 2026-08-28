# Eğitmen İlanı Öne Çıkarma — Sözleşme ve Test Matrisi

> Durum: **sözleşme + kırmızı test matrisi** (üretim kodu yazılmadı).
> Dal: `feat/ilan-one-cikarma`. Zemin: `2f91ffc`.
>
> Kod ile belge çelişirse **belge kazanır**; davranış bilinçli değişiyorsa önce
> burası güncellenir.

---

## 1. Ne satılıyor

Eğitmen, ilanının arama sonuçlarında ayrı bir blokta **"Reklam" etiketiyle**
görünmesi için süreli bir paket satın alır (7 / 15 / 30 gün). Bu bir **reklam
alanı satışıdır**: platformun kendi hizmeti, kendi cirosu. Üçüncü kişi adına
tahsilat yoktur, dolayısıyla alt üye işyeri (iyzico Pazaryeri) gerektirmez —
`services/payment_gates.py` docstring'indeki ayrımın "mağaza" tarafındadır.

## 2. Mevcut akış (koddan çıkarıldı)

```
GET /tutors/search                                      routers/tutors.py:25
  └─ search_service.search_tutors                       search_service.py:101
       ├─ sert filtreler: status=APPROVED, is_active,
       │  deleted_at IS NULL (+ subject/district/mode/…) search_service.py:132
       └─ ORDER BY bayesian_score DESC, …                search_service.py:229-241
              bayesian_score = (rating_sum + c·prior) / (rating_count + c)
                                                        ranking.py:16-20
```

Aynı sert filtreler `price_histogram`'da İKİNCİ KEZ yazılmış durumda
(`search_service.py:262-352`); kodun kendi yorumu (`:316-317`) ikisinin senkron
kalması gerektiğini söylüyor. Öne çıkarma sorgusu **üçüncü kopyayı üretmez** —
filtreler ortak bir yardımcıya çıkarılır.

Para tarafında yeniden kullanılan hazır mekanizmalar:

| İhtiyaç | Mekanizma | Dosya |
|---|---|---|
| Kol kapısı | `PaymentBranch` + DB bayrağı | `services/payment_gates.py`, `core/flags.py` |
| Atomik PAID geçişi | `escrow.claim` | `services/escrow.py:190` |
| İki fazlı iade | `EscrowSpec` + `begin/perform_refund` | `services/escrow.py:291-410` |
| Kayıp callback ağı | `reconcile_stale_checkouts` | `services/escrow_reconciler.py:427` |
| Süreli hak | zaman damgası + SQL yüklemi | `services/library_capacity.py:74-99` |

## 3. Sözleşme

### Görünürlük

**S-1 — Organik sıralama satın alınamaz.** `search_tutors`'ın `ORDER BY`
ifadesi promosyon tablosuna hiçbir koşulda bakmaz. Öne çıkarma yalnız ayrı bir
uçtan (`GET /tutors/featured`) ve ayrı bir bloktan gösterilir.

**S-2 — Aktiflik bir yüklemdir, zamanlanmış iş değil.**

```
aktif ⇔ payment_status = PAID
      ∧ cancelled_at IS NULL
      ∧ starts_at <= now() < ends_at
```

Süre dolduğunda ilan **sorgu düzeyinde** düşer. "Süpürge çalışmadı, ilan bedava
üstte kaldı" arıza sınıfı tasarım gereği yoktur.

**S-3 — Blok en fazla 3 karttır** ve arama ile **birebir aynı sert filtreleri**
uygular. Eşleşen aktif promosyon yoksa blok hiç çizilmez. Aday sayısı 3'ü
aşarsa seçim rastgeledir; **gösterim garantisi verilmez** ve bu, hizmet
koşullarında yazılıdır.

**S-4 — Her öne çıkan kart "Reklam" etiketi taşır.** Etiket metni yönetmelikteki
karşılıktır; "Sponsorlu" veya "Öne çıkan" tek başına yeterli değildir. Etiketsiz
öne çıkan kart üretmek bir nöbetçi testiyle engellenir.

**S-5 — Blok yalnız ilk sayfada çizilir** ve bloktaki eğitmenler o sayfanın
organik listesinden düşürülür (aynı kart iki kez görünmez).

### Satın alma

**S-6 — Fiyat sunucuda belirlenir.** Katalog `core/promotion_packages.py`
içindedir; istemciden gelen herhangi bir tutar yok sayılır. Satın alma anındaki
fiyat kayda **snapshot** olarak yazılır; katalog sonradan değişse bile geçmiş
kayıt değişmez.

**S-7 — Yalnız `APPROVED` eğitmen satın alabilir.** Onaylanmamış ilan aramada
zaten görünmez; parası boşa gider. Diğer durumlarda 409.

**S-8 — Kol kapalıyken satın alma 503 `PAYMENT_BRANCH_CLOSED` verir.**
Varsayılan **kapalıdır**; kod merge edilse bile operatör açmadan para akmaz.

**S-9 — Üst üste alım kuyruğa girer, reddedilmez.** Aktif promosyonu olan
eğitmen yeni paket alırsa süre **eklenir**: `starts_at = aktif kaydın ends_at`.
Aynı anda en fazla bir aktif + bir kuyrukta kayıt bulunabilir; üçüncüsü 409.

> Gerekçe: 7 günlüğün 3. gününde 30 günlük almak isteyen eğitmene 409 vermek hem
> kötü bir deneyim hem gelir kaybıdır. Kuyruk, çakışan iki aktif kayıt sorununu
> da kökten çözer.

### Para

**S-10 — Çift callback tek PAID üretir.** Geçiş `escrow.claim` ile atomiktir;
ikinci callback hiçbir yan etki üretmez ve ikinci kez süre eklemez.

**S-11 — Tahsil edilen tutar kayıtla uyuşmazsa kesinleştirme yoktur.**
`paid_price != price` ise kayıt PAID olmaz ve tahsilat aynen iade edilir.

**S-12 — Ölü kayda gelen tahsilat iade edilir.** İptal edilmiş veya bulunamayan
bir promosyona ödeme gelirse `escrow.refund_unexpected_charge` çalışır.

**S-13 — Kayıp callback yakalanır.** `reconcile_stale_checkouts` promosyon
tablosunu da tarar; taramaya eklenmemiş bir para tablosu sessizce sarkar.

**S-14 — İade yalnız admin işidir.** Eğitmen satın aldığı paketi iptal edemez
(hizmet anında ifa edilir; cayma hakkı istisnası satın alma ekranında ön onayla
alınır). Admin iptali `cancelled_at` damgalar — ilan **o anda** bloktan düşer —
ve iki fazlı iadeyi başlatır.

**S-15 — Kapalı kolda tamamlanan tahsilat sessiz kalmaz.** Tamamlama yolunda
`payment_gates.warn_if_closed_completion` çağrılır.

---

## 4. Test matrisi

`✗` = bu belge yazıldığında kırmızı (üretim kodu yok).

### Backend — `backend/tests/test_tutor_promotion_service.py`

| # | Kural | Test | Durum |
|---|---|---|---|
| T-1 | S-6 | İstemcinin gönderdiği fiyat alanı yok sayılır; kayda katalog fiyatı yazılır | ✗ |
| T-2 | S-6 | Katalog fiyatı değişse bile geçmiş kaydın `price`'ı değişmez | ✗ |
| T-3 | S-7 | `DRAFT`/`PENDING_APPROVAL`/`SUSPENDED` eğitmen satın alamaz (409) | ✗ |
| T-4 | S-8 | Bayrak kapalıyken `POST` 503 + `PAYMENT_BRANCH_CLOSED` | ✗ |
| T-5 | S-8 | Kol `BRANCH_NEEDS_MARKETPLACE=False` — iyzico ile de açılabilir | ✗ |
| T-6 | S-9 | Aktif promosyon varken alınan paket `starts_at = aktif.ends_at` ile kuyruğa girer | ✗ |
| T-7 | S-9 | Aktif + kuyrukta kayıt varken üçüncü alım 409 | ✗ |
| T-8 | S-10 | Aynı token ile iki kez `complete_checkout` → tek PAID, süre bir kez eklenir | ✗ |
| T-9 | S-11 | `paid_price` kayıttan farklıysa PAID olmaz, iade çağrılır | ✗ |
| T-10 | S-12 | İptal edilmiş kayda gelen tahsilat iade edilir | ✗ |
| T-11 | S-2 | `ends_at` geçmişte olan kayıt aktif sayılmaz | ✗ |
| T-12 | S-2 | `starts_at` gelecekte olan (kuyruktaki) kayıt aktif sayılmaz | ✗ |
| T-13 | S-14 | Eğitmen kendi promosyonunu iptal edemez (403/405) | ✗ |
| T-14 | S-14 | Admin iptali `cancelled_at` yazar ve kayıt anında aktiflikten çıkar | ✗ |

### Backend — `backend/tests/test_tutor_featured.py`

| # | Kural | Test | Durum |
|---|---|---|---|
| T-15 | S-3 | 5 aktif promosyon varken uç en fazla 3 döner | ✗ |
| T-16 | S-3 | `subject` filtresi verildiğinde yalnız o dersi veren öne çıkanlar döner | ✗ |
| T-17 | S-3 | `SUSPENDED` olmuş ama promosyonu süren eğitmen blokta ÇIKMAZ | ✗ |
| T-18 | S-3 | Eşleşme yoksa boş liste (blok çizilmez) | ✗ |
| T-19 | S-1 | Aktif promosyon `search_tutors` sonuç **sırasını** değiştirmez | ✗ |
| T-20 | S-1 | `_apply_tutor_filters` çıkarımı sonrası arama ve histogram davranışı aynı | ✗ |

### Backend — kayıt defteri nöbetçileri

| # | Kural | Test | Durum |
|---|---|---|---|
| T-21 | — | `promotions.view` / `promotions.manage` izin kataloğunda ve DB'de | ✗ |
| T-22 | S-13 | `reconcile_stale_checkouts` promosyon tablosunu tarar | ✗ |
| T-23 | — | `"promo"` referans türü `_REFERENCE_KINDS` içinde ve callback dallanmasında | ✗ |
| T-24 | — | `PROMOTION_SPEC.lock_class` başka hiçbir spec ile çakışmaz | ✗ |

### Frontend

| # | Kural | Test | Durum |
|---|---|---|---|
| T-25 | S-4 | Öne çıkan blokta çizilen HER kart "Reklam" metnini taşır (nöbetçi) | ✗ |
| T-26 | S-3 | Blok en fazla 3 kart basar | ✗ |
| T-27 | S-5 | 2. sayfada blok çizilmez | ✗ |
| T-28 | S-5 | Blokta görünen eğitmen aynı sayfanın organik listesinde tekrar çizilmez | ✗ |

---

## 5. Bilinçli kapsam dışı

- Kategori/SEO landing sayfaları — ayrı paket
- Abonelik / tekrarlayan ödeme — saklı kart altyapısı yok
- Tıklama veya gösterim başına ücretlendirme, açık artırma
- Fatura kesimi — `INVOICE_ENABLED` kapalı, `build_invoice` yalnız `Order` okuyor
- Öne çıkarma performans paneli (görüntülenme/tıklama istatistiği)

## 6. Açık kalan dış bağımlılıklar

- **Stopaj** (476 sayılı Karar, %15): kesinti sorumluluğu ödeyen taraftadır ve
  GVK 94 kapsamındaki mükelleflere bağlıdır. SMMM teyidi gerekiyor; bu paket
  fatura kesmediği için lansmanı bloklamaz.
- **iyzico faaliyet kapsamı**: başvuruda beyan edilen faaliyet reklam alanı
  satışını kapsıyor mu — teyit edilmeli.
- **Hizmet koşulları metni**: mevcut mesafeli satış ve ön bilgilendirme metinleri
  bu hizmeti kapsamıyor (`core/flags.py:101-116` beyan kapsamını anlatıyor).
