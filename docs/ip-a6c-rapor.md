# İP-A6c — Sözleşme onarımı · kapanış raporu

**Taban:** `feat/medusa-ui-taban` @ `e7e3041` (İP-A6b)
**Kapsam:** `ui2/**` · `hooks/**` · `__guards__/**` · testler · `docs/**`
**Ekran göçü:** yok — hiçbir ekran dosyası değişmedi (Görev 8'de doğrulandı)

Denetim #2, sözleşmenin dışına çıkılan beş yazımda beş kusur buldu. A6b ölçüm
aletini onardı; bu paket sözleşmenin kendisini onarır. Dördü kapatıldı, biri
(BULGU-6) bilinçli olarak A7'ye bırakıldı — düzeltme değil tasarım istiyor.

---

## Görev 0 — Taban doğrulaması

`git log --oneline -3` → `e7e3041` HEAD'de. Kapı kendi elimle koşturuldu:

| Kapı | Sonuç | Kayıt |
|---|---|---|
| `tsc -b` | exit 0 | `docs/ip-a6c/g0-tsc.txt` |
| `npm run build` | exit 0 | `docs/ip-a6c/g0-build.txt` |
| `vitest run` | **121 dosya / 1206 test** yeşil | (koşum kaydı; özet aşağıda) |
| `--sequence.shuffle` seed 11, 22 | 1206 yeşil | — |

> **Dürüstlük notu.** Seed 33 ve 44 kırmızı döndü ve bu bir taban sorunu
> DEĞİLDİ: o iki koşum, kırmızı matris dosyasını yazdıktan sonra başladı ve
> 1220 test topladı (1206 + benim 14 kırmızım). Taban kapısı seed 11/22 ile
> karşılandı; kapanış kapısında altı seed birden yeniden koşturuldu (aşağıda).
>
> Taban koşumlarının ham çıktıları **saklanmadı**: özetlemek için yazdığım
> filtre kayıtları bozdu (kapının bilerek ürettiği "mount edilemedi" satırlarını
> yakalayıp özet satırlarını dışarıda bıraktı). Bozuk dosyayı düzeltmek yerine
> sildim ve kapanış kapısını doğru filtreyle **yeniden koşturdum** — uydurma
> özet yazmak, kanıt üretmemekten daha kötüdür. Bu yüzden `docs/ip-a6c/` altında
> yalnız kapanış kapısının kayıtları var.

A6b'nin beş nöbetçi sayısı taban olarak alındı: ham `<button` **199** · adsız
kontrol **41** · pencere durumu **32** · etiketsiz overlay **6** · taban dosya
**109**.

---

## Görev 1 — Kırmızı matris (implementasyondan önce)

Dört testin kaynağı yalnız denetim raporunun kanıt bloklarındaydı; yeniden
kuruldular. Hepsi tek dosyada:
`frontend/src/components/admin/ui2/a6cSozlesme.test.tsx`.

Ham çıktı: `docs/ip-a6c/kirmizi-matris.txt` (özet:
`docs/ip-a6c/kirmizi-matris-ozet.txt`).

| Test | Kırmızı hâli (ölçülen) |
|---|---|
| **T3** | `expected { q: '', sayfa: 3 } to deeply equal { q: 'a', sayfa: 3 }` — ilk yazım yutuldu |
| **T6** | `expected [Function] to throw an error` — ikinci bekçi sessizce eziyor |
| **T6a** *(geçici)* | `{ onay: false, pencereAcik: false }` — denetimin ölçtüğü satırın aynısı: A'nın verisi soru sorulmadan gitti |
| **T4** (`state`) | `expected '/siparisler|null' to be '/siparisler|{"kaynak":"denetim"}'` |
| **T4** (`replace`) | geri tuşu `/kok`a değil `/magaza/detay`a döndü — `replace` düşmüş |
| **T4** (`relative`) | `..` rota hiyerarşisine göre çözüldü — `relative="path"` düşmüş |
| **T7** | `expected 'kapalı' to be 'kayit:2'` — onay, kullanıcının sormadığı kaydı kapattı |

**Kırmızı: 7 · negatif kontrol yeşil: 7.**

### "Hiç koşmadı" ayrımı (A2'den beri uygulanan kural)

İlk yazımda T4'ün **dördü de** `"onay penceresi açılmadı"` ile düştü. Bu
kırmızı test DEĞİLDİ, koşum aracı hatasıydı: gezinme onayı panelin
`ConfirmDialog`unu kullanır (`role="dialog"`), pencere kapatma onayı ise
Medusa `usePrompt`u (`role="alertdialog"`). Yardımcı yanlış rolü arıyordu.
Düzeltildikten sonra dördü de **gerçek** sebeple kırmızıya döndü ve kanıt o
koşumdan alındı. Yardımcının başındaki tablo bu tuzağı yazılı hâle getirir.

### T6a'nın kaderi

T6a bugünkü sessiz veri kaybını yeniden üreten geçici sondaydı. Onarımdan
sonra bu senaryo **ifade edilemez** — iki korumalı içerikli pencere açılır
açılmaz patlar. Kanıtı alındıktan sonra kaldırıldı; yerini T6 aldı.

---

## Görev 2 — BULGU-4 · `useUrlDurumu` ilk yazımı yutuyor

### Denetimin önerdiği tek satırlık düzeltme YETMİYOR

Denetim `setParams((önceki) => …)` fonksiyonel biçimini önermişti ("tek
satırlık düzeltme"). Uygulandı ve **ölçüldü**: T3 kırmızı kaldı
(`docs/ip-a6c/g2-yalniz-fonksiyonel.txt`).

Sebep react-router-dom **7.18.1**'in kendi kaynağında:

```js
// react-router/dist/development/chunk-KS7C4IRE.mjs · useSearchParams
typeof nextInit === "function" ? nextInit(new URLSearchParams(searchParams)) : nextInit
```

Geri çağrıya **canlı bir ref değil, render sırasında kapatılmış** `searchParams`
geçiyor. Aynı olay işleyicisinde iki `ayarla` çağrısı arasında render olmadığı
için ikinci çağrı da birincinin yazdığını göremiyor. Fonksiyonel biçim, React
`useState`'in aksine burada bir garanti vermiyor.

### Uygulanan onarım

Hook, "henüz konuma yansımamış yazım"ı kendi ref'inde tutuyor — **yazıldığı
andaki konumla birlikte**. Bekleyen yazım yalnız konum hâlâ o taban
üzerindeyken geçerli; konum değiştiyse (render oldu, geri tuşuna basıldı,
başka bir bileşen yazdı) bayattır ve atılır.

**Bu tasarım kendi negatif kontrolüm tarafından zorlandı.** İlk yazımda ref
`queueMicrotask` ile temizleniyordu; "dışarıdan gelen adres değişimi ezilmez"
kontrolü onu kırdı — senkron bir çağrı dizisinde mikro görev hiç koşmaz ve
bayat yazım dışarıda yapılan gezinmeyi geri alır. Temizleme konuma bağlandı.

Ek karar: aynı işleyicideki **ikinci** yazım `replace` olur. Tek kullanıcı
hareketi = tek geçmiş girdisi; aksi hâlde geri tuşu kullanıcının hiç görmediği
ara duruma ("filtre uygulandı ama sayfa sıfırlanmadı") dönerdi. Ayrı testi var.

### Kanıt

- T3 yeşil · T3 (geçmiş girdisi) yeşil
- **Negatif kontrol 1:** sonraki olayda sayfa sıfırlama kuralı hâlâ işliyor
  (birleştirme olay sınırını aşmıyor)
- **Negatif kontrol 2:** dışarıdan gelen adres değişimi ezilmiyor
- Mevcut `useUrlDurumu.test.tsx` (10 test) dokunulmadan yeşil kaldı

### Bilinen sınır

Ref hook örneği başınadır. **İki ayrı bileşen** aynı işleyicide kendi
`useUrlDurumu`larından yazarsa birbirlerini hâlâ ezerler. Bugün böyle bir çağrı
yeri yok; A7'de filtre çubuğu ile tablo ayrı hook örnekleri kullanırsa bu yol
açılır.

---

## Görev 3 — BULGU-5 · `DuzenlemePenceresi` ikinci korumalı içeriği eziyordu

Kayıt kimliksizdi ve pencere onu tek bir `bekciRef`te tutuyordu: iki içerik
varsa **en son render eden kazanıyor**, diğerinin koruması sessizce yok
oluyordu.

### Onarım: küme değil, geliştirmede `throw`

Her içerik artık kendi `symbol` kimliğiyle kaydoluyor; pencere bir `Map`
tutuyor. İkinci kayıtta geliştirmede patlıyor, üretim derlemesinde eleniyor
(`GELISTIRME = !!import.meta.env?.DEV`, `Form.Control`daki desenin aynısı).

Küme yapmak "hangi bekçi sorar, sırayla mı sorar, biri iptal ederse ne olur,
iki onay üst üste mi açılır" sorularını açardı — bu paketin işi sözleşmeyi
onarmak, genişletmek değil.

Hata mesajı ne yapılması gerektiğini söyler ("Bölümleri ayrı pencerelere
ayırın ya da tek bir form kurup `useYuzeyKirliFormBekcisi`yi bir kez
çağırın"); test bunu ayrıca sınar.

### Kanıt

- T6 yeşil (hata sınırıyla yakalanır — aşağıya bakın)
- **Negatif kontrol 1:** tek korumalı içerik patlamaz ve korur (bugünkü tek
  üretim çağrı yeri `EditProductModal` aynen çalışır)
- **Negatif kontrol 2:** ardışık içerik değişimi patlamaz (kayıt birikmiyor —
  kümülatif sayım olsaydı sekmeli/adımlı her yüzey ikinci render'da patlardı)

### Testin kendisi hakkında iki düzeltme

1. `expect(() => render(…)).toThrow()` **çalışmaz**: hata bir passive effect
   içinde doğuyor, React onu `render` çağrısından senkron vermiyor, en yakın
   **hata sınırına** gönderiyor. Test bir `HataSiniri` ile yazıldı — ve bu
   uygulamanın gerçek yolu (`App.tsx` → ErrorBoundary), yani test gerçek
   davranışı ölçüyor.
2. Pencere **kapalıyken** `Dialog` çocuklarını hiç render etmez, dolayısıyla
   kayıt da olmaz. Test önce "kapalıyken boşuna patlamadı"yı doğruluyor, sonra
   pencereyi açıp korumayı sınıyor.

### Bilinen sınır

Koruma pencere **açıldığında** ateşlenir, dosya yazıldığında değil. Geliştirici
ekranı bir kez açar açmaz görür; statik olarak (tsc/lint) görülmez.

---

## Görev 4 — BULGU-7 · `GezinmeBaglantisi` kirli yolda sözleşmeyi düşürüyordu

Kirli yolda `navigate(to)` çağrılıyor, `state` · `replace` ·
`preventScrollReset` · `relative` · `viewTransition` düşüyordu. Aynı bağlantı,
ekranda kirli bir form olup olmamasına göre farklı davranıyordu — üstelik tip
sistemi yardım etmiyordu (`GezinmeBaglantisiProps`, `NavLinkProps`ı
genişlettiği için `state` yazmak `tsc`'ye geçerli görünür).

Onarım: `navigate(to, gezinmeSecenekleri)`, liste tek yerde ve yorumda
"NavLink'e yeni bir gezinme seçeneği eklenirse buraya da eklenmeli" yazılı.

`flushSync` listeye **girmedi**: `NavigateOptions`ta var ama `NavLinkProps`ta
yok, dolayısıyla bileşene hiç ulaşmıyor (tsc doğruladı).

### Kanıt

- T4 `state` · `replace` · `relative="path"` — üçü de yeşil
- **Negatif kontrol 1:** temiz yol aynı sonucu veriyor (`state`)
- **Negatif kontrol 2:** temiz yol aynı yere gidiyor (`relative`) — bulgunun
  asıl iddiası iki yolun **eşitliği**
- **Negatif kontrol 3:** onay reddedilirse gezinme hiç olmuyor

### Kendi testimdeki hata (gizlenmiyor)

`relative="path"` testi önce kırmızı kaldı ve sebebi üretim kodu değildi:
bağlantıyı `<Routes>` **dışına** koymuştum. `relative="path"` konum yoluna
değil **rota bağlamına** göre çözülür (`resolveTo` → `routePathnames[son]`);
bağlantı kök bağlamdaydı, `..` her iki yolda da `/` veriyordu — yani testin
beklentisi yanlıştı. Bağlantı gerçek rota bağlamına taşındı; yorumu dosyada.

---

## Görev 5 — BULGU-8 · onay beklerken hedef değişimi

`sokulduRef` yalnız "bileşen gitti mi" sorusunu cevaplıyordu; "kapatılacak şey
hâlâ aynı mı" sorulmuyordu.

Onarım: `kapatmayiDene` onay istendiği andaki hedefi damgalar; söz çözüldüğünde
`hedefRef.current !== damga` ise onay **düşer**. Yeniden sormak da yanlış
olurdu — kullanıcı bu arada bir şey yapmadı.

Hedef katmanlar arası şöyle akıyor:

- `DuzenlemeYuzeyiKapisi`ye `hedef: unknown` eklendi (kapı hedefin **ne**
  olduğunu bilmez, yalnız **değiştiğini** bilmesi yeter)
- `DuzenlemeYuzeyi` → `useKirliFormBekcisi({ hedef: yuzey.hedef })`
- `DuzenlemePenceresi` → `HedefCtx` → `useYuzeyKirliFormBekcisi` (içerik hedefi
  bilmek zorunda değil)
- `hedef` verilmezse damga hep eşit sayılır → hedefi olmayan çağrı yerleri
  etkilenmez

### Kanıt

- T7 yeşil
- **Negatif kontrol:** hedef değişmediyse onay normal uygulanıyor (damga her
  onayı düşürseydi bekçi hiç çalışmazdı)
- Mevcut `duzenlemeYuzeyi.test.tsx` (15) ve `kirliFormBekcisi.test.tsx` (12)
  dokunulmadan yeşil

---

## Görev 6 — İki görsel kusur (gerçek tarayıcı)

Sonda: `frontend/scripts/ip_a6c_gorsel_probe.mjs` + `scripts/probe/a6c-probe.html`
(Chrome + CDP, headless). **Canlı `ceyhandb`'ye bağlanılmadı**, sahte veri.
Ölçüm: `docs/ip-a6c/gorsel-olcum.json`; ekran görüntüleri `a6c-acik.png` /
`a6c-koyu.png`.

### 6a — hata kırmızısının marjı

| Tema | Önce | Sonra | Eşik |
|---|---|---|---|
| Açık (`rose-600` → `rose-700`) | **4,70** | **6,29** | 4,5 (12 px, büyük-metin muafiyeti yok) |
| Koyu (`rose-400`, dokunulmadı) | 6,63 | **6,63** | 4,5 |

Sondanın kendi geçerlilik kapısı var: hata metni doğmadıysa, tema değişmediyse
ya da açık tema 5,5'in altına düşerse ölçüm geçersiz sayılır ve çıkış kodu 2
olur.

### 6b — koyu temada sayı girdisi

`<input type="number">`ın yerel artır/azalt okları koyu panelin üstünde beyaz
bir blok gibi çiziliyordu. Çözüm `Form.Control` katmanında, tek yerde:
sayı alanına `dark:[color-scheme:dark]` eklenir → tarayıcı yerel widget'ı
kendisi koyu çizer.

Okları `appearance: none` ile **silmek** de bir seçenekti; seçilmedi: ok,
klavye yerine fare kullanan ya da ince motor kontrolü sınırlı kullanıcının
gerçekten kullandığı bir araçtır, kaybı erişilebilirlik kaybıdır.

Ölçülen `color-scheme` (gerçek Chrome):

| | onarımlı alan | onarımsız alan |
|---|---|---|
| Açık tema | `normal` | `normal` |
| Koyu tema | **`dark`** | `normal` |

Sonda sayfası ikisini **yan yana** basar; `a6c-koyu.png`de sağdaki (onarımsız)
beyaz blok, soldaki (onarımlı) koyu ve alana karışmış durumda. Açık temada iki
alan da aynı (`a6c-acik.png`) — kör çekiç değil. Chrome okları yalnız
hover/odakta çizdiği için sonda sayfasına yalnız-ölçüm amaçlı bir
`opacity: 1` stili konuldu (üretime girmez).

### CI nöbetçisi

jsdom ne renk hesaplar ne yerel widget çizer; bu yüzden suite'e **kararı**
sabitleyen üç test eklendi: hata sınıfı `text-rose-700` + `dark:text-rose-400`
taşır · sayı girdisi `dark:[color-scheme:dark]` alır ve kendi sınıfını kaybetmez
· metin girdisine dokunulmaz.

---

## Görev 7 — Kapı kapsamı sayıyla değil kimlikle

A6b'nin çalışma zamanı kapısı `kapsanan.length >= 88` ile korunuyordu. Sayı
kimlik değildir. `KAPI_KAPSAMI` isimle sabitlendi (88 dosya) ve iki yönlü
korunuyor:

- listede olup artık kapsanmayan → kırmızı
- kapsanıp listede olmayan → kırmızı
- ek: `KAPI_KAPSAMI` ile `KAPI_DISI` **kesişmez** ve ikisi tabanı tam kaplar
  (listenin kendisi bir kaçış kapısı olmasın)

`KAPI_DISI`'na park edilen 17 dosyanın gerekçe sınaması korundu.

### Ters prova

`OLCUM_TABANI`'nda bir dosya çıkarılıp yerine başkası konuldu
(`AppIcon.tsx` → `AddressSection.tsx`). Toplam 105 sabit, dolayısıyla
`kapsanan.length` **88'de sabit**:

```
✓ taban ekranlarının hepsi ya kapıda ya gerekçeli listede   ← sayısal kapı YEŞİL kaldı
× kapı kapsamı KİMLİKLE sabittir (sayı değil)               → expected […(88)] to deeply equal […(88)]
× KAPI_KAPSAMI ile KAPI_DISI kesişmez ve ikisi tabanı tam kaplar
```

Eski sayısal nöbetçi bu değişimi **göremezdi**. Kayıt:
`docs/ip-a6c/g7-ters-prova.txt`. Mutasyon geri alındı, `git status --porcelain`
başta/sonda özdeş (`g7-agac-once.txt` ile diff'lendi).

> İlk ters provam kusurluydu ve raporlanıyor: iki tarafı (KAPI_DISI **ve**
> KAPI_KAPSAMI) birden tutarlı değiştirmiştim; bu zaten görünür, gözden
> geçirilebilir bir düzenlemedir ve kimlik testinin yakalaması beklenmez.
> Sınanması gereken senaryo "sayı sabit kalırken kimliğin kayması"ydı.

---

## Görev 8 — Eşikler ve mutasyon

### Beş sayı değişmedi

| Nöbetçi | A6b tabanı | A6c sonrası |
|---|---|---|
| ham `<button` | 199 | **199** |
| adsız kontrol | 41 | **41** |
| pencere durumu | 32 | **32** |
| etiketsiz overlay | 6 | **6** |
| taban dosya | 109 | **109** |

Kayıt: `docs/ip-a6c/g8-sayilar-sonra.json`. Beklenen sonuç — bu paket ekran
değiştirmedi. (`scripts/probe/A6cGorselProbe.tsx` `src/` altında değil, ölçüm
tabanına girmez.)

### Mutasyon provası — 6/6

Sürücü: `frontend/scripts/mutasyon-a6c.mjs`. `git checkout --` **kullanmaz**;
ham baytlar bellekte tutulur ve aynen geri yazılır (CRLF korunur),
`git status --porcelain` başta ve sonda karşılaştırılır.

| # | Mutasyon | Sonuç |
|---|---|---|
| M1 | BULGU-4: bekleyen yazım unutulsun | KIRILDI (1 test) |
| M2 | BULGU-5: ikinci bekçi kaydında patlamasın | KIRILDI (1) |
| M3 | BULGU-7: onaydan sonra seçenekler düşsün | KIRILDI (3) |
| M4 | BULGU-8: hedef damgası kontrol edilmesin | KIRILDI (1) |
| M5 | 6a: hata kırmızısı eski tona dönsün | KIRILDI (1) |
| M6 | 6b: sayı girdisine şema uygulanmasın | KIRILDI (1) |

`AGAC BASTA==SONDA: true` · Görev 7'nin ters provası ayrıca yukarıda.

**Negatif kontroller**, onarımlar yerindeyken de onarımlardan **önce** de
yeşildi (kırmızı matris koşumunda 7/7 yeşil) — yani hiçbiri onarımın yan
etkisiyle "kazanılmış" değil.

---

## Kapanış kapısı

| Kapı | Sonuç |
|---|---|
| `tsc -b` | exit 0 |
| `npm run build` | exit 0 |
| `npm run lint` | exit 0 |
| `vitest run` | **122 dosya / 1226 test** yeşil |
| `--sequence.shuffle` seed 11 · 22 · 33 · 44 · 55 · 66 | altısı da yeşil |

Eklenen 20 test: 15'i sözleşme matrisi (T3/T4/T6/T7 + negatif kontroller),
3'ü Görev 6 kararlarının nöbetçisi, 2'si Görev 7'nin kimlik koruması.
Kapı kayıtları `docs/ip-a6c/kapi-*.txt`.

### Bulunan bir test kusuru (gizlenmiyor)

Kapının **ilk** koşumunda seed 22 tek bir kırmızı verdi:
`adminStoreDalAdlari.acceptance.test.tsx` → **D-2**, `"Düzenle"` düğmesi
bulunamadı. Hata dökümündeki DOM **iskelet** hâlindeydi
(`aria-label="Yükleniyor"`, `animate-pulse`) — yani ürün listesi sorgusu RTL'in
1000 ms'lik varsayılan `findBy*` bütçesinde çözülmemişti. Aynı seed tek başına
koşturulunca yeşildi.

Bu **flaky değil**, yük altında daralan gerçek bir zamanlama penceresidir
(bu projede bir kez daha yaşandı: kök CLAUDE.md §I ve `feedback_ci_red_local_green`).
"Tek başına geçti" kanıt sayılmadı.

Onarım A6b'nin kurduğu desenin aynısı: bütçe **global değil, çağrı yerinde**
(`const YUK = { timeout: 4000 }`), yalnız `duzenlemeyiAc`in iki ağ sorgusu
bekleyen `findByRole` çağrısında. Liste bilinçli olarak genişletilmedi; hiçbir
iddia değişmedi, yalnız bekleme bütçesi. Kabul testinin davranışına
dokunulmadı.

**Kabul edilen bedel** (A6b'nin de kabul ettiği): o çağrı yerinde gerçek bir
performans regresyonu 4 saniyeye kadar gizlenebilir. Bu, testin sahada
rastgele kırmızı olmasına yeğlendi.

### Test türleri (dürüst sınıflandırma)

| Tür | Sayı |
|---|---|
| Gerçek DOM + gerçek router (RTL, mock yok) | 15 |
| Gerçek DOM (sınıf kararı nöbetçisi) | 3 |
| Kimlik/kapsam sözleşmesi (ölçüm tabanı listesi) | 2 |
| Gerçek tarayıcı (Chrome + CDP, kontrast + `color-scheme` + ekran görüntüsü) | 1 sonda, 2 tema |
| Kaynak/AST sözleşmesi | 0 |

Bu pakette snapshot yok, "import oldu" testi yok.

---

## A7'ye taşınan notlar

### 1. BULGU-6 — iç içe ESC (tasarım kararı, düzeltme değil)

`useModalA11y` ESC dinleyicisini `document`e kuruyor ve açık her pencere kendi
dinleyicisini işletiyor: iç içe iki yüzeyde **tek ESC ikisine de gider**.
Kullanıcı bir kez basıp iki adım geri gidiyor; dış form kirliyse iç pencereyi
kapatmak isterken dış yüzeyin "kaydedilmemiş değişiklikler" onayıyla
karşılaşıyor.

`event.stopPropagation()` yetmez — `useModalA11y` ortak bir **modal yığını**
tutmalı ve ESC yalnız en üsttekine gitmeli. A6'nın kendisi `ProductsPanel`de
iki yüzey tutuyor; A7'nin çok yüzeyli ekranlarında sıradan olacak.

### 2. `onRowClick` sınırı — **kilitli kararımızla çakışıyor**

`DataTable`ın mobil kartı, satır tıklanabilirse bütünüyle tek bir `<button>`a
sarılıyor. İçine ikinci bir aksiyon konulamaz (iç içe interaktif öğe). Bu,
"**satır aksiyonları açık düğme kalır**" kilitli kararımızla doğrudan çakışır
ve A7'nin "satır aksiyonlu liste" pilot ekranında patlar.

Karar A7'nin ilk dalgasında verilmeli: ya kart sarmalayıcısı `<button>` olmaktan
çıkar (tıklanabilir bölgeyi başlığa daraltıp aksiyonları kardeş yapmak), ya da
o ekranlarda `onRowClick` kullanılmaz.

### 3. Sıralama değişimi duyurulmuyor

Sütun sıralaması değiştiğinde `aria-live` bölgesi yok; ekran okuyucu kullanıcısı
tablonun yeniden sıralandığını duymuyor. `role="status"` taşıyan bir şerit
kapatır (küçük iş, ama A7'de 21 ekranda tekrarlayacak — bir kez `ui2/`'de).

### 4. Bu paketten çıkan desen kararları

- **Onarımı kütüphanenin vaadine değil, ölçüme dayandır.** `setParams`ın
  fonksiyonel biçimi "doğru cevap" gibi görünüyordu; bu router sürümünde
  çalışmıyor. A7'de benzer bir "tek satırlık düzeltme" önerisi çıkarsa önce
  kırmızı testle sınansın.
- **Her onarımın negatif kontrolü yazılsın.** Bu pakette negatif kontrol
  kendi onarımımdaki bir kusuru yakaladı (mikro görevle temizleme).
- **Genişletme değil onarım.** BULGU-5'te küme yerine `throw` seçildi;
  tasarım sorusu açan her onarım A7'ye ertelenmeli.
- **Katmanda bir kez.** 6b `Form.Control`da çözüldü; 21 ekran sayısal alan
  için ayrı bir şey yazmayacak.

---

## Bilinen sınırlar

1. **`useUrlDurumu` ref'i hook örneği başına.** İki ayrı bileşen aynı
   işleyicide kendi hook örneklerinden yazarsa hâlâ birbirlerini ezer. Bugün
   böyle bir çağrı yeri yok.
2. **BULGU-5 koruması çalışma zamanında.** Pencere açıldığında patlar, dosya
   yazıldığında değil; `tsc`/lint göremez.
3. **BULGU-5 üretimde eleniyor.** Üretimde ikinci korumalı içerik hâlâ
   sessizce birincisini eziyor olurdu — ama geliştirme ve CI'da o kod hiç
   yazılamayacağı için üretime ulaşamaz.
4. **Tarayıcının geri/ileri tuşu** (İP-A6'dan devam) bu router mimarisinde
   kapatılamıyor.
5. **Görsel ölçüm tek tarayıcı.** Kontrast ve `color-scheme` yalnız Chrome'da
   ölçüldü; Firefox/Safari'nin yerel sayı girdisi farklı çizebilir.
6. **Bekleme bütçesi** `adminStoreDalAdlari` D-2'de 4 sn'ye çıkarıldı; o
   çağrı yerindeki bir performans regresyonu artık 4 sn'ye kadar görünmez.
7. **BULGU-9** (dizi filtresi) ve **BULGU-6** kapsam dışı bırakıldı; ilki
   çoklu-seçim ekranı gelene kadar spekülatif, ikincisi tasarım kararı.
