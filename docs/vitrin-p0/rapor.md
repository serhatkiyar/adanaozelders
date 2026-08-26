# P0 — Mağaza Vitrini Durum Tespiti

**Tarih:** 24 Ağustos 2026 · **Dal:** `feat/magaza-vitrin` (main ile aynı commit: `5be2425`)
**Üretim kodunda değişiklik:** YOK. Bu tur yalnız ölçer.

Ölçüm aracı: `frontend/scripts/vitrin_p0_olcum.mjs` (gerçek Chrome / CDP)
Ham çıktı: `docs/vitrin-p0/olcum.json` + ekran görüntüleri
Ortam: docker compose (backend :8000, frontend :5173, postgres :5433/`ceyhandb`)

---

## 0. Önce aracın kendisi: iki ölçüm kusuru bulundu ve düzeltildi

CLAUDE.md §E gereği aracı da sorguladım. İlk iki koşum **yalancı ölçüm** üretti:

| # | Kusur | Belirti | Düzeltme |
|---|---|---|---|
| A-1 | `json/list` içinden hedef `find(t => t.type === "page")` ile seçiliyordu; bu bir **Chrome eklentisinin arka plan sayfasını** yakaladı | Bütün DOM ölçümleri 0 döndü ("0 görsel, 0 link") — yani mağaza değil eklenti ölçülüyordu | Hedef artık açıkça `http(s)`/`about:blank` olan sekme |
| A-2 | Karanlık tema `Emulation.setEmulatedMedia` ile çevriliyordu | Açık ve koyu ölçüm **aynı** gövde rengini döndürdü (`rgb(248,250,252)`); "koyu tema ölçümü" aslında ikinci bir açık tema ölçümüydü | Tema uygulamanın kendi yolundan (`<html>.dark` sınıfı) çevriliyor — `tailwind.config.js` `darkMode: "class"` |

> **Bu iki kusur `frontend/scripts/ip_*.mjs` turlarının çoğunda da var** (`find(t => t.type === "page")` deseni `ip_b2_liste_turu.mjs:350`, `ip19_browser_acceptance.mjs:157` ve diğerlerinde birebir aynı). Yani geçmiş turlarda da eklenti sayfası ölçülmüş olabilir. Ayrı borç olarak kaydedilmeli.

Üçüncü bir tuzak ortamdaydı: `http://127.0.0.1:5173` ile gezince backend **CORS** reddediyor (`BACKEND_CORS_ORIGINS` yalnız `http://localhost:5173`), ekranda "Sunucuya ulaşılamıyor" çıkıyor ve vitrin boş görünüyordu. **Bu turdan "vitrin boş" sonucu çıkarmak yalancı bulgu olurdu.** Ölçüm `http://localhost:5173` ile tekrarlandı.

---

## 1. Kaç nesil, hangisi gerçekten canlı

Dört neslin **public uçlarının dördü de 200 dönüyor** (gerçek HTTP, `curl`):

| Uç | Yanıt |
|---|---|
| `GET /store/home` (G4 kanonik) | 200 · 3040 b |
| `GET /store/hero-slides` (G2) | 200 · 171 b |
| `GET /store/home-sections` (G3) | 200 · 1135 b |
| `GET /store/showcase-cards` (G3) | 200 · 1384 b |
| `GET /duyuru-seridi/aktif` (G1) | 204 |

Ama **tarayıcının fiilen çağırdıkları** farklı (tek `/magaza` yüklemesi):

| Nesil | İstek sayısı |
|---|---|
| G1 duyuru | **0** |
| G2 hero | **0** |
| G3 `home-sections` | **1** |
| G3 `showcase-cards` | 0 |
| G4 `/store/home` | **2** |

**Sonuç:** fallback bugün **devrede değil** — HOME yayında olduğu için müşteri kanonik sistemi görüyor. Ama G3'ün bir ucu her yüklemede boşuna çağrılıyor (bkz. B-3), ve G4 iki kez çekiliyor (B-4).

### Ajan iddialarının doğrulanması

