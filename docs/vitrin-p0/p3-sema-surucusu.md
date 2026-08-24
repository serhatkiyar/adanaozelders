# P3 — Blok şeması tek kaynak, editör ondan üretilir

**Tarih:** 24 Ağustos 2026 · Ön koşul: P2 kapalı

## Sorun

`BlockEditor` 400+ satırlık elle yazılmış bir `if (block_type === ...)`
zinciriydi. Yeni bir blok tipi eklemek **dört ayrı yere** dokunmayı
gerektiriyordu (ad sözlüğü, açıklama sözlüğü, editör dalı, varsayılan config
üreteci) ve unutulan yer sessiz kalıyordu.

Sektör deseni bunun tersi: blok kendi şemasını **beyan eder**, editör ondan
**üretilir**. Shopify'da her section `schema`/`presets` taşır ve tema editörü
ondan çizilir; merchant hiçbir zaman "editörde alan yok" durumuna düşmez.

## Yapılan

`frontend/src/lib/storeBlockSchema.ts` tek kaynak: ad, açıklama,
kopyalanabilirlik, varsayılan başlık/config ve tipe özgü alanlar.

Panelde **blok tipi sayan koşul: 8 → 0**

| Nerede | Önce | Sonra |
|---|---|---|
| Ad / açıklama sözlükleri | iki elle yazılmış `Record` | şemadan türetilir |
| `newBlock` varsayılanları | gömülü dörtlü koşul | `varsayilanConfig()` |
| `appendMediaToLandingBlock` | iki tip listesi + gömülü `fit` üçlüsü | `medyaAlani()` + `varsayilanFit` |
| Tipe özgü alanlar | 3 ayrı `{block_type === ... && ...}` | `alanlar.map(<SemaAlani/>)` |
| Görsel bölümü | `["HERO_CAROUSEL","IMAGE_CARD_GRID","BANNER"].includes(...)` | `gorselAlani &&` |
| Tekil/çoklu görsel | `block_type === "BANNER"` | `gorselAlani.tekil` |
| Kopyala düğmesi | `block_type !== "RECENTLY_VIEWED"` | `kopyalanabilir` |
| Önizleme zenginleştirmesi | iki tip karşılaştırması | alan türünden |
| Blok paleti | `Object.keys(BLOCK_NAMES)` | `BLOK_TIPLERI` |

### Dosya kısalmadı — ve bu beklenen

`LandingPagesManager.tsx` 1389 → **1427** satır. Şema çizicisi (`SemaAlani`)
ve gerekçe yorumları dosyaya eklendi; kazanç satır sayısında değil,
**tek kaynak** ve **tip zincirinin sıfırlanmasında**. Dosyanın parçalanması
plandaki P4'ün işidir.

### Zod bilinçli olarak kullanılmadı

Alan doğrulamasının otoritesi sunucudur (`_validate_block`): görselin medya
kütüphanesine ait olması, bağlantı biçimi, kart sayısı, metinde HTML yasağı
orada karara bağlanır. Aynı kuralları istemcide tekrar yazmak **ikinci bir
otorite** ve sessiz bir sapma kaynağı üretirdi. Şema "hangi alan nasıl
çizilir" sorusunu cevaplar, "değer geçerli mi" sorusunu değil.

## Davranış değişmediğinin kanıtı

Refactor'dan **önce** 17 testlik karakterizasyon ağı yazıldı; ölçülen şey
"alan çizildi mi" değil **panelin gerçekten gönderdiği taslak yükü**.

Kritik doğrulama: güçlendirilmiş test dosyası **eski kodda da** dört koşumda
17/17 geçiyor. Yani test dosyasındaki değişiklikler refactor'ü kurtarmak için
değil, testin kendi kusurları içindi.

## İki test kusuru bulundu ve raporlandı

1. **`blokSec` kararsızdı.** Blok listesi taslak türetilirken yeniden
   çiziliyor; tek seferlik tıklama bayat düğüme düşebiliyor ve aynı test bir
   koşuda geçip ötekinde düşüyordu (PRODUCT_RAIL'de üç koşumun ikisinde).
   Beklenen şey "tıklandı" değil "editör değişti" — tıklama artık `waitFor`
   içinde ve idempotent.
2. **Debounce iddiası ölçmüyordu.** "Tek istek doğdu" iddiası 900 → 0
   mutasyonunu **yakalamıyordu**, çünkü tek istek gecikmeden değil effect
   temizliğinden geliyor. Artık değişiklikten 300 ms sonra henüz kayıt
   olmadığı da ölçülüyor; mutasyon tekrarlandı ve kırıldı.

Ayrıca bir sözleşme kayda geçti: **istemci `sort_order` yazmaz, sunucu
gönderileni yok sayar** ve sırayı dizi indeksinden türetir (`index * 10`).
İlk yazımda bu yanlış anlaşılmış ve test yanlış bir hata bildirmişti.

## İki test dosyası birbirini tamamlıyor

- `landingBlockEditor.characterization.test.tsx` — 7 tipi **adıyla** sabitler.
- `landingSemaSurucusu.test.tsx` — iddiaları `BLOK_SEMASI` üzerinde
  **döngüyle** kurar; şemaya sekizinci giriş eklendiği an kapsam kendiliğinden
  genişler.

Bu tamamlayıcılık mutasyonla gösterildi: şemadan bir alan **silinince** şema
sürücüsü göremiyor (döngü şemadan geliyor), adıyla sabitlenmiş karakterizasyon
yakalıyor. **Tek başına şema güdümlü bir test yalancı-yeşil makinesi olurdu.**

## Mutasyon provası

| Mutasyon | Sonuç |
|---|---|
| Kopyalamada `block_key` yenilenmiyor | 2 test kırıldı |
| `Metin` alanı TÜM tiplerde çiziliyor | 5 test kırıldı |
| Debounce 900 → 0 | İLK HÂLDE YAKALANMADI → test güçlendirildi → kırıldı |
| Şemadan `RICH_TEXT.Metin` silindi | karakterizasyon kırıldı (şema sürücüsü kör — beklenen) |
| `Koleksiyon` alanı tüm tiplerde çiziliyor | 6 test kırıldı |

## Bekleme bütçeleri

Önce ölçüldü (`performance.now()`, dosya tek başına): blok seçim döngüsü
**657 ms**, autosave beklemesi **929 ms** (900 ms debounce yapısal). Bütçeler
1500/2500 yazıldı ve dosya tek başına dört koşumda kararlıydı. **Tam suite'te
kırıldı** — paralel yükte panelin ilk veri yüklemesi 1500 ms'i aşıyor — ve
panel-mount eden diğer kabul testleriyle aynı hizaya (4000) çekildi.
`__guards__/beklemeButcesi` envanterine bu gerekçeyle girildi.

## Doğrulama

Tam frontend takımı **2022/2022**, iki ardışık koşum. `tsc -b` temiz.
