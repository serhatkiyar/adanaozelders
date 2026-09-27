# İP-A3a — Kirli form bekçisi, metrik onarımı, 422 bağlantısı

**Dal:** `feat/medusa-ui-taban` · **Tarih:** 19 Ağustos 2026
**Kapanış kapısı:** `tsc --noEmit` temiz · `npm run test` **109 dosya / 1074 test yeşil** · `npm run build` başarılı

Giriş durumu 108 dosya / 1050 testti; net **+24 test**, kırılan yok.

---

## Görev 0 — A2 commit'i ve merge engeli

### 0a · A2 commit'lendi

```
37e27f0  feat(ip-a2): form katmani + alan bazli hata (pilot DamageDialog)
```

Commit öncesi kapı: `tsc --noEmit` temiz · **108 dosya / 1050 test** yeşil ·
`npm run build` başarılı.

Commit'e girenler: `package.json` + lock, `scripts/ui-baseline-sayim.mjs`,
`scripts/ip_a2_{mutasyon,slot_probe}.mjs`, `src/__guards__/{uiBaseline,sayim}`,
`src/__probe__/FormSlotProbe.tsx`, `form-probe.html`,
`src/components/admin/ui2/{form.tsx + 3 test}`,
`src/components/admin/inventory/DamageDialog.{tsx,test.tsx}`,
`src/lib/inventory.ts`, `docs/arsiv/ip-a/ip-a2-rapor.md`, `docs/arsiv/ip-a/ip-a2/`.

Commit dışında bırakılanlar (A1'de de öyleydi): depo kökündeki `sayim.sh`,
`borderscan.mjs`, `cssdiff.mjs` ve `ip-a*-prompt.md`. Takipsiz duruyorlar.

### 0b · `adana-main`'deki takipsiz A0 kopyası — **silinecek dosya yoktu**

Görev, `C:\Users\kiyar\Desktop\adana-main` çalışma dizinindeki takipsiz
`docs/arsiv/ip-a/ip-a0-olcum-raporu.md` kopyasını silmeyi istiyordu. **O dosya orada
yok.** Karşılaştırma yapılamadı çünkü karşılaştırılacak ikinci kopya mevcut
değil; dolayısıyla `adana-main`'de **hiçbir dosya silinmedi, hiçbir şeye
dokunulmadı.**

Kanıt:

```
$ git -C adana-main branch --show-current     → main
$ git -C adana-main log --oneline -1          → f399526 fix(admin): CSV sablonunda...
$ ls adana-main/docs/arsiv/ip-a/ip-a0-olcum-raporu.md    → No such file or directory
$ find adana-main -name "ip-a0*"              → (boş)
$ git -C adana-main status --porcelain docs/  → ?? docs/arsiv/medusa/medusa-arayuz-karsilastirma.md
                                                ?? docs/arsiv/medusa/medusa-karsilastirma-raporu.md
                                                ?? docs/arsiv/medusa/medusa-karsilastirma-tur2.md
```

Diğer altı worktree'de de (`adana-ozel-ders`, `adana-ui`, `adana-magaza`,
`adana-varyant`, `adana-focus-research`, `adana-varyant-denetim`) aynı yolda
dosya bulunmadı.

**Sonuç:** merge engeli zaten yok. Bu paket worktree dışına **hiç yazmadı** —
prompt'un izin verdiği tek istisna kullanılmadı, çünkü gereği kalmamıştı.

> Not: A2 raporu dosyanın `adana-main`'de "takipsiz durduğunu" söylüyordu.
> Aradan geçen sürede kaldırılmış. Bunu doğrulamadan silme komutu çalıştırmak
> yanlış dosyayı hedefleyebilirdi; önce varlık kontrolü yapıldı.

---

## Görev 1 — Nöbetçi metriğinin onarımı

### Eski metrik neden kaldırıldı

Eşik `htmlFor`lu `<label>` / toplam `<label>` oranıydı: A1'de 3/59, A2'de 4/55.
Mekanizması bozuktu:

- `Form.*`'a göç eden her form ham `<label>`larını `Form.Label`'a devreder →
  **payda düşer**.
