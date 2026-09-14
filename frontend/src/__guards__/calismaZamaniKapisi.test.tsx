/**
 * ── Çalışma zamanı kapısı (İP-A6b · Görev 2 · BULGU-1) ──
 *
 * "Erişilebilir adı olmayan form kontrolü" eşiği artık **render edilen DOM'a**
 * bağlıdır. Kaynak sayacı (`scripts/ui-baseline-sayim.mjs`) teşhis aleti
 * olarak duruyor ama doğruluk kaynağı değil: on iki çağrılı tek yazımlık bir
 * alan fabrikasını **bir** kontrol sayıyor (BULGU-1 · M-A).
 *
 * ## Kapı iki katmanlıdır ve ikisi de gerçek DOM'dur
 *
 * | Katman | Kapsam | Derinlik |
 * |---|---|---|
 * | **Derin** — `adminStoreDalAdlari.acceptance.test.tsx` (D-1…D-3) | mağaza yüzeyi | TÜM koşullu dallar açılır |
 * | **Sığ** — bu dosya | mount edilebilen HER taban ekranı | varsayılan (ilk) render |
 *
 * Sığ katman derin katmanın yerine geçmez; **kapsamı** onun sağlayamadığı
 * yerdir: yetmiş küsur ekran, her CI koşumunda, fixture yazmadan. Bir
 * fabrikanın ya da elle eklenmiş adsız bir alanın ilk render'da görünmesi
 * yeter — M-A tam da böyle bir mutasyondu.
 *
 * ## Gizli tuzak: kapı fixture şekilli DARALAMAZ
 *
 * Dal testi yalnız render edilebilen ekranları kapsar. Kapsam sessizce bir alt
 * kümeye inerse dizin şekilli sınır fixture şekilli sınırla değiştirilmiş olur
 * — BULGU-2'nin aynısı, başka kapıdan. Bu yüzden kapsam **iki yönlü** korunur:
 *
 *   1. `OLCUM_TABANI`'ndaki her `.tsx`, ya bu kapıda MOUNT EDİLİR ya da
 *      `KAPI_DISI`'nda **isimle ve gerekçesiyle** yazılıdır. Üçüncü ihtimal yok.
 *   2. `KAPI_DISI`'ndaki her dosya `OLCUM_TABANI`'nda olmak zorundadır **ve**
 *      gerekçesinin doğruluğu ayrıca sınanır: "prop gerekiyor" diyen bir dosya
 *      gerçekten propsuz mount edilemiyor olmalıdır. Yoksa mount edilebilen
 *      bir ekran rahatlık olsun diye kapı dışına park edilebilirdi.
 *
 * `.ts` dosyaları kapsam dışıdır: JSX taşımazlar, dolayısıyla form kontrolü de
 * taşıyamazlar (kural `mB.kacis.test.ts`te yazılı).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

// ── Ağır ortak modül BİLE BİLE statik import ediliyor (İP-A7d3 · Görev 5) ──
//
// Bu dosya ekran/bileşen modüllerini TEMBEL yüklüyor ve maliyeti ilk testin
// İÇİNDE ödüyor. İP-A7d3'te `admin/ui` demeti `ui2/duzenlemeYuzeyi` üzerinden
// `@medusajs/ui`ye bağlandı (SK-7: `ReasonDialog`ın kirli form bekçisi) ve
// paralel yük altında ilk test bütçeyi aştı.
//
// Bütçe BÜYÜTÜLMEDİ: yavaşlık üretim kodunda değil test kurulumunda; statik
// import maliyeti TOPLAMA (collect) evresine taşır (A7d2'nin kararı).
import "@/components/admin/ui2/duzenlemeYuzeyi";
// ── İkinci ağır ortak modül: LEAFLET (İP-A8 · Görev 5) ──
//
// Aynı gerekçenin ikinci örneği ve bu turda ÖLÇÜLDÜ: tam suite yükü altında
// `KAPI_DISI gerekçesi doğru: src/components/LibrariesMap.tsx` **5.928 ms**
// sürüyordu — suite'in en yavaş tek testi ve 9.000 ms'lik `testTimeout`un
// %66'sı. Sebep bekleme değil MODÜL YÜKÜ: `LibrariesMap`/`DeliveryRouteMap`/
// `MapGate` üçü de `react-leaflet` + `leaflet` + üç PNG varlığı çekiyor ve
// fatura, `it.each` sırası karışık tohumda değiştiği için HANGİ testin
// önce koştuğuna göre yer değiştiriyordu.
//
// Denetimin B-4'ü bu testi göstermedi ama sınıf aynı sınıftır (A7d3/A7d5'in
// tembel modül borcu) ve daha yavaş bir makinede zaman aşımına düşmeye
// A7d5'in kapattığı ikisinden daha yakındı. Bütçe BÜYÜTÜLMEDİ: maliyet
// TOPLAMA evresine taşındı.
import "@/components/map/MapGate";
import "@/components/LibrariesMap";
// ── Üçüncü örnek: `FormPage`/`TipSecimi` (nöbetçi kırmızısı kök neden raporu) ──
//
// Bu ikisi `KAPI_DISI`nin TERS PROVASIDIR — propsuz mount edilince FIRLATMASI
// beklenir ve fırlatma bizzat ÖLÇÜLDÜ (`TypeError: Cannot read properties of
// undefined (reading 'map')`, doğru dosyada, doğru satırda). Tam suite altında
// kırmızı düşmelerinin sebebi bu fırlatma DEĞİL: `render()`+throw süresi
// ölçüldü, **12-14 ms**. Bütün bütçe `await ekranBileseni(dosya)`da, yani
// `import.meta.glob` üzerinden TEMBEL yapılan dinamik import'ta gidiyordu —
// 121 komşu dosyayla aynı işçi havuzunda ölçülen değerler: `TipSecimi.tsx`
// **8.272 ms**, `FormPage.tsx` **20.785 ms** (9.000 ms'lik testTimeout'un
// 2,3 katı). Aynı sınıf, üçüncü örneği: bu iki modül üstteki ikisinin aksine
// TOPLAMA evresinde ödenmiyordu, bedeli testin KENDİ bütçesine yazılıyordu.
// Düzeltme aynı ilaç: statik import maliyeti TOPLAMA evresine taşınır, testin
// kendisi hiç değişmez (`await ekranBileseni` zaten yüklü modülü döndürür).
import "@/panel/components/FormPage";
import "@/panel/components/TipSecimi";

import { createElement } from "react";

import { apiClient } from "@/api/axios";
import { useAuthStore } from "@/store/authStore";
import { TAM_ADMIN_IZINLERI } from "@/test-utils/adminIzinleri";
import { OLCUM_TABANI } from "../../scripts/ui-baseline-sayim.mjs";
import { kontrolOlcumu } from "./kapiOlcumu";

import type { AxiosRequestConfig } from "axios";
import type { ComponentType, ReactElement } from "react";

/**
 * Kapı dışında kalan taban dosyaları — **dosya başına gerekçesiyle**.
 *
 * `props`       : propsuz mount edilemez (zorunlu veri/geri çağrı ister). Sığ
 *                 kapı bunları göremez; borçları derin dal testleriyle ve göç
 *                 sırasında yazılacak ekran testleriyle kapanır.
 * `baglam`      : tek başına değil, bir sağlayıcı ağacının içinde yaşar.
 * `bilesen-yok` : modül render edilebilir bir bileşen dışa vermiyor
 *                 (namespace nesnesi ya da yalnız hook).
 */
