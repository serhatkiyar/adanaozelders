# İP-A2 — Form katmanı ve alan bazlı hata

**Dal:** `feat/medusa-ui-taban` · **Tarih:** 19 Ağustos 2026
**Kapanış kapısı:** `tsc --noEmit` temiz · `npm run test` **108 dosya / 1050 test yeşil** · `npm run build` başarılı

---

## Görev 0 — A1 artıkları ve commit

### 0a · Silinen iskele

`src/components/admin/ui2/medusa-tr.tsx` içinden `DataTable` importu ve
`dataTableToolbarTr` nesnesi (+ türetilmiş `DataTableToolbarTranslations` tipi)
silindi. Yerine kalıcı kararı kaydeden bir yorum bırakıldı — iskele silinince
"neden alınmadı" bilgisi de kaybolmasın diye.

`tablePaginationTr` ve `promptTr` **kaldı** (ikisi de kendi `Table`/`usePrompt`
kullanımımızda dolacak). Dosyada kalan tek `@medusajs/ui` importu artık
`I18nProvider` + `Table`.

### 0b · A0 raporuna düzeltme dipnotu

**Bulgu:** `docs/ip-a0-olcum-raporu.md` bu depoda YOKTU. A0 kendi bitiş
kontrolünde "hiçbir commit atılmadı, `adana-spike-a0` dışına yazma yapılmadı"
diyor; rapor `adana-main` çalışma dizininde **takipsiz (untracked)** duruyordu.
Nöbetçi eşiklerinin referansı olan bir belge kayıt dışı kalamayacağı için dosya
olduğu gibi bu dala kopyalandı ve sonuna dipnot eklendi (içeriğine başka
dokunulmadı).

Dipnotun özü: A0'ın "preset'in katkısı `@tailwindcss/forms` +
`tailwindcss-animate`" tespiti yanlış. `@tailwindcss/forms` preset'in bağımlılığı
değil ve üretilen CSS'te imzası yok; ikinci eklenti **Medusa'nın kendi
plugin'i**. A0'ın asıl bulgusu ("forms taban stilleri üretilen CSS'te yok →
144 admin form alanı etkilenmiyor") **doğru**, yalnız nedeni yanlış
açıklanmıştı: eklenti `class` stratejisiyle gelmiyor, **hiç yok**.

### 0c · A1 commit'i

```
9aeda14  feat(ip-a1): medusa ui taban katmani + nobetci esikleri
```

Commit öncesi kapı: `tsc --noEmit` temiz, **103 dosya / 1021 test** yeşil.

Commit'e girenler: `package.json` + lock, `main.tsx` (`MedusaI18nProvider`),
`tailwind.config.js` (preset), `scripts/` (sayım + 3 A1 sondası),
`src/components/admin/ui2/medusa-tr.tsx`, `src/__guards__/uiBaseline.test.ts`,
`docs/ip-a0-olcum-raporu.md`, `docs/ip-a1-rapor.md`, `docs/ip-a1/`.

**Commit dışında bırakılanlar:** depo kökündeki `sayim.sh`, `borderscan.mjs`,
`cssdiff.mjs` (A0 sondaları — A1'in teslimatı değil; `sayim.sh`'in yerini
`scripts/ui-baseline-sayim.mjs` aldı) ve `ip-a*-prompt.md` dosyaları. Bunlar
takipsiz duruyor; A0 kapanışında da öyleydi.

---

## Görev 1 — Sayaç düzeltmesi

### Ne yanlıştı

İP-A1 sayacı ham metin üzerinde regex çalıştırıyordu; yorum satırları ve
string/şablon içerikleri de sayıma giriyordu.

### Neden "önce yorumları sil" yapılmadı

Bu kod tabanı Türkçe ve JSX metinleri kesme işaretiyle dolu (`Medusa'nın`,
`preset'in`). Elle yazılmış bir tarayıcı o kesme işaretini string başlangıcı
sanar ve dosyanın yarısını yutar — sayı **düşer**, yön "artamaz" olduğu için
test **yeşil kalır**. Bu, düzeltmenin kendisinin yalancı yeşil üretmesi
olurdu.

Bunun yerine sayım **TypeScript'in kendi parser'ıyla üretilen AST** üzerinde
yapılıyor (kök CLAUDE.md §C). Yorum ve string doğal olarak sayım dışında kalır;
üstelik `<button` ile `<ButtonGroup` ayrımı, kendi kapanan `<button />` biçimi,
`role={"dialog"}` ifade biçimi ve `export … from "@medusajs/ui"` / dinamik
`import()` biçimleri de artık doğru okunuyor.

### Taban: eski / yeni

Ölçüm iki düzeltme aldı. İkincisi İP-A2 içinde, pilot göçünden sonra ortaya
çıktı (aşağıda "ikinci düzeltme").

| Ölçüm | A1 (regex) | AST, düzeltme 1 | AST, düzeltme 2 (**yeni eşik**) |
|---|---|---|---|
| dosya | 78 | 78 | **64** |
| ham `<button` | 126 | 126 | **126** |
| `<label>` | 59 | **58** | **55** |
| `htmlFor`lu `<label>` | 3 | 3 | **4** |
| `ui2/` dışı Medusa importu | 0 | 0 | **0** |
| etiketsiz overlay | 5 | 5 | **5** |

**Düzeltme 1 (yorum/string):** tek fark `<label>` sayısında — `−1`. Kaynağı
tespit edildi: `src/pages/dashboards/AdminStore.tsx:684`, bir **yorum satırında**
geçen `<label>` sözcüğü. `<button` sayısı değişmedi; yorumda/string'de ham buton
yokmuş.

**Düzeltme 2 (test dosyaları):** İP-A2 ölçüm tabanına ilk test dosyalarını
soktu (`ui2/` ve `inventory/` altına) ve taban **126 → 128'e "yükseldi"**.
Sayılan şey borç değil, borcu ölçen testlerin fixture'larıydı — `form.test.tsx`
erişilebilirlik sözleşmesini kanıtlamak için kasten ham `<button>` kullanıyor.
Sayaç artık `*.test.ts(x)` dosyalarını ölçüm dışı tutuyor; taban tekrar 126.
Dosya sayısı 78 → 64'e bu yüzden düştü (tabanda 14 mevcut test dosyası varmış;
ikisi de 0 buton/0 etiket taşıdığı için A1 sayıları etkilenmemiş).

