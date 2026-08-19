# İP-A6b — Ölçüm onarımı (rapor)

Taban: `8ce1dda` (İP-A6) · Dal: `feat/ip-a6b-olcum` ·
Görev tanımı: `docs/ip-a6b-gorev.md` · Denetim: `docs/denetim2-a4-a6.md`

Bu pakette **hiçbir ekran davranışı değişmedi**. Değişen tek şey ölçüm
aletinin kendisi: dört eşiğin üçü yanlış yeri ölçüyordu, biri fazla gevşekti.
Paketin tek çıktısı aşağıdaki **yeni taban tablosudur** — ve sayıların
yükselmesi regresyon değil, **ölçümün dürüstleşmesidir.**

---

## 1 · Yeni taban (Görev 6)

| Ölçüm | A6 (eski alet) | A6b (yeni alet) | Fark nereden |
|---|---|---|---|
| ham `<button` | 131 | **199** | import grafiği (+68) |
| erişilebilir adı olmayan form kontrolü | 30 | **41** | import grafiği (+11) |
| ekranda yaşayan pencere durumu | 29 | **32** | import grafiği (+2) · prop-ile-inen durum (+1) |
| `role="dialog"`/`aria-modal` taşımayan overlay | 4 | **6** | import grafiği (+2) |
| ölçüm tabanı dosya sayısı | 82 | **109** | import grafiği (+27) |
| ölçülen toplam form kontrolü (teşhis) | 158 | **193** | import grafiği |
| `ui2/` dışı Medusa importu | 0 | **0** | — |

**Yeni ölçüm (eski alette karşılığı yok):**

| Ölçüm | A6b | Ne demek |
|---|---|---|
| çalışma zamanı kapısında mount edilen ekran | **88** | 105 taban `.tsx`ten gerekçeli 17'si hariç |
| kapıda render edilen form kontrolü | **39** | kapının boşa koşmadığının kanıtı |
| kapıda **render edilen** adsız kontrol | **7** | `LibraryPayoutForm` 5 · `ImageCropModal` 1 · `MapPicker` 1 |

Artışın tamamı **bugüne kadar ölçülmeyen, zaten var olan borçtur.** Tek satır
JSX eklenmedi; `git diff --stat` bunu doğrular (kapsam → §7).

> Altı ay sonra bu dosyayı okuyan için: **"A6b'de borç patladı" YANLIŞTIR.**
> A6'da 131 diyen alet, panelin düzenleme yüzeylerinin çoğunu hiç görmüyordu.

---

## 2 · Kapı (paket sonu)