const KAPI_DISI: Record<string, { tur: "props" | "bilesen-yok" | "baglam"; gerekce: string }> = {
  // ── İP-A6b · Görev 3: import grafiğinin getirdiği 27 dosyadan 7'si ──
  // Yirmisi kapıda mount ediliyor; bu yedisi propsuz/ bağlamsız açılamıyor.
  "src/components/Avatar.tsx": { tur: "props", gerekce: "zorunlu ad (bas harf uretimi)" },
  "src/components/DeliveryRouteMap.tsx": { tur: "props", gerekce: "zorunlu run (duraklar)" },
  "src/components/LibrariesMap.tsx": { tur: "props", gerekce: "zorunlu kutuphane dizisi" },
  // İP-A7d1: prop artık `state` degil `yuzey` (duzenleme yuzeyi). Propsuz
  // mount edilemez; borcu DERIN kapida kapaniyor (dal testi).
  "src/components/LibraryEditorModal.tsx": { tur: "props", gerekce: "zorunlu yuzey (duzenleme yuzeyi)" },
  "src/components/LibraryMapPanel.tsx": { tur: "props", gerekce: "zorunlu kutuphane (slug)" },
  // 8 Eyl 2026 · panel şeridi (eğitmenin kalıcı sekme satırı). Zorunlu
  // `items` olmadan mount edilemez; şeridi çizen `DashboardShell` kapıda
  // zaten mount ediliyor. Erişilebilirlik sözleşmesi (adlandırılmış nav +
  // aria-current) `__guards__/panoSeridi.test.tsx`te gerçek DOM'da sınanır.
  "src/components/PanelSekmeleri.tsx": { tur: "props", gerekce: "zorunlu items (sekme listesi)" },
  "src/components/map/MapGate.tsx": { tur: "baglam", gerekce: "leaflet MapContainer baglami gerekiyor" },
  "src/components/ui/Field.tsx": { tur: "props", gerekce: "children fonksiyon olarak bekleniyor (render prop)" },
  "src/components/admin/ProductPicker.tsx": {
    tur: "props",
    gerekce: "zorunlu secili dizisi + geri cagri",
  },
  "src/components/admin/data-table/DataTable.tsx": {
    tur: "props",
    gerekce: "zorunlu columns/rows",
  },
  "src/components/admin/store/SupplierLinkDialog.tsx": {
    tur: "props",
    gerekce: "zorunlu yuzey (duzenleme yuzeyi) + supplierId",
  },
  // Ürün galerisi ve varyant matrisi KAYITLI bir ürün üzerinde çalışır
  // (yükleme/üretim ürün id'si ister); propsuz mount `product.id`de patlar.
  // Adsız kontrol borçları kendi kabul matrislerinde kapanıyor:
  // `productMedia.acceptance.test.tsx` her galeri görselinin adlandırılmış bir
  // alt metin alanı olduğunu, `variantMatrix.acceptance.test.tsx` her tablo
  // hücresinin `aria-label` taşıdığını GERÇEK DOM üzerinden sınıyor.
  "src/components/admin/store/ProductMediaManager.tsx": {
    tur: "props",
    gerekce: "zorunlu urun (kayitli urun id'si)",
  },
  "src/components/admin/store/VariantMatrixPanel.tsx": {
    tur: "props",
    gerekce: "zorunlu urun (varyant grubu + kaynak id)",
  },
  // İP-B2 · liste ailesi: kural fonksiyonu `aksiyonlar` dizisini gezdiği
  // için propsuz mount PATLAR. Borcu, kendi davranış dosyasında ve ürün
  // listesi kabul matrisinde kapanıyor.
  "src/components/admin/ui2/liste/satirAksiyonlari.tsx": {
    tur: "props",
    gerekce: "zorunlu aksiyonlar dizisi (Ç-2 kural denetimi)",
  },
  "src/components/admin/delivery/LabelSheet.tsx": {
    tur: "props",
    gerekce: "zorunlu run (duraklar)",
  },
  "src/components/admin/inventory/DamageDialog.tsx": {
    tur: "props",
    gerekce: "zorunlu baglam",
  },
  "src/components/admin/packing/PackageLabel.tsx": {
    tur: "props",
    gerekce: "zorunlu paket (kalemler)",
  },
  "src/components/admin/packing/PackingLabelSheet.tsx": {
    tur: "props",
    gerekce: "zorunlu paket dizisi",
  },
  "src/components/admin/store/EditProductModal.tsx": {
    tur: "props",
    gerekce: "zorunlu kayit (duzenleme yuzeyi)",
  },
  "src/components/store/ProductCard.tsx": {
    tur: "props",
    gerekce: "zorunlu urun verisi",
  },
  // CMS Faz 1: kontrollü bileşen — value/onChange olmadan mount edilemez.
  "src/components/admin/content/BlogBodyEditor.tsx": {
    tur: "props",
    gerekce: "zorunlu value/onChange (kontrollu TipTap editoru)",
  },
  "src/components/admin/ui2/duzenlemeYuzeyi.tsx": {
    tur: "props",
    gerekce: "zorunlu yuzey durumu (acik)",
  },
  "src/components/admin/ui2/form.tsx": {
    tur: "bilesen-yok",
    gerekce: "Form namespace'i + hook'lar; alanlari D-1…D-3'te derin render ediliyor",
  },
  "src/components/admin/ui2/kirliFormBekcisi.tsx": {
    tur: "bilesen-yok",
    gerekce: "yalniz useKirliFormBekcisi hook'u",
  },
  // ── İ9 · Boşluk 1: `src/panel/**` (ikas tarzı yeni panel) ──
  //
  // İkisi de EMPİRİK olarak sınandı: propsuz mount gerçekten TypeError
  // fırlatıyor (`bolumler.map`/`secenekler.map` — `Array.prototype.map`
  // `undefined` üzerinde).
  "src/panel/components/FormPage.tsx": {
    tur: "props",
    gerekce: "zorunlu bolumler (sekme listesi) + geriTiklandi/kaydet",
  },
  "src/panel/components/TipSecimi.tsx": {
    tur: "props",
    gerekce: "zorunlu secenekler (dizi) + acik/baslik/kapat/secildi",
  },
  // Dağıtım ortak varlık kilidi düğmesi: `islem` beyanı zorunlu (propsuz atar); adı `children`dan gelir.
  "src/panel/components/varlikKilidi.tsx": {
    tur: "props",
    gerekce: "zorunlu islem (kilit anahtari) + children (dugme metni)",
  },
};

/**
 * Derin kapının (dal testi) kapsadığı ekranlar — kayıt amaçlı.
 *
 * Buradaki iddialar `adminStoreDalAdlari.acceptance.test.tsx`te yaşar; bu liste
 * onların hangi dosyaları kapsadığını ölçüm tabanına bağlar.
 */
const DERIN_KAPI = [
  // İP-A7d1 · göç dalgası 1 · ekran (a): `kutuphaneEditoruDalAdlari.acceptance`
  // formu ÜÇ koşullu dalıyla (admin-yeni / admin-düzenleme / operatör) ve
  // ayrıca gün açık↔kapalı dalıyla render eder; her alanın erişilebilir adı
  // `test-utils/alanAdlari` ile doğrulanır. Sığ kapı bu dosyayı göremez
  // (propsuz mount edilemiyor), derin kapı görür.
  "src/components/LibraryEditorModal.tsx",
  // İP-A7d2 · göç dalgası 2: BEŞ dosya derin kapıya GİRDİ. Her birinin tüm
  // koşullu dalları kendi kabul dosyasında render edilip alan adları
  // doğrulanıyor:
  //   • `ExamSessionsManager`   → `examOturumlariGoc.acceptance` (S-3)
  //   • `AdminExamCatalogs`     → `adminKataloglarGoc.acceptance` (K-4)
  //   • `AdminPayoutsPage`      → `adminHakedisGoc.acceptance` (H-5)
  //   • `CourierManager`        → `kuryeYonetimiGoc.acceptance` (KY-3)
  //   • `DeliveryVehiclesPage`  → `araclarGoc.acceptance` (AR-3)
  "src/components/ExamSessionsManager.tsx",
  "src/components/admin/CourierManager.tsx",
  "src/components/admin/store/BulkImportPanel.tsx",
  "src/components/admin/store/CategoriesPanel.tsx",
  "src/components/admin/store/CouponsPanel.tsx",
  "src/components/admin/store/OrdersPanel.tsx",
  "src/components/admin/store/ProductForm.tsx",
  "src/components/admin/store/ProductsPanel.tsx",
  "src/components/admin/store/ReturnsPanel.tsx",
  "src/components/admin/ui2/form.tsx",
  "src/pages/admin/AdminPayoutsPage.tsx",
  "src/pages/admin/delivery/DeliveryVehiclesPage.tsx",
  "src/pages/dashboards/AdminExamCatalogs.tsx",
  "src/pages/dashboards/AdminStore.tsx",
  // İP-A7d3 · göç dalgası 3: ON dosya derin kapıya GİRDİ. Her birinin koşullu
  // dalları kendi kabul dosyasında render edilip alan adları doğrulanıyor:
  //   • `LibraryPayoutForm`       → `kutuphaneOdemeGoc.acceptance` (Ö-1)
  //   • `AdminReportsPage`        → `adminSikayetGoc.acceptance` (Ş-3)
  //   • `CountSessionsPage`       → `sayimOturumlariGoc.acceptance` (S-2)
  //   • `CountSessionDetailPage`  → `sayimDetayiGoc.acceptance` (D-4)
  //   • `PackingStationPage`      → `packingLabel.acceptance` (A7d3 bölümü)
  //   • `DeliveryRunDetailPage`   → `turDetayiGoc.acceptance` (T-4)
  //   • `OperatorHome` / `OperatorLibrary` / `OperatorSessions`
  //                               → `operatorPanel.acceptance` (A7d3 bölümü)
  //   • `AdminHome`               → `adminTutorApproval.acceptance` (A7d3 bölümü)
  "src/components/LibraryPayoutForm.tsx",
  "src/pages/admin/AdminReportsPage.tsx",
  "src/pages/admin/delivery/DeliveryRunDetailPage.tsx",
  "src/pages/admin/inventory/CountSessionDetailPage.tsx",
  "src/pages/admin/inventory/CountSessionsPage.tsx",
  "src/pages/admin/packing/PackingStationPage.tsx",
  "src/pages/dashboards/AdminHome.tsx",
  "src/pages/dashboards/OperatorHome.tsx",
  "src/pages/dashboards/OperatorLibrary.tsx",
  "src/pages/dashboards/OperatorSessions.tsx",
  // İP-A7d4 · göç dalgası 4: ALTI dosya derin kapıya GİRDİ. Her birinin
  // koşullu dalları kendi kabul dosyasında render edilip alan adları
  // doğrulanıyor:
  //   • `AdminAccessPage`      → `adminYetkiGoc.acceptance` (Y-3)
  //   • `ClosedDays`           → `dalga4Pencereleri.acceptance` (D4-1)
  //   • `AdminOperationsPage`  → `dalga4Pencereleri.acceptance` (D4-2)
  //   • `AdminSettingsPage`    → `dalga4Pencereleri.acceptance` (D4-3)
  //   • `DeliveryTodayPage` / `DeliveryBoardPage`
  //                            → `ip19Filo.acceptance` (A7d4 bölümü)
  "src/components/admin/delivery/ClosedDays.tsx",
  "src/pages/admin/AdminAccessPage.tsx",
  "src/pages/admin/AdminOperationsPage.tsx",
  "src/pages/admin/AdminSettingsPage.tsx",
  "src/pages/admin/delivery/DeliveryBoardPage.tsx",
  "src/pages/admin/delivery/DeliveryTodayPage.tsx",
];

/**
 * ── Çalışma zamanı ADSIZ KONTROL TABANI (İP-A6b · Görev 3 + Görev 6) ──
 *
 * Varsayılan render'da erişilebilir adı olmayan kontroller — **dosya başına
 * sayısıyla**. Yedisi de import grafiğinin (Görev 3) görünür ettiği GERÇEK
 * borçtur; bu pakette kapatılmaz, çünkü paketin kuralı "davranış değişmez"dir
 * (kapatmak `ui2/Form`a göç demektir → İP-A6c/A7).
 *
 * Sayı değil KİMLİK sabitlenir: yeni bir dosyanın listeye girmesi de,
 * listedeki bir borcun kapanması da testi kırar. İkincisi DOĞRU davranıştır —
 * borç kapandığında bu liste bilinçli olarak küçültülür ve düşüş rapora yazılır
 * (aksi hâlde "sayı düştü" ile "ekran ölçümden çıktı" ayırt edilemez).
 */
