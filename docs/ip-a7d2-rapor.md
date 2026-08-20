# İP-A7d2 — Göç dalgası 2: altı ekran

**Taban:** `259df3b` (A7d1) · branch `feat/medusa-ui-taban`
**Girdi:** `docs/ip-a7d1-rapor.md`, `docs/denetim2-a4-a6.md`, `docs/ip-a6b-rapor.md`

---

## Özet

| | |
|---|---|
| Göç eden ekran | **6** |
| **Sözleşme kusuru** | **4** (SK-3'ün kardeşi SK-4, satır adı SK-5, koyu tema SK-6, + SK-3'ün kendisi kapatıldı) |
| Ortak katmanda eksik (kusur değil, sınır) | **0** |
| Ekran regresyonu | **1** (satır içi formlarda odak taşınmıyordu — gerçek tarayıcıda bulundu) |
| Kasıtlı davranış değişikliği | **7** |
| Yeni test | **92** (17+15+16+12+15+14 kabul + 3 sözleşme) |
| Eşik | **4'ü de düştü**: 182→130 · 37→26 · 28→20 · 3→**0** |
| Mutasyon provası | **13/13 yakalandı** |
| Gerçek tarayıcı | 6 ekran, 20 ekran görüntüsü, tüm kapılar geçti |
| Bekleme bütçesi | **artırıldı**: 3 → 6 çağrı yeri (ölçümüyle, §Görev 5) |

---

## Görev 1 — SK-3 sessiz olmaktan çıktı

### Mekanizma: meşru durum kendini BEYAN eder

A7d1 otomatik uyarı eklememişti; gerekçesi doğruydu (sağlayıcısız çağrı meşru
bir kullanımdır) ama sonucu yanlıştı. Bu pakette kural şu oldu:

| Sağlayıcı | Beyan | Sonuç |
|---|---|---|
| var | yok | geçer — pencereli, doğru yazım |
| var | var | geçer — beyan zararsız (içerik nerede olduğunu bilmez) |
| yok | var | geçer — satır içi form, bilinçli |
| **yok** | **yok** | **geliştirmede `throw`** (üretimde elenir) |

Beyan: `useYuzeyKirliFormBekcisi({ …, pencereSiz: true })`. Tip olarak
`pencereSiz?: true` — `false` yazılamaz, çünkü "penceresizim ama değilim" diye
bir durum yok.

Kontrol **bütün kancalardan sonra** yapılır: erken `throw` kanca sırasını bozar
ve asıl hatayı React'in "rendered fewer hooks" hatasının altına gömerdi. Hata
mesajı teşhis değil **talimat** verir ve iki çıkış yolunu da adıyla sayar.

### Mevcut meşru çağrı yerleri

Paket başladığında `useYuzeyKirliFormBekcisi`nin **tek** üretim çağrı yeri
vardı (`LibraryEditorModal`, pencere içinde → beyan gerekmez). Yani "beyan
edilecek mevcut satır içi çağrı" sayısı **0**'dı.

Göçle birlikte **6 gerçek `pencereSiz` çağrı yeri** doğdu ve hepsi bu dalganın
ekranlarında:

| # | Çağrı yeri | Form |
|---|---|---|
| 1 | `ProductForm` (`mode="create"`) | ürün ekleme, satır içi |
| 2 | `CourierManager` · `KuryeEklemeFormu` | kurye ekle |
| 3 | `CourierManager` · `KuryeSatirFormu` | satır düzenleme |
| 4 | `CourierManager` · `HesapOlusturmaFormu` | giriş hesabı |
| 5 | `CourierManager` · `SifreSifirlamaFormu` | şifre sıfırlama |
| 6 | `DeliveryVehiclesPage` · dört satır içi form | araç/nokta ekle-düzenle |

`ProductForm` özel bir örnek ve tesadüf değil: **aynı bileşen iki yerde
yaşıyor** — `ProductsPanel`de satır içi (oluşturma), `EditProductModal`de
pencere içinde (düzenleme). Beyan bu yüzden `mode`dan türer
(`pencereSiz: isEdit ? undefined : true`). Beyanın çağrı yerine göre değişmesi
gereken ilk gerçek örneği budur.

### Ters prova (üç yönlü)

`src/components/admin/ui2/sk3Beyani.test.tsx` — üçü **birlikte** anlamlı;
ilki tek başına, kanca her koşulda patlasa da geçerdi.

| Senaryo | Beklenen | Sonuç |
|---|---|---|
| sağlayıcı yok + beyan yok | patlar, mesaj iki yolu sayar | ✔ |
| sağlayıcı yok + beyan var | geçer | ✔ |
| sağlayıcı var + beyan yok | geçer | ✔ |

Ayrıca mutasyonla da kanıtlandı: **A7D2-5** (`throw` devre dışı) ve **A7D2-6**
(gerçek çağrı yerinden beyan silindi) — ikisi de yakalandı.

**A7d1'in "her pencereli ekranda kirli-kapatma testi zorunlu" koşulu
KALKMADI**: dalganın pencereli dört ekranının dördünde de o test var.

---

## Görev 2 — Ekran seçimi

Altı ekran. Ölçüt yük değil **yazım çeşitliliği**: altısı da sözleşmenin farklı
bir yüzünü zorluyor.