### Sayacın kendi testi

`src/__guards__/sayim.test.ts` — 8 test. İçinde:

- satır yorumundaki `<button` sayılmıyor
- JSX içine gömülü blok yorumdaki `<button` sayılmıyor
- string/şablon içindeki `<label htmlFor>` sayılmıyor
- **ters prova:** gerçek JSX doğru sayılıyor (2 buton / 2 etiket / 1 `htmlFor`).
  Bu test olmadan üç madde de `dosyaOlcumu` daima 0 dönse bile geçerdi
- Türkçe kesme işareti JSX metnini yutmuyor
- `<ButtonGroup>` ham buton sayılmıyor
- overlay sınıfı yalnız string içinde sayılıyor
- Medusa importu import/export/dinamik üç biçimde de görülüyor, yorumda görülmüyor

---

## Görev 2 — Bağımlılık kapısı

| Paket | Gelen sürüm |
|---|---|
| `react-hook-form` | **7.85.0** |
| `zod` | **4.4.3** |
| `@hookform/resolvers` | **5.9.1** |

**Uyumluluk doğrulandı:** `@hookform/resolvers@5.x` zod 4'ü destekleyen seridir;
`npm ls` ağacında resolver'ın altındaki `react-hook-form` ve `zod` **deduped**
görünüyor (tek örnek, sürüm çakışması yok). `zodResolver` gerçek bir formda
uçtan uca koşturuldu (13 test).

`zod@4.4.3` zaten ağaçta vardı (`eslint-plugin-react-hooks` → `zod-validation-error`
üzerinden); kurulum "7 paket eklendi, 2 paket kaldırıldı" ile dedupe etti.