const CALISMA_ZAMANI_ADSIZ: Record<string, number> = {
  // ── İP-A7d3 · göç dalgası 3: İKİ kalem bu tabandan ÇIKTI (7 → 1) ──
  //
  //   • `LibraryPayoutForm` 5 → 0: beş alan da `Form.*`a geçti (IBAN/TCKN/
  //     unvan/e-posta/telefon) ve doğrulama toast'tan alana indi.
  //   • `MapPicker` 1 → 0: adres arama kutusuna `aria-label` verildi.
  //     A7d2'nin kapanış notu bunu adıyla dalga 3'e bırakmıştı ve borç üç ayrı
  //     testte "bilinen istisna" olarak taşınıyordu.
  //
  // Listeden ÇIKMAK borcun kapandığı anlamına gelir ve bu test kırılarak
  // düşüşü RAPORLATIR (aksi hâlde "sayı düştü" ile "ekran ölçümden çıktı"
  // ayırt edilemez).
  "src/components/ImageCropModal.tsx": 1, // yakınlaştırma kaydırağı (type=range)
  // ── İ9 · Boşluk 1 KAPANDI: `ListePage`in arama kutusu (11 Eyl, 4b2bcc9) ──
  //
  // `ListePage`in arama kutusu (`Input.Search`) `placeholder` DIŞINDA ad
  // taşımıyordu — `aria-label` yok, `htmlFor`lu bir `<label>` yoktu.
  // `placeholder` bu depoda BİLİNÇLİ OLARAK ad sayılmaz
  // (`test-utils/alanAdlari.ts` başı). Bu satırlar bir süre (`ListePage`: 1,
  // `UrunListesi`: 1) burada GERÇEK borç olarak durdu.
  //
  // Düzeltme aynı zamanda ikinci bir borcu da kapattı: kutu `Input.Search`
  // olduğu için `onSearch` verilmeyince tıklanabilir ama hiçbir şey yapmayan
  // ölü bir büyüteç düğmesi basıyordu — `Input`e indirildi (arama zaten her
  // tuşta tüketiciye gidiyordu, ayrı bir "ara" eylemine ihtiyaç yoktu).
  // `aria-label` başlıktan türetildi (`"${baslik} içinde ara"`), yani
  // `ListePage`i kopyalayacak 15 modülün hepsi bu adı miras alıyor.
  //
  // Bu paket panel koduna DOKUNMADI (nöbetçi koruduğu kodu değiştirmez);
  // kapanış ayrı bir committen (4b2bcc9) geldi. Kayıt kaldırılınca satır
  // kaybolur — "sayı düştü" ile "ekran ölçümden çıktı" ayrımı için bu not
  // burada duruyor.
};

/**
 * ── Kapıda ölçülen ekranlar — SAYIYLA DEĞİL, KİMLİKLE (İP-A6c · Görev 7) ──
 *
 * A6b bu kapsamı `kapsanan.length >= 88` ile koruyordu. Sayı kimlik değildir:
 * bir ekran kapsam dışına çıkıp yerine başkası girerse sayı 88'de kalır ve
 * kapı **sessizce başka bir kümeyi** ölçmeye başlar. Ölçüm doğru görünür,
 * ölçülen şey değişmiştir.
 *
 * Bu dersi bu projede iki kez öğrendik — `OLCUM_TABANI` isimle sabitlendi,
 * etiketsiz overlay listesi isimle sabitlendi. Bu üçüncüsü.
 *
 * Liste iki yönlü korunur (aşağıdaki testler): burada olup kapsanmayan da,
 * kapsanıp burada olmayan da kırmızıdır. Kapsam bilinçli değişince bu liste
 * elle güncellenir ve değişim rapora yazılır.
 */