- **D1 — duyuru şeridi ölü: DOĞRULANDI.** `DuyuruSeridi` bileşeninin tek kullanımı kendi kabul testi; tarayıcıda `/duyuru-seridi/aktif` isteği **hiç doğmuyor** (0). Silinmesi kullanıcı yüzeyinde hiçbir şey değiştirmez.
- **D2 — "308 redirect'te `Location` header'ı yok": YANLIŞ.** `store_merchandising_service.py:857` `Location` header'ını **veriyor**. Ayrıca `store_landing_page_redirects` tablosu **boş (0 satır)** — bu yol bugüne kadar hiç kullanılmamış. İddia düzeltildi; yine de P1'de gerçek testi yazılacak (hiç sınanmamış bir yol).
- **D3 — `announcements.* → products.*` göçü yetki yükseltmesidir: DOĞRULANDI.** Dört router `announcements.*` kullanıyor (`store_hero.py`, `store_home.py`, `store_showcase.py`, `admin.py:945-993`), yeni sistem `products.*`. `products.manage` ürün fiyat/stok yetkisidir; içerik editörünü oraya taşımak sessiz ayrıcalık artışı olur.

---

## 2. Veritabanı: bu katman acemice DEĞİL

`store_landing_page_publications` şeması gerçekten sağlam:

- `publication_window tstzrange` **generated always as** `tstzrange(starts_at, COALESCE(ends_at,'infinity'), '[)')` stored
- `EXCLUDE USING gist (page_id WITH =, publication_window WITH &&) WHERE deleted_at IS NULL`
- Composite FK `(page_id, revision_id) → store_landing_page_revisions(page_id, id) ON DELETE RESTRICT`
- `CHECK (ends_at IS NULL OR ends_at > starts_at)`

Yayın zinciri de tutarlı: 13 pencere, hepsi bitişik, çakışma yok, HOME revizyon 15 `LIVE`.

| Tablo | Satır |
|---|---|
| `store_landing_pages` | 3 (ana-sayfa · okula-donus · okula-donus-2) |
| `store_landing_page_revisions` | 15 |
| `store_landing_page_blocks` | 58 |
| `store_landing_page_publications` | 13 |
| `store_media_assets` | 6 |
| `product_sets` | 1 |
| `store_hero_slides` (G2) | 1 |
| `store_home_sections` (G3) | 2 |
| `store_showcase_cards` (G3) | 8 |

Eski nesil tablolarındaki veri hacmi küçük (11 satır) — P7'deki DROP kararı için düşük risk, ama backfill karşılaştırma referansı olarak hâlâ değerli.

---

## 3. Bulgular

### B-1 · Vitrin telefonda kullanılamıyor — **970 px yatay taşma** (P1, kullanıcı görür)
390 px genişlikte `/magaza` gövdesi ~1360 px; dört görsel kart tek satırda sıkışıp sayfayı taşırıyor. Ölçüm: `mobil.yatayTasma = true`, `tasmaPiksel = 970`. Kanıt: `magaza-ana-mobil-koyu.png`.
Kampanya sayfasında taşma yok (0 px) — sorun dört kartlı ızgaraya özgü.

### B-2 · Vitrinde iki ölü blok + panelin hiç uyarmaması (P1, kullanıcı görür)

> **DÜZELTME (aynı gün):** ilk yazımda "dört kartın da hedefi boş, hiçbiri tıklanamıyor" denmişti. **Bu yanlıştı.** Ölçüm aracının deseni gerçek ok karakterini ("→") değil ASCII `->` arıyordu ve hiç eşleşmedi; ben de bundan "0 bağlantı" sonucunu çıkardım. Canlı veriden doğrulanan gerçek durum aşağıdadır.

Canlı HOME'un 5 bloğundan **2'si** hiçbir yere gitmiyor:

| # | Blok | `block.link_url` | `card/slide.link_url` | Durum |
|---|---|---|---|---|
| 0 | HERO_CAROUSEL | `null` | `null` | **ölü** |
| 1 | IMAGE_CARD_GRID · Sırt Çantaları | `null` | `""` | **ölü** |
| 2 | IMAGE_CARD_GRID · Su Mataraları | `/magaza` | `/magaza` | çalışıyor |
| 3 | IMAGE_CARD_GRID · Resim Malzemeleri | `/magaza` | `/magaza` | çalışıyor |
| 4 | IMAGE_CARD_GRID · Beslenme Çantaları | `/magaza` | `/magaza` | çalışıyor |

