/**
 * İP-A1/A2 nöbetçi taban sayımı (İP-A0 `sayim.sh`'in taşınabilir Node sürümü).
 *
 * ## Neden AST (İP-A2 düzeltmesi)
 *
 * İlk sürüm (İP-A1) sayımı ham metin üzerinde regex ile yapıyordu. Bu iki
 * yanlışı birden üretiyordu:
 *
 *   1. **Yorum satırları sayılıyordu.** Bir satır yorumunda ya da JSX içine
 *      gömülü blok yorumda geçen `<button` gerçek bir buton sanılıyordu.
 *   2. **String/şablon içerikleri sayılıyordu.** Bir örnek metninde geçen
 *      `<label htmlFor=…` oran paydasını şişiriyordu.
 *
 * Yön "artamaz" olduğu için bu sessiz geçiş üretmiyordu; ama İP-A6/A7'de
 * eşikler AŞAĞI çekilecek ve yorumda kalmış tek bir `<button` **meşru bir
 * düşüşü bloklardı** — nöbetçi, düzeltmeyi cezalandırırdı.
 *
 * Çözüm satır penceresi ya da "önce yorumları sil" tarzı bir metin ön temizliği
 * DEĞİL: bu kod tabanı Türkçe ve JSX metinleri kesme işaretiyle dolu
 * (`Medusa'nın`, `preset'in`). Elle yazılmış bir tarayıcı o kesme işaretini
 * string başlangıcı sanar ve dosyanın yarısını yutar. Bu yüzden sayım
 * TypeScript'in kendi parser'ıyla üretilen **AST** üzerinde yapılır
 * (kök CLAUDE.md §C: sınıf/fonksiyon sınırı AST ile bulunmalı).
 *
 * Yan kazanç: `<button` ile `<ButtonGroup` ayrımı, kendi kapanan `<button />`
 * biçimi ve `role={"dialog"}` gibi ifade biçimleri artık doğru okunuyor.
 *
 * ## ⚠️ Sayacın GERÇEĞİ SÖYLEMEYİ BIRAKTIĞI YER (İP-A6b · BULGU-1)
 *
 * Bu sayaç kaynakta **YAZILANI** sayar; kullanıcı **RENDER EDİLENİ** görür.
 * İkisi aynı şey değildir ve fark üretimde bugün de var:
 *
 *   - `store/ProductForm.tsx` → `KunyeAlani` **tek yazım**, dokuz çağrı yeri
 *   - 158 yazımın 7'si bir `.map()` içinde (`AdminAccessPage:161,205` ·
 *     `DeliveryOrdersPage:299` · `PackagesPage:298` · `OperatorLibrary:565,581,588`)
 *
 * Denetim #2 bunu mutasyonla ölçtü (M-A): ölçülen bir dosyaya on iki çağrılı,
 * tek yazımlık, **adsız** bir alan fabrikası eklendi ve aynı dosyada bir borç
 * `aria-label` ile kapatıldı. Gerçek borç **+11**, çalışma zamanında **12**
 * adsız kontrol; sayaç **+0** dedi ve nöbetçiler 39/39 yeşil geçti.
 *
 * Bu yüzden **"adsız kontrol" EŞİĞİNİN doğruluk kaynağı artık bu dosya
 * değildir**. Kapı çalışma zamanına devredildi:
 *
 *   - `src/__guards__/calismaZamaniKapisi.test.tsx` — mount edilebilen her
 *     taban ekranı render edilir, adsız kontrol DOM'dan sayılır (sığ)
 *   - `src/pages/dashboards/adminStoreDalAdlari.acceptance.test.tsx` — göç
 *     eden formların TÜM koşullu dalları açılır (derin)
 *   - kalıcı kayıt ve mutasyon: `src/__guards__/mA.kacis.test.tsx`
 *
 * `adsizKontrol` burada **teşhis sayısı** olarak kalır (dosya + satır listesi
 * üretir; göç eden kişinin nereye bakacağını söyler) ve `uiBaseline.test.ts`te
 * hâlâ bir TAVAN olarak tutulur — ama tek başına kanıt değildir.
 *
 * Aynı ayrım `modalDurumu` için GEÇERLİ DEĞİLDİR: pencere durumunun nerede
 * yaşadığı sözdizimsel bir olgudur, DOM'da gözlenmez; o metrik bilinçli olarak
 * kaynak üzerinde kalır (İP-A6b · Görev 4).
 *
 * Hem CLI'dan (`node scripts/ui-baseline-sayim.mjs`) hem testten çağrılır.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import ts from "typescript";

// Hem CLI (`node scripts/...`) hem Vitest, çalışma dizini `frontend/` iken koşar.
// Vitest kaynağı dönüştürdüğü için `import.meta.url` dosya URL'i olmayabilir;
// bu yüzden kök cwd'den alınır ve varlığı doğrulanır.
const ROOT = process.cwd();
if (!existsSync(join(ROOT, "src")) || !existsSync(join(ROOT, "package.json"))) {
  throw new Error(
    `ui-baseline-sayim: calisma dizini frontend/ olmali, bulundu: ${ROOT}`
  );
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return out;
  }
  for (const name of entries) {
    const r = posix.join(dir, name);
    if (statSync(join(ROOT, r)).isDirectory()) walk(r, out);
    // Test dosyaları ÖLÇÜM DIŞI: taban, kullanıcıya sevk edilen arayüzü ölçer.
    // Test fixture'larındaki `<button>`/`<label>` kasten ilkeldir (erişilebilirlik
    // sözleşmesini kanıtlamak için ham etiket gerekir) ve borç sayılamaz. İP-A2'de
    // ui2/ ve inventory/ altına ilk test dosyaları girince taban 126'dan 128'e
    // "yükseldi"; sayılan şey borç değil, borcu ölçen testlerdi.
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(r);
  }
  return out;
}

/**
 * Ölçüm tabanına DİZİN kuralıyla girmeyen, ama aynı panel kabuğunu kullanan ve
 * aynı göçe girecek ekranlar (İP-A3c · denetim P1-4).
 *
 * Taban eskiden yalnız `components/admin/**` + `pages/admin/**` +
 * `dashboards/Admin*.tsx` idi. Aşağıdaki altı ekran `DashboardShell`
 * kullanıyor, aynı `admin/ui` parçalarını çağırıyor ve A6-A7'de göç edecek —
 * ama ölçümün DIŞINDAYDI. İki ayrı zarar üretiyordu: (a) nöbetçi bu bölgede
 * borcun büyümesine izin veriyordu, (b) bir ekranı taban dışına taşımak eşiği
 * düşürüyor ve "ilerleme" gibi okunuyordu.
 *
 * `DeliveryDriver.tsx` kök CLAUDE.md'ye göre ADMIN rolünün saha ekranıdır ve
 * tek başına 19 ham buton taşıyordu — ölçülen 126'nın %15'i, tamamen görünmez.
 */
export const EK_TABAN_DOSYALARI = [
  "src/pages/DeliveryDriver.tsx",
  "src/pages/DeliveryRunHandover.tsx",
  "src/pages/dashboards/CourierHome.tsx",
  "src/pages/dashboards/OperatorHome.tsx",
  "src/pages/dashboards/OperatorLibrary.tsx",
  "src/pages/dashboards/OperatorSessions.tsx",
];

/**
 * ── Ölçüm tabanının TAM dosya listesi — ölçümün KAYNAĞI (İP-A6 · Görev 1) ──
 *
 * Bu liste İP-A3c'de eklendi ama o gün yalnız bir KİMLİK DENETİMİYDİ: sayım
 * dizin yürüyüşünden geliyor, liste ise sonucun aynı olduğunu doğruluyordu.
 * İP-A5 kaçışı ölçtü (TB-A5-1): ölçülen bir dosya `components/admin` /
 * `pages/admin` ağacının DIŞINA taşındığında dört eşiğin dördü de geçmeye
 * devam etti (ham buton 158 → 151, adsız kontrol 56 → 39) — çünkü yürüyüş
 * onu artık bulmuyordu ve düşen sayı "ilerleme" gibi okunuyordu. Kaçışı
 * yakalayan tek şey listeyle karşılaştırma oldu.
 *
 * İP-A7'de 21 ekran göç edecek, yani dosya hareketi NORMAL iş akışı olacak;
 * bu kaçış kazayla tetiklenir. Bu yüzden yön tersine çevrildi:
 *
 *   - Ölçülen küme artık YÜRÜYÜŞ değil, BU LİSTEDİR.
 *   - Listedeki bir dosya diskte yoksa `eksikDosyalar`a düşer ve nöbetçi
 *     kırılır — sessizce ölçüm dışı kalamaz.
 *   - Yürüyüşün bulup listede olmayan dosyası `fazlaDosyalar`a düşer ve
 *     nöbetçi yine kırılır — yeni borç ölçüme girmeden büyüyemez.
 *
 * Liste elle bakılıp güncellenir. Kırıldığında sorulacak soru: "dosya
 * gerçekten panelin bir parçası mı, öyleyse listeye ekle" ya da "silindi mi,
 * öyleyse çıkar". Sessizce güncellenmesi eşikleri anlamsızlaştırır.
 */