const KAPI_KAPSAMI = [
  "src/components/AmenityTagGrid.tsx",
  "src/components/AppIcon.tsx",
  "src/components/DashboardHeader.tsx",
  "src/components/DashboardShell.tsx",
  "src/components/ExamSessionsManager.tsx",
  "src/components/HScroll.tsx",
  "src/components/ImageCropModal.tsx",
  "src/components/LibraryBookmarkButton.tsx",
  "src/components/LibraryMediaManager.tsx",
  "src/components/LibraryPayoutForm.tsx",
  "src/components/MapPicker.tsx",
  "src/components/MobilAltSekmeler.tsx",
  "src/components/NavbarWidget.tsx",
  "src/components/NotificationsBell.tsx",
  "src/components/PersonalizeModal.tsx",
  "src/components/PinIcon.tsx",
  "src/components/QrScanner.tsx",
  "src/components/ShareButton.tsx",
  "src/components/ShareModal.tsx",
  "src/components/Spinner.tsx",
  "src/components/StarRating.tsx",
  "src/components/ui/Modal.tsx",
  "src/components/admin/AccessState.tsx",
  "src/components/admin/CourierManager.tsx",
  "src/components/admin/StockBadge.tsx",
  "src/components/admin/StockLedgerPanel.tsx",
  "src/components/admin/StockMovementTable.tsx",
  "src/components/admin/StockMovementsPanel.tsx",
  "src/components/admin/delivery/CapacityStrip.tsx",
  "src/components/admin/delivery/ClosedDays.tsx",
  "src/components/admin/delivery/ItemLines.tsx",
  "src/components/admin/delivery/bits.tsx",
  "src/components/admin/layout/AdminKomutPenceresi.tsx",
  "src/components/admin/layout/AdminLayout.tsx",
  "src/components/admin/layout/AdminPageHeader.tsx",
  "src/components/admin/layout/AdminProfilMenusu.tsx",
  "src/components/admin/layout/AdminSidebar.tsx",
  "src/components/admin/layout/baslikAksiyonu.tsx",
  "src/components/admin/store/BulkImportPanel.tsx",
  "src/components/admin/store/CategoriesPanel.tsx",
  "src/components/admin/store/CouponsPanel.tsx",
  "src/components/admin/store/OrdersPanel.tsx",
  "src/components/admin/store/ProductForm.tsx",
  "src/components/admin/store/ProductsPanel.tsx",
  "src/components/admin/store/ReturnsPanel.tsx",
  "src/components/admin/store/StoreAttributesManager.tsx",
  "src/components/admin/store/SupplierPanel.tsx",
  "src/components/admin/ui/Badge.tsx",
  "src/components/admin/ui/Button.tsx",
  "src/components/admin/ui/ConfirmDialog.tsx",
  "src/components/admin/ui/Dialog.tsx",
  "src/components/admin/ui/PageState.tsx",
  "src/components/admin/ui2/gezinmeBekcisi.tsx",
  "src/components/admin/ui2/komutPenceresi.tsx",
  "src/components/admin/ui2/liste/aracCubugu.tsx",
  "src/components/admin/ui2/liste/bosDurum.tsx",
  "src/components/admin/ui2/liste/menu.tsx",
  "src/components/admin/ui2/medusa-tr.tsx",
  "src/components/ui/DaireDugme.tsx",
  "src/components/ui/PlainButton.tsx",
  "src/pages/DeliveryDriver.tsx",
  "src/pages/DeliveryRunHandover.tsx",
  "src/pages/admin/AdminAccessPage.tsx",
  "src/pages/admin/AdminAuditLogsPage.tsx",
  "src/pages/admin/AdminBookingsPage.tsx",
  "src/pages/admin/AdminDashboardPage.tsx",
  "src/pages/admin/AdminDemandsPage.tsx",
  "src/pages/admin/AdminOperationsPage.tsx",
  "src/pages/admin/AdminPayoutsPage.tsx",
  "src/pages/admin/AdminPromotionsPage.tsx",
  "src/pages/admin/AdminReportsPage.tsx",
  "src/pages/admin/AdminSectionPage.tsx",
  "src/pages/admin/AdminSettingsPage.tsx",
  "src/pages/admin/AdminTutorApplicationsPage.tsx",
  "src/pages/admin/AdminUserDetailPage.tsx",
  "src/pages/admin/AdminUsersPage.tsx",
  // CMS Faz 1 · blog yönetimi.
  "src/pages/admin/blog/AdminBlogEditorPage.tsx",
  "src/pages/admin/blog/AdminBlogListPage.tsx",
  // CMS Faz 2 · Puck editör sayfası + medya seçici alanı.
  "src/pages/admin/delivery/DeliveryBoardPage.tsx",
  "src/pages/admin/delivery/DeliveryCouriersPage.tsx",
  "src/pages/admin/delivery/DeliveryLayout.tsx",
  "src/pages/admin/delivery/DeliveryOrdersPage.tsx",
  "src/pages/admin/delivery/DeliveryPerformancePage.tsx",
  "src/pages/admin/delivery/DeliveryRunDetailPage.tsx",
  "src/pages/admin/delivery/DeliveryRunsPage.tsx",
  "src/pages/admin/delivery/DeliveryTodayPage.tsx",
  "src/pages/admin/delivery/DeliveryVehiclesPage.tsx",
  "src/pages/admin/inventory/CountSessionDetailPage.tsx",
  "src/pages/admin/inventory/CountSessionsPage.tsx",
  "src/pages/admin/inventory/DamageEventsPage.tsx",
  "src/pages/admin/inventory/InventoryLayout.tsx",
  "src/pages/admin/inventory/InventoryOverviewPage.tsx",
  "src/components/admin/packing/SplitDialog.tsx",
  "src/pages/admin/packing/PackagesPage.tsx",
  "src/pages/admin/packing/PackingLayout.tsx",
  "src/pages/admin/packing/PackingQueuePage.tsx",
  "src/pages/admin/packing/PackingStationPage.tsx",
  "src/pages/admin/packing/ReturnQueuePage.tsx",
  "src/pages/dashboards/AdminExamCatalogs.tsx",
  "src/pages/dashboards/AdminHome.tsx",
  "src/pages/dashboards/AdminLibraries.tsx",
  "src/pages/dashboards/AdminStore.tsx",
  "src/pages/dashboards/CourierHome.tsx",
  "src/pages/dashboards/OperatorHome.tsx",
  "src/pages/dashboards/OperatorLibrary.tsx",
  "src/pages/dashboards/OperatorSessions.tsx",
  // ── İ9 · Boşluk 1: `src/panel/**` — dokuzu propsuz mount ediliyor ──
  // (ikisi — `FormPage`/`TipSecimi` — propsuz ATIYOR, `KAPI_DISI`'nda).
  "src/panel/PanelProvider.tsx",
  "src/panel/components/Durum.tsx",
  "src/panel/components/ListePage.tsx",
  "src/panel/components/Matris.tsx",
  // Ürün medya sekmesi (kapak + galeri). Propsuz mount olur (`productId`
  // undefined iken `BosDurumu` basar — throw ETMEZ), bu yüzden `KAPI_DISI`'na
  // yazılamaz (oranın ters provası "propsuz mount EDİLEMİYOR" der). Gerçek
  // prop `ZORUNLU_PROPLAR`'da veriliyor ki yükleme/sıralama/silme UI'ı
  // gerçekten mount olsun.
  "src/panel/components/MedyaSekmesi.tsx",
  "src/panel/components/YanPencere.tsx",
  "src/panel/layout/PanelShell.tsx",
  // Müşteriler modülünün ilk ekranı: propsuz mount olur, `useAdminUsers` boş
  // veri döner, arama kutusu `ListePage`den ADLI gelir (aynı sınıf
  // `MusteriListesi.tsx`in kardeşleri `SiparisListesi.tsx`/`UrunListesi.tsx`).
  "src/panel/pages/musteriler/MusteriListesi.tsx",
  // Müşteri detayı: propsuz mount'ta rota parametresi yok → dostane hata + "Müşterilere dön" düğmesi.
  "src/panel/pages/musteriler/MusteriDetayi.tsx",
  // Hesap silme penceresi: kapalıyken gövde mount edilmez (pencere kabuğu).
  "src/panel/pages/musteriler/MusteriDetayPencereleri.tsx",
  // Denetim kayıtları: propsuz mount olur; izinli oturumda arama kutusu ListePage'den ADLI gelir.
  "src/panel/pages/ayarlar/DenetimKayitlariListesi.tsx",
  // Denetim ayrıntı penceresi: `kayit` yokken kapalı, gövde mount edilmez.
  "src/panel/pages/ayarlar/DenetimKaydiPenceresi.tsx",
  // Genel ayarlar: propsuz mount olur; satırlar hook verisiyle doğar, form kontrolü yalnız gerekçe penceresinde.
  "src/panel/pages/ayarlar/GenelAyarlar.tsx",
  // Bayrak gerekçesi penceresi: `acik` yokken kapalı, gövde mount edilmez.
  "src/panel/pages/ayarlar/BayrakGerekcePenceresi.tsx",
  // Personel & Yetkiler: propsuz mount olur; izinli oturumda atama seçicileri veriyle doğar.
  "src/panel/pages/ayarlar/PersonelYetkiler.tsx",
  // Rol çekmecesi: `acik` yokken kapalı, gövde mount edilmez.
  "src/panel/pages/ayarlar/RolCekmecesi.tsx",
  // Hata çözme: propsuz mount olur; iki liste salt okunur, form kontrolü yok, tek aksiyon düğme.
  "src/panel/pages/ayarlar/HataCozme.tsx",
  // Paketleme kuyruğu: propsuz mount olur; satırlar ve aksiyonlar sunucu verisiyle doğar, form kontrolü yok.
  "src/panel/pages/paketleme/PaketlemeKuyrugu.tsx",
  // Paketler: propsuz mount olur; izinli oturumda Filtre/sayfalayıcı ListePage'den ADLI gelir.
  "src/panel/pages/paketleme/PaketListesi.tsx",
  // Paket detayı: propsuz mount'ta rota parametresi yok → dostane hata + "Paketler listesine dön".
  "src/panel/pages/paketleme/PaketlemeDetayi.tsx",
  // Paketleme pencereleri: kapalıyken gövde mount edilmez (pencere kabuğu).
  "src/panel/pages/paketleme/PaketlemePencereleri.tsx",
  // Geri dönüş kuyruğu: propsuz mount olur; satırlar ve "Depoya al" sunucu verisiyle doğar, form kontrolü yok.
  "src/panel/pages/paketleme/GeriDonusKuyrugu.tsx",
  // Dağıtım · Bugün: propsuz mount olur; izinli oturumda tarih alanı ("Tur tarihi") ADLI gelir.
  "src/panel/pages/dagitim/DagitimBugun.tsx",
  // Dağıtım · Siparişler: propsuz mount olur; kuyruk seçici (Segmented "Sipariş kuyrukları") ADLI gelir.
  "src/panel/pages/dagitim/DagitimSiparisleri.tsx",
  // Dağıtım · Turlar: propsuz mount olur; tarih alanı ("Tarihe göre filtrele") ADLI gelir.
  "src/panel/pages/dagitim/DagitimTurlari.tsx",
  // Dağıtım · Tur Detayı: propsuz mount'ta rota parametresi yok → dostane hata + "Turlar listesine dön".
  "src/panel/pages/dagitim/DagitimTurDetayi.tsx",
  // Dağıtım · Kuryeler: propsuz mount olur; izinli oturumda takvim formu ("Kapatılacak gün") ADLI gelir.
  "src/panel/pages/dagitim/DagitimKuryeler.tsx",
  // Kurye pencereleri: kapalıyken gövde mount edilmez (pencere kabuğu).
  "src/panel/pages/dagitim/KuryePencereleri.tsx",
  // Dağıtım · Araçlar: propsuz mount olur; kontroller veri gelince (satır aksiyonları) ve pencerelerde doğar (koşullu).
  "src/panel/pages/dagitim/DagitimAraclar.tsx",
  // Dağıtım · Performans: propsuz mount olur; dönem seçicileri (Segmented "Metrik aralığı"/"Gün aralığı") ADLI gelir.
  "src/panel/pages/dagitim/DagitimPerformans.tsx",
  // Dağıtım · Tahta: propsuz mount olur; izinli oturumda tarih alanı ("Tarih") ADLI gelir.
  "src/panel/pages/dagitim/DagitimTahtasi.tsx",
  // Eğitmen İlanları: propsuz mount olur; kontroller satır aksiyonları ve pencerede (kapalı) doğar.
  "src/panel/pages/egitmenler/EgitmenIlanlari.tsx",
  // Eğitmen Ön Başvuruları: propsuz mount olur; durum filtresi ("Durum filtresi") ADLI kontrolleriyle gelir.
  "src/panel/pages/egitmenler/EgitmenOnBasvurulari.tsx",
  // Red penceresi: kapalıyken gövde mount edilmez (pencere kabuğu).
  "src/panel/pages/egitmenler/EgitmenIlanPencereleri.tsx",
  // Araç/nokta pencereleri: kapalıyken gövde mount edilmez (pencere kabuğu).
  "src/panel/pages/dagitim/AracPencereleri.tsx",
  // Depoya al penceresi: kapalıyken gövde mount edilmez (pencere kabuğu).
  "src/panel/pages/paketleme/DepoyaAlPenceresi.tsx",
  // Kuponlar: propsuz mount olur; izinli oturumda "Kupon Ekle" ve sayfalayıcı ADLI çizilir.
  "src/panel/pages/indirimler/KuponListesi.tsx",
  // Kupon oluşturma çekmecesi: `acik` yokken kapalı, gövde mount edilmez.
  "src/panel/pages/indirimler/KuponCekmecesi.tsx",
  // Gösterge paneli: propsuz mount olur; dönem seçici (adlı) her durumda çizilir.
  "src/panel/pages/gosterge/GostergePaneli.tsx",
  // İadeler: propsuz mount olur; izinli oturumda Filtre/sayfalayıcı ADLI gelir.
  "src/panel/pages/siparisler/IadeListesi.tsx",
  // İade pencereleri: kapalıyken gövde mount edilmez (pencere kabuğu).
  "src/panel/pages/siparisler/IadePenceresi.tsx",
  // Sipariş detayı: propsuz mount'ta rota parametresi yok → dostane hata + "Listeye dön".
  "src/panel/pages/siparisler/SiparisDetayi.tsx",
  // Sipariş detayı pencereleri: kapalıyken gövde mount edilmez (pencere kabuğu).
  "src/panel/pages/siparisler/SiparisDetayPencereleri.tsx",
  // Siparişler modülü (commit `06ab4d2`): propsuz mount olur, `useAdminOrders`
  // boş veri döner, arama kutusu `ListePage`den ADLI gelir (aynı sınıf
  // `UrunListesi.tsx`) — `KONTROLSUZ_EKRANLAR`a değil kapıya girer.
  "src/panel/pages/siparisler/SiparisListesi.tsx",
  // Ürün listesi araç çubuğunun yüzeyleri (filtre/kolon ayarı/içe aktarma
  // çekmeceleri + ızgara görünümü). Propsuz mount olur: modülün ilk büyük
  // harfli export'u `FiltreCekmecesi` ve kapalı çekmece gövdesini mount
  // etmez — `UrunOlusturCekmecesi.tsx` ile aynı sınıf, aşağıda
  // `KONTROLSUZ_EKRANLAR`'da "pencere-kabugu" olarak yazılı.
  "src/panel/pages/urunler/UrunAracCubugu.tsx",
  // Stok sayımı listesi: propsuz mount olur, `useCountSessions` boş veri döner,
  // arama kutusu `ListePage`den ADLI gelir (`UrunListesi.tsx` ile aynı sınıf).
  // Kategoriler: propsuz mount olur; izinli oturumda "Kategori Ekle" ve sayfalayıcı ADLI çizilir.
  "src/panel/pages/urunler/KategoriListesi.tsx",
  // Kategori çekmecesi: `acik` yokken kapalı, gövde mount edilmez.
  "src/panel/pages/urunler/KategoriCekmecesi.tsx",
  // Tanımlamalar hub'ı: yalnız kartlar/bağlantılar, form kontrolü yok.
  "src/panel/pages/urunler/Tanimlamalar.tsx",
  // Tedarikçiler: propsuz mount olur; izinli oturumda arama kutusu ListePage'den ADLI gelir.
  "src/panel/pages/urunler/TedarikciListesi.tsx",
  // Tedarikçi çekmeceleri: `acik` yokken kapalı, gövde mount edilmez.
  "src/panel/pages/urunler/TedarikciCekmecesi.tsx",
  // Hasarlı stok: propsuz mount olur, Filtre/işlem düğmeleri ListePage'den ADLI gelir.
  "src/panel/pages/urunler/HasarliStokListesi.tsx",
  // Hasar penceresi: `kind` yokken çekmece kapalı, gövde mount edilmez.
  "src/panel/pages/urunler/HasarliStokPencereleri.tsx",
  // Envanter genel bakış: propsuz mount olur; izinli oturumda sayaç/ilgili ekran bağlantıları çizilir.
  "src/panel/pages/urunler/EnvanterGenelBakis.tsx",
  // Stok hareketleri: propsuz mount olur, arama kutusu `ListePage`den ADLI gelir.
  "src/panel/pages/urunler/StokHareketleriListesi.tsx",
  // Sayım detayı: propsuz mount olur (`id` yok), sorgu yanıtsız → yükleniyor; kontroller veri dalında.
  "src/panel/pages/urunler/StokSayimiDetayi.tsx",
  // Sayım pencereleri: kapalıyken gövde mount edilmez (pencere kabuğu).
  "src/panel/pages/urunler/StokSayimiPencereleri.tsx",
  "src/panel/pages/urunler/StokSayimiListesi.tsx",
  // Ürün seçici: propsuz mount adlı bir Select çizer.
  "src/panel/pages/urunler/UrunSecici.tsx",
  "src/panel/pages/urunler/UrunFormu.tsx",
  "src/panel/pages/urunler/UrunListesi.tsx",
  "src/panel/pages/urunler/UrunOlusturCekmecesi.tsx",
  // Yeni sayım çekmecesi: kapalıyken gövde mount edilmez (pencere kabuğu).
  "src/panel/pages/urunler/YeniSayimCekmecesi.tsx",
  "src/panel/pages/urunler/VaryantPenceresi.tsx",
];