- `TrackedLink` (`StoreLandingBlocks.tsx:596`) hedef yoksa `<a>` yerine `<div>` basıyor — o iki blok **link gibi görünüp** tıklanmıyor.
- 1 numaralı blokta ayrıca **sessiz veri kaybı** var: `link_label="Okula Dönüş Alışverişi"` yazılmış ama `link_url` boş; `Heading` (satır 311) bağlantı metnini yalnız hedef doluysa basıyor, yani yazılan metin mağazada hiç görünmüyor.
- Dördünün de bağlantı metni **aynı**: "Okula Dönüş Alışverişi" — hedefi olan üçü de aynı yere (`/magaza`) gidiyor. Bu bir hata değil ama kürasyon kalitesi sorunudur.
- **Panel bunu uyarmıyor:** blok kaydedilirken boş hedef için hiçbir doğrulama/uyarı yok.

### B-2b · `warnings` mekanizması var ama panelde ÖLÜ (P1)
Backend blok başına `warnings` üretiyor (ör. "N sabit ürün satılabilir olmadığı için gizlendi" — `store_merchandising_service.py:431`) ve yanıtta gönderiyor. Panel bunu taslak kurarken **atıyor** (`LandingPagesManager.tsx:217`, `warnings: _warnings` ile ayıklanıyor) ve hiçbir yerde render etmiyor. Yönetici bugün var olan uyarıları bile görmüyor.

### B-3 · Her vitrin yüklemesinde ölü nesle gereksiz istek (P2)
`StorePage.tsx:94` `useStoreHome()` **koşulsuz** çağrılıyor; kanonik sistem çalışırken bile `/store/home-sections` isteği doğuyor (ölçüldü: 1). React hook'ları koşullu çağrılamadığı için fallback dalı render edilmese de istek gidiyor.

### B-4 · `/store/home` tek sayfa yüklemesinde iki kez çekiliyor (P2)
Ölçüldü: 2 istek. Sebep incelenmedi (StrictMode / iki tüketici / key farkı adayları).

### B-5 · Mağaza ana sayfasında **sıfır ürün** (ürün kararı + P2)
Canlı HOME 5 bloktan oluşuyor: 1 `HERO_CAROUSEL` + 4 `IMAGE_CARD_GRID`. Tek bir `PRODUCT_RAIL` yok. Panel metrikleri bunu doğruluyor: **Ürün tıklaması 0 · Katkılı ciro 0,00 ₺**. Vitrin şu hâliyle bir afiş; alışveriş akışına hiç bağlanmıyor.

### B-6 · Sürüm ve yayın gürültüsü — sıkıştırma yok (P2, panel UX)
Her "şimdi yayınla" yeni bir revizyon **ve** yeni bir yayın penceresi üretiyor. Panelde şu an 9 sürüm çipi ve 13 satırlık yayın takvimi var; hepsi aynı günün dakikaları (01:42, 01:43, 01:47…). Kanıt: `panel-vitrin-acik.png`. Editör için okunabilir bir geçmiş değil, log dökümü.

### B-7 · Blok modelinde çift kaynak (mimari, P3'ün gerekçesi)
Aynı kavram iki yerde: blokta üst seviye `title / description / link_label / link_url` **ve** serbest `config` JSON. Örnek canlı blok: üst seviyede `title="Sırt Çantaları"`, `link_label="Okula Dönüş Alışverişi"`, `link_url=null`; `config.cards[0]` içinde ayrıca `label=""`, `link_url=""`. Hangisinin kazandığı blok tipine göre değişiyor ve hiçbiri doğrulanmıyor.

### B-8 · Ölçüm araçlarında yalancı yeşil riski (test borcu)
§0'daki A-1 ve A-2 kusurları mevcut `ip_*` tur scriptlerinde de duruyor. Geçmiş turların "0 ihlal" sonuçları bu yüzden yeniden değerlendirilmeli.