export const OLCUM_TABANI = [
  // ── İP-A6b · Görev 3: İMPORT GRAFİĞİNİN GETİRDİĞİ 27 DOSYA ──
  //
  // Bunlar panel ekranlarının DOĞRUDAN (ya da onların üzerinden geçişli olarak)
  // import ettiği yerel `.tsx` bileşenleridir; dizin kuralı hiçbirini
  // görmüyordu. Aralarında göç edecek asıl düzenleme yüzeyleri var:
  // `LibraryEditorModal` (15 kontrol), `ExamSessionsManager` (14 ham düğme,
  // 2 adsız kontrol, 1 etiketsiz overlay), `LibraryPayoutForm` (5 adsız
  // kontrol), `MapPicker` (9 ham düğme). `AdminLibraries`/`AdminExamCatalogs`
  // zaten ölçülüyordu ama o ekranların DÜZENLEME yüzeyi ölçüm dışındaydı.
  //
  // Eşiklerdeki artış regresyon DEĞİL, ölçümün dürüstleşmesidir (Görev 6).
  "src/components/AmenityTagGrid.tsx",
  "src/components/AppIcon.tsx",
  "src/components/Avatar.tsx",
  "src/components/DashboardHeader.tsx",
  "src/components/DashboardShell.tsx",
  "src/components/DeliveryRouteMap.tsx",
  "src/components/ExamSessionsManager.tsx",
  "src/components/HScroll.tsx",
  "src/components/ImageCropModal.tsx",
  "src/components/LibrariesMap.tsx",
  "src/components/LibraryBookmarkButton.tsx",
  "src/components/LibraryEditorModal.tsx",
  "src/components/LibraryMapPanel.tsx",
  "src/components/LibraryMediaManager.tsx",
  "src/components/LibraryPayoutForm.tsx",
  "src/components/MapPicker.tsx",
  // 9 Eyl 2026 · mobil alt sekme çubuğu. `DashboardShell`ten import edildiği
  // için ölçüm ağacına GİRER — nöbetçi bunu kendisi yakaladı ve dosya ancak
  // buraya yazıldıktan sonra yeşile döndü. Ham düğme: 1 (anonim kullanıcının
  // "Giriş" sekmesi; bir rotaya gitmediği için `Link` olamaz), adsız kontrol
  // yok (düğmenin görünür metni "Giriş"), etiketsiz overlay yok (hesap
  // sayfası ortak `ui/Modal`ı kullanır).
  "src/components/MobilAltSekmeler.tsx",
  "src/components/NavbarWidget.tsx",
  "src/components/NotificationsBell.tsx",
  // 8 Eyl 2026 · panel şeridi: eğitmenin kalıcı sekme satırı (bkz.
  // `__guards__/panoSeridi.test.tsx`). Ölçüme girdi — ham düğme ve adsız
  // kontrol taşımıyor, eşikler değişmedi.
  "src/components/PanelSekmeleri.tsx",
  "src/components/PersonalizeModal.tsx",
  "src/components/PinIcon.tsx",
  "src/components/QrScanner.tsx",
  "src/components/ShareButton.tsx",
  "src/components/ShareModal.tsx",
  "src/components/Spinner.tsx",
  "src/components/StarRating.tsx",
  "src/components/map/MapGate.tsx",
  // Dairesel ok düğmesi (7 Eyl 2026): vitrin/şerit kaydırma ve "tümünü gör"
  // oklarının TEK kaynağı. Üç ayrı el yazımını değiştirdi; ölçüme sıfır borç
  // ekler (ham düğme değil, adı zorunlu `aria-label` ile geliyor).
  "src/components/ui/DaireDugme.tsx",
  "src/components/ui/Field.tsx",
  "src/components/ui/Modal.tsx",
  "src/components/ui/PlainButton.tsx",
  "src/components/admin/AccessState.tsx",
  "src/components/admin/CourierManager.tsx",
  "src/components/admin/ProductPicker.tsx",
  "src/components/admin/StockBadge.tsx",
  "src/components/admin/StockLedgerPanel.tsx",
  "src/components/admin/StockMovementTable.tsx",
  "src/components/admin/StockMovementsPanel.tsx",
  "src/components/admin/data-table/DataTable.tsx",
  "src/components/admin/data-table/index.ts",
  "src/components/admin/delivery/CapacityStrip.tsx",
  "src/components/admin/delivery/ClosedDays.tsx",
  "src/components/admin/delivery/ItemLines.tsx",
  "src/components/admin/delivery/LabelSheet.tsx",
  "src/components/admin/delivery/bits.tsx",
  "src/components/admin/inventory/DamageDialog.tsx",
  // İP-B1 · Görev 4: panel kabuğunun yeni parçaları. Üçü de `ui2/` ve
  // `layout/` altında, yani sevk edilen panel arayüzünün parçası — ölçüme
  // GİRMEK zorundalar. Listeye yazılmasalardı `fazlaDosyalar` kırılırdı ve
  // nöbetçinin tam olarak istenen davranışı budur.
  // İP-B2 · Görev "birincil aksiyon yuvası": ekranın düğmesini kabuğun başlık
  // şeridine taşıyan portal. `ui2/`/`layout/` altındaki her şey gibi sevk
  // edilen panel arayüzünün parçası — ölçüme GİRMEK zorunda.
  "src/components/admin/layout/AdminKomutPenceresi.tsx",
  "src/components/admin/layout/AdminLayout.tsx",
  "src/components/admin/layout/AdminPageHeader.tsx",
  "src/components/admin/layout/AdminProfilMenusu.tsx",
  "src/components/admin/layout/AdminSidebar.tsx",
  "src/components/admin/layout/adminNavigation.ts",
  "src/components/admin/layout/baslikAksiyonu.tsx",
  "src/components/admin/layout/panelKabuguDurumu.ts",
  "src/components/admin/packing/PackageLabel.tsx",
  "src/components/admin/packing/PackingLabelSheet.tsx",
  // Kısmi teslimat penceresi (Faz 3). Ortak `DuzenlemePenceresi` + `Button`
  // kullanır; kendi overlay'ini kurmaz, ham `<button>` taşımaz.
  "src/components/admin/packing/SplitDialog.tsx",
  // CMS Faz 1 · blog editörü. Toolbar'ın ham `<button>`ı bilinçli istisnadır:
  // `aria-pressed` taşıyan biçim SEÇİM durumları (kalın/italik/liste…) — ortak
  // `Button`ın dolgu/gölge varyantları kompakt araç çubuğuna uymuyor
  // (`AdminStore` KatlanirBaslik ailesi).
  "src/components/admin/content/BlogBodyEditor.tsx",
  // İP-A5 · `AdminStore.tsx` bölmesi. Bu sekiz satır OLMAZSA borç ölçüm
  // dışına kaçardı: 26 adsız kontrol, 28 ham buton ve bir etiketsiz overlay
  // eski dosyadan bu dosyalara taşındı. Liste güncellenmeseydi taban testi
  // kırılırdı — nöbetçinin tam olarak istenen davranışı budur.
  "src/components/admin/store/BulkImportPanel.tsx",
  "src/components/admin/store/CategoriesPanel.tsx",
  "src/components/admin/store/CouponsPanel.tsx",
  "src/components/admin/store/EditProductModal.tsx",
  "src/components/admin/store/OrdersPanel.tsx",
  "src/components/admin/store/ProductForm.tsx",
  // Ürün galerisi yönetimi: çoklu görsel uçları API'de yazılıydı ama hiçbir
  // yerden çağrılmıyordu; yönetici bir ürüne yalnız tek kapak koyabiliyordu.
  // Dosya ölçüme SIFIR borç ekler (ham düğme yok, adsız kontrol yok) — iki
  // tavan da doluydu, eklenemezdi.
  "src/components/admin/store/ProductMediaManager.tsx",
  "src/components/admin/store/ProductsPanel.tsx",
  "src/components/admin/store/ReturnsPanel.tsx",
  "src/components/admin/store/StoreAttributesManager.tsx",
  // Tedarikci senkronu (Yildirim B2B) — yeni yuzey, dogdugu gun olcume girer.
  "src/components/admin/store/SupplierLinkDialog.tsx",
  // Varyant matrisi: kardeşler bugüne dek TEK TEK türetiliyordu
  // (3 renk × 3 ebat = dokuz tur). Ölçüme sıfır borç ekler.
  "src/components/admin/store/VariantMatrixPanel.tsx",
  "src/components/admin/store/SupplierPanel.tsx",
  "src/components/admin/ui/Badge.tsx",
  "src/components/admin/ui/Button.tsx",
  "src/components/admin/ui/ConfirmDialog.tsx",
  "src/components/admin/ui/Dialog.tsx",
  "src/components/admin/ui/PageState.tsx",
  "src/components/admin/ui/index.ts",
  "src/components/admin/ui2/duzenlemeYuzeyi.tsx",
  "src/components/admin/ui2/form.tsx",
  // İP-A6 · Görev 3: rota gezinmesinde kirli form uyarısı. Yeni dosya
  // ölçüme GİRMEK zorunda — `ui2/` altındaki her şey gibi o da panelin
  // sevk edilen arayüzünün parçası.
  "src/components/admin/ui2/gezinmeBekcisi.tsx",
  // İP-A7d4 · Görev 1: "içeriğim korumasız" dedektörünün bağlamı + DOM
  // sondası. `.ts` olduğu için çalışma zamanı kapısına girmez (JSX taşımaz),
  // ama ölçüm tabanına GİRER: `ui2/` altındaki her şey gibi o da panelin
  // sevk edilen arayüzünün parçası.
  "src/components/admin/ui2/icerikKorumasi.ts",
  "src/components/admin/ui2/kirliFormBekcisi.tsx",
  // İP-B1 · Görev 4: komut penceresinin ORTAK mekanizması (görev modülünün
  // paletinden taşındı).
  "src/components/admin/ui2/komutPenceresi.tsx",
  // ── İP-B2 · liste ailesi (ortak parçalar) ──
  //
  // Beşi de `ui2/` altında ve panelin 22 liste ekranının kopyalayacağı
  // yüzeyi taşıyor. Listeye yazılmasalardı `fazlaDosyalar` kırılırdı ve
  // nöbetçinin tam olarak istenen davranışı budur: yeni panel arayüzü,
  // ölçüme girmeden doğamaz.
  "src/components/admin/ui2/liste/aracCubugu.tsx",
  "src/components/admin/ui2/liste/bosDurum.tsx",
  "src/components/admin/ui2/liste/index.ts",
  "src/components/admin/ui2/liste/menu.tsx",
  "src/components/admin/ui2/liste/satirAksiyonlari.tsx",
  "src/components/admin/ui2/medusa-tr.tsx",
  // İP-A6: düzenleme yüzeyinin DURUM kancası buraya ayrıldı (import döngüsü
  // kırıldı; gerekçe dosyanın başında).
  "src/components/admin/ui2/yuzeyDurumu.ts",
  "src/components/store/ProductCard.tsx",
  "src/pages/DeliveryDriver.tsx",
  "src/pages/DeliveryRunHandover.tsx",
  "src/pages/admin/AdminAccessPage.tsx",
  "src/pages/admin/AdminAuditLogsPage.tsx",
  "src/pages/admin/AdminBookingsPage.tsx",
  // CMS Faz 1 · blog yönetimi (liste + editör).
  "src/pages/admin/blog/AdminBlogEditorPage.tsx",
  "src/pages/admin/blog/AdminBlogListPage.tsx",
  // CMS Faz 2 · Puck editörü. Medya seçicinin küçük-resim düğmesi ile
  // yöneticinin sayfa seçim satırı bilinçli ham `<button>`: ikisi de SEÇİM
  // yüzeyi (aria-current / görsel ızgarası), ortak Button'ın dolgu dili uymaz.
  "src/pages/admin/AdminDashboardPage.tsx",
  "src/pages/admin/AdminDemandsPage.tsx",
  "src/pages/admin/AdminOperationsPage.tsx",
  "src/pages/admin/AdminPayoutsPage.tsx",
  "src/pages/admin/AdminPromotionsPage.tsx",
  "src/pages/admin/AdminReportsPage.tsx",
  "src/pages/admin/AdminSectionPage.tsx",
  // Eğitmen ön başvuruları (lead listesi).
  "src/pages/admin/AdminTutorApplicationsPage.tsx",
  "src/pages/admin/AdminSettingsPage.tsx",
  "src/pages/admin/AdminUserDetailPage.tsx",
  "src/pages/admin/AdminUsersPage.tsx",
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
  // ── İ9 · Boşluk 1: `src/panel/**` (ikas tarzı yeni panel) ──
  //
  // Bağımsız denetimin bulduğu ölçüm boşluğu: bu ağaç `OLCUM_TABANI`nın DIŞINDA
  // doğdu, dört eşik de onu hiç ölçmeden yeşil kaldı. `kesfedilenTaban()`
  // artık `src/panel`i DİZİN KURALIYLA yürüyor (yukarıdaki not), bu liste onun
  // BUGÜNKÜ karşılığı. Panel AntD kullanıyor (`<Button>`, `<Input.Search>`,
  // `<Modal>`…) — ham `<button>`/`<input>` JSX etiketi YAZMIYOR, bu yüzden
  // `rawButton`/`adsizKontrol`a (kaynak AST metrikleri) katkısı sıfırdır; bu
  // ikisinin doğruluk kaynağı zaten çalışma zamanı kapısıdır (bkz. dosya başı
  // BULGU-1 notu) — `calismaZamaniKapisi.test.tsx` panel ekranlarını GERÇEK
  // DOM üzerinden ölçer.
  "src/panel/PanelProvider.tsx",
  "src/panel/theme.ts",
  "src/panel/layout/menu.ts",
  "src/panel/layout/PanelShell.tsx",
  "src/panel/components/Durum.tsx",
  "src/panel/components/FormPage.tsx",
  "src/panel/components/ListePage.tsx",
  "src/panel/components/Matris.tsx",
  "src/panel/components/MedyaSekmesi.tsx",
  "src/panel/components/TipSecimi.tsx",
  "src/panel/components/YanPencere.tsx",
  // Müşteriler modülünün ilk ekranı. Test dosyaları (`musteriListesi.test.tsx`,
  // `musteriListesiRota.test.ts`) kapsam dışıdır — walk ile aynı gerekçe
  // (fixture'lardaki ham etiketler borç değildir).
  "src/panel/pages/musteriler/MusteriListesi.tsx",
  "src/panel/pages/musteriler/MusteriDetayi.tsx",
  "src/panel/pages/musteriler/MusteriDetayPencereleri.tsx",
  // Gösterge paneli (`/yonetim-yeni` iniş sayfası): saf AntD (Select, Tag,
  // Link) — ham `<button>`/`<input>` yok, pencere durumu yok.
  "src/panel/pages/gosterge/GostergePaneli.tsx",
  // Siparişler modülünün ilk ekranı (commit `06ab4d2`). Test dosyaları
  // (`siparisListesi.test.tsx`, `siparisListesiRota.test.ts`) kapsam dışıdır
  // — walk ile aynı gerekçe (fixture'lardaki ham etiketler borç değildir).
  "src/panel/pages/siparisler/SiparisListesi.tsx",
  "src/panel/pages/siparisler/IadeListesi.tsx",
  "src/panel/pages/siparisler/IadePenceresi.tsx",
  "src/panel/pages/urunler/UrunFormu.tsx",
  "src/panel/pages/urunler/UrunListesi.tsx",
  "src/panel/pages/urunler/VaryantPenceresi.tsx",
  // "Ürün Oluştur" çekmecesi (ikas referansı §4) — `TipSecimi` modalının
  // yerini alan yeni hızlı-ekleme akışı. AntD kullanıyor (`Form`, `Upload`,
  // `Select`…), ham `<button>`/`<input>` yazmıyor — `rawButton`/
  // `adsızKontrol`a katkısı `UrunFormu.tsx`/`UrunListesi.tsx` gibi sıfır.
  // Ayrı dosya (VaryantPenceresi/eski TipSecimi ile aynı desen) BİLEREK:
  // `uiBaseline.test.ts::modalDurumu` yalnız AYNI DOSYADAKİ yerel bileşenleri
  // izliyor, cross-file akış görünmez — bkz. o dosyadaki dosya başı notu.
  "src/panel/pages/urunler/UrunOlusturCekmecesi.tsx",
  // Ürün listesi araç çubuğunun yüzeyleri (ikas referansı §3): filtre
  // çekmecesi, kolon ayarı, CSV içe aktarma ve ızgara görünümü. Ayrı dosya
  // olma gerekçesi `UrunOlusturCekmecesi.tsx` ile AYNI (üstteki not):
  // `<Drawer open={filtreAcik}>` `UrunListesi.tsx`e yazılsaydı `modalDurumu`
  // kırılırdı. Saf AntD + bir tek `hidden` dosya girdisi (`aria-label`lı,
  // dolayısıyla `olcumDisiKontrol`) — dört metriğe katkısı sıfır.
  "src/panel/pages/urunler/UrunAracCubugu.tsx",
  // Stok sayımı listesi ve yeni sayım çekmecesi: saf AntD, pencere durumu
  // çekmece dosyasında prop olarak gelir.
  "src/panel/pages/urunler/StokSayimiListesi.tsx",
  "src/panel/pages/urunler/StokHareketleriListesi.tsx",
  "src/panel/pages/urunler/EnvanterGenelBakis.tsx",
  "src/panel/pages/urunler/HasarliStokListesi.tsx",
  "src/panel/pages/urunler/HasarliStokPencereleri.tsx",
  "src/panel/pages/urunler/KategoriListesi.tsx",
  "src/panel/pages/urunler/KategoriCekmecesi.tsx",
  "src/panel/pages/urunler/StokSayimiDetayi.tsx",
  "src/panel/pages/urunler/StokSayimiPencereleri.tsx",
  "src/panel/pages/urunler/UrunSecici.tsx",
  "src/panel/pages/urunler/YeniSayimCekmecesi.tsx",
];

