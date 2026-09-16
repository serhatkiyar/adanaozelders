# P0 Uygulama Tasarımı — Ürün Kişiselleştirme Motoru

**Durum:** TASLAK — uygulama öncesi kullanıcı onayı bekliyor. Kod değiştirilmedi.
**Kaynak:** ikas canlı panel analizi (`docs/ikas-admin-panel-arastirmasi.md` §4) + mevcut kod tabanı (`backend/models/store.py`).
**Amaç:** Müşterinin üründe seçtiği/girdiği kişiselleştirme (gravür, isim baskısı, hediye notu, özel kapak, dosya yükleme) — fiyat etkili, koşullu, zorunlu — sipariş kalemine taşınır. Fiyat **sunucuda** hesaplanır.

> Bu, ikas'ın "Ürün Kişiselleştirmeleri" (Tanımlamalar) + üründeki "Ürün Özelleştirmesi" akışının bize uyarlanmış hâlidir. ikas'ta 7 alan tipi, opsiyonel ücret (fiyat listesi başına), koşullu görünürlük ve zorunluluk vardı.

---

## 1. Kapsam

**Dahil:** merkezi kişiselleştirme seti tanımı; ürüne set bağlama; storefront'ta dinamik form; sepet/sipariş taşıma; sunucu tarafı fiyat + zorunluluk + koşul doğrulama; dosya tipi için `private/` + imzalı URL.
**Hariç (sonraki faz):** fiyat listesi başına farklı ücret (fiyat listesi kavramı bizde henüz yok — §Notlar), varyant × kişiselleştirme çapraz kuralları.

## 2. Veri modeli

Yeni dosya: `backend/models/product_personalization.py`. `models/__init__.py`'ye import + `__all__`, Alembic migration.

```
PersonalizationSet            # merkezi tanım (ikas: "Ürün Kişiselleştirmesi")
  id, name (dahili ad), created_at/updated_at, deleted (soft-delete mixin)

PersonalizationOption         # sete bağlı bir alan
  id, set_id (FK→sets, CASCADE), order (int)
  label            # müşteriye görünen başlık (ikas: "Ürün Sayfasındaki Başlık")
  help_text        # opsiyonel ek açıklama
  type             # enum: BOOLEAN|SELECT|MULTISELECT|COLOR|DATE|FILE|TEXT|PARAGRAPH
  required (bool)  # zorunluluk
  conditional_on_option_id (FK→options, nullable)   # koşullu görünürlük
  conditional_on_value                              # hangi değer seçilince aktif
  price (Numeric(10,2), default 0)                  # ek ücret (KDV DAHİL — sistem geneli)
  price_type       # enum: FIXED (şimdilik tek; ileride PER_CHAR vb.)
  # tip-özel ayarlar JSONB: {min,max} metin; {allowed_ext,max_size} dosya; {min,max} tarih
  settings (JSONB, default {})

PersonalizationOptionValue    # SELECT/MULTISELECT/COLOR seçenek değerleri
  id, option_id (FK→options, CASCADE), order
  value            # etiket
  color_hex        # COLOR tipinde
  price (Numeric(10,2), default 0)   # değer başına ek ücret (ikas'ta var)
```

Kısıtlar: `price >= 0` CHECK; enum'lar SQL CHECK (mevcut `VARIANT_AXES` deseni gibi sabit liste + CHECK); `conditional_on_option_id` aynı set içinde olmalı (uygulama katmanında doğrula, yetim referans yasağı).

`Product`'a (store.py): `personalization_set_id: FK→personalization_sets, nullable, SET NULL`. Ürün silinince set kalır; set silinince ürün NULL'a düşer.