| # | Ekran | Neden bu |
|---|---|---|
| 1 | `components/ExamSessionsManager.tsx` | Görev tanımının zorunlu ilk adayı. Etiketsiz overlay + iki pencere durumu + 14 ham düğme + 2 adsız kontrol. Ayrıca **tarih/sayı ağırlıklı tek gerçek form** (`datetime-local` + üç `number`) — A6c'nin koyu tema düzeltmesinin ilk gerçek sınavı. |
| 2 | `pages/dashboards/AdminExamCatalogs.tsx` | (1)'in **ev sahibi** ve A7d1'in yazdığı bağımlılık ("onu göç ettirmeden ölçülemez"). İkinci etiketsiz overlay + yetkiye bağlı salt-okunur dal. |
| 3 | `pages/admin/AdminPayoutsPage.tsx` | **Üçüncü ve son** etiketsiz overlay. Ayrıca kilitli kararın açık ihlali (`disabled={gecersiz}`) ve `useState`te yaşayan bir **filtre** (sekme). Para ekranı. |
| 4 | `pages/admin/packing/PackagesPage.tsx` | **A7d1'in bilinen sınırı 1'i kapatıyor**: satır tıklaması ile satır aksiyonu bir arada olan ilk gerçek ekran. Üç etkileşimli kaynak türü birden (`a[href]`, `button`, `input[checkbox]`). Elle yazılmış liste + elle sayfalama. |
| 5 | `components/admin/CourierManager.tsx` | Tabanın **en büyük adsız kontrol kalemi** (9). Formlarının hiçbiri pencerede değil → `pencereSiz` beyanının gerçek sınavı. Ayrıca hover'a bağlı satır aksiyonları. |
| 6 | `pages/admin/delivery/DeliveryVehiclesPage.tsx` | On üç alanlı **sayısal/zaman** formu (`number` + `time`). A7d1 bunu "alanları zaten adlı" diye elemişti — doğru ama eksik okuma: `Form.*` etiketleme değil **hatanın nereye yazıldığı** meselesi. |

### Elenen adaylar

| Aday | Neden elendi |
|---|---|
| `AdminUsersPage` | `onRowClick` var ama **satır aksiyonu yok**, pencere durumu yok, ham düğme yok, adsız kontrol yok — dört sayacın hiçbirine dokunmuyor. SK-1'i `PackagesPage` zaten gerçek üç kaynak türüyle sınıyor. (Yine de SK-5 düzeltmesi yüzünden tek satırlık zorunlu bir değişiklik aldı; aşağıda.) |
| `AdminDemandsPage` | A7d1'de "`AdminBookingsPage`in dar kopyası" diye elenmişti; bu pakette de aynı sebep geçerli — yeni bir yazım getirmiyor. |
| `MapPicker` · `PersonalizeModal` · `ImageCropModal` | Ekran değil, paylaşılan widget'lar. Kendi tasarım sözleşmeleri var (harita, kırpma tuvali); form göçünün konusu değiller. |
| `OperatorLibrary` (7 adsız) | Operatör paneli yüzeyi (İP-14); ayrı bir sahip ve ayrı bir kabul matrisi. Karıştırmak iki paketin ölçümünü de bulandırırdı. |
| `DeliveryDriver` (19 ham düğme) | Saha/mobil ekranı; panel tasarım dilinde değil (tam ekran, tek elle kullanım, kamera). Kendi dalgasını hak ediyor. |
| `AdminHome` (12 ham düğme, 2 pencere) | Karma pano; bölümleri başka ekranların kabuğu. Tek başına göçü, göç etmemiş bölümleri de sürüklerdi. |

---

## Görev 3 — Kırmızı matris (implementasyondan ÖNCE)

Her ekran iki bölüm yazıldı: (1) mevcut davranışı sabitleyen iddialar — göç
bunları kırmamalı, (2) göçün getirdiği davranış — yazıldığı anda kırmızı.

| Dosya | Toplam | Yazıldığında KIRMIZI |
|---|---|---|
| `components/examOturumlariGoc.acceptance.test.tsx` | 17 | **12** |
| `pages/dashboards/adminKataloglarGoc.acceptance.test.tsx` | 15 | **9** |
| `pages/admin/adminHakedisGoc.acceptance.test.tsx` | 16 | **10** |
| `pages/admin/packing/paketlerGoc.acceptance.test.tsx` | 12 | **3** |
| `components/admin/kuryeYonetimiGoc.acceptance.test.tsx` | 15 | **11** |
| `pages/admin/delivery/araclarGoc.acceptance.test.tsx` | 14 | **5** |
| `components/admin/ui2/sk3Beyani.test.tsx` | 3 | **3** |
| **Toplam** | **92** | **53** |

### "Hiç koşmadı" durumu — kırmızıdan AYRI raporlanır

Üç test **yanlış sebeple** kırmızı düştü ve düzeltilmeden sayılmadı:

1. `examOturumlariGoc` · "KATALOG seçili dalı" — katalog listesi ayrı bir
   sorgudan gelir; seçenek DOM'a düşmeden yapılan `change` jsdom'da sessizce
   yutuluyor ve değer `""` kalıyordu. Önce seçeneğin varlığı beklenecek
   şekilde düzeltildi.
2. `examOturumlariGoc` · "başlık boşken…" — `findByRole("alert")` birden çok
   eşleşme buluyordu (aynı anda birden fazla alan hatalı). İddia BAŞLIK
   alanının kendi hata düğümüne bağlandı (`aria-describedby` üzerinden);
   "bir yerde bir alert var" iddiası zayıftı.
3. `adminKataloglarGoc` · "yetki yok" — `AccessDenied` metnini serbest metinle
   arıyordu; başlık rolüyle sabitlendi.

Ayrıca `paketlerGoc`in **3 kırmızısı** düşük görünüyor ve sebebi dürüstçe
şudur: P-2'nin üç iddiası göçten önce **yanlış sebeple yeşildi** — ekranda
henüz `onRowClick` yoktu, dolayısıyla "aksiyona basmak satırı açmaz" iddiası
boşlukta geçiyordu. Göç edilir edilmez ikisi kırmızıya döndü ve SK-1 ile
SK-5'i ortaya çıkardı.

