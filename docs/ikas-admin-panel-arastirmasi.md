# ikas Admin Paneli — Derin Analiz ve Kendi Panelimizle Karşılaştırma

**Tarih:** 11 Eylül 2026 (gece çalışması)
**Kaynak:** ikas canlı admin paneli (adanaozelders deneme mağazası, lisans aktif) + iki HAR arşivi (GraphQL API şeması) + kendi kod tabanımızın haritası
**Yöntem:** Panelde erişilebilen her modül gerçek formlarıyla gezildi (ekran görüntüsü + DOM metni + ağ izleme). Storefront'u müşteri gözüyle test etmek için — kullanıcı onayıyla — deneme mağazasına test ürünü + stok + Kapıda Ödeme yöntemi eklendi (kalıcı, zararsız). Silme/yıkıcı işlem yapılmadı. Canlı `.ikas.shop` ve Pazarlama modülü ücretli-plan duvarının arkasında kaldı (bkz. §16).
**Amaç:** ikas'ın bizden daha olgun yaptığı işleri modül modül çıkarıp kendi admin panelimiz için önceliklendirilmiş uygulama planı üretmek.

> **Not:** Bu bir araştırma/karşılaştırma raporudur. Kod değiştirilmedi. "Bizde" satırları 11 Eyl 2026 kod tabanı haritasına dayanır; uygulamadan önce ilgili dosyalar tekrar doğrulanmalı.

---

## 0. Yönetici Özeti

ikas'ın panelini bizden ayıran şey **özellik listesi değil, her şeyin veri-tabanlı ve konfigüre edilebilir olması**. Bizde çok sayıda kural `.env`'de veya kodda sabit (kargo eşiği, taksit, vergi dahil/hariç, checkout alanları); ikas'ta hepsi admin panelinden yönetiliyor. En yüksek getirili 6 boşluk:

| # | Boşluk | ikas | Bizde | Getiri |
|---|--------|------|-------|--------|
| **1** | **Ürün Kişiselleştirme** (müşteri girdisi) | 7 alan tipi + fiyat etkisi + koşullu + zorunluluk | YOK | Kırtasiye/kitap için gravür, isim baskısı, hediye notu, özel kapak → doğrudan gelir |
| **2** | **Kargo tarife motoru** | Bölge × Teslimat Yöntemi × N Kural (Sipariş Fiyatı/Desi, min/max, fiyat listesi) | Tek global `.env` eşiği + sabit ücret | Gerçek kargo maliyeti yansıtma, bölgesel fiyat |
| **3** | **Kampanya motoru** | 4 tür (Yüzde/Sabit/Kargo Bedava/BOGO) + katlı + segment + stacking | Sadece kod-bazlı Coupon (PERCENT/FIXED) | Otomatik sepet kampanyaları, satış artışı |
| **4** | **Vergi mimarisi** | Ülke varsayılan + hiyerarşik override + kanal bazlı dahil/hariç | Ürün başına `tax_rate` + kategori default | Esneklik, B2B vergi-hariç |
| **5** | **Çok sağlayıcı + koşullu ödeme** | 14 sağlayıcı + Havale + COD + taksit + koşullu gizleme | iyzico CF tek akış, taksit=[1] sabit | Taksit = sepet dönüşümü; COD talebi |
| **6** | **Checkout konfigürasyonu** | Adres alanı zorunluluk, guest checkout, hediye paketi, store credit, sözleşme butonu | Çoğu koda gömülü | Dönüşüm optimizasyonu, operasyon esnekliği |

**Not:** Kendi-filo teslimat (delivery.py), stok defteri, escrow/para güvenliği, KVKK/yasal katman, vitrin sürümleme gibi alanlarda **biz ikas'tan daha olgunuz** — bunlar ikas'ta yok veya daha sığ (§14).

---

## 1. ikas Modül Haritası