`OrderItem`'a (store.py, snapshot deseni — mevcut `digital_asset_*` ile aynı mantık):
```
personalization_data (JSONB, nullable)   # [{option_id, label, type, value, price}] snapshot
personalization_price (Numeric(10,2), default 0)  # kişiselleştirme ek ücreti (unit_price'a DAHİL)
```
Snapshot şart: set sonradan değişse bile sipariş sabit kalır (OrderItem docstring'deki ilkeyle tutarlı). Dosya tipi değeri `private/` anahtarını tutar, açık URL değil.

## 3. Servis: `backend/services/personalization_service.py`

`variant_service` desenini izler (fiyat + kural sunucuda). İki ana fonksiyon:

- `validate_and_price(set, submitted: dict) -> (snapshot: list, extra_price: Decimal)`:
  1. Zorunlu alanlar dolu mu (koşul aktifse).
  2. Koşullu alanlar: `conditional_on_option_id` değeri sağlanmadıysa o alan **yok sayılır** (fiyata girmez).
  3. Tip doğrulama: SELECT değeri geçerli mi, dosya uzantısı `allowed_ext` içinde mi, metin `min/max`, tarih aralığı.
  4. Fiyat: option.price + seçili value.price (KDV dahil). **İstemciden gelen fiyat GÜVENİLMEZ** — sunucuda set/option'dan yeniden hesaplanır (CLAUDE.md: fiyat sunucuda).
  5. Snapshot üret (label + değer + hesaplanan fiyat).
- Sepete ekleme / sipariş oluşturmada çağrılır; `OrderItem.unit_price`'a `extra_price` eklenir, `personalization_price`'a yazılır, `tax_amount` KDV-dahil mantığıyla güncellenir (`services/tax.py`).

## 4. API

`backend/api/routers/` (mevcut ürün router deseni + admin RBAC):
- **Admin (yetki: products.write veya yeni `personalization.write`):** set CRUD, option CRUD, ürüne set bağla. `router.py`'ye kaydet.
- **Public (anon storefront):** ürün detayında `GET /products/{id}` yanıtına `personalization_set` (option'lar + değerler + fiyatlar) eklenir. Fiyatlar gösterim amaçlı; asıl hesap sunucuda.
- **Dosya yükleme:** kişiselleştirme dosyası `private/` altına, imzalı kısa-ömürlü URL (mevcut hassas dosya deseni — CLAUDE.md).

## 5. Frontend (`frontend/src`)

- `api/axios.ts` + React Query hook: `usePersonalizationSet` (admin), ürün detay hook'una set dahil.
- Ürün detayında dinamik form bileşeni: tip başına input (checkbox/select/renk/tarih/dosya/metin/paragraf), koşullu görünürlük (React state), canlı fiyat önizleme (gösterim; asıl sunucu).
- Sepet/sipariş kaleminde kişiselleştirme özeti + ek ücret satırı.
- Admin `/panel` altında set editörü (ikas'ın drawer akışı referans: alan ekle → tip + fiyat + ayarlar).
- Rota kaynağı `lib/routes.ts`.

## 6. Migration ve doğrulama

- Alembic revision: 4 yeni tablo + Product/OrderItem kolonları. İfade indeksi gerekirse `_norm`/`_trgm` ekiyle (migration zinciri kuralı). Zincir doğrusal kalır.
- Testler (bug/kritik iş kuralı olduğu için — CLAUDE.md doğrulama politikası):
  - `validate_and_price`: zorunlu eksik → hata; koşullu alan yok sayma; fiyat sunucu-hesabı istemci değerini yok sayar; dosya uzantı reddi.
  - Sipariş snapshot değişmezliği (set sonradan değişince eski sipariş sabit).
  - KDV: ek ücretin `tax_amount`'a doğru yansıması.
- `upgrade head` taze DB'yi kurmalı; mevcut kirli worktree korunur.

## 7. Fazlama (paket paket onay — feedback_delivery_gates)

1. **Faz 1:** modeller + migration + servis + testler (backend, UI yok). Onay.
2. **Faz 2:** admin set editörü + ürüne bağlama. Onay.
3. **Faz 3:** storefront dinamik form + sepet/sipariş taşıma + dosya yükleme. Onay + gerçek Chrome duman turu.

## Notlar / açık kararlar (sabah kullanıcıya)

- **Fiyat listesi bağı:** ikas'ta ek ücret "fiyat listesi başına" ayarlanabiliyor. Bizde fiyat listesi henüz yok (bkz. ana rapor §13b). Bu faz **tek fiyat** varsayar; fiyat listesi gelince genişletilir.
- **KDV oranı:** kişiselleştirme ek ücretinin KDV oranı = ürünün oranı mı, sabit mi? (Mali müşavir kararı — ürün `tax_rate`'i miras almak en tutarlısı.)
- **Dosya boyutu/tipi limitleri:** ikas 10 MB kullanıyor; bizim değer.
- **Hangi ürünlerde:** kitap/kırtasiye kolunda mı yoksa tüm mağazada mı? (Ürün bazlı opsiyonel FK olduğu için ürün başına karar.)