| Kapı | Öncesi (8ce1dda) | Sonrası |
|---|---|---|
| `tsc --noEmit` | temiz | **temiz** |
| `npm run build` | başarılı | **başarılı** |
| Vitest | 117 dosya / 1183 test ✅ | **121 dosya / 1206 test** ✅ |
| `--sequence.shuffle` | 4 seed (11/22/33/44) ✅ | **4 seed ✅** (aynı seed'ler) |
| Tam suite × 3 (Görev 5 sonrası) | — | **3/3 yeşil** |
| Mutasyon provası | — | **9/9 yakalandı**, ağaç bayt-bayt temiz |

Test artışı +4 dosya / +23 test: `mA.kacis` (6) · `mB.kacis` (5) ·
`mC.kacis` (6) · `calismaZamaniKapisi` (5), artı `uiBaseline`e eklenen `.ts`
ham düğme nöbetçisi (1).

### CI süresi (Görev 2'nin açıkça istediği ölçüm)

| Ölçüm | Önce | Sonra |
|---|---|---|
| `src/__guards__` — test süresi | 0,29 s (39 test) | **11,6 s** (62 test) |
| `src/__guards__` — toplam (kurulum dahil) | 9,96 s | **12,3 s** |
| tam suite | 130,4 s | 54,6 / 60,9 / 54,9 s (3 koşum) |

Nöbetçi koşumu ~11 s yavaşladı: 88 ekran gerçekten render ediliyor. Tam
suitedeki düşüş bu pakete ait bir kazanç DEĞİLDİR (makine yükü/önbellek
farkı); dürüst okuma "tam suite süresi ölçülebilir biçimde artmadı"dır.

---

## 3 · Görev 1 — üç kaçış mutasyonu artık kalıcı test

Üçü de denetimde bugünkü nöbetçilerden **sessizce geçmişti**. Önce testler
yazıldı ve kırmızı oldukları gösterildi (commit `6a5ba54`, onarım YOK):

```
M-A  Failed to resolve import "./kapiOlcumu"          (kapı ölçüm birimi yok)
M-B  TypeError: ulasilanModuller is not a function     (import grafiği yok)
M-B  expected [] to include 'denetim2Kacak.tsx'        (fazla hep boş)
M-B⁻ expected [] to include 'ui/Dialog.tsx'
M-C  expected [] to deeply equal [ 'acik' ]            (prop-ile-inen durum)
```

Sonra sırayla onarıldı: M-A → `a082069`, M-B → `17103ee`, M-C → `7e7b9d4`.

| Mutasyon | Bugün (A6 aleti) | A6b'de |
|---|---|---|
| **M-A** fabrika körlüğü | sayaç +0 dedi, 39/39 yeşil | **KIRMIZI** (adsız +11 · toplam +12) |
| **M-A⁻** adlandırılmış fabrika | — | **YEŞİL** (adsız farkı 0) |
| **M-B** dizin kaçışı | 39/39 yeşil | **KIRMIZI** (`fazlaDosyalar`) |
| **M-B⁻** panel ağacındaki aynı borç | zaten yakalanıyordu | **KIRMIZI**, aynı nedenle |
| **M-C** prop-ile-inen durum | 29'da kaldı | **KIRMIZI** |
| **M-C⁻** pencereye verilmeyen prop | — | **YEŞİL** |

M-A'nın iddiası bilinçli olarak "sayı arttı" DEĞİL, iki **tam sayısal
eşitliktir** ve ikisi ayrı doğrulanır: `adsız +11` (12 yeni − 1 kapatılan borç)
ve `toplam +12`. "≥1" eşiği 1 ile 40'ı ayırt edemezdi; iki eşitlik ayrı
olduğu için sayacın yalnız birini gören yarı-onarımı da yakalar.

Ayrıca **kalıcı BULGU kayıtları** eklendi: `mA.kacis.test.tsx`teki bir test
kaynak sayacının aynı mutasyonda **+0/+1** gördüğünü rakamla sabitler —
kapının neden çalışma zamanına devredildiğinin kanıtı testte yaşar.

---

## 4 · Görev 2 — kapı çalışma zamanına bağlandı

Sayaç kaynakta **yazılanı** sayıyor, kullanıcı **render edileni** görüyor.
Ayrım bugün üretimde de var (`ProductForm` → `KunyeAlani` tek yazım, dokuz
çağrı yeri; 7 yazım bir `.map()` içinde). Kapı iki katmanlı:

| Katman | Dosya | Kapsam | Derinlik |
|---|---|---|---|
| Derin | `adminStoreDalAdlari.acceptance.test.tsx` | mağaza yüzeyi (9 dosya) | TÜM koşullu dallar |
| Sığ | `calismaZamaniKapisi.test.tsx` | **88 ekran** | varsayılan render |

Sayaç **teşhis aleti** olarak kaldı; yalanı `scripts/ui-baseline-sayim.mjs`in
başında ve `uiBaseline.test.ts`teki eşiğin yanında rakamla yazılı.

### Kapsam sessizce daralamaz (iki yönlü koruma)

1. `OLCUM_TABANI`'ndaki her `.tsx` **ya mount edilir ya `KAPI_DISI`'nda
   gerekçesiyle yazılıdır** — üçüncü ihtimal yok.
2. `KAPI_DISI`'ndaki her dosya tabanda olmalı **ve gerekçesi sınanır**: "prop
   gerekiyor" diyen dosya gerçekten propsuz mount edilememelidir. Bu ters prova
   olmasaydı `KAPI_DISI` bir kaçış kapısı olurdu (mutasyon MD-2 bunu doğruluyor).

### Kapının kapsayamadığı dosyalar — 17 dosya, gerekçeleriyle

| Dosya | Neden |
|---|---|
| `components/Avatar.tsx` | zorunlu ad (baş harf üretimi) |
| `components/DeliveryRouteMap.tsx` | zorunlu `run` (duraklar) |
| `components/LibrariesMap.tsx` | zorunlu kütüphane dizisi |
| `components/LibraryEditorModal.tsx` | zorunlu kayıt (düzenlenen kütüphane) |
| `components/LibraryMapPanel.tsx` | zorunlu kütüphane (slug) |
| `components/map/MapGate.tsx` | leaflet `MapContainer` bağlamı |
| `components/ui/Field.tsx` | `children` render-prop |
| `admin/ProductPicker.tsx` | zorunlu seçili dizisi + geri çağrı |
| `admin/data-table/DataTable.tsx` | zorunlu `columns`/`rows` |
| `admin/delivery/LabelSheet.tsx` | zorunlu `run` |
| `admin/inventory/DamageDialog.tsx` | zorunlu bağlam |
| `admin/packing/PackageLabel.tsx` | zorunlu paket |
| `admin/packing/PackingLabelSheet.tsx` | zorunlu paket dizisi |
| `admin/store/EditProductModal.tsx` | zorunlu kayıt |
| `admin/ui2/duzenlemeYuzeyi.tsx` | zorunlu yüzey durumu |
| `admin/ui2/form.tsx` | namespace + hook (alanları derin kapıda) |
| `admin/ui2/kirliFormBekcisi.tsx` | yalnız hook |

Dört `.ts` dosyası (`data-table/index.ts`, `adminNavigation.ts`, `ui/index.ts`,
`yuzeyDurumu.ts`) JSX taşımadığı için kapsam dışıdır.

**Dürüst sınır:** sığ katman ilk render'ı görür; koşullu dalların içi (pencere
açıldıktan sonraki alanlar) yalnız derin katmanda ölçülür. A7'de göç eden her
ekran kendi dal testini getirdikçe derin kapsam büyüyecek.

