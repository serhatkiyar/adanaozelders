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

import { createElement } from "react";

import { apiClient } from "@/api/axios";
import { useAuthStore } from "@/store/authStore";
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
  "src/components/ImageCropModal.tsx",
  "src/components/LibraryBookmarkButton.tsx",
  "src/components/LibraryMediaManager.tsx",
  "src/components/LibraryPayoutForm.tsx",
  "src/components/MapPicker.tsx",
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
  "src/components/admin/layout/AdminLayout.tsx",
  "src/components/admin/layout/AdminPageHeader.tsx",
  "src/components/admin/layout/AdminSidebar.tsx",
  "src/components/admin/store/BulkImportPanel.tsx",
  "src/components/admin/store/CategoriesPanel.tsx",
  "src/components/admin/store/CouponsPanel.tsx",
  "src/components/admin/store/OrdersPanel.tsx",
  "src/components/admin/store/ProductForm.tsx",
  "src/components/admin/store/ProductsPanel.tsx",
  "src/components/admin/store/ReturnsPanel.tsx",
  "src/components/admin/ui/Badge.tsx",
  "src/components/admin/ui/Button.tsx",
  "src/components/admin/ui/ConfirmDialog.tsx",
  "src/components/admin/ui/Dialog.tsx",
  "src/components/admin/ui/PageState.tsx",
  "src/components/admin/ui2/gezinmeBekcisi.tsx",
  "src/components/admin/ui2/medusa-tr.tsx",
  "src/pages/DeliveryDriver.tsx",
  "src/pages/DeliveryRunHandover.tsx",
  "src/pages/admin/AdminAccessPage.tsx",
  "src/pages/admin/AdminAuditLogsPage.tsx",
  "src/pages/admin/AdminBookingsPage.tsx",
  "src/pages/admin/AdminDashboardPage.tsx",
  "src/pages/admin/AdminDemandsPage.tsx",
  "src/pages/admin/AdminOperationsPage.tsx",
  "src/pages/admin/AdminPayoutsPage.tsx",
  "src/pages/admin/AdminReportsPage.tsx",
  "src/pages/admin/AdminSectionPage.tsx",
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
];

const moduller = import.meta.glob("/src/**/*.tsx");

// ── Parçalanmış kapının sayaçları (İP-A7d4 · Görev 3) ──
//
// Ekran başına ayrı test yazmak, birleşik testin sağladığı iki şeyi kaybetme
// riski taşır: (a) "hepsi gerçekten koştu mu", (b) "toplamda bir şey render
// edildi mi". İkisi de bu sayaçlarla dosyanın SONUNDAKİ nöbetçilere taşınır.
const olculenEkranlar = new Set<string>();
const olculenKapiDisi = new Set<string>();
let toplamKontrol = 0;

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
function kosum(C: ComponentType): ReactElement {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{createElement(C)}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  // Ağ yok: her uç boş veri döner. Ekranlar boş/yükleniyor durumunda render
  // edilir — ölçülen şey "veri geldi mi" değil, "render edilen alanın adı var mı".
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) =>
    ({ data: [], status: 200, statusText: "OK", headers: {}, config }) as never;
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: ["*"] } as never,
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
  it.each(kapsanan)("%s — adsız kontrol tabanı KİMLİKLE sabit", async (dosya) => {
    const C = await ekranBileseni(dosya);
    expect(C, `${dosya}: render edilebilir bilesen yok`).not.toBeNull();
    const o = kontrolOlcumu(kosum(C!));
    olculenEkranlar.add(dosya);
    toplamKontrol += o.toplam;
    // Beklenen borç: listede yazılıysa o sayı, yoksa SIFIR. İki yön de kırar —
    // yeni borç da, listedeki bir borcun sessizce kapanması da.
    expect(
      o.adsiz,
      `${dosya} — varsayilan render'da adsiz kontrol: ${o.adsizHtml.join(" | ")}`
    ).toBe(CALISMA_ZAMANI_ADSIZ[dosya] ?? 0);
  });

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

    // Yalancı yeşil kapısı: hiçbir kontrol render edilmediyse "0 adsız" bir
    // şey kanıtlamaz. Bugün ölçülen taban 39 kontroldür.
    expect(toplamKontrol, "hic kontrol render edilmedi — kapi bosa kosuyor").toBeGreaterThanOrEqual(
      39
    );
  });
});