### Zorunlu ikili — her ekranda

| Ekran | Kirli formda kapatma sorar | Tüm koşullu dallar + alan adları |
|---|---|---|
| ExamSessionsManager | ✔ (S-2) | ✔ (S-3, beş dal) |
| AdminExamCatalogs | ✔ (K-3) | ✔ (K-4, üç dal) |
| AdminPayoutsPage | ✔ (H-4) | ✔ (H-5, iki dal) |
| PackagesPage | pencere yok (yalnız onay) | dallar P-1/P-3'te |
| CourierManager | pencere yok → **rota koruması** (KY-5) | ✔ (KY-3, dört dal) |
| DeliveryVehiclesPage | pencere yok → satır içi | ✔ (AR-3, dört dal) |

Pencere içermeyen üç ekranda "kapatma sorar" testi anlamsızdır; onun yerine
`CourierManager`de bekçinin GERÇEKTEN kurulduğu `beforeunload` üzerinden
ölçülür (kirliyken olay iptal edilir, temizken edilmez — çift yönlü).

Dallar **kartezyen çarpılmadı**; kural "her koşullu alan en az bir kez".

---

## Görev 4 — Göç, ekran ekran

Altısı **ayrı ayrı** yeşile alındı; her adımda ilgili suite yeniden koşuldu.

### (1) `ExamSessionsManager`

| | Önce | Sonra |
|---|---|---|
| Editör penceresi | elle `fixed inset-0`: `role`/`aria-modal`/odak tuzağı/ESC yok | `DuzenlemePenceresi` + kirli form bekçisi |
| Doğrulama | `submit()` içinde iki `if`, ilk hata `toast.error` | `zod` + `react-hook-form`, hata alanda, odak ilk hatalı alana |
| Sayısal alanlar | `Number(e.target.value)` — boş kontenjan sessizce **0** gidiyordu | şemada string + gönderimde çevrim; boş alan hata verir |
| Pencere durumu | `editor` + `iptalSoruluyor` + `yayinSoruluyor` | üç yüzey |
| Ham düğme | 14 | 0 |
| Adsız kontrol | 2 (sonuç tablosundaki net/sıra) | 0 — ad öğrenci adını içerir |

### (2) `AdminExamCatalogs`

