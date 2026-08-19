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
import { beforeEach, describe, expect, it } from "vitest";
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
  "src/components/LibraryEditorModal.tsx": { tur: "props", gerekce: "zorunlu kayit (duzenlenen kutuphane)" },
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
  "src/components/admin/store/BulkImportPanel.tsx",
  "src/components/admin/store/CategoriesPanel.tsx",
  "src/components/admin/store/CouponsPanel.tsx",
  "src/components/admin/store/OrdersPanel.tsx",
  "src/components/admin/store/ProductForm.tsx",
  "src/components/admin/store/ProductsPanel.tsx",
  "src/components/admin/store/ReturnsPanel.tsx",
  "src/components/admin/ui2/form.tsx",
  "src/pages/dashboards/AdminStore.tsx",
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
  "src/components/ImageCropModal.tsx": 1, // yakınlaştırma kaydırağı (type=range)
  "src/components/LibraryPayoutForm.tsx": 5, // IBAN/unvan/TCKN… beşi de placeholder ile
  "src/components/MapPicker.tsx": 1, // adres arama kutusu
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

  it("KAPI_DISI gerekçeleri doğrudur: park edilen ekran gerçekten mount edilemiyor", async () => {
    // Ters prova. Bu olmadan `KAPI_DISI` bir kaçış kapısı olurdu: mount
    // edilebilen bir ekranı listeye yazmak kapıyı sessizce daraltırdı.
    const yanlisPark: string[] = [];
    for (const [dosya, kayit] of Object.entries(KAPI_DISI)) {
      const C = await ekranBileseni(dosya);
      if (kayit.tur === "bilesen-yok") {
        if (C) yanlisPark.push(`${dosya}: bilesen VAR, "bilesen-yok" yazilmis`);
        continue;
      }
      if (!C) {
        yanlisPark.push(`${dosya}: bilesen yok, "props" yazilmis`);
        continue;
      }
      try {
        kontrolOlcumu(kosum(C));
        yanlisPark.push(`${dosya}: propsuz MOUNT EDILEBILIYOR (${kayit.gerekce})`);
      } catch {
        /* beklenen: propsuz mount edilemiyor */
      }
    }
    expect(yanlisPark).toEqual([]);
  }, 60000);
});

describe("İP-A6b çalışma zamanı kapısı · adsız kontrol", () => {
  it("kapsanan her ekran mount edilir; adsız kontrol tabanı KİMLİKLE sabittir", async () => {
    const adsiz: Record<string, number> = {};
    const ornekler: string[] = [];
    const mountEdilemeyen: string[] = [];
    let toplamKontrol = 0;

    for (const dosya of kapsanan) {
      const C = await ekranBileseni(dosya);
      if (!C) {
        mountEdilemeyen.push(`${dosya}: render edilebilir bilesen yok`);
        continue;
      }
      try {
        const o = kontrolOlcumu(kosum(C));
        toplamKontrol += o.toplam;
        if (o.adsiz > 0) {
          adsiz[dosya] = o.adsiz;
          for (const html of o.adsizHtml) ornekler.push(`${dosya}\n  ${html}`);
        }
      } catch (e) {
        mountEdilemeyen.push(`${dosya}: ${(e as Error).message.split("\n")[0]}`);
      }
    }

    // (a) Kapsam gerçekten koştu mu? Sessiz daralma burada da yakalanır:
    //     mount edilemeyen dosya varsa gerekçesiyle KAPI_DISI'na yazılmalıdır.
    expect(
      mountEdilemeyen,
      `kapida mount edilemedi:\n${mountEdilemeyen.join("\n")}`
    ).toEqual([]);
    // (b) Yalancı yeşil kapısı: hiçbir kontrol render edilmediyse "0 adsız"
    //     bir şey kanıtlamaz. Bugün ölçülen taban 39 kontroldür.
    expect(
      toplamKontrol,
      "hic kontrol render edilmedi — kapi bosa kosuyor"
    ).toBeGreaterThanOrEqual(39);
    // (c) Asıl kural: taban KİMLİKLE sabit — yeni borç da, sessiz düşüş de kırar.
    expect(adsiz, `varsayilan render'da adsiz kontrol:\n${ornekler.join("\n")}`).toEqual(
      CALISMA_ZAMANI_ADSIZ
    );
  }, 120000);
});