/**
 * ── İMPORT GRAFİĞİ: tabanın ikinci denetleyicisi (İP-A6b · Görev 3 · BULGU-2) ──
 *
 * Taban eskiden yalnız DİZİN kuralıyla denetleniyordu (`components/admin/**`,
 * `pages/admin/**`, `dashboards/Admin*` + `EK_TABAN_DOSYALARI`). Denetim #2 bu
 * sınırın kaçış ürettiğini ölçtü (M-B): ölçülen bir ekranın **doğrudan import
 * ettiği** bir bileşen bu ağacın dışındaysa borcu hiç görünmüyordu —
 * `src/lib/denetim2Kacak.tsx` (3 ham düğme · 3 adsız kontrol · 1 etiketsiz
 * overlay) nöbetçilerden 39/39 yeşil geçti.
 *
 * Sentetik bir risk değildi: ölçülen 82 dosyanın doğrudan import ettiği dokuz
 * yerel bileşen (`ExamSessionsManager` 14 düğme, `LibraryEditorModal` 15
 * kontrol, `MapPicker` 9 düğme, `QrScanner`, `LibraryPayoutForm` 5 adsız
 * kontrol…) ölçümün dışındaydı. Göç edecek düzenleme yüzeyinin ÇOĞU
 * görünmüyordu.
 *
 * ## Kural (örnek listeyle değil, kuralla yazılır)
 *
 *   1. Ölçüm tabanından ulaşılan **her yerel `.tsx` modülü** ya
 *      `OLCUM_TABANI`'nda olmalı ya da `fazlaDosyalar`a düşmelidir. Kapanış
 *      GEÇİŞLİDİR (fixpoint): listeye giren dosyanın importları da aynı kurala
 *      tabidir.
 *   2. Kapanış `.ts` modüllerinden **GEÇER ama onları ÖLÇMEZ**
 *      (İP-A8 · Görev 2 · B-6). Ölçülen dört metriğin dördü de JSX
 *      metriğidir ve `.ts` dosyası JSX taşıyamaz — dolayısıyla `.ts` bir
 *      ölçüm hedefi değildir. Ama bir **YOL**dur: `export … from "./X"`
 *      yazan bir `.ts` barreli üzerinden ulaşılan `.tsx` bileşeni, kapanış
 *      `.ts`te DURDUĞU sürece dört metriğin dördüne de görünmezdi.
 *
 *      Bağımsız denetim #3 bunu sentetik kaçakla ölçtü (B-6): `src/lib`
 *      altında bir `.ts` barreli üzerinden bağlanan 3 ham düğme + 2 adsız
 *      kontrol + 1 etiketsiz overlay **50/50 nöbetçiden yeşil geçti**. Bu,
 *      sayacın altıncı kusuruydu ve sayının doğruluğunu değil KAPSAMINI
 *      ilgilendiriyordu.
 *
 *      Kapanış artık `.ts` kenarlarını da yürür; `ulasilan` kümesine yalnız
 *      `.tsx` modülleri girer, yani taban `api/`/`hooks/`/`lib/` katmanıyla
 *      ŞİŞMEZ — ama o katmanın arkasına saklanmış bir arayüz dosyası da
 *      kaçamaz.
 *   3. `.ts` dosyasının KENDİ içindeki tek olası kaçak
 *      `React.createElement("button")`tır ve ayrı bir BÜTÜN-AĞAÇ
 *      nöbetçisiyle kapatılır (`tsHamButonlari`).
 *   4. Test dosyaları kapsam dışıdır (walk ile aynı gerekçe: fixture'lardaki
 *      ham etiketler borç değildir).
 *
 * Grafik `paths` çözümünü TypeScript'in konfigürasyonundan okumaz; bu depoda
 * tek takma ad `@/*` → `src/*`tır ve burada elle karşılanır. Yeni bir takma ad
 * eklenirse buraya da eklenmelidir — aksi hâlde o yoldan gelen import sessizce
 * çözülmez, bu yüzden `cozulmeyenIthaller` ayrıca raporlanır.
 */