- Paya hiçbir şey eklenmez: sayılan tek `htmlFor`lu etiket `form.tsx`'in
  **kendi iç** `<label htmlFor={kimlik?.id}>`'sidir. Elli form göç etse de o
  bir tanedir.
- A6-A7'de payda ~1'e iner, oran **%100'e çıkar** ve nöbetçi hiçbir şey tutmaz.

Daha kötüsü: hiç `<label>`ı olmayan bir `<input>` bu metriğe **zaten
görünmüyordu**. Gerçek borç tam orada — A0'ın 144 form alanı / 59 etiket
gözlemi bunu işaret ediyordu ama ölçüye girmiyordu.

`labels` / `labelsWithHtmlFor` sayaçta **kaldı**, ama artık eşik değil
**teşhis sayısı**: sayaç bunları zaten `htmlFor`↔`id` eşleştirmesi için
üretiyor. Gerekçe hem `uiBaseline.test.ts` başlığında hem burada yazılı ki
"eşik nereye kayboldu?" diye bakan biri cevabı bulsun.

### Yeni metrik: erişilebilir adı olmayan form kontrolü

Bir `<input>` / `<select>` / `<textarea>` şunlardan **biri** varsa
adlandırılmış sayılır:

| # | Biçim | Nasıl tespit edilir |
|---|---|---|
| 1 | `Form.Control` içinde | JSX atalarında `Form.Control` |
| 2 | `htmlFor` ile bağlı `<label>` | kontrolün `id` **değeri**, dosyadaki bir `htmlFor` **değeriyle** eşleşir |
| 3 | `aria-label` / `aria-labelledby` | öznitelik var |
| 4 | `<label>` içinde sarmalanmış | JSX atalarında `<label>`, **veya** yerel bir `<label>{children}</label>` sarmalayıcısı |

Kalan her kontrol **borçtur**.

### Bugünkü sayı

```
ölçülen kontrol       143
ADSIZ KONTROL          41   ← yeni eşik ("artamaz", hedef 0)
ölçüm dışı              1
```

Dağılım:

| Dosya | Adsız |
|---|---|
| `src/pages/dashboards/AdminStore.tsx` | 26 |
| `src/components/admin/CourierManager.tsx` | 9 |
| `src/pages/dashboards/AdminLibraries.tsx` | 4 |
| `src/pages/dashboards/AdminHome.tsx` | 2 |

Hepsi aynı desende: **yalnız `placeholder` taşıyan** alanlar (Yazar, Yayınevi,
ISBN, KOD, Ad, Soyad, E-posta…). Sayaç satır numaralarını da veriyor
(`adsizKontrolDosyalari[].satirlar`) — A6-A7'de göç edecek kişi nereye
bakacağını bilsin diye.

A0'ın kaba tahmini ~85'ti (144 − 59). Gerçek sayı yarısı kadar çıktı; fark
**`<label>` içinde sarmalanmış** kontrollerden geliyor (o desen A0'ın kaba
çıkarmasında görünmüyordu).

### Ölçüm dışı bırakılan durumlar ve gerekçeleri

| Durum | Sayı | Gerekçe |
|---|---|---|
| `hidden` özniteliği taşıyan kontrol | **1** (`AdminExamCatalogs.tsx:180`) | `display:none` — erişilebilirlik ağacında yok. `ref` ile tetiklenen dosya seçicisi; görünen tetikleyici kendi etiketini taşır |
| `<input type="hidden">` | 0 | Hiç render edilmez, odaklanamaz |
| `type="submit" / "reset" / "button" / "image"` | 0 | HTML'de **labelable değildirler**; `<label>` bunlara bağlanamaz, adları kendi `value`/`alt`'larından gelir. Borç saymak, kapatılması imkânsız bir borç üretirdi |
| Test dosyaları | — | İP-A2'de alınmış karar; fixture'lardaki ham etiket borç değildir |

**Ölçüm İÇİNDE tutulan, tartışılabilir üç karar:**