---

## 5 · Görev 3 — dizin yürüyüşü + import grafiği

**Yazılı kural** (örnek listesi değil):

1. Ölçüm tabanından ulaşılan her yerel `.tsx` **geçişli olarak** ya listede
   olmalı ya `fazlaDosyalar`a düşmeli (fixpoint).
2. Kapanış **`.ts`te durur**: ölçülen dört metriğin dördü de JSX metriğidir;
   api/hook/lib katmanını tabana çekmek ölçümü panelin arayüzü olmayan
   yüzlerce dosyayla şişirirdi.
3. `.ts`teki tek olası kaçak (`React.createElement("button")`) **bütün-ağaç**
   nöbetçisiyle kapatıldı (`tsHamButonlari`) — yani (2) bir delik bırakmaz.
4. Test dosyaları kapsam dışı (walk ile aynı gerekçe).

Sonuç: **+27 dosya**, hepsi `src/components/**` altında. Aralarında göç
edecek asıl düzenleme yüzeyleri var: `LibraryEditorModal` (15 kontrol),
`ExamSessionsManager` (14 ham düğme · 2 adsız kontrol · 1 etiketsiz overlay),
`LibraryPayoutForm` (5 adsız kontrol), `MapPicker` (9 ham düğme).
`AdminLibraries`/`AdminExamCatalogs` zaten ölçülüyordu — ama o ekranların
**düzenleme yüzeyi** ölçüm dışındaydı; denetimin "göç edecek yüzeyin çoğu
görünmüyor" tespiti sayıyla doğrulandı.

---

## 6 · Görev 4 — prop olarak inen pencere durumu

Yerel bileşenlerin hangi **prop**'unun bir pencereye durum olarak aktığı
**sabit nokta (fixpoint)** hesabıyla çıkarılıyor; zincir uzunluğu sınırsız
(`Üst → Çocuk → Torun → Dialog`). İP-A5'in sözleşmesi korundu — bağ başına bir
kez, aynı dosyadaki iki ayrı bağ iki kez (`sayim.test.ts` 29/29 yeşil).

