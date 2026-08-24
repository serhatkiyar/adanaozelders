# P2 — Sessiz fallback yerine tek nesil + görünür düşüş

**Tarih:** 24 Ağustos 2026 · Ön koşul: P1 nöbetçi ağı yeşil (16→18 test, mutasyon 7/7)

## Karar nasıl verildi

Soru şuydu: ana sayfanın varsayılanı **koda gömülü bir dal** mı olsun, yoksa
**veri** mi? Araştırma bunun yanlış bir ikilem olduğunu gösterdi — sektör iki
**farklı** durumu ayırıyor ve her birinin ayrı cevabı var.

### 1. "Hiç içerik yapılandırılmamış" → cevap: VERİ

Shopify'da bir temanın `index.json`'ı **en az bir bölüm içermek zorundadır**;
section'lar `presets`/`defaults` beyan eder ve bunlar "yeni eklenen bir bölümün
başlangıç içeriğini, ayarlarını ve yapısını" tanımlar. Satıcı her zaman gerçek
ve **düzenlenebilir** bir ana sayfadan başlar. Veritabanı tarafındaki karşılığı
standart seeding disiplinidir: şemayı migration tanımlar, veriyi **idempotent**
seed doldurur.

Bizde bu **zaten var**: `e8c89b9c1b61` backfill migration'ı boş bir veritabanına
da `store_landing_pages` id=1 (`ana-sayfa`, HOME) + revizyon + **süresiz açık
yayın** yazıyor (`ON CONFLICT DO NOTHING` ile idempotent). Yani varsayılan vitrin
zaten veri — koda gömülü dal gereksizdi.

### 2. "İçerik çekilemedi (çalışma zamanı arızası)" → cevap: SON İYİ KOPYA + GÖRÜNÜR uyarı

CDN dünyasının adı konmuş deseni `stale-if-error`: origin 5xx/timeout verirse
eski kopya sunulur, boş sayfa gösterilmez. Ama kritik şartla — **sessiz olmaz**.
Kaynakların ayrımı net: *graceful degradation* operatörün kısıtlı modu bildiği,
kasıtlı ve görünür bir yetenek azalmasıdır; *silent fallback* ise hatayı
operatörden ve izlemeden gizleyen görünmez bir kod yolu değişimidir. Verilen
örnek birebir bizim durumumuz: "öneri servisi üç gündür kapalı ama fallback
devrede olduğu için site iyi görünüyor — bu bir sessiz arızadır."

**Bizim fallback'imiz tam olarak bu anti-desendi** ve daha kötüsünü yapıyordu:
aynı sayfanın eski kopyasını değil, **başka bir neslin içeriğini** basıyordu.

### 3. En ikna edici kanıt: proje bu dersi zaten öğrenmiş

`CLAUDE.md`, rota katmanı için aynen şunu yazıyor: *"`ROUTING_PROVIDER=auto`
VROOM düşerse geriler — ama artık SESSİZCE değil: devre kesici + `/health`
raporu + üretimde ERROR log"*. Vitrin, bu doktrini henüz almamış tek yerdi.

## Yapılanlar

| Alan | Değişiklik |
|---|---|
| `StorePage.tsx` | Üç kademeli fallback → tek yol: kanonik bloklar → iskelet → **görünür** uyarı (`role="alert"`) |
| `StorePage.tsx` | Koşulsuz `useStoreHome()` çağrısı kalktı |
| `main.py` + servis | `/health` → `storefront: ok \| unpublished \| empty \| missing_page`; rota kalıbı (**degraded**, 503 değil) |
| `StoreLandingBlocks.tsx` | Hero'ya `decoding="async"` (eski carousel'de vardı, kaybolmasın) |
| `crossPromoBanner` N-2 | Kaynağı bilinçli olarak kanonik bloğa taşındı (aşağıda) |

## Ölçülen sonuç (gerçek Chrome, `/magaza`)

| Ölçü | Önce | Sonra |
|---|---|---|
| G1 duyuru isteği | 0 | 0 |
| G2 hero isteği | 0 | 0 |
| G3 `home-sections` isteği | **1** | **0** |
| G3 `showcase-cards` isteği | 0 | 0 |
| G4 `/store/home` isteği | **2** | **1** |
| Toplam API isteği | 7 | **6** |
| Vitrin blokları basılıyor | evet | evet |
| Mobil yatay taşma | 0 px | 0 px |

Yani P0'daki **B-3** (her yüklemede ölü nesle gereksiz istek) ve **B-4**
(`/store/home` iki kez çekiliyor) bu pakette birlikte kapandı.

## Bir kabul testi bilinçli olarak taşındı

İP-C1 · N-2 (`crossPromoBanner.acceptance.test.tsx`) `/magaza`'da **eski
neslin** hero görselinin çizilmesini kilitliyordu. Test sessizce silinmedi;
**iddiası korundu, kaynağı değişti**: hero görseli çizilmeli, LCP ipuçlarını
(`fetchpriority="high"`, `loading="eager"`) taşımalı ve bağlantısı doğru
olmalı — ama artık kanonik HOME hero bloğundan geliyor.

Bu taşıma sırasında gerçek bir gerileme yakalandı: eski carousel
`decoding="async"` veriyordu, yeni hero vermiyordu. Eklendi.

## Mutasyon provası — 3/3

| Mutasyon | Kırılan kapı |
|---|---|
| `useStoreHome()` çağrısı geri kondu | "eski nesil uçlarına istek doğmaz" (2 iddia) |
| Hata yüzeyi sessize alındı (`<div />`) | "görünür hata yüzeyi basılır" (2 iddia) |
| Yayınsız vitrin `/health`'te `ok` raporlandı | `test_ana_sayfa_yayini_kalkinca_saglik_degraded` |

## Mevcut testlerin yakaladığı iki şey

1. **N-2 çarpışması** (yukarıda) — eski nesil davranışı bir kabul testinde kilitliymiş.
2. **`/health` yardımcısı** — `_saglikli_bagimliliklar` "TÜM bağımlılıklar sağlıklı"
   sözleşmesini taşıyor ama yeni `_check_storefront`'u bilmiyordu; DB'siz birim
   ortamında `degraded` dönüp "tedarikçi kapalıyken sistem bozuk sayılmaz"
   iddiasını **yanlış nedenle** kırıyordu. Yardımcı güncellendi.

## Açık kalan

- Ana sayfa `ENDED` durumunda hâlâ son yayını sunar (P1'de bilinçli bırakıldı,
  kendi testiyle korunuyor). "Yayınsız ana sayfa" artık `/health`'te görünür.
- G2/G3/G1 **kodu** hâlâ duruyor; yalnız çağrılmıyor. Silme P7'nin işi.
