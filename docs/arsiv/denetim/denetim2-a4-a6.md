# Bağımsız Denetim #2 — İP-A4 · İP-A5 · İP-A6

**Denetlenen uç:** `8ce1dda` (detached HEAD) · **Taban:** `3fd8742` (İP-A3a)
**Denetim tarihi:** 19 Ağustos 2026
**Denetçi:** bu kodu yazmayan bağımsız taraf. Geliştirici raporları
(`ip-a4/a5/a6-rapor.md`) **iddia** olarak okundu; hiçbir sayı, onu üreten
betik çalıştırılarak doğrulanmadı.

## Kullanılan aletler (hepsi bu denetimde yazıldı)

| Alet | Ne ölçer | Neden geliştiricininkinden bağımsız |
|---|---|---|
| `sayac2.mjs` | ham `<button`, kontrol, overlay, Medusa importu | Kaynak önce **esbuild** ile TSX→JS'e çevrilir (`jsx: "transform"`). Yorumlar yok olur, JSX metinleri düz string'e döner, her eleman `H("etiket", …)` biçimini alır. Sayım TypeScript AST'i üzerinde DEĞİL, bu çıktı üzerinde yapılır. |
| `kuralDagilimi.mjs` | 158 kontrolün her birinin **hangi af kuralıyla** adlandırılmış sayıldığı | Geliştiricinin sayacında böyle bir kırılım yok |
| `pencereDurumu.mjs` | ekranda yaşayan pencere durumu | Bağ, deklarasyon düğümünün **kimliğiyle** değil (dosya, satır, ad) üçlüsü + en dar kapsayan aralık ile çözülür |
| `susturucuAvi.mjs` | sayacı susturabilecek yazımlar (metinsiz `<label>`, `Form.Label`sız `Form.Control`, dinamik etiket) | — |
| `a5/kiyas.cjs` | A5'in "bayt-bayt aynı" iddiası | Satır çoklu-kümesi (multiset) karşılaştırması; A5'in blok karşılaştırmasından farklı |
| `cdp.mjs` + `p3_*.mjs` | gerçek Chrome (headless, CDP), gerçek `Tab`, gerçek kontrast, gerçek 380 px | Node 25 global `WebSocket`, ek bağımlılık yok |
| çalışma zamanı sondaları (Vitest) | erişilebilir ad = `dom-accessibility-api::computeAccessibleName` | Projenin kendi `test-utils/alanAdlari` yardımcısı **kullanılmadı** — o elle yazılmış bir yaklaşımdır, accname motoru değil |

Bütün geçici değişiklikler geri alındı; `git status --porcelain` denetim
sonunda yalnız bu raporu gösteriyor.

---

## 1 · Kendi ölçtüğüm sayılar

### 1a · Kapı (kendi koşturduğum)

| Kapı | Gördüğüm |
|---|---|
| `npx tsc --noEmit` | temiz |
| `npm run build` | başarılı (2 dk 18 s) |
| `npx vitest run` | **117 dosya / 1183 test ✅** |
| `--sequence.shuffle`, seed 11 · 4242 · 90210 · 777777 | **4/4 yeşil** (117/1183) |

> **Yalancı kırmızı — kendi hatam, kayda geçiyor.** İlk karıştırma turunda
> seed `777777` kırmızı düştü (`panel ağacındaki her dosya listede yazılıdır`).
> Sebep flaky test DEĞİLDİ: o sırada ölçüm deneyim için `src/components/admin/`
> altına geçici bir dosya bırakmıştım ve nöbetçi onu doğru şekilde yakaladı.
> Temiz ağaçta aynı seed yeniden koşturuldu → 1183/1183 yeşil. Nöbetçi haklıydı,
> ölçüm aletim değildi.

### 1b · Nöbetçi sayıları

| Ölçüm | İddia (A6) | **Benim ölçtüğüm** | Yöntem |
|---|---|---|---|
| ölçüm tabanı dosya sayısı | 82 | **82** | liste kaynaktan metin olarak ayıklandı, diskle karşılaştırıldı; eksik = 0 |
| ham `<button` | 131 | **131** | esbuild → `H("button"` |
| erişilebilir adı olmayan form kontrolü | 30 | **30** | bağımsız JSX ata analizi + örneklem çalışma zamanı doğrulaması |
| ölçülen toplam form kontrolü | 158 | **158** | aynı |
| ekranda yaşayan pencere durumu | 29 | **29** | bağımsız kapsam çözümü |
| `role="dialog"`/`aria-modal` taşımayan overlay | 4 | **4** | esbuild + `min(role, aria-modal)` |
| `ui2/` dışında Medusa importu | 0 | **0** | esbuild çıktısında `from "@medusajs/ui"` + `import("…")` |

**Beş ölçümün beşi de birebir tuttu.** Sayaç, ölçtüğünü doğru sayıyor.
Bulgular sayacın *aritmetiğinde* değil, **neyi saydığında**.

### 1c · Bundle (kendi build'imden)

| Chunk | ham | gzip | İddia |
|---|---|---|---|
| `gezinmeBekcisi-*.js` | 1 469 B | 800 B | 1 469 B ✅ |
| `AdminStore-*.js` | 67 597 B | 18 947 B | 66 880 B / 19,00 kB ✅ (±%1) |
| `duzenlemeYuzeyi-*.js` | 116 001 B | 38 608 B | 115,92 kB / 38,77 kB ✅ |
| `AdminLayout-*.js` | 13 300 B | 4 747 B | — |

Radix/Medusa `AlertDialog` **tam olarak bir** chunk'ta (`duzenlemeYuzeyi`).
`AdminLayout` yalnız `gezinmeBekcisi` (800 B gzip) + `index` + `vendor`
çekiyor. **R3 düzeltmesi tam** — başka giriş noktası kalmamış.

### 1d · Test türleri (dürüst sınıflandırma, kendi sayımım)

| Sınıf | Ölçtüğüm |
|---|---|
| toplam | 1183 test / 117 dosya |
| **kaynak/AST sözleşmesi** | **42 test** (`sayim` 29 + `uiBaseline` 10 + `adminPageHeadings` 3) = **%3,5** |
| gerçek DOM (RTL `render`) | 50 dosya |
| gerçekten gönderilen isteğin doğrulanması (axios adapter) | 26 dosya |
| gerçek tarayıcı / E2E | **0** |

Korkulan "1160 testin çoğu AST" tablosu **yanlış**: kaynak sözleşmesi testleri
suite'in %3,5'i ve hepsi nöbetçi aletinin kendi birim testleri. Bu iyi bir oran.

