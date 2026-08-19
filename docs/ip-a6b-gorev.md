# İP-A6b — Ölçüm onarımı (görev tanımı)

**Taban:** `8ce1dda` (İP-A6)
**Denetim:** `docs/denetim2-a4-a6.md` → BULGU-1, BULGU-2, BULGU-3, BULGU-10
**Bir sonraki paket:** İP-A6c (sözleşme onarımı) — bu paketin kapsamı dışında

---

## Kural: bu pakette DAVRANIŞ DEĞİŞMEZ

Dokunulacak yerler yalnızca:

- `frontend/scripts/ui-baseline-sayim.mjs`
- `frontend/src/__guards__/**`
- `frontend/src/test-setup.ts`
- yeni test dosyaları
- `docs/**`

Bir ekran, bir `ui2/` bileşeni ya da bir hook değişirse paket kapsamını aşmış
demektir — **dur ve sor.**

**Sebep.** Bu paket dört ölçümün tabanını birden oynatacak. Aynı commit'te
borç da kapatılırsa, sayının neden değiştiği bir daha ayırt edilemez; ve iki
kez yeniden tabanlamak bir kez yeniden tabanlamaktan kötüdür. Alet önce,
davranış (İP-A6c) sonra.

---

## Kurulum

> **Adım 0 gerçekten ilk sırada.** Denetim raporu detached HEAD'de commit
> edilmemiş duruyor; `git checkout` yapan herhangi bir komut onu düşürebilir.
> Ayrıca İP-A6c'nin dört kırmızı testinin (T3/T4/T6/T7) kaynağı **yalnız o
> dosyanın kanıt bloklarında** yaşıyor — denetim temizliğinde sondalar silindi.

```powershell
# 0) Raporu kurtar (denetim worktree'sinde, detached HEAD)
cd C:/Users/kiyar/Desktop/adana-medusa-ui-denetim2
git status --porcelain
git checkout -b docs/denetim2-a4-a6
git add docs/denetim2-a4-a6.md docs/ip-a6b-gorev.md
git commit -m "docs: bagimsiz denetim #2 (IP-A4/A5/A6) + A6b gorev tanimi"

# 1) Worktree — MUTLAK yol, bir git deposunun içinden
cd C:/Users/kiyar/Desktop/adana-main
git worktree add -b feat/ip-a6b-olcum C:/Users/kiyar/Desktop/adana-a6b 8ce1dda

# 2) Rapor 8ce1dda'da yok; worktree'ye getir ve hemen commit'le
cd C:/Users/kiyar/Desktop/adana-a6b
git checkout docs/denetim2-a4-a6 -- docs/denetim2-a4-a6.md docs/ip-a6b-gorev.md
git commit -m "docs: denetim raporunu A6b tabanina getir"

# 3) Kurulum
cd frontend
npm ci
```

**`.env` GEREKMİYOR.** Bu paket backend'e çıkmıyor. Denetim bu worktree'de
`.env` olmadan `npm ci` + `tsc --noEmit` + `vitest run` + `npm run build`
koşturdu ve dördü de geçti. (`adana-main/frontend/.env` zaten yok;
`frontend/.env.example` gerekirse duruyor. Eski Medusa dalından `.env`
kopyalamayın.)

---

## Görev 0 — Kapıyı ve BUGÜNKÜ tabanı kendin ölç, yaz

```
npx tsc --noEmit
npm run build
npx vitest run
npx vitest run --sequence.shuffle --sequence.seed=<S>     # en az 4 seed
```

Beklenen: **117 dosya / 1183 test** yeşil, dört seedde de.

Sonra bugünkü beş sayıyı kaydet — bunlar onarımdan **önceki** referans ve
Görev 6 tablosunun "önce" kolonu olacak:

| Ölçüm | Bugün |
|---|---|
| ham `<button` | 131 |
| adsız form kontrolü | 30 |
| ekranda yaşayan pencere durumu | 29 |
| etiketsiz overlay | 4 |
| `ui2/` dışı Medusa importu | 0 |