### B-9 · Çalışma ağacındaki "değişiklik" gerçek değil
`frontend/scripts/ui-baseline-sayim.mjs` yalnız **CRLF** farkıyla kirli görünüyor (`git diff` boş; 1156 CR karakteri). `.gitattributes` yok, `core.autocrlf=true`.

---

## 4. Doğrulanan iyi taraflar (bunlara dokunulmayacak)

- Yayın penceresi modeli ve GiST exclusion — DB seviyesinde doğru kurulmuş.
- Yayın zinciri tutarlı; çakışma yok.
- Panel kabuğu sakin ve okunur (Medusa tabanı); adsız düğme **0**, yatay taşma **0**.
- Fallback bugün devrede değil; kanonik sistem gerçekten sunuyor.

---

## 5. Plana etkisi

| Plan maddesi | Değişiklik |
|---|---|
| P1 nöbetçi ağı | Aynen geçerli. 308 redirect testi **hiç kullanılmamış** bir yolu sınayacak (D2 düzeltildi). |
| P2 fallback kaldırma | Riski beklenenden düşük (fallback zaten devrede değil), ama B-3 yüzünden yine gerekli. Ayrıca "HOME yayında değilse ne olacak" kararı hâlâ açık. |
| P3 şema kayıt defteri | **Gerekçesi güçlendi** — B-2 ve B-7 doğrudan şemasızlığın ürünü. |
| P4 panel parçalama | B-6 (sürüm/yayın gürültüsü) bu pakete eklenmeli. |
| P6 merchandising | **Önceliği yükseldi** — B-5: vitrinde hiç ürün yok. |
| P7 silme | G1 en ucuz parça (D1). İzin göçü `products.*` değil **`merchandising.*`** olmalı (D3). |
| Yeni | B-1 (mobil taşma) plana ayrı ve **erken** madde olarak girmeli; bu bugün canlı bir kullanıcı hatası. |

---

## 6. P1 sonucu — nöbetçi ağı kuruldu (24 Ağu 2026)

`backend/tests/integration/test_store_merchandising_pg.py` — **16 test**, hepsi
gerçek PostgreSQL + gerçek HTTP + gerçek yetki çözümü (dependency override yok).
Mutasyon provası **7/7** (ayrıntı: `docs/vitrin-p0/mutasyon.md`).

Kapsanan davranışlar: yayın penceresi (başlangıç/bitiş/ardışık devir) · GiST
exclusion · tek-HOME partial unique index · revizyon değişmezliği · slug 308
yönlendirmesi · HMAC attribution token (üretim + kurcalama) · 26 admin ucunun
yetki ayrımı (`view` ≠ `manage`) · oturumsuz 401.

### Bulunan gerçek üretim hatası — B-3

**Süresi dolmuş kampanya sayfası yayında kalıyordu.** `_publication_for_page`
`"ENDED"` durumunu hesaplıyor ama `get_page` yalnız `{DRAFT, UPCOMING,
ARCHIVED}` için 404 veriyordu; yani `ends_at` alanı fiilen hiçbir şey
yapmıyordu. Biten bir kampanyanın fiyat/vaat metninin yayında kalması ticari ve
hukuki risktir. Düzeltildi (`a7f5702`); `get_home` bilinçli olarak dışarıda
bırakıldı (404 mağazayı boşaltırdı) ve bu ayrım kendi testiyle korunuyor.

### Düzeltilen ölçüm kusuru

İlk koşumda 14 test ERROR verdi ve hijyen nöbetçisi "test izolasyonu bozuk"
dedi. Sebep testlerde değil **fabrikanın temizliğindeydi**:
`store_page_daily_metrics` sayfaya değil revizyona bağlı (`page_revision_id`),
`page_id` diye silmeye çalışmak teardown'ı patlatıyordu. Düzeltildikten sonra
sızıntı sıfır.

### Not — P2'nin ön koşulu artık hazır

Fallback (`StorePage.tsx:423-464`) bu ağ olmadan kaldırılamazdı. Artık G4'ün
yayın/yetki/sürüm davranışları mock'suz kanıtlı; P2 açılabilir.