// `.ts` de çözülür — ölçülmez ama İZLENİR (B-6). Sıra önemli: aynı adlı
// `.tsx` varsa o kazanır (bugün depoda böyle bir çift yok, ama kural sabit).
const ITHAL_UZANTILARI = [".tsx", ".ts", "/index.tsx", "/index.ts"];

/** Bir import metnini repo köküne göreli `.tsx` yoluna çözer; çözemezse null. */
export function ithalYolunuCoz(kaynakDosya, metin) {
  let temel;
  if (metin.startsWith("@/")) temel = posix.join("src", metin.slice(2));
  else if (metin.startsWith(".")) temel = posix.normalize(posix.join(posix.dirname(kaynakDosya), metin));
  else return null; // paket importu — yerel modül değil
  const aday = (y) => (existsSync(join(ROOT, y)) && !/\.test\.tsx?$/.test(y) ? y : null);
  if (/\.tsx?$/.test(temel)) return aday(temel);
  for (const ek of ITHAL_UZANTILARI) {
    const bulunan = aday(temel + ek);
    if (bulunan) return bulunan;
  }
  return null;
}

/** Bir dosyanın import/export/dinamik-import metinleri (AST — yorumdaki yol sayılmaz). */
export function ithalMetinleri(kaynak, dosyaAdi) {
  const sf = ts.createSourceFile(
    dosyaAdi,
    kaynak,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(dosyaAdi) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const out = [];
  const gez = (n) => {
    if (
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier &&
      ts.isStringLiteral(n.moduleSpecifier)
    ) {
      out.push(n.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0])
    ) {
      out.push(n.arguments[0].text);
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return out;
}

/**
 * Tohum dosyalardan GEÇİŞLİ olarak ulaşılan yerel `.tsx` modülleri
 * (tohumlar hariç).
 *
 * Yürüyüş `.ts` modüllerinden de GEÇER (B-6: bir `.ts` barreli üzerinden
 * yeniden dışa vurulan bileşen dört metriğin dördüne de görünmüyordu), ama
 * `.ts` sonuca GİRMEZ: JSX taşıyamaz, dolayısıyla ölçüm hedefi değildir.
 * Böylece kapsam kapanır, taban `api/hooks/lib` katmanıyla şişmez.
 */
export function ulasilanModuller(tohumlar) {
  const gorulen = new Set(tohumlar);
  const kuyruk = tohumlar.filter((f) => existsSync(join(ROOT, f)));
  const ulasilan = new Set();
  while (kuyruk.length > 0) {
    const dosya = kuyruk.pop();
    for (const metin of ithalMetinleri(readFileSync(join(ROOT, dosya), "utf8"), dosya)) {
      const hedef = ithalYolunuCoz(dosya, metin);
      if (!hedef || gorulen.has(hedef)) continue;
      gorulen.add(hedef);
      if (hedef.endsWith(".tsx")) ulasilan.add(hedef);
      kuyruk.push(hedef);
    }
  }
  return [...ulasilan].sort();
}

/**
 * `.ts` (JSX'siz) dosyalarda `React.createElement("button")` ile üretilmiş ham
 * düğmeler — import grafiğinin `.ts`te durmasının bıraktığı tek deliği kapatır.
 * Bütün kaynak ağacında aranır, tabanla sınırlı değildir.
 */
export function tsHamButonlari() {
  return allSource()
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => dosyaOlcumu(readFileSync(join(ROOT, f), "utf8"), f).rawButton > 0)
    .sort();
}

/**
 * Dizin kuralıyla BULUNAN taban adayları — artık ölçümün kaynağı DEĞİL,
 * denetleyicisi.
 *
 * `src/panel/**` (İ9 · Boşluk 1) buraya eklendi. Bağımsız denetim ölçtü:
 * `ikas` tarzı yeni panel `OLCUM_TABANI`nın (isimle sabit liste) DIŞINDA
 * doğdu ve dört eşiğin dördü de onu hiç görmeden yeşil kaldı — TB-A5-1'in
 * aynısı, yeni ağaçta. `admin/`/`pages/admin` gibi elle her dosyayı listeye
 * eklemek yerine tüm alt ağaç DİZİN KURALINA bağlandı: yeni bir panel
 * modülü doğduğu an `fazlaDosyalar`a düşer ve nöbetçi kırılır — yani 15
 * modül boyunca bu satır bir daha ELLE güncellenmesi gerekmez, yalnız
 * `OLCUM_TABANI` listesi (aşağıda) her yeni dosyada güncellenir. Bu, depoda
 * zaten `components/admin`/`pages/admin` için kurulu olan ikinci-denetleyici
 * desenin AYNISI — yeni bir mekanizma icat edilmedi.
 */
export function kesfedilenTaban() {
  const files = [
    ...walk("src/components/admin"),
    ...walk("src/pages/admin"),
    ...walk("src/panel"),
  ];
  for (const f of walk("src/pages/dashboards")) {
    if (/\/Admin[^/]*\.tsx$/.test(f)) files.push(f);
  }
  for (const f of EK_TABAN_DOSYALARI) {
    if (existsSync(join(ROOT, f))) files.push(f);
  }
  return [...new Set(files)].sort();
}

/**
 * Ölçülecek dosyalar + listenin diskle ve yürüyüşle iki yönlü farkı.
 *
 * `olculen` yalnız listede OLAN ve diskte DURAN dosyalardır: eksik bir
 * dosyanın sayısı uydurulamaz, ama eksikliği `eksik` üzerinden bağırır.
 */
export function tabanDurumu(taban = OLCUM_TABANI) {
  const varMi = (f) => existsSync(join(ROOT, f));
  const olculen = taban.filter(varMi);
  const eksik = taban.filter((f) => !varMi(f));
  // İki denetleyici birden (İP-A6b · Görev 3): DİZİN kuralı + İMPORT GRAFİĞİ.
  // Birincisi "panel ağacına yeni dosya doğdu"yu, ikincisi "ölçülen ekran
  // borcunu ağacın dışına devretti"yi yakalar. M-B yalnız ikincisiyle görülür.
  const adaylar = new Set([...kesfedilenTaban(), ...ulasilanModuller(olculen)]);
  const fazla = [...adaylar].filter((f) => !taban.includes(f)).sort();
  return { olculen, eksik, fazla };
}

/** Geriye uyumlu ad: ölçülen dosya listesi. */
export function adminBase() {
  return tabanDurumu().olculen;
}

/** Tüm kaynak ağacı. */
export function allSource() {
  return walk("src").sort();
}

const read = (f) => readFileSync(join(ROOT, f), "utf8");

/** Baskı katmanları gerçek overlay değildir — isimle sabitlenmiş istisna listesi. */
export const PRINT_LAYERS = [
  "src/components/admin/delivery/LabelSheet.tsx",
  "src/components/admin/packing/PackageLabel.tsx",
  "src/components/admin/packing/PackingLabelSheet.tsx",
];

/** `role="dialog"` + `aria-modal` taşımayan gerçek overlay'i olan dosyalar (İP-A0 tespiti). */
export const UNLABELED_OVERLAY_FILES = [
  // İP-A6b · Görev 3: import grafiğiyle görünür olan İKİ dosya listeye GİRDİ.
  // Borç yeni doğmadı — bugüne dek ölçümün dışındaydı: ikisi de ölçülen bir
  // ekranın (`AdminLibraries`, `AdminExamCatalogs`) asıl düzenleme yüzeyidir
  // ve kendi `fixed inset-0` katmanını `role="dialog"`/`aria-modal` olmadan
  // kuruyor. 4 → 6.
  //
  // İP-A7d1 · Görev 3: ÜÇ katman listeden ÇIKTI (6 → 3). `LibraryEditorModal`
  // ile `AdminLibraries`in iki iç penceresi (`ManageModal`,
  // `LibraryPayoutModal`) ortak `DuzenlemePenceresi`ye geçti — `role="dialog"`,
  // `aria-modal`, odak tuzağı, ESC ve kirli form onayı onunla birlikte geldi.
  // `AdminLibraries.tsx` dosya olarak listeden düştü, çünkü kendi katmanı
  // kalmadı.
  // İP-A6 · Görev 4b: `store/EditProductModal.tsx` bu listeden ÇIKTI.
  // Kendi `createPortal` + `fixed inset-0` katmanını kuruyordu ve
  // `role="dialog"`/`aria-modal` taşımıyordu; artık `ui2/duzenlemeYuzeyi`nin
  // `DuzenlemePenceresi`ni kullanıyor (odak tuzağı, ESC, arka plan kilidi ve
  // kirli form onayı da onunla geldi). Sayı 5 → 4.
  //
  // ── İP-A7d2 · Görev 4: LİSTE BOŞALDI (3 → 0) ──
  //
  // Kalan üç katman da ortak `DuzenlemePenceresi`ye geçti:
  //   • `ExamSessionsManager` — oturum editörü
  //   • `AdminExamCatalogs`   — katalog editörü
  //   • `AdminPayoutsPage`    — ödeme kaydı penceresi (para ekranı)
  //
  // Liste artık BOŞ ve eşik SIFIR. Bu, metriğin ölçmeyi bıraktığı anlamına
  // GELMEZ: yön "artamaz" olduğu için sıfır, en sert hâlidir — panelde
  // etiketsiz bir overlay doğduğu gün CI kırılır.
];
const MEDUSA = "@medusajs/ui";

/**
 * Medusa'ya doğrudan bağımlılık mı?
 *
 * ── Kaçış yolu 2 (İP-A3c · denetim P3-1, mutasyon M5 GEÇMİŞTİ) ──
 * Paket kökü yerine ALT YOL yazmak (`@medusajs/ui/dist/esm/components/button`)
 * mimari kuralı aynen çiğner ama eski kontrol yalnız tam eşitliğe bakıyordu.
 */
const medusaYolu = (metin) => metin === MEDUSA || metin.startsWith(`${MEDUSA}/`);

/** Erişilebilir ad araması yapılan form kontrolleri. */
const KONTROL_ETIKETLERI = new Set(["input", "select", "textarea"]);

/**
 * ÖLÇÜM DIŞI `<input type=…>` değerleri ve gerekçeleri.
 *
 *   - `hidden`   → hiç render edilmez, odaklanamaz; etiketlenecek bir yüzeyi yok.
 *   - `submit` / `reset` / `button` / `image` → HTML'de **labelable değildirler**
 *     (`<label>` bu tiplere bağlanamaz); erişilebilir adları kendi
 *     `value`/`alt` içeriklerinden gelir. Bunları borç saymak, kapatılması
 *     imkânsız bir borç üretirdi.
 *
 * `checkbox`/`radio` ÖLÇÜM İÇİNDEDİR: ikisi de labelable'dır ve panelde
 * etiketsiz kutucuk gerçek bir erişilebilirlik borcudur.
 *
 * Tipten bağımsız İKİNCİ bir ölçüm dışı kural daha var: `hidden` özniteliği
 * taşıyan kontrol (`display:none`) erişilebilirlik ağacında yoktur. Bunlar
 * `ref` ile tetiklenen dosya seçicileridir; görünen tetikleyici kendi
 * etiketini taşır. Sadece `className`'de "hidden" geçmesi YETMEZ — dinamik
 * olabilir; `sr-only` ise zaten görünmez ama OKUNUR, ölçüm içinde kalır.
 */
export const OLCUM_DISI_INPUT_TIPLERI = new Set([
  "hidden",
  "submit",
  "reset",
  "button",
  "image",
]);

/**
 * ── İP-A4 metriği: EKRANDA yaşayan pencere (modal) durumu ──
 *
 * Bugün her ekran modalını kendi `useState`'iyle yönetiyor. 71 ekran böyle
 * yazılırsa, ileride rota tabanlı düzenleme yüzeylerine (`/…/:id/duzenle`)
 * geçme kararı 71 dosyayı ilgilendirir. İP-A4 pencere yönetimini `ui2/`
 * altına taşıdı (`duzenlemeYuzeyi.tsx`); bu sayaç geri kaymayı ölçer.
 *
 * **Ne sayılır:** bir `useState` bağı, adı aşağıdaki desene uyan bir BİLEŞENE
 * pencere durumu olarak veriliyorsa (ör. `<XDialog open={acik}>`,
 * `<DamageDialog kind={acikIslem}>`). Bağ başına bir kez sayılır.
 *
 * **Neden bileşen adına bakılıyor:** "modal state" sözdizimsel bir şey
 * değildir; `useState(false)` her yerde var. Ölçülebilir tanım, o durumun bir
 * PENCERE bileşenine verilmesidir. Ad deseni bilinçli olarak dardır —
 * yanlış pozitif, gerçek borcu gözden kaçırmaktan daha zararlıdır (aynı
 * gerekçe İP-A3c'de parçalanmış overlay sınıfı için de verildi).
 *
 * **Bilinen kaçış yolu:** pencere bileşeninin adı bu desene uymuyorsa
 * (ör. `<Katman görünür={acik}>`) sayaç görmez. Göç sırasında yeni bir
 * pencere bileşeni doğarsa desene eklenmelidir.
 */
const PENCERE_BILESENI = /(Dialog|Modal|Drawer|Sheet|Pencere|Yuzey|Overlay|Popover)$/;

/** Pencere durumu olarak okunan öznitelik adları. */
const PENCERE_OZNITELIKLERI = new Set([
  "open",
  "acik",
  "isOpen",
  "visible",
  "gorunur",
  "kind",
  "hedef",
  "yuzey",
]);

/**
 * ── İ9 · Boşluk 1 kapanışı: GEZİNME ÇEKMECESİ, KAYIT DÜZENLEME'den AYRI KATEGORİ ──
 *
 * `PanelShell.tsx`'in mobil gezinme çekmecesi (`<Drawer open={mobilAcik}>`)
 * yukarıdaki `PENCERE_BILESENI` deseniyle MEKANİK olarak eşleşiyor — bileşen
 * adı `Drawer`, öznitelik `open`. Eşleşme YANLIŞ değil: sayaç sözdizimsel bir
 * PENCERE durumu buluyor, tam istendiği gibi. Ama bu pencere
 * `useDuzenlemeYuzeyi`nin ölçtüğü sınıftan (bir KAYIT düzenleme/yeni kayıt
 * açma yüzeyi — `hedef: {tur:"kayit"|"yeni"}`, bkz.
 * `components/admin/ui2/yuzeyDurumu.ts`) FARKLI bir şey: bir gezinme menüsü.
 * Kaydı yok, "yeni" hâli yok, kapanırken kirli form onayı gerekmez.
 *
 * Çözüm eşiği gevşetmek DEĞİL (o korumayı değersizleştirirdi) ve pencereyi
 * `useDuzenlemeYuzeyi`ye taşımak da DEĞİL (hook'un anlamını bozardı — bir
 * gezinme menüsünü "düzenlenen kayıt" gibi göstermek yanlış olurdu). Yerine:
 * bu BİLİNEN gezinme çekmecelerini isimle sabit bir listeyle KENDİ
 * KATEGORİSİNE ayırmak — tıpkı `PRINT_LAYERS`in baskı katmanlarını overlay
 * sayımından ayırdığı gibi, deponun zaten kullandığı desenin bir örneği daha.
 *
 * ## Eşleşme KATI'dır (yanlış tarafa kaçamaz)
 *
 * Bir bağ ancak HEM dosyası HEM adı HEM DE bağlandığı TEK bileşen adı bu
 * listedeki bir kayıtla `dosya`+`ad`+`bilesen` olarak TAM eşleşirse gezinme
 * çekmecesi sayılır. Varsayılan yön "kayıt düzenleme durumu"dur (katı, sıfır
 * toleranslı `modalDurumu` kovası) — yeni/bilinmeyen bir bağ HER ZAMAN önce
 * bu sert kovaya düşer:
 *
 *   - Başka bir dosyada aynı adla bir `Drawer` doğarsa → dosya eşleşmez →
 *     KAYIT DÜZENLEME kovasına düşer, `modalDurumu` KIRILIR.
 *   - Aynı dosyada farklı adla İKİNCİ bir gezinme çekmecesi doğarsa → ad
 *     eşleşmez → aynı şekilde KIRILIR; insan listeye ekleyip bilinçli
 *     onaylamadan geçemez.
 *   - `mobilAcik` aynı dosyada GERÇEK bir düzenleme penceresine de
 *     (`<KayitDialog open={mobilAcik}>` gibi) verilirse bağın bağlandığı
 *     bileşen kümesi `{Drawer, KayitDialog}` olur — TEK bileşen şartı
 *     bozulur, bağ yine KAYIT DÜZENLEME kovasına düşer.
 *
 * Yani liste bir "affet" listesi değil, dar bir eşleşmeyle çalışan İKİNCİ bir
 * sınıflandırıcıdır; varsayılanı her zaman daha katı kovadır (aynı gerekçe
 * `OLCUM_TABANI`/`PRINT_LAYERS`'ta da geçerli: bilinmeyen borç önce en sert
 * kovaya düşer, listeye girmeden asla yumuşamaz). Kendi doğruluğu
 * `uiBaseline.test.ts`teki iki mutasyon provasıyla sınanır (kayıt düzenleme
 * kaçamaz / ikinci çekmece kaçamaz).
 */
export const GEZINME_CEKMECELERI = [
  {
    dosya: "src/panel/layout/PanelShell.tsx",
    ad: "mobilAcik",
    bilesen: "Drawer",
    gerekce:
      'mobil gezinme menüsü — kaydı yok, "yeni" hâli yok, kirli form onayı gerekmez',
  },
];

/** Bir kontrolü "adlandırılmış" sayan sarmalayıcı bileşenler. */
const KONTROL_SARMALAYICILARI = new Set(["Form.Control"]);

/** Bir JSX özniteliğinin (varsa) düz metin değeri; `x="a"` ve `x={"a"}` aynı okunur. */
function ozniteligeDeger(init) {
  if (!init) return null;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    const e = init.expression;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
      return e.text;
    }
  }
  return null;
}

