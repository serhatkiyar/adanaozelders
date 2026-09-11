# P1 Uygulama Tasarımı — Kampanya + Segment + Fiyat Listesi (birbirine bağlı)

**Durum:** TASLAK — P0'lardan (`ikas-uygulama-p0-*`) sonra. Kod değiştirilmedi. Öncelik sabah netleşecek.
**Kaynak:** ikas canlı panel (`docs/ikas-admin-panel-arastirmasi.md` §8, §9, §13b) + mevcut `Coupon`/`CouponRedemption` (`backend/models/store.py`).
**Neden birlikte:** Segment → kampanya hedeflemenin girdisi; Fiyat Listesi → kampanya/kargo/kişiselleştirme fiyatının önkoşulu. Üçü ayrı ayrı yapılabilir ama tasarım bağımlılığı bu sırayla: **Fiyat Listesi → Segment → Kampanya**.

---

## A. Fiyat Listesi (önce — çünkü diğerleri buna dayanır)

**ikas:** baz listeden %/tutar operasyonuyla türetilen fiyat listesi; ürün/kargo/kampanya "fiyat listesi başına" fiyat.

**Model** (`backend/models/price_list.py`):
```
PriceList: id, name, type(MANUAL|RULE), currency_code(default TRY),
           base_price_list_id(FK nullable, RULE için), rounding(enum), active, deleted, ts
PriceListRule: id, price_list_id(FK CASCADE), operation(INCREASE|DECREASE),
               amount, amount_type(PERCENT|FIXED), order
PriceListItem: id, price_list_id, product_id, price   # MANUAL override (ürün başına)
```
Çözümleme: ürünün belli listede fiyatı = MANUAL item varsa o; yoksa RULE ile baz fiyattan hesap; yoksa `Product.price`. **Sunucuda** (`services/price_list_service.py`).

**Bağlama:** müşteri grubu / satış kanalı → fiyat listesi. Checkout'ta müşterinin grubuna göre liste seçilir.

**Not:** Büyük değişiklik; `Product.price` tek-fiyat varsayımını kıran ilk adım. Migration + geriye uyum (liste yoksa `Product.price`).

## B. Müşteri Grup + Segment

**ikas:** Müşteri Grubu (manuel atama) + Segment (kural-bazlı, Pazarlama modülü).

**Model** (`backend/models/customer_group.py`):
```
CustomerGroup: id, name, price_list_id(FK nullable), deleted, ts   # gruba fiyat listesi
CustomerSegment: id, name, rules(JSONB), auto(bool), ts
   # rules: [{field: order_count|total_spent|last_order_days|city|tag, op, value}]
```
`Client`'a: `group_id (FK nullable)`. Segment üyeliği: kural motoru (`segment_service.evaluate`) — sipariş/harcama/tarih üzerinden hesaplanır (nightly veya on-demand).

**Kullanım:** kampanya hedefleme (§C) + fiyat listesi (§A) + pazarlama (gelecek).

## C. Kampanya Motoru (Coupon'u genişlet)

**Mevcut** (`Coupon`, store.py): `code, discount_type(PERCENT|FIXED), discount_value, min_subtotal, max_uses, per_user_limit, used_count, valid_from/until, is_active` + `CouponRedemption`.

**ikas farkı:** 4 tür (Yüzde/Sabit/**Kargo Bedava**/**BOGO**), katlı, otomatik(kodsuz), segment hedefleme, stacking, ürün/kategori kapsam, dönem-bazlı limit.

**Tasarım** — yeni `Campaign` (Coupon'dan ayrı, ama redemption paylaşır):
```
Campaign: id, name(müşteriye görünür), trigger(AUTO|CODE), code(nullable),
  type(PERCENT|FIXED|FREE_SHIPPING|BOGO), value,
  tiered(JSONB nullable),          # katlı: [{min, discount}]
  scope(ALL|PRODUCTS|CATEGORIES), scope_ids(JSONB),
  min_amount, max_amount, min_qty, max_qty,
  target(ALL|SEGMENT|CUSTOMERS|MEMBERS_ONLY), target_ids(JSONB),
  limit_total, limit_per_user, limit_period(nullable: {count, window}),
  stackable(bool), sales_channel_ids(JSONB),
  valid_from, valid_until, active, ts
CampaignRedemption: id, campaign_id, order_id, client_id, amount, ts
```

**Servis** (`services/campaign_service.py`): sepet + müşteri → uygulanabilir kampanyalar → **en iyi/stacking kuralına göre** indirim (sunucuda). BOGO: kapsam ürünlerinden en ucuzu bedava. FREE_SHIPPING: `resolve_shipping` sonucunu 0'lar (P0 kargo ile entegre). Katlı: sepet tutarına göre kademe.

**Sepet/sipariş:** `Order`'a kampanya indirimi kalemi + snapshot. Kupon kod akışı korunur (Coupon → Campaign migration'ı veya paralel yaşam — karar sabah).

## D. Fazlama ve doğrulama

1. **Fiyat Listesi** (§A): model + servis + geriye uyum + test. En temel, en riskli (Product.price varsayımı).
2. **Grup + Segment** (§B): model + kural motoru + test.
3. **Kampanya** (§C): Coupon'u genişlet/yanına Campaign; motor + stacking + BOGO + test. Kargo (FREE_SHIPPING) P0 kargo ile entegre.

Her faz paket-paket onay + test matrisi koddan önce (feedback_delivery_gates). Para/indirim kritik → kapsamlı test (stacking çift-indirim, limit aşımı, segment eşleşme, BOGO en-ucuz seçimi). Fiyat **sunucuda** (CLAUDE.md).

## Açık kararlar (sabah)
- Coupon → Campaign migration mı, paralel mi?
- Segment üyeliği: nightly batch mı, on-demand mı?
- Fiyat Listesi P1'e mi girsin yoksa ayrı büyük iş mi (Product.price varsayımını kırıyor — en riskli).
- Stacking varsayılanı: kampanyalar birleşsin mi, en iyi tek mi?
