# İP-5 · KDV boru hattı ve fatura — sözleşme

**Dal:** `ip5-kdv-fatura` · **Taban:** `ac35055` (main)
**Kapsam:** P1-7 (KDV yazıcısı yok) · eksik akış 4 (fatura indirilemiyor) ·
TB-15(a) (oversell iadesi merkezi sözleşme dışında) · TB-21 (conftest
`PAYMENT_PROVIDER` sızıntısı)

---

## 0. Bu doküman vergi mevzuatı yorumu DEĞİLDİR

Bu paketteki kod **hiçbir vergi oranı, muafiyet ya da kategori kuralı
içermez**. Oranlar veri olarak girilir (`products.tax_rate`), kargonun oranı
ayardan gelir (`SHIPPING_TAX_RATE`), kod yalnız **aritmetiği** yapar.

Verilen tek "vergi kararı" aritmetiğin nasıl yapılacağıdır: yuvarlama,
dağıtım ve toplama sırası (§4). Hangi orana kimin tabi olduğu **veridir,
kararımız değildir**.

> **Mevzuata uygunluk kullanıcının sorumluluğundadır ve mali müşavir onayı
> gerektirir.** `SHIPPING_TAX_RATE` bilinçli olarak BOŞ bırakılmıştır ve
> fatura ucu (`INVOICE_ENABLED`) üretimde KAPALIDIR; ikisi de o onaydan
> sonra `.env`'den açılacaktır.

---

## 1. Bölüm 2 ölçümü ve denetim raporuyla farklar

Üretim kodu yazılmadan önce ölçüldü. **Rapora değil ölçüme güvenildi.**