1. **`placeholder` erişilebilir ad SAYILMAZ.** Yazınca kaybolur, ekran
   okuyucuda güvenilmez, kontrast kuralına uymaz. Kabul edilseydi metrik bu kod
   tabanında 41'den ~5'e inerdi ve hiçbir şey ölçmezdi.
2. **`title` özniteliği kabul EDİLMEZ.** ARIA'da son çare bir addır;
   dokunmatikte hiç görünmez. Görevin saydığı dört biçimin dışında.
3. **`checkbox` / `radio` ölçüm İÇİNDEDİR** — ikisi de labelable'dır.

### Sayaçta bulunan ve düzeltilen bir yanlış pozitif

İlk ölçüm **60** verdi. İçinde `DeliveryVehiclesPage.tsx`'in 18 alanı vardı ve
bunlar **borç değildi**: dosyanın kendi `Field` bileşeni çocuklarını
`<label>` içinde sarmalıyor —

```tsx
function Field({ label, children }) {
  return <label className="…">{label}{children}</label>;
}
…
<Field label="Araç adı"><input className="input" /></Field>
```

Çalışma zamanında `<input>` gerçekten `<label>` içindedir; JSX ağacında atası
`<Field>` göründüğü için sayaç göremiyordu. Sayaç artık **aynı dosyadaki**
`<label>{children}</label>` sarmalayıcılarını tanıyor → 60 → **41**.

**Kalan bilinen sınır:** sarmalayıcı **başka dosyadan** import edilirse hâlâ
görünmez. Bugünkü 41 borcun tamamı elle gözden geçirildi ve hiçbiri bu
durumda değil (hepsi doğrudan `placeholder`lı ham kontrol), ama göç ilerledikçe
tekrar bakılmalı.

### Sayacın kendi testi

`src/__guards__/sayim.test.ts` 8 → **18 test** (+10). Yeni bloğun yapısı:

- **TERS PROVA** — üç gerçek adsız kontrol doğru sayılır ve satır numaraları
  üretilir. Bu test olmadan aşağıdaki "borç saymaz" testlerinin hepsi,
  `adsizKontrol` daima 0 dönse de geçerdi.
- Dört adlandırma biçiminin **hiçbiri** borç saymaz (tek testte dördü de).
- `placeholder` borç saymaya **devam eder**.
- `htmlFor`↔`id` eşleşmesi **değer** üzerinden kurulur (`id` var ama hiçbir
  etiket ona bağlı değilse → borç). Bu ayrım olmadan "id yazan herkes borçtan
  kurtulur" hâli doğardı.