**Saha sayımı** (görev tanımının açık bıraktığı soru): tüm tabanda bu desenin
**tek örneği** var — `AdminAuditLogsPage`te `selected` ekranda yaşıyor,
`AuditDetailDialog`a `log` prop'u olarak iniyor, orada `<Dialog open={log !==
null}>`e veriliyor. Eşiğe tahmini bir rakam ("≥30") yazılmadı; ölçülen yazıldı.

**Dürüst sınır:** yalnız yıkılarak alınan proplar izlenir (`function C({ acik })`);
`props.acik` biçimi ve **başka dosyadan** import edilen bileşene inen durum
görünmez. İkincisi bilinçlidir: dosya sınırını aşan bir çıkarım, ölçümü yeniden
"dosyalar nasıl bölünmüş" sorusuna duyarlı yapardı — İP-A5'in düzelttiği kusur.

---

## 7 · Görev 5 — global timeout gevşetmesi cerrahileşti

`src/test-setup.ts`teki `configure({ asyncUtilTimeout: 4000 })` **117 dosyanın
hepsini** etkiliyordu; teşhis doğruydu ama ilaç herkese veriliyordu ve gerçek
bir performans regresyonu her testte 4 saniye gizlenebilirdi.

Global ayar kaldırıldı. Bütçe artık yalnız iki dosyada, **çağrı yerinde**:
`ticketsPaymentGate.test.tsx` ve `storeVariants.acceptance.test.tsx` (ikisi de
iki ağ sorgusu çözülene kadar bekleyen `findAllBy*` çağrıları). Tam suite bu
değişiklikten sonra **3 kez** koşturuldu, üçü de yeşil; düşen test olmadı,
dolayısıyla cerrahi liste genişletilmedi.

---

## 8 · Mutasyon provası — 9/9

Sürücü: `scratchpad/mutasyon-a6b.mjs` (kök CLAUDE.md §D: `git checkout --`
YOK; ham baytlar bellekte tutulur, geri yazılır, `git status --porcelain`
başta ve sonda karşılaştırılır).

| # | Mutasyon | Hedef nöbetçi | Sonuç |
|---|---|---|---|
| MD-1 | kapı ölçümü render etmezse | `mA.kacis` | ✓ |
| MD-2 | mount edilebilen ekran `KAPI_DISI`'na park edilirse | çalışma zamanı kapısı | ✓ |
| MD-3 | import grafiği tabandan çıkarılırsa | `mB.kacis` | ✓ |
| MD-4 | `.ts`e `createElement("button")` eklenirse | `uiBaseline` | ✓ |
| MD-5 | prop devri geri alınırsa | `mC.kacis` | ✓ |
| MD-6 | **kör çekiç** (her prop pencere sayılırsa) | `mC.kacis` **negatifi** | ✓ |
| MD-7 | üretim ekranına adsız kontrol eklenirse | çalışma zamanı kapısı | ✓ |
| MD-8 | M-A⁻ fabrikası adsızlaşırsa | `mA.kacis` negatifi | ✓ |
| MD-9 | taban listesinden dosya düşerse | `uiBaseline` (`fazlaDosyalar`) | ✓ |

MD-6 ve MD-8 bilerek **negatif kontrollerin dişlerini** ölçer: onarım kör bir
çekiç olsaydı ya da fixture boş kalsaydı bu iki mutasyon kaçardı.

---

## 9 · Kapsam

`git diff --name-only 8ce1dda..HEAD` çıktısındaki her yol izinli kümede:

```
docs/ip-a6b-gorev.md
docs/ip-a6b-rapor.md
frontend/scripts/ui-baseline-sayim.mjs
frontend/src/__guards__/**            (5 yeni dosya + 2 mevcut)
frontend/src/test-setup.ts
frontend/src/pages/ticketsPaymentGate.test.tsx          (test dosyası)
frontend/src/pages/store/storeVariants.acceptance.test.tsx (test dosyası)
```

Bir ekran, bir `ui2/` bileşeni ya da bir hook **değişmedi**.

---

## 10 · Bilinen risk ve doğrulanmamış noktalar

1. **Sığ kapı yalnız ilk render'ı görür.** 88 ekran mount ediliyor ama
   pencereler kapalı; koşullu dalların içindeki alanlar yalnız derin kapıda
   (9 dosya) ölçülüyor. Bu, kapının en zayıf yeridir ve A7'de her göç eden
   ekranın dal testiyle kapanmalıdır.
2. **Kapıda 7 gerçek adsız kontrol var** (`LibraryPayoutForm` 5,
   `ImageCropModal` 1, `MapPicker` 1) ve bu pakette KAPATILMADI — kapatmak
   davranış değişikliğidir (İP-A6c/A7). Kimlikle sabitlendiler: yeni borç da,
   sessiz düşüş de testi kırar.
3. **Import grafiği `paths` çözümünü tsconfig'den okumaz**; tek takma ad
   (`@/*`) elle karşılanıyor. Yeni bir takma ad eklenirse grafiğe de
   eklenmelidir.
4. **Prop devri dosya içinde kalır** (§6). Başka dosyadaki bir bileşene inen
   pencere durumu hâlâ görünmez; bu bilinçli bir sınırdır, kör nokta olarak
   kayıtlıdır.
5. **`kapsanan.length ≥ 88` sayısal bir tabandır**, kimlik değil: bir ekran
   `KAPI_DISI`'na taşınıp yerine başka bir dosya eklenirse sayı korunabilir.
   MD-2 bu deliği gerekçe doğrulamasıyla kapatıyor ama tam kimlik koruması
   (liste eşitliği) A7'de değerlendirilmeli.
6. **Tam suite süre karşılaştırması gürültülüdür** (aynı makinede 130 s → 55 s
   dalgalanması ölçüldü); §2'deki süreler mutlak değil, mertebe olarak okunmalı.
