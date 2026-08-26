# P1 — Vitrin nöbetçilerinin mutasyon provası

**Tarih:** 24 Ağustos 2026 · Test DB: `adana_vitrin_test` (docker Postgres :5433)
Hedef takım: `backend/tests/integration/test_store_merchandising_pg.py` (16 test)

Kural: kök `CLAUDE.md` → §D. Bir nöbetçinin değeri, yanlış davranışı
**gerçekten kırmasıyla** ölçülür; "16 test geçti" tek başına kanıt değildir.

## Kapsam ayrımı — dürüstlük notu

Yedi provanın **beşi** kaynak kodunu bozar ve
`backend/scripts/mutation_drill_vitrin.py` ile koşar (bayt yedeği + SHA-256
doğrulamalı geri alma, kirli ağaç reddi, HEAD/status karşılaştırması, seçilen
test sayacı, yeşil taban kapısı).

**İkisi veritabanı nesnesidir** (GiST exclusion ve partial unique index) ve bir
dosya yamasıyla bozulamaz; onlar aşağıdaki SQL ile **elle** yapıldı. "7/7
yakalandı" cümlesi bu ayrımı gizlerse ölçüm dürüst olmaz.

## Kaynak mutasyonları (sürücüyle)

Her koşumda seçilen test sayısı 16 ve yeşil taban çizgisi EVET idi.

| No | Mutasyon | Kıran test |
|----|----------|-----------|
| V1 | Yayın penceresinin **bitiş** koşulu (`ends_at > now`) kaldırıldı | `test_suresi_dolmus_yayin_gorunmez` · `test_pencere_gecince_yeni_surum_devralir` |
| V2 | Süresi dolmuş yayın (`ENDED`) yine public sayıldı | `test_suresi_dolmus_yayin_gorunmez` |
| V3 | Attribution token imza doğrulaması kaldırıldı | `test_kurcalanmis_token_reddedilir` |
| V4 | Taslak, yayındaki revizyonun üzerine yazıyor | `test_yayinlanmis_revizyon_degismez` |
| V5 | Yayınlama ucu `products.manage` yerine `products.view` istiyor | `test_yalniz_okuma_izni_yazmaya_yetmez` |

**Sonuç: 5/5 yakalandı** — ve her biri *doğru* testle. (Kırılan testin kimliği
önemli: yanlış test kırılıyorsa nöbetçi başka bir şeyi koruyor demektir.)

### V5 neden "kaldırıldı" değil "düşürüldü"

İzin dekoratörünü tamamen silmek `Admin` bağımlılığını da götürüp
import/NameError üretirdi. Test o zaman "kırıldı" görünür ama kırılma sebebi
yetki değil çöken modüldür — yani prova, ölçmek istediği şeyi ölçmez.
`manage` yerine `view` yazmak tam olarak korunmak istenen ayrımı hedefler.

## Veritabanı mutasyonları (elle)

### V6 — GiST exclusion

```sql
ALTER TABLE store_landing_page_publications
  DROP CONSTRAINT ex_store_landing_page_publication_window;
```
→ `test_cakisan_yayin_penceresi_db_seviyesinde_reddedilir` **FAILED**. Geri
eklendikten sonra **passed**.

```sql
ALTER TABLE store_landing_page_publications
  ADD CONSTRAINT ex_store_landing_page_publication_window
  EXCLUDE USING gist (page_id WITH =, publication_window WITH &&)
  WHERE (deleted_at IS NULL);
```

### V7 — tek-HOME partial unique index

```sql
DROP INDEX uq_store_landing_pages_single_home;
```
→ `test_ikinci_home_sayfasi_acilamaz` **FAILED**. (Mutasyon sırasında sızan
ikinci HOME satırı silindi.) Geri eklendikten sonra **passed**.

```sql
CREATE UNIQUE INDEX uq_store_landing_pages_single_home
  ON store_landing_pages USING btree (page_type)
  WHERE ((page_type)::text = 'HOME' AND deleted_at IS NULL);
```

## Toplam

**7/7 yakalandı** (5 sürücüyle + 2 elle).

## Bu turda bulunan gerçek üretim hatası

`test_suresi_dolmus_yayin_gorunmez` ilk koşumda kırmızı geldi:
`_publication_for_page` `"ENDED"` durumunu zaten hesaplıyordu ama `get_page`
yalnız `{DRAFT, UPCOMING, ARCHIVED}` için 404 veriyordu. Sonuç: **`ends_at`
geçmiş bir kampanya sayfası eski içeriğiyle yayında kalıyordu** — bitiş tarihi
alanı fiilen hiçbir şey yapmıyordu. Düzeltildi (`a7f5702`).

`get_home` bilinçli olarak dışarıda bırakıldı; gerekçesi ve nöbetçisi
`test_ana_sayfa_yayin_bitse_de_bos_kalmaz` içinde yazılıdır.

## Koşum reçetesi

```bash
cd backend
export POSTGRES_DB=adana_vitrin_test POSTGRES_HOST=localhost POSTGRES_PORT=5433
export REDIS_URL=redis://localhost:6379/12 PAYMENT_PROVIDER=fake
python -m pytest tests/integration/test_store_merchandising_pg.py -q
python -m scripts.mutation_drill_vitrin
```

> **Uyarı (ölçüldü):** bu env ihracatları `tests/test_production_guard.py`
> içindeki bir testi düşürür — o test ortamdaki `S3_*`/CORS değerlerini
> okuyor. Kod kusuru değil, ortam sızıntısıdır; birim testleri **temiz
> kabukta** koşulmalıdır. (Ayrı bir test-izolasyon borcu; bu paketin kapsamı
> dışında bırakıldı.)
