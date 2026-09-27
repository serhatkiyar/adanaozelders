# Medusa v2 vs Adana Özel Ders — Tur 2: Siparişler, Müşteriler, Kampanyalar, Ayarlar

Tarih: 2026-08-19 · Yöntem: her iki taraf da kaynak koddan okundu.
Önceki turlar: `docs/arsiv/medusa/medusa-karsilastirma-raporu.md` (ürün+envanter) · `docs/arsiv/medusa/medusa-arayuz-karsilastirma.md` (arayüz).

Kısaltmalar: `M:` → `medusa2/node_modules/@medusajs/` · `B:` → `adana-main/`

**İş modeli filtresi:** Adana'da yerel kitap+kırtasiye, kendi kurye filosuyla şehir içi teslimat + il dışı kargo, tek kişilik şahıs firması, TRY, TR, tek satış kanalı.

---

## 1. Karşılaştırma tabloları

### A. SİPARİŞLER

| Özellik | Medusa | Bizde | Karar |
|---|---|---|---|
| Sipariş modeli | `Order` + `version` + `OrderSummary` (json totals) + `OrderTransaction` (`M:order/dist/models/order.js:12-127`) | `Order` tek tablo, tutarlar kolon (`subtotal/shipping_fee/discount/total` + KDV kırılımı) (`B:backend/models/store.py:610-838`) | — |
| Durum alanları | `status`: pending/completed/draft/archived/canceled/requires_action. **`payment_status` ve `fulfillment_status` DB'de YOK** — Fulfillment/Payment modüllerinden remote-join ile hesaplanıyor (`M:order/dist/schema/index.js:1`, `core-flows/.../aggregate-status.js:5-139`) | `status`: PENDING/PAID/SHIPPED/DELIVERED/CANCELLED/REFUNDED + **ayrı `payment_status` kolonu** (PENDING/PAID/FAILED/REFUNDING/REFUNDED/MANUAL_REVIEW) | — |
| Durum geçiş guard'ı | Kısmi: `archive_`/`completeOrder_` guard'lı ama **`cancel_` guard'sız** (`M:order/dist/services/order-module-service.js:1797-1819`) | **Tam FSM** — `B:backend/services/order_fsm.py`, geçersiz geçiş 409 + `OrderStatusHistory` satırı | **Bizde daha iyi** |
| Kısmi gönderim | **VAR** — kalem+miktar bazlı, çoklu fulfillment (`M:core-flows/dist/order/workflows/create-fulfillment.js:237-422`) | **YOK** — `mark_shipped` sipariş bazında atomik (`B:backend/services/order_service.py:1586-1622`) | **SONRA** |
| Kısmi iptal | Fulfillment granülerliğinde; **satır-içi kısmi iptal Medusa'da da yok** (kod notu: `cancel-order-fulfillment.js:77-83`) | **YOK** — `_cancel_order` tümü-ya-hiçbiri (`order_service.py:2188-2246`) | **SONRA** |
| İade (Return) | Draft-and-confirm: begin → request-item → confirm → receive-item → confirm-receive. `PARTIALLY_RECEIVED` durumu, `received_quantity`+`damaged_quantity` (`M:order/dist/models/return-item.js:8-56`) | RMA: talep → (CAYMA otomatik onay) → admin onay/ret → **fiziksel kabul** (`accepted_quantity`/`damaged_quantity`, SALEABLE/DAMAGED kova) (`B:order_service.py:2439-2733`) | **Denk** |
| Cayma hakkı (m.9) | Yok (yasal özel durum kavramı yok) | **VAR** — CAYMA türü admin onayı beklemez, satıcı reddedemez (`reject_return` 409) | **Bizde fazla** |
| MANUAL_REVIEW kuyruğu | Yok | **VAR** — iade deneme tavanı dolunca kayıt manuel-inceleme kuyruğuna düşer | **Bizde fazla** |
| Değişim (Exchange) | **VAR** — zorunlu çift: inbound `RETURN_ITEM` + outbound `ITEM_ADD` (`M:core-flows/dist/order/workflows/exchange/confirm-exchange-request.js:51-56`) | **YOK** | **SONRA** |
| Claim / write-off | **VAR** — üç varyant: saf refund (`WRITE_OFF_ITEM`, fiziksel iade beklemeden), iadeli, değişimli (`M:.../claim/claim-item.js:75-141`) | Kısmen: para iadesi zaten fiziksel kabulden bağımsız yürüyor — write-off davranışı fiilen mevcut | **GEREKSİZ** (ayrı kavram gerekmiyor) |
| Draft order (admin müşteri adına sipariş) | **VAR** — ayrı tablo değil, `Order` + `is_draft_order` bayrağı + `status:draft`; `convert-to-order` ucu (`M:medusa/dist/api/admin/draft-orders/route.js:31-84`) | **YOK** | **GEREKLİ** |
| Sipariş düzenleme (kalem ekle/çıkar) | **VAR** — `OrderChange`/`OrderChangeAction` motoru, begin→request→confirm; fiyat farkı pozitifse yeni payment collection, negatifse **otomatik iade YOK**, admin ayrıca tetikler | **YOK** | **SONRA** |
| Fatura / irsaliye | **YOK** — grep ile doğrulandı; `"invoice"` tek eşleşme JSDoc örneği, `"pdf"` sıfır sonuç | Fatura verisi **anlık türetiliyor** (`B:backend/services/invoice_service.py`), kalıcı `Invoice` tablosu / seri-sıra numarası / PDF **yok**; `INVOICE_ENABLED` üretimde kapalı | **Bizde fazla, ama eksik** (aşağıda) |
| Sipariş listesi — arama | `q` serbest metin | **YOK** | **GEREKLİ** |
| Sipariş listesi — sıralama | display_id, created_at, updated_at | **YOK** (sabit `created_at DESC`) | GEREKLİ (küçük) |
| Sipariş listesi — sayfalama | Var (`offset`) | **YOK** — backend destekliyor, frontend göndermiyor; ilk 100 gösterilip "kesilmiş olabilir" amber uyarısı çıkıyor | **GEREKLİ** |
| Sipariş listesi — filtre | region, sales_channel, tarih. **`payment_status`/`fulfillment_status` filtreleri kodda devre dışı** (TODO: "enable when Payment, Fulfillments ↔ Orders are linked") | Yalnız `status` (URL query, beyaz listeli) | **Denk** |
| Toplu işlem | Yok (yalnız Export) | Yok | GEREKSİZ |
| **Sipariş detay ekranı** | **VAR** — bölümlü sayfa: genel, özet, ödeme, fulfillment, müşteri; ~15 aksiyon (`M:dashboard/src/routes/orders/order-detail/order-detail.tsx:66-116`) | **YOK** — admin sipariş detay sayfası hiç yok; tüm bilgi/aksiyon liste satırında | **GEREKLİ** |
| Zaman çizelgesi | Ayrı tablo yok; `OrderChange` + return/claim/exchange kayıtları istemcide birleştirilir; **not özelliği kodda var ama devre dışı** (`const notes:any[]=[]`) | `OrderStatusHistory` **yazılıyor ama admin panelinde hiç gösterilmiyor**; müşteriye whitelist projeksiyonu (`B:services/delivery_timeline.py`) | **GEREKLİ** (ucuz) |
| Admin sipariş iptali | Var | Backend ucu **var** (`POST /store/admin/orders/{id}/cancel`), **UI'dan çağrılmıyor** | **GEREKLİ** (yarım) |
| İade fiziksel kabul | Var (UI'da "Receive items") | Backend ucu **var** (`POST /store/admin/returns/{id}/receive`), **UI'dan çağrılmıyor** | **GEREKLİ — kritik** |

### B. MÜŞTERİLER

| Özellik | Medusa | Bizde | Karar |
|---|---|---|---|
| Müşteri modeli | `Customer` (`M:customer/dist/models/customer.js`) — `has_account`, `company_name`, `metadata` | `Client` (`B:backend/models/client.py:23-83`) — ayrı Customer tablosu yok, unified user table de yok | — |
| **Misafir alışverişi** | **VAR** — `has_account:false` misafir satırı; unique index `(email, has_account)` → aynı e-posta hem misafir hem kayıtlı olabilir (`M:core-flows/dist/cart/steps/find-or-create-customer.js`) | **YOK** — checkout hem backend (`require_roles(CLIENT)`) hem frontend (`ProtectedRoute`) ile kapalı; "guest/misafir" grep sıfır sonuç | **SONRA** (en yüksek değerli SONRA) |
| Adres defteri | Çok adres; **ayrı `is_default_shipping` + `is_default_billing`**, her biri partial-unique | Çok adres; **tek `is_default`** (`B:backend/services/address_service.py:34-56`) | Ayrım **GEREKSİZ** |
| Adres alanları | address_1/2, city, province, postal_code, country_code | title, recipient_name, phone, address_line, city, district (şemada zorunlu), door_no, apt_no, directions, **lat/lng** | **Bizde fazla** (kurye için) |
| Müşteri grubu | **VAR** — `CustomerGroup` + promosyon hedeflemede `customer_group` kural attribute'u | **YOK** | **SONRA** (öğretmen/okul indirimi olursa) |
| Admin müşteri listesi | Ayrı ekran; kolonlar email/ad/has_account/created_at; filtre: gruplar, kayıtlı-misafir, tarih; arama var | Birleşik `/yonetim/kullanicilar` (ADMIN+TUTOR+CLIENT tek liste, UNION ALL); arama/rol/durum filtresi, sıralama, sayfalama var | Denk |
| **Müşteri detayında sipariş geçmişi** | **VAR** — `CustomerOrderSection` | **YOK** — yalnız `order_count` sayısı gösteriliyor (`B:backend/services/admin_service.py:301-305`) | **GEREKLİ** (ucuz) |
| Müşteri notu | **YOK** (Medusa'da da yok — yalnız serbest `metadata`) | Yok | **SONRA** |
| Etiket | `metadata` json | Yok | GEREKSİZ |
| Askıya alma / engelleme | Yok | Client için yok (`is_active` var ama UI aksiyonu yok); tutor için askı FSM'i var | **SONRA** |
| Telefon doğrulama görünürlüğü | — | `phone_otps` var ama admin ekranında **gösterilmiyor** (`AdminUserDetailOut`'ta `phone_verified` alanı yok) | SONRA (küçük) |
| KVKK anonimleştirme | Yok | **VAR** — `B:backend/services/account_deletion_service.py:62-150`; kimlik/iletişim/adres anonimleştirilir, mali kayıt ve tutarlar korunur, `auth_version++` ile oturumlar düşer | **Bizde fazla** |

### C. KAMPANYA / İNDİRİM

| Özellik | Medusa | Bizde | Karar |
|---|---|---|---|
| Model | `Promotion` + `ApplicationMethod` + `PromotionRule`(+Value) + `Campaign` + `CampaignBudget`(+Usage) | Tek `Coupon` + `CouponRedemption` (`B:backend/models/store.py:912-978`) | — |
| Yüzde / sabit tutar | VAR (`type: percentage|fixed`) | **VAR** (`PERCENT`/`FIXED`) | — |
| **Kargo bedava kuponu** | VAR — ayrı tip değil: `target_type:"shipping_methods", type:"percentage", value:100` | **YOK** (sabit `SHIPPING_FREE_THRESHOLD` eşiği var, kupon yok) | **GEREKLİ** (küçük) |
| **Ürün / kategori hedefleme** | VAR — kural attribute'ları: `product`, `product_category`, `product_collection`, `product_type`, `product_tag` | **YOK** — kupon yalnız sepet `subtotal`'ına uygulanıyor, hiçbir hedef alanı yok | **GEREKLİ** |
| X al Y öde (buyget) | VAR — `type:"buyget"` + `buy_rules_min_quantity`/`apply_to_quantity`/`max_quantity`, iteratif motor (`M:promotion/dist/utils/compute-actions/buy-get.js`) | **YOK** | **SONRA** |
| Otomatik indirim (kodsuz) | VAR (`is_automatic`) | **YOK** — her şey `coupon_code` string'ine bağlı | **SONRA** |
| Kural motoru | 7 operatör (eq/ne/in/gt/gte/lt/lte) modelde; **admin UI yalnız 3'ünü sunuyor** (in/eq/ne). Attribute listesi sabit kodlu (`M:medusa/dist/api/admin/promotions/utils/rule-attributes-map.js`) | Kolon bazlı sabit koşullar: `min_subtotal`, `valid_from`/`valid_until`, `max_uses`, `per_user_limit`, `is_active` | — |
| Müşteri başına limit | Dolaylı — `CampaignBudget` + `USE_BY_ATTRIBUTE` + `attribute:"customer_id"` | **Doğrudan `per_user_limit` kolonu** | **Bizde daha basit/iyi** |
| Kampanya + bütçe | VAR — spend/usage/use_by_attribute bütçe tipleri | **YOK** ("kampanya" kodda yalnız bir yorum satırında geçiyor) | **GEREKSİZ** |
| Eşzamanlılık | `registerUsage()` — `orderBy("id").forUpdate()` + `SET LOCAL lock_timeout='3s'`, transaction dışı çağrı yasak (`M:promotion/dist/services/promotion-module.js:132-278`) | `redeem()` — `Coupon` satırı `.with_for_update()`, limitler **kilit altında yeniden** doğrulanır; sayım yalnız PAID'de (`B:backend/services/coupon_service.py:105-155`) | **Denk** |
| İade'de kupon | — | `release()` idempotent, `used_count--`; **kısmi iadede serbest bırakılmaz** (tüketilmiş sayılır) | Bizde net kural |
| KDV ile ilişki | `is_tax_inclusive` bayrağı | İndirim satırlara en-büyük-artıkla dağıtılır, vergi `brüt − pay` üzerinden (`B:backend/services/tax.py:130-158`) | Denk |
| Kupon durumu | `status`: draft/active/inactive | `is_active` bool | GEREKSİZ |
| **Admin: geçerlilik tarihi alanı** | Var | **Backend + şema destekliyor, formda alan YOK** (`B:AdminStore.tsx:2096-2149`) | **GEREKLİ — yarım** |
| **Admin: kupon düzenleme** | Tam form | **Yalnız aktif/pasif toggle** — değer/limit/tarih düzenlenemiyor | **GEREKLİ** |
| Admin: kullanım raporu | Kampanya bütçe kullanımı | **YOK** — yalnız `used_count/max_uses` sayısı | SONRA |
| Oluşturma UX'i | 3 adımlı sihirbaz (TYPE→PROMOTION→CAMPAIGN) + şablonlar | Tek form | SONRA |
| "En düşük 30 gün" yasal referans fiyat | **YOK** | **VAR** — `ProductPriceHistory` + `legal_compare_price` (dayanaksız indirim iddiası gösterilmez) | **Bizde fazla** |

### D. AYARLAR

| Özellik | Medusa | Bizde | Karar |
|---|---|---|---|
| **Kargo ücreti / tarife** | `ShippingOption` + `price_type` FLAT/CALCULATED + kural bazlı fiyat, admin'den yönetiliyor | **`.env` sabiti** — `SHIPPING_FLAT_FEE=49.90`, `SHIPPING_FREE_THRESHOLD=500` (`B:backend/core/config.py:201-202`); değiştirmek **deploy gerektiriyor** | **GEREKLİ** |
| Ağırlık bazlı tarife | CALCULATED ile mümkün | Yok (`Product.weight_grams` var ama kullanılmıyor) | SONRA |
| **Teslimat bölgesi** | `ServiceZone`+`GeoZone` (country/province/city/zip); **dashboard yalnız "country" formu sunuyor** | İlçe listesi **`.env` sabiti** — `DELIVERY_ZONE_DISTRICTS=[Seyhan,Yüreğir,Çukurova,Sarıçam]` (`config.py:275`); ilçe eklemek deploy gerektiriyor | **GEREKLİ** |
| Araç / kurye / kapalı gün / toplama noktası | Yok (kendi filo kavramı yok) | **Tam admin CRUD** (`B:backend/api/routers/delivery.py:155-192, 309-492`) | **Bizde fazla** |
| Ödeme sağlayıcı ayarı | Region bazlı, admin'den seçilir (link modülü) | `.env` (`PAYMENT_PROVIDER`); admin yalnız **ödeme kolu bayraklarını** açıp kapatabiliyor (`payment_gates`, PK-1) | GEREKSİZ (tek sağlayıcı) |
| Vergi ayarları | `TaxRegion` (nested province) + `TaxRate` (`is_default` + kural bazlı override, 6 kademeli öncelik) + `TaxRateRule` (product/product_type/shipping_option) | Ürün `tax_rate` (zorunlu) + kategori `default_tax_rate` mirası — **UI'dan yönetiliyor** (`B:AdminStore.tsx:1522-1536`) | Denk; bölge bazlı vergi **GEREKSİZ** |
| `SHIPPING_TAX_RATE` | — | `.env`, varsayılan `None`; boşken kırılım `complete=False`, `tax-health` ucu eksikleri sayıyor | **SONRA** (tek seferlik, mali müşavir) |
| Kullanıcı daveti | `Invite` modeli, JWT token, 24 saat | **YOK** — admin `seed.py` ile yaratılıyor | **GEREKSİZ** |
| Rol / izin (RBAC) | `@medusajs/rbac` **feature-flag arkasında, varsayılan KAPALI** (`MEDUSA_FF_RBAC`) | **Açık ve çalışıyor** — `AdminRole`/`AdminPermission`/`AdminRoleAssignment`, 28 izin, 5 sistem rolü, `/yonetim/erisim` UI'ı | **Bizde fazla** |
| Şifre sıfırlama (admin→kullanıcı) | — | Backend ucu **var** (`POST /admin/users/reset-password`, e-posta linki + token iptali), **UI'dan çağrılmıyor** | **GEREKLİ — yarım** |
| Audit log | **YOK** | **VAR** — `audit_logs` (before/after JSONB, redaction zorunlu, append-only) + filtreli admin ekranı | **Bizde fazla** |
| Para birimi / dil | `Store.supported_currencies` + `supported_locales`; `/translations` ekranı (flag'li) | Sabit TRY/TR | **GEREKSİZ** |
| İşletme bilgileri | Store adı | `OPERATOR` sabiti `B:frontend/src/lib/legalContent.ts:24-38` — UI'dan düzenlenemez | **SONRA** |
| API anahtarı yönetimi | `ApiKey` (publishable/secret, scrypt hash, revoke + gecikmeli revoke) | **YOK** | **GEREKSİZ** |
| E-posta şablonu ayarı | — | Kod içinde sabit (`B:backend/core/mail/templates.py`), DB/editör yok | **SONRA** |
| Feature flag | Kod içi (`MEDUSA_FF_*` env) | **DB tablosu + admin UI** (gerekçe zorunlu, audit'li) (`B:backend/models/feature_flag.py`) | **Bizde fazla** |

---

## 2. GEREKLİ işaretlenenler ve kaba büyüklükleri

| # | İş | Neden | Büyüklük |
|---|---|---|---|
| 1 | **İade fiziksel kabul UI'ı** (`POST /store/admin/returns/{id}/receive`) | **Stoğun geri döndüğü tek nokta.** Backend hazır, hiçbir ekrandan tetiklenemiyor → onaylanan iadelerde mal stoğa hiç dönmüyor olabilir | ~1 gün (backend hazır) |
| 2 | **Admin sipariş detay sayfası** | Şu an detay ekranı hiç yok; tüm bilgi ve aksiyon liste satırında sıkışmış | ~2 gün |
| 3 | **Sipariş listesinde sayfalama** | Backend `limit`/`offset` destekliyor, frontend göndermiyor; 100+ siparişte "kesilmiş olabilir" uyarısıyla idare ediliyor | ~0.5 gün |
| 4 | **Sipariş listesinde arama** (sipariş no / müşteri / telefon) | Telefonla arayan müşterinin siparişini bulmanın yolu yok | ~0.5 gün (backend'e de eklenecek) |
| 5 | **Admin sipariş iptali butonu** (`POST /store/admin/orders/{id}/cancel`) | Backend hazır (gerekçe zorunlu, telafi kuyruğu çalışıyor), UI yok | ~0.5 gün |
| 6 | **Sipariş zaman çizelgesi (admin)** | `OrderStatusHistory` zaten yazılıyor, hiçbir yerde gösterilmiyor — "kim ne zaman ne yaptı" görünmüyor | ~0.5 gün |
| 7 | **Draft order** (admin müşteri adına sipariş) | Telefon/WhatsApp siparişi yerel kitapçıda gerçek kanal; şu an sisteme hiç giremiyor. Medusa deseni ucuz: ayrı tablo değil, `is_draft_order` bayrağı + `convert` ucu | ~3 gün |
| 8 | **Kupon geçerlilik tarihi alanları** | Backend + şema destekliyor, admin formunda alan yok — yarım özellik | ~2 saat |
| 9 | **Kupon düzenleme formu** | Bugün yalnız aktif/pasif toggle var; yanlış girilen bir kupon düzeltilemiyor, silinip yeniden açılıyor | ~0.5 gün |
| 10 | **Kargo bedava kuponu** | Kitapçıda en sık kampanya; sabit eşik var ama kuponla verilemiyor | ~1 gün |
| 11 | **Kupon ürün/kategori hedefleme** | "Tüm kırtasiyede %20" gibi kampanya bugün imkânsız — kupon yalnız sepet toplamına uygulanıyor | ~2 gün |
| 12 | **Kargo ücreti + ücretsiz kargo eşiği admin UI'ına** | 49.90 → 59.90 değişikliği bugün deploy gerektiriyor | ~1 gün |
| 13 | **Teslimat ilçe listesi admin UI'ına** | Yeni ilçeye açılmak deploy gerektiriyor; bölge kontrolünün otoritesi bu liste | ~1 gün |
| 14 | **Müşteri detayında sipariş geçmişi** | `order_count` gösteriliyor ama liste yok — müşteri arayınca geçmişi görülemiyor | ~0.5 gün |
| 15 | **Admin şifre sıfırlama butonu** | Backend ucu hazır ve audit'li, UI yok | ~2 saat |

**Toplam:** ~14 gün.

---

## 3. Bizde olup Medusa'da olmayanlar

1. **Gerçek sipariş FSM'i** — geçersiz geçiş 409 + otomatik `OrderStatusHistory`. Medusa'nın `cancel_`'ında guard bile yok.
2. **Cayma hakkı (m.9) kod seviyesinde** — CAYMA türü otomatik onaylanır, satıcı reddedemez (`reject_return` 409 döner).
3. **MANUAL_REVIEW iade kuyruğu** — otomatik iade denemesi tükenince kayıt belirsizlikte bırakılmaz, admin kuyruğuna düşer.
4. **Fatura verisi (KDV kırılımı snapshot'ı)** — Medusa'da fatura/PDF kavramı **hiç yok**; bizde sipariş anındaki oranlarla dondurulmuş kırılım + türetilmiş fatura ucu var.
5. **`tax-health` ucu** — kırılımı eksik kalmış siparişleri sayan sağlık kontrolü.
6. **KVKK anonimleştirme** — kimlik/iletişim/adres anonimleştirilir, mali kayıtlar ve tutarlar korunur, tüm oturumlar düşer.
7. **"En düşük 30 gün" yasal referans fiyat** — `ProductPriceHistory` + `legal_compare_price`; dayanaksız indirim iddiası gösterilmez.
8. **Kupon `per_user_limit`** — Medusa'da bunun için kampanya bütçesi + attribute kurgusu gerekiyor; bizde tek kolon.
9. **Kendi filo operasyonu** — araç/kurye/kapalı gün/toplama noktası CRUD'u, rota optimizasyonu, canlı kurye takibi, OTP+foto teslim kanıtı. Medusa'da bu katman hiç yok.
10. **Kurye için zenginleştirilmiş adres** — alıcı adı, kapı/daire no, tarif, lat/lng.
11. **DB-tabanlı feature flag + gerekçeli değişiklik + audit** — Medusa'nın flag'leri env sabiti.
12. **Audit log** — before/after JSONB, redaction zorunlu, append-only, filtreli admin ekranı. Medusa'da yok.
13. **Açık RBAC** — Medusa'nın RBAC'i `MEDUSA_FF_RBAC` arkasında varsayılan kapalı; bizimki üretimde çalışıyor (28 izin, 5 rol).
14. **Ödeme kolu kapıları (PK-1)** — ürün kolu bazlı ödeme açma/kapama, sağlayıcı yeteneğine bağlı otomatik kilit (pazaryeri kolları iyzico'da kapalı).

---

## 4. "Yarım kalmış özellik" listesi (backend hazır / UI yok) — en ucuz kazançlar

Bu desen bu turda da doğrulandı; **iki bağımsız tarama aynı kritik bulguya ulaştı** (madde 1).

### 4.1 Backend ucu var, frontend hiç çağırmıyor

| Uç | Dosya | Etki | Maliyet |
|---|---|---|---|
| `POST /store/admin/returns/{id}/receive` | `B:backend/api/routers/store.py:720` | **Kritik** — stoğun geri döndüğü tek nokta | Küçük |
| `POST /store/admin/orders/{id}/cancel` | `B:backend/api/routers/store.py:634` | Admin sipariş iptali UI'dan yapılamıyor | Küçük |
| `POST /admin/users/reset-password` | `B:backend/api/routers/admin.py:648` | Güvenli şifre sıfırlama (e-posta linki + token iptali + audit) | Küçük |
| `GET /store/admin/tax-health` | `B:backend/api/routers/store.py:1117` | Vergi kırılımı eksik sipariş sayacı | Çok küçük |

### 4.2 Frontend API fonksiyonu yazılmış, hiçbir bileşen çağırmıyor

| Fonksiyon | Dosya | Ne için | Maliyet |
|---|---|---|---|
| `uploadProductImages` / `deleteProductImage` | `B:frontend/src/api/store.ts:389, 403` | Çoklu ürün görseli (Tur 1'de de çıkmıştı) | Orta |
| `updateVariantGroup` / `deleteVariantGroup` | `B:frontend/src/api/store.ts:473, 484` | Varyant grubu düzenle/sil — create+list var, update/delete yok | Orta |
| `deleteProductReview` | `B:frontend/src/api/store.ts:130` | Ürün yorumu moderasyonu | Küçük |
| `setContentHidden` | `B:frontend/src/api/reports.ts:53` | Şikâyetten bağımsız içerik gizleme | Orta |

### 4.3 Şema/backend destekliyor ama formda alan yok

- **Kupon `valid_from` / `valid_until`** — `AdminStore.tsx:2096-2149` formunda tarih alanı yok. En ucuz kalem (~2 saat).

### 4.4 Ölü zincir / temizlik kalemleri

`useClientSearch` (`api/clients.ts::searchClients` → hook → **hiçbir bileşen**; admin müşteri arama ekranı yok), `useOnPremise`, `useLibraryDistricts`, `useDeleteLibraryReview` — gerçek eksik özellik adayları.
`useAdminStats`, `useAdminBookings`, `useAdminReports`, `useDeliveryFeedback` — eski sürümleriyle değiştirilmiş, silinmemiş; **temizlik** kalemi.
Şüpheli (muhtemelen bilinçli terk): `fetchAdminTutorsByStatus`, `getBookingPayment`.

---

## 5. Bu dört alanda en acil 5 iş

| Sıra | İş | Gerekçe |
|---|---|---|
| **1** | **İade fiziksel kabul UI'ı** | Envanter doğruluğu meselesi, kozmetik değil: iade onaylanıp para dönüyor ama mal stoğa dönmüyor olabilir. Backend hazır. **Önce mevcut iadelerde stok gerçekten döndü mü diye veriye bakılmalı.** (~1 gün) |
| **2** | **Sipariş yönetimi paketi**: detay sayfası + sayfalama + arama + iptal butonu + zaman çizelgesi | Beş kalem de aynı ekrana dokunuyor, birlikte yapılmalı. Sayfalama yokluğu 100 sipariş sonrası veri gizliyor; arama yokluğu telefonla gelen müşteriyi bulunamaz kılıyor. (~3.5 gün) |
| **3** | **Kupon eksikleri**: tarih alanları + düzenleme formu + kargo bedava tipi | İlk ikisi yarım kalmış özellik (2 saat + 0.5 gün), üçüncüsü kitapçının en sık kampanyası. (~2 gün) |
| **4** | **Operasyon ayarlarını `.env`'den admin UI'a**: kargo ücreti/eşiği + teslimat ilçe listesi | Tek kişilik işletmede fiyat ve bölge değişikliği deploy gerektirmemeli. (~2 gün) |
| **5** | **Draft order** (admin müşteri adına sipariş) | Telefon/WhatsApp siparişi bugün sisteme hiç giremiyor — envanter, teslimat ve muhasebe dışında kalıyor. Medusa deseni ucuz: aynı `Order` tablosu + bayrak. (~3 gün) |

**GEREKSİZ işaretlenenler:** kampanya+bütçe motoru, müşteri grubu bazlı fiyatlandırma, bölge bazlı vergi, çoklu para birimi/dil, API anahtarı yönetimi, kullanıcı daveti, satış kanalı, ayrı fatura/teslimat varsayılan adres ayrımı, Claim'in ayrı bir kavram olarak modellenmesi, sipariş listesinde toplu işlem.

**SONRA'ya bırakılanlar:** misafir alışverişi (en yüksek değerli SONRA — dönüşüm kaybı gerçek, ama `track_token` altyapısı zaten var), kısmi gönderim, kalem bazlı kısmi iptal, değişim (exchange), sipariş düzenleme, otomatik indirim, X al Y öde, müşteri notu/askıya alma, ağırlık bazlı kargo tarifesi, e-posta şablonu editörü, `OPERATOR` bilgilerinin UI'dan düzenlenmesi.
