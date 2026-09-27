# ÜK-1 — turuncu aksan geçişi · kanıt

Karar ve gerekçe: `docs/tasarim-dili.md` §1.4.
Nöbetçiler: `frontend/src/__guards__/markaAksani.test.ts`,
`frontend/src/__guards__/gecerliMarkaSinifi.test.ts`.

## Ne ölçüldü

### 1. Kontrast — gerçek Chrome (`kontrast.json`)

`node scripts/ip_a8_kontrast.mjs --frontend http://127.0.0.1:5199 --out ../docs/arsiv/ip-c/ip-c4`

Ölçülen (açık tema, hesaplanan renkler):

| Yüzey | Ön plan / zemin | Oran | Eşik |
|---|---|---|---|
| Birincil düğme | beyaz / `rgb(194,65,12)` | **5,18** | 4,5 |
| İkincil düğme | `slate-700` / beyaz | 10,35 | 4,5 |
| `info` rozeti | `rgb(194,65,12)` / `rgb(255,247,237)` | **4,88** | 4,5 |
| `warning` çipi | `rgb(120,53,15)` / `rgb(254,243,199)` | **8,15** | 4,5 |
| `.input` odak kenarlığı | `rgb(194,65,12)` / beyaz | **4,95** | 3 (SC 1.4.11) |

Odak kenarlığı özellikle önemli: bağımsız denetim #3 (B-11) bu ekseni
**2,98** ile kaçırmıştı. `--marka-focus` bilerek `--marka-mid` (3,56) değil
`#C2410C` seçildiği için pay geniş.

### 2. Rota turu — çalışma zamanında indigo (`tur.json`, `*.png`)

`node scripts/ip_c4_public_turu.mjs --frontend http://127.0.0.1:5199 --out ../docs/arsiv/ip-c/ip-c4`

10 herkese açık rota × 2 genişlik (1280 / 380) = 20 sayfa yüklemesi.

**ÇALIŞMA ZAMANINDA KALAN İNDİGO: 0** · marka rengiyle boyalı öğe: 66.

Bu tur, kaynak taramasının göremediğini ölçer: her öğenin *hesaplanan*
`color` / `background-color` / `border-color` / `fill` / `stroke` değerine
bakar. Sınıf adı taraması `bg-[#1a365d]`, ayrı bir CSS dosyasındaki `#4f46e5`
ya da JS içinde satır içi stil dizesiyle enjekte edilen bir rengi göremez —
ÜK-1 turunda bunların **dördü de gerçekten vardı** (bkz. aşağıdaki bulgu).

Doluluk kapısı: 66 öğe gerçekten marka rengiyle boyalı. Bu olmadan "0 indigo"
bedava geçerdi — boş bir sayfa da 0 indigo verir.

## Turda bulunan gerçek kusur

Sınıf süpürmesi bittikten sonra sitede **hâlâ elle yazılmış marka renkleri**
vardı ve hiçbiri `indigo-\d` taramasına takılmıyordu:

| Yer | Değer | Neden görünmedi |
|---|---|---|
| `store/StoreCategoryBar` | `bg-[#1a365d]` | ESKİ LACİVERT, sitede tek başına kalmıştı |
| `store/StoreSearch` | `bg-[#f8c27d]` | ikinci bir turuncu arama düğmesi |
| `components/MapPicker.css` | `#4f46e5` ×14 | ayrı CSS dosyası, Tailwind sınıfı değil |
| harita işaretçileri | `#6366f1` | JS içinde satır içi stil dizesi |

Hepsi token'a bağlandı ve sınıf için nöbetçi düğümü yazıldı
(`markaAksani.test.ts` → "ELLE YAZILMIŞ marka rengi yok"). Kullanıcının
seçebildiği renk paletleri (`Grapher`, `Habits`, `Tasks`) isimle muaf: onlar
marka değil **veri** kalemi.

İkinci bulgu: native `<input type=checkbox>` öğeleri `text-marka` yazıyordu —
`@tailwindcss/forms` kurulu olmadığı için bu **hiçbir şey yapmıyor** ve
tarayıcının mavi varsayılanı çiziliyordu. Aksan indigo iken fark edilmiyordu;
turuncuya geçince göze battı. 26 kontrole `accent-marka` eklendi.

## İki uyarı — bu kanıtın sınırı

1. **`dugme:ghost` "koyu tema"da eşik altı (2,36) ve bu MARKAYLA İLGİSİZ.**
   Sonda hâlâ iki temayı ölçüyor ama site tek temadır (dark mode CMS turunda
   söküldü, nöbetçisi `tekTema.test.ts`). Ölçülen çift `slate-600` / `slate-900`
   ve içinde hiçbir marka token'ı yok; `dark:` sınıfları söküldüğünde bozulmuş,
   ÜK-1'ten önce de böyleydi. Sondanın koyu turu **var olmayan bir temayı**
   ölçüyor ve kalıcı bir yalancı kırmızı üretiyor — ayrı bir temizlik kalemi.

2. **Sihirbazın mercanı bu turda GÖRSEL olarak kanıtlanmadı.**
   `/ilanini-olustur` kimlik doğrulaması istiyor ve tur giriş sayfasına
   yönlendi; `sihirbaz-*.png` aslında giriş ekranıdır. Mercanın değişmediği
   iddiası statik nöbetçide durur (`sihirbazMercani.test.ts`).

## Açık ürün kararı

Mercan `#F2695E` (hue ~5°) ile yeni aksan `#C2410C` (hue ~21°) artık komşu.
"Sihirbaz bilerek farklı rejim" gerekçesi zayıflıyor. Bloklamaz; kullanıcıya
ayrı bir karar olarak sunulacak.