Aynısı, artı: liste **hatası** artık boş durumdan ayrı (`ErrorState` +
"Yeniden dene"; eskiden 500'de "Henüz katalog eklenmedi" yazıyordu), silme
onayı yüzeye taşındı, boş sayısal alan `0` değil `null` gidiyor.

### (3) `AdminPayoutsPage`

| | Önce | Sonra |
|---|---|---|
| Gönder düğmesi | `disabled={gecersiz \|\| isPending}` — **kilitli karar ihlali** | açık kalır; geçersizse gönderim yapılmaz, hata TUTAR alanında |
| Sekme | `useState<"pending"\|"history">` | `useUrlDurumu` — paylaşılabilir, geri tuşu çalışır, varsayılan adrese yazılmaz |
| İki liste, iki hata yüzeyi | biri elle kırmızı kutu + "Tekrar dene", diğeri `ErrorState` + "Yeniden dene" | ikisi de `ErrorState` |
| Pencere | elle `fixed inset-0` | `DuzenlemePenceresi` (para ekranı — kirli form koruması burada konfor değil) |

### (4) `PackagesPage`

| | Önce | Sonra |
|---|---|---|
| Liste | elle `<ul>` + elle sayfalama düğmeleri | ortak `DataTable` + `renderMobileRow` |
| Filtre/sayfa | elle `useSearchParams`, her çağrı yerinde elle `delete("sayfa")` | `useUrlDurumu` (adres adları **korundu**: `durum`,`siparis`,`sayfa`) |
| Boş durum | tek metin ("Bu süzgeçte paket yok") — depoda hiç kutu yokken bile | ikiye ayrıldı + "Süzgeci temizle" çıkış yolu |
| Satır tıklaması | yalnız `PKT-…` bağlantısı | tüm satır/kart açıyor, aksiyonlar ve seçim kutusu **yutulmuyor** |

Enum beyaz listesi (`GECERLI_DURUMLAR`) **kaldı**: `useUrlDurumu` tip ve
varsayılan yönetir, `?durum=drop_table` gibi bir değeri eleyemez.

### (5) `CourierManager`

Dört satır içi formun dördü de `Form.*` + `zod`a geçti (9 adsız kontrol → 0),
`toast` doğrulaması alanlara indi, iki onay penceresi yüzeye taşındı, 15 ham
düğme `Button`a geçti. Gizli vesikalık `<input type="file">`ına **gerçek ad**
verildi — `hidden` özniteliği kullanılmadı, çünkü o borcu kapatmadan sayaçtan
düşürürdü.

### (6) `DeliveryVehiclesPage`

Yerel `Field` sarmalayıcısı `Form.Item`/`Form.Label`/`Form.Control`/
`Form.ErrorMessage`e çevrildi; `formValid()`in tek cümlesi on üç alanın kendi
şemasına dağıldı ("Koordinat aralık dışı" artık ENLEM alanının altında). 14 ham
düğme `Button`a, silme onayı yüzeye geçti.

---

## Kusur sınıflandırması — dört kategori, AYRI AYRI sayılmış

### A. Sözleşme kusurları — **4**

> Hepsi ortak katmanda; düzeltilmeseydi kalan ekranlara kopyalanacaktı.

**SK-3 (kapatıldı) · beyansız + sağlayıcısız çağrı artık patlıyor.**
A7d1'in bulduğu tuzağın kendisi bu pakette kapandı (Görev 1). Kusur A7d1'de
tespit edilmişti; A7d2'nin katkısı **sessizliği kaldırmak**.

**SK-4 · `DuzenlemePenceresi`nin içeriği bekçiyi HİÇ çağırmayabiliyordu
(ÜRETİMDE CANLI).**
`EditProductModal` İP-A6'da ortak pencereye geçirilmişti ve o paketin raporu
kazanç listesine "kirli formda kapatma onayı"nı da yazmıştı. Ama pencere
korumayı İÇERİKTEN öğrenir ve `ProductForm` `useYuzeyKirliFormBekcisi`yi hiç
çağırmıyordu: **25 alanlık ürün formunda ×/ESC/dış tıklama, yazılan her şeyi
sormadan siliyordu.** SK-3'ün kardeşi ("kanca yanlış yerde" değil, "kanca hiç
yok") ve A7d2'nin `throw`u onu **yakalamaz** — olmayan çağrının beyanı da
olmaz. Düzeltme: `ProductForm`a bekçi eklendi (beyan `mode`dan türer).
Mutasyon: **A7D2-7**.

> **Kapsam istisnası, açıkça:** `ProductForm` bu dalganın altı ekranından
> biri DEĞİL. "Seçilen ekranlar ve `ui2/` dışında ekran dosyası değişmedi"
> kabul kriteri bu tek dosyada bilerek çiğnendi; gerekçe canlı veri kaybıdır
> ve değişiklik iki satırdır (kanca çağrısı + import). Alternatif, bilinen bir
> veri kaybını bir dalga daha üretimde bırakmaktı.

**SK-5 · Satırı açan görünmez denetim, kartın AKSİYON metinlerini yutuyordu.**
A7d1 (SK-2) mobil kartın tıklanabilirliğini kartın içine serilen görünmez bir
düğmeyle çözmüş ve adını `aria-labelledby` ile **kartın tüm içeriğinden**
almıştı. Gerekçe iyiydi (çağıran taraf prop yazmaz, unutamaz) ama A7d1'in üç
ekranının hiçbirinde kartın İÇİNDE aksiyon yoktu. `PackagesPage`te ölçüldü:

* ekran okuyucu o düğmeyi `"PKT-000077 Sipariş #501 … Yeniden paketle Bozuldu
  olarak işaretle"` diye okuyor — kartın bütün aksiyonları tek düğmenin adına
  karışıyor;
* aynı ada sahip **iki** denetim doğuyor ("Yeniden paketle" hem gerçek aksiyon
  hem satırı açan görünmez düğme) ve klavye/otomasyon **yanlış olanı**
  tetikliyor. Test tam olarak bunu yaptı ve satır detayına gitti.

Düzeltme: ad çağıran taraftan gelir (`satirAdi`) ama **unutulamaz** —
`onRowClick` verildiğinde tip düzeyinde zorunlu (ayrık birleşim). Üç çağrı
yerinin üçü de tsc tarafından zorlandı. Mutasyon: **A7D2-8**.

> `AdminUsersPage` bu yüzden tek satır değişti (`satirAdi` eklendi). Tip kapısı
> kurulunca derleme onsuz geçmiyor; alternatif kapıyı gevşetmekti.

**SK-6 · `color-scheme: dark` yalnız `type="number"` için kuruluyordu.**
A6c bu düzeltmeyi eklerken ölçtüğü tek yerel widget artır/azalt oklarıydı. Ama
tarih ve saat girdileri de yerel widget çizer. Bu dalganın gerçek tarayıcı turu
ölçtü: koyu temada `Tarih & saat` (`datetime-local`) ve `Vardiya
başlangıç/bitiş` (`time`) alanlarının `color-scheme` değeri `normal` kalıyordu
— koyu panelin üstünde beyaz takvim/saat ikonu. A7d1'in üç ekranında tarih
alanı YOKTU; bu yüzden eksik görünmemişti. Kapsam `date`/`datetime-local`/
`time`/`month`/`week`/`color`'a genişletildi. Mutasyon: **A7D2-12**.

### B. Ortak katmanda eksik (kusur değil, göçü engelleyen sınır) — **0**

A7d1'in `Dialog.genislik` eklemesi yetti: altı ekranın hiçbiri ortak pencereye
sığmamazlık etmedi. **Üçüncü bir genişliğe gerek olmadı** — oturum ve katalog
editörleri `dar`da (max-w-lg) rahat oturuyor; A7d1'in `genis`i (max-w-2xl)
kütüphane editörü için yeterliydi ve bu pakette kullanılmadı bile.

Bu sayının **sıfır** olması dalga 3 için en güçlü sinyal (aşağıda).

### C. Ekran regresyonu — **1**

**Satır içi formlarda odak ilk hatalı alana taşınmıyordu.**
`ilkHatayaOdaklan` yardımcısı hataları `form.formState.errors`ten okuyordu;
gönderim anında o anlık görüntü HENÜZ BOŞ. jsdom testleri yalnız
`aria-invalid`e baktığı için bunu görmedi; **gerçek tarayıcı turu**
`document.activeElement === <body>` ölçtü. Hatalar artık `onInvalid`
argümanından okunuyor (`CourierManager` + `DeliveryVehiclesPage`), iki kabul
testine odak iddiası eklendi. Mutasyon: **A7D2-13**.

Bu bir "göçün getirdiği" regresyondur (eski kodda toast vardı, odak diye bir
kavram yoktu) ve testle değil üretim koduyla düzeltildi.

### D. Kasıtlı davranış değişiklikleri — **7**

| # | Değişiklik | Neden |
|---|---|---|
| 1 | Doğrulama toast → alan | A2'den beri yazılı sözleşme; kullanıcı hangi alanı düzelteceğini göremiyordu. |
| 2 | Hakediş gönder düğmesi artık geçerlilikle kapanmıyor | Kilitli kararın açık ihlaliydi. |
| 3 | Hakediş sekmesi adrese taşındı | "Filtreler URL'de" kilitli kararı; paylaşılan bağlantı hep ilk sekmeye düşüyordu. |
| 4 | Satır aksiyonları hover'a bağlı değil | Projenin yazılı kuralı ("hover-only aksiyon YOK — dokunmatik birinci sınıf") iki ekranda çiğnenmişti; tablette satır düzenlenemiyordu. |
| 5 | Paketler boş durumu ikiye ayrıldı | "Süzgeç eşleşmedi" bir düzeltme talimatı, "hiç paket yok" bir durum bildirimi. |
| 6 | Katalog listesi hatası artık boş durumdan ayrı | 500 alırken "Henüz katalog eklenmedi" demek "kataloglarım silinmiş" diye okunur. |
| 7 | Editörlerdeki "Vazgeç" kaldırıldı | `DuzenlemePenceresi` kapatmayı ×/ESC/dış tıklamadan **bekçiye bağlı** veriyor; ikinci bir vazgeç aynı işi bekçiden geçmeyen bir yolla tekrarlardı (A7d1'de verilen kararın devamı). |

Ayrıca **üç mevcut test bilinçli güncellendi**: `DataTable` mobil kartı ve
masaüstü satırını birlikte basar, bu yüzden `PackagesPage`in satır içeriği artık
iki düğümde bulunur (`packingLabel` × 2, `packingScreens` × 1). Testler
`getAllBy…` + tam sayı iddiasına çevrildi; sayı gevşetilmedi.

### Yanlış çıkan hipotezler (dürüstlük kaydı)

1. **"`DataTable` mobil kartın adı sorunu `aria-labelledby`i kaldırmakla
   çözülür."** Yanlış: adsız bırakmak ekran okuyucuda "button" diye okunan bir
   denetim üretir. Doğru çözüm adı çağıran taraftan almak ama **tip düzeyinde
   zorunlu kılmak**tı — A7d1'in "unutulur" endişesi haklıydı, cevabı isteğe
   bağlı bir prop değil ayrık birleşim.
2. **"`DeliveryVehiclesPage`in alanları tek bir render-prop sarmalayıcıdan
   geçirilebilir."** Çalışma zamanı kusursuzdu (dal testi 13 alanı adlı buldu)
   ama nöbetçi sayacı **13 sahte borç** raporladı: sayaç `Form.Control`
   içindeki `<input>`u bir fonksiyon gövdesinin ardında göremez. İP-A6b'nin
   M-A kaçışının aynadaki hâli (orada gerçek borç gizleniyordu, burada sahte
   borç üretiliyordu). Alanlar açık `Form.Field` bloklarına çevrildi.
3. **"`packing` suite'inin zaman aşımı `@tanstack/react-table`ten."** Yanlış:
   yalnız `data-table` ön-yüklendiğinde süre **10 sn'de kaldı**. Ağır olan
   `ui2/duzenlemeYuzeyi` üzerinden gelen `@medusajs/ui` idi (ölçüm §Görev 5).

---

## Görev 5 — Bekleme bütçesi: **artırıldı** (bir bulgu olarak)

### Önce ölçüldü, sonra karar verildi

**Bulgu 1 — modül yükleme maliyeti (bütçe ARTIRILMADI, maliyet kaldırıldı).**
Göç iki test dosyasında zaman aşımı üretti. Ölçüm (paralel koşum, modül yükleme
süresi):

| Modül | Önce | Sonra |
|---|---|---|
| `PackingLayout` / `QueuePage` / `StationPage` | 129–581 ms | 34–76 ms |
| **`PackagesPage`** | **10.093 ms** | **68 ms** |
| `OperatorHome` / `Settings` | 546–927 ms | değişmedi |
| **`OperatorSessions`** | **11.235 ms** | ölçülmedi (kapı geçti) |

Sebep: iki dosya ekranları `import.meta.glob` ile TEMBEL yüklüyor ve maliyeti
**ilk testin içinde** ödüyor; göç o ekranları `@medusajs/ui`ye bağladı. Dosyanın
ilk testi (paketleme kuyruğu) o ekranı hiç kullanmadığı hâlde 9 sn'lik bütçeyi
aşıyordu. **Bütçe büyütülmedi**: ağır modüller test dosyasında statik import
edildi, maliyet TOPLAMA evresine geçti (orada test bütçesi yoktur).

**Bulgu 2 — yük altında daralan pencere (bütçe ARTIRILDI).**
Karışık tohum koşumları üç ayrı dosyada aralıklı kırmızı üretti. Ölçüm:

| Koşum | Ölçülen |
|---|---|
| dosya tek başına, 6 karışık tohum | 16/16 yeşil, sınıra yaklaşmadı |
| tam suite · tohum 2013 | **917 ms** (varsayılan 1000 ms) |
| tam suite · tohum 2014 / 2020 / 2027 | 98 / 124 / 207 ms |

Yani sorgu normalde ~100–500 ms'de çözülüyor, paralel yük altında 917 ms'ye
çıkıyor ve **varsayılanın dibine değiyor**. Sahte adapter anında dönüyor;
üretim kodunda bekleyen iş yok — gecikme vitest işçilerinin CPU paylaşımından.

Bu "flaky test" değildir; proje defterinde aynı sınıf iki kez yaşandı ve
"yerelde geçiyor" bir kanıt sayılmadı.

**Bütçe çağrı yeri 3 → 6:**

| # | Dosya | Durum |
|---|---|---|
| 1–3 | `adminStoreDalAdlari` · `storeVariants` · `ticketsPaymentGate` | mevcut |
| **4** | `adminHakedisGoc.acceptance` | **yeni** (ölçüm burada, dosya başında yazılı) |
| **5** | `adminDenetimKayitlari.acceptance` | **yeni** — A7d1'de yazıldı ve o gün yeşildi; suite altı dosya büyüyünce hata yolu sınıra değdi |
| **6** | `storeVariants.acceptance` · "Düzenle" | **yeni** (aynı sınıf, ikinci çağrı yeri) |

### Bunun kendisi bir bulgudur

Üç yeni çağrı yerinin ikisi **bu paketin dokunmadığı** testlerde. Sebep tek:
suite 133 dosyaya çıktı, paralel yük arttı ve 1000 ms'lik varsayılan bu boyutta
dar kalmaya başladı. İP-A6b global `asyncUtilTimeout`u bilinçli kaldırmıştı
(gerçek yavaşlığı maskeliyordu) ve bu paket o kararı **değiştirmedi**. Ama
kayda geçiyor: **yedinci çağrı yeri doğduğunda karar yeniden açılmalıdır** —
o noktada sorun tek tek testler değil, varsayılanın kendisidir.

---

## Görev 6 — Gerçek tarayıcı turu

Sonda: `frontend/scripts/ip_a7d2_tur.mjs` + `scripts/probe/a7d2-probe.html`
(Chrome + CDP, headless). Ölçüm: `docs/ip-a7d2/tur-olcum.json`, **20 ekran
görüntüsü** aynı klasörde.

**Canlı `ceyhandb`ye bağlanılmadı**; sonda axios adapter'ını kendi sahte
sunucusuyla değiştirir, veriler uydurmadır ve gerçek kişisel veri içermez.
**Tur bitince vite sunucusu kapatıldı** (port 5199 doğrulandı).

### Hangi ekrana hangi tur

| Ekran | Tur | Gerekçe |
|---|---|---|
| `paketler` | **TAM** (2 tema × 2 genişlik + etkileşim) | yeni yazım: satır tıklaması + aksiyon + seçim kutusu |
| `oturumlar` | **TAM** (+ odak tuzağı, kirli kapatma, gönderim) | geniş pencere + tarih/sayı formu |
| `araclar` | **TAM** (+ gönderim) | on üç alanlı sayısal/zaman formu |
| `kataloglar` · `hakedis` · `kuryeler` | **KISA** (mobil 380 + koyu) | deseni tekrar eden ekranlar |

### Ölçülenler

**Mobil (380 px).** Altı ekranın altısında da **yatay taşma yok**, iki temada
da. Paketler kartı 296 px (gövde 380), en küçük dokunma hedefi **36 px**,
**iç içe `<button>` 0**.

**SK-1 + SK-5, gerçek ekranda** (paketler, iki tema):

| Ölçüm | Sonuç |
|---|---|
| kart içindeki "Yeniden paketle"ye basınca | onay penceresi açıldı, **satır açılmadı** (`PAKET DETAYI` yok) |
| satırı açan görünmez düğmenin adı | `"PKT-000001 — paket detayı"` — aksiyon metinleri **yutulmuyor** |
| iç içe `<button>` | 0 |

**Odak tuzağı (gerçek klavye).** "+ Oturum" düğmesi odaklanıp `Enter` ile
pencere açıldı: 14 `Tab` boyunca odak **pencereden çıkmadı**, `Shift+Tab`
pencere içinde kaldı, `Escape` kapattı ve **odak açan düğmeye iade edildi**.

**Kirli formda kapatma (gerçek klavye).** Başlık yazıldı, `Escape`:
onay penceresi açıldı (`Kaydedilmemiş değişiklikler var`) ve **editör ayakta
kaldı**.

**Kontrast.** Açık tema `rgb(190,18,60)` → **6,29** · koyu tema
`rgb(251,113,133)` → **6,63** (eşik 4,5).

**Odak ilk hatalı alana.** Oturum editörü: `Başlık`, `aria-invalid="true"`,
pencere içinde. Araç formu: **ilk turda `<body>`ye düştü → C kategorisindeki
regresyon böyle bulundu**; düzeltmeden sonra ilk hatalı alanda.

**Koyu temada yerel widget şeması.** İlk turda:
`datetime-local: normal`, `time: normal` → **SK-6 böyle bulundu**.
Düzeltmeden sonra: oturum `number:dark, datetime-local:dark, number:dark,
number:dark`; araç `number:dark, time:dark, time:dark, number:dark,
number:dark`.

Sondanın kendi geçerlilik kapıları var (13 kapı); tur **hepsi geçerek** bitti.

### Sondanın kendi kusuru (kayda geçer)

İlk koşumda "oturum editörü klavyeyle açılmadı" kapısı düştü ve bu bir **ürün
kusuru değil, sondanın kusuruydu**: CDP'nin `rawKeyDown`u odaklanmış bir
`<button>`da tıklama üretmez (Chrome varsayılan eylemi yalnız metin taşıyan
`keyDown`da uygular). A7d1'in sondası `<tr>` üzerinde kendi `onKeyDown`unu
dinlediği için fark etmemişti. Düzeltilmeden geçilseydi gerçek bir odak
iadesi kusuru varmış gibi raporlanırdı.

---

## Görev 7 — Eşikler

| Ölçüm | A7d1 (eski) | A7d2 (yeni) | Fark |
|---|---|---|---|
| ham `<button` | 182 | **130** | **−52** |
| adsız form kontrolü (kaynak) | 37 | **26** | **−11** |
| ekranda yaşayan pencere durumu | 28 | **20** | **−8** |
| etiketsiz overlay | 3 | **0** | **−3** |
| ölçüm tabanı dosya sayısı | 109 | 109 | 0 (kimlik listesi) |

**Dördü de düştü.** Etiketsiz overlay eşiği artık `toBe(0)` — "artamaz" yönünün
en sert hâli: panelde etiketsiz bir overlay doğduğu gün CI kırılır.

### Kalan borcun nerede olduğu

* **ham `<button` 130:** kalan bilinçli istisnaların hepsi aynı ailedendir ve
  `aria-pressed` taşıyan **seçim durumlarıdır**, aksiyon değil: `AdminStore`
  katlanır bölüm başlığı, kütüphane editörü olanak rozetleri, `PackagesPage`
  durum süzgeci çipleri, `AdminPayoutsPage` sekme şeridi. Ortak `Button`ın
  dolgu/gölge varyantları bu görsel dili taşımıyor.
* **adsız kontrol 26:** en büyük kalemler `OperatorLibrary` 7,
  `LibraryPayoutForm` 5, `DeliveryDriver` 4, `OperatorHome` 3.
* **pencere durumu 20:** 14 dosyaya yayılmış; en yoğunu
  `CountSessionDetailPage` ve `PackingStationPage` (3'er).

### Çalışma zamanı kapısının kimlik listesi

Göç eden altı ekranın altısı da `KAPI_KAPSAMI`nda (sığ kapı) — kapsam
değişmedi. **Beş dosya `DERIN_KAPI`ya eklendi** (dal testleriyle kapandılar);
`CALISMA_ZAMANI_ADSIZ` listesi değişmedi (üç dosya: `ImageCropModal`,
`LibraryPayoutForm`, `MapPicker`). İki yönlü koruma sağlam:
`KAPI_KAPSAMI ∪ KAPI_DISI = taban` ve kesişim boş testleri yeşil.

### Mutasyon provası — **13/13 yakalandı**

Sürücü: ortak `backend/scripts/mutation_drill.py` (`git checkout` kullanmaz,
ham baytları bellekte tutar, her mutasyondan sonra HEAD + `git status
--porcelain` eşitliğini doğrular, CRLF korunur). Çalışma ağacı başta ve sonda
aynıydı.

| # | Mutasyon | Kırılan |
|---|---|---|
| A7D2-1 | ham `<button>` geri kondu (130→131) | eşik testi |
| A7D2-2 | adsız form kontrolü eklendi (26→27) | kaynak eşiği **+ çalışma zamanı kapısı** |
| A7D2-3 | pencere durumu ekrana geri taşındı (20→21) | sayı eşiği + dosya listesi |
| A7D2-4 | etiketsiz overlay geri kondu (0→1) | sayı eşiği + dosya listesi |
| A7D2-5 | SK-3 `throw`u devre dışı | `sk3Beyani` (üç yönlü ters prova) |
| A7D2-6 | gerçek satır içi çağrı yerinden `pencereSiz` silindi | `kuryeYonetimiGoc` |
| A7D2-7 | SK-4: ürün formunun bekçisi kaldırıldı | `adminStoreDalAdlari` D-6 |
| A7D2-8 | SK-5: satırı açan denetimin adı geri alındı | `paketlerGoc` + `satirAksiyonu` |
| A7D2-9 | satır aksiyonları yine hover'a bağlandı | `kuryeYonetimiGoc` KY-2 |
| A7D2-10 | koordinat aralık kuralı kaldırıldı | `araclarGoc` AR-4 |
| A7D2-11 | oturum editöründe kirli form onayı kaldırıldı | `examOturumlariGoc` S-2 |
| A7D2-12 | SK-6: `color-scheme` yine yalnız `number` | `a6cSozlesme` 6b⁺ |
| A7D2-13 | satır içi formda odak taşınmıyor | `araclarGoc` AR-4 |

**A7D2-3 ilk yazımında YAKALANMADI** ve bu sürücünün değil mutasyonun
kusuruydu: `useState`i geri koymak ama pencereye BAĞLAMAMAK ölü koddur ve
metrik onu — doğru şekilde — saymaz. Mutasyona ikinci bir yama eklendi
(`open={silinen !== null}`) ve yakalandı. Kayda geçiyor çünkü "yakalanmadı"
sonucunu testin kusuru sanmak kolay bir hataydı.

---

## Kapı

| Kapı | Sonuç |
|---|---|
| `tsc -b` | temiz |
| `npm run build` | başarılı |
| `npm run lint` | **0 hata**, 31 uyarı (hepsi bu paketin dışında; mevcut taban) |
| Tam suite | **1378/1378**, 133 dosya |
| Karışık tohum | **10 tohum yeşil** (2006·2013·2020·2034·2048·2055·2062·2076·2083·2090·2097·2104 — üçü daha önce kırmızıydı, §Görev 5) |
| Mutasyon | **13/13** |
| Gerçek tarayıcı | 13 kapı geçti, vite kapatıldı |

### Test türleri (dürüst sınıflandırma)

| Tür | Sayı |
|---|---|
| Gerçek DOM + gerçek axios örneği (kabul) | 89 |
| Gerçek DOM (bileşen sözleşmesi) | 3 (`sk3Beyani`) |
| Gerçek tarayıcı (Chrome + CDP) | 1 tur · 6 ekran · 20 ekran görüntüsü · 13 kapı |
| Kaynak/AST sözleşmesi (nöbetçi eşikleri) | mevcut testler, eşikleri güncellendi |

Snapshot yok, "import oldu" testi yok.

---

## Dalga 3 değerlendirmesi

### Sayılar dalga 1'e göre düştü mü?

| | Dalga 1 (3 ekran) | Dalga 2 (6 ekran) |
|---|---|---|
| Sözleşme kusuru | 3 | **4** |
| Ortak katman eksiği | **1** | **0** |
| Ekran başına kusur | 1,00 | **0,67** |
| Ekran regresyonu | 0 | 1 |

**Ham sayı düşmedi (3 → 4); ekran başına düşüş var (1,00 → 0,67); ama asıl
sinyal ORTAK KATMAN EKSİĞİNİN SIFIRLANMASI.**

İki sayı farklı şeyler söyler:

* **Ortak katman eksiği = 0** → sözleşme artık göçü *engellemiyor*. Dalga 1'de
  `Dialog` tek genişlikteydi ve iki ekran ortak pencereye **geçemiyordu**;
  dalga 2'de altı ekranın hiçbiri "bunu ortak katman yapamıyor" demedi. Üçüncü
  bir genişliğe bile gerek olmadı.
* **Sözleşme kusuru = 4** → sözleşme hâlâ *yanlış davranabiliyor*, ama
  kusurların **niteliği değişti**. Dördünün de ortak bir yanı var: hepsi
  A7d1'in (ya da A6c'nin) kapsamı **dar tuttuğu** yerlerde çıktı —
  SK-4 "pencere içeriği bekçiyi çağırmayabilir", SK-5 "kartın içinde aksiyon
  olabilir", SK-6 "sayıdan başka yerel widget olabilir". Yani yeni bir tuzak
  icat edilmedi; **var olan kararların ölçülmemiş kenarları** göründü.

### Kalan ekranlar tek dalgada gidebilir mi?

**Şartlı evet, ama tam göç ÖNERİLMİYOR — dalga 3 için 8–10 ekran.**

Gerekçe, kusurların nasıl bulunduğuna bakınca netleşiyor:

| Kusur | Nasıl bulundu | jsdom testi yakalar mıydı? |
|---|---|---|
| SK-4 | kırmızı matris (kirli kapatma testi) | **evet** |
| SK-5 | kırmızı matris (gerçek ekranda çakışma) | **evet** |
| SK-6 | **gerçek tarayıcı turu** | hayır |
| C-1 (odak) | **gerçek tarayıcı turu** | hayır |

**İkisi yalnız gerçek tarayıcıda görüldü.** Tarayıcı turunun maliyeti ekran
sayısıyla doğrusal artıyor (bu pakette altı ekran için ~20 ekran görüntüsü ve
iki tur koşumu). 20 ekranlık bir dalgada tam tur pratik olarak yapılamaz,
kısa tura indirilirse tam bu iki kusur sınıfı kaçar.

**Dalga 3 için öneriler:**

1. **8–10 ekran**, yine yazım çeşitliliğine göre — özellikle *hiç göç
   etmemiş yazımlar*: sürükle-bırak sıralama (`DeliveryRunDetailPage`),
   çok adımlı akış (`PackingStationPage`), sayım/envanter ekranları.
2. **Tarayıcı turu kısaltılabilir ama SİLİNEMEZ.** Bu pakette bulunan iki
   kusur sınıfının ikisi de "yerel widget + odak" ailesinden; ikisi de yalnız
   orada görülür. Öneri: tam tur yalnız **yeni yazım getiren** ekrana, kısa tur
   diğerlerine — bu pakette uygulanan kural aynen sürsün.
3. **Bekleme bütçesinde yedinci çağrı yeri doğarsa** varsayılanın kendisi
   yeniden değerlendirilmeli (§Görev 5).
4. **`MapPicker`ın adsız arama kutusu** hâlâ açık ve üç ayrı testte "bilinen
   istisna" olarak taşınıyor; dalga 3'te kapatılmalı (tek satır).

---

## Bilinen sınırlar

1. **`ProductForm` kapsam dışıydı ve yine de değişti** (SK-4). Gerekçe canlı
   veri kaybı; değişiklik iki satır. Raporun ana metninde ayrıca yazılı.
2. **`AdminUsersPage` de kapsam dışıydı ve tek satır değişti** (SK-5'in tip
   kapısı derlemeyi zorluyor). Davranışı değişmedi; yalnız satır adı eklendi.
3. **Kontrast ve `color-scheme` yalnız Chrome'da ölçüldü.** Firefox/Safari
   yerel widget'ları farklı çizebilir.
4. **`AdminPayoutsPage`in sekme şeridi `role="tab"` almadı.** `aria-pressed`
   ile bırakıldı: gerçek bir `tablist` ok tuşu gezinmesi ve `aria-controls`
   ister; ayrıca mevcut kabul testleri düğmeyi `role="button"` ile arıyor.
   Ortak bir sekme bileşeni dalga 3'ün konusu.
5. **`useUrlDurumu`nun "aynı olayda iki yazım" yolu (A6c · BULGU-4) bu pakette
   de yeni bir yazımla sınanmadı** — `PackagesPage` ve `AdminPayoutsPage`in
   çoklu yazımları tek `ayarla` çağrısında birleşiyor. A7d1'in aynı sınırı
   devam ediyor.
6. **Sürücünün frontend tarafında yeşil taban kapısı ölçüm yapmıyor** (mevcut
   sınır, TB-45). Taban elle doğrulandı: tam suite 1378/1378 + 10 karışık
   tohum.
7. **`DuzenlemePenceresi` hâlâ "içeriğim korumasız" diyemiyor.** SK-4 tek tek
   düzeltildi ama otomatik dedektör yazılmadı: pencere içeriği tembel
   yüklenebiliyor (`EditProductModal` önce "Yükleniyor…" basıyor), dolayısıyla
   "açılışta bekçi kayıtlı mı" kontrolü yanlış pozitif üretirdi. Salt-okunur
   pencereler de meşru. Doğru çözüm SK-3'ün aynası olurdu — pencere `formsuz`
   beyanı verir — ve dalga 3'e bırakıldı.