```
Ürünler
  ├─ Ürünler (Basit / Varyantlı / Paket)
  ├─ Satın Alma · Transferler · Stok Sayımı
  ├─ Tanımlamalar (Kategori, Marka, Özel Alan, Varyant Türü, Ürün Grubu,
  │                Tedarikçi, Kişiselleştirme, Etiket, Ürün Birimi, Sepet Linki)
  ├─ Fiyat Listesi · Ürün Barkod Etiketi
Siparişler (liste + manuel Sipariş Oluştur/draft)
Müşteriler (+ Grup + Segment)
İndirimler (Kampanyalar · Kuponlar · Kampanya Teklifleri)
Pazarlama (Özet · E-Posta&SMS · Otomasyon · Segment · Popup · Affiliate)
Raporlar · Uygulamalar · Gelen Kutusu
Ayarlar
  ├─ Mağaza / Personel(RBAC) / Vergi / Sözleşme / Stok Lokasyonları / Fatura / Alan Adı
  ├─ Diller&Çeviriler / Ürün Filtreleri / Kargo Etiketi / Müşteri Özel Alanları / Biçimlendirme
  └─ Etkinlik Geçmişi / E-posta Domain / SMS / Hesap Silme / Aktarım / AI Görsel
Satış Kanalı (storefront, KANAL-BAZLI ayarlar)
  └─ Tema / SEO&Alan / Otomasyon / Bildirim / Lokalizasyon /
     Ödeme Ayarları / Müşteri(Checkout) Ayarları / Kargo Ayarları / Eklenti / Blog
```

**Kritik mimari ders:** Kargo, Ödeme, Checkout, Lokalizasyon, SEO **satış kanalı (storefront) bazlı** — mağaza geneli değil. Bizde tek storefront olduğu için bu ayrım yok; ama çok-kanal (ör. pazaryeri + kendi site) düşünülürse bu ayrım gerekir.

---

## 2. Ürün: tipler ve temel form

**ikas — 3 ürün tipi** (Ürün Ekle modalı): Basit / Varyantlı / Paket (bundle).

**Basit Ürün formu** (7 bölüm tek sayfada): Temel Bilgi · Medya · Ürün Detayı · Envanter · SEO · Özel Alanlar · Ürün Özelleştirmesi.
- **Temel Bilgi:** Ürün Adı, **Ürün Türü (Fiziksel/Dijital)**, Satış Fiyatı + **İndirimli Fiyat + Alış Fiyatı (maliyet)**, birim fiyat göster, ürün-seviyesi Fiyat Listesi.
  - Kural (tooltip): *sepetteki tüm ürünler dijitalse müşteri kargo adımını görmez.*
- **Medya:** .jpeg/.jpg/.png/.webp/.heic/.mp4, 10 MB.
- **Ürün Detayı:** Marka, Etiket, Google Ürün Kategorisi, Tedarikçi, Kategori (çoklu), Açıklama + **"Açıklama Oluştur" (AI)**.
- **Envanter:** SKU, Barkod, **Desi, HS Kodu**, lokasyon-bazlı Stok, "stok tükenince satmaya devam et".
- **SEO:** Slug, Sayfa Başlığı, Açıklama, Gelişmiş SEO, canlı önizleme.

| Alan | Bizde (dosya) | Fark / öneri |
|------|---------------|--------------|
| Fiziksel/Dijital | `store.py` currency + dijital ürün var | Örtüşüyor |
| Alış Fiyatı (maliyet) | ? kâr hesabı için maliyet alanı sınırlı | **Öneri:** ürüne `cost_price` ekle → kâr raporu |
| Desi / HS Kodu | YOK | Kargo desi hesabı + ihracat için gerekli (→ §5 kargo) |
| AI açıklama | YOK | Gemini API zaten var (kullanıcı verdi) → düşük maliyetli kazanım |
| Google Ürün Kat. | YOK | Google Shopping entegrasyonu için |

---

## 3. Varyant motoru (bizim modelle örtüşüyor, UX farkı)

**ikas "Varyant Ekle" drawer'ı:**
- **Varyant Türü Adı:** serbest metin combobox (Renk, Boyut…) — merkezi Varyant Türleri'nden öneri.
- **Seçim Stili (per eksen):** **Liste** (metin butonu) veya **Renk/Görsel** (hex swatch / görsel).
- **Varyantlar:** Enter/virgülle etiket; her değer sürükle-sırala + düzenle + sil.
- Checkbox: *varyant değerlerini marka/kategori sayfalarında ayrı göster.*
- **Matris (kaydet sonrası inline tablo):** her kombinasyon = 1 satır → Satış/İndirimli/Alış Fiyatı, SKU, Barkod, **lokasyon-bazlı Stok**, satır aksiyonları, görsel.