/**
 * ── "Bu ekranda kontrol beklenmiyor" kaydı (İP-A8 · Görev 2 · B-7) ──
 *
 * Kapının ekran başına iddiası `expect(o.adsiz).toBe(0)` idi ve bağımsız
 * denetim #3 ölçtü: **88 ekranın 71'inde totoloji.** Hiç kontrol render
 * edilmeyen bir ekranda "adsız kontrol yok" bir şey kanıtlamaz — sıfırdan
 * sıfır çıkar. (Bu, bu turda bulunan ÜÇÜNCÜ ölü iddiaydı.)
 *
 * İddia artık iki parçalıdır ve **kimliğe** bağlıdır:
 *
 *   1. Ekran ya en az bir kontrol render eder — o zaman `adsiz` iddiası
 *      gerçekten bir şey ayırt eder;
 *   2. ya da BURADA, gerekçesiyle yazılıdır — "kontrol beklenmiyor" bilinçli
 *      bir kayıttır, sessiz bir varsayılan değil.
 *
 * İki yön de kırar: listedeki bir ekran kontrol basmaya başlarsa da (kayıt
 * bayatladı), listede olmayan bir ekran kontrol basmayı bırakırsa da (ekran
 * sessizce boşaldı) kapı kırmızıdır.
 *
 * Gerekçe kodları:
 *   `sunum`          — rozet/ikon/durum/tablo hücresi; form kontrolü taşımaz.
 *   `kabuk`          — düzen/gezinme kabuğu ya da sağlayıcı; kendi alanı yok.
 *   `pencere-kabugu` — pencere gövdesi; kontroller `children`dan gelir.
 *   `kosullu`        — kontroller varsayılan (boş veri / kapalı) render'da
 *                      açılmayan dallarda yaşar; borçları derin dal
 *                      testlerinde ve ekran kabul testlerinde kapanır.
 */
