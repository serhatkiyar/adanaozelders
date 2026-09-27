# İP-A7d5 — Kararsız test sınıfının taranması

**Dal:** `feat/medusa-ui-taban` · **Taban commit:** `c4a4d1a` (İP-A7d4 kapanışı)
**Kapsam:** yalnız test dosyaları ve test kurulumu. **Üretim kodu ve ekran
dosyaları DEĞİŞMEDİ** — `git diff --stat` bunu doğrular (aşağıda §7).

---

## 0. Özet

| Ne | Sonuç |
|---|---|
| Görev 1 · `adminKataloglarGoc` K-2 | **Kusur GERÇEK, teşhis yanlıştı.** Dosyada tembel modül YOK (ölçüldü); K-2'nin kararsızlığının sebebi AK-1 sızıntısıydı ve **tohum 5153'te kırmızı düştü**. Ölçülmüş çağrı yeri bütçesiyle kapatıldı. §1 |
| Görev 2 · sınıfın taranması | **12 dosya** bulundu ve 10'u kapatıldı; 2'si gerekçeli istisna. Yöntem STATİK (AST) ve deterministik; tohumun bu iş için neden zayıf olduğu sayıyla ölçüldü (§2b). §2 |
| Görev 3 · bekleme bütçesinin 6 çağrı yeri | Envanter aslında **8 + 2** idi. İki ezme **kaldırıldı**, biri ölçüyle geri kondu ama **sızıntısız**; sızıntı iki dosyanın gerçek borcunu gizliyormuş (AK-1/AK-2). Kalan her çağrı yeri ölçümü ve **gizlenebilen regresyon** bedeliyle yazıldı. §3 |
| Görev 4 · ölü iddia taraması | **İki ölü iddia** bulundu (`adlarDogru(0)` — hiçbir şey iddia etmiyordu, ters prova ile kanıtlandı), üç bayat başlık düzeltildi. §4 |
| Yeni nöbetçi | 2 dosya, 20 test: `tembelModul` (7) + `beklemeButcesi` (13) + sızdırmayan bütçe yardımcısı |
| Mutasyon | **12/12 YAKALANDI** + eski iddianın kör olduğu ayrıca kanıtlandı (A7D5-6c) |
| Suite | 143 → 145 dosya, 1656 → 1676 test · **toplam test süresi 468,8 sn → 309,7 sn (−%34)** |
| Kapı | tsc + build + lint (0 hata) + tam suite + **12 karışık tohum × 3 tur** (turlar iki gizli borç daha ortaya çıkardı; §5a) |

---

## 1. Görev 1 — `adminKataloglarGoc` K-2: kusur GERÇEK, sebebi reçetedeki DEĞİL

Görev şuydu: *"K-2'yi düzelt — ağır modülü test dosyasında statik import et;
sınıf A7d3'te belgeli."* Uygulamadan önce ölçüldü; sonuç iki parçalı çıktı:
**denetim haklıydı (test gerçekten kararsız), teşhis ise bu dosyada tutmuyordu.**

### 1a. Reçete edilen mekanizma bu dosyada YOK (ölçüldü)