| | ikas | Bizde (`store.py`) |
|--|------|--------------------|
| Eksen sözlüğü | serbest metin + öneri | sabit `VARIANT_AXES` (8) + CHECK |
| Değer render stili | per-eksen Liste/Renk/Görsel | `swatch_hex`/`swatch_image_url` var ama "seçim stili" kararı yok |
| Kombinasyon düzenleme | tek inline matris (fiyat+stok+SKU+barkod) | her varyant ayrı ürün satırı |

**Öneri:** Bizim model sağlam; iki iyileştirme — (a) eksen başına **render stili** (Liste/Renk/Görsel) alanı, (b) admin'de **inline matris düzenleme** UX'i (tek tabloda tüm kombinasyonlar). Eksen sözlüğünü serbest yapmaya gerek yok (bizim sabit sözlük + CHECK daha güvenli).

---

## 4. Ürün Kişiselleştirme — EN BÜYÜK FIRSAT (bizde YOK)

**ikas: Tanımlamalar > Ürün Kişiselleştirmeleri** (merkezi set) → üründe "Ürün Özelleştirmesi" ile bağlanır.

Set = Ad (dahili) + N adet **Kişiselleştirme Seçeneği**. Her seçenek 3 sekme:
- **Tür:** Müşteriye görünen başlık + ek açıklama + **tip (7):** Evet/Hayır · Seçim · Renk Seçimi · Tarih Seçimi · **Dosya** · **Yazı** · **Paragraf**
- **Fiyat:** "ücretli olsun" (fiyat etkisi) + fiyat listesi başına ayrı ücret
- **Ayarlar:** **koşullu görünürlük** ("başka seçenek seçilince aktif") + **zorunluluk**

HAR karşılığı: `listProductOptionSet` (`type`, `requiredOptionId`, `price`, `otherPrices[priceListId]`, `selectSettings`, `fileSettings`, `dateSettings`).

**Bizde:** `OrderItem` yalnız ürün snapshot'ı tutar — müşteri girdisi alanı **yok**.

**Uygulama planı (P0 aday):**
- Yeni modeller: `ProductPersonalizationSet`, `PersonalizationOption` (type enum: BOOL/SELECT/COLOR/DATE/FILE/TEXT/PARAGRAPH, `price`, `price_type`, `required`, `conditional_on_option_id`, `sort`), `PersonalizationOptionValue`.
- Ürüne `personalization_set_id` (opsiyonel FK).
- `OrderItem`'a `personalization_data` (JSONB: seçenek→değer) + ek ücret kalemleri; fiyat **sunucuda** hesaplanır (dosya yükleme `private/` + imzalı URL — mevcut desen).
- Migration + `variant_service` benzeri `personalization_service` (fiyat + zorunluluk + koşul doğrulama).
- Frontend: ürün detayında dinamik form; sepete/siparişe taşıma.

---

## 5. Kargo tarife motoru — EN BÜYÜK YAPISAL BOŞLUK (bizde YOK)

**ikas: Satış Kanalı > Kargo Ayarları.**
- **ikas Kargo Avantajı:** anlaşmalı kargo servisi (pazarlık gücü).
- **Kural Setleri:** her set = **Ülke × Teslimat Yöntemi × Bölge × N Kural**.
  - **Teslimat Yöntemi:** Standart / **Hızlı Teslimat (gün-saat aralıklı)**.
  - **Bölge:** Ülke → Tüm Ülke veya il/ilçe.
  - **Kural (her biri):** koşul tipi **{Sipariş Fiyatı | Ürün Desisi}** + **Min/Max** + **Kargo Fiyatı** (veya Ücretsiz) + **fiyat listesi başına** + müşteriye görünen ad + depo bağlama.
  - Örnek: Ücretsiz Kargo (Sipariş Fiyatı ≥ ₺500), Ücretli (< ₺500 → ₺100).

HAR karşılığı: `zoneRate.condition{type: BASED_ON_ORDER_PRICE|desi, minAmount, maxAmount}` + `localDeliverySettings{activeDays, hours, estimatedDeliveryTime}`.

**Bizde:** `config.py` `SHIPPING_FREE_THRESHOLD=500` + `SHIPPING_FLAT_FEE=49.90` (tek global, `.env`), `order_service.compute_shipping`. Kendi-filo teslimat (`delivery.py`) ayrı ve olgun ama **ticari kargo tarifesi yok**.

