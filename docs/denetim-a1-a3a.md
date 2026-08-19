# Bağımsız Denetim — İP-A1 · İP-A2 · İP-A3a

**Denetlenen:** `3fd8742` (detached HEAD, `adana-medusa-ui-denetim` worktree)
**Tarih:** 19 Ağustos 2026
**Denetçi notu:** Bu kodu yazmadım. Raporlar (`docs/ip-a1-rapor.md`, `ip-a2-rapor.md`,
`ip-a3a-rapor.md`) **iddia** olarak okundu. Geliştiricinin mutasyon sürücüleri
(`ip_a2_mutasyon.mjs`, `ip_a3a_mutasyon.mjs`) ve tur betikleri **çalıştırılmadı**.

## Kullandığım aletler (geliştiricininkinden farklı)

| Soru | Geliştiricinin aleti | Benim aletim |
|---|---|---|
| Sayımlar (buton/kontrol/overlay/import) | TypeScript compiler AST | **@babel/parser + @babel/traverse** ile sıfırdan yazılmış sayaç |
| "Erişilebilir adı var mı" | statik AST çıkarımı | **çalışma zamanı**: RTL ile render + `label[for]` çözümü + **axe-core** taraması |
| "Storefront'ta piksel regresyonu yok" | canlı `ceyhandb` + Chrome piksel turu | **üretilen CSS'in postcss ile kural bazında farkı** (eski `tailwind.config.js` ↔ yeni) |
| Eşikler nöbet tutuyor mu | kendi mutasyon sürücüsü | **kendi mutasyon sürücüm** (9 mutasyon, 4'ü ters prova) |
| Test yalıtımı | `afterEach` eklemesi | **`vitest --sequence.shuffle`** (4 farklı seed) + tek dosya koşuları |

Denetim sırasında çalışma ağacına yazılan her geçici dosya silindi; her mutasyondan
sonra `git status --porcelain` ile temizlik doğrulandı. Son durum: **çalışma ağacı
temiz** (yalnız takipsiz `denetim-prompt.md` ve bu rapor).

---

## 1 · Kendi ölçtüğüm sayılar

### 1a · Kapılar (kendi koşumum)

| Kapı | İddia | Benim ölçümüm | Durum |
|---|---|---|---|
| `npx tsc --noEmit` | temiz | temiz (çıkış 0) | ✅ aynı |
| `npm run test` | 109 dosya / 1074 test | **109 dosya / 1074 test, hepsi yeşil** (127.7 s) | ✅ aynı |
| `npm run build` | başarılı | başarılı (31.1 s) | ✅ aynı |

### 1b · Sayaç (Babel tabanlı bağımsız sayaç)

| Ölçüm | İddia | Benim ölçümüm | Durum |
|---|---|---|---|
| ham `<button` | 126 | **126** | ✅ aynı |
| erişilebilir adı olmayan form kontrolü | 41 | **41** | ✅ aynı (ama §2.1'e bak) |
| `ui2/` dışında `@medusajs/ui` import eden dosya | 0 | **0** | ✅ aynı |
| `role="dialog"`+`aria-modal` taşımayan gerçek overlay | 5 (4 dosyada) | **5 (aynı 4 dosya)**: `AdminPayoutsPage`(1), `AdminExamCatalogs`(1), `AdminLibraries`(2), `AdminStore`(1) | ✅ aynı |
| ölçüm tabanı dosya sayısı | 65 | **65** (components/admin 30 · pages/admin 31 · dashboards/Admin\* 4) | ✅ aynı |
| ölçülen kontrol / ölçüm dışı | 143 / 1 | **143 / 1** | ✅ aynı |
| adsız kontrol dağılımı | AdminStore 26 · CourierManager 9 · AdminLibraries 4 · AdminHome 2 | **birebir aynı, satır numaraları dahil** | ✅ aynı |

**Beş sayının beşi de bağımsız bir parser'la birebir doğrulandı.** İddia edilen
sayılar doğrudur. Sorun sayıların yanlış olması değil, **neyi saymadıklarıdır**.

> Kendi aletimde bir hata buldum ve raporluyorum: ilk sürümüm JSX üye ifadesi
> (`Form.Control`) etiket adını çözemediği için **45** dedi. Hata bendeydi
> (`JSXIdentifier.name` bir düğüm değil, dizedir); düzeltince 41'e indi. Bunu
> yazıyorum çünkü "farklı alet farklı sayı verdi" ilk okumada bulgu gibi
> görünüyordu ve öyle değildi.

### 1c · Bağımlılıklar ve değişen ekran dosyaları

`package.json`'a giren beş bağımlılık: `@hookform/resolvers ^5.9.1`,
`@medusajs/ui ^4.2.1`, `@medusajs/ui-preset ^2.19.0`, `react-hook-form ^7.85.0`,
`zod ^4.4.3`. **Beyan edilenle aynı, beyan edilmeyen giren yok.**

`git diff --name-status` ile üç commit boyunca değişen ekran dosyaları:
`DamageDialog.tsx` (pilot), `DamageEventsPage.tsx` (pilotun sayfası, ham hata
aktarımı), `lib/inventory.ts`, `main.tsx` (I18nProvider), `tailwind.config.js`.
**"Pilot dışında ekran dosyası değişmedi" iddiası doğrudur.**

### 1d · CSS farkı (A1'in piksel iddiasına bağımsız kontrol)

Aynı `src/` üzerinde iki Tailwind derlemesi (eski config ↔ yeni config), postcss
ile kural bazında karşılaştırıldı:

```
eski kural: 2016   yeni kural: 2435
DEĞİŞEN (aynı seçici, farklı bildirim): 10
SİLİNEN (eskide vardı, yenide yok):      0
EKLENEN:                               419
```

**Hiçbir kural kaybolmamış**; `.text-*`, `.rounded-*`, `.p-*`, renk ölçekleri
dokunulmamış — yani `ui-preset` mevcut temayı **değiştirmemiş**, üzerine eklemiş.
Değişen 10 kuralın ikisi yalnız font ailesindeki tırnak farkı (`"Courier New"` →
`Courier New`, CSS'te eşdeğer). `Roboto Mono` üretilen CSS'te **0 kez** geçiyor —
`font-mono` geri alma iddiası doğrulandı.

Kalan 8 değişiklik iki gruptur ve **ikisi de A1 raporunda zaten yazılı**:
`* { border-color: var(--border-base) }` global kuralı (preflight'ın `#e5e7eb`
varsayılanını eziyor) ve `.duration-*`/`.ease-*` sınıflarının artık
`animation-duration`/`animation-timing-function` de yazması. A1 bunları ölçmüş,
raporlamış ve etkisiz bulmuş. **Bağımsız olarak katılıyorum** (gerekçe §4).

---

## 2 · Bulgular

### P1 — Toplu göç başlamadan düzeltilmeli

---

#### P1-1 · `Form.Control` üyeliği "erişilebilir ad" kanıtı sayılıyor; en az üç gerçek şekilde ad ÜRETMİYOR

**Bulgu.** Sayaç bir kontrolü, JSX atalarında `Form.Control` varsa
**adlandırılmış** sayıyor (`ui-baseline-sayim.mjs:107` `KONTROL_SARMALAYICILARI`,
`:296` `kontrolIcinde`). Bu, `Form.Control`'ün `id`'yi gerçekten çocuğa geçirdiği
varsayımına dayanıyor. Çalışma zamanında en az üç şekilde geçirmiyor ve **hiçbiri
uyarı vermiyor**:

| Şekil | Çalışma zamanı sonucu |
|---|---|
| Çocuk bir **Fragment** (`<Form.Control><><input/><span>TL</span></></Form.Control>`) | `Children.only` Fragment'ı tek çocuk sayar, `cloneElement` prop'ları **Fragment'a** verir; iki input da `id=""`, etiket yok |
| `Form.Control` var ama **`Form.Item` yok** | `KimlikCtx` null → `id=undefined`, `<label for>` null |
| Çocuk **prop iletmeyen** bir bileşen | `id` bileşene gider, DOM'a inmez |

**Kanıt (çalışma zamanı, RTL):**
```
D1c hata = YOK (sessiz)      a.id = ""   b.id = ""          ← Fragment
D1d iletmez.id = ""   iletmez için etiket: YOK               ← prop iletmeyen bileşen
D4b input.id = ""     label.htmlFor = null                   ← Form.Item yok
```
**Kanıt (sayaç kör mü):** kendi mutasyon sürücüm, `CourierManager.tsx`'e
yukarıdaki iki şekli ekledi:
```
M3  Form.Control(Form.Item YOK) icinde etiketsiz input  -> GECTI  (kontrol 143→144, adsiz 41)
M3b Form.Control cocugu FRAGMENT                        -> GECTI  (kontrol 143→145, adsiz 41)
M3c TERS PROVA: duz etiketsiz input                     -> KIRILDI (adsiz 42)  ✔
```
Ters prova, sayacın "her şeyi affetmediğini" gösteriyor — kör nokta **özellikle
`Form.Control` dalında**.

**Etki.** A6-A7'de elli dosya `Form.Control`'e sarıldığında `adsizKontrol` sayacı
**mekanik olarak düşer** — sarma işlemi ad üretsin ya da üretmesin. Metrik göçün
ilerlemesini değil, göçün **yapıldığını** ölçer. "41 → 0" raporlanır, panelde
etiketsiz alanlar durmaya devam eder ve nöbetçi bunu bir daha asla görmez.
Fragment şekli özellikle olası: "input + birim eki" (₺, adet, %) paneldeki en
yaygın desenlerden biri.

**Not.** `sayim.test.ts:167` "dört adlandırma biçiminin HİÇBİRİ borç saymaz"
testi bu varsayımı **kaynak sözleşmesi** olarak sabitliyor ama `Form.Control`'ün
gerçekten ad ürettiğine dair **hiçbir çalışma zamanı testi yok**. Kök CLAUDE.md
§C'nin tarif ettiği "düşük güçlü test bir eşiği besliyor" hâlinin ta kendisi.

---

#### P1-2 · `kontrolToplam >= 140` tabanı, korumak istediği göç tarafından kırılacak

**Bulgu.** `uiBaseline.test.ts:66` yanlış-yeşil koruması olarak
`expect(olcum.kontrolToplam).toBeGreaterThanOrEqual(140)` diyor; bugünkü değer
**143**, yani marj **3**. Ama sayaç yalnız ham `input`/`select`/`textarea`
etiketlerini sayıyor (`KONTROL_ETIKETLERI`). Medusa göçünün tanımı gereği bu
etiketler `<Input>`/`<Select>`/`<Textarea>` sarmalayıcılarıyla değişecek —
**ham etiket ortadan kalkacak**.

**Kanıt.** Bugün en ağır dört-beş dosya ölçümden düşse taban şöyle çöküyor:
```
en agir 5 dosya olcum disi -> files=60  rawButton=44  kontrol=62  adsiz=0
```
`files >= 60` bu çöküşü **tutmuyor** (tam sınırda geçiyor); tutan tek şey
`kontrol >= 140`. Ama aynı eşik, meşru göçte de düşecek: `AdminStore.tsx` tek
başına göç etse kontrol sayısı 140'ın altına iner.

**Etki.** A6'nın ilk gerçek dosyasında CI kırmızıya döner ve kırılma **bir
regresyon değil, ilerlemedir**. Geliştiricinin eski `htmlFor` oranı metriğini
kaldırma gerekçesi ("göç paydayı düşürür, nöbetçi anlamsızlaşır") burada **taban
kontrolünde aynen tekrarlanmış**. Ya taban her pakette elle indirilecek (nöbetçiyi
tören hâline getirir) ya da tabanın ölçüsü ham etiket sayısı olmaktan çıkarılacak.

---

#### P1-3 · `sunucuHatasi` opsiyonel: göçte unutulan her form, paketin çözdüğü hataya sessizce geri döner

**Bulgu.** `useKirliFormBekcisi({ form, sunucuHatasi = null, etkin = true })`.
A3a raporunun ana argümanı `isSubmitSuccessful`'ın tek başına yetmediği —
işleyici `mutate()` çağırıp döner, bayrak ağ isteği yola çıkmadan `true` olur.
Çözüm doğru; ama **güvenli yol opsiyonel parametreye bağlanmış**, yani unutulan
her çağrı yerinde varsayılan davranış tam olarak hatanın kendisidir.

**Kanıt (çalışma zamanı).** `sunucuHatasi` verilmeden:
```
B4 sunucuHatasi VERİLMEDİ → gönderim sonrası korumali = false
```
Form kirli, sunucudan hiçbir yanıt gelmemiş, bekçi çoktan susmuş.

**Etki.** Elli dosyaya kopyalanacak sözleşmede **yanlış kullanım sessiz ve
varsayılan**. Tip sistemi de yardım etmiyor: parametre opsiyonel olduğu için
`tsc` uyarmıyor, nöbetçi eşiklerinden hiçbiri bunu ölçmüyor, ve testler yalnız
parametre **verilen** yolu kanıtlıyor (`kirliFormBekcisi.test.tsx` M7).
Öneri sınıfı: parametreyi zorunlu yap ya da "hata takibi yok" niyetini açıkça
yazdır (`sunucuHatasi: unknown | "yok"`).

---

#### P1-4 · Ölçüm tabanı panelin bir bölümünü hiç görmüyor — borç taşınarak eşik "düşürülebilir"

**Bulgu.** Taban `src/components/admin/**` + `src/pages/admin/**` +
`src/pages/dashboards/Admin*.tsx`. Aynı panel kabuğunu (`DashboardShell`)
kullanan ve aynı göçe girecek şu ekranlar **tabanın dışında**:

```
src/pages/dashboards/CourierHome.tsx        ham<button>=2   adsiz=0
src/pages/dashboards/OperatorHome.tsx       ham<button>=3   adsiz=3
src/pages/dashboards/OperatorLibrary.tsx    ham<button>=4   adsiz=7
src/pages/dashboards/OperatorSessions.tsx   ham<button>=3   adsiz=1
src/pages/DeliveryDriver.tsx                ham<button>=19  adsiz=4
src/pages/DeliveryRunHandover.tsx           ham<button>=3   adsiz=0
                                    TOPLAM  ham<button>=34  adsiz=15
```

`DeliveryDriver.tsx` kök CLAUDE.md'ye göre **ADMIN rolünün** saha ekranıdır ve
tek başına 19 ham buton taşıyor — ölçülen 126'nın %15'i kadar, tamamen görünmez.

**Etki.** İki ayrı zarar. (a) Nöbetçi, panelin bir bölümünde borcun **büyümesine**
izin veriyor. (b) Daha kötüsü: bir ekranı taban dışına taşımak (yeniden
adlandırma, `dashboards/Operator*` altına alma, `pages/` köküne çıkarma) eşiği
**düşürüyor** ve bu "ilerleme" gibi okunuyor. Eşiklerin hiçbiri dosya kümesinin
sabit kaldığını doğrulamıyor — yalnız overlay listesi isimle sabitlenmiş
(`UNLABELED_OVERLAY_FILES`), buton/kontrol tabanı için böyle bir sabitleme yok.

---

### P2 — Düzeltilmeli, aciliyeti yok

---

#### P2-1 · Onay penceresi açıkken bileşen unmount olursa öksüz React kökü ekranda kalıyor

**Bulgu.** `usePrompt` her çağrıda `createRoot(document.createElement("div"))`
mount ediyor ve bu kök **yalnız** `onCancel`/`onConfirm` içinde `unmount()`
ediliyor (`@medusajs/ui/dist/esm/hooks/use-prompt/use-prompt.js`). Söz
çözülmeden bileşen giderse kimse unmount etmiyor. `useKirliFormBekcisi`'nin
temizlik `useEffect`'i yok.

**Kanıt (çalışma zamanı).**
```
B2 unmount SONRASI onay penceresi hâlâ DOM'da mı = true   alertdialog sayısı = 1
```
Onay penceresi, onu açan bileşen yok olduktan sonra `document.body`'de duruyor.
Radix modal olduğu için arkadaki sayfayı `pointer-events` ile de kilitliyor;
kilit ancak kullanıcı bir düğmeye basınca açılıyor (`usePrompt`'un "TEMP FIX"i).

**Etki.** Üretimde ulaşılabilir: ebeveyn `kind`'ı `null` yaparsa (WebSocket
push'u, query invalidation, `isPending` bitişi) ya da rota değişirse pencere
öksüz kalır. Kullanıcı, artık var olmayan bir formun "kaydedilmemiş
değişiklikleri" için onay isteyen bir kutuya bakar; "Çık" derse **bayat bir
closure**'daki `onClose` çalışır.

Aynı kök, geliştiricinin "test hijyeni" olarak raporladığı sızıntının da
sebebidir (A3a raporu Görev 3). **Test sorunu olarak teşhis edilmiş; üretim
sorunu olduğu görülmemiş.**

---

#### P2-2 · Başarılı gönderimden SONRA yazılan veri korunmuyor

**Bulgu.** `kaydedildi = gonderimBasarili && !sunucuHatasi`. `isSubmitSuccessful`
bir sonraki `handleSubmit` ya da `reset()`'e kadar `true` kalır. Pencere açık
kalırsa kullanıcının yeni yazdığı her şey korumasızdır.

**Kanıt.**
```
B4b gönderim sonrası YENİDEN yazınca korumali = false
```

**Etki.** `DamageDialog` başarıda ebeveyn tarafından kapatıldığı için pilotta
görünmüyor. Göç edilecek "kaydet ve açık kal" formlarında (ayar panelleri,
çok adımlı formlar) doğrudan veri kaybıdır.

---

#### P2-3 · `Form.Control` çocuğun kendi `id` ve `aria-describedby`'sini sessizce eziyor

**Kanıt.** `<input id="benim-id" aria-describedby="baska-dugum" />` sarıldığında:
```
D1b id = :r3:kontrol   describedby = null
```
`cloneElement`'in prop'ları, çocuğun kendi `aria-describedby`'sini `undefined`
ile ezip **siliyor** (hata yokken ve hint yokken `aria-describedby: undefined`
geçiliyor). **Etki:** karakter sayacı, para birimi açıklaması veya harici bir
yardım düğümüne bağlı kontroller göç sırasında bağlarını sessizce kaybeder.
`id` ezilmesi ayrıca `document.getElementById` ile bu kontrolü arayan mevcut
kodu bozar.

---

#### P2-4 · Slot tespiti yalnız DOĞRUDAN çocukta çalışıyor; sarmalanan Hint/ErrorMessage tek-slot garantisini bozuyor

**Bulgu.** `Item` çocukları `Children.toArray` + `c.type === Hint` ile ayırıyor.
Koşullu ifade (`{kosul && <Form.Hint/>}`) çalışıyor ✅ — ama **Fragment** ya da
sarmalayıcı `<div>` içindeki Hint/ErrorMessage bulunmuyor: üst bölüme düşüyor,
slot boş kalıyor.

**Kanıt.**
```
D2a  koşullu Hint   → slot = "KOSULLU-IPUCU"   describedby = :r7:hint     ✔
D2b  Fragment Hint  → slot = ""                describedby = null         ✘
D2c  <div>ErrorMsg  → slot = ""                (mesaj üst bölümde görünüyor)  ✘
```

**Etki.** Paketin ana vaadi — "hata doğduğunda yerleşim itilmez" — sessizce
kayboluyor; ayrıca Fragment vakasında `hintVar` false olduğu için
`aria-describedby` hiç kurulmuyor. `Item` bu durumları ne uyarıyor ne de
`tsc` yakalıyor.

---

#### P2-5 · `Form.Item` dışında kullanım sessizce adsız kontrol üretiyor

`Form.Label`/`Form.Control` `Form.Item` olmadan kullanılınca `KimlikCtx` null:
`input.id = ""`, `label.htmlFor = null` (kanıt: `D4b`). Ne `console.warn` ne
`tsc` hatası. Elli dosyalık göçte en olası tek yazım hatası budur ve **hem
sessiz hem de sayaç tarafından "adlandırılmış" sayılıyor** (bkz. P1-1).

---

#### P2-6 · Test yalıtımı: rastgele sırada üç dosya düşüyor; biri denetlenen kapsamda

**Bulgu.** `npx vitest run --sequence.shuffle` ile dört farklı seed:

| Seed | Sonuç |
|---|---|
| 20260819 | `src/pages/ticketsPaymentGate.test.tsx` düştü (1073/1074) |
| 1 | 109/109 yeşil |
| 2 | `ticketsPaymentGate.test.tsx` **ve** `store/storeVariants.acceptance.test.tsx` düştü |
| 3 | **`src/components/admin/ui2/zodTurkce.test.ts` M7 düştü** |

`zodTurkce.test.ts` **İP-A2'de eklendi**, yani denetlenen kapsamda. Hata:
```
AssertionError: expected 'Geçersiz değer: beklenen string, alın…' to match /expected string/i
  src/components/admin/ui2/zodTurkce.test.ts:20
```
Test "katman yüklenmeden zod İngilizce" diyor; başka bir dosya aynı işçi
sürecinde `form.tsx`'i (dolayısıyla `z.config(z.locales.tr())`'i) çoktan
yüklemişse bu iddia **geçersizdir**. Dosya tek başına koşunca geçiyor
(5/5) — yani sıraya bağımlı.

**Etki.** İki yönlü. Bugün **yalancı kırmızı** (meşru bir sıra CI'yı kırar).
Ama aynı sızıntı ters yönde de çalışır: `zod` global durumu dosyalar arasında
paylaşıldığı için M7b'nin "yüklendikten sonra Türkçe" iddiası, `form.tsx`'in
o satırı hiç çalıştırmasa bile başka bir dosya sayesinde geçebilir. Geliştirici
Radix portal sızıntısını **yalancı kırmızı** olarak teşhis etmiş ve düzeltmiş;
**yalancı yeşil yönü ve modül-düzeyi global durum sızıntısı incelenmemiş.**

`ticketsPaymentGate` ve `storeVariants` düşüşleri denetlenen paketlerin dışında
(önceden var olan borç) ama aynı sınıftan.

---

#### P2-7 · `afterEach` temizliği bir Türkçe metin sabitine bağlı ve bulunamazsa SESSİZCE hiçbir şey yapmıyor

```ts
const iptal = screen.queryAllByText("Vazgeç").find(n => n.closest('[role="alertdialog"]'));
if (!iptal) return;                    // ← sessiz no-op
```
(`kirliFormBekcisi.test.tsx:71`, `DamageDialog.test.tsx:237` — iki dosyada aynı.)

"Vazgeç" metni `medusa-tr.tsx::promptTr.cancelText`'ten geliyor, yani bir
**yapılandırma değeri**. Biri onu "İptal" yaparsa iki dosyadaki temizlik de
sessizce devre dışı kalır ve sızıntı geri döner — üstelik bu kez yalancı
yeşil üretebilecek bir DOM artığı olarak. Temizlik, "kapattım" iddiasını
doğrulamalı (`expect(document.querySelector('[role=alertdialog]')).toBeNull()`),
"bulamadım, geçiyorum" dememeli.

---

#### P2-8 · Sunucu alan hatası varken gönder kapısı AÇIK kalıyor (iki doğruluk kaynağının sapması)

Kapı `damageFormSchema(kind).safeParse(degerler)` ile **senkron** okunuyor;
sunucudan `setError` ile yazılan alan hataları bu kaynağa **görünmüyor**.

**Kanıt.**
```
K1 sunucu hatası VARKEN gönder düğmesi disabled = false
K1 alan hataları = ["Stokta bu kadar yok."]
K1 başka alana dokunduktan SONRA alan hataları = ["Stokta bu kadar yok."]   ← hata sağ kalıyor ✔
K1 üst şerit = null                                                         ← alan hatası şeride sızmıyor ✔
```
Kullanıcı kırmızı hatayı görüyor ama düğme etkin; aynı veriyle tıklarsa aynı
422'yi alır. Prompt'un sorduğu "kapı açık + alanlar hata gösteriyor" durumu
**üretilebiliyor**. Ters yön ("kapı kapalı + hiç hata yok") ise `eksikIpucu`
ile kapatılmış: `K2`'de kova boşken düğme kapalı ve gri ipucu
("Tedarikçi iadesinde kaynak kova seçilmeli.") görünüyor ✔.

**Etki.** Tek başına küçük; ama iki kaynağın ayrı olduğu **yapısal** olarak
sabitlendi ve elli forma kopyalanacak. Her yeni form, `safeParse`'ın görmediği
her hata sınıfında (sunucu doğrulaması, çapraz alan iş kuralı, async kontrol)
aynı sapmayı üretecek.

---

#### P2-9 · Ebeveyn kapatması bekçiyi tamamen atlıyor ve bilinen sınırlar listesinde yok

```
B5 ebeveyn kapattı → onay soruldu mu = false   alan hâlâ DOM'da mı = false
```
Bekçi yalnız `Dialog`'un `onClose`'unu kapılıyor. Ebeveyn `kind`/`open`'ı
kendisi `null`/`false` yaparsa (WS push, query invalidation, hata sonrası
sıfırlama, üst seviye "Kapat") **hiçbir onay sorulmadan** veri gidiyor.
A3a'nın "bilinen sınırlar" listesi yalnız **rota gezinmesini** kapsam dışı
ilan ediyor; bu yol orada yazmıyor.

---

### P3 — Not

- **P3-1 · Sayaç kaçış yolları (mutasyonla kanıtlandı).**
  `React.createElement("button")` ham buton sayılmıyor (M2 GEÇTİ);
  `@medusajs/ui/dist/esm/components/button` alt-yol importu görülmüyor
  (M5 GEÇTİ, ters provası M5b KIRILDI ✔); overlay sınıfı `clsx("fixed","inset-0")`
  ile parçalanırsa ya da `inset-0 fixed` sırasıyla yazılırsa sayılmıyor.
  Bugün hiçbiri kod tabanında yok; kötü niyet değil, **kaza** riski.
  Buna karşılık **maskeleme yok**: `role="dialog"`+`aria-modal` taşıyan bir
  dosyaya yeni etiketsiz overlay eklemek eşiği kırdı (M4 KIRILDI ✔).
- **P3-2 · `htmlFor`↔`id` eşleşmesi yinelenmeyi görmüyor.** Aynı `id` iki
  kontrolde olursa ikisi de "adlandırılmış" sayılıyor; oysa jsdom'da
  `label.control` **yalnız ilkini** çözüyor, ikincinin `labels.length = 0`.
  Aynı şekilde `htmlFor={uid}` ile `id={uid}` **farklı bileşenlerdeki** aynı adlı
  değişken olsa da eşleşiyor (dosya ölçeğinde metin karşılaştırması). Bugün
  ölçüm tabanında yinelenen `id` **yok** (kendi sayacımla tarandı) — latent risk.
- **P3-3 · `.duration-*`/`.ease-*` artık `animation-*` de yazıyor.** Bugün
  zararsız: bu sınıfların `animate-*` ile birlikte kullanıldığı **33 yerin
  tamamı** `animate-in` (yani niyet edilen kullanım). Ama bundan sonra
  `animate-spin duration-300` yazan biri spinner'ı sessizce 300 ms'ye çeker.
  `admin/ui/Button.tsx` zaten `animate-spin` kullanıyor — oraya bir `duration-*`
  eklenmesi yeterli. **A1'in "70 ölü sınıf canlandı, istenmeyen değil"
  yargısına katılıyorum**, ama yargı bugünkü kullanımlar içindir, kalıcı bir
  garanti değildir; nöbetçisi yok.
- **P3-4 · Type-only Medusa importu ihlal sayılıyor.** `import type { ButtonProps }
  from "@medusajs/ui"` sayaçta `medusaImport = true` üretiyor. Derlemede
  silinen bir import mimari kuralı çiğnemiyor; kural yazıldığından katı.
  Bilinçli bir tercih olabilir ama hiçbir yerde yazılı değil.
- **P3-5 · Sonda artıkları depoda.** `frontend/damage-probe.html`,
  `frontend/form-probe.html` (depo kökünde, `index.html`'in yanında) ve
  `src/__probe__/{FormSlotProbe,DamageDialogProbe}.tsx` (üretim ağacında).
  `dist/`'e girmiyorlar (doğrulandı) ama `tsc` kapsamındalar ve `allSource()`
  taramasına dahiller.
- **P3-6 · `gonderildiRef` çift-gönderim kilidi pratikte iş yapmıyor.**
  `window.setTimeout(() => { gonderildiRef.current = false }, 0)` kilidi bir
  sonraki makro-görevde açıyor; iki ayrı tıklama zaten iki ayrı görevdir.
  Gerçek koruma `Button`'ın `disabled={disabled || isPending}`'inden geliyor.
  Ref'in kendisi yanlış bir güven veriyor.

---

## 3 · Doğrulayamadıklarım

1. **Gerçek tarayıcı hiç kullanılmadı.** Tüm DOM ölçümlerim jsdom'da.
   `beforeunload`'un Chrome'da gerçekten uyarı gösterdiği, odak tuzağının onay
   penceresiyle çakışmadığı, baskı/karanlık mod kontrastı **doğrulanmadı**.
   A3a'nın karanlık mod sondası (`ip_a3a_karanlik_probe.mjs`) çalıştırılmadı
   (prompt kuralı).
2. **A1'in canlı piksel turu tekrarlanmadı** (canlı `ceyhandb`'ye bağlanmamak
   için). Yerine CSS farkı kullanıldı; bu **kural düzeyinde** kesin ama
   **kural sırası** değişimlerini göremez: iki utility aynı özgüllükteyse
   üretim sırasındaki değişiklik kazananı değiştirebilir ve benim farkım bunu
   yakalamaz. 419 eklenen kuralın hiçbirinin mevcut bir seçiciyi ezmediğini
   doğruladım, sıralamayı doğrulamadım.
3. **`ticketsPaymentGate` ve `storeVariants` sıra bağımlılığının kök nedenini
   bulamadım.** Sızıntının hangi dosyadan geldiği tespit edilmedi; yalnız
   varlığı ve tekrarlanabilirliği (`--sequence.seed=2`) kanıtlandı.
4. **41 borcun tamamı elle gözden geçirilmedi.** A3a "hepsi elle doğrulandı,
   hiçbiri başka dosyadan gelen sarmalayıcı içinde değil" diyor; ben bunu
   otomatik kontrolle destekledim (sayacımda ata zincirinde import edilmiş
   bileşen arayan bir kanca var, **0 şüpheli** döndü) ama 41 satırın hepsini
   gözle okumadım.
5. **`useModalA11y` ile Radix onay penceresinin etkileşimi kısmen ölçüldü.**
   ESC'in ikinci pencere doğurmadığını doğruladım (B1) — `usePrompt`'un
   `currentPromptPromise` koruması sayesinde. Ama odak tuzağının ve
   `body.style.overflow` geri yüklemesinin iç içe modalda doğru davrandığı
   gerçek tarayıcıda sınanmadı.
6. **Sayaç kaçışlarını yalnız sentetik/tek dosyalık mutasyonla denedim.**
   `React.createElement` ve alt-yol importu bu kod tabanında hiç
   kullanılmıyor; gerçek bir göç sırasında doğal olarak ortaya çıkıp
   çıkmayacağını bilmiyorum.

---

## 4 · Göç için hazır mı?

**Bugünkü hâliyle hayır — ama düzeltmeler küçük ve iki tanesi zorunlu.**

Sağlam olanlar açıkça sağlam: beş sayının beşi bağımsız bir parser'la birebir
doğrulandı; üç kapı (tsc/test/build) kendi koşumda birebir tekrarlandı;
bağımlılık beyanı dürüst; pilot dışında ekran dosyası değişmemiş; `ui-preset`
mevcut temayı **değiştirmemiş** (0 silinen CSS kuralı) ve `font-mono` gerçekten
geri alınmış; overlay eşiği maskelemeye karşı dayanıklı çıktı; 422 eşlemesi
bozuk gövde biçimlerinin dördünde de mesajı kaybetmiyor; `axe` render edilmiş
formda **sıfır ihlal** buluyor; `id` çakışması yok; `beforeunload` dinleyicisi
sızdırmıyor (5 kirli/temiz döngüsünde 5 ekle / 5 sil).

Sorun tek bir cümlede toplanıyor: **göçün ilerlemesini ölçen metrik, göçün
kendisiyle doyurulabiliyor.** `Form.Control`'e sarmak sayacı memnun ediyor;
sarmanın gerçekten ad üretip üretmediği ölçülmüyor (P1-1) ve `Form.Control`
en az üç gerçekçi yazımda ad üretmiyor. Buna, ilk gerçek dosyada kırılacak bir
taban kontrolü (P1-2) ve elli dosyaya kopyalanınca sessizce yanlış olan bir
varsayılan (P1-3) ekleniyor.

**Göç başlamadan önce (zorunlu):**

1. **P1-1** — `Form.Control` sözleşmesini savunmasız bırakmayın: Fragment ve
   `Form.Item`'sız kullanımda geliştirmede `console.warn`/`throw` üretin,
   **ve** en az bir çalışma zamanı testi ekleyin ("`Form.Control` içindeki
   kontrolün `getByLabelText` ile bulunabildiği"). Sayaç bu dalı ancak o zaman
   dürüstçe affedebilir.
2. **P1-2** — `kontrolToplam >= 140` tabanını göçün kırmayacağı bir ölçüye
   taşıyın (ör. ölçüm tabanı dosya listesinin **isimle sabitlenmesi**, overlay
   listesinde yapıldığı gibi).

**Göç başlamadan önce (şiddetle önerilir):**

3. **P1-3** — `sunucuHatasi`'nı zorunlu yapın.
4. **P1-4** — ölçüm tabanına `dashboards/{Operator,Courier}*` ve
   `pages/Delivery*` ekleyin; eşikleri yeniden taban alın (34 ham buton +
   15 adsız kontrol).
5. **P2-6/P2-7** — `zodTurkce.test.ts` M7'yi sıra bağımsız hâle getirin,
   `afterEach` temizliklerini "bulamadım→geç" yerine "kalmadığını doğrula"
   hâline getirin. Bunlar olmadan A6-A7'de eklenecek yüzlerce testin yeşili
   sıraya bağlı olacak.

**Göçle birlikte, engel değil:** P2-1 (öksüz onay penceresi — `useEffect`
temizliği), P2-2, P2-3, P2-4, P2-5, P2-8, P2-9 ve P3'lerin belgelenmesi.

Bu dört-beş düzeltme yapılırsa sözleşme elli dosyayı taşır: parçalar doğru
tasarlanmış, gerekçeler yazılı, testlerin çoğu gerçek DOM üzerinde ve
raporlar dürüst. Eksik olan, **sözleşmenin yanlış kullanımını görünür kılan
katman** — ve ölçüm aracının tam olarak orada kör olması, elli dosyalık bir
göçte en pahalı kör noktadır.