AST taraması (§2'deki dedektör) `adminKataloglarGoc.acceptance.test.tsx`te tek
bir `import()` ya da `import.meta.glob` bulmuyor. Ekran (`AdminExamCatalogs`)
dosya başında statik import ediliyor ve grafiği `ui2/duzenlemeYuzeyi` →
`admin/ui` → `@medusajs/ui` zincirini zaten TOPLAMA (collect) evresinde çekiyor.
Kardeş dosyalara A7d3'te eklenen `import "@/components/admin/ui2/duzenlemeYuzeyi"`
satırı burada hiçbir şey değiştirmez: modül grafikte zaten var. Eklemek tedavi
değil tören olurdu; EKLENMEDİ.

RTL bekleme süreleri (tam suite yükü, yöntem §3b):

| Çağrı yeri | Ne bekliyor | Ölçülen (üst sınır) |
|---|---|---|
| `adminKataloglarGoc:194` (**K-2**) | hata yolunda "Yeniden dene" | **136 ms** |
| `adminKataloglarGoc:155` | dosyanın ilk testi | 457 ms |
| diğer 8 sorgu | — | 43–237 ms |

### 1b. Ama kusur GERÇEK: tohum 5153 K-2'yi kırmızı düşürdü

Bütçe ezmeleri kaldırıldıktan sonra koşulan 12 tohumluk turda K-2 düştü:

```
FAIL src/pages/dashboards/adminKataloglarGoc.acceptance.test.tsx
  > K-2 · hata ≠ boş > liste hatasında 'Yeniden dene' çıkar, boş durum metni ÇIKMAZ
  TestingLibraryElementError: Unable to find role="button" and name /Yeniden dene/i
```

Sebep §3c'deki **AK-1**: `operatorPanel`/`operatorBalance` dosyalarındaki
`configure({ asyncUtilTimeout: 5_000 })` aynı vitest işçisinde SONRA koşan her
dosyaya sızıyordu ve K-2 de o sızıntıdan bedavaya yararlanıyordu. Yani K-2
"bazen kırmızı" değil, **bütçesi başka bir dosyaya emanet** bir testti; hangi
tohumda emanetin geleceği belli değildi. Sızıntı kalkınca ihtiyaç görünür oldu —
`sayimOturumlariGoc` (AK-2) ile birlikte **ikinci gizli borç**.

Düzeltme: ölçülmüş **çağrı yeri bütçesi** (3000 ms), gerekçesi ve tohum numarası
testin yanında yazılı. Dosya kapsamlı ya da global bir ayar KULLANILMADI —
sızıntının tekrarı olurdu.

### 1c. Bu bulgunun anlamı

Denetimin işaret ettiği testin kararsız olduğu doğrulandı, ama "ağır modülü
statik import et" reçetesi uygulansaydı **hiçbir şey değişmezdi**: K-2 aynı
tohumda yine düşerdi ve kusur "düzeltildi" sanılırdı. Teşhisi ölçmeden
uygulamak, bu pakette en az bir kez yanlış tedaviye götürecekti.

## 2. Görev 2 — sınıfın taranması: yöntem, bulgu, ilaç

### 2a. Sınıfın tanımı (A7d2/A7d3'te belgeli)

Bir test dosyası ağır bir modülü **çalışma zamanında** yüklerse (`import()` ya
da `import.meta.glob` yükleyicisi), transform + değerlendirme maliyeti TOPLAMA
evresinde değil **koşum evresinde** ödenir. Ölçülmüş bedeli:

| Paket | Ölçülen |
|---|---|
| A7d2 | `PackagesPage` modül yüklemesi **10.093 ms**, `OperatorSessions` **11.235 ms**; `packingScreens`in İLK testi o ekranı hiç kullanmadığı hâlde 9 sn'lik bütçeyi aştı |
| A7d3 | `PackageLabel`, `PackingLabelSheet`, `ip19Filo` — üç zaman aşımı, üçü de dosyanın ilk testi |
| A7d5 | aşağıdaki tablo |

İlaç bütçe büyütmek değil, **statik import**: maliyet collect evresine geçer,
orada test/kanca bütçesi yoktur.

### 2b. Yöntem — neden tohum değil, statik tarama

Bu sınıf tohumla güvenilir bulunamaz: kusur ancak modül yüklemesi ile paralel
yük ÇAKIŞTIĞINDA kırmızıya döner; çakışmadığı koşumda dosya yeşil geçer ve
yalnız YAVAŞ olur. A7d2 ve A7d3'te sınıfın her üyesi ayrı ayrı, kendi zaman
aşımıyla bulunmuştu — yani sınıf olarak hiç taranmamıştı.

**Tohumun bu iş için ne kadar zayıf olduğu bu pakette SAYIYLA ölçüldü.**
Bütçe ezmeleri kaldırıldıktan sonra koşulan 12 tohumluk turda (§5a) ortaya çıkan
üç gerçek borcun görünme sıklığı şudur:

| Gizli borç | Kaç tohumda kırmızı |
|---|---|
| `operatorPanel` bekleme bütçesi | **3 / 12** |
| `sayimOturumlariGoc` (AK-2) | **1 / 12** |
| `adminKataloglarGoc` K-2 (AK-2b) | **1 / 12** |

1/12'lik bir kusur, altı tohumda **yaklaşık %40 olasılıkla** hiç görünmez. Yani
"altı tohum yeşil geçti" bir kanıt değil, bir örneklemdir — görevin
*"6 tohum yeterli değil"* saptaması ölçümle doğrulanıyor. Bu paketin kendi ilk
turunda (kirlenmeden önceki üç tohum) sınıfın on iki üyesinin **hiçbiri**
görünmedi; hepsi statik taramayla bulundu.

Onun için yazılan dedektör (`frontend/scripts/tembel-modul.mjs`) **AST**
tabanlıdır ve deterministiktir. Sözleşmesi:

> Bir test dosyasında çalışma zamanında yüklenen her modül, AYNI dosyada
> **statik** olarak da import edilmiş olmalıdır (yan etki importu yeter) — ya da
> `tembelModul.test.ts`teki gerekçeli listede adıyla yazılı olmalıdır.

Yorumda/dizede geçen `import(` sayılmaz; yalnız tip düzeyindeki
`typeof import(...)` de sayılmaz (maliyeti yoktur). İkisi de ayrı testle
kanıtlanıyor.

> **Usul kaydı (kendi kusurum).** Paketin başındaki tohum turunu, ilk üç
> tohumdan sonra çalışma ağacını düzenlemeye başladığım için **kirlettim**;
> 4. tohumdan itibaren kısmen düzeltilmiş ağaçta koştu ve turu iptal ettim.
> Ölçüm koşarken ağaca dokunulmaz. §5a'daki iki tur bitmiş ağaçlarda baştan
> sona koşuldu.

### 2c. Bulgu — 12 dosya

| Dosya | Ne tembel yükleniyordu | Karar |
|---|---|---|
| `pages/dashboards/operatorPanel.acceptance` | **8 ekran** (`OperatorHome/Library/Sessions`, `Notifications`, `Leaderboard`, `Settings`, `Calendar`, `Learn`) | statik |
| `pages/operatorBalance.acceptance` | `Balance` | statik |
| `pages/courierHandover.acceptance` | `DeliveryRunHandover`, `DeliveryDriver` | statik |
| `pages/admin/delivery/ip19Filo.acceptance` | `DeliveryTodayPage`, `DeliveryBoardPage` (**10 çağrı**, test gövdelerinin içinde) | statik |
| `pages/admin/packing/packingScreens.acceptance` | 4 paketleme ekranı | statik |
| `components/admin/packing/PackageLabel.test` | `PackageLabel` | statik (gevşek tip sözleşmesi korunarak) |
| `components/admin/packing/PackingLabelSheet.test` | `PackingLabelSheet` | statik (aynı) |
| `flashcardsKaldirildi.test` | `@/App` (bütün rota tablosu) | statik |
| `lib/packing.test` | `lib/packing` | statik |
| `lib/operatorAgenda.test` | `lib/operatorAgenda` | statik |
| `__guards__/calismaZamaniKapisi` | `/src/**/*.tsx` (88 ekran) | **gerekçeli istisna** |
| `components/admin/ui2/zodTurkce.test` | `./form` (`vi.resetModules` sonrası) | **gerekçeli istisna** |

Onu da aynı kök sebep birleştiriyor: hepsi **red-first idiomunun kalıntısıydı**.
Dosyaların yorumları bunu açıkça yazıyordu — *"glob, ekran dosyası HENÜZ YOKKEN
matris çökmesin diye"*. Ekran yazıldığı gün o gerekçe bitiyor, geriye yalnız
maliyeti kalıyor; ama satır kimse bakmadığı için kalıyor. İki istisnada tembel
yükleme testin KONUSUDUR (biri ölçüm kapsamını ağaçtan türetir, diğeri modül
tazeleme yan etkisini ölçer) — statik import onları ölçülemez hâle getirirdi.

Yan kazanç: `if (!yukle) throw new Error("HENÜZ YAZILMADI: …")` dalları da
gitti. Bugün hiçbiri tetiklenemezdi — yani bunlar da birer **ölü kontroldü**
(Görev 4'ün sınıfı).

### 2d. Ölçülen kazanç (tam suite yükü altında, JSON raporu)

| Dosya | İlk test (ms) | Dosya toplamı (ms) |
|---|---|---|
| `operatorPanel.acceptance` | **6923 → 844** | 37.531 → 25.866 |
| `operatorBalance.acceptance` | 3074 → 2385 | 7.099 → 4.401 |
| `packingScreens.acceptance` | 2129 → 496 | 7.009 → 6.673 |
| `courierHandover.acceptance` | 2028 → 1153 | 6.491 → 5.785 |
| `ip19Filo.acceptance` | 1643 → 1485 | 4.523 → 3.860 |
| `PackingLabelSheet.test` | 603 → 133 | 2.080 → **426** |
| `PackageLabel.test` | 443 → 137 | 726 → 639 |
| `flashcardsKaldirildi.test` | — | 5.809 → 3.726 |
| `lib/packing.test` | 74 → 1 | 90 → **11** |
| `lib/operatorAgenda.test` | 20 → 2 | 35 → **11** |

**Suite geneli:** duvar saati **120,5 sn → 96,3 sn (−%20)**, toplam test süresi
468,8 sn → 400,3 sn (−%15). Bu, aynı işi daha az bütçeyle yapmaktır: hiçbir
iddia gevşetilmedi, yalnız ölçülen davranışla ilgisiz maliyet testlerin
bütçesinden çıkarıldı.

---

## 3. Görev 3 — bekleme bütçesinin çağrı yerleri

### 3a. Önce envanter: "6 çağrı yeri" ölçülünce **8 + 2** çıktı

A7d2/A7d3 altı çağrı yeri sayıyordu. AST envanteri (yeni nöbetçi
`beklemeButcesi.test.ts`) sekiz **çağrı yeri bütçesi** (`{ timeout: N }`)
buldu — sayılmayan ikisi:

| Sayılmamış | Değer | Ne bekliyor |
|---|---|---|
| `adminStoreVariants:188` | 1500 | "Varyant grubu" alanı |
| `DamageDialog:43` | 2000 | ürün arama (debounce'lu) |

Ayrıca envantere HİÇ girmemiş, ondan **daha güçlü** iki mekanizma daha vardı:
`operatorPanel` ve `operatorBalance` dosyalarındaki
`configure({ asyncUtilTimeout: 5_000 })` ve `vi.setConfig({ testTimeout: 20_000,
hookTimeout: 20_000 })`.

### 3b. Ölçüm yöntemi

RTL'in `asyncWrapper` yapılandırması sarıldı (geçici kurulum dosyası, commit
edilmedi): her `findBy*`/`waitFor` çağrısının süresi ve **yığın izinden çıkarılan
çağrı yeri** JSONL'e yazıldı, tam suite yükü altında (145 dosya, 15 paralel
işçi). 1348 bekleme kaydı toplandı.

**Ölçümün dürüst sınırı:** kaydedilen süre bir **üst sınırdır** — `await`
sonrası devam mikro-görevi, tıkanmış olay döngüsünde gecikebilir; yani
"1550 ms" değeri `waitFor`un içinde geçen süre + uyanma gecikmesidir. Bu yüzden
aşağıdaki tablo "bütçe şu kadar gerekiyor" demez, "bu çağrı yeri şu mertebeye
DEĞİYOR" der. Bütçenin gerçekten yük taşıyıp taşımadığı ayrıca **davranışla**
sınandı (§3d).

Dağılım (1348 bekleme, tam suite yükü): **>1000 ms: 13** · >800 ms: 25 ·
>500 ms: 58. Yani varsayılan 1000 ms bu makinede (16 mantıksal çekirdek,
15 işçi) beklemelerin ~%1'i için gerçekten dar.

### 3c. Kaynağında düzeltilen İKİ çağrı yeri — ve buldukları sızıntı

`operatorPanel` ve `operatorBalance` dosyalarındaki ezmelerin gerekçesi
dosyaların kendi yorumlarında yazılıydı ve **aynı cümleydi**:

> "Bu dosya gerçek sayfa ağaçlarını jsdom'da render eder; **esbuild
> transform'u** tek başına birkaç saniye sürer ve … bütçe paralel koşuda
> aşılıyor — ölçülen davranış yüzünden DEĞİL, **derleme süresi** yüzünden."

Yani ikisi de Görev 2'deki sınıfın maskelenmiş hâliydi: bütçe, tembel modül
yüklemesinin maliyetini ödemek için büyütülmüştü. Ekranlar statik import
edilince ölçüldü:

| | önce | sonra |
|---|---|---|
| `operatorPanel` en yavaş testi (tam suite yükü) | ilk test 6.923 ms | **3.997 ms** |
| `operatorBalance` en yavaş testi | 3.074 ms | 2.385 ms |

`vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 })` **iki dosyada da
kaldırıldı**: 9 sn'lik ortak bütçe artık yeterli ve `vitest.config.ts`'in yazılı
kuralı ("dosya başına testTimeout ezmesi YAPILMAZ) ihlalsiz duruma döndü.

**Sızıntı bulgusu (bu paketin en önemli bulgusu).** Aynı dosyalardaki
`configure({ asyncUtilTimeout: 5_000 })` "yalnız bu dosyayı etkiler" diye
yazılmıştı. Ölçüldü — **yanlış**:

```
vitest run --pool=forks --poolOptions.forks.singleFork \
  src/pages/operatorBalance.acceptance.test.tsx  src/__sonda.test.ts
→ sonda: asyncUtilTimeout = 5000       (aynı işçide SONRA koştu)

vitest run src/__sonda.test.ts
→ sonda: asyncUtilTimeout = 1000       (tek başına)
```

RTL'in `configure`u modül düzeyinde globaldir ve `@testing-library/dom` bir
node_modules bağımlılığı olduğu için vitest işçisinin ESM önbelleğinde
**dosyalar arasında paylaşılır** — `vi.resetModules()` bile temizlemez (aynı
sızıntı sınıfı `ui2/zodTurkce.test.ts`te zod yereli için zaten belgeliydi).

Sonucu: aynı işçide bu iki dosyadan SONRA koşan **her** test dosyası, kendi
bütçesi 1000 ms sanırken 5000 ms ile koşuyordu. Hangi dosyaların etkilendiği
**karışık tohumda değişiyordu** — yani maskeleme kararsızdı. İP-A6b BULGU-10'da
global `asyncUtilTimeout`u tam da bu yüzden kaldırmıştı; ayar yan kapıdan geri
gelmiş ve iki yıl değil, iki paket sonra fark edilmişti.

### 3d. Bütçe gerçekten yük taşıyor mu? — davranış deneyi

Ölçüm bir üst sınır verdiği için (§3b), "bu bütçe gerekli mi" sorusu
**davranışla** sınandı: iki dosyanın ezmeleri kaldırıldıktan sonra tam suite
12 karışık tohumla koşuldu. Sonuç aşağıda (§5) ve iki şeyi birden gösterdi:

1. **`operatorPanel` bütçesi GERÇEKTEN yük taşıyordu.** Üç tohumda kırmızı
   düştü — 5001 ve 5041'de aynı test:
   `OperatorLibrary · adres dalının BEŞ alanı da ADLI` →
   *"Unable to find role=button and name /Adres & Konum — düzenle/"*.
   Bu bir yalancı kırmızı değil: ekran render edilene kadar sorgu 1000 ms'lik
   varsayılanı yiyor (aynı çağrı yerinin ölçülen üst sınırı 982 ms; dosyanın
   en yavaş beklemesi 3.578 ms). Tohum 5059'da aynı dosyanın başka bir testi
   (`/takvim` nav) *"Unable to find /Kütüphanem/i"* ile düştü.
2. **Sızıntı, BAŞKA bir dosyanın gerçek ihtiyacını gizliyordu.** Tohum 5001'de
   ikinci kırmızı `sayimOturumlariGoc`tan geldi
   (*"Unable to find /Yeniden dene/i"*). O dosyanın hiç bütçe ezmesi YOK ve
   olması da gerekmiyordu — çünkü aynı işçide `operatorPanel`/`operatorBalance`
   koşmuşsa 5000 ms'lik sızıntıdan **bedavaya** yararlanıyordu. Sızıntı gidince
   ihtiyaç görünür oldu.
3. **Ve bir tanesi daha: denetimin işaret ettiği test.** Tohum 5153'te
   `adminKataloglarGoc` **K-2** düştü (§1b). Yani sızıntının gizlediği borç
   ikiden fazlaydı; hangi dosyanın "bedava bütçe" aldığı tohuma bağlıydı.

Bu üç kırmızı, ezmeleri kaldırmanın **kazancıdır**: hiçbiri yeni kusur değil,
üçü de görünmez hâldeki eski borçtur. Ölçülmüş bütçeler konduktan sonra aynı
12 tohum yeniden koşuldu ve **12/12 yeşil** geçti.

### 3e. Karar tablosu — altı (aslında sekiz) çağrı yeri tek tek

Ölçülen değerler tam suite yükü altında, **üst sınırdır** (§3b). "Gizlenebilen
regresyon" = bütçe − ölçülen tepe, yani o çağrı yerinde bugün fark edilmeden
eklenebilecek gerçek yavaşlama.

| # | Çağrı yeri | Bütçe | Ölçülen tepe | Karar | Gizlenebilen regresyon |
|---|---|---|---|---|---|
| 1 | `operatorPanel` (dosya) | 5000 | 3578 ms | **KALDI** — 3 tohumda kırmızı kanıtı; ama artık SIZINTISIZ | ~1,4 sn |
| 2 | `operatorBalance` (dosya) | 5000 → **3000** | 1184 ms | **İNDİRİLDİ** — kırmızı tohum yok, ölçüme göre daraltıldı; sızıntı gitti | ~1,8 sn |
| 3 | `ticketsPaymentGate:32` (6 çağrı) | 4000 | 225 ms | kaldı | ~3,8 sn |
| 4 | `storeVariants:18` (6 çağrı) | 4000 | **1124 ms** | kaldı | ~2,9 sn |
| 5 | `adminStoreDalAdlari:235` (4 çağrı) | 4000 | 885 ms | kaldı | ~3,1 sn |
| 6 | `adminHakedisGoc:53` (11 çağrı) | 4000 | 554 ms (A7d2'de 917 ms) | kaldı | ~3,1 sn |
| 7 | `adminDenetimKayitlari:197` | 4000 | 363 ms | kaldı | ~3,6 sn |
| 8 | `adminStoreVariants:414` | 4000 | 439 ms | kaldı | ~3,6 sn |
| 9 | `adminStoreVariants:188` | 1500 | **1550 ms** | kaldı (envantere YENİ girdi) | ~0 sn |
| 10 | `DamageDialog:43` | 2000 | 303 ms (debounce'lu) | kaldı (envantere YENİ girdi) | ~1,7 sn |
| 11 | `sayimOturumlariGoc:360` | — → **3000** | 802 ms | **YENİ** — sızıntı kalkınca ihtiyaç görünür oldu (AK-2) | ~2,2 sn |
| 12 | `adminKataloglarGoc:213` (**K-2**) | — → **3000** | 136 ms | **YENİ** — aynı sınıf: tohum 5153'te kırmızı düştü (§1b) | ~2,9 sn |

**3–10 neden kaldırılamadı.** Hiçbiri Görev 2'nin sınıfına ait değil: yeni
dedektör bu dosyaların HİÇBİRİNDE tembel modül yüklemesi bulmuyor, yani
"kaynağında düzeltilecek" bir maliyet yok. Kalan gecikme jsdom'da gerçek sayfa
ağacının boyanması + 15 paralel işçinin CPU paylaşımıdır; testin kendisinde
değiştirilecek bir şey kalmıyor. Bedelleri yukarıda: bu çağrı yerlerinde
**bugün 3–4 saniyelik gerçek bir yavaşlama fark edilmeden geçer.**

**Neden 4000'ler ölçüme göre daraltılmadı (bilinçli).** Elimizde çağrı yeri
başına TEK yüklü koşumun tepe değeri var; bu bir dağılım değil. A7d2'de aynı
sorgunun 98 ms ile 917 ms arasında salındığı ölçülmüştü — yani tek örnekten
"2× tepe" gibi bir sınır türetmek, bugün yeşil olan testleri yarın kararsız
yapardı. Doğru sıradaki adım tahmin değil ÖLÇÜM: bu çağrı yerlerinin süresini
N tohumda toplayıp dağılımıyla daraltmak (borç → §7).

---

## 4. Görev 4 — ölü iddia taraması

### 4a. Yöntem

Üç ayrı tarama yapıldı:

1. **Sabit-üstü iddia taraması (AST).** Bütün test ağacında, `expect(...)`
   içindeki *alınan* değer YALNIZCA elle bakımı yapılan sabitlerden türüyorsa,
   o iddia üretim kodundan bağımsızdır. Tarandı: **tek bir aday** çıktı
   (`calismaZamaniKapisi:417`) ve o da ölü değil — karşılaştırdığı taraf
   ölçümden geliyor (`tabanEkranlari`).
2. **Boşalmış taban taraması.** Ölçüm tabanı listelerinden hangileri BOŞ:
   `UNLABELED_OVERLAY_FILES` ve `MODAL_DURUM_DOSYALARI`. İkisinin de üstündeki
   iddialar A7d2/A7d4'te zaten kimliğe çevrilmişti (`toBe(0)` + `toEqual(liste)`).
3. **Eşiği sıfır olan "en az N" kapıları.** Bu, c4a4d1a'daki örneğin
   AYNADAKİ hâlidir: orada boş bir listeye `not.toContain` uygulanıyordu,
   burada sıfır elemanlı bir kümeye "≥ 0" uygulanıyor.

### 4b. Bulgu — `adlarDogru(0)`: hiçbir şey iddia etmeyen iki çağrı

`adlarDogru(enAz)` yardımcısı İKİ iddia taşır: (1) adsız kontrol yok,
(2) en az `enAz` kontrol gerçekten render edildi (dalın açıldığının kanıtı).
`enAz = 0` verildiğinde **ikisi de ölür**:

* "kontrol sayısı ≥ 0" bir totolojidir;
* "adsız kontrol yok" iddiası, o dalda **hiç kontrol olmadığı** için
  kendiliğinden geçer.

Ölçüldü — iki çağrı yerinde de dal GERÇEKTEN sıfır form kontrolü render ediyor:

| Çağrı yeri | Dal | Ölçülen kontrol sayısı |
|---|---|---|
| `adminKataloglarGoc:296` | "cevap anahtarı yüklü" | **0** |
| `examOturumlariGoc:312` | "katılımcı paneli · Giriş ver" | **0** |

**Ters prova — eski iddia gerçekten kör müydü?** Üretim koduna, o dala
**erişilebilir adı OLAN** bir alan eklendi (`<input aria-label="mutasyon alani" />`):

| Koşum | Sonuç |
|---|---|
| yeni kimlik iddiasıyla (`toEqual([])`) | **YAKALANDI** — `expected [ 'INPUT' ] to deeply equal []` |
| eski `adlarDogru(0)` ile (geri alınıp tekrar koşuldu) | **YAKALANMADI — 15/15 yeşil** |

Yani iddia yalnız "zayıf" değildi, o dal için **tamamen ölüydü**: eski hâli
ancak adsız bir alan eklenirse kırılırdı; adlı bir alan sessizce geçerdi.

Düzeltme: kimlik kontrolü — `expect(formKontrolleri(document.body).map(k => k.tagName)).toEqual([])`,
mesajıyla birlikte ("bu dalda form kontrolü BEKLENMİYOR"). Bu, projenin başka
yerlerde seçtiği yönle aynıdır (`CALISMA_ZAMANI_ADSIZ`, `KAPI_KAPSAMI`,
`MODAL_DURUM_DOSYALARI`): **sayı değil kimlik, tavan değil taban.**

### 4c. Bayat başlıklar (iddia doğru, adı yanlış)

Üç nöbetçi testin adı, ölçtüğü eşikten kopmuştu. Ad da bir sözleşmedir: kırmızı
düştüğünde okunan ilk satırdır.

| Eski ad | Gerçek eşik | Yeni ad |
|---|---|---|
| "ham `<button>` sayısı artamaz **(taban 131)**" | 102 | "… (bugünkü taban 102)" |
| "erişilebilir adı olmayan form kontrolü artamaz **(taban 30)**" | 7 | "… (bugünkü taban 7)" |
| "role=dialog/aria-modal taşımayan overlay sayısı **artamaz (taban 4)**" | `toBe(0)` | "role=dialog/aria-modal taşımayan overlay **SIFIR (tavan değil TABAN)**" |

Üçüncüsü ayrıca bir tür ölü ifadeydi: iddia A7d2'de tabana çevrilmişken adı
hâlâ "artamaz" diyordu.

### 4d. Kapsam dışı bırakılan (gerekçesiyle)

`rawButton ≤ 102` ve `adsizKontrol ≤ 7` **tavan olarak KALDI**. Gerekçe: ikisi
de bugün sıfır DEĞİL (ölçülen: tam olarak 102 ve 7) ve düşüşleri meşru
ilerlemedir; kimliğe çevirmek her göç dalgasında CI'yı "ilerleme yüzünden"
kırardı. Yanlarındaki dosya-listesi testleri zaten kimlikle sabit — yani
"sayı düştü" ile "ekran ölçümden çıktı" ayrımı korunuyor.

---

## 5. Kapı

### 5a. Koşulan kapılar

| Kapı | Sonuç |
|---|---|
| `tsc -b` + `vite build` | **geçti** |
| `eslint src` | **0 hata**, 31 uyarı (hepsi önceden var, hiçbiri değişen dosyalarda) |
| Tam suite (sıralı) | **145 dosya / 1676 test — hepsi yeşil** (kapı turlarından sonra son kez koşuldu) |
| **12 karışık tohum** (`--sequence.shuffle --seed=…`) | aşağıda |

**Tohum turu — iki kez koşuldu.** Birinci tur bütçe ezmeleri kaldırıldıktan
SONRA koşuldu ve kapının asıl işini yaptı: gizlenmiş üç borcu ortaya çıkardı.

| Tur | Neyin üzerinde | Sonuç |
|---|---|---|
| 1. tur | bütçe ezmeleri kaldırılmış hâl | **4 kırmızı tohum** — 5001 (`operatorPanel` + `sayimOturumlariGoc`), 5041 (`operatorPanel`), 5059 (`operatorPanel`), **5153 (`adminKataloglarGoc` K-2)** |
| 2. tur | ölçülmüş bütçeler konduktan sonra | **1 kırmızı tohum** — 5103: `flashcardsKaldirildi` R7 (**yeni bulgu**, aşağıda) |
| 3. tur | R7 kaynağında düzeltildikten sonra | **12/12 YEŞİL** |

Aynı 12 tohum (5001 · 5013 · 5027 · 5041 · 5059 · 5077 · 5091 · 5103 · 5119 ·
5137 · 5153 · 5171) üç turda da koşuldu.

Kırmızıların hiçbiri bu paketin ürettiği kusur değil; hepsi **görünür hâle
gelen eski borç**tur ve her biri ölçümüyle kapatıldı.

Üçüncü turdan sonra yalnız YORUM eklendi (`tembelModul.test.ts`in bilinen
sınırı, TB-A7d5-4); davranış değişmediği için tur tekrarlanmadı, ama tam suite
+ lint + build yeniden koşuldu ve yeşil.

### 5a-2. İkinci turun bulduğu: `React.lazy` — sınıfın dedektörün GÖREMEDİĞİ hâli

Tohum 5103'te `flashcardsKaldirildi` R7 düştü:
*"Unable to find role=heading and name /Aradığınız sayfa bulunamadı/i"* — DOM'da
Suspense yedeği duruyordu. Sebep sınıfın ta kendisi, ama bir üst katmandan:
`App` rota tablosunu `React.lazy(() => import(...))` ile kuruyor, yani ekran
modülü **testin `findBy*` beklemesinin İÇİNDE** yükleniyor.

Bu, dedektörün **göremediği** bir yoldur: tembel yükleme test dosyasında değil,
üretim kodunda yazılıdır ve test yalnız `<App />` render eder. Yani Görev 2'nin
statik taraması bu paketteki tek boşluğunu burada verdi — ve boşluğu tohum
kapattı. İkisi birbirinin yerine geçmiyor; **birbirini tamamlıyor.**

Düzeltme yine bütçe değil kaynak: test dosyası, gideceği rotaların hedeflerini
yan etki importuyla statik alıyor (`@/pages/NotFound`, `@/pages/srs/SrsDecks`);
`lazy` sonra modülü önbellekten alıyor ve bekleme tek mikro-göreve iniyor.

### 5b. Mutasyon provası — **12/12 YAKALANDI**

Her yeni/değişen nöbetçi için ters prova yapıldı. Sürücü kullanıcı
değişikliklerini silmez: dosya yedeklenir, yama uygulanır, koşum sonrası
yedekten geri yüklenir ve `git status` ile doğrulanır.

| # | Mutasyon | Hedef nöbetçi | Sonuç |
|---|---|---|---|
| A7D5-1 | `operatorBalance`ta ekran yeniden TEMBEL yüklenir (`import.meta.glob` geri) | `tembelModul` | YAKALANDI |
| A7D5-3 | Bir test dosyasına `configure({ asyncUtilTimeout: 5_000 })` eklenir | `beklemeButcesi` | YAKALANDI |
| A7D5-4 | Bir test dosyasına `vi.setConfig({ testTimeout })` eklenir | `beklemeButcesi` | YAKALANDI |
| A7D5-5 | Bir çağrı yeri bütçesi 4000 → 6000 yapılır | `beklemeButcesi` (envanter) | YAKALANDI |
| A7D5-6 | "Cevap anahtarı" dalına **adsız** alan eklenir | `adminKataloglarGoc` | YAKALANDI |
| A7D5-6b | Aynı dala **adlı** alan eklenir | `adminKataloglarGoc` (yeni kimlik) | YAKALANDI |
| **A7D5-6c** | **Aynı mutasyon + ESKİ `adlarDogru(0)` iddiası** | eski hâli | **YAKALANMADI (15/15 yeşil)** — ölü iddianın kanıtı |
| A7D5-7 | Katılımcı paneli dalına adlı alan eklenir | `examOturumlariGoc` | YAKALANDI |
| A7D5-8 | Dedektör her zaman `[]` döndürür (alet kaçışı) | `tembelModul` | YAKALANDI |
| A7D5-9 | Dedektör `import.meta.glob`u görmez olur | `tembelModul` | YAKALANDI |
| A7D5-10 | Bütçe dedektörü hiçbir dosyayı taramaz | `beklemeButcesi` | YAKALANDI |
| A7D5-11 | `dosyaBeklemeButcesi` geri almayı BIRAKIR (sızıntıya döner) | `beklemeButcesi` (yardımcı) | YAKALANDI |
| A7D5-12 | Geri alma "önceki"yi değil sabit 1000'i yazar | `beklemeButcesi` (yardımcı) | YAKALANDI |
| A7D5-13 | `dosyaBeklemeButcesi(5_000)` → `(9_000)` | `beklemeButcesi` (envanter) | YAKALANDI |

A7D5-6c bu paketin en öğretici satırıdır: aynı üretim kusuru, eski iddiayla
**sessizce geçiyor**, yeni iddiayla kırılıyor. "Test geçti" ile "test nöbet
tutuyor" arasındaki farkın ölçülmüş hâli.

---

## 6. Bulunan kusurlar (test tarafı) — hepsi bu pakette bulundu

| # | Kusur | Nasıl bulundu | Canlı mıydı | Düzeltme |
|---|---|---|---|---|
| **AK-1** | `configure({ asyncUtilTimeout: 5_000 })` dosyalar arasına SIZIYOR; iki dosya, aynı işçide sonra koşan her dosyanın bütçesini beş katına çıkarıyordu | sonda testi (`--singleFork`) | **EVET** — hangi dosyaların etkilendiği tohuma göre değişiyordu | sızdırmayan `dosyaBeklemeButcesi` + nöbetçi |
| **AK-2** | `sayimOturumlariGoc`un "Yeniden dene" iddiası, AK-1'in sızıntısıyla ayakta duruyordu | AK-1 düzeltilince tohum 5001'de kırmızı düştü | **EVET** (gizli borç) | ölçülmüş çağrı yeri bütçesi (3000) |
| **AK-2b** | `adminKataloglarGoc` K-2 (denetimin işaret ettiği test) da aynı sızıntıyla ayakta duruyordu | sızıntı düzeltildikten sonra tohum 5153 | **EVET** (gizli borç) | ölçülmüş çağrı yeri bütçesi (3000) |
| **AK-3** | On iki test dosyası ağır modülleri koşum evresinde yüklüyordu (red-first idiomunun kalıntısı) | AST dedektörü | evet (süre + zaman aşımı riski) | statik import ×10, gerekçeli istisna ×2 |
| **AK-4** | `adlarDogru(0)` iki çağrı yerinde HİÇBİR ŞEY iddia etmiyordu | ölü iddia taraması + ters prova | evet (yalancı yeşil) | kimlik kontrolü |
| **AK-5** | Üç nöbetçi testin adı ölçtüğü eşikten kopmuştu | eşik/ad karşılaştırması | hayır (yanıltıcı) | adlar güncellendi |
| **AK-6** | `vi.setConfig({ testTimeout: 20_000 })` iki dosyada `vitest.config.ts` kuralını deliyordu | envanter | hayır (gizleme) | kaldırıldı; ölçüldü, 9 sn yetiyor |
| **AK-8** | `flashcardsKaldirildi` R7, `App`in `React.lazy` rotalarını sorgu bütçesinin içinde yüklüyordu — dedektörün göremediği yol | tohum 5103 | evet (kararsız) | rota hedefleri statik import |
| **AK-7** | Ölü `HENÜZ YAZILMADI` dalları (10 dosya): tetiklenmesi imkânsız hata yolları | Görev 2 göçü | hayır | glob'la birlikte gitti |

### 6b. Kendi usul kusurum

Paketin başındaki tohum turunu koşarken ağacı düzenledim ve turu kirlettim;
ayrıntı ve alınan ders §2b'nin sonundaki nottadır.

### 6c. Ölçüm aletinin kendi sınırı (rapora yazılmadan geçilmedi)

`asyncWrapper` sarmalayıcısıyla ölçülen süre bir üst sınırdır: `await`
sonrasındaki devam mikro-görevi, tıkanmış olay döngüsünde gecikebilir. Bunun
somut kanıtı tablodadır: `adminStoreVariants:188` çağrısı 1500 ms'lik bütçesiyle
**geçtiği hâlde** 1550 ms ölçüldü. Bu yüzden ölçüm "bütçe şu kadar olmalı"
demek için değil, "hangi çağrı yerleri sınıra değiyor" demek için kullanıldı;
bütçe kararları ayrıca davranışla (tohum turu) sınandı.

---

## 7. Kapsam, borç ve dokunulmayanlar

### 7a. Kapsam disiplini

`git diff --stat` (aşağıda §8) yalnız şunları gösterir: test dosyaları, test
yardımcıları (`src/test-utils/`), nöbetçiler (`src/__guards__/`) ve test destek
betikleri (`frontend/scripts/*.mjs`). **Üretim kodu ve ekran dosyası
değişmedi.** Mutasyon provalarında üretim dosyalarına geçici dokunuldu; her
biri koşumdan sonra yedekten geri yüklendi ve `git status` ile temiz olduğu
doğrulandı.

### 7b. Bilinçli olarak yapılmayanlar

| Ne | Neden |
|---|---|
| `adminKataloglarGoc`a `import "…/duzenlemeYuzeyi"` eklemek | modül grafikte zaten var; ölçülebilir etkisi yok ve K-2'yi düzeltmezdi — tören olurdu (§1a/§1c) |
| Kalan 4000 ms'lik bütçeleri daraltmak | elde dağılım değil tek koşumun tepe değeri var (§3e) |
| `rawButton`/`adsizKontrol` tavanlarını kimliğe çevirmek | ikisi de sıfır değil; düşüşleri meşru ilerleme (§4d) |
| `calismaZamaniKapisi` ve `zodTurkce`nin tembel yüklemesini kaldırmak | ikisinde de tembel yükleme testin KONUSU (§2c) |
| Global `asyncUtilTimeout`u geri getirmek | İP-A6b BULGU-10 kararı; bu paket o kararı GÜÇLENDİRDİ (§3c) |

### 7c. Yeni borç

| Etiket | Borç | Neden şimdi değil |
|---|---|---|
| **TB-A7d5-1** | Çağrı yeri bütçeleri tek koşumun tepesine göre değil, N tohumluk **dağılıma** göre daraltılmalı (bugün 3–4 sn'lik regresyon gizlenebiliyor) | ölçüm altyapısı var (`asyncWrapper` sarmalayıcısı) ama N tohumluk toplama ~1 saat CPU ister; ayrı paket |
| **TB-A7d5-2** | `operatorPanel` 34 testiyle suite'in en yavaş dosyası (19,5 sn) — sekiz ekranı tek dosyada topluyor; ekran başına bölünmesi `calismaZamaniKapisi`da işe yaramıştı | bu paketin kapsamı kararsızlık, hız değil |
| **TB-A7d5-4** | Tembel modül dedektörü YALNIZ test dosyalarına bakıyor; üretim kodundaki `React.lazy` sınırları (rota tablosu) görünmüyor — AK-8 bu yüzden ancak tohumla bulundu | üretim grafiğini izleyen bir tarama, `App` rota tablosunun tamamını test bağımlılığı saymak demek; ayrı tasarım gerektirir |
| **TB-A7d5-3** | Bekleme bütçesi ölçüm aracı (geçici `asyncWrapper` kurulumu) commit edilmedi; her ölçümde yeniden yazılıyor | kalıcı hâli test kurulumuna sızıntı riski getirir; önce TB-A7d5-1'in ihtiyacı netleşmeli |

---

## 8. Değişen dosyalar

**Üretim kodu ve ekran dosyası YOK.** Değişenler:

| Dosya | Ne |
|---|---|
| `frontend/scripts/tembel-modul.mjs` | **YENİ** — tembel modül dedektörü (AST) |
| `frontend/scripts/bekleme-butcesi.mjs` | **YENİ** — bekleme bütçesi envanteri (AST) |
| `frontend/src/__guards__/tembelModul.test.ts` | **YENİ** — 7 test |
| `frontend/src/__guards__/beklemeButcesi.test.ts` | **YENİ** — 13 test |
| `frontend/src/test-utils/beklemeButcesi.ts` | **YENİ** — sızdırmayan dosya kapsamlı bütçe |
| `…/operatorPanel.acceptance.test.tsx` | 8 ekran statik; iki ezme kaldırıldı; bütçe sızıntısız hâle getirildi |
| `…/operatorBalance.acceptance.test.tsx` | ekran statik; iki ezme kaldırıldı; bütçe 5000 → 3000 (sızıntısız) |
| `…/courierHandover.acceptance.test.tsx` · `…/ip19Filo.acceptance.test.tsx` · `…/packingScreens.acceptance.test.tsx` | ekranlar statik |
| `…/PackageLabel.test.tsx` · `…/PackingLabelSheet.test.tsx` | modüller statik (gevşek tip sözleşmesi korunarak) |
| `…/flashcardsKaldirildi.test.tsx` | `App` statik **+** AK-8: `React.lazy` rota hedefleri statik |
| `…/lib/packing.test.ts` · `…/lib/operatorAgenda.test.ts` | modüller statik |
| `…/sayimOturumlariGoc.acceptance.test.tsx` | AK-2: ölçülmüş çağrı yeri bütçesi (3000) |
| `…/adminKataloglarGoc.acceptance.test.tsx` | AK-2b: K-2'ye ölçülmüş bütçe (3000) **+** ölü `adlarDogru(0)` → kimlik kontrolü |
| `…/examOturumlariGoc.acceptance.test.tsx` | ölü `adlarDogru(0)` → kimlik kontrolü |
| `frontend/src/__guards__/uiBaseline.test.ts` | üç bayat başlık |

---

## 9. Ne kanıtlandı, ne kanıtlanmadı

**Kanıtlandı.**

* `configure({ asyncUtilTimeout })` işçi içinde dosyalar arasına sızıyor —
  sonda ölçümüyle iki yönlü (sızıntı varken 5000, düzeltmeden sonra 1000).
* Bu sızıntı en az bir başka dosyanın gerçek ihtiyacını gizliyordu
  (`sayimOturumlariGoc`, tohum 5001).
* On iki test dosyası ağır modülleri koşum evresinde yüklüyordu; kaldırılınca
  suite'in toplam test süresi %34 düştü, hiçbir iddia gevşetilmedi.
* K-2 ve `sayimOturumlariGoc` dahil ÜÇ testin bütçesi başka dosyalara emanetti;
  sızıntı kalkınca üçü de kırmızı düştü ve ölçülmüş bütçelerle kapatıldı.
* İki `adlarDogru(0)` çağrısı hiçbir şey iddia etmiyordu — aynı üretim
  mutasyonu eski hâlde YAKALANMIYOR, yeni hâlde YAKALANIYOR.
* Yeni iki nöbetçinin ve bütçe yardımcısının nöbet tuttuğu 12 mutasyonla
  gösterildi (aletin kendisine yapılan üç kaçış denemesi dahil).

**Kanıtlanmadı / bilinen sınırlar.**

* Bütçe değerlerinin DOĞRU değer olduğu kanıtlanmadı; yalnız "gerekli" oldukları
  (operatorPanel) ya da "sınıra değdikleri" (diğerleri) gösterildi → TB-A7d5-1.
* `operatorBalance` için kırmızı bir tohum GÖRÜLMEDİ; bütçesi ölçülen tepeye
  (1.184 ms) dayanarak indirildi ama sıfırlanmadı. Sıfırlamak isteyen, önce
  N tohumluk dağılımı ölçmelidir.
* Ölçüm aracı üst sınır verir (§6c); alt sınır ölçülmedi.
* Statik dedektör sınıfın TAMAMINI kapsamıyor: üretim kodundaki `React.lazy`
  sınırları görünmüyor (AK-8 → TB-A7d5-4). Bu pakette o boşluğu tohum kapattı;
  yani iki yöntem birbirinin yerine geçmiyor.
* K-2'nin kararsızlığı **kanıtlandı** (tohum 5153) ve kapatıldı; ama "3000 ms
  yeterli bir bütçe" olduğu kanıtlanmadı — yalnız 12 tohumda yeşil kaldığı
  gösterildi. Aynı sınır tablodaki bütün bütçeler için geçerlidir (TB-A7d5-1).