---

## Görev 1 — Üç kaçış mutasyonunu KALICI regresyon testine çevir (negatifleriyle)

Üçü de denetimde koşturuldu ve bugünkü nöbetçilerden **sessizce geçti**.
**Önce testleri yaz, kırmızı olduklarını göster, sonra onarıma başla.**

Her mutasyonun bir **negatif kontrolü** olmak zorunda. Sebep: pozitif kontrol
tek başına "sayaç artık render edileni sayıyor" ile "sayaç artık her fabrikada
patlıyor" arasını ayırt edemez. Onarım kör bir çekiç olabilir ve bu ancak
A7'de 21 ekranda yanlış alarm alınca görülür.

### M-A · Fabrika körlüğü (BULGU-1)

Ölçülen bir dosyaya on iki çağrılı, tek yazımlık, **adsız** alan fabrikası
eklenir; aynı dosyada mevcut bir borç `aria-label` ile kapatılır (net +11
gerçek borç, sayaçta net 0):

```tsx
function DenetimAlan({ deger }: { deger: string }) {
  return <input className="input" defaultValue={deger} />;
}

export function DenetimBlok() {
  return (
    <div>
      {["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"].map((x) => (
        <DenetimAlan key={x} deger={x} />
      ))}
    </div>
  );
}
```

- **Bugünkü sonuç:** sayaç `adsizKontrol` **30'da kalıyor**, `src/__guards__`
  39/39 yeşil.
- **Çalışma zamanı** (`dom-accessibility-api::computeAccessibleName`):
  **12 adsız kontrol**.
- **Onarımdan sonra beklenen:** KIRMIZI.

### M-A⁻ · Negatif kontrol

Aynı on iki çağrılı fabrika, ama kontrol **adlandırılmış**:

```tsx
function DenetimAlan({ deger }: { deger: string }) {
  return <input className="input" aria-label={deger} defaultValue={deger} />;
}
```

- **Onarımdan sonra beklenen:** YEŞİL. Sayı artmamalı. Fabrika deseninin
  kendisi cezalandırılmıyor; **adsızlık** cezalandırılıyor.

### M-B · Dizin kaçışı (BULGU-2)

`src/lib/denetim2Kacak.tsx` — 3 ham `<button>`, 3 adsız kontrol, 1
`fixed inset-0` overlay (`role="dialog"`/`aria-modal` YOK).

- **Bugünkü sonuç:** 39/39 yeşil.
- **Onarımdan sonra beklenen:** KIRMIZI.

### M-B⁻ · Negatif kontrol

**Aynı dosya** `src/components/admin/` altına konur.

- **Bugünkü sonuç:** zaten yakalanıyor —
  `FAIL panel ağacındaki her dosya listede yazılıdır` →
  `expected [ Array(1) ] to deeply equal []`.
- **Onarımdan sonra beklenen:** yine KIRMIZI, **aynı** nedenle. Bu, yakalamanın
  dizin şansına değil kurala bağlı olduğunu gösterir.

### M-C · Prop olarak inen pencere durumu (BULGU-3)

```tsx
function DenetimCocuk({ acik }: { acik: boolean }) {
  return <ConfirmDialog open={acik} title="x" description="y"
                        onClose={() => {}} onConfirm={() => {}} />;
}

export function DenetimUst() {
  const [acik, setAcik] = useState(false);
  return (
    <div>
      <span onClick={() => setAcik(true)}>ac</span>
      <DenetimCocuk acik={acik} />
    </div>
  );
}
```

> Tetikleyici **`<span>`** — `<button>` yazarsanız ham buton eşiği kırılır ve
> düşen testi yanlış nedene bağlarsınız (denetimde bir tur böyle kaybedildi).

- **Bugünkü sonuç:** `modalDurumu` **29'da kalıyor**, 39/39 yeşil.
- **Onarımdan sonra beklenen:** KIRMIZI.