---

## 2 · Bulgular

Ağırlık: **P1** = A7 başlamadan düzeltilmeli · **P2** = düzeltilmeli · **P3** = not.

---

### BULGU-1 · P1 · Sayacın altıncı kusuru: birim "kontrol" değil, "kaynak yazımı"

**Bulgu.** Sayaç `<input>` / `<select>` / `<textarea>` **JSX yazımlarını**
sayıyor. Kullanıcı ise **render edilen** kontrolleri görüyor. Bir alanı yerel
bir fabrika bileşenine çıkarmak — A7 reçetesinin 1. ve 3. maddesinin doğal
sonucu — N borcu 1 borç olarak gösteriyor. Bu, bildirilen beş kusurun
hiçbiriyle aynı değil: onlar *yanlış sınıflandırma*ydı, bu **yanlış birim**.

**Kanıt (mutasyon, uygulandı ve geri alındı).**
`src/pages/dashboards/OperatorSessions.tsx` içine on iki kez kullanılan tek
yazımlık bir fabrika eklendi, ve aynı dosyadaki mevcut bir adsız kontrol
`aria-label` ile adlandırıldı:

```
function DenetimAlan({ deger }) { return <input className="input" defaultValue={deger} />; }
export function DenetimBlok() {
  return <div>{["a"…"l"].map((x) => <DenetimAlan key={x} deger={x} />)}</div>;
}
```

```
sayaç:  ADSIZ = 30            ← DEĞİŞMEDİ
nöbetçi: Test Files 2 passed | Tests 39 passed     ← TAMAMEN YEŞİL
```

Çalışma zamanı (aynı bileşen, `computeAccessibleName` ile):

```
### DENETIM2 fabrika: render edilen input = 12 | ADSIZ = 12
```

**Ekranda 12 adsız kontrol doğdu, sayaç 30 demeye devam etti, CI yeşil kaldı.**

**Aynı sınıf bugün üretimde var.** `ProductForm.tsx`'teki `KunyeAlani` tek
yazım, **dokuz** çağrı yeri (satır 571-579). Gerçek tarayıcı/jsdom ölçümü:

```
### ProductForm (oluşturma + künye açık) RENDER EDİLEN KONTROL: 17 | ADSIZ: 0
adlar: ["Ürün adı","Ürün türü","Kategori (opsiyonel)","Fiyat (TL)","Eski fiyat (opsiyonel)",
"KDV oranı (%)","Stok","Açıklama (opsiyonel)","Yazar (opsiyonel)","Yayınevi (opsiyonel)",
"ISBN / Barkod (opsiyonel)","Sayfa sayısı (opsiyonel)","Ebat (opsiyonel)","Basım yılı (opsiyonel)",
"Baskı (opsiyonel)","Dil (opsiyonel)","Kapak tipi (opsiyonel)"]
```

Dokuz künye alanı sayaçta **1**. Ayrıca 158 yazımın **7'si** bir `.map()`
içinde (`AdminAccessPage:161,205` · `DeliveryOrdersPage:299` ·
`PackagesPage:298` · `OperatorLibrary:565,581,588`), yani satır sayısı kadar
render ediliyor. `OperatorLibrary:581` ve `:588` zaten **adsız** listesinde —
gerçek borç 30'dan büyük.

**Etki (21 ekran).** Eşik `toBeLessThanOrEqual(30)` biçiminde. Göç bir ekranın
tekrar eden alanlarını fabrikaya çıkardıkça payda küçülür; sayı "düştü" diye
okunur. Daha kötüsü ters yön: **yeni borç fabrika/döngü içinde yazıldığında
nöbetçi onu 1/N oranında görür.** A7'de 21 ekran bu reçeteyle yazılacak.

**Öneri.** Eşiğin doğruluk kaynağı sayaç olmaktan çıkıp **dal testi** olmalı
(`adlarDogru(enAz)` zaten render edilen kontrolü sayıyor). Sayaç teşhis aleti
olarak kalabilir, ama "adsız kontrol ≤ 30" kapısı çalışma zamanı sayısına
bağlanmadıkça A7 boyunca güvenilir değil.

---

### BULGU-2 · P1 · Ölçümün *erişilebilirlik sınırı* yanlış: 41 ham buton, 37 kontrol, 2 etiketsiz overlay görünmüyor

**Bulgu.** `OLCUM_TABANI` artık ölçümün kaynağı (A6 · Görev 1) ve iki yönlü
korunuyor (`eksikDosyalar` / `fazlaDosyalar`). Ama `fazlaDosyalar`ı üreten
`kesfedilenTaban()` yalnız **üç dizini** yürüyor:
`components/admin/**`, `pages/admin/**`, `dashboards/Admin*.tsx` (+ altı adet
elle eklenmiş `EK_TABAN_DOSYALARI`). Bu ağaçların **dışındaki** bir panel
dosyası ne `eksik`e ne `fazla`ya düşer — **hiçbir nöbetçi görmez.**

**Kanıt A — kaçış deneysel olarak sınandı (uygulandı, geri alındı).**

```
src/lib/denetim2Kacak.tsx   (3 ham <button>, 3 adsız kontrol, 1 etiketsiz overlay)
→ npx vitest run src/__guards__
  Test Files 2 passed | Tests 39 passed          ← SESSİZ GEÇTİ

aynı dosya src/components/admin/ altına konunca:
  FAIL  panel ağacındaki her dosya listede yazılıdır
  → expected [ Array(1) ] to deeply equal []      ← YAKALANDI
```

Kontrol deneyi kuralı doğruluyor: koruma **dizin şekilli**, dosya şekilli değil.

**Kanıt B — bu, teorik bir risk değil; bugün 41 ham buton kaçıyor.**
Ölçülen 82 dosyanın **doğrudan import ettiği**, ölçüm dışı yerel bileşenler:

| Modül | ham `<button` | kontrol | etiketsiz overlay | Kim çekiyor |
|---|---|---|---|---|
| `components/ExamSessionsManager.tsx` | 14 | 13 | **1** | `AdminExamCatalogs`, `OperatorHome` |
| `components/LibraryEditorModal.tsx` | 5 | 15 | **1** | `AdminLibraries` |
| `components/MapPicker.tsx` | 9 | 1 | 0 | `AdminLibraries` |
| `components/QrScanner.tsx` | 3 | 1 | 0 | 3 ekran |
| `components/LibraryMediaManager.tsx` | 3 | 2 | 0 | `AdminLibraries` |
| `components/DashboardHeader.tsx` | 3 | 0 | 0 | panel kabuğu |
| `components/DashboardShell.tsx` | 2 | 0 | 0 | panel kabuğu |
| `components/LibraryPayoutForm.tsx` | 1 | 5 | 0 | `AdminLibraries` |
| `components/LibrariesMap.tsx` | 1 | 0 | 0 | `AdminLibraries` |
| **TOPLAM** | **41** | **37** (8'i **adsız**) | **2** | |

Yani gerçek sayılar:

| Ölçüm | Nöbetçi | Gerçek (en az) | Sapma |
|---|---|---|---|
| ham `<button` | 131 | **≥172** | **+%31** |
| adsız form kontrolü | 30 | **≥38** | **+%27** |
| etiketsiz overlay | 4 | **≥6** | **+%50** |

`AdminLibraries` ve `AdminExamCatalogs` **zaten** `UNLABELED_OVERLAY_FILES`
listesinde — yani ekranın kendi overlay'i sayılmış, ama o ekranın asıl
düzenleme yüzeyi olan `LibraryEditorModal` / `ExamSessionsManager`'ın
etiketsiz overlay'i sayılmamış. `AdminLibraries`'in göçü planlanırken
düzeltilecek yüzeyin **çoğu ölçüm dışında.**

**Kanıt C — sınır A6 sırasında da kaydı.** A6 iki yeni dosya üretti:
`src/lib/storeProductForm.ts` (257 satır) ve `src/lib/storeCouponForm.ts`
(84 satır). İkisi de panel form kuralı, ikisi de ölçüm dışı. Bugün JSX
taşımadıkları için sayı değişmiyor — ama sınırın nereye kaydığını gösteriyor.

**Etki (21 ekran).** A7 "dosya hareketi normal iş akışı" olacak bir paket.
Bir ekranın JSX'ini `src/components/<yeni>/` ya da `src/lib/` altına almak
borcu **sessizce** ölçüm dışına çıkarır — A5'in kapattığını sandığı kaçışın
tam olarak aynısı, sadece başka kapıdan.

**Öneri.** `kesfedilenTaban()` dizin yürüyüşü yerine **import grafiği**
yürümeli: taban dosyalarından ulaşılan her yerel `.tsx` ölçüme girmeli (ya da
`fazlaDosyalar`a düşmeli). Bugün bunu yapan 30 satırlık bir betik yeterli —
`kapsamDisi.mjs` tam olarak bunu yaptı.

---

### BULGU-3 · P2 · A5'in sözlüksel kapsam düzeltmesi yeni bir kör nokta açtı

**Soru (görevde açıkça soruldu):** A5 sayacı "sözlüksel kapsamla bağ ayırt
etme" diye düzeltti. Bu düzeltme yeni bir kör nokta açtı mı? → **Evet.**

**Önce/sonra.** İP-A4'te (`44765c7`) sayaç dosya başına bir `Set<ad>` tutuyor
ve kullanım yerinde `durumAdlari.has(t)` diyordu — yani **ad eşleşmesi dosya
ölçeğindeydi**. A5 bunu kapsam çözümüne çevirdi: kullanım düğümünün ataları
arasında, bildirimin kapsayan fonksiyonu aranıyor.

**Yeni kör nokta.** Durum ebeveynde yaşayıp **aynı dosyadaki bir çocuk
bileşene prop olarak** iniyorsa, çocuğun JSX ataları arasında ebeveynin
fonksiyonu YOKTUR → bağ çözülemez → **sayılmaz.** A4 sürümü aynı adı
gördüğü için sayardı.

**Kanıt (mutasyon, uygulandı ve geri alındı).**

```tsx
function DenetimCocuk({ acik }: { acik: boolean }) {
  return <ConfirmDialog open={acik} … />;
}
export function DenetimUst() {
  const [acik, setAcik] = useState(false);
  return <div><span onClick={() => setAcik(true)}>ac</span><DenetimCocuk acik={acik} /></div>;
}
```

```
npx vitest run src/__guards__
Test Files  2 passed | Tests  39 passed        ← ekranda yaşayan pencere durumu +1, sayaç 29'da kaldı
```

**Etki (21 ekran).** "Ekranı alt bileşenlere böl" A5'in kendi yaptığı iştir ve
A7'de 21 kez tekrarlanacak. Bölme, pencere durumunu ölçümden düşürüyor —
üstelik borç ekranda kalmaya devam ederken. Metriğin ölçtüğü şey ("bu durum
`ui2/`ye taşındı mı") ile ödüllendirdiği şey ("bu durumu bir çocuğa prop
olarak geçir") ayrışıyor.

**Not:** A5'in düzelttiği asıl kusur **gerçekti ve düzeltme doğruydu** —
bunu bağımsız olarak doğruladım: bölünme öncesi `AdminStore.tsx`te üç ayrı
`deleting` bağı var (satır 1236, 1441, 2057) ve üçü de bir pencereye veriliyor.
33 + 2 = 35 doğru sayı.

---

### BULGU-4 · P1 · `useUrlDurumu`: aynı olayda iki `ayarla` çağrısı ilkini sessizce yutuyor

**Bulgu.** `yaz()` render sırasında yakalanmış `params`'ı kapatıyor
(`useCallback` bağımlılığı). Bir olay işleyicisinde `ayarla` iki kez
çağrılırsa ikinci çağrı **bayat** `params`'tan türeyen bir URLSearchParams
kurar; birincinin yazdığı kaybolur.

**Kanıt (gerçek DOM + gerçek router).**

```
onClick={() => { u.ayarla({ q: "a" }); u.ayarla({ sayfa: 3 }); }}

### T3 iki-yazma search = ?sayfa=3 | q =  | sayfa = 3
AssertionError: expected { q: '', sayfa: 3 } to deeply equal { q: 'a', sayfa: 3 }
```

**Etki (21 ekran).** "Filtreyi uygula **ve** sayfayı başa al", "aramayı temizle
ve durumu sıfırla", iki kontrolün aynı işleyiciden yazması — filtre
ekranlarında sıradan yazımlar. Sonuç sessiz: hata yok, filtre uygulanmamış
görünür. Bu projede `axios paramsSerializer` hatası üretim filtrelerini bir
kez kırdı; aynı sınıf.

**Öneri.** `setParams` fonksiyonel biçimi destekliyor:
`setParams((onceki) => …)`. Tek satırlık düzeltme, ve mevcut
`useUrlDurumu.test.tsx` bu senaryoyu içermiyor.

---

### BULGU-5 · P1 · `DuzenlemePenceresi` yalnız TEK korumalı içerik taşıyor; ikincisi ilkini sessizce eziyor

**Bulgu.** `useYuzeyKirliFormBekcisi` bekçiyi bağımlılık dizisi olmayan bir
`useEffect` ile pencereye bildiriyor; pencere onu tek bir `bekciRef`te
tutuyor. Aynı pencerede **iki** içerik bekçi kurarsa **en son render eden
kazanır**; diğerinin koruması yok olur. Ne `throw` var, ne uyarı, ne belge.

**Kanıt (gerçek DOM).** Tek `DuzenlemePenceresi` içinde iki form; A kirletildi,
sonra B kirletilip temize döndürüldü (yani B en son render etti ve temiz):

```
### T6 A kirliyken kapatma → onay = false | pencere açık = false
```

**Kullanıcının A'ya yazdığı veri, hiçbir soru sorulmadan gitti.**
(Karşıt kontrol: yalnız A kirliyken onay penceresi **açılıyor** — yani hata
sıraya bağlı, dolayısıyla sahada aralıklı ve teşhisi zor.)

**Etki (21 ekran).** Bu, A6'nın "içeriğin tek satır bile yazmadan koruma
kazanması" vaadinin tam kalbi. Bugün üretimde tek içerikli tek bir çağrı yeri
var (`EditProductModal` → `ProductForm`), yani tetiklenmiyor. Çok bölümlü
düzenleme penceresi (ki 21 ekranda kaçınılmaz) bu yola girer.

**Öneri.** `bekciRef` yerine bir küme; `kapatmayiDene` korumalı olan **herhangi
bir** bekçiyi bulunca sorsun. Ya da en azından ikinci kayıtta geliştirmede
`throw` — `Form.Control`da tercih edilen yol.

---

### BULGU-6 · P2 · İç içe düzenleme yüzeyi: tek ESC bütün açık pencereleri birden tüketiyor

**Bulgu.** `useModalA11y` ESC dinleyicisini `document`e kuruyor ve açık her
pencere kendi dinleyicisini işletiyor. İç içe iki yüzeyde **tek ESC ikisine de
gider.**

**Kanıt (gerçek DOM).**

```
İki yüzey de açık, ikisi de TEMİZ:
### T1 ESC sonrası: dis:false ic:false        (beklenen: dis:true ic:false)

Dış form KİRLİ, iç pencere açık:
### T5 ESC sonrası durum = dis:true ic:false | kirli-form onayı açıldı mı = true
```

İkinci durumda dış yüzey (bekçi sayesinde) kurtuluyor — ama kullanıcı
**iç pencereyi kapatmak isterken** dış yüzey için "kaydedilmemiş değişiklikler
var" onayıyla karşılaşıyor.

**Etki (21 ekran).** Düzenleme yüzeyinden onay penceresi/ikinci yüzey açmak
sıradan bir desen (A6'nın kendisi `ProductsPanel`de iki yüzey tutuyor).
Kullanıcı bir kez ESC'ye basıp iki adım geri gidiyor.

**Öneri.** Modal yığını (stack) — ESC yalnız en üstteki pencereye gitsin
(`event.stopPropagation()` yetmez; `useModalA11y` ortak bir yığın tutmalı).

---

### BULGU-7 · P2 · `GezinmeBaglantisi` kirli yolda `NavLink` sözleşmesini düşürüyor

**Bulgu.** Temiz formda tıklama `NavLink`e gider (bütün prop'lar geçerli).
Kirli formda gezinme `navigate(to)` ile yapılıyor ve `state`, `replace`,
`preventScrollReset`, `relative` **düşüyor**. Yani **davranış, ekranda kirli
bir form olup olmamasına göre değişiyor.**

**Kanıt (gerçek DOM + gerçek router).**

```
<GezinmeBaglantisi to="/b" state={{ kaynak: "denetim" }}>Git</GezinmeBaglantisi>
kirli form + "Sayfadan ayrıl" onayı →
### T4 kirli gezinme sonrası konum = /b|null      (beklenen: state korunmalı)
```

**Etki (21 ekran).** Tip sistemi yardım etmiyor: `GezinmeBaglantisiProps`
`Omit<NavLinkProps, "children">`ı genişletiyor, yani `state`/`replace` yazmak
`tsc`'ye tamamen geçerli görünüyor. Bileşenin sözleşmesi "NavLink'in bütün
sözleşmesi korunur, eklenen tek şey tıklama kapısı" diye **yazılı** — bu yanlış.

**Öneri.** `navigate(to, { replace: kalan.replace, state: kalan.state,
preventScrollReset: kalan.preventScrollReset, relative: kalan.relative })`.

---

### BULGU-8 · P2 · Onay beklerken hedef değişirse, onay YANLIŞ hedefe uygulanıyor

**Bulgu.** `kirliFormBekcisi` sökülme durumunu (`sokulduRef`) kontrol ediyor
ama **hedef değişimini** kontrol etmiyor. Kullanıcı "A'yı at" sorusuna cevap
verirken ebeveyn hedefi B'ye çevirirse, onay B'yi kapatıyor.

**Kanıt (gerçek DOM).**

```
### T7 onay açıkken hedef = kayit:2
### T7 onaydan sonra hedef = kapalı        (beklenen: kayit:2 açık kalmalı)
```

**Etki.** `duzenlemeYuzeyi.tsx`'in "Bilinen sınır" notu yalnız **ebeveynin
kapatması** yönünü belgeliyor; **yeniden hedefleme** yönü belgesiz. Liste
ekranlarında (bir satırdan diğerine geçmek) sıradan bir akış.

---

### BULGU-9 · P2 · `useUrlDurumu` dizi değeri taşıyamıyor

**Bulgu.** `UrlDeger = string | number`. Çoklu seçim filtresi (durum kümesi,
etiket kümesi) bu kancada temsil edilemiyor.

**Doğrulanan iyi haber:** Türkçe ve özel karakterler **doğru** tur atıyor —
`URLSearchParams` kodluyor, okuma çözüyor:

```
### T3 TR search = ?q=%C3%A7a%C4%9Fr%C4%B1+%C4%B1%C5%9F%C4%B1%C4%9F%C4%B1 | okunan q = çağrı ışığı
### T3 özel search = ?q=a+b%2Bc%26d%3De | okunan q = "a b+c&d=e"
```

**Etki (21 ekran).** Çoklu filtresi olan ekran ya kancayı kullanamayacak ya da
"a,b" gibi elle bir kodlama uyduracak — kancanın çözmek için var olduğu
"her ekran kararı yeniden veriyor" sorununun geri dönmesi.

**Ayrıca (P3):** aynı sayfada iki liste için ad alanı (prefix) yok; iki
`useUrlDurumu` aynı anahtarı kullanırsa birbirini ezer. Bugün böyle bir ekran
yok.

---

### BULGU-10 · P2 · `test-setup.ts`'teki 4× gevşetme bu makinede hiçbir test tarafından gerekmiyor

**Bulgu.** A4, RTL'in `asyncUtilTimeout`unu **global olarak** 1000 → 4000 ms
yaptı (117 test dosyasının tamamını etkiler). Gerekçe yazılı ve makul
(yük altında iki test 1 s'yi aşıyordu).

**Kanıt (uygulandı, geri alındı).** Değer 1000'e döndürülüp **tam suite**
koşturuldu:

```
Test Files  2 failed | 118 passed (120)
Tests       4 failed | 1187 passed (1191)
```

Düşen 4 testin **dördü de bu denetimin kendi sondalarıdır** (BULGU-4/5/6/7'yi
belgeleyen, kasten kırmızı testler). **Projenin mevcut 1183 testinin hiçbiri
düşmedi.**

**Etki.** Tek koşu ve tek makine; geliştiricinin yük-bağımlı teşhisini
çürütmez. Ama gevşetme **global**: iki testin sorununu 117 dosyanın
duyarlılığını 4× düşürerek çözüyor. Cerrahi karşılığı vardı —
`waitFor(…, { timeout: 4000 })` yalnız o iki çağrı yerinde. Bugünkü hâliyle
gerçek bir yavaşlama regresyonu 4 saniyeye kadar sessizce yutulur.

---

### BULGU-11 · P3 · TB-A6-2'nin kapsamı: bugün canlı örneği yok, ama sınıfı daha geniş

Görevde soruldu: "TB-A6-2'nin kapsamı iddia edilenden geniş mi? Yazılmamış
`Form.Label` dışında, sayacı susturan başka yazım var mı?"

**Ölçtüm.** 158 kontrolün af kuralı dağılımı:

| Af kuralı | Sayı |
|---|---|
| `<label>` sarmalaması | 51 |
| `Form.Control` atası (TB-A6-2 bölgesi) | 37 |
| `aria-label` / `aria-labelledby` | 19 + 0 |
| yerel `Field` sarmalayıcısı (`DeliveryVehiclesPage`) | 18 |
| `htmlFor` ↔ `id` metin eşleşmesi | 3 |
| **ADSIZ (borç)** | **30** |

Sonra her af kuralının susturulabileceği yazımlar tarandı:

- **`Form.Label` hiç yazılmamış `Form.Control`: 0 örnek.** 37'sinin 37'sinde
  kardeş `Form.Label` var. TB-A6-2 bugün canlı borç üretmiyor.
- **Metinsiz `<label>` sarmalaması: 0 gerçek örnek.** İki aday
  (`ProductPicker.tsx:76`, `AdminAccessPage.tsx:205`) incelendi; ikisinde de
  etiket metni dinamik ama gerçek (`{label}`, `{permission.name}`).
- **Dinamik `Form.Label` içeriği: 5 örnek** — `ProductForm.tsx` satır
  670 (`{etiket}` prop'u), 905/919 (`{group.option1_name}` /
  `{group.option2_name}`), 1008/1019 (`` {`Yeni ${group.option1_name}`} ``).
  Sunucudan boş/`null` gelirse alanın erişilebilir adı boşalır ya da
  "Yeni null" olur. Ne sayaç ne `Form.Control` koruması bunu görebilir; dal
  testi de yalnız **fixture'ın verdiği değer** için görür.
- **`aria-label`in varlığı ada eşit sayılıyor** (değeri değil):
  `aria-label=""` ya da `aria-label={undefined}` sayacı susturur. Bugün
  19'unun 19'u dolu — 15'i sabit metin, 4'ü şablon. Canlı borç yok, **kural
  yanlış**.

**Sonuç.** TB-A6-2 doğru bildirilmiş ve bugün zararsız; ama "kapatan tek şey
dal testi" ifadesi eksik: dal testi **fixture'ın açtığı değerleri** kapatır,
dinamik etiketin boş gelme ihtimalini kapatmaz.

---

### BULGU-12 · P3 · `ui2/` sözleşmesi iki üretim çağrı yerinde sınandı

- `DuzenlemeYuzeyi` üretimde **1** çağrı yeri: `inventory/DamageDialog.tsx`.
- `DuzenlemePenceresi` üretimde **1**: `store/EditProductModal.tsx`.
- Diğer yedi `useDuzenlemeYuzeyi` kullanımı yalnız `ConfirmDialog`/
  `ReasonDialog` durumu — bekçiden geçmiyor (form yok, doğru).
- `HATA_TAKIBI_YOK` üretimde **0** çağrı yeri (yalnız testlerde). Kaçış yolu
  açılmış ama kullanılmamış — **iyi**, ve görevdeki soru bu: haklı mı?
  Bugün soru boş; kullanan olmadığı için gevşeme yok.

**Not:** A7'nin 21 ekrana kopyalayacağı soyutlamanın toplam üretim maruziyeti
**iki bileşen**. BULGU-5/6/8'in üçü de bu iki yolun dışına çıkıldığında ortaya
çıktı — yani sözleşme, henüz sınanmamış yazımlarda kırılıyor.

---

## 3 · P3 — Gerçek tarayıcı (Chrome + CDP, headless)

Kurulum: gerçek `DamageEventsPage` (pilot ekran) ve gerçek `DataTable` +
`Form.*`, sahte axios adaptörüyle **uydurma** veriyle render edildi.
**Canlı `ceyhandb`'ye bağlanılmadı; gerçek kişisel veri kullanılmadı.**

### 3a · `renderMobileRow` — 380 px (kod tabanında yıllardır vardı, hiç görülmemişti)

```json
{ "gorunumGenislik": 380, "belgeGenislik": 380, "yatayTasma": false,
  "tabloGorunur": false, "kartSayisi": 6,
  "kartGenislikleri": [346, 346, 346],
  "kartYukseklikleri": [92, 93, 129],
  "kartTasan": 0, "enKucukYaziPx": 12,
  "sayfalamaGorunur": true,
  "ilkKartMetni": "Hasara ayrıldı | 3 adet | Ürün #4200 · Hasarlı · Kırık | 18 Ağu 2026 12:15 · #1" }
```

**Sonuç: sağlam.** Yatay taşma yok, kart içi taşma yok, masaüstü tablosu
gerçekten gizli (`display: none`), en küçük yazı 12 px, sayfalama görünür ve
sarıyor. Uzun not (128 karakter) kartı 129 px'e büyütüyor ve kesilmiyor.
Ekran görüntüleri açık ve koyu temada alındı; **koyu tema paritesi tam.**

Tek not (P3): bu ekran `onRowClick` vermiyor, dolayısıyla mobil kartlar
tıklanamaz (`mobilKaptaTiklanabilir: 0`). Doğru davranış — ama `onRowClick`
verildiğinde kart bir `<button>`a sarılıyor ve **kartın tamamı tek bir
düğmeye** dönüşüyor; kart içinde ikinci bir aksiyon (ör. satır menüsü)
konulamaz. A7'de satır aksiyonu olan ekranlarda bu sınır göze çarpacak.

### 3b · Odak tuzağı — gerçek `Tab` / `Shift+Tab`

```
### pencere açılışı: {"pencereVar":true,"ariaModal":"true",
                      "odakElemani":"BUTTON:Kapat ×","odakPencereIcinde":true}
### TAB izi (14 tur): 6 öğelik döngü — hepsi icerde:true
### Tab pencere DIŞINA kaçtı mı: false ( 0 /14 )
### Shift+TAB izi: geriye doğru aynı döngü, hepsi icerde:true
### ESC sonrası: {"pencereVar":false,"odakAcanDugmede":true,"odak":"BUTTON:Hasara ayır"}
```

**A6'nın `useModalA11y` değişikliği gerçek klavyeyle doğrulandı:** tuzak
sızdırmıyor, iki yönde de sarıyor, ESC kapatıyor ve **odak açan düğmeye
dönüyor**. Pencere içindeki üç kontrolün üçünün de erişilebilir adı var
(`Ürün ara`, `Miktar`, `Neden`), adsız = 0.

Sınır (P3): panel dışında hâlâ **8 odaklanabilir öğe** var; arka plan `inert`
ya da `aria-hidden` değil. Klavye tuzağı bunu kapatıyor, `aria-modal="true"`
ekran okuyucular için kapatıyor — ama fare/AT için tek savunma `aria-modal`.

### 3c · `aria-sort` — gerçek tarayıcıda

```
başlangıç : [{"Ad","none"},{"Fiyat","none"},{"Sıralanamaz",null}]
1. tık (Ad): [{"Ad","ascending"}, …]
2. tık (Ad): [{"Ad","descending"}, …]
```

**Doğru çalışıyor.** İki uyarı:

1. **Pilot ekran bunu hiç kullanmıyor.** `DamageEventsPage`'in yedi kolonunun
   yedisi `enableSorting: false` → yedi `<th>`in `aria-sort`u `null`. Yani
   A6'nın eklediği özellik pilotta ölçülemez; ancak `ProductsPanel` tipi bir
   ekranda görünür.
2. **Sıralama değişimi DUYURULMUYOR** (`canliBolge: 0` — sayfada hiç
   `aria-live`/`role="status"` yok). `aria-sort` yalnız kullanıcı o başlığa
   *gittiğinde* okunur; tıkladıktan sonra odak düğmede kaldığı için ekran
   okuyucu çoğu tarayıcı/AT çiftinde yeni durumu kendiliğinden söylemez.
   Görevdeki soru "sıralama değişince duyuruluyor mu?" — **hayır**;
   `aria-sort` doğru ama tek başına yeterli değil. Küçük bir
   `role="status"` şeridi ("Fiyata göre artan sıralandı") bunu kapatır.

### 3d · Kontrast ve yerleşim — gerçek hesaplanmış renkler

```
### YERLEŞİM: hata öncesi y = 497 | sonrası y = 497 | kayma = 0 px
```

**Tek-slot vaadi gerçek tarayıcıda tuttu:** hata doğduğunda altındaki hiçbir
şey itilmiyor.

| Öğe | Açık tema | Koyu tema |
|---|---|---|
| **hata mesajı** (`rgb(225,29,72)` / `rgb(251,113,133)`) | **4,70** | **6,63** |
| `<label>` (14 px) | 10,35 | 14,48 |
| tablo başlığı / hint (12 px) | 4,55 | 6,96 |
| tablo hücresi | 10,35 | 12,02 |
| sayfalama metni | 4,76 | 6,96 |

**4,5'in altında hiçbir öğe yok** — iki temada da. Geliştiricinin bildirdiği
4,70 rakamı birebir doğrulandı. Yine de: 4,70 eşiğin yalnız **0,20**
üstünde ve **12 px**'lik bir metin için; büyük-metin muafiyeti geçerli değil.
Tek bir ton koyulaştırma (`rose-600` → `rose-700`) marjı rahatlatır.

### 3e · Koyu temada görülen tek görsel kusur

`<input type="number">` (Miktar alanı) koyu temada tarayıcının **yerel
artır/azalt oklarını** açık renkli bir blok olarak çiziyor — koyu panelin
üstünde beyaz bir kare gibi duruyor. Yalnız gerçek tarayıcıda görülür
(jsdom çizmez). A7'de sayısal alanı olan her ekranda tekrarlayacak.

---

## 4 · P2 — A5'in "hiçbir davranış değişmedi" iddiası

**Kendi yöntemim:** `44765c7`'deki 2216 satırlık `AdminStore.tsx` ile
`546715d`'deki dokuz dosya (yeni `AdminStore` + sekiz bölüm), yorum ve boşluk
atıldıktan sonra **satır çoklu-kümesi** olarak karşılaştırıldı (A5'in blok
karşılaştırmasından farklı bir yöntem).

```
ORİJİNAL anlamlı satır:                    2010
YENİ dosyalarda BULUNAMAYAN satır:           34
YENİ dosyalarda EKLENEN satır:               76
```

**34 "kayıp" satırın 34'ü de mekanik:**
- 26'sı bölünen `import { … } from "@/api/store"` / `"@/hooks/useStore"` /
  `"@/types"` bloklarının tek tek satırları,
- 8'i `function ProductsPanel() {` → `export function ProductsPanel() {`
  dönüşümü (8 bileşenin 8'i).

**76 "eklenen" satırın 76'sı da mekanik:** her yeni dosyanın yeniden yazılan
import başlığı + `export` anahtar kelimesi.

**Davranış taşıyan tek bir satır düşmemiş, sessizce değişmiş bir koşul ya da
kayan bir import yok.** A5'in iddiası doğru — ve bunu A5'in kendi aletiyle
değil, bağımsız bir yöntemle doğruladım.

**Pencere durumu 33 → 35 düzeltmesi doğru.** Bölünme öncesi dosyada üç ayrı
`deleting` bağı var (satır 1236 · 1441 · 2057) ve üçü de bir pencere
bileşenine veriliyor; eski sayaç dosya başına `Set<ad>` tuttuğu için üçünü tek
sayıyordu. 33 + 2 = 35. **Yeni bir sayaç kusuru değil, eskisinin düzeltilmesi**
— ancak düzeltmenin açtığı yeni kör nokta BULGU-3'tedir.

---

## 5 · P5 — Regresyon ve kapsam

| Kontrol | Sonuç |
|---|---|
| `git diff --name-only 3fd8742..8ce1dda -- src/` (test dışı) | 27 dosya; **beyan edilen kümeyle birebir aynı** |
| Beyan edilmemiş ekran değişikliği | **yok** |
| `package.json` / `package-lock.json` değişikliği | **yok** (A4→A6 boyunca sıfır satır) |
| Beyan edilmemiş bağımlılık | **yok** |
| Gönder düğmesi geçerlilikte kapanıyor mu (`disabled={!isValid}` vb.) | **hiçbir yerde yok** — kalıcı kural tutuyor |
| `ui2/` dışında Medusa importu | **0** |
| Medusa `AlertDialog` kaç chunk'ta | **1** (`duzenlemeYuzeyi`), `AdminLayout`tan erişilmiyor |

`src/__probe__/` silinmesi A4'te (`44765c7`) oldu, A6'da değil.

**Sınıflandırılmamış davranış değişikliği bulamadım.** A6'nın R1-R7
sınıflandırması, benim diff üzerinden bulabildiklerimi kapsıyor. Tek
sınıflandırılmamış kalem `test-setup.ts`'teki global gevşetme (BULGU-10) —
o da A4'ün Görev 5b'sinde gerekçesiyle yazılı, ama "regresyon
sınıflandırması" tablosunda yer almıyor.

---

## 6 · Doğrulayamadıklarım

1. **TB-A6-3'ün *deltası*.** `AdminStore` chunk'ının mutlak boyutunu (67 597 B
   / 18 947 B gzip) doğruladım; ama "%9,3 büyüdü (61 193 → 66 880)" iddiasının
   **tabanını** doğrulamak `546715d`'de ikinci bir build ister ve bu, bu
   worktree'nin dışına yazmayı ya da HEAD'i oynatmayı gerektirirdi
   (görev kuralı 2-3). Mutlak sayılar tuttuğu için iddiayı şüpheli
   bulmuyorum, ama **bağımsız olarak ölçmedim**.
2. **Yük altındaki kararsızlık teşhisi.** BULGU-10'da `asyncUtilTimeout`u
   1000'e döndürüp tam suite'i koşturdum ve hiçbir proje testi düşmedi — ama
   bu **tek makinede tek koşu**. Geliştiricinin CI/yük gözlemini çürütmez.
3. **Gerçek ekran okuyucu.** `aria-sort`un ve `role="alert"`in NVDA/JAWS/
   VoiceOver'da *fiilen ne söylediğini* ölçmedim; ölçtüğüm şey DOM'daki
   öznitelik ve canlı bölge yokluğu. "Duyurulmuyor" sonucum bu ikisinden
   çıkarım, doğrudan gözlem değil.
4. **Gerçek dokunmatik cihaz.** 380 px ölçümü Chrome'un cihaz emülasyonuyla
   yapıldı; gerçek bir telefonda dokunma hedefi ve kaydırma hissi
   ölçülmedi.
5. **`AdminStore`un tam kabul turu tarayıcıda.** Gerçek tarayıcıda sürülen
   ekranlar pilot (`DamageEventsPage`) ve ortak `DataTable`/`Form.*`. Sekiz
   mağaza bölümünün tarayıcı turu yapılmadı — jsdom dal testleri var, ama
   `renderMobileRow`un `OrdersPanel`deki hâli ve `ProductForm`un katlanır
   bölümlerinin dar ekranda davranışı **gerçek tarayıcıda görülmedi**.
6. **`fazlaDosyalar` kaçışının tarihsel boyutu.** BULGU-2'deki 41 ham
   butonun ne kadarının A4-A6 sırasında doğduğunu değil, **bugün ne kadar
   olduğunu** ölçtüm.

---

## 7 · A7 hazır mı?

**Kısa cevap: hayır — ama uzak değil. A7'den önce iki paket girmeli.**

Desenin **omurgası sağlam** ve bunu ölçtüm: beş nöbetçi sayısının beşi de
doğru; A5'in "davranış değişmedi" iddiası bağımsız yöntemle doğrulandı;
odak tuzağı, ESC, odak iadesi ve `aria-sort` **gerçek tarayıcıda** çalışıyor;
kontrast iki temada da eşiğin üstünde; tek-slot vaadi 0 px kayma ile tutuyor;
mobil kart düzeni 380 px'te temiz; bağımlılık eklenmemiş; `ui2/` sözleşmesi
sızdırmamış; testlerin yalnız %3,5'i kaynak sözleşmesi.

Ama denetimin tek sorusu "bu desen 21 kez kopyalanmaya hazır mı" idi, ve
**desenin sınandığı üretim yüzeyi iki bileşenden ibaret.** Sözleşmenin
dışına çıkan her yazımda (iç içe yüzey, tek pencerede iki form, aynı
işleyicide iki URL yazımı, `state`'li gezinme bağlantısı, onay sırasında
hedef değişimi) **bir kusur çıktı — beş denemede beş.** Bu oran, A7'nin
21 ekranı bugünkü sözleşmeyle yazmasının güvenli olmadığını söylüyor.

### Bölme ekseni: ağırlık değil, ALET mi DAVRANIŞ mı

Bulguları ilk yazımda P1/P2 ağırlığına göre paketlemiştim. **Yanlıştı.**
BULGU-1, 2 ve 3'ün üçü de tek bir şeyin farklı yüzleri: *sayaç yanlış şeyi
sayıyor*. Üçü düzeltilince taban rakamlar oynayacak. Aynı pakette hem alet
düzeltilip hem borç kapatılırsa, sayının neden değiştiği bir daha ayırt
edilemez — ve iki kez yeniden tabanlamak bir kez yeniden tabanlamaktan
kötüdür. Bu yüzden sıra ağırlığa göre değil, **alet önce, davranış sonra**
kurulmalı.

### İP-A6b — ÖLÇÜM ONARIMI (`src/` altında davranış değişikliği SIFIR)

| # | Bulgu | Onarım |
|---|---|---|
| **BULGU-1** | Sayacın birimi "kaynak yazımı", "kontrol" değil | Eşiğin doğruluk kaynağı sayaçtan **çalışma zamanı dal testine** geçer; sayaç teşhis aleti olarak kalır |
| **BULGU-2** | Ölçüm sınırı dizin şekilli | `kesfedilenTaban()` dizin yürüyüşü yerine **import grafiği** yürür |
| **BULGU-3** | Prop olarak inen pencere durumu görünmüyor | Bağ çözümü, aynı dosyadaki çocuk bileşene prop olarak inen durumu da yakalar |
| **BULGU-10** | Global `asyncUtilTimeout` 4× gevşetmesi | Cerrahi `waitFor(…, { timeout })` — yalnız iki çağrı yerinde |

BULGU-3 ilk yazımda P2'ydi, gerekçesi "bugün canlı örneği yok"tu. **Yukarı
çekiyorum:** kusur tam olarak "ekranı alt bileşene böl" davranışında
tetikleniyor ve A7 bunu 21 kez yapacak. Sayaç zaten açılıyorsa üçüncü kusur
da orada kapanmalı.

**Beklenen yeni taban** (paket sonunda ölçülüp eşiklere donacak):

| Ölçüm | Bugün | Onarımdan sonra |
|---|---|---|
| ham `<button` | 131 | **≥172** (ölçülecek) |
| adsız form kontrolü | 30 | **≥38** (ölçülecek) |
| etiketsiz overlay | 4 | **≥6** (ölçülecek) |
| ekranda yaşayan pencere durumu | 29 | **bilinmiyor** — bugün kaç gerçek prop-ile-inen durum olduğunu ölçmedim; BULGU-3 sentetik mutasyonla kanıtlandı, saha sayımı A6b'nin işi |

**Kabul kapısı — iki kaçış mutasyonu kalıcı regresyon testi olmalı.**
İkisi de bu denetimde koşturuldu ve bugünkü nöbetçilerden **sessizce geçti**;
onarım doğruysa ikisi de kırmızı verir:

1. `OperatorSessions.tsx` içine on iki çağrılı tek-yazımlık adsız alan
   fabrikası + aynı dosyada bir borcun kapatılması → bugün sayaç 30'da kalıyor,
   39/39 yeşil.
2. `src/lib/denetim2Kacak.tsx` (3 ham `<button>`, 3 adsız kontrol, 1 etiketsiz
   overlay) → bugün 39/39 yeşil. Negatif kontrol: aynı dosya
   `src/components/admin/` altına konunca yakalanıyor.

### İP-A6c — SÖZLEŞME ONARIMI (kırmızı test matrisi hazır)

| # | Bulgu | Onarım | Hazır kırmızı test |
|---|---|---|---|
| **BULGU-4** | `useUrlDurumu` aynı olayda ilk yazımı yutuyor | `setParams((önceki) => …)` — tek satır | T3 |
| **BULGU-5** | `DuzenlemePenceresi` ikinci korumalı içeriği eziyor | **Önce geliştirmede `throw`** (küme değil) | T6 |
| **BULGU-7** | `GezinmeBaglantisi` kirli yolda `state`/`replace`/`relative` düşürüyor | `navigate(to, { … })` | T4 |
| **BULGU-8** | Onay beklerken hedef değişirse onay yanlış hedefe uygulanıyor | Hedef damgası — `sokulduRef`in yanına | T7 |

BULGU-7 ve 8 ilk yazımda P2'ydi; **yukarı çekiyorum**: dördü de aynı sınıf
(sessiz veri kaybı / sessiz yanlış hedef), aynı test koşumunda, ve dördünün de
kırmızı testi yazılmış durumda.

**BULGU-5 için küme değil `throw`.** İkinci bekçiyi bir kümeye çevirmek
"hangi bekçi sorar, sırayla mı sorar, biri iptal ederse ne olur" sorularını
açar. `throw` bugün veri kaybını durdurur ve tasarımı A7'ye erteler —
`Form.Control`da tercih edilen yolun aynısı.

### A7'nin ilk paketine kalan (gerçek tasarım kararı gerektiriyor)

- **BULGU-6** (iç içe ESC): küme değil **yığın** istiyor. `useModalA11y` ortak
  bir modal yığını tutmalı; bu bir tasarım kararı, düzeltme değil.
- **BULGU-9** (dizi filtresi): ilk çoklu-seçim ekranı gelene kadar spekülatif.

### Notlar (P3)

BULGU-11 (dinamik `Form.Label`), BULGU-12 (maruziyet), 3a'daki `onRowClick`
sınırı, 3c'deki canlı bölge eksikliği, 3d'deki 4,70 marjı, 3e'deki koyu tema
sayı-girdisi oku.

### A7'ye 21 ekranla değil, ÜÇ ekranla başla

Bu denetimin en güçlü bulgusu bir rakam değil: **sözleşme dışına çıkılan beş
denemenin beşinde kusur çıktı**, ve soyutlamanın toplam üretim maruziyeti
**iki bileşen**. A6b ve A6c bittikten sonra da bu risk geçerli olacak — çünkü
kapanan şey bulunan kusurlar, sınanmamış yazım alanı değil.

Bu yüzden A7 bir pilot dalgayla açılmalı: **yapısal olarak birbirinden farklı
üç ekran** — (a) çok bölümlü form, (b) çoklu filtre, (c) satır aksiyonlu
liste. Üçü sözleşmeyi üç ayrı yönden zorlar; kusur çıkarsa geri alınacak
yüzey 21 değil 3 ekran olur.

### Bir de şunu söylemek gerekiyor

Geliştiricinin kendi bildirdiği üç borcun (TB-A6-1/2/3) üçü de **doğru
bildirilmiş** ve ikisi bugün zararsız (TB-A6-2'nin canlı örneği yok, TB-A6-1
paylaşımlı bir chunk). R3 regresyonunun düzeltmesi **tam** — bunu build
çıktısında chunk chunk doğruladım. Bu paketlerin özeleştirisi dürüst.

Bulduğum altı yeni kusurun hiçbiri gizlenmiş değildi; **hiçbiri bugünkü
aletlerle görülebilir de değildi.** Beşi ancak sözleşmeyi henüz kimsenin
yazmadığı biçimde kullanınca ortaya çıktı, biri de ancak sayacın birimi
sorgulanınca. A7'nin 21 ekranı, tam olarak o "henüz kimsenin yazmadığı
biçimleri" yazacak.