const KONTROLSUZ_EKRANLAR: Record<string, "sunum" | "kabuk" | "pencere-kabugu" | "kosullu"> = {
  "src/components/AmenityTagGrid.tsx": "kosullu",
  "src/components/AppIcon.tsx": "sunum",
  "src/components/DashboardHeader.tsx": "kabuk",
  "src/components/DashboardShell.tsx": "kabuk",
  "src/components/ExamSessionsManager.tsx": "kosullu",
  "src/components/HScroll.tsx": "kosullu",
  "src/components/LibraryBookmarkButton.tsx": "sunum",
  "src/components/LibraryMediaManager.tsx": "kosullu",
  // Alt sekme çubuğu yalnız `NavLink`/`Link` basar; hesap penceresi de
  // bağlantılardan oluşur ve durumu URL'de yaşar (`?modal=hesap`). Form
  // kontrolü yok — "adsız kontrol 0" burada totoloji DEĞİL, sözleşmedir:
  // çubuğa bir gün girdi eklenirse bu kayıt yanlışlaşır ve kapı bağırır.
  "src/components/MobilAltSekmeler.tsx": "kabuk",
  "src/components/NavbarWidget.tsx": "kabuk",
  "src/components/NotificationsBell.tsx": "sunum",
  "src/components/PersonalizeModal.tsx": "kosullu",
  "src/components/PinIcon.tsx": "sunum",
  "src/components/ShareButton.tsx": "sunum",
  "src/components/ShareModal.tsx": "kosullu",
  "src/components/Spinner.tsx": "sunum",
  "src/components/StarRating.tsx": "sunum",
  "src/components/admin/AccessState.tsx": "sunum",
  // ── İP-B2 · liste ailesi ──
  // `aracCubugu`: propsuz hâlde ne arama ne filtre bildirilir; arama girdisi
  //   yalnız `arama` tanımı verilince doğar (kosullu).
  // `bosDurum`: h2 + açıklama + aksiyon yuvası; hiç form kontrolü taşımaz.
  // `menu`: kapalı menü yalnız tetikleyici düğmeyi basar; öğeler açılınca
  //   doğar ve zaten hiçbiri form kontrolü değil.
  // `baslikAksiyonu`: portal sarmalayıcısı; içeriği çağırandan gelir.
  "src/components/admin/ui2/liste/aracCubugu.tsx": "kosullu",
  "src/components/admin/ui2/liste/bosDurum.tsx": "sunum",
  "src/components/admin/ui2/liste/menu.tsx": "kosullu",
  "src/components/admin/layout/baslikAksiyonu.tsx": "kabuk",
  "src/components/admin/CourierManager.tsx": "kosullu",
  "src/components/admin/StockBadge.tsx": "sunum",
  "src/components/admin/StockLedgerPanel.tsx": "kosullu",
  "src/components/admin/StockMovementTable.tsx": "sunum",
  "src/components/admin/delivery/CapacityStrip.tsx": "sunum",
  "src/components/admin/delivery/ItemLines.tsx": "sunum",
  "src/components/admin/delivery/bits.tsx": "sunum",
  "src/components/admin/layout/AdminLayout.tsx": "kabuk",
  "src/components/admin/layout/AdminPageHeader.tsx": "kabuk",
  // İP-B1: profil menüsü KAPALI açılır; tema radyo düğmeleri menü açılınca
  // doğar. Açık hâli `panelKabugu.test.tsx`te gerçek DOM'da ölçülüyor.
  "src/components/admin/layout/AdminProfilMenusu.tsx": "kosullu",
  "src/components/admin/layout/AdminSidebar.tsx": "kabuk",
  "src/components/admin/store/ReturnsPanel.tsx": "kosullu",
  // CMS Faz 1: blog listesi salt liste + bağlantıdır; form kontrolü taşımaz
  // (arama/filtre yok — kayıt sayısı düşük). Editör sayfası kapıda ölçülür.
  "src/pages/admin/blog/AdminBlogListPage.tsx": "sunum",
  // CMS Faz 2: rota parametresi yokken editör iskelet basar; gerçek kontroller
  // Puck yüzeyinde doğar ve dev ortam provası + PG entegrasyonuyla ölçülür.
  // Mağaza içerik yöneticisi ağsız varsayılan render'da sayfa seçilene kadar
  // boş durum gösterir; formlar ve medya seçici kabul testlerinde açılır.
  // Tedarikçi paneli: ağsız render'da tedarikçi listesi BOŞtur ve ekran
  // `EmptyState` basar. Durum şeridi, ayar formu ve tablolar ancak bir
  // tedarikçi satırı geldiğinde doğar — `ReturnsPanel` ile aynı sınıf.
  // Gerçek DOM ölçümü sözleşme testindedir (`SupplierPanel.test.tsx`).
  "src/components/admin/store/SupplierPanel.tsx": "kosullu",
  "src/components/admin/ui/Badge.tsx": "sunum",
  "src/components/admin/ui/Button.tsx": "sunum",
  // Kapalı pencere hiçbir şey render etmez; adet alanları yalnız `open`
  // iken doğar. Gerçek DOM ölçümü kendi davranış testindedir.
  "src/components/admin/packing/SplitDialog.tsx": "pencere-kabugu",
  "src/components/admin/ui/ConfirmDialog.tsx": "pencere-kabugu",
  "src/components/admin/ui/Dialog.tsx": "pencere-kabugu",
  "src/components/admin/ui/PageState.tsx": "sunum",
  "src/components/admin/ui2/gezinmeBekcisi.tsx": "kabuk",
  "src/components/admin/ui2/medusa-tr.tsx": "kabuk",
  "src/components/ui/Modal.tsx": "pencere-kabugu",
  // Dairesel ok düğmesi: `PlainButton` üzerine kurulu saf sunum. Adı çağrı
  // yerinden ZORUNLU `aria-label` ile gelir, kendi başına render edilince
  // adsız görünür — `PlainButton` ile aynı sınıf.
  "src/components/ui/DaireDugme.tsx": "sunum",
  "src/components/ui/PlainButton.tsx": "sunum",
  "src/pages/DeliveryDriver.tsx": "kosullu",
  "src/pages/DeliveryRunHandover.tsx": "kosullu",
  "src/pages/admin/AdminAccessPage.tsx": "kosullu",
  // Duyuru şeridi listesi: ağsız render'da liste BOŞtur (`KayitYokDurumu`
  // basar) ve oluşturma formu `showForm` KAPALI doğar — "Yeni duyuru"ya
  // basılınca açılır. `ProductsPanel`/`SupplierPanel` ile aynı sınıf; gerçek
  // DOM ölçümü `adminAnnouncements.acceptance.test.tsx`tedir.
  "src/pages/admin/AdminDashboardPage.tsx": "kosullu",
  "src/pages/admin/AdminOperationsPage.tsx": "kosullu",
  "src/pages/admin/AdminPayoutsPage.tsx": "kosullu",
  // Öne çıkarma satışları: varsayılan render bir LİSTE ekranıdır — filtre
  // çipleri düğmedir, tek form kontrolü (gerekçe alanı) yalnız iptal
  // penceresi AÇIKKEN mount olur. Pencerenin kendi sözleşmesi ayrıca
  // ölçülür (`ui/gerekcePenceresi.test.tsx`, SK-7/SK-8).
  "src/pages/admin/AdminPromotionsPage.tsx": "kosullu",
  "src/pages/admin/AdminSectionPage.tsx": "kabuk",
  "src/pages/admin/AdminSettingsPage.tsx": "kosullu",
  // Eğitmen ön başvuruları: öne çıkarma listesiyle aynı sınıf — varsayılan
  // render filtre çipleri (düğme) + boş liste basar, form kontrolü yok;
  // durum geçişi düğmeleri yalnız veri gelince doğar.
  "src/pages/admin/AdminTutorApplicationsPage.tsx": "kosullu",
  "src/pages/admin/AdminUserDetailPage.tsx": "kosullu",
  "src/pages/admin/delivery/DeliveryLayout.tsx": "kabuk",
  "src/pages/admin/delivery/DeliveryOrdersPage.tsx": "kosullu",
  "src/pages/admin/delivery/DeliveryPerformancePage.tsx": "kosullu",
  "src/pages/admin/delivery/DeliveryRunDetailPage.tsx": "kosullu",
  "src/pages/admin/delivery/DeliveryVehiclesPage.tsx": "kosullu",
  "src/pages/admin/inventory/CountSessionDetailPage.tsx": "kosullu",
  "src/pages/admin/inventory/InventoryLayout.tsx": "kabuk",
  "src/pages/admin/inventory/InventoryOverviewPage.tsx": "kosullu",
  "src/pages/admin/packing/PackagesPage.tsx": "kosullu",
  "src/pages/admin/packing/PackingLayout.tsx": "kabuk",
  "src/pages/admin/packing/PackingQueuePage.tsx": "kosullu",
  "src/pages/admin/packing/PackingStationPage.tsx": "kosullu",
  "src/pages/admin/packing/ReturnQueuePage.tsx": "kosullu",
  "src/pages/dashboards/AdminExamCatalogs.tsx": "kosullu",
  "src/pages/dashboards/AdminHome.tsx": "kosullu",
  "src/pages/dashboards/AdminLibraries.tsx": "kosullu",
  // Rota kabuğu varsayılan test konumunda HOME panelini açar; veri gelmeden
  // kontrol basmaz. Sekme ve form dalları admin mağaza kabul testlerindedir.
  "src/pages/dashboards/CourierHome.tsx": "kosullu",
  "src/pages/dashboards/OperatorHome.tsx": "kosullu",
  "src/pages/dashboards/OperatorLibrary.tsx": "kosullu",
  "src/pages/dashboards/OperatorSessions.tsx": "kosullu",
  // ── İ9 · Boşluk 1: `src/panel/**` ──
  // `PanelProvider`/`PanelShell`: sağlayıcı + gezinme kabuğu, kendi form
  // alanı yok (masaüstünde hamburger düğmesi de basmaz — yalnız mobilde).
  "src/panel/PanelProvider.tsx": "kabuk",
  "src/panel/layout/PanelShell.tsx": "kabuk",
  // `Durum` modülünün ilk büyük harfli export'u `HataDurumu` (AntD `Alert`) —
  // sunum, form kontrolü taşımaz.
  "src/panel/components/Durum.tsx": "sunum",
  // Kardeş varyant matrisi: satırlar (`satirlar`) olmadan tablo boş —
  // fiyat/barkod/stok girdileri yalnız veri gelince doğar.
  "src/panel/components/Matris.tsx": "kosullu",
  // Ürün medya sekmesi: gerçek bir ürünle (`ZORUNLU_PROPLAR`) ölçüldü —
  // `productId`/`urun` verilince BosDurumu KAPISI açılır ve kapak + galeri
  // gerçekten mount olur (44 DOM düğümü). Ama bu ekranın TEK "form kontrolü"
  // (`input`/`select`/`textarea`) adayı iki `type="file" hidden"` seçicidir
  // ve ikisi de sayaçtan ÖLÇÜM DIŞI: `hidden` özniteliği taşıyan kontrol
  // erişilebilirlik ağacında yoktur, görünen tetikleyici (`Button`) kendi
  // metnini taşır — `scripts/ui-baseline-sayim.mjs`teki sanksiyonlu istisnanın
  // AYNISI ("ref ile tetiklenen dosya seçicileri"), `LibraryMediaManager.tsx`
  // ile aynı desen. Yükleme/sıralama/silme aksiyonları `Button`dur, bu
  // sayacın kapsamındaki tip değildir (`KONTROL = "input, select, textarea"`,
  // `test-utils/alanAdlari.ts`). Ölçüldü: `toplam:0, dugumSayisi:44` — sunum,
  // form kontrolü taşımaz.
  "src/panel/components/MedyaSekmesi.tsx": "sunum",
  // Kapalı pencere hiçbir şey render etmez (AntD `Drawer` varsayılanı
  // `open` olana dek gövdeyi mount etmez) — `ConfirmDialog`/`Dialog` ile
  // aynı sınıf.
  "src/panel/components/YanPencere.tsx": "pencere-kabugu",
  // "Ürün Oluştur" çekmecesi (commit `15c218d`): `YanPencere` üstüne
  // kurulu, kapalıyken gövdeyi mount etmez — `YanPencere.tsx` ve
  // `VaryantPenceresi.tsx` ile BİREBİR aynı sınıf.
  // Liste kabuğu: arama kutusu ve sayfalayıcı prop/veriyle gelir; propsuz
  // mount (arama ucu yok, veri yok) hiç kontrol çizmez.
  "src/panel/components/ListePage.tsx": "kosullu",
  // Envanter genel bakış: sayaç kartları ve bağlantılar; form kontrolü yalnız izinli/verili dalda yok.
  "src/panel/pages/urunler/EnvanterGenelBakis.tsx": "kosullu",
  "src/panel/pages/urunler/UrunOlusturCekmecesi.tsx": "pencere-kabugu",
  // Araç çubuğu yüzeyleri: kapıda mount edilen ilk export `FiltreCekmecesi`
  // ve `acik` propu geçilmediği için AntD `Drawer` gövdeyi hiç mount etmez —
  // `UrunOlusturCekmecesi.tsx`/`YanPencere.tsx` ile BİREBİR aynı sınıf.
  "src/panel/pages/urunler/UrunAracCubugu.tsx": "pencere-kabugu",
  "src/panel/pages/urunler/VaryantPenceresi.tsx": "pencere-kabugu",
  "src/panel/pages/urunler/YeniSayimCekmecesi.tsx": "pencere-kabugu",
  "src/panel/pages/urunler/StokSayimiPencereleri.tsx": "pencere-kabugu",
  "src/panel/pages/urunler/HasarliStokPencereleri.tsx": "pencere-kabugu",
  "src/panel/pages/urunler/KategoriCekmecesi.tsx": "pencere-kabugu",
  "src/panel/pages/urunler/TedarikciCekmecesi.tsx": "pencere-kabugu",
  "src/panel/pages/urunler/Tanimlamalar.tsx": "sunum",
  "src/panel/pages/siparisler/IadePenceresi.tsx": "pencere-kabugu",
  "src/panel/pages/siparisler/SiparisDetayPencereleri.tsx": "pencere-kabugu",
  "src/panel/pages/siparisler/SiparisDetayi.tsx": "kosullu",
  // Paket detayı: rota parametresi olmadan hata durumu; pencereler kapalıyken gövde yok.
  "src/panel/pages/paketleme/PaketlemeDetayi.tsx": "kosullu",
  "src/panel/pages/dagitim/DagitimTurDetayi.tsx": "kosullu",
  "src/panel/pages/dagitim/KuryePencereleri.tsx": "pencere-kabugu",
  "src/panel/pages/dagitim/AracPencereleri.tsx": "pencere-kabugu",
  "src/panel/pages/egitmenler/EgitmenIlanPencereleri.tsx": "pencere-kabugu",
  "src/panel/pages/egitmenler/EgitmenIlanlari.tsx": "kosullu",
  "src/panel/pages/dagitim/DagitimAraclar.tsx": "kosullu",
  "src/panel/pages/paketleme/PaketlemePencereleri.tsx": "pencere-kabugu",
  "src/panel/pages/paketleme/GeriDonusKuyrugu.tsx": "kosullu",
  "src/panel/pages/paketleme/DepoyaAlPenceresi.tsx": "pencere-kabugu",
  "src/panel/pages/musteriler/MusteriDetayPencereleri.tsx": "pencere-kabugu",
  "src/panel/pages/ayarlar/DenetimKaydiPenceresi.tsx": "pencere-kabugu",
  "src/panel/pages/ayarlar/BayrakGerekcePenceresi.tsx": "pencere-kabugu",
  "src/panel/pages/ayarlar/RolCekmecesi.tsx": "pencere-kabugu",
  "src/panel/pages/ayarlar/HataCozme.tsx": "kosullu",
  "src/panel/pages/paketleme/PaketlemeKuyrugu.tsx": "kosullu",
  "src/panel/pages/ayarlar/PersonelYetkiler.tsx": "kosullu",
  "src/panel/pages/ayarlar/GenelAyarlar.tsx": "kosullu",
  "src/panel/pages/indirimler/KuponCekmecesi.tsx": "pencere-kabugu",
  // Müşteri detayı: form kontrolü yalnız silme çekmecesinde; propsuz mount hata kartı basar.
  "src/panel/pages/musteriler/MusteriDetayi.tsx": "kosullu",
  "src/panel/pages/urunler/StokSayimiDetayi.tsx": "kosullu",
};