/**
 * TEK BİR DOSYANIN ölçümü — saf fonksiyon, dosya sistemine dokunmaz.
 *
 * Testten doğrudan çağrılabilsin diye ayrıldı: sayacın yorum/string
 * saymadığını kanıtlamanın yolu, ona elde yazılmış bir kaynak vermektir.
 */
export function dosyaOlcumu(kaynak, dosyaAdi = "olcum.tsx") {
  const sf = ts.createSourceFile(
    dosyaAdi,
    kaynak,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    /\.tsx$/.test(dosyaAdi) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const o = {
    rawButton: 0,
    labels: 0,
    labelsWithHtmlFor: 0,
    overlays: 0,
    dialogRoles: 0,
    ariaModals: 0,
    medusaImport: false,
    // Erişilebilir adı olmayan form kontrolleri (İP-A3a metriği).
    kontrolToplam: 0,
    adsizKontrol: 0,
    adsizKontrolSatirlari: [],
    olcumDisiKontrol: 0,
    // İP-A4: ekranda yaşayan pencere durumu (bağ adları) — KAYIT DÜZENLEME
    // kovası (katı, sıfır toleranslı).
    modalDurumAdlari: [],
    // İ9 · Boşluk 1 kapanışı: GEZİNME ÇEKMECESİ kovası — `GEZINME_CEKMECELERI`
    // ile dosya+ad+bileşen TAM eşleşen bağlar (bkz. sabitin yanındaki not).
    gezinmeCekmecesiAdlari: [],
  };

  // Kontrol ↔ etiket bağı DOSYA ÖLÇEĞİNDE kurulur: `<label htmlFor={x}>` ile
  // `<input id={x}>` aynı JSX ağacında kardeş bile olmayabilir. Bu yüzden
  // önce dosyadaki bütün `htmlFor` değerleri toplanır, kontroller sonra
  // taranır. Karşılaştırma özniteliğin KAYNAK METNİ üzerinden yapılır; böylece
  // `htmlFor="ad"`↔`id="ad"` kadar `htmlFor={uid}`↔`id={uid}` de eşleşir.
  const htmlForDegerleri = new Set();
  const htmlForTopla = (n) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      if (n.tagName.getText(sf) === "label") {
        for (const p of n.attributes.properties) {
          if (ts.isJsxAttribute(p) && p.name.getText(sf) === "htmlFor" && p.initializer) {
            htmlForDegerleri.add(p.initializer.getText(sf).replace(/\s+/g, ""));
          }
        }
      }
    }
    ts.forEachChild(n, htmlForTopla);
  };
  htmlForTopla(sf);

  // ── Yerel etiket sarmalayıcıları ──
  //
  // Bu kod tabanında yaygın bir desen var:
  //
  //     function Field({ label, children }) {
  //       return <label className="…">{label}{children}</label>;
  //     }
  //     …
  //     <Field label="Araç adı"><input … /></Field>
  //
  // Buradaki `<input>` ÇALIŞMA ZAMANINDA `<label>` içinde sarmalanmıştır ve
  // erişilebilir adı vardır — ama JSX ağacında atası `<Field>`tir, `<label>`
  // değil. Bu tespit olmadan sayaç `DeliveryVehiclesPage`'in 18 alanını borç
  // sayıyordu; ölçüm gerçek borcu 18 fazla gösterirdi.
  //
  // Tespit AYNI DOSYAYLA sınırlıdır: başka dosyadan import edilen bir
  // sarmalayıcı görünmez. Kalan yanlış pozitif riski raporda listelenir.
  const sarmalayiciAdlari = new Set();
  const kapsayanAd = (n) => {
    for (let a = n.parent; a; a = a.parent) {
      if (ts.isFunctionDeclaration(a) && a.name) return a.name.getText(sf);
      if (
        (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) &&
        a.parent &&
        ts.isVariableDeclaration(a.parent) &&
        a.parent.name
      ) {
        return a.parent.name.getText(sf);
      }
    }
    return null;
  };
  const sarmalayiciTopla = (n) => {
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText(sf) === "label") {
      // `<label>` içinde `{children}` geçiyor mu?
      let cocukAktarimi = false;
      const ara = (m) => {
        if (ts.isJsxExpression(m) && m.expression) {
          const e = m.expression;
          const metin = e.getText(sf).replace(/\s+/g, "");
          if (metin === "children" || metin === "props.children") {
            cocukAktarimi = true;
          }
        }
        ts.forEachChild(m, ara);
      };
      n.children.forEach(ara);
      if (cocukAktarimi) {
        const ad = kapsayanAd(n);
        if (ad) sarmalayiciAdlari.add(ad);
      }
    }
    ts.forEachChild(n, sarmalayiciTopla);
  };
  sarmalayiciTopla(sf);

  /** Bir JSX düğümünün ataları arasında verilen etiketlerden biri var mı? */
  const atadaVarMi = (n, kabul) => {
    for (let a = n.parent; a; a = a.parent) {
      if (ts.isJsxElement(a) && kabul(a.openingElement.tagName.getText(sf))) {
        return true;
      }
    }
    return false;
  };

  const gez = (n) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const ad = n.tagName.getText(sf);
      const oz = n.attributes.properties;
      if (ad === "button") o.rawButton += 1;
      if (ad === "label") {
        o.labels += 1;
        if (
          oz.some(
            (p) => ts.isJsxAttribute(p) && p.name.getText(sf) === "htmlFor"
          )
        ) {
          o.labelsWithHtmlFor += 1;
        }
      }
      for (const p of oz) {
        if (!ts.isJsxAttribute(p)) continue;
        const pad = p.name.getText(sf);
        if (pad === "aria-modal") o.ariaModals += 1;
        if (pad === "role" && ozniteligeDeger(p.initializer) === "dialog") {
          o.dialogRoles += 1;
        }
      }

      // ── İP-A3a: erişilebilir adı olmayan form kontrolü ──
      if (KONTROL_ETIKETLERI.has(ad)) {
        const nitelik = (isim) =>
          oz.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === isim);

        const tipNit = nitelik("type");
        const tip = tipNit ? ozniteligeDeger(tipNit.initializer) : null;

        const gizliNit = nitelik("hidden");
        const gizli =
          !!gizliNit &&
          (!gizliNit.initializer ||
            gizliNit.initializer.getText(sf).replace(/\s+/g, "") === "{true}");

        if (
          gizli ||
          (ad === "input" && tip && OLCUM_DISI_INPUT_TIPLERI.has(tip.toLowerCase()))
        ) {
          o.olcumDisiKontrol += 1;
        } else {
          o.kontrolToplam += 1;

          // Dört adlandırma biçimi. Hiçbiri yoksa kontrol BORÇTUR.
          const ariaVar = !!(nitelik("aria-label") || nitelik("aria-labelledby"));

          const idNit = nitelik("id");
          const idBagli =
            !!idNit?.initializer &&
            htmlForDegerleri.has(idNit.initializer.getText(sf).replace(/\s+/g, ""));

          const labelIcinde = atadaVarMi(n, (t) => t === "label");
          const kontrolIcinde = atadaVarMi(
            n,
            (t) => KONTROL_SARMALAYICILARI.has(t) || sarmalayiciAdlari.has(t)
          );

          if (!ariaVar && !idBagli && !labelIcinde && !kontrolIcinde) {
            o.adsizKontrol += 1;
            o.adsizKontrolSatirlari.push(
              sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
            );
          }
        }
      }
    }

    // ── Kaçış yolu 1: `React.createElement("button", …)` ──
    //
    // JSX olmayan ham buton (İP-A3c · denetim P3-1, mutasyon M2 GEÇMİŞTİ).
    // Bugün kod tabanında yok; kapatılmasının sebebi kötü niyet değil, göç
    // sırasında kaza eseri ortaya çıkma ihtimali.
    if (ts.isCallExpression(n)) {
      const cagri = n.expression.getText(sf).replace(/\s+/g, "");
      if (
        (cagri === "createElement" || /(^|\.)React\.createElement$/.test(cagri)) &&
        n.arguments[0] &&
        ts.isStringLiteral(n.arguments[0]) &&
        n.arguments[0].text === "button"
      ) {
        o.rawButton += 1;
      }
    }

    // Overlay tespiti sınıf adına bakar; sınıf adı ancak bir string/şablon
    // parçasının İÇİNDE geçebilir. Yorumdaki `fixed inset-0` artık sayılmaz.
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)
    ) {
      o.overlays += (n.text.match(/fixed inset-0/g) || []).length;
    }

    // `import`, `export … from` ve dinamik `import()` — üçü de doğrudan
    // bağımlılıktır; regex sürümü yalnız ilkini görüyordu.
    if (
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier &&
      ts.isStringLiteral(n.moduleSpecifier) &&
      medusaYolu(n.moduleSpecifier.text)
    ) {
      o.medusaImport = true;
    }
    if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0]) &&
      medusaYolu(n.arguments[0].text)
    ) {
      o.medusaImport = true;
    }

    ts.forEachChild(n, gez);
  };

  gez(sf);

  // ── İP-A4: ekranda yaşayan pencere durumu ──
  //
  // Önce dosyadaki `useState` bağları toplanır, sonra bir PENCERE bileşenine
  // pencere özniteliği olarak verilenler işaretlenir. İki geçiş gerekir:
  // durum bildirimi JSX'ten sonra da gelebilir (yardımcı bileşenler).
  // ── İP-A5: bağlar AD ile değil, BİLDİRİM YERİ ile ayırt edilir ──
  //
  // Eski sürüm dosya başına bir `Set<ad>` tutuyordu. Aynı dosyadaki İKİ AYRI
  // bileşenin aynı adlı iki bağı (`AdminStore.tsx`te üç ayrı `deleting`)
  // TEK bağ sayılıyordu — oysa metriğin yazılı sözleşmesi "bağ başına bir
  // kez"dir. Sonuç: metrik dosya sınırına duyarlıydı; 2216 satırlık bir
  // dosyayı bölmek (İP-A5'in yaptığı, davranışı değiştirmeyen mekanik iş)
  // sayıyı 33'ten 35'e ÇIKARIYORDU. Ölçüm aleti, ölçtüğü şeyin dosyalara
  // nasıl dağıldığına bağlı olamaz.
  //
  // Çözüm: her `useState` bağı, ADIYLA BİRLİKTE onu kapsayan en yakın
  // fonksiyon düğümüyle kaydedilir; kullanım yerinde ad, ataları arasındaki
  // EN İÇTEKİ eşleşen kapsama çözülür (sözlüksel kapsam yaklaşımı).
  const durumBaglari = [];
  const kapsayanFonksiyon = (n) => {
    for (let a = n.parent; a; a = a.parent) {
      if (
        ts.isFunctionDeclaration(a) ||
        ts.isArrowFunction(a) ||
        ts.isFunctionExpression(a) ||
        ts.isMethodDeclaration(a)
      ) {
        return a;
      }
    }
    return sf;
  };
  const durumTopla = (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      n.initializer &&
      ts.isCallExpression(n.initializer) &&
      /(^|\.)useState$/.test(n.initializer.expression.getText(sf).replace(/<.*/s, "")) &&
      ts.isArrayBindingPattern(n.name) &&
      n.name.elements.length > 0 &&
      ts.isBindingElement(n.name.elements[0])
    ) {
      durumBaglari.push({
        ad: n.name.elements[0].name.getText(sf),
        kapsam: kapsayanFonksiyon(n),
      });
    }
    ts.forEachChild(n, durumTopla);
  };
  durumTopla(sf);

  /** Kullanım yerindeki adı, en içteki eşleşen bildirime çözer. */
  const bagiCozumle = (kullanim, ad) => {
    for (let a = kullanim; a; a = a.parent) {
      const bulunan = durumBaglari.find((b) => b.ad === ad && b.kapsam === a);
      if (bulunan) return bulunan;
    }
    return null;
  };

  // ── İP-A6b · Görev 4: PROP OLARAK İNEN pencere durumu (BULGU-3) ──
  //
  // İP-A5 bağ çözümünü dosya ölçekli ad eşleşmesinden sözlüksel kapsama
  // çevirdi ve bu DOĞRUYDU (aynı dosyadaki üç ayrı `deleting` bağı tek
  // sayılıyordu). Ama yeni bir kör nokta açtı: durum ebeveynde yaşayıp aynı
  // dosyadaki çocuk bileşene **prop olarak** inerse hiç sayılmıyordu —
  // denetimin M-C mutasyonu tam olarak buydu ve `modalDurumu` 29'da kaldı.
  //
  // Çözüm ne A4'e dönmek (aynı adlı iki bağı tek sayardı) ne bugünkü hâl:
  // önce dosyadaki YEREL bileşenlerin hangi PROP'unun bir pencereye durum
  // olarak aktığı çıkarılır, sonra o prop'a verilen `useState` bağı sayılır.
  //
  // Çıkarım bir SABİT NOKTA (fixpoint) hesabıdır; böylece zincir uzunluğu
  // sınırlı değildir: `Ust → Cocuk → Torun → XDialog` da çözülür. Her tur bir
  // sıçrama daha ekler ve yeni bilgi üretilmeyince durur.
  //
  // Sınır (dürüstçe): yalnız YIKILARAK alınan proplar (`function C({ acik })`)
  // izlenir; `props.acik` biçimi ve başka DOSYADAN import edilen bir bileşene
  // inen durum görünmez. İkincisi bilinçlidir — metrik "ekranda yaşayan
  // durum"u ölçer ve dosya sınırını aşan bir çıkarım, ölçümü yeniden dosyaların
  // nasıl bölündüğüne duyarlı yapardı (İP-A5'in düzelttiği kusur).
  const yerelBilesenler = new Map();
  const bilesenTopla = (n) => {
    let ad = null;
    let govde = null;
    if (ts.isFunctionDeclaration(n) && n.name && /^[A-Z]/.test(n.name.getText(sf))) {
      ad = n.name.getText(sf);
      govde = n;
    } else if (
      ts.isVariableDeclaration(n) &&
      n.name &&
      ts.isIdentifier(n.name) &&
      /^[A-Z]/.test(n.name.getText(sf)) &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
    ) {
      ad = n.name.getText(sf);
      govde = n.initializer;
    }
    if (ad && govde) {
      // Yıkılan prop'lar: yerel ad → prop adı (`{ acik: gorunur }` de çözülür).
      const yerelDenProp = new Map();
      const ilkParam = govde.parameters && govde.parameters[0];
      if (ilkParam && ts.isObjectBindingPattern(ilkParam.name)) {
        for (const el of ilkParam.name.elements) {
          if (!ts.isBindingElement(el) || !ts.isIdentifier(el.name)) continue;
          const yerel = el.name.getText(sf);
          yerelDenProp.set(yerel, el.propertyName ? el.propertyName.getText(sf) : yerel);
        }
      }
      yerelBilesenler.set(ad, { govde, yerelDenProp });
    }
    ts.forEachChild(n, bilesenTopla);
  };
  bilesenTopla(sf);

  /** Yerel bileşen → pencereye durum olarak akan prop adları. */
  const pencereProplari = new Map();
  const propEkle = (ad, prop) => {
    if (!pencereProplari.has(ad)) pencereProplari.set(ad, new Set());
    if (pencereProplari.get(ad).has(prop)) return false;
    pencereProplari.get(ad).add(prop);
    return true;
  };

  /** Bir JSX özniteliği pencere durumu mu taşıyor? (doğrudan ya da devredilmiş) */
  const pencereOzniteligiMi = (etiket, ozAdi) =>
    (PENCERE_BILESENI.test(etiket) && PENCERE_OZNITELIKLERI.has(ozAdi)) ||
    (pencereProplari.has(etiket) && pencereProplari.get(etiket).has(ozAdi));

  const ifadeTanimlayicilari = (ifade) => {
    const out = [];
    const gezIfade = (m) => {
      if (ts.isIdentifier(m)) out.push(m.getText(sf));
      ts.forEachChild(m, gezIfade);
    };
    gezIfade(ifade);
    return out;
  };

  let degisti = true;
  while (degisti) {
    degisti = false;
    for (const [ad, bilesen] of yerelBilesenler) {
      if (bilesen.yerelDenProp.size === 0) continue;
      const gezJsx = (n) => {
        if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
          const etiket = n.tagName.getText(sf);
          for (const p of n.attributes.properties) {
            if (!ts.isJsxAttribute(p)) continue;
            const ozAdi = p.name.getText(sf);
            if (!pencereOzniteligiMi(etiket, ozAdi)) continue;
            const ifade = p.initializer;
            if (!ifade || !ts.isJsxExpression(ifade) || !ifade.expression) continue;
            for (const t of ifadeTanimlayicilari(ifade.expression)) {
              const prop = bilesen.yerelDenProp.get(t);
              if (prop && propEkle(ad, prop)) degisti = true;
            }
          }
        }
        ts.forEachChild(n, gezJsx);
      };
      gezJsx(bilesen.govde);
    }
  }

  // Bağ → bağlandığı PENCERE bileşenlerinin adları (Set). Kategori ayrımı
  // (kayıt düzenleme / gezinme çekmecesi) bu kümenin TEK bir bileşene mi
  // indiğine bakar (bkz. `GEZINME_CEKMECELERI`nin yanındaki not).
  const modalBagEtiketleri = new Map();
  const modalAra = (n) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const etiket = n.tagName.getText(sf);
      for (const p of n.attributes.properties) {
        if (!ts.isJsxAttribute(p)) continue;
        const ad = p.name.getText(sf);
        // `open` gibi genel bir öznitelik yalnız PENCERE bileşeninde sayılır;
        // yerel bir bileşende ise ancak o prop'un pencereye AKTIĞI çıkarıldıysa
        // (İP-A6b · Görev 4 · sabit nokta hesabı).
        if (!pencereOzniteligiMi(etiket, ad)) continue;
        const ifade = p.initializer;
        if (!ifade || !ts.isJsxExpression(ifade) || !ifade.expression) continue;
        // İfadenin İÇİNDEKİ tüm tanımlayıcılara bakılır: `open={!!acik}`,
        // `open={acik !== null}` da sayılmalı.
        const tanimlayicilar = [];
        const gezIfade = (m) => {
          if (ts.isIdentifier(m)) tanimlayicilar.push(m.getText(sf));
          ts.forEachChild(m, gezIfade);
        };
        gezIfade(ifade.expression);
        for (const t of tanimlayicilar) {
          const bag = bagiCozumle(n, t);
          if (!bag) continue;
          if (!modalBagEtiketleri.has(bag)) modalBagEtiketleri.set(bag, new Set());
          modalBagEtiketleri.get(bag).add(etiket);
        }
      }
    }
    ts.forEachChild(n, modalAra);
  };
  modalAra(sf);

  // ── İ9 · Boşluk 1 kapanışı: KAYIT DÜZENLEME vs GEZİNME ÇEKMECESİ ──
  //
  // Varsayılan kova KAYIT DÜZENLEME'dir (katı, sıfır toleranslı). Bir bağ
  // ancak `GEZINME_CEKMECELERI`nde dosya+ad eşleşen bir kayıt varsa VE o
  // bağın bağlandığı bileşen kümesi TAM OLARAK o kaydın `bilesen`inden
  // ibaretse (başka hiçbir pencereye de akmıyorsa) gezinme çekmecesi
  // kovasına düşer. Aksi hâlde — dosya farklı, ad farklı, ya da bağ aynı
  // zamanda başka bir pencereye de akıyorsa — KAYIT DÜZENLEME kovasında
  // kalır. Gerekçe ve üç kaçamama senaryosu sabitin yanındaki yorumda.
  const kayitBaglari = [];
  const gezinmeBaglari = [];
  for (const [bag, etiketler] of modalBagEtiketleri) {
    const izinli = GEZINME_CEKMECELERI.find((g) => g.dosya === dosyaAdi && g.ad === bag.ad);
    if (izinli && etiketler.size === 1 && etiketler.has(izinli.bilesen)) {
      gezinmeBaglari.push(bag);
    } else {
      kayitBaglari.push(bag);
    }
  }
  // Çıktı hâlâ ADLARDIR (mevcut nöbetçiler ada bakıyor), ama artık BAĞ
  // sayısı kadar eleman taşır: aynı adlı iki ayrı bağ iki kez listelenir.
  o.modalDurumAdlari = kayitBaglari.map((b) => b.ad).sort();
  o.gezinmeCekmecesiAdlari = gezinmeBaglari.map((b) => b.ad).sort();

  return o;
}