### M-C⁻ · Negatif kontrol

Prop olarak inen ama **pencereye verilmeyen** bir boolean:

```tsx
function DenetimRozet({ aktif }: { aktif: boolean }) {
  return <span>{aktif ? "açık" : "kapalı"}</span>;
}
```

- **Onarımdan sonra beklenen:** YEŞİL. Pencere durumu artmamalı. Her prop
  değil, **pencereye verilen durum** sayılmalı.

### Mutasyon sürücüsü kuralı (kök CLAUDE.md §D)

`git checkout --` **KULLANMA** — bu kural bir kez ihlal edildi ve commit
edilmemiş bir üretim düzeltmesi silindi. Ham baytları bellekte tut,
`git status --porcelain`'i başta ve sonda karşılaştır, satır sonundan bağımsız
eşleştir (**bu depodaki dosyalar CRLF** — İP-A6'nın R7 dersi; desen eşleşmezse
mutasyon uygulanmadan "yakalanmadı" diye okunur).

---

## Görev 2 — BULGU-1: eşiğin doğruluk kaynağı sayaç olmaktan çıkar

Sayaç kaynak **yazımı** sayıyor; kullanıcı **render edilen** kontrolü görüyor.
Bu bugün üretimde de böyle:

- `ProductForm.tsx` → `KunyeAlani` tek yazım, **dokuz** çağrı yeri (satır 571-579)
- 158 yazımın **7'si** bir `.map()` içinde: `AdminAccessPage:161,205` ·
  `DeliveryOrdersPage:299` · `PackagesPage:298` ·
  `OperatorLibrary:565,581,588` — son ikisi zaten "adsız" listesinde

"Adsız kontrol ≤ N" kapısı **çalışma zamanı sayısına** bağlanmalı. Dal testi
(`adlarDogru(enAz)`, `test-utils/alanAdlari`) zaten render edilen kontrolü
sayıyor; kapı ona devredilmeli. Sayaç teşhis aleti olarak kalsın ve **gerçeği
söylemeyi bıraktığı yer dosyanın başında yazılsın.**

### Gizli tuzak: kapı fixture şekilli daralabilir

Dal testi yalnız **render edilebilen** ekranları kapsar. 82 dosyanın hepsi
fixture'la render edilemiyorsa kapı sessizce o alt kümeye daralır — ve dizin
şekilli sınır, fixture şekilli sınırla değiştirilmiş olur. Bu, BULGU-2'nin
aynısıdır, başka kapıdan.

**Zorunlu:** çalışma zamanı kapısının kapsadığı ekran kümesi **isimle listelenmeli**
ve **iki yönlü** korunmalı:

- `OLCUM_TABANI`'nda olup kapı kümesinde olmayan dosya → **KIRMIZI**
- kapı kümesinde olup `OLCUM_TABANI`'nda olmayan dosya → **KIRMIZI**

Kapının kapsayamadığı dosya varsa **sayısı ve dosya başına gerekçesi** rapora
yazılsın ("bu ekran X olmadan render edilemiyor"). Sessiz daralma yasak.

### CI süresi

Render eden kapı bugünkü AST kapısından yavaş olacak. `src/__guards__`
koşumunun **önce/sonra** süresini ve tam suite süresini rapora koy.
(Bugünkü referans: tam suite ~110 s, `src/__guards__` ~0,1 s.)

### Kabul ölçütü

M-A **KIRMIZI**, M-A⁻ **YEŞİL**, kapı kümesi iki yönlü korunuyor, kapsam dışı
kalan dosyalar gerekçeleriyle raporda.

---

## Görev 3 — BULGU-2: dizin yürüyüşü → import grafiği

`kesfedilenTaban()` bugün yalnız `components/admin/**`, `pages/admin/**`,
`dashboards/Admin*.tsx` (+ elle yazılmış `EK_TABAN_DOSYALARI`) yürüyor.
Ölçülen 82 dosyanın **doğrudan import ettiği** şu dokuz yerel bileşen
görünmüyor:

| Modül | ham `<button` | kontrol | etiketsiz overlay |
|---|---|---|---|
| `components/ExamSessionsManager.tsx` | 14 | 13 | 1 |
| `components/LibraryEditorModal.tsx` | 5 | 15 | 1 |
| `components/MapPicker.tsx` | 9 | 1 | 0 |
| `components/QrScanner.tsx` | 3 | 1 | 0 |
| `components/LibraryMediaManager.tsx` | 3 | 2 | 0 |
| `components/DashboardHeader.tsx` | 3 | 0 | 0 |
| `components/DashboardShell.tsx` | 2 | 0 | 0 |
| `components/LibraryPayoutForm.tsx` | 1 | 5 | 0 |
| `components/LibrariesMap.tsx` | 1 | 0 | 0 |
| **TOPLAM** | **41** | **37** (8'i adsız) | **2** |

`AdminLibraries` ve `AdminExamCatalogs` **zaten** `UNLABELED_OVERLAY_FILES`
listesinde — ama o ekranların asıl düzenleme yüzeyi (`LibraryEditorModal`,
`ExamSessionsManager`) ölçüm dışında. Göç edilecek yüzeyin çoğu görünmüyor.

Taban dosyalarından ulaşılan her yerel `.tsx` ya `OLCUM_TABANI`'na girmeli ya
da `fazlaDosyalar`a düşmeli. Grafiğin nerede duracağı (yalnız `.tsx` mi,
kaç sıçrama mı) senin kararın — ama **kural yazılı olmalı**, örnek listeyle
değil.

**Kabul ölçütü:** M-B **KIRMIZI**, M-B⁻ **KIRMIZI** (aynı nedenle).

---

## Görev 4 — BULGU-3: prop olarak inen pencere durumu

İP-A5 bağ çözümünü dosya ölçekli ad eşleşmesinden sözlüksel kapsama çevirdi.
**Düzeltme doğruydu** — bölünme öncesi `AdminStore.tsx`'te üç ayrı `deleting`
bağı vardı (satır 1236 · 1441 · 2057) ve eski sayaç üçünü tek sayıyordu;
33 + 2 = 35 doğru sayıdır.

Ama yeni kör nokta açtı: durum ebeveynde yaşayıp aynı dosyadaki çocuk
bileşene **prop olarak** inerse artık sayılmıyor. İP-A4 sürümü ad eşleşmesiyle
sayardı. Çözüm ne A4'e dönmek (aynı adlı iki bağı tek sayardı) ne de bugünkü
hâl; ikisini de karşılayan bir çözüm gerekiyor.

### Sonra: saha sayımı

**Bugün kaç GERÇEK prop-ile-inen pencere durumu var, ölçülmedi.** Denetim
BULGU-3'ü sentetik mutasyonla kanıtladı; 29'un üstüne kaç ekleneceği
bilinmiyor. Onarımdan sonra çıkan sayı yeni taban olur —
**"≥30" gibi tahmini bir rakamı eşiğe yazma.**

**Kabul ölçütü:** M-C **KIRMIZI**, M-C⁻ **YEŞİL**.

---

## Görev 5 — BULGU-10: global timeout gevşetmesini cerrahileştir

`src/test-setup.ts` RTL `asyncUtilTimeout`unu global 1000 → 4000 ms yapıyor
(117 dosyanın hepsini etkiler). Denetim ölçtü: değer 1000'e döndürülünce
**projenin 1183 testinin hiçbiri düşmedi** — ama tek makine, tek koşu; bu
geliştiricinin yük-bağımlı teşhisini çürütmez.

Global ayarı kaldır; `waitFor(…, { timeout: 4000 })`'ü yalnız iki çağrı yerine
koy: **`ticketsPaymentGate`** ve **`storeVariants.acceptance`** (adları
`test-setup.ts`'in kendi yorumunda yazılı). Sonra tam suite'i **en az 3 kez**
koştur. Düşen olursa cerrahi listeyi genişlet ama **gerekçesini yaz**: hangi
test, hangi sorgu, ölçülen gerçek süre.

---

## Görev 6 — Yeni tabanı dondur

Dört eşiği ölçülen gerçek değere çek. `docs/ip-a6b-rapor.md`'de şu tablo
bulunmalı:

| Ölçüm | A6 (eski alet) | A6b (yeni alet) | Fark nereden |
|---|---|---|---|
| ham `<button` | 131 | ? | import grafiği |
| adsız form kontrolü | 30 | ? | import grafiği + çalışma zamanı birimi |
| ekranda pencere durumu | 29 | ? | prop-ile-inen durum |
| etiketsiz overlay | 4 | ? | import grafiği |

**Bu paketin tek çıktısı bu tablodur.** Sayılar yükselecek; yükselmeleri
regresyon değil, **ölçümün dürüstleşmesidir** ve rapor bunu açıkça söylemeli —
yoksa altı ay sonra "A6b'de borç patladı" diye okunur.

---

## Kapanış kapısı

1. `tsc --noEmit` temiz · `npm run build` başarılı · tam suite yeşil ·
   `--sequence.shuffle` ≥4 seed yeşil
2. **M-A, M-B, M-C üçü de KIRMIZI**; onarım geçici olarak geri alınınca üçü de
   yeşile dönüyor
3. **M-A⁻ ve M-C⁻ YEŞİL, M-B⁻ KIRMIZI** — yani onarım kör çekiç değil
4. **Kapsam:** `git diff --name-only 8ce1dda..HEAD` çıktısındaki **her yol** şu
   kümede olmalı:
   - `frontend/scripts/ui-baseline-sayim.mjs`
   - `frontend/src/__guards__/**`
   - `frontend/src/test-setup.ts`
   - yeni test dosyaları
   - `docs/**`

   Bu kümenin dışında **tek dosya** varsa kapsam ihlali — dur ve sor.
   (`-- src/` filtresi KULLANMA: sayaç `src/` altında değil, `__guards__` ise
   zaten kapsam içinde — o filtre hem sayacı kaçırır hem boş çıkamaz.)
5. Çalışma zamanı kapısının kapsadığı ekran kümesi listeli ve iki yönlü
   korunuyor; kapsanmayan dosyalar sayı + gerekçeyle raporda
6. `src/__guards__` ve tam suite süresi önce/sonra raporda
7. Yeni taban tablosu raporda; her rakamın farkı nereden geldiği yazılı
8. `git status --porcelain` temiz

---

## Kapsam dışı — dokunma

**İP-A6c (sözleşme onarımı)** — kırmızı testleri orada yazılacak:

| Bulgu | Kusur | Önerilen onarım |
|---|---|---|
| BULGU-4 | `useUrlDurumu` aynı olayda ilk yazımı yutuyor | `setParams((önceki) => …)` — tek satır |
| BULGU-5 | `DuzenlemePenceresi` ikinci korumalı içeriği eziyor | Küme DEĞİL, geliştirmede `throw` |
| BULGU-7 | `GezinmeBaglantisi` kirli yolda `state`/`replace`/`relative` düşürüyor | `navigate(to, { … })` |
| BULGU-8 | Onay beklerken hedef değişirse onay yanlış hedefe uygulanıyor | Hedef damgası, `sokulduRef`in yanına |

**A7'nin ilk paketi** — gerçek tasarım kararı gerektiriyor:
BULGU-6 (iç içe ESC → modal yığını), BULGU-9 (dizi filtresi).

> İP-A6c'nin dört kırmızı testinin (T3/T4/T6/T7) kaynağı **yalnız**
> `docs/denetim2-a4-a6.md`'nin kanıt bloklarında duruyor — denetim
> temizliğinde sondalar silindi. A6c'yi yazarken oradan yeniden kur.
