# İP-A9 — iki canlı kusur (TB-71 · TB-72)

Kapsam dar tutuldu: ekran göçü yok, yalnız iki kusur ve nöbetçileri.

---

## Görev 1 — TB-71 · `AuthModal` çift montaj + sayaçsız kaydırma kilidi

### Ne yapıldı

1. **Asıl düzeltme.** `<AuthModal />` kopyaları `pages/store/StoreLayout.tsx`
   (iki yer: minimal başlık dalı ve normal dal) ve `components/PublicShell.tsx`
   içinden kaldırıldı. `App.tsx` onu zaten `<Routes>`un DIŞINDA, yani her
   rotada bir kez render ediyor. İki dosyaya da "burada YOKTUR ve
   eklenmemelidir" gerekçesi yazıldı.

2. **Savunma katmanı.** Kaydırma kilidi `hooks/useModalA11y.ts` içinde
   **sayaca** bağlandı (`KILIT_YIGINI` + `kilitOncesiOverflow`): ilk giren
   kilitler, **son çıkan** sayfanın KENDİ `overflow` değerini geri verir —
   Radix'in `react-remove-scroll` deseni. `MODAL_YIGINI` yalnız klavye (ESC)
   için kurulmuştu; kilit ona hiç bağlanmamıştı. Kilit yığını ayrı tutuldu
   çünkü `lockScroll: false` pencereler klavye yığınında var ama kilide
   katılmıyorlar.

### Nöbetçiler

| Dosya | Tür | Ne kanıtlıyor |
|---|---|---|
| `src/hooks/kaydirmaKilidi.test.tsx` | gerçek DOM (RTL) | 6 senaryo; **anahtar olan LIFO DIŞI kapanma** — LIFO sırada bozuk kod da temizdi, yalnız LIFO test eden bir nöbetçi yalancı yeşil olurdu |
| `src/__guards__/authModalTekMontaj.test.ts` | kaynak sözleşmesi (AST) | üretim ağacında `<AuthModal>` montajı = **yalnız `App.tsx`, 1 adet**. Yorum/metin içindeki kullanımlar sayılmaz (kendi kendini doğrulayan ikinci test bunu ölçüyor) — dosyaların başına yazdığım "burada yoktur" açıklamaları metin taramasında yanlış pozitif üretirdi |
| `frontend/scripts/ip_a9_tur.mjs` | gerçek Chrome + CDP | `/magaza`, oturum kapalı, **3 tur** |

### Gerçek tarayıcı ölçümü (3/3 tur)

`/magaza`, oturum kapalı, gerçek fare tıklamasıyla "Giriş Yap" → ESC:

| | açıkken | kapandıktan sonra |
|---|---|---|
| `[role=dialog]` sayısı | **1** (önce 2 idi) | 0 |
| `body.style.overflow` | `hidden` | **`""`** |
| hesaplanan `overflow` | `hidden` | `visible` |
| `scrollTo(400)` sonrası `scrollY` | — | **400** |

Sayfa gerçekten kaydırılabilir durumdaydı (`scrollHeight 2112 > innerHeight 704`),
yani ölçüm boşta değildi.

---

## Görev 2 — TB-72 · Kirli form bekçisinde "Çık" pencereyi kapatmıyordu

### Kök, borç kaydında yazılandan BAŞKA çıktı

Borç kaydı "onay dalında `kapat()` çağrılıyor mu" diye bakmayı öneriyordu.
Çağrılıyordu — ama ondan önceki koruma dalı her zaman `return` ediyordu:

```ts
const sokulduRef = useRef(false);
useEffect(() => () => { sokulduRef.current = true; … }, []);   // ESKİ
…
if (sokulduRef.current) return;   // ← bayat closure koruması
kapat();
```

Mandal **sökülünce kaldırılıyor ama yeniden montajda indirilmiyordu.** React 18
`StrictMode` geliştirmede her efekti **mount → cleanup → mount** sırasıyla
koşturur; uygulama `main.tsx`te `<StrictMode>` içinde yaşıyor. Yani ilk
commit'te mandal kalkıyor ve bir daha inmiyor: bileşen ayaktayken bile
"söküldüm" diyor, `kapat()` dalı ÖLÜ.