export function sayim() {
  const { olculen: base, eksik, fazla } = tabanDurumu();
  let rawButton = 0;
  let labels = 0;
  let labelsWithHtmlFor = 0;

  const overlayOffenders = [];
  let unlabeledOverlays = 0;

  let kontrolToplam = 0;
  let adsizKontrol = 0;
  let olcumDisiKontrol = 0;
  const adsizKontrolDosyalari = [];
  let modalDurumu = 0;
  const modalDurumDosyalari = [];
  let gezinmeCekmecesiDurumu = 0;
  const gezinmeCekmecesiDosyalari = [];

  for (const f of base) {
    const o = dosyaOlcumu(read(f), f);
    rawButton += o.rawButton;
    labels += o.labels;
    labelsWithHtmlFor += o.labelsWithHtmlFor;

    kontrolToplam += o.kontrolToplam;
    adsizKontrol += o.adsizKontrol;
    if (o.modalDurumAdlari.length > 0) {
      modalDurumu += o.modalDurumAdlari.length;
      modalDurumDosyalari.push({ dosya: f, adlar: o.modalDurumAdlari });
    }
    if (o.gezinmeCekmecesiAdlari.length > 0) {
      gezinmeCekmecesiDurumu += o.gezinmeCekmecesiAdlari.length;
      gezinmeCekmecesiDosyalari.push({ dosya: f, adlar: o.gezinmeCekmecesiAdlari });
    }
    olcumDisiKontrol += o.olcumDisiKontrol;
    if (o.adsizKontrol > 0) {
      adsizKontrolDosyalari.push({
        dosya: f,
        sayi: o.adsizKontrol,
        satirlar: o.adsizKontrolSatirlari,
      });
    }

    if (PRINT_LAYERS.includes(f) || !o.overlays) continue;
    // Bir overlay'in "etiketli" sayılması için HEM role="dialog" HEM
    // aria-modal gerekir; ikisinin küçüğü kadarı etiketli kabul edilir.
    const labeled = Math.min(o.dialogRoles, o.ariaModals);
    const missing = Math.max(0, o.overlays - labeled);
    if (missing > 0) {
      unlabeledOverlays += missing;
      overlayOffenders.push(f);
    }
  }

  // `ui2/` dışında `@medusajs/ui` import eden dosyalar (tüm kaynak ağacı).
  // Ön eleme yalnız hız içindir: metinde adı hiç geçmeyen dosya parse edilmez.
  const medusaDirectImports = allSource().filter((f) => {
    if (f.includes("/admin/ui2/")) return false;
    const s = read(f);
    return s.includes(MEDUSA) && dosyaOlcumu(s, f).medusaImport;
  });

  adsizKontrolDosyalari.sort((a, b) => b.sayi - a.sayi || a.dosya.localeCompare(b.dosya));

  return {
    files: base.length,
    // Ölçüm tabanının KENDİSİ (İP-A3c · P1-2/P1-4): nöbetçi bunu isimle
    // sabitlenmiş listeyle karşılaştırır. Eski taban kontrolü
    // (`kontrolToplam >= 140`) göçün TANIMI GEREĞİ kırılacaktı — sayaç ham
    // `input`/`select`/`textarea` etiketlerini sayıyor ve göç onları
    // sarmalayıcılara çeviriyor. `AdminStore.tsx` tek başına göç etse taban
    // 140'ın altına iner ve CI **ilerleme yüzünden** kırmızıya dönerdi.
    dosyalar: base,
    // ── İP-A6 · Görev 1: ölçüm kaçışının iki yönü ──
    //
    // `eksikDosyalar`: listede yazılı ama diskte YOK. Bir ekran ölçüm ağacının
    // dışına taşınırsa (İP-A5'in ölçtüğü kaçış) borç sessizce ölçümden düşmez,
    // burada isimle görünür ve nöbetçi kırılır.
    //
    // `fazlaDosyalar`: diskte var ama listede YOK. Yeni bir panel dosyası
    // ölçüme girmeden doğamaz.
    eksikDosyalar: eksik,
    fazlaDosyalar: fazla,
    rawButton,
    // `labels` / `labelsWithHtmlFor` artık EŞİK DEĞİL, TEŞHİS sayısıdır
    // (İP-A3a: oran metriği kaldırıldı — gerekçesi `docs/ip-a3a-rapor.md`).
    // Sayaç bunları zaten `htmlFor`↔`id` eşleştirmesi için üretiyor.
    labels,
    labelsWithHtmlFor,
    // İP-A3a nöbetçi metriği: erişilebilir adı olmayan form kontrolü.
    kontrolToplam,
    adsizKontrol,
    olcumDisiKontrol,
    adsizKontrolDosyalari,
    // İP-A4 nöbetçi metriği: ekranda yaşayan KAYIT DÜZENLEME pencere durumu
    // (katı kova — gezinme çekmecesi hariç, bkz. `GEZINME_CEKMECELERI`).
    modalDurumu,
    modalDurumDosyalari,
    // İ9 · Boşluk 1 kapanışı: ayrı kategori — bilinen gezinme çekmeceleri.
    // Tavan değil KİMLİK: listeye yeni bir çekmece elle eklenmeden büyümez
    // (`GEZINME_CEKMECELERI`nin uzunluğuyla aynı olması beklenir).
    gezinmeCekmecesiDurumu,
    gezinmeCekmecesiDosyalari,
    medusaDirectImports,
    unlabeledOverlays,
    overlayOffenders: overlayOffenders.sort(),
  };
}

if (process.argv[1] && process.argv[1].endsWith("ui-baseline-sayim.mjs")) {
  console.log(JSON.stringify(sayim(), null, 2));
}
