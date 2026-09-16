# P0 Uygulama Tasarımı — Kargo Tarife Motoru

**Durum:** TASLAK — uygulama öncesi kullanıcı onayı bekliyor. Kod değiştirilmedi.
**Kaynak:** ikas canlı panel (`docs/ikas-admin-panel-arastirmasi.md` §5) + mevcut `backend/services/order_service.py:265` `compute_shipping`, `backend/core/config.py:216`.
**Amaç:** Tek global eşik + sabit ücret (`.env`) yerine, **bölge × teslimat yöntemi × N kural** tabanlı, admin panelinden yönetilen kargo ücreti motoru.

> ikas modeli: Kural Seti = Ülke × Teslimat Yöntemi (Standart/Hızlı) × Bölge × N Kural. Her kural: koşul tipi {Sipariş Fiyatı | Ürün Desisi} + Min/Max + Fiyat (veya Ücretsiz) + fiyat listesi + ad + depo.

---

## 1. Mevcut durum ve hedef

**Mevcut** (`compute_shipping(subtotal, has_physical)`): dijital-yalnız → 0; fiziksel + `subtotal ≥ SHIPPING_FREE_THRESHOLD(500)` → 0; aksi `SHIPPING_FLAT_FEE(49.90)`. Bölge yok, desi yok, tek kural, `.env`.

**Hedef:** aynı fonksiyon imzası korunur ama içi **kural motoru** olur. `.env` değerleri **fallback** kalır (hiç kural tanımlı değilse eski davranış). Kendi-filo teslimat (`delivery.py`) ile çakışmaz — o "nasıl teslim edilir", bu "ne kadar ücret".

## 2. Veri modeli

Yeni dosya: `backend/models/shipping_rate.py`. `models/__init__.py` + Alembic.

```
ShippingZone
  id, name, country_code (default "TR")
  # kapsam: boşsa "tüm ülke"; doluysa il/ilçe listesi
  districts (JSONB list) veya ayrı ShippingZoneDistrict tablosu
  order, deleted, timestamps

ShippingRateSet                # bir zone için bir teslimat yöntemi
  id, zone_id (FK→zones, CASCADE)
  delivery_method   # enum: STANDARD | EXPRESS(Hızlı)
  active (bool), order, timestamps
  # EXPRESS için gün/saat penceresi (ikas "Hızlı Teslimat"): settings JSONB
  #   {active_days:[{day, start, end}], eta:{type,value}}

ShippingRate                   # sette bir fiyat kuralı
  id, rate_set_id (FK→sets, CASCADE), order
  name              # müşteriye görünen ("Ücretsiz Kargo")
  condition_type    # enum: ORDER_PRICE | DESI
  min_value (Numeric, nullable)   # ve-eşittir dahil
  max_value (Numeric, nullable)   # üst sınır (dışlayan)
  price (Numeric(10,2))           # 0 = ücretsiz
  # price_list_id → SONRAKI FAZ (fiyat listesi bizde yok)
```

Kısıtlar: `price >= 0`, `min_value >= 0`, `max_value > min_value` (ikisi de doluysa) CHECK. Aynı rate_set içinde aralıklar örtüşmemeli (uygulama katmanında doğrula + test).

`Product`'a: `desi: Numeric(6,2), nullable` (ikas'ta var; DESI koşul tipinin girdisi). NULL → 0 sayılır veya varsayılan.

## 3. Servis: `backend/services/shipping_service.py`

`compute_shipping`'i buraya taşı/genişlet (saf + test edilebilir kalsın):

```
resolve_shipping(subtotal, total_desi, has_physical, district=None, method=STANDARD) -> Decimal:
  1. has_physical False → 0 (dijital-yalnız kuralı KORUNUR).
  2. district → eşleşen ShippingZone (yoksa "tüm ülke" zonu).
  3. zone + method → ShippingRateSet (yoksa fallback: .env eşik mantığı).
  4. koşula uyan ShippingRate seç:
       ORDER_PRICE: min ≤ subtotal < max
       DESI:        min ≤ total_desi < max
     Birden çok uyarsa en düşük fiyat (veya order'a göre ilk).
  5. eşleşme yoksa fallback SHIPPING_FLAT_FEE.
```

`order_service.compute_totals` bunu çağırır; toplam desi = Σ(product.desi × qty). **Fiyat sunucuda** (CLAUDE.md). İstemci kargo tutarı göndermez/güvenilmez.

## 4. Geriye uyumluluk

- Hiç zone/rate tanımlı değilse `resolve_shipping` == eski `compute_shipping` (SHIPPING_FREE_THRESHOLD/FLAT_FEE). Yani migration sonrası davranış **aynı**; kural eklendikçe motor devreye girer.
- Mevcut `compute_shipping(subtotal, has_physical)` imzası korunur (delegator) → çağıran kod kırılmaz.

## 5. API + Admin UI

- Admin (yetki: `shipping.write` veya mevcut ayar yetkisi): zone CRUD, rate set CRUD, rate CRUD. `router.py` kaydı. UI referansı: ikas'ın inline kural tablosu (Kural Adı | Koşul | Min/Max | Fiyat).
- Checkout: `district` (il/ilçe) → kargo ücreti hesabı; dijital-yalnız → kargo adımı gizlenir (ikas'taki gibi, mevcut mantık korunur).
- Frontend: React Query hook; admin `/panel` altında bölge+kural editörü; `lib/routes.ts`.

## 6. Migration ve doğrulama

- Alembic: yeni tablolar + `Product.desi`. Zincir doğrusal.
- Testler (kritik para/iş kuralı — test matrisi koddan ÖNCE, feedback_delivery_gates):
  - Fallback == eski davranış (kural yokken).
  - ORDER_PRICE eşik: sınır değerleri (min dahil, max dışlayan).
  - DESI koşulu: desi hesabı + eşik.
  - Bölge eşleşme: il/ilçe → doğru zone; eşleşmeyen → tüm-ülke fallback.
  - Dijital-yalnız → 0 (korunmalı).
  - Aralık örtüşme reddi.
- `upgrade head` taze DB; kirli worktree korunur.

## 7. Fazlama (paket paket onay)

1. **Faz 1:** modeller + migration + `resolve_shipping` + fallback + testler (davranış değişmez). Onay.
2. **Faz 2:** admin zone/kural editörü. Onay.
3. **Faz 3:** checkout'ta bölge-bazlı hesap + Product.desi girişi + Hızlı Teslimat penceresi (opsiyonel). Onay + duman turu.

## Notlar / açık kararlar (sabah)

- **İl/ilçe kaynağı:** frontend'de `lib/adanaYerler.ts` (440 mahalle) + `lib/districts.ts` var; backend'de referans tablo yok. Zone kapsamı için ilçe listesi yeter (mahalle gerekmez başta).
- **Hızlı Teslimat vs kendi-filo:** ikas "Hızlı Teslimat"ı gün/saat pencereli. Bizde bu zaten `delivery.py` + `delivery_promise.py`'de var (kendi filo). Ticari kargo tarafında EXPRESS'i şimdilik ertele; STANDARD yeter.
- **Desi mi ağırlık mı:** ikas "Ürün Desisi" kullanıyor (hacimsel). Product.desi tek alan; kargo firması entegrasyonu gelince netleşir.
- **Fiyat listesi başına kargo:** fiyat listesi gelince (ana rapor §13b) eklenir.