/**
 * ── Ekranın mount edilebilmesi için gereken ASGARİ prop (İP-A8 · Görev 1) ──
 *
 * Kapı ilke olarak propsuz mount eder; propsuz açılamayan dosyalar
 * `KAPI_DISI`'nda gerekçesiyle yazılıdır. Arada üçüncü bir sınıf çıktı ve
 * **yeni 403 çıpası onu görünür etti**: `AdminHome`/`AdminSectionPage` propsuz
 * MOUNT OLUYOR ama `section` `undefined` kaldığı için izin alanı
 * `SECTION_AREA[undefined]` → `undefined` oluyor ve ekran kendi içeriği yerine
 * 403 kutusu basıyordu. Yani ekran "ölçülüyor" görünüyordu, ölçülen şey hata
 * kutusuydu — B-5'in aynısı, başka sebeple.
 *
 * `KAPI_DISI`'na park etmek yanlış olurdu: oranın ters provası "propsuz mount
 * EDİLEMİYOR" der, bunlar ediliyor. Doğru cevap ekranı **gerçekten render
 * ettirmek**: bölüm seçimi ekranın verisi değil, rota parametresidir.
 *
 * Bu bir kaçış kapısı olmasın diye iki yönlü korunur (aşağıdaki `afterAll`):
 * buradaki her dosya kapsamda olmalıdır ve prop verilen ekran da diğerleriyle
 * aynı iddialara tabidir (403 basamaz, boş DOM basamaz, kontrol kaydı tutulur).
 */
const ZORUNLU_PROPLAR: Record<string, Record<string, unknown>> = {
  // Rota parametresi: `/yonetim/ilanlar` → `section="listings"`. Üç bölümün
  // hepsi aynı bileşendir; kapı ilkini render eder, üçünün dalları
  // `adminTutorApproval.acceptance`te açılır (DERIN_KAPI).
  "src/pages/admin/AdminSectionPage.tsx": { section: "listings" },
  "src/pages/dashboards/AdminHome.tsx": { section: "listings" },
  // ── İP-B1 · komut penceresi: KAPALI hâli `null` render eder ──
  //
  // İkisi de propsuz MOUNT OLUR (bu yüzden `KAPI_DISI`'na yazılamazlar: oranın
  // ters provası "propsuz mount EDİLEMİYOR" der) ama `acik` verilmediğinde
  // hiçbir düğüm basmazlar ve kapının 2. çıpası ("boş DOM basmadı") haklı
  // olarak kırılır. Doğru cevap `AdminSectionPage`teki gibi ekranı GERÇEKTEN
  // render ettirmektir: açıklık bir veri değil, bir kip parametresidir.
  "src/components/admin/layout/AdminKomutPenceresi.tsx": {
    acik: true,
    onAc: () => {},
    onKapat: () => {},
  },
  // İP-B2 · başlık aksiyonu yuvası: `children` YOKSA hiçbir düğüm basmaz
  // (portal hedefi de yoktur, `<>{undefined}</>` döner) ve kapının 2. çıpası
  // ("boş DOM basmadı") haklı olarak kırılır. `AdminKomutPenceresi`teki
  // gerekçenin aynısı: içerik bir veri değil, bileşenin varlık sebebi.
  "src/components/admin/layout/baslikAksiyonu.tsx": {
    children: "Yeni ürün",
  },
  "src/components/admin/ui2/komutPenceresi.tsx": {
    acik: true,
    onKapat: () => {},
    baslik: "Komut penceresi",
    aramaEtiketi: "Panelde ara",
    yerTutucu: "Ara…",
    sorgu: "",
    onSorgu: () => {},
    gruplar: [],
    etkin: 0,
    onEtkin: () => {},
  },
  // `MedyaSekmesi`: `productId` undefined iken `BosDurumu` basar (yükleme/
  // silme/sıralama UI'ı hiç mount olmaz). Gerçek ölçüm için KAYITLI bir ürün
  // verilir — şekil `urunFormu.test.tsx`teki `DUZENLENECEK_URUN` fixture'ıyla
  // AYNI (id/title/kind/price/cover_url/images), buraya `images` bir kayıtla
  // dolduruldu ki sıralama/silme düğmeleri de gerçekten render edilsin.
  "src/panel/components/MedyaSekmesi.tsx": {
    productId: 9,
    urun: {
      id: 9,
      slug: "kirmizi-defter",
      title: "Kırmızı Defter",
      kind: "PHYSICAL",
      seller_type: "PLATFORM",
      price: "45.50",
      compare_at_price: null,
      tax_rate: "0.20",
      currency: "TRY",
      cover_url: null,
      in_stock: true,
      stock: 12,
      images: [
        { id: 101, url: "https://cdn.example.com/1.jpg", sort_order: 0, alt_text: null, caption: null },
      ],
    },
  },
};

/**
 * 403 kutusu basması BEKLENEN dosyalar (İP-A8 · Görev 1 · B-5).
 *
 * Kural "hiçbir ekran 403 basmaz"tır; tek meşru istisna kutunun KENDİ
 * modülüdür — `AccessState.tsx`in ilk büyük harfli export'u `AccessDenied`
 * olduğu için kapı doğrudan onu render eder. İstisna isimle yazılıdır ki
 * ikincisi doğduğunda sessizce eklenemesin.
 */
const ERISIM_KUTUSU_BEKLENEN = ["src/components/admin/AccessState.tsx"];

const moduller = import.meta.glob("/src/**/*.tsx");

// ── Parçalanmış kapının sayaçları (İP-A7d4 · Görev 3) ──
//
// Ekran başına ayrı test yazmak, birleşik testin sağladığı iki şeyi kaybetme
// riski taşır: (a) "hepsi gerçekten koştu mu", (b) "toplamda bir şey render
// edildi mi". İkisi de bu sayaçlarla dosyanın SONUNDAKİ nöbetçilere taşınır.
const olculenEkranlar = new Set<string>();
const olculenKapiDisi = new Set<string>();
/** Gerçekten kontrol render eden ekranlar — yalancı-yeşil kapısının ÇIPASI. */
const kontrolBasanEkranlar = new Set<string>();

const tabanEkranlari = (OLCUM_TABANI as string[]).filter((f) => f.endsWith(".tsx"));
const kapsanan = tabanEkranlari.filter((f) => !(f in KAPI_DISI));

function bilesenMi(v: unknown): boolean {
  if (typeof v === "function") return true;
  // `forwardRef`/`memo` bir fonksiyon değil, `$$typeof` taşıyan nesnedir.
  return typeof v === "object" && v !== null && "$$typeof" in (v as object);
}

/** Dosyanın render edilecek bileşeni: varsa `default`, yoksa ilk büyük harfli export. */
async function ekranBileseni(dosya: string): Promise<ComponentType | null> {
  const yukle = moduller["/" + dosya];
  if (!yukle) throw new Error(`glob bulamadi: ${dosya}`);
  const mod = (await yukle()) as Record<string, unknown>;
  if (bilesenMi(mod.default)) return mod.default as ComponentType;
  for (const [ad, deger] of Object.entries(mod)) {
    if (/^[A-Z]/.test(ad) && bilesenMi(deger)) return deger as ComponentType;
  }
  return null;
}

/** Panel kabuğunun asgari bağlamı: sorgu istemcisi + rota + oturum. */
function kosum(C: ComponentType, proplar?: Record<string, unknown>): ReactElement {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{createElement(C, proplar)}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  // Ağ yok: her uç boş veri döner. Ekranlar boş/yükleniyor durumunda render
  // edilir — ölçülen şey "veri geldi mi" değil, "render edilen alanın adı var mı".
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) =>
    ({ data: [], status: 200, statusText: "OK", headers: {}, config }) as never;
  // ── Oturum GERÇEK izin listesiyle kurulur (İP-A8 · Görev 1 · B-5) ──
  //
  // Eskiden `admin_permissions: ["*"]` yazıyordu. Joker diye bir şey yok:
  // `lib/adminAccess.ts` tam kodu arar, backend de hiçbir zaman `"*"`
  // üretmez. Sonuç: `useAdminAreaAccess` kullanan 17 taban ekranı
  // `canView === false` dönüyor ve ekran yerine 403 kutusu basıyordu — 88
  // ekranın 14'ü. Kapı bunları "ölçtüm" sayıyor, üstelik yalancı-yeşil eşiği
  // (`toplamKontrol >= 39`) tam da o çökmüş sayıya kalibre ediliyordu.
  //
  // Ölçülen kontrol sayısı bu düzeltmeyle 39 → 60'a çıktı. **Artış regresyon
  // DEĞİL**: 14 ekran ilk kez gerçekten render ediliyor (İP-A8 raporu §1).
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: [...TAM_ADMIN_IZINLERI] } as never,
  });
});