Düzeltme mount efektinin başına bir satır: `sokulduRef.current = false;`.
"Söküldü" bir bileşen ÖRNEĞİNİN ömrüne aittir, kalıcı bir damga değildir.

### Neden hiçbir test görmemişti — ve teşhis nasıl yapıldı

Mevcut testler (`duzenlemeYuzeyi.test.tsx`) istemin AÇILDIĞINI doğruluyor,
"Çık"tan sonrasını sormuyordu. Ama asıl mesele şu: **yeni yazdığım ilk iki
sonda da kusuru üretmedi.**

1. jsdom + RTL, ortak yüzey → "Çık" pencereyi kapattı. YEŞİL.
2. jsdom + RTL, gerçek `DamageDialog` → yine YEŞİL.
3. Gerçek Chrome, sonda sayfası (`scripts/probe/tb72-probe.html`) → **yine
   yeşil**, üç kapatma yolunda da.
4. Gerçek Chrome, **gerçek panel ekranı** (`/yonetim/envanter/hasar`, gerçek
   admin oturumu) → **KUSUR ÜRETİLDİ**: "Çık"tan sonra pencere açık, `miktar`
   hâlâ `3`, `overflow` hâlâ `hidden`.

   (`docs/arsiv/ip-a/ip-a9/` altındaki ekran görüntüleri DÜZELTMEDEN SONRAKİ koşuma
   aittir — turun tekrar tekrar koşturulması kusurlu hâlin görüntülerini
   üzerine yazdı. Kusurlu hâlin kanıtı turun kendi çıkış kodudur: mutasyon
   provası B2, aynı kusuru geri koyup turu KIRMIZI'ya düşürüyor.)

Farkı üreten şey tarayıcı değil, **kabın uygulamaya benzemesiydi**: sonda
sayfası `createRoot` ile çıplak monte ediyor, uygulama `StrictMode` ile.
"Tarayıcıya özgü kusur" diye başlanan iz, aslında "test kabı gerçek uygulamaya
benzemiyor" kusuruna çıktı — ve bu, bu paketin en öğretici bulgusu.

Ayrıca ikinci koşumda tur `Page.navigate` zaman aşımıyla ASILDI: pencere
kapanmadığı için bekçinin `beforeunload` kaydı hâlâ ayaktaydı ve tarayıcı
istemi gezinmeyi bloke etti. Turdaki dolaylı kanıt sonradan düzgün bir
mekanizmaya bağlandı (`Page.javascriptDialogOpening` yakalanıp onaylanıyor).

### Nöbetçi

`src/components/admin/ui2/cikPencereyiKapatir.test.tsx` — **6 test**:

- dört kapatma yolu (Vazgeç · kapatma düğmesi · ESC · dış tıklama) × `StrictMode`
  içinde: "Çık" → `role="dialog"` DOM'dan gider, yüzey durumu "kapalı",
  `body.style.overflow` `""`.
- **Ters kutup**: istemde "Vazgeç" seçilince pencere AÇIK kalır. (Yukarıdaki
  dördü, bekçi her onayı kapatma sayıyor olsa da geçerdi.)
- Söküp-yeniden-kurma senaryosu. **Dürüst not:** bu senaryo TB-72'yi
  yakalamaz (yeni bileşen örneği, taze `useRef`); tuttuğu şey mandalın modül
  kapsamına taşınması sınıfı bir mutasyondur. Kanıt gücü buradadır, TB-72'de
  değil.

### Gerçek tarayıcı ölçümü (6 ayak)

Sonda sayfası × 3 kapatma yolu + gerçek panel ekranı × 3 kapatma yolu. Altısında
da: istem açıldı (`alertdialog` = 1) → "Çık" → `dialog` 0, pencere görünmez,
`overflow` `""`, `body.pointerEvents` `auto`.

---

## Mutasyon provaları

Sürücü kullanıcının değişikliklerini SİLMEZ: `git checkout --` kullanılmaz,
dosya içerikleri bellekte saklanıp birebir geri yazılır ve her turdan sonra
çalışma ağacının SHA-256 parmak izi doğrulanır (her iki sürücüde de
"parmak izi DEĞİŞMEDİ" ile bitti).

### Vitest katmanı — 7/8 yakalandı

| # | Mutasyon | Sonuç |
|---|---|---|
| M1 | Kilit sayacı söküldü (her örnek kendi değerini geri yazar) | YAKALANDI |
| M2 | Kilit son çıkanı beklemiyor (her bırakışta açılıyor) | YAKALANDI |
| M3 | Kilit açılırken sayfanın kendi değeri değil boş dize yazılıyor | YAKALANDI |
| M4 | `lockScroll:false` pencere de kilide katılıyor | YAKALANDI |
| M5 | `AuthModal` kabuğa geri kondu (çift montaj) | YAKALANDI |
| M6 | Söküldü mandalı montajda indirilmiyor (**TB-72'nin kökü**) | YAKALANDI |
| M7 | Onay dalından `kapat()` çağrısı kaldırıldı | YAKALANDI |
| M8 | Bayat closure koruması (`if (sokulduRef.current) return;`) tamamen kaldırıldı | **KAÇTI** |

**M8 neden kaçtı — ve neden buna test yazmadım.** Bileşen sökülürken aynı
temizleyici, bekleyen isteme `Escape` göndererek onu ZATEN iptal ediyor
(İP-A3c · P2-1; nöbetçisi `kirliFormBekcisi.test.tsx:223`). Yani onay `false`
çözülüyor ve `sokulduRef` dalı hiçbir karara varmıyor: gözlemlenebilir
davranışta ulaşılamaz bir ikinci savunma hattı. Ona test yazmak, davranışı
değil uygulama ayrıntısını sabitlemek olurdu (kök `CLAUDE.md` §E). Kayda
geçiriyorum ki "8/8" diye yuvarlanmasın.

### Gerçek tarayıcı katmanı — 2/2 yakalandı

Turun kendisi de kapı; bozuk kodu görmeyen bir tur süstür.

| # | Mutasyon | Sonuç |
|---|---|---|
| B0 | (taban) temiz kod | tur **YEŞİL** |
| B1 | TB-71 kusuru geri kondu (çift `AuthModal` + sayaçsız kilit) | tur **KIRMIZI** |
| B2 | TB-72 kusuru geri kondu (mandal montajda indirilmiyor) | tur **KIRMIZI** |

### Ölçüm aracının kendi kusurları (bulundu, düzeltildi)

1. `merkezIceren` görünür alanı umursamıyordu: `/magaza`da iki "Giriş Yap"
   bağlantısı var ve sonuncusu `y≈1967`de (footer). Tıklama ekran dışına
   gidiyor, hiçbir şey olmuyor ve tur "pencere açılmadı" diyordu.
2. `window.scrollTo(0, 400)` hemen ardından `scrollY` okunuyordu; `index.css`
   `html`e `scroll-behavior: smooth` yazdığı için değer daima `0` çıkıyordu —
   kilit açık olsa bile "kaydırılamadı" diyen **yalancı kırmızı**. `behavior:
   "instant"` + kısa bekleme ile düzeltildi.

---

## Kapı

| Kapı | Sonuç |
|---|---|
| `npm run build` (`tsc -b && vite build`) | **geçti** |
| `npm run lint` | **0 hata** (31 uyarı, hepsi önceden vardı) |
| Tam suite (sıralı) | **1761/1761 yeşil** |
| Mutasyon (Vitest) | **7/8** (M8 gerekçesi yukarıda) |
| Mutasyon (gerçek tarayıcı) | **2/2** |
| Gerçek Chrome turu | TB-71 3/3 · TB-72 6/6 ayak |
| Tam suite × 6 tohum (`--sequence.shuffle`) | **KIRMIZI — ama İP-A9 kaynaklı DEĞİL** ↓ |

### 6 tohum kapısı hakkında (TB-74)

| Tohum | 7001 | 7013 | 7027 | 7043 | 7059 | 7071 |
|---|---|---|---|---|---|---|
| Düşen test | 1 | 3 | 3 | **0** | 1 | 3 |

Düşenlerin **hepsi** `Test timed out in 9000ms`; tek bir assertion hatası yok
ve düşen testler koşumdan koşuma değişiyor. Üç ayrı ölçümle İP-A9'un neden
olmadığı gösterildi:

1. **HEAD'de, İP-A9'un hiçbir dosyası yokken, tohum 7001 → 2 düşük**
   (aynı iki `adminRezervasyonFiltre` testi).
2. İP-A9'un yalnız **üretim** değişiklikleriyle (yeni test dosyaları hariç)
   sıralı tam koşum: **1747/1747 yeşil**.
3. Düşen dosyalar tek başına koşturulunca **3/3 yeşil**.

Kök: `vitest.config.ts`teki 9000 ms bütçesi İP-12 FAZ 0'da **756 test / tepe
2.959 ms** (× 3.04 marj) ölçülerek seçilmişti. Suite **1747 teste** çıktı ve
tam koşumda ölçülen tepe **6.453 ms** — marj **1.39 kata** düştü. Bu, TB-23'ün
kapattığı kusurun yeni ölçekte geri gelmesidir. Ayrıntı ve sonraki adımlar:
`docs/teknik-borc.md` → **TB-74**. Bütçeyi ölçmeden büyütmek config dosyasının
kendi kuralınca yasak; düzeltme yabancı paketlerin ağır kabul testlerine
dokunmayı gerektirdiği için bu dar kapsamlı pakete alınmadı.

---

## Neyin kanıtlandığı (ve neyin kanıtlanmadığı)

**Kanıtlandı**

- `/magaza`da giriş penceresi açılıp kapandıktan sonra sayfa kaydırılabiliyor —
  gerçek Chrome'da, gerçek fare girdisiyle, 3/3 tur.
- Kaydırma kilidi iç içe pencerelerde LIFO dışı kapanmaya dayanıyor.
- `<AuthModal />` üretim ağacında tek yerde monte ediliyor.
- Kirli formda "Çık" düzenleme penceresini kapatıyor — dört kapatma yolunda,
  hem `StrictMode`lu jsdom'da hem gerçek panel ekranında.
- Her iki kapı da (Vitest + tarayıcı turu) bozuk kodu görüyor.

**Kanıtlanmadı / bilinen sınır**

- TB-72 **üretim derlemesinde** de canlı mıydı? `StrictMode` yalnız
  geliştirmede çift-koşum yapar, yani üretimde mandal muhtemelen inikti.
  Ölçmedim. Düzeltme yine de doğrudur: mandalın yeniden montajda inmemesi
  Fast Refresh, `Suspense` ve `key` değişimlerinde de aynı sonucu üretir.
- TB-71 turu yalnız `/magaza` üzerinde koşuldu; `PublicShell` kullanan 12
  sayfa için ayrı tarayıcı turu yapılmadı — oradaki kanıt kaynak nöbetçisi
  (AST) ve kilit sayacının davranış testidir.
- Karışık sıra kapısı **kırmızı** ve bu paketle kapanmadı (TB-74).
- Belge kusuru: `docs/teknik-borc.md`'de **TB-70, tanımı hiç açılmamış bir
  `TB-73`e atıf yapıyor**. Yeni kayıt bu yüzden TB-74 numarasını aldı.

## Tekrar üretme reçetesi

```bash
# frontend/
npm run dev -- --port 5199
# başka bir kabukta backend: uvicorn main:app --port 8000
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/v1/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'username=<admin>&password=<sifre>' | jq -r .access_token)
node scripts/ip_a9_tur.mjs --frontend http://127.0.0.1:5199 --token "$TOKEN"
```

`--token` verilmezse gerçek panel ekranı ayağı ATLANIR ve tur bunu açıkça
bildirir (sessizce kapsam daraltmaz). Çıktı ve ekran görüntüleri
`docs/arsiv/ip-a/ip-a9/` altına yazılır.