- İfade biçimli bağ (`htmlFor={uid}` ↔ `id={uid}`) de eşleşir.
- Yerel `<label>` sarmalayıcısı adlandırma sayılır — **ve** ters provası:
  `children` AKTARMAYAN bir bileşen sarmalayıcı sayılmaz ("adı `Field` olan her
  şeyi affet" değil).
- Ölçüm dışı tipler + `hidden` ayrı sayılır — **ve** ters provası:
  `checkbox`/`radio`/görünür `file` ayıklanmaz, borç sayılır.
- Yorumdaki/string'deki `<input` sayılmaz.

---

## Görev 2 — Kırmızı matris (implementasyondan ÖNCE)

Ham çıktı: `docs/arsiv/ip-a/ip-a3a/kirmizi-matris.txt`. **İki sınıf ayrı raporlanır.**

### Sınıf 1 — "hiç koşmadı" (dosya çözülemedi)

M1-M7'yi taşıyan `kirliFormBekcisi.test.tsx`, `./kirliFormBekcisi` modülü
olmadığı için **yükleme aşamasında düştü**:

```
FAIL  src/components/admin/ui2/kirliFormBekcisi.test.tsx
Error: Failed to resolve import "./kirliFormBekcisi" … Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

Bu "test zayıf" değil, **"test hiç koşmadı"** hâlidir (kök CLAUDE.md §D) ve
tek başına "kırmızıydı" demek yanıltıcı olurdu. İmplementasyondan sonra dosya
gerçek sayıyla koşuyor: **7 test**.

### Sınıf 2 — gerçekten kırmızı (koştu ve düştü)

`DamageDialog.test.tsx`'e eklenen 7 testten **6'sı** koşup düştü:

```
× M8  — sunucu alan hatası İLGİLİ ALANIN altında çıkar…      36ms
× M8b — alana düşmeyen sunucu hatası ÜST şeritte kalır       24ms
× M8c — formda karşılığı olmayan alanın mesajı KAYBOLMAZ     18ms
× bekçi — kirli formda KAPATMA DÜĞMESİ onay sorar          1054ms
   → Unable to find an element with the text: Kaydedilmemiş değişiklikler var
× bekçi — kirli formda ESC onay sorar                      1044ms
× bekçi — kirli formda DIŞ TIKLAMA onay sorar              1034ms

 Tests  6 failed | 9 passed (15)
```

Yedincisi (**"TEMİZ formda üç yolun üçü de doğrudan kapatır"**) baştan
yeşildi ve olması gereken buydu: **korunması gereken mevcut davranışı** ölçüyor,
yeni sözleşmeyi değil. Aynı zamanda diğer üçünün ters provasıdır — o üç test
tek başına, bekçi HER kapatmayı engellese de geçerdi.

### Matris → dosya eşlemesi

| # | Test | Dosya |
|---|---|---|
| 1 | kirli formda kapatma → onay | `kirliFormBekcisi.test.tsx` M1 |
| 2 | temiz formda doğrudan geçer | M2 |
| 3 | "vazgeç" → form açık **ve veri duruyor** | M3 |
| 4 | "çık" → form kapanır | M4 |
| 5 | başarılı gönderimden sonra onay yok | M5 |
| 6 | `beforeunload` yalnız kirliyken | M6 |
| 7 | sunucu hatası → kirli sayılmaya devam | M7 |
| 8 | 422 pilotta canlı | `DamageDialog.test.tsx` M8 + M8b + M8c |
| — | üç kapatma yolu (düğme/ESC/dış tıklama) + ters prova | `DamageDialog.test.tsx` ×4 |

---

## Görev 3 — Kirli form bekçisi

`src/components/admin/ui2/kirliFormBekcisi.tsx`. A2'nin bıraktığı
`useFormDurumu(form)` üzerine oturur; o katman yeniden yazılmadı.

### Sözleşme

```ts
useKirliFormBekcisi({ form, sunucuHatasi?, etkin? })
  → { korumali: boolean; kapatmayiDene: (kapat: () => void) => void }
```

| Kural | Nasıl |
|---|---|
| Kirli + kapatma girişimi → onay | `kapatmayiDene` temizse `kapat()`'ı **doğrudan** çağırır, kirliyse önce `usePrompt` açar |
| Üç kapatma yolu da kapsanır | Kapatma düğmesi, ESC ve dış tıklama **üçü de** `Dialog`'un `onClose`'una düşer; kapı tek noktada |
| Başarılı gönderimden sonra atlanır | `gonderimBasarili && !sunucuHatasi` |
| Sekme kapatma/yenileme | `beforeunload` — **yalnız kirliyken** kayıtlı, temizlenince kaldırılır |
| Türkçe metinler | `ui2/medusa-tr.tsx` → `promptTr` (dolduruldu) + `kirliFormPromptTr` |
| Ekranlar Medusa'yı doğrudan import etmez | `usePrompt` yalnız `ui2/` içinde; nöbetçi eşiği hâlâ `= []` |

### `isSubmitSuccessful` neden tek başına yetmez

`react-hook-form`'un bayrağı yalnız **"gönderim işleyicisi patlamadı"** demek.
Bu kod tabanında işleyiciler `mutate(...)` çağırıp geri döner: ağ isteği daha
yola çıkmadan bayrak `true` olur. Sunucu 500 dönse bile bekçi susardı ve
kullanıcı kaydedilmemiş verisini **uyarısız** kaybederdi. Bu yüzden hook
`sunucuHatasi`yı da okur; gerçekten kaydedilmiş sayılmak için ikisi birden
gerekir. (M7 tam olarak bunu tutuyor.)

### `useBlocker` neden yok

Proje klasik `<BrowserRouter>` + `<Routes>` kullanıyor (126 rota).
`useBlocker` **data router** ister ve bu mimaride çalışmaz, hata fırlatır
(İP-A0 ölçümü). Bu yüzden kapsam **modal kapatma + sekme kapatma**;
uygulama içi rota gezinmesi bilinçli olarak dışarıda. `useBlocker`,
`unstable_usePrompt`, `createBrowserRouter` **kullanılmadı** — dosyalarda
hiçbirinin izi yok.

### Metinler

```
başlık   : Kaydedilmemiş değişiklikler var
açıklama : Bu pencereyi kapatırsanız girdiğiniz bilgiler kaydedilmeden silinir.
vazgeç   : Vazgeç        çık : Çık        variant : danger
```

`variant: "danger"` bilinçli — onaylanan eylem **veri kaybıdır**. "Emin
misiniz?" tek başına kullanıcıya neyi kaybedeceğini söylemez.

### Test hijyeni notu (gerçek bir yalancı kırmızı)

Onay penceresi Radix portalıyla `document.body`'ye açılıyor ve **RTL'in kendi
temizliği onu sökmüyor**. İlk koşuda açık kalan pencere sonraki teste sızdı ve
`Found multiple elements with the text: Vazgeç` ile **yalancı kırmızı** üretti.
İki test dosyasına da `afterEach` eklendi: açık pencere gerçek yolundan
(vazgeç tıklanarak) kapatılıyor.

---

## Görev 4 — A2'nin iki açık ucu

### 4a · 422 eşlemesi **pilotta canlı**

Değişen iki dosya:

- **`DamageEventsPage.tsx`** — `formHatasi` artık `string` değil **ham hata**;
  `onError: (e) => setFormHatasi(e)`. Sayfa hatayı metne indirgerse `loc`
  kaybolur ve mesaj mecburen genel şeride düşer.
- **`DamageDialog.tsx`** — `error: unknown` alır ve `sunucuHatasiniUygula` ile
  alanlara dağıtır:

```ts
const ALANLAR = ["urunId", "miktar", "neden", "aciklama", "kova"];   // beyaz liste
const SUNUCU_ALAN_ESLEMESI = {
  product_id: "urunId", qty: "miktar", reason_code: "neden",
  note: "aciklama", bucket: "kova",
};
```

`form.tsx`'e **opsiyonel bir parametre** eklendi: `genelMesaj(hata)`. Sebep
somut — envanterin kendi sözlüğü var (`inventoryErrorMessage`: defter
bütünlüğü uyarısı, 409'da "sayfayı yenileyin"). Bu kanca olmadan pilot ya o
metinleri kaybederdi ya da 422 tespitini ikinci kez kendi yazardı. Mevcut üç
`sunucuHatasi.test.tsx` testi değişmeden geçiyor.

Kanıt (gerçek DOM, `DamageDialog.test.tsx`):

| Test | Ne kanıtlıyor |
|---|---|
| M8 | `loc:["body","qty"]` → mesaj **miktar alanının altında**, `aria-invalid="true"`, genel şerit **boş** |
| M8b | 500 → şeritte kalır (M8'in ters provası: şerit hiç render edilmese M8 yine geçerdi) |
| M8c | `loc:["body","supplier_id"]` (formda yok) → mesaj **sessizce kaybolmaz**, şeride düşer |

Ayrıca bir regresyon yakalandı ve düzeltildi: A2'nin `error` prop'una **düz
metin** geçen mevcut testi vardı. `unknown`'a geçince metin
`inventoryErrorMessage`'a düşüp genel fallback'e dönüştü. Düzeltme üretim
kodunda: hazır metin geçiren çağıran **olduğu gibi** gösterilir. A2 testine
dokunulmadı.

### 4b · Karanlık mod paritesi — **ölçüldü**

A1 turu canlı `ceyhandb`'ye bağlanmış ve ekran görüntüleri gerçek müşteri
verisi içermişti. **Bu tekrarlanmadı:** yeni sonda (`damage-probe.html` +
`src/__probe__/DamageDialogProbe.tsx`) hiçbir sunucuya bağlanmaz — `DamageDialog`
sahte prop'larla açılır, ürün seçici boş kalır. **Gerçek kişisel veri içeren
ekran görüntüsü üretilmedi.**

`scripts/ip_a3a_karanlik_probe.mjs` (Chrome + CDP) aynı DOM'u iki temada okur.
Kontrast göz kararı değil, **WCAG 2.x bağıl parlaklık formülüyle** hesaplanır;
arka plan, saydam olmayan ilk ataya kadar yürünerek bulunur.

| Ölçüm | Açık tema | Koyu tema | Eşik |
|---|---|---|---|
| panel zemini | `rgb(255,255,255)` | `rgb(15,23,42)` | — |
| **etiket** ("Miktar") | **10.35** | **14.48** | 4.5 |
| **hint** ("Adet yalnız seçtiğiniz raftan…") | **4.76** | **6.96** | 4.5 |
| **hata** ("Miktar sıfırdan büyük…") | **4.70** | **6.63** | 4.5 |
| slot yükseklikleri | `[18, 18, 18, 18]` | `[18, 18, 18, 18]` | fark 0 |
| panel yüksekliği | 726 px | 726 px | fark 0 |

Hata kırmızısı koyu zeminde `rose-400`'e geçiyor (`rgb(251,113,133)`) ve
kontrastı **artıyor** — `rose-600` koyu zeminde kalsaydı okunmazdı.

**Sondanın kendi geçerlilik kapısı var:** hata metni doğmadıysa, hint
bulunmadıysa veya tema hiç değişmediyse ölçümü **geçersiz sayıp** 2 ile çıkar.
Bu olmadan "hepsi geçti" çıktısı, hiç ölçüm yapılmamış hâlde de yeşil olurdu.

Çıktılar: `docs/arsiv/ip-a/ip-a3a/karanlik-mod.json`, `damage-acik.png`, `damage-koyu.png`.

**En dar nokta:** açık temada hata metni **4.70**, eşiğin 0.2 üstünde
(`rose-600` beyaz üzerinde). Geçiyor ama marjı dar; kırmızı tonu bir kademe
açılırsa eşik altına düşer. A6-A7'de palet değişirse bu sonda yeniden
koşturulmalı.

---

## Görev 5 — Eşikler ve mutasyon provası

### Eşikler

| Eşik | İP-A2 | İP-A3a | Not |
|---|---|---|---|
| ölçüm tabanı (dosya) | ≥ 60 (64) | **≥ 60** (gerçek: 65) | +1 = `kirliFormBekcisi.tsx` |
| ham `<button` | ≤ 126 | **≤ 126** | **değişmedi** |
| `<label htmlFor>` oranı | ≥ 4/55 | **KALDIRILDI** | Görev 1 |
| **adsız form kontrolü** | — | **≤ 41** (yeni) | ölçülen kontrol ≥ 140 tabanıyla birlikte |
| `ui2/` dışı Medusa importu | = [] | **= []** | |
| etiketsiz overlay | ≤ 5 | **≤ 5** | |
| overlay'li dosya listesi | 4 dosya | **aynı 4 dosya** | |

**Ham buton sayısı değişmedi ve sahte bir düşüş yazılmadı.** 4a
`DamageEventsPage`'i değiştirdi ama değişiklik state tipinde ve `onError`
gövdesindeydi; tek bir `<button` eklenmedi/silinmedi. Ölçüm öncesi ve sonrası
126. Eşik olduğu gibi bırakıldı.

Yeni eşiğin yanında **ölçüm tabanı kontrolü** var (`kontrolToplam ≥ 140`):
sayacın kontrol tarayıcısı bozulursa borç sayısı 0'a düşer ve "artamaz" yönü
sessizce memnun olurdu.

### Eşik mutasyonları — 5/5 yakalandı

Sürücü: `frontend/scripts/ip_a3a_mutasyon.mjs`. `git checkout --` **kullanmaz**;
ham baytları bellekte tutar, aynen geri yazar, başta/sonda `git status
--porcelain` karşılaştırır.

```
Taban: nöbetçi YEŞİL.

✓ ham <button sayısı: mutasyon yakalandı
✓ erişilebilir adı olmayan form kontrolü: mutasyon yakalandı
✓ ui2 dışı @medusajs/ui importu: mutasyon yakalandı
✓ etiketsiz overlay: mutasyon yakalandı
✓ ölçüm tabanı çökmesi (yalancı yeşil koruması): mutasyon yakalandı

Çalışma ağacı başlangıçtaki hâline döndü.
```

| Eşik | Uygulanan **gerçek JSX** ihlali |
|---|---|
| ham `<button` | `DamageDialog`'a `<button type="button">Ham buton</button>` (126 → 127) |
| adsız kontrol | `DamageDialog`'a `<input className="input" placeholder="Serbest not" />` — `Form.Control` dışında, etiketsiz (41 → 42) |
| Medusa importu | `DamageDialog`'a `import { Tooltip } from "@medusajs/ui"` |
| etiketsiz overlay | `DamageDialog`'a `role`/`aria-modal`sız `<div className="fixed inset-0 …" />` (5 → 6) |
| ölçüm tabanı | Sayacın kontrol tarayıcısı susturuldu → borç 0'a düşer, eşik "geçer" |

`scripts/ip_a2_mutasyon.mjs` artık koşmaz (ikinci mutasyonu kaldırılan eşiği
hedefliyor); başına bunu söyleyen bir not düşüldü, kayıt olarak duruyor.

### Davranış mutasyonları — bekçi 5/5, 422 bağlantısı 3/3

Eşikler dışında, bu paketin **kritik davranışları** da tersten sınandı
(kök CLAUDE.md §D). Aynı disiplin: ham baytlar bellekte, geri yazma doğrulandı.

**Bekçi** (`kirliFormBekcisi.test.tsx` + `DamageDialog.test.tsx`):

| Mutasyon | Sonuç |
|---|---|
| Bekçi kapısı kaldırıldı (her kapatma onay sorar) | ✓ yakalandı |
| `sunucuHatasi` yok sayıldı (`isSubmitSuccessful`'a körü körüne güven) | ✓ yakalandı |
| `beforeunload` temizliği kaldırıldı (kalıcı kayıt) | ✓ yakalandı |
| Onay sonucu yok sayıldı ("vazgeç" de kapatır) | ✓ yakalandı |
| Gönderim başarısı yok sayıldı (kaydettikten sonra da sorar) | ✓ yakalandı |

**422 bağlantısı** (`DamageDialog.test.tsx`):

| Mutasyon | Sonuç |
|---|---|
| 422 alanlara dağıtılmadı, hepsi genel şeride | ✓ yakalandı |
| Sunucu alan eşlemesi kaldırıldı (`qty` → `miktar` bağı koptu) | ✓ yakalandı |
| Beyaz liste genişletildi (tanınmayan alan sessizce yutulur) | ✓ yakalandı |

Her turdan sonra dosya geri yazıldı ve testlerin yeşile döndüğü doğrulandı.

---

## Test türlerinin dürüst sınıflandırması

| Sınıf | Sayı | Nerede |
|---|---|---|
| Gerçek DOM (RTL, davranış) | **14 yeni** | `kirliFormBekcisi.test.tsx` 7 · `DamageDialog.test.tsx` +7 |
| Gerçek tarayıcı (Chrome/CDP, piksel + kontrast) | 1 ölçüm | `ip_a3a_karanlik_probe.mjs` |
| Saf yardımcı / AST alet testi | **10 yeni** | `sayim.test.ts` +10 |
| Kaynak/AST sözleşmesi (**düşük güçlü**) | 6 | `uiBaseline.test.ts` (biri değişti) |
| Mutasyon provası | 5 + 5 + 3 | eşik · bekçi · 422 |

Değişmeden korunan mevcut testler: `inventoryScreens.acceptance.test.tsx` 57,
`lib/inventory.test.ts` 40, `form.test.tsx` 8, `sunucuHatasi.test.tsx` 3.
**Hiçbirine dokunulmadı.**

---

## Bilinen sınırlar ve doğrulanmamış noktalar

1. **Uygulama içi rota gezinmesi kapsanmıyor.** Kullanıcı kirli formu açıkken
   kenar çubuğundan başka sayfaya giderse uyarı YOK. `useBlocker` bu router
   mimarisinde çalışmıyor; A3b'ye (router göçü kararına) bağlı.
2. **Bekçi yalnız pilotta.** `DamageDialog` dışında hiçbir form kapılanmadı —
   panelde onlarca form hâlâ uyarısız kapanıyor. A6-A7'nin işi.
3. **Karanlık mod sondası CI'da koşmuyor.** Elle çalıştırılan bir sondadır
   (dev sunucusu + Chrome gerektirir). Açık temada hata kontrastı 4.70 ile
   eşiğe yakın; palet değişirse yeniden koşturulmalı.
4. **Sayacın yerel sarmalayıcı tespiti aynı dosyayla sınırlı.** `<label>`
   sarmalayıcısı başka dosyadan import edilirse borç sayılır (yanlış pozitif).
   Bugünkü 41 kaydın hepsi elle doğrulandı — hiçbiri bu durumda değil.
5. **Ölçüm dışı kuralların yalnız biri gerçek kodda tetikleniyor** (`hidden`,
   1 kayıt). `type="hidden"/"submit"/…` kuralı bugün hiçbir şeyi ayıklamıyor;
   davranışı yalnız sayaç birim testiyle kanıtlı, gerçek dosyayla değil.
6. **`beforeunload` gerçek tarayıcıda denenmedi.** Kaydın varlığı/yokluğu
   jsdom'da `addEventListener` casusuyla ölçüldü; tarayıcının uyarıyı
   GÖSTERDİĞİ (Chrome'un kendi diyaloğu) doğrulanmadı — headless Chrome bu
   diyaloğu otomatik bastırır.
7. **`usePrompt` her çağrıda yeni bir React kökü** (`createRoot`) mount ediyor
   — Medusa'nın uygulaması böyle. Testlerde portal artığı temizliği gerekti
   (yukarıda); üretimde işlevsel bir sorun görülmedi ama desen ideal değil.
8. `zod` mesajlarında tip adları İngilizce kalıyor (A2'den devreden madde,
   değişmedi).

---

## Bitiş kontrolü

- [x] A2 commit'lendi (`37e27f0`); `adana-main`'de silinecek A0 kopyası
      **yoktu** — varlık kontrolü kanıtıyla, hiçbir şeye dokunulmadı
- [x] Eski etiket oranı kaldırıldı (gerekçeli), yeni "adsız kontrol" metriği
      yerinde ve **ters provalı**
- [x] Kırmızı matris önce kırmızı gösterildi; **"hiç koşmadı" ayrı işaretlendi**
- [x] 8 madde de yeşil (7 katman + 3 tane 422 + 4 kapatma yolu testi)
- [x] Bekçi üç kapatma yolunda da çalışıyor (düğme, ESC, dış tıklama) — ve
      temiz formda üçü de doğrudan geçiyor (ters prova)
- [x] Başarılı gönderimden sonra onay sorulmuyor; sunucu hatasında soruluyor
- [x] `beforeunload` yalnız kirliyken kayıtlı
- [x] 422 eşlemesi `DamageDialog`'da canlı (`DamageEventsPage` ham hatayı geçiriyor)
- [x] Karanlık mod ölçüldü ve kareleri alındı; **gerçek müşteri verisi
      kullanılmadı** (sonda hiçbir sunucuya bağlanmıyor)
- [x] `useBlocker` / `unstable_usePrompt` / `createBrowserRouter` **kullanılmadı**
- [x] Eşikler mutasyonla kırıldı (5/5), davranış mutasyonları da yapıldı
      (5/5 + 3/3), çalışma ağacı temiz kaldı
- [x] `DamageDialog` ve `DamageEventsPage` dışında ekran dosyası değişmedi
- [x] `tsc --noEmit` temiz · **109 dosya / 1074 test** yeşil · `build` başarılı