**Kurulum öncesi:** `tsc --noEmit` temiz · 103 dosya / **1021** test yeşil.
**Kurulum sonrası:** `tsc --noEmit` temiz · 104 dosya / **1029** test yeşil
(+8 = Görev 1'in sayaç testleri). **Yeni kırılan yok.**

---

## Görev 3 — Kırmızı matris (implementasyondan ÖNCE)

10 testin tamamı `form.tsx` yazılmadan önce yazıldı ve koşuldu. Ham çıktı:
`docs/ip-a2/kirmizi-matris.txt`.

```
 FAIL  src/components/admin/ui2/form.test.tsx  [ ... ]
Error: Failed to resolve import "./form" from "src/components/admin/ui2/form.test.tsx". Does the file exist?
 FAIL  src/components/admin/ui2/sunucuHatasi.test.tsx  [ ... ]
Error: Failed to resolve import "./form" from "src/components/admin/ui2/sunucuHatasi.test.tsx". Does the file exist?
 FAIL  src/components/admin/ui2/zodTurkce.test.ts  [ ... ]
Error: Failed to resolve import "./form" from "src/components/admin/ui2/zodTurkce.test.ts". Does the file exist?

 × M9 — geçersiz alanla gönderilince hata ALANIN ALTINDA görünür
   → expected null to be truthy
 × M10 — alan hataları genel/toast kanalına GİTMEZ
   → expected null to be 'true'
 × genel sunucu hatası (error prop'u) ÜST şeritte durur
   → Unable to find an element by: [data-testid="damage-genel-hata"]
 × anlık doğrulama korunur: gönder'e basmadan hata çıkar
   → Unable to find role="alert"
 × tedarikçi iadesinde kaynak kova alanı zorunlu kalır
   → expected null to be 'true'
 ✓ etki metni korunur ve rakamla yazılır
 ✓ geçerli formda sunucuya doğru gövde gider (idempotency anahtarı dahil)

 Test Files  4 failed (4)
      Tests  5 failed | 2 passed (7)
```

**Dürüstlük notu:** M1-M8'i taşıyan üç dosya **hiç koşmadı** — `./form`
çözülemediği için yükleme aşamasında düştüler. Bu, "test zayıf" değil "test hiç
koşmadı" hâlidir (kök CLAUDE.md §D) ve tek başına "kırmızıydı" demek yanıltıcı
olurdu. İmplementasyondan sonra üç dosya da gerçek sayılarla koşuyor:
`form.test.tsx` 8 · `sunucuHatasi.test.tsx` 3 · `zodTurkce.test.ts` 2.

İki testin baştan yeşil olması beklenendi: ikisi de **korunması gereken mevcut
davranışı** ölçüyor (etki metni, gövde içeriği), yeni sözleşmeyi değil.

### Matris → dosya eşlemesi

| # | Test | Dosya |
|---|---|---|
| 1 | `Form.Label` ↔ kontrol bağı, `getByLabelText` erişimi | `form.test.tsx` M1 |
| 2 | geçersizken `aria-invalid="true"` | M2 |
| 3 | `aria-describedby` hata↔hint geçişi | M3 |
| 4 | hata mesajında `role="alert"` | M4 |
| 5 | tek slot, yerleşim zıplamıyor | M5 + M5b |
| 6 | aynı formda `id` çakışmıyor | M6 |
| 7 | zod Türkçe hata haritası | `zodTurkce.test.ts` M7 + M7b |
| 8 | 422 `loc` → ilgili alan, toast değil | `sunucuHatasi.test.tsx` M8 + M8b + M8c |
| 9 | pilot: hata alanın altında | `DamageDialog.test.tsx` M9 |
| 10 | pilot: alan hataları toast'a gitmiyor | M10 |

---

## Görev 4 — `Form.*` katmanı

`src/components/admin/ui2/form.tsx`.

### Sözleşme

| Parça | Görevi |
|---|---|
| `Form.Field` | `react-hook-form` `Controller`'ını sarar; alanın hatasını bağlama koyar |
| `Form.Item` | `id` üretir, mesaj **slot**'unu açar, çocukları slot/üst diye ayırır |
| `Form.Label` | `htmlFor`u bağlamdan alır; isteğe bağlı alana "(opsiyonel)" ekler |
| `Form.Control` | Tek çocuğuna `id` + `aria-invalid` + `aria-describedby` geçirir |
| `Form.Hint` | Yardım metni — hata **yokken** slotta durur |
| `Form.ErrorMessage` | `role="alert"` mesaj — hata **varken** slotta durur |

Kullanıcı elle `id`, `aria-*` ya da mesaj kabı yazmaz.

**Tek slot nasıl kuruldu.** `Hint` ve `ErrorMessage` kardeş DEĞİL: `Form.Item`
çocukları ikiye ayırır (`Children.toArray` + tip karşılaştırması) ve ikisini
**her zaman var olan tek bir kaba** koyar. Kap `min-h-[1.125rem]` ile yer
ayırır. İki ayrı kardeş düğüm olsaydı biri görünüp diğeri kaybolduğunda
yerleşim iterdi.

**Zorunluluk tersten.** Yıldız yok; yalnız `optional` verilen alana
"(opsiyonel)" yazılır. Test: formda hiç `*` bulunmuyor.

### Slot piksel ölçümü (gerçek Chrome)

jsdom düzen hesaplamaz — `offsetHeight` daima 0'dır, yani M5 Vitest'te
**mekanizmayı** doğrular (aynı DOM düğümü, aynı sınıf listesi, tek çocuk),
yüksekliği değil. Gerçek ölçüm ayrıca yapıldı: Vite dev sunucusu +
`form-probe.html` + headless Chrome/CDP (`scripts/ip_a2_slot_probe.mjs`).

| | hint durumu | hata durumu |
|---|---|---|
| kap yüksekliği | 88 px | **88 px** |
| slot yüksekliği | 18 px | **18 px** |
| alttaki komşunun Y'si | 112 px | **112 px** |
| slot metni | "Kimliğinizdeki ad." | "Ad zorunlu." |

**Kap farkı 0 px, komşu kayması 0 px.** Slot metninin gerçekten değişmesi,
ölçümün "hata hiç oluşmadı" hâlinde boşuna yeşil olmadığını gösterir.

**Sondanın ters provası:** `Form.Item`'ın tek slotu geçici olarak kaldırıldı
(hint ve hata yan yana render edildi) → aynı sonda **18 px kap farkı ve 18 px
komşu kayması** ölçtü. Yani sonda gerçekten nöbet tutuyor. Mutasyon geri alındı.
Çıktılar: `docs/ip-a2/slot-piksel.json`, `slot-hint.png`, `slot-hata.png`.

### Hata yönlendirme sözleşmesi

| Hata türü | Nereye |
|---|---|
| Alan doğrulama hatası (zod, veya `loc`'u bir alana düşen 422) | **Yalnız alanın altına.** Toast'a gitmez |
| Form geneli (500, ağ, alana düşmeyen 422) | Toast veya form üstü uyarı şeridi |

`sunucuHatasiniUygula(hata, form, alanlar, esleme?)` FastAPI 422'sini dağıtır ve
**alana düşmeyen kısmı geri döndürür**; `null` dönerse çağıran taraf toast
atmaz. `alanlar` bir **beyaz listedir**: sunucu formda karşılığı olmayan bir
alanı reddederse mesaj sessizce kaybolmaz, genel kanala düşer (M8b).

### zod Türkçe

`z.config(z.locales.tr())` — bu modül yüklenirken, tek yerde. zod 4 kendi
Türkçe yerelini getiriyor; elle yazılmış bir eşleme sürüm yükseltmelerinde
sessizce eksik kalırdı.

M7 sırayı elle kurar (`form.tsx`'i **statik import etmez**, dinamik import
kullanır): önce çıplak zod ölçülür — `"Invalid input: expected string, received
number"` — sonra katman yüklenir, sonra aynı çağrı `"Geçersiz değer: beklenen
string, alınan sayı"` döner. Statik import olsaydı "önce İngilizceydi" iddiası
kanıtlanamazdı.

> Yerel, tip **adını** ("string") çevirmez, cümleyi çevirir. Test bu gerçeğe
> göre yazıldı, tersi değil.

### Kullanım örneği

```tsx
const sema = z.object({ miktar: z.string() });
const form = useForm<z.infer<typeof sema>>({
  resolver: zodResolver(sema),
  defaultValues: { miktar: "" },
  mode: "onChange",
});

<Form.Field
  control={form.control}
  name="miktar"
  render={({ field }) => (
    <Form.Item>
      <Form.Label>Miktar</Form.Label>
      <Form.Control>
        <input className="input" type="number" {...field} />
      </Form.Control>
      <Form.Hint>Adet yalnız seçtiğiniz raftan düşer.</Form.Hint>
      <Form.ErrorMessage />
    </Form.Item>
  )}
/>
```

### A3a hazırlığı

`useFormDurumu(form)` → `{ kirli, gonderimBasarili }`. `isDirty` /
`isSubmitSuccessful` tek yerden okunur ki kirli form bekçisi (A3a) bu katmanı
yeniden yazmak zorunda kalmasın. **A3a bu pakette yazılmadı.**

---

## Görev 5 — Pilot: `DamageDialog`

### Önce / sonra

| | Önce | Sonra |
|---|---|---|
| Doğrulama | 6 ayrı `useState` + `validateDamageForm` (tek metin) | `react-hook-form` + `zodResolver(damageFormSchema(kind))` |
| Hata konumu | formun dibinde **tek gri satır** (ilk hata) | **her alanın altında**, `role="alert"`, kırmızı |
| Etiket bağı | 4 ham `<label>`, `htmlFor` yok | `Form.Label` → `htmlFor`/`id` otomatik |
| `aria-invalid` | yok | hatada `true` |
| `aria-describedby` | yok | hata varken hata, yokken hint |
| Genel sunucu hatası | `role="alert"` şerit | aynı şerit + `data-testid="damage-genel-hata"` |

Kurallar `lib/inventory.ts`'e taşındı: `damageFormSchema(kind)` +
`damagePayload(...)`. **`validateDamageForm` silinmedi, aynı şemaya devretti** —
böylece iki kural listesi oluşmadı ve o fonksiyonun 8 mevcut testi şemanın
nöbetçisi hâline geldi (40/40 yeşil kaldı).

### Kırılan testler ve sınıflandırması

Göç, **hiçbiri bu pakette yazılmamış 5 kabul testini kırdı**
(`inventoryScreens.acceptance.test.tsx` — 22, 23, 24, 25, 25b×2). Sınıflandırma:

**REGRESYON — düzeltildi.** Kök neden: `react-hook-form` çözümleyicisi
**asenkron**dur; `formState.isValid` değişiklikten **bir tik sonra** güncellenir.
Eski form doğrulamayı render sırasında senkron hesaplıyordu. Gönder düğmesini
`isValid`'e bağlayınca, son karakteri yazıp **hemen** tıklayan kullanıcı kapalı
düğmeye çarpıyor ve **hiçbir şey olmuyordu** — hata da yok, gönderim de yok.
Sessiz bir kayıp.

Ölçümle doğrulandı (geçici `console.log` ile): tıklama anında
`isValid:false`, bir render sonra `isValid:true`.

Düzeltme: gönder kapısı **aynı şemadan senkron** okunuyor
(`damageFormSchema(kind).safeParse(degerler).success`), `isValid`'ten değil.
Alan altındaki kırmızı mesajlar çözümleyiciden gelmeye devam ediyor — tek
doğruluk kaynağı korundu. 5 kabul testi **değiştirilmeden** yeşile döndü.

**İKİNCİ REGRESYON — düzeltildi.** Eski form, formun altındaki gri satırda "ne
eksik" diyordu (kırmızı hata değil, yönlendirme). `react-hook-form` anlık modda
yalnız **dokunulan** alanı işaretler; hiç dokunulmamış zorunlu bir alan
(tedarikçi iadesinde kaynak kova) sessizce eksik kalıyor ve kullanıcı düğmenin
neden kapalı olduğunu göremiyordu. O gri satır geri kondu
(`data-testid="damage-eksik-ipucu"`) ve **alanında zaten kırmızı görünen bir
eksiği tekrar etmiyor** — aksi hâlde İP-A2'nin kapattığı gürültü geri gelirdi.

Bu regresyonu ilk yakalayan **kendi testimdi** ("tedarikçi iadesinde kaynak
kova zorunlu kalır"). Test, kapalı düğmeye tıklamanın alanı `aria-invalid`
yapacağını varsayıyordu — bu yanlış bir varsayımdı ve testin kendisi
düzeltildi: artık gri ipucunun kovayı söylediğini, düğmenin kapalı olduğunu,
kova seçilince açıldığını ve gövdede `bucket` gittiğini doğruluyor. Yanına
"ipucu, alanında görünen hatayı tekrar etmez" testi eklendi.

**KASITLI DEĞİŞİKLİK — test güncellendi:** yok. Kırılan 5 kabul testinin hiçbiri
davranış değişikliği yüzünden kırılmadı; hepsi gerçek regresyondu ve **üretim
koduyla** düzeltildi. Kabul testlerine tek satır dokunulmadı.

### Korunan davranışlar (test edildi)

- anlık doğrulama (gönder'e basmadan hata çıkar)
- etki metni ve rakamı
- imha onay kutusu kapısı
- idempotency anahtarının ömrü (başarısız denemede aynı, yeni işlemde yeni)
- sunucu gövdesi (`bucket` yalnız tedarikçi iadesinde)
- gönder düğmesinin senkron açılıp kapanması

`DamageDialog.test.tsx`: 8 test. Tek mock `useAdminProducts` (ürün araması bu
paketin konusu değil); seçici gerçek bileşenin kendisi, ürün gerçekten listeden
tıklanarak seçiliyor.

---

## Görev 6 — Eşikler ve mutasyon provası

### Yeni eşikler

| Eşik | Eski | Yeni |
|---|---|---|
| ölçüm tabanı (dosya) | ≥ 70 | **≥ 60** (gerçek: 64) |
| ham `<button` | ≤ 126 | **≤ 126** |
| `<label htmlFor>` oranı | ≥ 3/59 | **≥ 4/55** |
| `ui2/` dışı Medusa importu | = [] | **= []** |
| etiketsiz overlay | ≤ 5 | **≤ 5** |
| overlay'li dosya listesi | 4 dosya sabit | **aynı 4 dosya** |

**Ham buton sayısı düşmedi ve düşmesi de beklenmiyordu:** `DamageDialog` zaten
`admin/ui`'nin `Button`'ını kullanıyordu, tek bir ham `<button>`ı yoktu.
Bu sayı A6-A7'de düşecek. Eşiği "dekor" saymamak için olduğu gibi bırakıldı —
sahte bir düşüş yazmak ölçümü yalanlamak olurdu.

**Etiket oranı gerçekten iyileşti:** 3/58 = %5,2 → 4/55 = %7,3. Pilot dört ham
`<label>`ı `Form.Label`'a devretti (payda −4) ve `Form.Label` tek `htmlFor`lu
etiket olarak sayıya girdi (pay +1). Bundan sonra `Form.*`'a geçen her form
oranı otomatik yukarı çeker.

### Dört mutasyon (gerçek JSX ile)

Sürücü: `frontend/scripts/ip_a2_mutasyon.mjs`. `git checkout --` **kullanmaz**;
dosyanın ham baytlarını bellekte tutar, aynen geri yazar ve başta/sonda
`git status --porcelain` çıktılarını karşılaştırır.

```
Taban: nöbetçi YEŞİL.

✓ ham <button sayısı: mutasyon yakalandı
✓ <label htmlFor oranı: mutasyon yakalandı
✓ ui2 dışı @medusajs/ui importu: mutasyon yakalandı
✓ etiketsiz overlay: mutasyon yakalandı

Çalışma ağacı başlangıçtaki hâline döndü.
```

| Eşik | Uygulanan ihlal |
|---|---|
| ham `<button` | `DamageDialog`'a gerçek bir `<button type="button">Ham buton</button>` eklendi (126 → 127) |
| `htmlFor` oranı | `Form.Label`'ın `htmlFor={kimlik?.id}` bağı koparıldı (4 → 3) |
| Medusa importu | `DamageDialog`'a `import { Tooltip } from "@medusajs/ui"` eklendi |
| etiketsiz overlay | `DamageDialog`'a `role`/`aria-modal` taşımayan `<div className="fixed inset-0 …" />` eklendi (5 → 6) |

Her mutasyondan sonra geri alma doğrulandı ve nöbetçinin yeşile döndüğü
gösterildi.

---

## Test türlerinin dürüst sınıflandırması

| Sınıf | Sayı | Nerede |
|---|---|---|
| Gerçek DOM (RTL, davranış) | 19 | `form.test.tsx` 8 · `sunucuHatasi.test.tsx` 3 · `DamageDialog.test.tsx` 8 |
| Gerçek tarayıcı (Chrome/CDP, piksel) | 1 ölçüm + 1 ters prova | `ip_a2_slot_probe.mjs` |
| Saf yardımcı/birim | 10 | `zodTurkce.test.ts` 2 · `sayim.test.ts` 8 |
| Kaynak/AST sözleşmesi (**düşük güçlü**) | 6 | `uiBaseline.test.ts` |
| Mutasyon provası | 4 + 1 | nöbetçi eşikleri + slot sondası |

Değişmeden korunan mevcut testler: `inventoryScreens.acceptance.test.tsx` 57,
`lib/inventory.test.ts` 40.

---

## Bilinen sınırlar ve doğrulanmamış noktalar

1. **422 → alan eşlemesi pilotta canlı DEĞİL.** `sunucuHatasiniUygula` katmanda
   üç testle kanıtlandı, ama `DamageDialog`'a bağlanması `DamageEventsPage`'in
   ham hatayı (string yerine) diyaloğa geçirmesini gerektirir. Bu bir **ekran
   dosyası değişikliğidir** ve paketin "pilot dışında hiçbir ekran değişmedi"
   kapısını ihlal ederdi; sonraki pakete bırakıldı.
2. **Slot piksel ölçümü CI'da koşmuyor.** Elle çalıştırılan bir sondadır (dev
   sunucusu + Chrome gerektirir). CI'daki nöbetçi yalnız mekanizmayı tutar.
3. **Karanlık mod paritesi ölçülmedi.** `Form.*` sınıfları `dark:` karşılıklarını
   taşıyor ama ekran görüntüsüyle karşılaştırılmadı.
4. **`form-probe.html` + `src/__probe__/`** ölçüm aracıdır; `vite build`
   çıktısına girmediği doğrulandı (dist'te izi yok).
5. `zod` mesajlarında tip adları İngilizce kalıyor ("beklenen string"). Şemalar
   iş kuralı mesajlarını kendileri Türkçe yazdığı için kullanıcıya çıkan
   metinlerde bu görünmüyor; yine de bir sonraki formda gözden geçirilmeli.

---

## Bitiş kontrolü

- [x] A1 commit'lendi (`9aeda14`), iskele silindi, A0 dipnotu düşüldü
- [x] Sayaç yorum/string saymıyor (AST); taban yeniden ölçüldü, eski/yeni ayrı verildi
- [x] `tsc --noEmit` temiz; test paketi öncekinden kötü değil (1021 → 1050)
- [x] Kırmızı matris önce kırmızı gösterildi (ham çıktı `docs/ip-a2/kirmizi-matris.txt`)
- [x] 10 test de yeşil (13 + 8 = 21 yeni test)
- [x] `DamageDialog` `Form.*` kullanıyor; iki regresyon bulundu ve **üretim
      koduyla** düzeltildi, kabul testlerine dokunulmadı
- [x] Eşikler yeni değerlere çekildi ve dördü de mutasyonla kırıldı
- [x] `ui2/` dışında `@medusajs/ui` import eden dosya: **0**
- [x] `DamageDialog` dışında hiçbir ekran dosyası değişmedi
      (`git diff --stat src/pages src/components/admin` → tek dosya)
