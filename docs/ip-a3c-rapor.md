# İP-A3c — Denetim düzeltmeleri

**Dal:** `feat/medusa-ui-taban` · **Taban commit:** `3fd8742`
**Tarih:** 19 Ağustos 2026
**Girdi:** bağımsız denetim raporu — bu commit'le `docs/denetim-a1-a3a.md` altına alındı
(denetçi kendi worktree'sinde bırakmıştı; kayıt dışı kalmasın diye kopyalandı).

Bu paket **yeni özellik ve yeni ekran göçü içermez.** Denetimin toplu göç öncesi
kapatılmasını istediği kusurları kapatır.

## Kapılar

| Kapı | Sonuç |
|---|---|
| `npx tsc --noEmit` | temiz |
| `npm run test` | **109 dosya / 1091 test yeşil** (öncesi 1074; +17 yeni) |
| `npm run build` | başarılı (33.8 s) |
| `npx vitest run --sequence.shuffle` × 4 seed (20260819, 1, 2, 3) | **hepsi 1091/1091 yeşil** |
| `node scripts/ip_a3c_mutasyon.mjs` | **18/18 mutasyon yakalandı**, çalışma ağacı temiz |

---

## Kök sorun ve seçilen yol

Denetimin tek cümlelik özeti doğruydu: **göçün ilerlemesini ölçen metrik, göçün
kendisiyle doyurulabiliyordu.** Sayaç bir kontrolü "adlandırılmış" sayıyor çünkü
JSX atalarında `Form.Control` var — bu, `Form.Control`'ün `id`'yi gerçekten DOM'a
indirdiği **varsayımına** dayanıyor ve varsayım en az üç yazımda yanlıştı.

Seçilen yol daha akıllı bir AST kuralı **değil**: vekili inşa yoluyla doğru
yapmak. `Form.Control` artık sessizce başarısız olamaz; dolayısıyla "içindeyse
adlandırılmıştır" gerçekten doğru ve sayaç o dalı dürüstçe affediyor.

---

## Görev 1 — `Form.Control` sessiz başarısız olamaz (P1-1, P2-5)

### Yeniden ürettim mi

Evet, iki ayrı yoldan.

**(a) Sayacın körlüğü.** Denetimin M3/M3b mutasyonlarını kendi sürücümde
tekrarladım (`dosyaOlcumu`'na elde yazılmış kaynak vererek, düzeltmeden ÖNCE):

```
M3  (Form.Item YOK, Form.Control içinde etiketsiz input) → kontrolToplam=1  adsizKontrol=0   ← borç sayılmadı
M3b (Form.Control çocuğu FRAGMENT)                       → kontrolToplam=1  adsizKontrol=0   ← borç sayılmadı
```

**(b) Çalışma zamanı.** Denetimin D1c/D1d/D4b kanıtlarını yeni yazdığım DOM
testleriyle tekrarladım; düzeltmeden önce üçü de **sessizdi** (ne `throw`, ne
`console.error`, ne `tsc` hatası) ve `getByLabelText` kontrolü bulamıyordu.

### Nasıl düzelttim

`form.tsx`'e, **yalnız geliştirmede** çalışan (`import.meta.env.DEV`) bir koruma
katmanı:

| Kör nokta | Yeni davranış | Neden bu yol |
|---|---|---|
| `Form.Item` yok (bağlam null) | `Form.Control` ve `Form.Label` **`throw`** | Statik olarak anlaşılır bir programlama hatası; `console.warn` elli dosyalık göçte ekrandaki gürültüde kaybolur |
| Çocuk **Fragment** | `Form.Control` **`throw`** | Aynı; ayrıca en olası yazım ("input + birim eki") |
| Çocuk **prop iletmeyen bileşen** | mount sonrası **DOM'dan ölçülür**, uymuyorsa `console.error` (bileşen adı + alan adı + beklenen id) | Statik olarak anlaşılamaz; ölçüm ancak çalışma zamanında yapılabilir |

Ölçüm `ref` ile yapılır (çocuğun kendi `ref`'i **ezilmez** — `react-hook-form`
odaklamayı onunla yapar); `ref` DOM'a ulaşmıyorsa `document.getElementById`
ile belgeden doğrulanır. Böylece hem `ref` ileten hem iletmeyen bileşen ölçülür.

**Üretim derlemesinde çalışmıyor** — doğrulandı: `dist/assets/*.js` içinde
koruma metinlerinden hiçbiri yok (`grep -rl "Form.Item dışında kullanıldı" dist/`
→ boş), `import.meta.env` kalıntısı da yok. Vite bu dalları eliyor.

### Düzeldiğinin kanıtı

Yeni çalışma zamanı testleri (`form.test.tsx`, hepsi gerçek DOM):

- **K1 — VEKİLİN KANITI**: `Form.Control` içindeki kontrol `getByLabelText` ile
  bulunuyor; `document.getElementById(kontrol.id)` aynı düğümü çözüyor;
  `label.control === kontrol` ve `kontrol.labels.length === 1`.
  **Bu cümle bugüne kadar hiçbir testte söylenmemişti** — sayacın tüm
  `Form.Control` dalı ona yaslanıyordu.
- **K2 / K2b** — `Form.Item` olmadan `Form.Control`/`Form.Label` → `throw`.
- **K3** — Fragment çocuk → `throw`.
- **K4** — prop iletmeyen bileşen → kontrol GERÇEKTEN adsız
  (`queryByLabelText` null) **ve** konsola bileşen adıyla yazılıyor.

Mutasyon provası (`ip_a3c_mutasyon.mjs`): **B1** (Form.Item patlaması söküldü) →
K2 kırıldı; **B2** (Fragment patlaması söküldü) → K3 kırıldı; **B3** (çalışma
zamanı id ölçümü söküldü) → K4 kırıldı.

### Denetimin M3/M3b'sine ne oldu — dürüst cevap

Sayacın **kaynak düzeyindeki** davranışı bu dalda değişmedi: `Form.Control`
içindeki bir kontrolü hâlâ adlandırılmış sayıyor, dolayısıyla M3/M3b'yi
sentetik bir kaynağa yazarsanız sayaç yine 0 borç der. Değişen şey, o dalın
**önermesi**: artık o yazımlar geliştirmede ve testte patlıyor, yani kod tabanına
giremiyorlar. Kanıt, B1/B2 mutasyonlarının kırılmasıdır — koruma sökülünce
testler kırmızıya dönüyor, yani koruma yük taşıyor.

Bu bilinçli bir tercihtir: sayacı "Form.Control'ü affetme" hâline getirmek,
göç eden her doğru yazımı borç saymak demekti (kontrol gerçekten adlandırılmış
olsa bile) ve metrik hiç düşmezdi.

---

## Görev 2 — Ölçüm tabanı göçle çökmesin (P1-2)

### Yeniden ürettim mi

Evet. `kontrolToplam >= 140` yanlış-yeşil koruması, ölçülen değer 143 iken
marj **3** bırakıyordu ve sayaç ham `input`/`select`/`textarea` etiketlerini
sayıyor — göçün tanımı gereği bu etiketler sarmalayıcılara dönüşecek.
`AdminStore.tsx` tek başına (26 adsız kontrol, toplam kontrolün büyük kısmı)
göç etse taban 140'ın altına iner ve CI **ilerleme yüzünden** kırılırdı.

### Nasıl düzelttim

Taban artık **sayıyla değil kimlikle** doğrulanıyor: `sayim()` ölçtüğü dosya
listesini de döndürüyor (`dosyalar`), nöbetçi bunu `uiBaseline.test.ts`'teki
isimle sabitlenmiş **71 dosyalık `OLCUM_TABANI` listesiyle** karşılaştırıyor
(overlay listesinde zaten yapıldığı gibi). `kontrolToplam >= 140` ve
`files >= 60` korumaları **kaldırıldı**.

Dosya kümesi değişirse test kırılır ve bu doğru davranıştır: dosya eklendi,
silindi veya taşındı demektir; liste bilinçli güncellenmelidir.

### "Sayaç bozulursa sessizce geçer" ağı nereye gitti

Eski `kontrolToplam >= 140` iki iş yapıyordu: (a) taban çökmesini tutmak,
(b) sayacın kontrol tarayıcısı bozulursa uyarmak. (a) dosya listesine geçti;
(b) zaten **`sayim.test.ts`**'in işiydi — aleti sentetik kaynaklarla ölçüyor.
Mutasyon **A8** bunu kanıtlıyor: kontrol tarayıcısı susturulunca
(`if (false && KONTROL_ETIKETLERI.has(ad))`) nöbetçi kümesi kırılıyor —
yakalayan `sayim.test.ts`'in ters provası.

### Kanıt

Mutasyon **A7**: `EK_TABAN_DOSYALARI`'ndan `DeliveryDriver.tsx` düşürüldü
(yani "ekranı taban dışına taşıyarak eşiği düşürme" saldırısı) → sayılar
düşmesine rağmen **"ölçüm tabanı dosya listesi SABİTTİR"** testi kırıldı.

---

## Görev 3 — Ölçüm tabanını genişlet (P1-4)

Altı ekran tabana eklendi (`EK_TABAN_DOSYALARI`, `ui-baseline-sayim.mjs`):

```
src/pages/DeliveryDriver.tsx
src/pages/DeliveryRunHandover.tsx
src/pages/dashboards/CourierHome.tsx
src/pages/dashboards/OperatorHome.tsx
src/pages/dashboards/OperatorLibrary.tsx
src/pages/dashboards/OperatorSessions.tsx
```

### Eski / yeni eşik tablosu

| Ölçüm | İP-A3a tabanı (65 dosya) | İP-A3c tabanı (71 dosya) | Fark | Farkın kaynağı |
|---|---|---|---|---|
| ölçüm tabanı dosya sayısı | 65 | **71** | +6 | taban genişlemesi |
| ham `<button` | 126 | **160** | +34 | **tamamı** taban genişlemesi (denetimin saydığı 34 ile birebir) |
| adsız form kontrolü | 41 | **56** | +15 | **tamamı** taban genişlemesi (denetimin saydığı 15 ile birebir) |
| ölçülen kontrol toplamı | 143 | 167 | +24 | taban genişlemesi (artık eşik değil, teşhis) |
| etiketsiz overlay | 5 | **5** | 0 | yeni dosyalarda etiketsiz overlay yok |
| `ui2/` dışı Medusa importu | 0 | **0** | 0 | — |

**Artış bir regresyon değil, gizli borcun görünür olmasıdır.** Pilot ekranın
(`DamageDialog`) kendi değişiklikleri hiçbir sayıyı artırmadı; `+34/+15`'in
tamamı zaten var olan ve ölçülmeyen borçtur.

Yeni görünen borcun dağılımı: `OperatorLibrary` 7, `DeliveryDriver` 4,
`OperatorHome` 3, `OperatorSessions` 1 (`CourierHome` ve `DeliveryRunHandover`
adsız kontrol taşımıyor).

Görev 2'nin isimle sabitlenen listesi bu altı dosyayı da kapsıyor.

---

## Görev 4 — Gönder kapısı kaldırıldı (P2-8 · ürün kararı)

### Ne değişti

`DamageDialog`'da:

- Senkron `damageFormSchema(kind).safeParse(degerler)` **kapısı kaldırıldı**;
  `gonderilebilir` yok. Gönder düğmesi geçerlilik nedeniyle **hiç kapanmıyor**;
  yalnız `isPending` sürerken kapanıyor (çift gönderim koruması).
- `eksikIpucu` gri satırı ve `data-testid="damage-eksik-ipucu"` **silindi**.
- Basılınca form geçersizse `handleSubmit` `onGecerli`'yi çağırmıyor →
  **gönderim yapılmıyor**; hatalar alanların altında beliriyor.
- **Odak ilk hatalı alana taşınıyor** (`ilkHatayaOdaklan`, görsel sıra:
  `urunId → miktar → kova → neden → aciklama`).
- İmha onay kutusu da aynı desene geçti: düğme kapanmıyor, basılınca kutucuğun
  altında `role="alert"` hata beliriyor ve odak kutucuğa taşınıyor.
- `gonderildiRef` çift-gönderim kilidi **silindi** (P3-6). `setTimeout(…, 0)`
  kilidi bir sonraki makro-görevde açıyordu; iki ayrı tıklama zaten iki ayrı
  görevdir. Gerçek koruma `Button`'ın `disabled={disabled || isPending}`'inden
  geliyor. Yanlış güven veren kod kaldı­rılmadı, **silindi**.

Böylece iki doğruluk kaynağı sorunu yönetilmedi, **yok edildi**: geçerliliğin
tek kaynağı artık `zodResolver`.

### Yol boyunca bulunan ÜRETİM KUSURU (denetimde yok)

"Odak ilk hatalı alana taşınsın" gereğini yazınca test kırmızı kaldı ve sebep
pilotun kendisi değildi:

> **`useModalA11y` odak/kaydırma etkisini `onClose` bağımlılığıyla kuruyor
> (`src/hooks/useModalA11y.ts:104`). `Dialog`'a her render'da yeni bir ok
> fonksiyonu verilirse etki HER RENDER'DA yeniden koşuyor ve odağı panelin ilk
> odaklanabilir öğesine (kapatma düğmesi) geri alıyor.**

Ölçüldü: gönderim sonrası odak `input[type=search]`'e taşınıyor, sonraki
render'da kapatma düğmesine dönüyor. Bu, `useModalA11y` kullanan **her**
pencerede geçerli bir kusurdur (kullanıcı yazarken bile odak kayabilir).

Ortak hook'u düzeltmek bu paketin dosya kapsamı dışında (bitiş kontrolü:
`DamageDialog`, `DamageEventsPage`, `ui2/` dışında ekran dosyası değişmez), bu
yüzden **pilotta kimlik sabitlendi**: güncel işleyici bir `ref`te yaşıyor,
`Dialog`'a verilen fonksiyon değişmiyor. **Teknik borç olarak raporlanıyor**
(aşağıda).

### Kabul testleri — hangisi neden güncellendi

Her biri ayrı ayrı sınıflandırıldı. **Hiçbir "geçersiz veri sunucuya gitmez"
iddiası zayıflatılmadı**; hepsi korundu ve çoğu güçlendirildi.

| Test | Dosya | Ne diyordu | Karar | Neden |
|---|---|---|---|---|
| `M10 — alan hataları genel/toast kanalına GİTMEZ` | `DamageDialog.test.tsx` | "ekrandaki tek `alert`" | **güncellendi** | O sayı kapının **artığıydı**: düğme kapalı olduğu için tıklama gönderimi hiç başlatmıyor, yalnız dokunulan alan hata gösteriyordu. Kapı kalkınca tıklama tüm eksikleri açığa çıkarır. Asıl iddia korundu ve güçlendirildi: alert'lerin **hiçbiri** genel kanalda değil, hepsi bir `[data-form-slot]` içinde |
| `tedarikçi iadesinde kaynak kova zorunlu kalır ve eksik OLDUĞU SÖYLENİR` | `DamageDialog.test.tsx` | (a) kova seçilmeden gönderilemez (b) düğme **disabled** + gri ipucu | **güncellendi** (adı da değişti) | (a) **korundu**: tıklanıyor, `onSubmit` çağrılmıyor. (b) bilinçli olarak yanlış hâle geldi: düğme artık açık, hata alanın altında, **odak kovaya taşınıyor** (yeni iddia) |
| `eksik ipucu, alanında zaten kırmızı görünen hatayı TEKRAR ETMEZ` | `DamageDialog.test.tsx` | `eksikIpucu`'nun içeriği | **kaldırıldı, yerine yenisi** | Testin konusu olan mekanizma silindi. Yerine `gönder'e basınca eksiklerin HEPSİ kendi alanının altında görünür` geldi — `eksikIpucu`'nun işini devralan davranışı ölçüyor (ve odak kontrolünü de içeriyor) |
| — | `DamageDialog.test.tsx` | — | **eklendi** | `imha onayı işaretlenmeden gönderilmez: düğme açık, hata kutucukta` — onay kutusu kapısının yeni karşılığı |
| `21 · imha → geri dönüşsüz olduğu için güçlü onay ister` | `inventoryScreens.acceptance.test.tsx` | düğme **disabled** | **güncellendi** | Korunan asıl iddia: onay olmadan **POST atılmıyor** (`istekler.some(post) === false`) ve kullanıcı nedenini görüyor |
| `22 · tedarikçi iadesi → kaynak kova seçilmeden gönderilemez` | `inventoryScreens.acceptance.test.tsx` | düğme **disabled** | **güncellendi** | Aynı: tıklanıyor, `aria-invalid` beliriyor, **POST yok**; sonra kova seçilip gövdede `bucket` gittiği doğrulanıyor (bu kısım aynen duruyor) |
| `24 · DIGER gerekçesi → açıklama boşken gönderim kapalı` | `inventoryScreens.acceptance.test.tsx` | düğme **disabled** | **güncellendi** | Aynı gerekçe; gövde doğrulaması aynen duruyor |

Değişmeyen ve kendiliğinden geçmeye devam eden kabul testleri arasında
idempotency anahtarının ömrü (25b), replay (25), 409/ledger davranışı ve
dijital ürün engeli var — kapı kalkması bunların hiçbirini etkilemedi.

### Kanıt

Mutasyon **B10**: `handleSubmit` sarmalayıcısı, doğrulamayı atlayıp
`onGecerli`'yi doğrudan çağıracak şekilde değiştirildi (yani "geçersiz veri
sunucuya gider") → pilot testleri kırıldı. Kapı kalktıktan sonra bu garantiyi
taşıyan tek ip `handleSubmit`; mutasyon o ipi kesiyor ve nöbetçi tutuyor.

Mutasyon **B9**: `ilkHatayaOdaklan` çağrısı söküldü → odak testleri kırıldı.

---

## Görev 5 — `Form.*` sessiz veri kayıpları (P2-3, P2-4)

### 5a — `aria-describedby` ezilmesi

**Yeniden ürettim:** `<input aria-describedby="para-birimi" />` sarıldığında
öznitelik `undefined` ile eziliyor ve **siliniyordu** (denetim kanıtı D1b).

**Düzeltme:** slotun düğümü ile çocuğun kendi düğüm(ler)i **birleştiriliyor**;
slotunki önce, çünkü ekran okuyucu sırayla okur ve hata mesajı ilk duyulmalı.

**`id`:** çocuğun kendi `id`'si **korunamıyor** — `Form.Label`'ın `htmlFor`'u
bağlamdaki id'yi gösterir, çocuğun id'sine saygı göstermek etiket bağını
koparırdı. Bu yüzden id'nin sahibi `Form.Item`'dır ve **sessiz kalmıyor**:
geliştirmede `console.error` çocuğun id'sini, bağlamın id'sini ve
`document.getElementById` ile arayan kodun kırılacağını yazıyor.

**Kanıt:** K5 (birleşme, `["slot-id", "para-birimi"]`) ve K5b (kendi id'si
bildiriliyor). Mutasyon **B4**: birleştirme sökülünce K5 kırıldı.

### 5b — Slot tespiti yalnız doğrudan çocukta

**Yeniden ürettim:** Fragment içindeki `Form.Hint` slota girmiyordu; üst bölüme
düşüyor, slot boş kalıyor ve `hintVar` false olduğu için `aria-describedby`
**hiç kurulmuyordu** (denetim D2b/D2c).

**Seçilen yol ve gerekçesi — iki farklı karar:**

- **Fragment → içine GİRİLİR** (`slotAyikla` özyinelemeli). Gerekçe: Fragment'ın
  DOM karşılığı yoktur; içinden bir çocuğu çıkarıp slota taşımak **görünen
  yerleşimi değiştirmez**. Fragment kalan çocuklarıyla yeniden kurulur.
- **Başka bir eleman (`<div>` vb.) → GİRİLMEZ, geliştirmede `throw`.**
  Gerekçe: bir `<div>`in DOM karşılığı vardır; çocuğunu slota taşımak
  kullanıcının yazdığı düzeni **sessizce bozardı**. Orada doğru davranış taşımak
  değil, geliştiricinin haberdar olmasıdır.

**Kanıt:** K6 (Fragment içindeki Hint slota giriyor ve `aria-describedby`
kuruluyor), K7 (`<div>` içine gömülü Hint → `throw`). Mutasyonlar **B5** ve
**B6** ikisini de kırdı.

---

## Görev 6 — Bekçinin üç açığı (P2-1, P2-2, P2-9)

### 6a — Öksüz onay penceresi (P2-1)

**Yeniden ürettim:** onay penceresi açıkken bileşen `unmount` edilince pencere
`document.body`'de kalıyor (denetim B2: `alertdialog` sayısı 1). Bu bir test
hijyeni sorunu değil, **üretim yolu**: ebeveyn `kind`'ı null yaparsa, WS push'u
gelirse, query invalidate olursa ya da rota değişirse. Radix modal olduğu için
arkadaki sayfayı `pointer-events` ile de kilitliyor.

**Düzeltme:** `useKirliFormBekcisi`'ye temizlik `useEffect`'i. Medusa'nın
oluşturduğu köke referansımız yok (içinde kapalı), ama pencerenin kendi ESC
dinleyicisi `document` üzerinde ve `onCancel`'a bağlı — yani sözü çözen, kökü
söken ve `pointer-events`i geri veren **gerçek yol**. Temizlik onu tetikliyor;
kapatma pencerenin kendi mekanizmasıyla oluyor. Ayrıca söz çözüldüğünde bileşen
sökülmüşse bayat closure'daki `onClose` **çağrılmıyor**.

**Kanıt:** yeni test **M8** — unmount sonrası `alertdialog` yok **ve**
`document.body.style.pointerEvents !== "none"`. Mutasyon **B7**: temizlik
söküldü → M8 kırıldı.

### 6b — Gönderim sonrası yazılan veri (P2-2)

**Yeniden ürettim:** `isSubmitSuccessful` bir sonraki `handleSubmit`/`reset()`'e
kadar `true` kaldığı için, başarılı gönderimden sonra yazılan her şey korumasız
(denetim B4b).

**Düzeltme:** "kaydedildi" damgası artık **gönderim anındaki veriye** ait.
Başarı anındaki değerler (`useWatch` + `JSON.stringify`) damgalanıyor; değerler
damgadan saparsa koruma geri geliyor. Damga **render sırasında** kuruluyor —
`useEffect` bir tik geç çalışır ve o tikte kapatılan pencere korumasız kalırdı.

**Kanıt:** **M9** (gönderim sonrası yeniden yazınca `korumali` true'ya dönüyor
ve kapatmada onay soruluyor) + **M9b TERS PROVA** (veri değişmediyse koruma geri
gelmiyor — yani "gönderimden sonra hep koru" gibi bir aşırı düzeltme M5'i
sessizce iptal etseydi yakalanırdı). Mutasyon **B8**: damga karşılaştırması
söküldü → M9 kırıldı.

### 6c — Ebeveyn kapatması (P2-9)

**Kapatılamadı — bilinen sınır olarak yazıldı.** Gerekçe: bir hook, ebeveynin
`setState` çağrısını engelleyemez; durum ebeveynde yaşar ve React'te render
sonucu geri alınamaz. Kapatmanın tek yolu pencere durumunu da bu katmana
taşımaktı; bu, göç edecek elli ekranın pencere yönetimini yeniden yazmak
demektir ve paket kapsamı dışıdır.

Yapılan: `kirliFormBekcisi.tsx`'in başlığında **"Bilinen sınırlar"** bölümü
açıldı; rota gezinmesinin yanına ebeveyn kapatması da yazıldı, gerekçesiyle ve
"bu arada ne yapılmalı" yönergesiyle (pencereyi kapatan her yol
`kapatmayiDene`den geçmeli). Ayrıca **davranış testiyle sabitlendi**
(`BİLİNEN SINIR — ebeveyn kendi kapatırsa onay SORULMAZ`) — sessizce kapanıp
"bekçi her yolu tutuyor" izlenimi vermesin diye.

---

## Görev 7 — Zorunlu `sunucuHatasi` (P1-3)

`sunucuHatasi = null` varsayılanı kaldırıldı; parametre **zorunlu**. Hata takibi
olmayan çağrı yeri niyetini açıkça yazar:

```ts
import { HATA_TAKIBI_YOK, useKirliFormBekcisi } from "…/kirliFormBekcisi";
useKirliFormBekcisi({ form, sunucuHatasi: HATA_TAKIBI_YOK });
```

Sabit `grep`lenebilir. Naif bir uygulama onu "sunucu hatası var" sanıp formu
asla kaydedilmiş saymazdı; bu yüzden özel olarak ayıklanıyor ve **M10** testi
bunu sabitliyor (`HATA_TAKIBI_YOK` ile `korumali === false`).

Kanıt: `tsc` artık parametresiz çağrıyı reddediyor (tip zorunlu `unknown`),
`npm run build` ve tam suite yeşil.

---

## Görev 8 — Test yalıtımı (P2-6, P2-7)

### 8a — `zodTurkce.test.ts` M7 sıraya bağlılığı

**Yeniden ürettim ve kök nedeni buldum.** Denetim mekanizmayı doğru teşhis
etmişti (paylaşılan `zod` global durumu) ama bir ayrıntı önemli:

> **`vi.resetModules()` tek başına YETMİYOR.** `resetModules` yalnız inline
> edilmiş (kaynak ağacı) modülleri temizler; `zod` dışsallaştırılmış bir
> bağımlılıktır, Node'un ESM önbelleğinde kalır ve önceki yapılandırmasıyla
> gelir. Bunu denedim ve düşen bir testle ölçtüm.

Deterministik kanıt (geçici bir dosyayla, aynı süreçte):

```
0 — başka bir dosya form.tsx'i yükledi (sızıntı kurulur)   ✓
1 — ESKİ M7 gövdesi bu sırada DÜŞER                        ✓  (assertion throw ediyor)
2 — YENİ M7 gövdesi aynı sırada GEÇER                      ✓
```

**Düzeltme:** test artık başlangıç durumunu **varsaymıyor, kendisi kuruyor**:
`z.config(z.locales.en())` ile ölçülebilir bir zemin kurulur, `resetModules` ile
`form.tsx` yeniden değerlendirilmeye zorlanır, mesajın Türkçeye döndüğü
gösterilir. Değişimi yapanın `form.tsx` olduğu bu sırayla kanıtlanır.

**Yalancı yeşil yönü de kapatıldı:** M7b'ye ters prova eklendi — önce
İngilizce olduğu **gösteriliyor**, sonra katman yükleniyor. Eski hâlde M7b
yalnız "Türkçe" diyordu ve Türkçeyi kimin kurduğunu ayırt etmiyordu.

`afterEach` Türkçeyi geri kuruyor: dosya, paylaşılan durumu kendinden önceki
hâline döndürmeden bırakırsa sızıntıyı ters yöne çevirmiş olurdu.

**Kanıt:** dört seed (20260819, 1, 2, 3) ile `--sequence.shuffle` → **hepsi
1091/1091 yeşil**.

### `ticketsPaymentGate` ve `storeVariants` — raporlanıyor, düzeltilmedi

Prompt gereği bunlara dokunulmadı. **Dürüst not: bu koşumda ikisi de
düşmedi.** Denetimin düştüğünü bildirdiği seed'ler (20260819 ve 2) dahil dört
seed de tamamen yeşil geçti. İki olasılık var ve hangisi olduğunu
kanıtlayamadım:

1. Bu paketin `zodTurkce` düzeltmesi işçi süreçlerdeki modül yükleme sırasını
   değiştirdi ve düşüşleri tesadüfen maskeledi.
2. Düşüşler zamanlamaya da bağlı (bkz. hafıza notu: "CI'da düşüp yerelde geçen
   test flaky değil, zamanlama penceresi kanıtıdır") ve bu makinede bu koşumda
   pencere yakalanmadı.

**"20 kez koştum geçti" kanıt değildir** — bu iki dosya hâlâ önceden var olan
borç sayılmalı ve İP-A6/A7 öncesinde ayrıca ele alınmalıdır.

### 8b — `afterEach` temizliği

**Yeniden ürettim:** temizlik `"Vazgeç"` metin sabitine bağlıydı ve bulamazsa
**sessizce hiçbir şey yapmadan** dönüyordu (`if (!iptal) return;`). O metin
`promptTr.cancelText`'ten gelen bir **yapılandırma değeri**; "İptal" yapan biri
iki dosyadaki temizliği birden sessizce öldürürdü.

**Düzeltme:** temizlik artık (a) `[role="alertdialog"]` ile **role'e** bağlı,
(b) düğmeyi `within(...).getAllByRole("button")` ile buluyor, (c) **kapattığını
iddia ediyor** (`expect(...).toBeNull()` içinde `waitFor`). Kapanmazsa test
kırılır; "bulamadım, geçiyorum" demez.

Not: Görev 6a'nın unmount temizliği sayesinde bu `afterEach` çoğu durumda zaten
boşa çalışıyor — ama ikinci savunma hattı olarak duruyor ve artık sessiz değil.

---

## Görev 9 — Eşikler ve mutasyon provası

Tüm eşikler taban genişlemesi ve Görev 4'ten sonra yeniden ölçüldü (tablo:
Görev 3). Mutasyon sürücüsü: **`frontend/scripts/ip_a3c_mutasyon.mjs`**.

**18/18 mutasyon yakalandı.** Sürücü disiplini: ham baytlar bellekte tutulur,
`git checkout --` KULLANILMAZ, her mutasyondan sonra geri yazılır ve testin
yeşile döndüğü doğrulanır, başta/sonda `git status --porcelain` karşılaştırılır
(bu koşumda ağaç başlangıçtaki hâline döndü).

| # | Mutasyon | Yakalayan |
|---|---|---|
| A1 | ham `<button>` (JSX) | `uiBaseline` ham buton eşiği |
| A2 | **kaçış yolu**: `React.createElement("button")` | aynı eşik (yeni kapatıldı) |
| A3 | etiketsiz `<input>` | adsız kontrol eşiği |
| A4 | `ui2/` dışı `@medusajs/ui` importu | mimari kuralı |
| A5 | **kaçış yolu**: Medusa **alt yol** importu | aynı kural (yeni kapatıldı) |
| A6 | etiketsiz overlay | overlay eşiği + dosya listesi |
| A7 | tabandan bir dosyanın düşürülmesi | **ölçüm tabanı dosya listesi** |
| A8 | sayacın kontrol tarayıcısının susturulması | `sayim.test.ts` ters provası |
| B1 | `Form.Item` yok patlaması söküldü (denetim M3) | `form.test.tsx` K2 |
| B2 | Fragment çocuk patlaması söküldü (denetim M3b) | K3 |
| B3 | çalışma zamanı id ölçümü söküldü | K4 |
| B4 | `aria-describedby` yine ezildi | K5 |
| B5 | Fragment içi Hint aranmadı | K6 |
| B6 | gömülü Hint sessizce geçti | K7 |
| B7 | öksüz pencere temizliği söküldü | `kirliFormBekcisi.test.tsx` M8 |
| B8 | gönderim sonrası kirlenme koruması söküldü | M9 |
| B9 | ilk hataya odaklanma söküldü | pilot odak testleri |
| B10 | geçersiz veri sunucuya gitti | pilot gönderim testleri |

### Kapatılan kaçış yolları

- `React.createElement("button")` → **kapatıldı** (AST'te çağrı ifadesi
  taranıyor; ters prova: `createElement("div")` ve `createElement(Button)`
  sayılmıyor).
- `@medusajs/ui` **alt yol** importu → **kapatıldı** (`@medusajs/ui/` öneki;
  ters prova: `@medusajs/ui-preset` ihlal sayılmıyor).

### Kapatılamayan kaçış yolu (bilinen sınır)

- **Parçalanmış overlay sınıfı**: `clsx("fixed", "inset-0")` ya da
  `"inset-0 fixed"` sırası sayaçtan kaçar. Kapatmak, string parçalarını çağrı
  ifadesi ölçeğinde birleştirip sıra bağımsız eşlemek demekti; bu, `"fixed"`
  veya `"inset-0"` geçen her sınıf dizesini aday yapar ve **yanlış pozitif**
  üretme riski gerçek borcu görmezden gelme riskinden büyük görünüyor. Bugün
  kod tabanında bu yazım yok. **Bilinen sınır olarak bırakıldı.**

---

## Kapatamadığım / kapsam dışı bıraktığım bulgular

| Bulgu | Durum | Gerekçe |
|---|---|---|
| **P2-9** ebeveyn kapatması | **belgelendi + testle sabitlendi** | Hook ebeveynin `setState`ini engelleyemez; kapatmak elli ekranın pencere yönetimini yeniden yazmayı gerektirir (Görev 6c) |
| **P2-6** `ticketsPaymentGate` / `storeVariants` sıra bağımlılığı | **raporlandı, düzeltilmedi** | Prompt gereği kapsam dışı; ayrıca bu koşumda üretilemedi (yukarıda) |
| **P3-1** parçalanmış overlay sınıfı | **bilinen sınır** | Yanlış pozitif riski (yukarıda) |
| **P3-2** yinelenen `id` sayaçta görünmüyor | dokunulmadı | Denetim de latent risk demişti; bugün ölçüm tabanında yinelenen id yok |
| **P3-3** `.duration-*`/`.ease-*` `animation-*` de yazıyor | dokunulmadı | A1'in kapsamı; nöbetçisi yok, denetimin yargısına katılıyorum |
| **P3-4** type-only Medusa importu ihlal sayılıyor | dokunulmadı | Kural yazıldığından katı; ama gevşetmek `import type` ile başlayıp normal importa kayan bir yol açar. Bilinçli tercih olarak **burada yazıldı** |
| **P3-5** sonda artıkları (`*-probe.html`, `src/__probe__/`) | dokunulmadı | Bu paketin görev listesinde yok; `dist/`e girmiyorlar. Bir sonraki pakette silinmeli |
| **`useModalA11y` odak sıfırlaması** (YENİ, denetimde yok) | pilotta çözüldü, ortak hook'ta **açık** | Ekran dosyası kapsamı dışında (aşağıda) |

## Teknik borç (yeni)

**TB-A3c-1 · `useModalA11y` her render'da odağı sıfırlıyor.**
`src/hooks/useModalA11y.ts:104` — etki `onClose` bağımlılığıyla kurulmuş.
Çağıran taraf `onClose`u satır içi ok fonksiyonu olarak verirse (panelde yaygın
desen) etki her render'da yeniden koşar; odak panelin ilk odaklanabilir öğesine
döner ve `body.style.overflow` gereksiz yere yeniden kurulur. Ölçüldü
(İP-A3c · Görev 4). Doğru düzeltme hook'un içinde: `onClose`u bir `ref`te
tutup etkinin bağımlılığından çıkarmak. Pilotta geçici olarak çağıran tarafta
sabitlendi.

**TB-A3c-2 · Sonda artıkları depoda.** `frontend/damage-probe.html`,
`frontend/form-probe.html`, `src/__probe__/*` (denetim P3-5). `tsc` kapsamında
ve `allSource()` taramasına dahiller.

---

## Bitiş kontrolü

- [x] `Form.Control` üç kör noktada da sessiz değil; çalışma zamanı adlandırma testi var (K1–K4)
- [x] Denetçinin M3/M3b mutasyonları artık yakalanıyor (B1/B2, önce/sonra kanıtıyla; sınırı yukarıda dürüstçe yazıldı)
- [x] Ölçüm tabanı isimle sabitlendi (`OLCUM_TABANI`, 71 dosya), göç onu kıramaz
- [x] Taban genişletildi (Operator/Courier/Delivery), eşikler yeni gerçek değerlerde (160 / 56 / 5)
- [x] Gönder kapısı kaldırıldı; geçersiz veri hâlâ sunucuya gitmiyor; odak ilk hatalı alana taşınıyor
- [x] `gonderildiRef` silindi
- [x] `aria-describedby` birleşiyor, ezilmiyor; sarmalanmış Hint sessizce kaybolmuyor
- [x] Bekçi: öksüz kök temizleniyor, gönderim sonrası yeniden kirlenme korunuyor, ebeveyn kapatması belgelendi + testle sabitlendi
- [x] `sunucuHatasi` zorunlu (`HATA_TAKIBI_YOK` ile açık niyet)
- [x] Shuffle ile kapsam içi dosya sıraya bağlı değil; `afterEach` kapattığını doğruluyor
- [x] Tüm eşikler mutasyonla kırıldı (18/18), çalışma ağacı temiz
- [x] Denetim raporu `docs/denetim-a1-a3a.md` altında ve commit'te
- [x] `DamageDialog`, `DamageEventsPage` ve `ui2/` dışında ekran dosyası değişmedi
      (değişenler: `DamageDialog.tsx` + `ui2/*` + nöbetçi/sayaç/test dosyaları;
      `DamageEventsPage.tsx`'e bu pakette dokunulmadı)