describe("İP-A6b çalışma zamanı kapısı · kapsam iki yönlü korunur", () => {
  it("KAPI_DISI'ndaki her dosya ölçüm tabanında yazılıdır", () => {
    expect(Object.keys(KAPI_DISI).filter((f) => !tabanEkranlari.includes(f))).toEqual([]);
  });

  it("DERIN_KAPI'daki her dosya ölçüm tabanında yazılıdır", () => {
    expect(DERIN_KAPI.filter((f) => !tabanEkranlari.includes(f))).toEqual([]);
  });

  it("taban ekranlarının hepsi ya kapıda ya gerekçeli listede (üçüncü ihtimal yok)", () => {
    expect(kapsanan.length + Object.keys(KAPI_DISI).length).toBe(tabanEkranlari.length);
  });

  it("kapı kapsamı KİMLİKLE sabittir (sayı değil)", () => {
    // İki yön de kırmızı üretir:
    //   • listede olup artık kapsanmayan  → ekran sessizce kapı dışına çıktı
    //   • kapsanıp listede olmayan        → kapı sessizce başka bir şey ölçüyor
    // Sayısal taban ikisini de göremezdi: biri çıkıp biri girince 88 sabit
    // kalır. Bugün ölçülen: 105 taban `.tsx` − 17 gerekçeli = 88 ekran kapıda.
    expect([...kapsanan].sort()).toEqual([...KAPI_KAPSAMI].sort());
  });

  it("KAPI_KAPSAMI ile KAPI_DISI kesişmez ve ikisi tabanı tam kaplar", () => {
    // Listenin kendisi de bir kaçış kapısı olmasın: bir dosyayı HEM kapsama
    // HEM gerekçeli listeye yazmak, iki yönlü korumayı birbirine karşı
    // körleştirirdi.
    const kesisim = KAPI_KAPSAMI.filter((f) => f in KAPI_DISI);
    expect(kesisim).toEqual([]);
    expect([...KAPI_KAPSAMI, ...Object.keys(KAPI_DISI)].sort()).toEqual(
      [...tabanEkranlari].sort()
    );
  });

  /**
   * ── İP-A7d4 · Görev 3: EKRAN BAŞINA AYRI TEST ──
   *
   * Ters prova. Bu olmadan `KAPI_DISI` bir kaçış kapısı olurdu: mount
   * edilebilen bir ekranı listeye yazmak kapıyı sessizce daraltırdı.
   *
   * Eskiden tek bir döngüydü ve tek kırmızı "on yedi dosyadan biri yanlış
   * park edilmiş" derdi; hangisi olduğu ancak mesaj okunarak bulunurdu.
   */
  it.each(Object.entries(KAPI_DISI))(
    "KAPI_DISI gerekçesi doğru: %s propsuz mount EDİLEMİYOR",
    async (dosya, kayit) => {
      olculenKapiDisi.add(dosya);
      const C = await ekranBileseni(dosya);
      if (kayit.tur === "bilesen-yok") {
        expect(C, `${dosya}: bilesen VAR, "bilesen-yok" yazilmis`).toBeNull();
        return;
      }
      expect(C, `${dosya}: bilesen yok, "props" yazilmis`).not.toBeNull();
      expect(
        () => kontrolOlcumu(kosum(C!)),
        `${dosya}: propsuz MOUNT EDILEBILIYOR (${kayit.gerekce})`
      ).toThrow();
    }
  );

  // Parçalama yeni bir sessiz daralma yolu açar: bir `it.each` girdisi
  // üretilmezse (liste boşalır, filtre eklenir, `describe.skip` yazılır)
  // suite yeşil kalır ve HİÇBİR ekran ölçülmemiş olur. Sayaç değil kimlik.
  //
  // ⚠️ Bu kontrol bir `it` DEĞİL bir `afterAll`dur ve gerekçesi ölçüldü:
  // ilk yazımda `it` idi ve "dosya içindeki testler bildirim sırasında koşar"
  // varsayımına dayanıyordu. **Yanlıştı** — `--sequence.shuffle` dosya İÇİNDEKİ
  // testleri de karıştırıyor ve tohum 4001'de kapanış nöbetçileri `it.each`
  // bloklarından ÖNCE koşup üçü birden kırmızı düştü. `afterAll` sıradan
  // bağımsızdır: suite bittikten sonra, her hâlde çalışır.
  afterAll(() => {
    expect([...olculenKapiDisi].sort()).toEqual(Object.keys(KAPI_DISI).sort());
  });
});

describe("İP-A6b çalışma zamanı kapısı · adsız kontrol", () => {
  /**
   * ── İP-A7d4 · Görev 3: 88 ekran TEK testte değil, EKRAN BAŞINA ──
   *
   * Eskiden tek `it` bütün kapsamı mount ediyordu ve tam suite yükü altında
   * 9,9 saniye sürüyordu — `testTimeout`un (9000 ms) ÜSTÜNDE. Ayakta kalması
   * yalnız dosyaya yazılmış 120 sn'lik ezmeye bağlıydı, yani `vitest.config`
   * kuralının ("dosya başına testTimeout ezmesi YAPILMAZ") istisnasıydı.
   *
   * Asıl bedel bütçe değil TEŞHİSTİ: tek bir yavaş ekran testi zaman aşımına
   * düşürdüğünde 88 ekranın HİÇBİRİ ölçülmemiş oluyordu ve tek kırmızı hangi
   * ekranın sorunlu olduğunu söylemiyordu.
   *
   * Parçalanınca her ekran kendi bütçesinde koşar (ölçülen: ekran başına
   * ~40-120 ms) ve kırmızı doğrudan ekranı adıyla gösterir. Süre artışı
   * kabul edildi; bu turda ölçüm aletinin güvenilirliği defalarca süreye
   * tercih edildi.
   */
  it.each(kapsanan)(
    "%s — gerçekten render edildi + adsız kontrol tabanı KİMLİKLE sabit",
    async (dosya) => {
      const C = await ekranBileseni(dosya);
      expect(C, `${dosya}: render edilebilir bilesen yok`).not.toBeNull();
      const o = kontrolOlcumu(kosum(C!, ZORUNLU_PROPLAR[dosya]));
      olculenEkranlar.add(dosya);
      if (o.toplam > 0) kontrolBasanEkranlar.add(dosya);

      // ── Çıpa 1: 403 kutusu RENDER SAYILMAZ (İP-A8 · Görev 1 · B-5) ──
      //
      // Ekran kendisi yerine "Bu alan için yetkiniz yok" bastıysa bundan
      // sonraki hiçbir iddia ekranın gerçek içeriğine değmiyor demektir. Eski
      // kapı bunu hiç ölçmüyordu ve 88 ekranın 14'ünü sessizce hata kutusu
      // hâlinde "ölçüyordu".
      expect(
        o.erisimReddedildi,
        `${dosya}: ekran yerine 403 kutusu render edildi — fixture'in izin ` +
          "listesi eksik (test-utils/adminIzinleri) ya da ekran yeni bir izin " +
          "alani kullaniyor. Bu ekran OLCULMUS SAYILMAZ."
      ).toBe(ERISIM_KUTUSU_BEKLENEN.includes(dosya));

      // ── Çıpa 2: ekran boş DOM basmadı ──
      expect(o.dugumSayisi, `${dosya}: hicbir sey render edilmedi`).toBeGreaterThan(0);

      // ── Çıpa 3: "kontrol beklenmiyor" bilinçli bir KAYIT (B-7) ──
      //
      // Bu olmadan aşağıdaki `adsiz` iddiası 88 ekranın 64'ünde totolojidir.
      const kontrolBekleniyor = !(dosya in KONTROLSUZ_EKRANLAR);
      expect(
        o.toplam > 0,
        kontrolBekleniyor
          ? `${dosya}: varsayilan render'da HIC kontrol yok — "adsiz kontrol 0" ` +
            "iddiasi totoloji. Ekran gercekten kontrolsuzse KONTROLSUZ_EKRANLAR'a " +
            "gerekcesiyle yaz."
          : `${dosya}: KONTROLSUZ_EKRANLAR'da yazili ama ${o.toplam} kontrol ` +
            "render etti — kayit bayatladi, listeden cikar."
      ).toBe(kontrolBekleniyor);

      // Beklenen borç: listede yazılıysa o sayı, yoksa SIFIR. İki yön de kırar
      // — yeni borç da, listedeki bir borcun sessizce kapanması da.
      expect(
        o.adsiz,
        `${dosya} — varsayilan render'da adsiz kontrol: ${o.adsizHtml.join(" | ")}`
      ).toBe(CALISMA_ZAMANI_ADSIZ[dosya] ?? 0);
    }
  );

  /**
   * Parçalamanın ÜÇ nöbetçisi. Bunlar olmadan bölünmüş kapı, birleşiğinin
   * sağladığı iki yönlü korumanın altına düşerdi.
   *
   * ⚠️ Üçü de `it` DEĞİL, `afterAll` — ve gerekçesi ÖLÇÜLDÜ. İlk yazımda
   * `it` idiler ve "dosya içindeki testler bildirim sırasında koşar"
   * varsayımına dayanıyorlardı. Varsayım yanlıştı: `--sequence.shuffle`
   * dosya İÇİNDEKİ testleri de karıştırıyor ve **tohum 4001'de üçü birden
   * kırmızı düştü** (sayaçlar henüz doldurulmamışken koştular). Bu, paketin
   * kendi kapısında ürettiği gerçek bir kusurdu ve karışık tohum koşumu
   * yakaladı.
   *
   * `afterAll` sıradan bağımsızdır: hangi sırayla koşulursa koşulsun,
   * suite bittikten sonra çalışır.
   */
  afterAll(() => {
    // Yön 1: listede olup ölçülmeyen. `it.each` girdisi üretilmezse ya da bir
    // ekran sessizce atlanırsa burada görünür.
    expect([...olculenEkranlar].sort()).toEqual([...KAPI_KAPSAMI].sort());

    // Yön 2: listede olup kapsamda OLMAYAN bir dosya, hiçbir testin
    // doğrulamadığı ölü bir kayıttır — borç kapanmış gibi görünmeden orada
    // durur. Birleşik testte bu otomatik yakalanıyordu (`toEqual` sözlük
    // karşılaştırması); parçalanınca ayrıca yazılması gerekir.
    expect(Object.keys(CALISMA_ZAMANI_ADSIZ).filter((f) => !kapsanan.includes(f))).toEqual([]);

    // ── Yalancı-yeşil kapısı artık SAYI değil KİMLİK (İP-A8 · Görev 1) ──
    //
    // Eskiden `toplamKontrol >= 39` yazıyordu ve 39, kapının kendi bozuk
    // fixture'ıyla ölçülmüş sayının ta kendisiydi: **koruduğu ölçümden
    // türetilmiş bir eşik o ölçümü koruyamaz.** Aynı hata bu turda üçüncü kez
    // yapılmıştı (`kapsanan.length >= 88` kimlikle çözülmüştü; bu, sayıyla
    // tekrarladı).
    //
    // Çıpa artık bağımsız: hangi ekranların kontrol bastığı KİMLİKLE
    // sabittir. Kontrol basan bir ekran susarsa da, susan bir ekran kontrol
    // basmaya başlarsa da kırmızıdır — ve ikisi birbirini götürerek toplamı
    // sabit tutamaz.
    expect([...kontrolBasanEkranlar].sort()).toEqual(
      kapsanan.filter((f) => !(f in KONTROLSUZ_EKRANLAR)).sort()
    );

    // Kaydın kendisi de bayatlamasın: listedeki her dosya kapsamda olmalı.
    expect(Object.keys(KONTROLSUZ_EKRANLAR).filter((f) => !kapsanan.includes(f))).toEqual([]);
    expect(ERISIM_KUTUSU_BEKLENEN.filter((f) => !kapsanan.includes(f))).toEqual([]);
    expect(Object.keys(ZORUNLU_PROPLAR).filter((f) => !kapsanan.includes(f))).toEqual([]);
  });
});