**Uygulama planı (P0/P1 aday):**
- Modeller: `ShippingZone` (ülke + il/ilçe listesi), `ShippingRateSet` (zone + delivery_method), `ShippingRate` (condition_type: ORDER_PRICE|DESI, min, max, price, price_list_id, name).
- `compute_shipping`'i tek eşikten **kural motoruna** çevir: sepet tutarı/desi + teslimat bölgesi → eşleşen kural → fiyat (sunucuda). Dijital-yalnız → 0 kuralı korunur.
- Ürüne `desi` alanı (§2) bu motorun girdisi.
- Admin UI: bölge + kural seti düzenleme (ikas'ın inline tablosu referans).
- **Not:** Kendi-filo teslimatla (delivery.py) çakışmaz — o "nasıl teslim edilir", bu "ne kadar ücret".

---

## 6. Ödeme — çok sağlayıcı + koşullu

**ikas: Satış Kanalı > Ödeme Ayarları.**
- **Sağlayıcılar (14):** iyzico, PayTR, Sipay, Moka, Paratika, Stripe EU, PayPal, Klarna, Mollie, Tami, Payriff, ApcoPay, Elekse EsnekPOS.
- **Sağlayıcısız yöntemler:** **Havale/EFT**, **Kapıda Ödeme (Nakit)**, **Kapıda Ödeme (Kredi Kartı)**.
- **Koşullu ödeme ("Ödeme Ayarı Ekle"):** sepet/müşteri koşuluna göre **yöntem gizle + taksit sınırla** (HAR: PAYMENT_GATEWAY_RULES).
- Taksit: sağlayıcı bağlanınca kart-ailesi bazlı taksit oranı tablosu (HAR: `installmentSettings.installmentRates[cardFamily][count]{rate,diff,disabled}`).

**Bizde:** iyzico Checkout Form tek akış (`core/payments/iyzico.py`), `enabledInstallments=[1]` **koda gömülü** (taksit yok), COD "bilinçli kapsam dışı", havale manuel üretimde kapalı, min/max tutar yok.

**Uygulama planı (P1 aday):**
- **Taksit:** iyzico CF'de `enabledInstallments` sabitini kaldır → panel/DB'den taksit sayısı + vade farkı (kart ailesi bazlı opsiyonel). Sepet dönüşümü için yüksek etki.
- **Havale/EFT:** düşük efor, yüksek talep (KDV mükellefi B2B).
- **COD:** operasyon kararı (kendi-filo teslimatla birlikte "kapıda ödeme" mümkün) — ayrı değerlendir.
- **Koşullu ödeme:** düşük sepette taksit kapatma gibi kurallar (P2).

---

## 7. Vergi — mimari fark

**ikas: Ayarlar > Vergi.**
- **Vergi Bölgeleri:** ülke varsayılan oranı (TR %20). Bölge = kargo bölgesiyle eşleşmeli.
- **Hiyerarşik override:** Kargo / Hediye Paketi / **Ürün** özelleştirmeleri (varsayılanı geçersiz kılan özel oran).
- **Kanal bazlı dahil/hariç:** "Ürün Fiyatı" ve "Kargo+Hediye Paketi" ayrı ayrı Vergi Dahil/Hariç (B2B için hariç).

**Bizde:** `Product.tax_rate` her üründe + `ProductCategory.default_tax_rate` (NULL, mali müşavir bekliyor), `SHIPPING_TAX_RATE` (NULL), KDV-dahil sabit. `tax.py` hesaplar.

**Değerlendirme:** Bizim ürün-başına model daha granüler ama ikas'ın **kanal bazlı dahil/hariç** ve **kargo/hediye ayrı vergi** yaklaşımı daha esnek. **Öneri:** ürün-başına modeli koru; ekle: (a) kargo/hediye paketi vergi oranı ayrımı (kısmen var: SHIPPING_TAX_RATE), (b) B2B için vergi-hariç gösterim modu (checkout kanal ayarı ile).

---

## 8. Kampanya/İndirim motoru — bizde çok sığ

**ikas: İndirimler > Kampanyalar / Kuponlar / Kampanya Teklifleri.**

**Otomatik İndirim (Kampanya) formu** (9 sekme):
- **Tür (4):** Yüzdelik · Sabit Tutar · **Ücretsiz Kargo** · **X Al Y Kazan (BOGO)**
- **Oran:** düz veya **Katlı (kademeli)**
- **Kapsam:** Tüm / Belirli Ürünler
- **Gereksinim:** sepet tutarı min/max, ürün adedi min/max
- **Limit:** toplam + kullanıcı başına + **dönem bazlı**
- **Hedefleme:** Tüm / **Grup&Segment** / Spesifik müşteri / sadece üyeler
- **Ayarlar:** **kampanya birleştirme (stacking)**, kanal+kur kısıtı
- **Tarih aralığı**

**Bizde:** `Coupon` (PERCENT/FIXED, min_subtotal, max_uses, per_user_limit, tarih) + `CouponRedemption`. Otomatik sepet kampanyası, kargo bedava, BOGO, katlı, segment, stacking → **YOK**.

**Uygulama planı (P1 aday):**
- `Campaign` modeli: type (PERCENT/FIXED/FREE_SHIPPING/BOGO), scope (products/categories), requirements (min/max amount/qty), limits (total/per_user/period), targeting (all/segment/customers), stackable (bool), date range, auto (kodsuz) vs code.
- Sepet hesabında kampanya motoru (sunucuda), stacking kuralı, en iyi indirim seçimi.
- Segment/grup önce gerekir (§9).

---

## 9. Müşteri: grup + segment

**ikas Müşteri formu:** Ad/Soyad/E-posta/Telefon/**Tercih Dil**, çoklu adres, **Müşteri Grubu**, Etiket, pazarlama izni, **Özel Alanlar**. Segment = Pazarlama > Müşteri Segmentleri.

**Bizde:** `client.py` (ad/telefon/çoklu adres). Grup, segment, tercih dil, müşteri özel alanı, etiket → YOK.

**Öneri (P1):** `CustomerGroup` + `CustomerSegment` (kural-bazlı: sipariş sayısı/tutarı/tarih) → kampanya hedeflemenin (§8) temeli. Etiket + özel alan düşük efor.

---

## 10. Checkout / Müşteri Ayarları — konfigürasyon boşluğu

**ikas: Satış Kanalı > Müşteri Ayarları** (kanal-bazlı checkout kontrolü):
- **Adres formu:** her alan (Kimlik No/Telefon/Posta Kodu) Gösterme/Opsiyonel/Zorunlu + karakter kısıtı.
- **Sepet:** Kupon kodu görünürlüğü, Hediye Paketi, Sipariş Notu.
- **Genel:** guest checkout, **mesafeli satış sözleşmesi onay butonu davranışı**, fatura adresi adımı, **kurumsal fatura (B2B)**, sipariş sonrası hızlı üyelik.
- **İade:** Google Captcha, **İadeyi Mağaza Bakiyesine Yap (store credit)**.

**Bizde:** çoğu koda gömülü/sabit.

**Öneri (P2, ama bazıları P1):**
- **Store credit (mağaza bakiyesi ile iade):** bizim payout "kasa yok" prensibiyle çelişir ama iade operasyonunu kolaylaştırır — ürün kararı.
- Guest checkout, hediye paketi, sipariş notu → düşük efor UX kazanımı.
- KVKK/mesafeli sözleşme onay butonu bizde zaten var (legalContent + consent).

---

## 11. Sipariş: manuel oluşturma (draft)

**ikas "Sipariş Oluştur":** admin ürün+müşteri+kargo+indirim seçip **taslak sipariş** oluşturur → ödeme linki gönderir. POS/telefon satışı için.

**Bizde:** admin manuel sipariş oluşturamıyor. **Öneri (P2):** draft order + ödeme linki — telefon/B2B satış için değerli ama acil değil.

---

## 12. Lokalizasyon / çok dil

**ikas: Satış Kanalı > Lokalizasyon:** ülke → Dil + Fiyat Listesi + Para Birimi + URL yönlendirme. Ayarlar > Diller ile ürün/kategori/kampanya çevirisi.

**Bizde:** tek TR/TRY, çok dil YOK. **Değerlendirme:** hedef kitle TR olduğu için **düşük öncelik** — ama ileride büyümede gerekir.

---

## 13. Pazarlama suite (bizde neredeyse yok)

**ikas Pazarlama:** E-Posta & SMS kampanya · **Otomasyon (tetikleyici akışlar)** · Müşteri Segmentleri · Popup · Affiliate.

**Bizde:** `notification.py` + `duyuru.py` (sadece in-app, hedeflemesiz). **Öneri:** büyük bir modül; lansman sonrası. Segment (§9) ilk taş.

---

## 13b. Fiyat Listesi ve Özel Alanlar — temel kavramlar (bizde YOK)

**Fiyat Listesi** (Ürünler > Fiyat Listesi). ikas'ta **temel** bir kavram: kargo kuralları, kampanyalar, ürün kişiselleştirme fiyatları, checkout — hepsi "fiyat listesi başına" fiyat destekliyor. HAR şeması: `PriceList{type, currencyCode, addProductsAutomatically, ruleList{basePriceListId, rules[{operationType, amount, amountType}], currencyRateSettings, currencySettings{roundingFormat}}}` → **baz listeden %/tutar operasyonuyla türetilen** fiyat listesi.
- **Bizde:** tek `Product.price`, fiyat listesi yok.
- **Öneri (P1):** `PriceList` + `PriceListRule` (base_id, operation, amount, amount_type, rounding). B2B/toptan/segment/kanal fiyatlandırma ve çok para biriminin **önkoşulu**. Kampanya (§8) ve kargo (§5) motorlarının "fiyat listesi başına" davranışı buna bağlı — bu üçü birlikte planlanmalı.

**Özel Alanlar** (Tanımlamalar > Özel Alanlar). Ürün metadata → **ürün filtresi** + temada gösterim (Sezon, Cinsiyet gibi). Tür: Doğru-Yanlış · Seçim · Çoklu Seçim · Renk · Tarih · Tarih+Saat · HTML · Resim (+Metin/Sayı). Müşteri tarafında da var (Ayarlar > Müşteri Özel Alanları).
- **Bizde:** subject taxonomy var; genel ürün/müşteri özel-alan + filtre motoru yok. `store_merchandising.ProductAttributeDefinition` kısmen benzer (renk/swatch) ama arama filtresi üretmiyor.
- **Öneri (P2):** ürün özel alanı → faset filtre (arama/kategori sayfasında). Kitap/kırtasiyede "yayınevi, seviye, sınıf, format" gibi filtreler doğrudan satış kolaylaştırır.

---

## 13c. Frontend / Storefront (müşteri-yüzü) — büyük yaklaşım farkı

Bir test ürünü ("9. Sınıf Matematik Soru Bankası", ₺250) ekleyip storefront'u tema editörü önizlemesinde müşteri gözünden gezdim (canlı `.ikas.shop` yayınlanmamış olduğu için editör önizlemesi kullanıldı).

**ikas storefront'u:**
- **20 hazır müşteri sayfası** blok-tabanlı görsel editörle düzenlenir: Anasayfa, Ürün Sayfası, Sepet, **Ödeme (checkout)**, Hesabım, Giriş/Kayıt/Şifre, Adreslerim, Siparişlerim, Sipariş Detay, Favoriler, Kategori, Marka, 404, Blog (3 sayfa), Arama + Yeni Sayfa Oluştur.
- Her sayfa **bloklardan** oluşur: ör. Ürün Sayfası = Üstbilgi + **Ürün Detay** + **Ürün Değerlendirmeleri** + **Ürünler Slaytı** (ilgili ürünler) + Altbilgi. Anasayfa = Üstbilgi(duyuru şeridi+arama+hesap+sepet) + Ürün Listesi(grid+sıralama) + Altbilgi(iletişim/kategori/yardım/sosyal/çerez-KVKK).
- Ürün detay bileşenleri: favori(kalp), adet(− n +), sepete-ekle, **stok yoksa "STOKTA YOK" + "İLETİŞİME GEÇ" (WhatsApp) akıllı fallback'i**, fiyat, görsel galeri.
- Her sayfada: dil seçici (çok dil), cihaz önizleme (masaüstü/mobil), SEO ayarı, canlı önizleme. Hazır tema (Kombos) — temiz, modern, mobil-uyumlu.
- Admin, teknik bilgi olmadan tüm siteyi görsel düzenler.

**Bizim frontend:** React/TS, **tamamen kod-tabanlı** — her sayfa bir component (`frontend/src`). Vitrin manuel (`AnaVitrin.tsx`), Puck denendi ve söküldü (bkz. `project_cms` hafızası) → kullanıcı vitrin değişikliklerini tarif ediyor, geliştirici kodluyor.

**Değerlendirme — bu senin "frontend'de kötüyüz" hissinin kaynağı olabilir:**
- ikas'ta **her müşteri sayfası hazır, tutarlı, blok-editörle düzenlenebilir**; bizde her sayfayı elle kodluyoruz, bazıları eksik/tutarsız olabilir.
- **Ama:** ikas blokları şablon — herkesin sitesi benzer görünür. Bizim kod-tabanlı yaklaşım daha özgün/esnek olabilir, yeter ki sayfalar tamamlanmış ve tutarlı olsun.
- **Gerçek boşluk** ikas'ın *editörü* değil (biz SaaS değiliz, tek mağazayız — görsel editöre ihtiyacımız yok); gerçek boşluk **müşteri sayfalarının eksiksizliği ve cilası**: ikas'ta ürün detay/sepet/checkout/hesap/favoriler/değerlendirme/ilgili-ürünler hepsi standart ve parlak. Bizde bunların hangisi var, hangisi eksik/ham — **ayrı bir frontend denetimi** gerektirir (bu rapor admin-odaklıydı).

**Öneri (ayrı iş):** kendi storefront'umuzun müşteri sayfalarını (ürün detay, sepet, checkout, hesabım, favoriler, ürün değerlendirme, ilgili ürünler) ikas'ın bu standart listesine karşı denetleyelim — hangileri var, hangileri eksik/zayıf. Bu, "frontend'de kötüyüz" hissini somut bir eksik-listesine çevirir. Görsel blok-editör (Puck benzeri) **gerekmiyor**; eksik sayfaları kod olarak tamamlamak yeterli.

**İlk denetim bulgusu (kod envanteri, çalışma kalitesi ayrıca teyit edilmeli):** Sayfa olarak **eksik değiliz.** `frontend/src/pages/store/`: StorePage(anasayfa), ProductDetailPage, CartPage, CheckoutPage, FavoritesPage, OrdersPage, OrderDetailPage, SellerStorePage, **SharedCollectionPage** ve **CargoTrackingPage** (son ikisi ikas'ta yok — bizim ekstramız). `ProductDetailPage.tsx` değerlendirme + ilgili ürünler + görsel galeri içeriyor (ikas'ın ürün-detay üçlüsünün karşılığı). Rotalar: `/magaza`, `/magaza/urun/:slug`, `/magaza/sepet`, `/magaza/odeme`, `/magaza/favoriler`, `/siparislerim`, `/adreslerim`. **Sonuç:** "frontend'de kötüyüz" hissi büyük olasılıkla **sayfa eksikliği değil, cila/tutarlılık/tasarım kalitesi** meselesi — hangi sayfanın nesi kötü, kullanıcı ile ekran ekran gezilerek somutlaştırılmalı (kâğıt-üstü "var" demek yetmez; gerçek görünümü teyit et).

---

## 14. Bizim ikas'tan ÜSTÜN olduğumuz alanlar

Rapor dengeli olsun: ikas'ı kopyalarken bunları **kaybetmeyelim**.
- **Kendi-filo teslimat** (`delivery.py`): tur/durak FSM, QR+OTP+foto kanıt, kapasite/cutoff/kapalı gün, ETA penceresi, public takip. ikas'ta yok (sadece kargo firması).
- **Stok defteri** (`store.py` ledger + `stock_ledger.py`): append-only, iki kova, trigger-değişmez, sayım/hasar/paketleme.
- **Para güvenliği:** escrow + reconciler, KDV snapshot, fiyat geçmişi (yasal referans fiyat), kısmi iade özdeşliği.
- **Yasal/KVKK katmanı:** consent versiyonlama, yasal borç kütüğü, mesafeli sözleşme.
- **Vitrin:** sürümlü + zaman-pencereli yayın (GiST çakışma yasağı), blok/ürün atıf ölçümü.
- **Rol ayrımı:** ADMIN/TUTOR/CLIENT/LIBRARY_OPERATOR/COURIER + sahiplik-bazlı yetki. ikas tek satıcı (staff RBAC).

---

## 15. Önceliklendirilmiş Yol Haritası

**P0 — en yüksek getiri, iş modeline özgü:**
1. **Ürün Kişiselleştirme motoru** (§4) — kırtasiye/kitapta doğrudan gelir.
2. **Kargo tarife motoru** (§5) — mevcut tek-eşik sistem yetersiz; bölge+kural.

**P1 — büyük değer:**
3. **Kampanya motoru** (§8) + **Müşteri grup/segment** (§9) — birlikte.
4. **Ödeme: taksit + havale** (§6) — dönüşüm.
5. Ürüne **maliyet + desi** alanları (§2) — kâr raporu + kargo girdisi.
6. **Fiyat Listesi** (§13b) — B2B/segment fiyatlandırma; kampanya+kargo "fiyat listesi başına" davranışının önkoşulu. 3+6 birlikte tasarlanmalı.

**P2 — iyileştirme:**
6. Checkout konfigürasyon yüzeyi (§10) + store credit.
7. Manuel/draft sipariş (§11).
8. Vergi dahil/hariç B2B modu (§7).
9. AI ürün açıklaması (§2) — Gemini API mevcut, düşük efor.

**Ertelenen:** çok dil (§12), pazarlama suite (§13), çok-kanal storefront.

---

## 16. Kapsam beyanı (dürüstlük)

**Canlı panelde derin gezilen (form seviyesinde):** ürün tipleri + Basit/Varyantlı form, varyant drawer+matris, Tanımlamalar (10 tip), Ürün Kişiselleştirme (tam), Özel Alanlar, Vergi, Kargo (kural+koşul), Ödeme (sağlayıcı+yöntem), Kampanya (otomatik, tam form), Sipariş (manuel/draft), Müşteri formu, Checkout/Müşteri Ayarları (tam), Lokalizasyon, Biçimlendirme Kuralları (Para Birimi + Sipariş No formatı), Dashboard metrikleri.

**Üst düzey haritalanan (derin form görülmedi — SPA erişim zorluğu veya bizde zaten olgun):** Pazarlama suite (Otomasyon/Segment/Popup/Affiliate — alt menü DOM'a render olmadı), Paket Ürün detayı, Fiyat Listesi formu (ürün gerektirdi; HAR şemasından çıkarıldı), Personel/RBAC (bizde olgun), İade Ayarları, Kupon formu (Kampanya'ya çok benzer), Marka/Ürün Birimi/Kategori formları, Raporlar modülü, Stok Lokasyonları/Transferler/Satın Alma, Kargo Etiketi, Diller ve Çeviriler.

**Canlı test yapılan (kullanıcı onayıyla, deneme mağazasında kalıcı):** test ürünü "9. Sınıf Matematik Soru Bankası" ₺250 eklendi → 50 adet stok eklendi → Kapıda Ödeme (Nakit) yöntemi eklendi. Bunlar storefront'u müşteri gözüyle test etmek içindi.

**Erişilemeyen (para/plan duvarı — analiz eksikliği değil, platform kısıtı):**
- **Canlı storefront** (gerçek sepet→checkout görsel akışı): FREEMIUM deneme planında canlı `.ikas.shop` açılmıyor; 5 yol denendi (direkt URL, önizleme ×2, SEO ekranı, onboarding), hepsi lisans-satın-alma duvarına çarptı. Checkout *davranışı* admin'de (Müşteri Ayarları) görüldü.
- **Pazarlama modülü** (Segment/Otomasyon/E-Posta&SMS/Popup/Affiliate): plan-kilitli — açıkça *"Planınızı yükseltin"* diyor.
- Ana menü bazı modülleri (Uygulamalar/Raporlar/Gelen Kutusu) SPA'da dashboard'a düşüyor veya renderer donuyor.

**Not:** serhatkiyar hesabı lisans-dolu olduğu için analiz adanaozelders (deneme aktif) üzerinden yapıldı. Silme/kalıcı-yıkıcı işlem yapılmadı; yalnız test amaçlı ürün/stok/ödeme eklendi.

## Ek A — Çalışma referansları
- Ham keşif notları: gece toplanan modül modül DOM/ekran dökümleri (scratchpad).
- HAR API şeması: 22 GraphQL varlığı (ayrı HAR analizi).
- Kod haritası: kendi `backend/models` + `services` envanteri (§2-14 "Bizde" satırları).

## Ek B — Gözlemlenen URL desenleri (ikas)
- Ürün: `/admin/product/{simple|variant|bundle}/new`, `/admin/product/definitions[/options|/categories]`
- Ayarlar: `/admin/settings[/tax]`, kanal: `/admin/storefront/{sfId}/{shipping|payment|customer-settings|localization}`
- İndirim: `/admin/discount/{campaigns|automatic/new}`, Sipariş: `/admin/order/new`, Müşteri: `/admin/customer/new`