| # | Ölçüm | Sonuç |
|---|---|---|
| (a) | `tax_rate` nerede | Model: `models/store.py:228` (Product) + `:684` (OrderItem), `Numeric(5,4)`, `server_default 0`. **Okunuyor:** `order_service.py:338` (satıra snapshot) + `:500-503` (OrderItem'a yazım). **Yazılmıyor:** hiçbir şemada alan yok, CSV başlığı yok, frontend'de 0 eşleşme |
| (b) | `totals_by_rate` | Saf; satırları orana göre gruplayıp `line_tax` toplamını sözlük döner. **Üretim çağıranı YOK** (yalnız `tests/test_tax.py`). Modül `ROUND_HALF_UP` + KDV DAHİL varsayımıyla yazılmış; oran `0 ≤ r < 1` dışındaysa `ValueError` |
| (c) | Order para alanları | `subtotal`, `shipping_fee`, `discount`, `coupon_id/code`, `total`, `refunded_amount`, `refund_reserved`, `refund_requested_at`, `refund_attempts`. **Vergi kırılımı için hiçbir alan yok.** OrderItem'da `tax_rate` + `tax_amount` var |
| (d) | Kupon dağıtımı | `services/returns.py::allocate_discount_shares` — en-büyük-artık, `ROUND_DOWN` taban + kalan kuruşlar `(-artık, index)` sırasıyla. **Bugün YALNIZ iade yolunda** (`order_service.py:2474`). Sipariş oluşturmada indirim satırlara hiç dağıtılmıyor; vergi indirimden BAĞIMSIZ hesaplanıyor |
| (e) | Kargo | `compute_shipping`: dijital-yalnız → 0; `subtotal ≥ 500` → 0; aksi `49,90`. Vergisi **hiç hesaplanmıyor** |
| (f) | Canlı ölçüm (`ceyhandb`, salt okuma) | 6 PHYSICAL ürün `tax_rate=0`, 1 DIGITAL `0.20` (migration `1207ea669b49:60`'ın bir kerelik yazdığı). **28 sipariş kaleminin TAMAMI** `tax_rate=0` **ve** `tax_amount=0`. 22 sipariş (20 PAID) |
| (g) | `OrderInvoiceModal.tsx` | 171 satır, tamamen istemci tarafı. Satıcı `OPERATOR` sabitinden, ödeme satırı `"iyzico ile ödeme"` **SABİT YAZILI**. Matrah/vergi satırı yok |
| (h) | `_out_of_stock_refund` | `begin_refund` → `perform_refund` → `transition_order`. `reserve_refund` YOK, `apply_refunded_amount` YOK, `settle_refunded_order` YOK. Reconciler (`escrow_reconciler.py:356-370`) `Order` dalında **koşulsuz** `settle_refunded_order` çağırıyor |
| (i) | Kök `conftest.py` | `POSTGRES_*`, `JWT_SECRET_KEY`, `AUTO_CREATE_DB` setdefault. `PAYMENT_PROVIDER` **yok**; `.env:97` = `iyzico` |

### Raporla farklar

1. **Boru hattı sanılandan daha ileride.** Rapor P1-7'yi "`tax_rate` yalnız
   model tanımı + okuma yerlerinde" diye yazıyor; doğru, ama `create_order`
   ZATEN `tax.line_tax` çağırıp kalem başına `tax_amount` snapshot'lıyordu.
   Eksik olan (1) orana **değer girilememesi** — bu yüzden her `tax_amount`
   0 çıkıyor, (2) sipariş seviyesinde kırılım, (3) fatura ucu.
   `totals_by_rate`'in çağrılmadığı iddiası **doğru**.
2. **Denetim raporunda olmayan gerçek üretim hatası:**
   `POST /store/admin/products/bulk` **her geçerli CSV'de 500 dönüyordu** —
   servis sözlük döndürürken router `result.created` attribute erişimi
   yapıyordu; `AttributeError` audit satırından önce patlıyordu ve
   `response_model` bunu gizliyordu (hata dönüşümden ÖNCE oluşuyor).
   V-3 node'u ortaya çıkardı, aynı turda düzeltildi.

---

## 2. Ürün kararları (S-1…S-6) — ALINAN CEVAPLAR

Ölçüm bitince durulup soruldu; cevaplar aynen aşağıdadır ve kod bunlara göre
yazılmıştır.

### S-1 · Fiyatlar KDV DAHİL mi HARİÇ mi?

**Cevap: KDV DAHİL (mevcut varsayım korunur).**

> "Bu zaten mevcut varsayım, `services/tax.py` formülü ona göre yazılmış ve
> 22 sipariş o anlamla kayıtlı. Ayrıca Türkiye'de tüketiciye gösterilen
> etiket fiyatı KDV dahil olmak zorunda — yani hariç'e geçmek hem mevcut
> veriyi anlamsızlaştırır hem müşteriye gösterdiğin fiyatı değiştirir."

**Uygulama:** `tax_from_gross(b, r) = b × r / (1 + r)` korundu; matrah
brütten türetiliyor. Sepet/checkout toplamları DEĞİŞMEDİ.

### S-2 · Kupon indirimi vergiyi nasıl etkiler?

**Cevap: İndirim satırlara dağıtılır, vergi indirimli brütten hesaplanır.**

> "Tek bir sağlamlık kriteri var: **Σ(matrah + vergi) = order.total**.
> Seçenek 2 bunu açıkça bozuyor — fatura kendi içinde tutmuyor demek, ki bu
> kabul edilemez. … Ayrıca seçenek 1, İP-2a'nın `allocate_discount_shares`
> desenini yeniden kullanıyor; o desen zaten denetlenmiş ve mutasyon
> nöbetçisi var. **Yeni aritmetik icat etmemek başlı başına değerli.**"

**Uygulama:** `services/tax.py::order_breakdown`, `allocate_discount_shares`
ile satır paylarını hesaplıyor; her satırın vergisi `brüt − pay` üzerinden.

### S-3 · Kargo hangi oranda vergilendirilir?

**Cevap: `core/config.py`'de ayrı ayar (`SHIPPING_TAX_RATE`), `.env`'den.**

> "Bu, kodun vergi kararı vermemesini sağlayan tek seçenek. Diğer üçü kodun
> içine bir mevzuat iddiası gömüyor: 2 ve 3 kargonun oranını sepetten
> *türetiyor* …, 4 ise doğrudan 'kargo muaftır' diyor. Seçenek 1'de değer
> `.env`'den gelir, kararı sen ve mali müşavirin verir, kod sadece hesaplar."

**Ek karar — ayar BOŞken:**

> "Sipariş normal geçer, kargo kırılımı BELİRSİZ saklanır; fatura ucu o
> siparişte 409. … `shipping_tax_rate = NULL` kalıcı ve görünür bir
> 'belirlenmedi' kaydı bırakır. Seçenek 3 tam da reddettiğin sessiz
> varsayımı yapıyor … Seçenek 2 ise bugün çalışan mağazanın bir kısmını
> kapatır, gereksiz."
>
> "Bir ek: `shipping_tax_rate IS NULL` olan sipariş sayısını görebileceğin
> bir yer olsun. Değeri girdikten sonra 'kaç siparişte kırılım eksik kaldı'
> sorusunun cevabı gerekecek."

**Uygulama:** ayar varsayılanı `None`. Kargo > 0 ve ayar boşsa
`shipping_tax_rate`/`shipping_tax_amount` NULL kalır, kırılım EKSİK sayılır.
Sayaç: `GET /store/admin/tax-health`.

### S-4 · Mevcut siparişler geriye dönük hesaplanacak mı?

**Cevap: HAYIR.**

> "Mevcut 22 siparişin vergi kırılımı geriye dönük yazılmamalı. Migration'da
> backfill olmasın; kırılım yalnız yeni siparişlerde saklansın. Tarihsel
> siparişin vergisini sonradan hesaplamak muhasebe açısından risklidir ve o
> 22 sipariş zaten KDV dahil fiyatla kesilmiş."

**Uygulama:** migration YALNIZ kolon ekler. Eski siparişlerde
`tax_breakdown IS NULL` kalır ve fatura ucu onları 409 ile reddeder.

### S-5 · Ürüne oran girilmemişse?

**Cevap: Kaydetme engellenir — oran ZORUNLU.**

> "Sessiz varsayılan uygulatma. Ürün oransız kaydedilemesin, 422 dönsün.
> Sessiz varsayılanın tehlikesi şu — yanlış oranla kaydedilen ürün fark
> edilmeden satılır ve yanlış fatura kesilir; hata ancak muhasebede ortaya
> çıkar. CSV içe aktarmada oransız satır varsa o satır reddedilsin ve hangi
> satırların reddedildiği raporlansın."

**Uygulama:** `ProductCreate`/`SellerProductCreate`'te varsayılan YOK;
`ProductUpdate`'te gönderilmezse mevcut korunur. CSV'de oransız satır
oluşturulmaz ve `errors[]`'ta raporlanır.

### S-6 · Fatura ucu hangi alanları içermeli?

**Cevap: Dördü de (satıcı, alıcı, kırılım, ödeme).**

> "Üçü zaten paketin çıktısı, ama 1 ve 4'ün ayrı bir değeri var: ikisi de
> bugün **frontend'de yanlış**. … Yani fatura şu an gerçeği söylemiyor.
> Sunucuya taşımak bunu düzeltir."
>
> - "Satıcı bilgilerinin eksik alanları (adres, telefon, vergi dairesi)
>   config'den gelsin ve boşsa fatura ucu 409 dönsün. Eksik satıcı
>   bilgisiyle fatura üretmek, kargo oranı boşken üretmekle aynı sınıf hata."
> - "Dijital-yalnız siparişte alıcı adresi yok — o durumda adres alanları boş
>   dönsün, uydurma yapılmasın. … adresi başka yerden türetme."
> - "Ödeme bilgisi `order.provider` + `paid_at`'ten gelsin, sabit metin
>   kalmasın."

**Ek karar — üretimde kapalı:**

> "`INVOICE_ENABLED`, varsayılan False … 404 seçimi de doğru, 403 ucun
> varlığını sızdırır." · "`SHIPPING_TAX_RATE`'in değerini şimdilik boş
> bırakıp mali müşavirinden teyit alana kadar fatura ucunu üretimde
> açmayacaksın. Kod hazır olsun, değer sonra girilsin."

### Türetilmiş karar (sorulmadı, burada kayda geçiyor)

**Ödenmemiş sipariş → 409.** F-5 node'u "S-6 kararına göre davransın"
diyordu; S-6 ödeme bilgisini (sağlayıcı + `paid_at`) faturanın zorunlu
parçası yaptığı için ödemesi olmayan siparişe belge üretilmiyor. Bu bir
akış kararıdır, mevzuat kararı değildir; yanlışsa tek satırlık bir
değişiklikle gevşetilebilir.

---

## 3. Kırmızı matris

Matris **47 node**tur (43 test fonksiyonu; V-4 beş parametreli).
**43'ü kırmızı başladı** — 18 FAILED + 25 setup ERROR. Kanıt commit
`e11343d` öncesi koşumdur; ERROR'lar ayarın/kolonun henüz var olmamasından
doğdu, yani kırmızının meşru biçimi. **4 node yeşil başladı** ve aşağıda
neden oldukları tek tek yazılıdır.

| Grup | Node | Ne ölçer |
|---|---|---|
| **V-1** | oran ürün oluşturmada DB'ye yazılıyor | Şemanın alanı kabul etmesi kanıt DEĞİL: Pydantic bilinmeyen alanı yutar ve uç yine 201 döner → doğrulama HAM SQL ile |
| **V-1b** | oran yanıtta da dönüyor | Dönmezse form her açılışta alanı boş gösterir |
| **V-2 / V-2b** | güncelleme oranı değiştiriyor / gönderilmezse koruyor | Kısmi PATCH'in oranı sessizce sıfırlaması, sessiz varsayılanla aynı sınıf hata |
| **V-3** | CSV `tax_rate` sütununu okuyor | — |
| **V-3b** | CSV'de oransız satır reddediliyor **ve raporlanıyor** | Sessizce %0 yazmak = yanlış faturayla satış |
| **V-4** (5 param) | geçersiz oran → 422 | `"20"` bilinçli listede: yüzde yazan istemci %2000'e kabul edilmemeli |
| **V-4b** | reddedilen istek DEĞİŞİKLİK BIRAKMIYOR | — |
| **V-4c** | oran zorunlu (hiç gönderilmezse 422) | S-5 |
| **V-5** | oran ürün bazında, kategoriden türetilmiyor | Birinin "kitap kategorisi → %0" kısayolu eklemesini yakalar |
| **M-1 / M-1b** | tek oranlı sepet; %0 sepette kırılım YİNE yazılıyor | "Vergi yok" ile "kırılım hesaplanmadı" ayrı şeyler |
| **M-2 / M-2b** | karışık oranlı sepette ayrı satırlar; kalem snapshot'ı | Denetim raporunun kabul şartı |
| **M-3 / M-3b** | kuponlu dağıtım; indirim vergiyi GERÇEKTEN düşürüyor | M-3b, S-2'nin reddedilen ikinci seçeneğini yakalar |
| **M-4 / M-4b / M-4c** | kargo ayardaki oranla; ayar boşsa NULL; kargo 0'da belirsizlik yok | S-3 |
| **M-5 / M-5b** | kuruş artığı deterministik, Σ = `orders.total` | 3×100'e 10 TL indirim: 3×3,33 = 9,99 ≠ 10,00 |
| **M-6** | ürünün oranı değişince sipariş kırılımı DEĞİŞMİYOR (DB **ve fatura**) | Fatura ayağı sonradan eklendi — §9/P4 |
| **M-7 / M-8** | kısmi iade orantılı, tam iade tamamen | — |
| **F-1…F-5** (11 node) | fatura: sahibi 200, yabancı 404, anonim 401, kırılım birebir, kapı davranışı | — |
| **O-1…O-4** (5 node) | TB-15(a): merkezi hat, `refunded_amount`, SALE_CANCEL yok, reconciler | — |
| **T-1a/b/c** | TB-21: conftest sabitliyor, nöbetçi reddediyor, koşum hijyeni | — |

### Yeşil başlayan 4 node — dürüst sınıflandırma

Bunlar **regresyon nöbetçisidir**, kırmızı başlamaları beklenmiyordu:

| Node | Neden yeşil başladı |
|---|---|
| **O-3** | Mevcut kodda *kazara* doğru: `_out_of_stock_refund` telafi kancasını hiç çağırmadığı için `_restock` da koşmuyordu. Aynı sözleşmenin gerçek riski **O-4**'tedir (reconciler devralınca) ve O-4 KIRMIZI başladı. Gücünü mutasyon P8'den alır |
| **O-4b** | Gerçek satışın iptalinde stoğun HÂLÂ döndüğünü ölçer. Bu test olmadan O-3'ün düzeltmesi bütün iptal yolunun restock'unu sessizce kapatabilirdi |
| **V-2b** | Kısmi PATCH'in oranı korumasını ölçer; alan yokken de doğruydu |
| **T-1c** | Koşum hijyeni; zayıf node olduğu kabul edilir |

### Düzeltilen yalancı yeşil

**T-1b ilk yazımda YALANCI YEŞİLDİ.** Alt süreçte *başka bir testin*
düşmesi de sıfırdan farklı çıkış kodu üretiyordu; nöbetçi hiç yokken bile
geçiyordu. Düzeltme: nöbetçiye benzersiz işaret (`TB-21`) eklendi ve test
artık çıkış koduna DEĞİL, işarete + "hiçbir test koşmadı"ya bakıyor.

---

## 4. Vergi aritmetiği sözleşmesi

Tek yuvarlama standardı **`ROUND_HALF_UP`** (projenin para standardı,
İP-2a/M5). Sıra bağlayıcıdır:

```
1. satır brütü   = quantize(unit_price × quantity)
2. paylar        = returns.allocate_discount_shares(brütler, discount)
                   (en-büyük-artık; Σpay = min(discount, Σbrüt) — HER ZAMAN)
3. satır vergisi = tax_from_gross(brüt − pay, oran)     # v = b×r/(1+r)
4. satır matrahı = (brüt − pay) − vergi                 # TÜRETİLİR
5. kargo         = aynı 3-4, oran = SHIPPING_TAX_RATE
6. kırılım       = oran anahtarında toplanır; anahtar 4 basamak ("0.2000")
7. net_total     = Σ matrah ; tax_total = Σ vergi
```

**Neden bu sıra:**

- **Adım 2 tek kez.** Payları satır satır orantılı yuvarlamak Σ'yı bozar
  (3×100 TL + 20 TL kupon → 3 × 6,67 = 20,01). İP-2a bu kusuru İP2A-14
  olarak kaydetmişti; **aynı fonksiyon** yeniden kullanıldı, yeni desen
  icat edilmedi. Böylece bir siparişin **satışında ve iadesinde** aynı
  kuruş üretiliyor.
- **Adım 4 çıkarma, yuvarlama değil.** Matrah bağımsız yuvarlansaydı ikinci
  bir kuruş artığı doğar ve bir "artık düzeltmesi" adımı gerekirdi.
- **Anahtar 4 basamak sabit.** `"0.2"` ve `"0.20"` aynı oranın iki anahtarı
  olsaydı kırılımda aynı oran İKİ satır görünebilirdi.

**Değişmez:** kırılım tamsa
`net_total + tax_total == subtotal − discount + shipping == orders.total`.
Her M node'u bunu `_toplamlar_tutuyor` ile ayrıca doğrular.

### Değer bazlı provalar (§8)

| Senaryo | Beklenen | Node |
|---|---|---|
| %0 kitap 3×100 + %20 kırtasiye 3×120 | matrah 300+300, vergi 0+60, Σ = 660 | M-2 |
| Aynı sepet + 110 TL kupon | paylar 50/60 → matrah 250+250, vergi 0+50, Σ = 550 | M-3 |
| 120×5 kırtasiye ± 120 TL kupon | vergi 100,00 → 80,00 | M-3b |
| Kargolu (49,90 @ %20) | kargo vergisi 8,32 (`ROUND_HALF_UP`) | M-4 |
| 3 satır × 2 adet + 10 TL kupon | Σ(matrah+vergi) = 590,00 tam | M-5 |
| 33,33 / 66,67 / 99,99 ×3 + %7 kupon | Σ = `orders.total` tam | M-5b |
| Oranı sonradan değişen ürün | kırılım SABİT (DB + fatura) | M-6 |
| Kısmi iade (1 kırtasiye) | iade vergisi 20,00 / matrah 100,00 | M-7 |
| Tam iade | iade vergisi = `tax_total` | M-8 |

> Buradaki oranlar (%0 / %20) **test verisidir**; koda gömülü değildir,
> ürünün `tax_rate` alanından gelir.

---

## 5. Saklanan alanlar ve neden anlık hesaplanmadığı

`orders` tablosuna beş kolon:

| Kolon | Tip | Anlamı |
|---|---|---|
| `net_total` | `Numeric(10,2)` NULL | Matrah toplamı |
| `tax_total` | `Numeric(10,2)` NULL | Vergi toplamı |
| `tax_breakdown` | `JSONB` NULL | `[{"rate","base","tax"}]`, tutarlar **METİN** |
| `shipping_tax_rate` | `Numeric(5,4)` NULL | Kargoya uygulanan oran; NULL = belirlenmedi |
| `shipping_tax_amount` | `Numeric(10,2)` NULL | Kargonun içindeki vergi |

**Neden saklanıyor:** ürünün oranı sonradan değişse bile fatura sipariş
anındaki oranla kesilmelidir. Anlık hesaplansaydı bir ürünün oranı
değiştiği gün, aylar önce kesilmiş faturalar da değişirdi. M-6 bunu hem
tablo hem **fatura ucu** üzerinden ölçer.

**Neden hepsi NULL edilebilir ve `server_default` YOK:** `0` ile `NULL`
farklı şeylerdir — `tax_total = 0` "vergi yok", `NULL` "hesaplanmadı".
`server_default 0` verilseydi İP-5 öncesi bütün siparişler "vergisi sıfır
hesaplanmış" görünürdü. **`products.tax_rate`'in `server_default 0`'ı
P1-7'nin kök nedeniydi**; aynı hatayı sipariş tarafında tekrarlamıyoruz.

**Neden tutarlar JSONB'de metin:** JSON sayısı float'a çevirir ve kuruş
kaybı kalıcılaşır.

**Türetilen (saklanmayan):** iade vergisi. `invoice_service.refunded_breakdown`
onu `order_items.tax_rate` + `order_return_items.amount` **snapshot'larından**
hesaplar; ürünün güncel oranına bakmaz, yani tarihsel olarak kararlıdır.
Yalnız sağlayıcıda KESİNLEŞMİŞ (`refund_status='REFUNDED'`) iadeler sayılır —
uçuştaki bir iadeyi faturaya yazmak, para dönmeden dönmüş göstermek olurdu.

---

## 6. Fatura ucunun kapsamı

`GET /store/orders/{id}/invoice` (CLIENT).

**e-Arşiv formatına HAZIR, hiçbir dış servise BAĞLI DEĞİL.** Hiçbir
entegratöre (Nilvera/Paraşüt vb.) istek atmaz. **Resmî fatura numarası
üretmez** — seri-sıra mantığı bir mevzuat kararıdır ve ayrı bir iştir;
belge yalnız `order_id` referansı taşır.

| Durum | Yanıt | Gerekçe |
|---|---|---|
| `INVOICE_ENABLED=False` | **404** | 403 ucun varlığını sızdırırdı |
| Başkasının / olmayan sipariş | **404** | İP-2a/İP-3 IDOR deseni: sahiplik SORGUDA |
| Ödenmemiş sipariş | **409** | Belge ödeme bilgisi taşır |
| `tax_breakdown IS NULL` | **409** | S-4: geriye dönük hesap yok → uydurma belge yok |
| Kargo > 0 ve oran NULL | **409** | Σ(matrah+vergi) toplamı tutmaz |
| Satıcı kimliği eksik | **409** | Eksik bilgiyle iddiada bulunulmaz |

`response_model` bilinçli olarak yok: gövde saklanan kırılımın birebir
aynasıdır; araya şema koymak kolonla şema arasında sessiz bir sapma
penceresi açardı (F-4 eşitliği kolon kolon ölçüyor).

**Frontend:** `OrderInvoiceModal` iki kipli. *Fatura kipi* (200) satıcı,
alıcı, kırılım ve ödemeyi sunucudan alır. *Özet kipi* (404/409) belgeyi
**"Sipariş Özeti"** diye başlıklar ve **vergi satırını hiç göstermez** —
bilinmeyen bir kırılımı uydurmaktansa göstermemek doğrudur.

Böylece iki yanlış kapandı: satıcı kimliği istemci sabitinden geliyordu
(adres/telefon/vergi dairesi BOŞ) ve ödeme satırı `"iyzico ile ödeme"` diye
sabit yazılıydı — fake sağlayıcıyla ödenmiş siparişte bile.

**Sayaç:** `GET /store/admin/tax-health` iki eksiklik türünü AYRI sayar,
çünkü çareleri farklı: `missing_breakdown` tarihseldir (S-4 gereği
düzeltilmez), `shipping_rate_undefined` ayar girilince yeni siparişlerde
kendiliğinden kapanır.

---

## 7. TB-15(a) çözümü

**Eski hâl:** `_out_of_stock_refund` İP-2a'nın üç bileşenini de atlıyordu.
Üç zarar: (1) `refunded_amount` 0 kalıyor → oversell iadeleri ciroda
görünmüyor; (2) `refund_reserved` hiç artmıyor → tavan uygulanmıyor;
(3) sağlayıcı düşünce reconciler `settle_refunded_order` → `_restock`
çalıştırıyor, oysa hiç `SALE` yazılmamış → **hiç satılmamış mal için
`SALE_CANCEL`**.

**Çözüm — iki bağımsız katman:**

1. Akış merkezi hatta taşındı:
   `reserve_refund` → `begin_refund` → `perform_refund` → `settle_refunded_order`.
2. Restock ayrımı: `settle_refunded_order(restock=False)` (canlı çağrı, bilgi
   TAM) **ve** `_restock`'un kalıcı iz sorgusu (`_oversell_iptali_mi` →
   `order_status_history.changed_by = 'system:oversell'`). İkisi bilinçli:
   canlı çağrıda iz henüz yazılmamış olabilir, reconciler çağrısında ise
   parametre kaybolmuştur. Böylece **reconciler devralsa bile** koruma
   geçerli (O-4).

### İlk düzeltme YANLIŞTI — ölçüm çürüttü

İlk uygulama "**defterde `SALE` yoksa satılmamıştır**" diyordu ve `_restock`
satılan adedi `stock_ledger.sold_quantity_by_order_item` ile defterden
okuyordu. Tam suite koşumu 22 test düşürdü; kök nedeni aramak gerçek bir
tehlikeyi ortaya çıkardı.

**Ölçüm (geliştirme veritabanı, salt okuma):**

| Sorgu | Sonuç |
|---|---|
| PAID + fiziksel kalemli sipariş | 20 |
| …bunlardan `SALE` hareketi **olmayan** | **19** |
| …19'un `paid_at` durumu | 7 dolu / 12 NULL |
| …19'un `order_status_history`'sinde PAID kaydı | 3 var / 16 yok |

Defter (`stok_hareket_defteri_sku`) o siparişlerden **sonra** kuruldu. İlk
kural, defter öncesi gerçek bir siparişin iptalinde stoğu geri
döndürmezdi — **gerçek stok kaybı**. `paid_at` ve `order_status_history` de
aynı sebeple güvenilmez çıktı, yani ayrım **geçmiş veriden çıkarılamaz**.

Bu yüzden ayrım artık ilgili akışın bıraktığı **kalıcı ize** ve çağıranın
verdiği **açık parametreye** dayanıyor; hiçbir tarihsel veriye bakmıyor.
`sold_quantity_by_order_item` yardımcısı geri alındı (ölü kod bırakılmadı).

> Bu, kök `CLAUDE.md` §E'nin canlı örneğidir: İP-5'in kendi 47 node'u ilk
> düzeltmeyi **yeşil** gösteriyordu, çünkü hepsi defterli (yeni) sipariş
> kuruyordu. Kırmızıyı ancak **tam suite** verdi.

Sağlayıcı düşerse sipariş yine CANCELLED'a geçer ama telafi kuyruğu
çalışmaz — onu reconciler aynı `settle_refunded_order` üzerinden tamamlar.

| Node | Sonuç |
|---|---|
| O-1 merkezi hat (`refund_reserved` + `refunded_at`) | ✅ |
| O-2 `refunded_amount` = `total` | ✅ |
| O-3 satılmamış mala SALE_CANCEL yok | ✅ |
| O-4 reconciler devralınca da yok | ✅ |
| O-4b gerçek satışta restock HÂLÂ çalışıyor | ✅ |

**İP-2a'nın 49 node'u DEĞİŞMEDİ** (49/49 yeşil).

---

## 8. TB-21 çözümü

İki katmanlı, çünkü tek katman yetmiyor:

1. **Kök `conftest.py`:** `os.environ.setdefault("PAYMENT_PROVIDER", "fake")`.
   Pydantic önceliği `os.environ > .env` olduğu için `.env`'deki `iyzico`
   ezilir. Değişken YOKKEN korur.
2. **`db_guard.assert_fake_payment_provider`:** açıkça `iyzico` verilmiş bir
   koşumu **reddeder**. `setdefault` onu ezmez (ezmesi de yanlış olurdu; env
   ayarın son sözüdür). Nöbetçi session kapsamlı + autouse fixture'da
   çağrılıyor → **bütün entegrasyon suite'ini** kapsıyor. Boşluk tam olarak
   sağlayıcıyı fixture'dan almayan yollardaydı.

Şüphede SKIP değil **HATA**: ağa çıkan bir testin sessizce GEÇMESİ,
düşmesinden daha tehlikelidir.

Denylist (`REAL_PAYMENT_PROVIDERS`) bilinçli: yeni bir SAHTE sağlayıcı
eklendiğinde suite kendiliğinden koşabilmeli; yeni bir GERÇEK sağlayıcı ise
oraya eklenmeden kullanılamaz.

`scripts/ip5_test_env.ps1` `PAYMENT_PROVIDER`'ı **bilerek ayarlamaz** —
betiğe yazmak, korumanın çalışıp çalışmadığını gizlerdi. İP-5 matrisinin
tamamı (47) bu env olmadan yeşil koştu.

---

## 9. Mutasyon kataloğu — 9/9 YAKALANDI

Sürücü: `backend/scripts/mutation_drill.py` (byte yedeği + CRLF metin-modu
eşleştirme + "hedef bulunamadı = başarısızlık"). Her turdan sonra HEAD ve
çalışma ağacı başlangıç durumuna döndüğü doğrulandı.

**Sürücüde iki boşluk kapatıldı ([[TB-14]]/7):** (a) geri almanın baytı
baytına olduğu artık **SHA-256** ile doğrulanıyor — `git status`
karşılaştırması dosya içeriğini görmez, aynı boyutta bozuk bir geri yazım
oradan kaçardı; (c) hedef metin birden çok kez geçiyorsa mutasyon
**reddediliyor** — yanlış yeri bozup "yakalandı" demek tam da o kayıttaki
kusurdu.

| # | Mutasyon | Kırılan | Sonuç |
|---|---|---|---|
| P1 | `tax_rate` şema doğrulaması kaldırıldı (varsayılan 0 geri geldi) | V-4 (×4) + V-4c | ✅ |
| P2 | Siparişe kırılım yazılmıyor | M-1, M-1b, M-2, M-3, M-3b, M-4, M-4c, M-5 | ✅ |
| P3 | Kuruş artığı dağıtımı kaldırıldı (bağımsız yuvarlama) | M-5 | ✅ |
| P4 | Fatura kırılımı saklanandan değil ANLIK hesaplanıyor | M-6 | ✅ |
| P5 | Fatura sahiplik kontrolü kaldırıldı | F-2 | ✅ |
| P6 | Kısmi iadede orantı kaldırıldı | M-7 | ✅ |
| P7 | Oversell iadesi merkezi hattan çıkarıldı | O-1, O-2 | ✅ |
| P8 | "Oversell iptalinde restock yok" kaldırıldı (**bileşik**: iz sorgusu + `restock=False` birlikte) | O-3, O-4 | ✅ |
| P9 | Kök conftest `PAYMENT_PROVIDER` satırı kaldırıldı | T-1a | ✅ |

**P4 not:** F-4'ü kırmadı, çünkü o testte ürünün oranı değişmiyor ve anlık
hesap aynı sonucu üretiyor. Mutasyonu yakalayan M-6'dır — ve M-6'nın fatura
ayağı **tam bu prova için** eklendi: tabloyu okumak kırılımın saklandığını
kanıtlar, ama belgeyi ÜRETEN yolun da saklanandan okuduğunu ayrıca
göstermek gerekir.

---

## 10. Migration zinciri

```
… → ip1b_kontenjan_kilidi → ip1b_bilet_kodu_tekilligi → ip5_siparis_vergi_kirilimi (head)
```

Boş veritabanında doğrulandı (`adana_ip5_migtest`, tek kullanımlık):

| Adım | Sonuç |
|---|---|
| `upgrade head` | ✅ zincirin ucuna kadar |
| Beş kolon var mı | 5 |
| `downgrade -1` | ✅ |
| Beş kolon kalmış mı | 0 |
| `upgrade head` (tekrar) | ✅ |
| Beş kolon | 5 |
| Kısmi index | `ix_orders_tax_breakdown_missing` mevcut |
| `alembic heads` | **tek head** |

**Backfill YOKTUR** (S-4). Downgrade beş kolonu düşürür; veri kaybı
bilinçlidir (kolonlar İP-5 ile doğdu).

---

## 11. Kalan P2'ler ve doğrulanmamış noktalar

| # | Kayıt | Etki / sonraki adım |
|---|---|---|
| 1 | **`SHIPPING_TAX_RATE` boş, `INVOICE_ENABLED` kapalı** | Bilinçli (S-3/S-6). Mali müşavir teyidi gelene kadar kargo kırılımı NULL kalır ve fatura ucu 404 döner. Değer girilince `GET /store/admin/tax-health` ile kaç siparişin eksik kaldığı sayılmalı |
| 2 | **Mevcut 22 sipariş + 6 ürün oransız** | S-4 gereği siparişler düzeltilmeyecek. **Ürünlerin** oranı ise elle girilmeli — aksi hâlde yeni siparişler de %0 kırılımla kaydolur (ürün oranı zaten 0 olduğu için kod doğru çalışır, veri eksiktir) |
| 3 | **`tax-health` sayacı UI'da yok** | Uç var ve admin izniyle korunuyor; ekrana bağlanması ayrı iş (İP-4 admin yüzeyi kapsamı) |
| 4 | **Fatura numarası / seri-sıra yok** | Mevzuat kararı, bilinçli kapsam dışı |
| 5 | **e-Arşiv entegratörü bağlı değil** | Bilinçli kapsam dışı |
| 6 | **`totals_by_rate` artık ölü kod adayı** | Yerini `order_breakdown` aldı ama silinmedi; kendi birim testleri "0.2" biçimini bekliyor (üretim anahtarı 4 basamak). Kaldırılması ayrı bir temizlik; bugün zararsız |
| 7 | **Frontend flaky (düşük öncelik)** | Paketleme testleri makine yükü altında timeout verebiliyor; iki tam koşumdan biri 756/756 yeşil, diğerinde 4 timeout. Bilinen kusur ([[TB-14]]/8), İP-5 ile ilgisi yok |
| 8 | **Dijital-yalnız fatura yolu ölçülmedi** | Kapanış turunda bulundu ve DÜZELTİLDİ (`selectinload(Order.client)` eksikti; alıcı adı sessizce boş dönerdi) — ama bu yolu doğrudan ölçen bir node yok: F node'larının hepsi fiziksel kalemli sipariş kuruyor. Sonraki adım: dijital-yalnız siparişte fatura üreten bir F node'u |
| 9 | **Fatura baskı çıktısı gerçek tarayıcıda doğrulanmadı** | Modalın içeriği değişti (vergi satırları eklendi, tablo bir sütun genişledi) ama `@media print` altında taşma/sayfa kırılımı ölçülmedi. Kök `CLAUDE.md` §F bunu gerçek tarayıcı gerektiren sınıfa koyuyor. Uç üretimde KAPALI olduğu için bugün kullanıcıya ulaşmıyor; `INVOICE_ENABLED` açılmadan önce Chrome + DevTools Protocol ile baskı provası yapılmalı |

---

## 12. Değişen dosyalar

**Backend (üretim):** `core/config.py` · `models/store.py` ·
`schemas/store.py` · `services/tax.py` · `services/invoice_service.py` (yeni) ·
`services/order_service.py` · `services/store_service.py` ·
`services/stock_ledger.py` · `api/routers/store.py` ·
`migrations/versions/ip5_siparis_vergi_kirilimi.py` (yeni) · `conftest.py`

**Backend (test):** `tests/integration/ip5_factory.py` +
`test_ip5_{tax_writer,tax_math,invoice,oversell_refund,provider_guard}_pg.py`
(yeni) · `tests/test_ip5_tax_math.py` (yeni, birim/DB'siz) ·
`tests/integration/conftest.py` · `tests/integration/db_guard.py` ·
`scripts/mutation_drill.py` · `scripts/ip5_test_env.ps1` (yeni)

### Test türlerinin dürüst sınıflandırması (§H)

| Tür | Sayı | Ne kanıtlar |
|---|---|---|
| Gerçek PG + gerçek HTTP (yetki çözümü dahil) | 47 | Uçların gerçekten döndürdüğü kod, DB'nin gerçekten tuttuğu değer |
| Saf birim (aritmetik + nöbetçi) | 20 | Kuruş sınırları, oran anahtarı, geçersiz oran reddi |
| Gerçek DOM (Vitest, saf dönüşüm) | 12 | Yüzde ↔ oran dönüşümü, kayan nokta artığı |
| Mutasyon provası | 9 | Testlerin gerçekten nöbet tuttuğu |
| Migration (tek kullanımlık boş DB) | 1 döngü | upgrade → downgrade → upgrade + tek head |

**Bu pakette olmayan:** gerçek tarayıcı/E2E kabul testi. Fatura modalının
**baskı çıktısı** (print CSS, sayfa taşması) gerçek tarayıcıda
DOĞRULANMADI — `@media print` kuralları değişmedi ama modalın içeriği
değişti (vergi satırları eklendi). Kalan risk §11'de kayıtlıdır.

**Frontend:** `lib/tax.ts` + `lib/tax.test.ts` (yeni) · `types/index.ts` ·
`api/store.ts` · `hooks/useStore.ts` ·
`components/store/OrderInvoiceModal.tsx` · `pages/dashboards/AdminStore.tsx` ·
`pages/store/SellerProducts.tsx`

---

## 13. Doğrulama sonuçları

Gerçek PostgreSQL + gerçek Redis, `POSTGRES_DB=adana_ip5_test` (tek
kullanımlık; `ceyhandb` allowlist dışında).

| Suite | Beklenen | Sonuç |
|---|---|---|
| `tests/integration` (tam) | — | **1215 passed** |
| `-k ip5` | — | **47 passed** |
| `-k ip2a` | 49 | **49 passed** — DEĞİŞMEDİ |
| `-k ip1b` | 28 | **28 passed** |
| `-k ip4` | 21 | **21 passed** |
| `-k ip1a` | 63 | **63 passed** |
| `-k ip2b` | 39 | **39 passed** |
| `-k ip3` | 115 | **115 passed** |
| `-k f30` | 314 | **314 passed** |
| `tests/acceptance` | — | **197 passed** |
| unit (integration/verify/acceptance hariç) | 685 taban | **705 passed** (+20: `tests/test_ip5_tax_math.py`) |
| `ruff check .` | temiz | **All checks passed** |
| `git diff --check` | temiz | temiz |
| Frontend `tsc -b` | temiz | temiz |
| Frontend Vitest | 73 dosya / 744 taban | **74 dosya / 756 test**, hepsi yeşil (12'si yeni: `lib/tax.test.ts`) |

**Koşum sırasında düzeltilen kendi test hatam:** `-p no:logging` bayrağıyla
koşarken İP-2b'de iki test `fixture 'caplog' not found` verdi. Bu bir üretim
hatası değil, benim koşum bayrağımın yan etkisiydi (`caplog` `logging`
eklentisinden gelir); bayraksız 39/39 yeşil.

### Tam suite'in ortaya çıkardığı 22 kırmızı

Paket suite'leri tek tek yeşilken **tam `tests/integration` koşumu 22 test
düşürdü**. İki bağımsız sebep vardı ve ikisi de gerçekti:

1. **13 test · S-5'in bilinçli sonucu.** `ProductCreate` ve CSV artık
   `tax_rate` zorunlu kılıyor; `test_stock_writers_pg.py` ve
   `test_stock_bucket_chain_pg.py` fixture'ları onu göndermiyordu.
   Düzeltme fixture'lara oran eklemek oldu — **beklentiler değişmedi**,
   yalnız kurulum yeni sözleşmeye uyduruldu.
2. **9 test · benim düzeltmemin gerçek hatası.** §7'de anlatılan
   "defterde SALE yoksa restock yok" kuralı. Bu, İP-5'in kendi node'larına
   yakalanmıyordu.

Yani "paket suite'i yeşil" tek başına yeterli olmadı; iddiayı **tam suite**
düzeltti. Kayıt burada duruyor çünkü kök `CLAUDE.md` §I bunu istiyor.

**Frontend flaky (çözüldü):** ilk tam suite koşumunda 3 dosya / 4 test
timeout verdi (`PackageLabel.test.tsx` + iki komşu paketleme dosyası).
İzole koşumda 65/65 geçtiler; **ikinci tam koşumda 756/756 yeşil**. Yani
yük kaynaklıydı, kod kusuru değil ([[TB-14]]/8 sınıfı).
