/**
 * İP-A7d3 · Görev 6 — göç eden ON ekranın gerçek tarayıcı sondası.
 *
 * jsdom'da ölçülemeyen şeyler burada ölçülür:
 *
 *   1. Mobil düzen (380 px) — yatay taşma, dokunma hedefi, okunabilirlik.
 *   2. Odak tuzağı — gerçek `Tab`/`Shift+Tab`, ESC ve odak iadesi.
 *   3. Gönderim sonrası odağın ilk hatalı alana taşınması (gerçek klavye).
 *   4. Hata kırmızısının kontrastı.
 *   5. **Koyu temada yerel widget şeması** (`color-scheme`) — A6c'nin SK-6
 *      düzeltmesi ortak `.input` sınıfına yazılmıştı; bu dalga o sınıfı
 *      KULLANMAYAN iki `type="time"` kutusu buldu (`OperatorLibrary`) ve
 *      düzeltti. Sonda, düzeltmenin gerçekten uygulandığını ölçer.
 *
 * **Canlı `ceyhandb`ye BAĞLANILMAZ.** Sayfa axios adapter'ını kendi sahte
 * sunucusuyla değiştirir; veriler uydurmadır ve gerçek kişisel veri içermez.
 *
 * Ekran `?ekran=…` ile seçilir; tema `?koyu=1` ile açılır.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { apiClient } from "@/api/axios";
import { LibraryPayoutForm } from "@/components/LibraryPayoutForm";
import AdminReportsPage from "@/pages/admin/AdminReportsPage";
import CountSessionDetailPage from "@/pages/admin/inventory/CountSessionDetailPage";
import CountSessionsPage from "@/pages/admin/inventory/CountSessionsPage";
import DeliveryRunDetailPage from "@/pages/admin/delivery/DeliveryRunDetailPage";
import AdminHome from "@/pages/dashboards/AdminHome";
import OperatorHome from "@/pages/dashboards/OperatorHome";
import OperatorLibrary from "@/pages/dashboards/OperatorLibrary";
import OperatorSessions from "@/pages/dashboards/OperatorSessions";
import PackingStationPage from "@/pages/admin/packing/PackingStationPage";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import "@/index.css";

import type { AxiosRequestConfig } from "axios";

/* ══════════ Sahte veri — dış bağlantı YOK, kişisel veri YOK ══════════ */

const SAYIM_SATIRI = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  product_id: 100 + id,
  product_name: `Sonda Kitabı ${id}`,
  product_sku: `SND-00000${id}`,
  bucket: id % 2 === 0 ? "DAMAGED" : "SALEABLE",
  status: "COUNTED",
  system_qty_snapshot: 8,
  reserved_qty_snapshot: id % 2 === 0 ? null : 2,
  counted_qty: 6,
  difference: -2,
  counted_at: "2027-03-03T10:00:00+00:00",
  counted_by_admin_id: 1,
  stale_reason: null,
  resolved_by_admin_id: null,
  resolved_at: null,
  resolution_note: null,
  note: null,
  applied_movement_id: null,
  ...over,
});

const SAYIM_OTURUMU = (over: Record<string, unknown> = {}) => ({
  id: 7,
  code: "SAY-2027-0007",
  status: "IN_PROGRESS",
  scope: "MANUAL",
  category_id: null,
  note: "Sonda oturumu — gerçek sayım değildir.",
  created_by_admin_id: 1,
  created_at: "2027-03-03T09:00:00+00:00",
  started_at: "2027-03-03T09:05:00+00:00",
  submitted_at: null,
  reviewed_by_admin_id: null,
  reviewed_at: null,
  applied_by_admin_id: null,
  applied_at: null,
  cancelled_by_admin_id: null,
  cancelled_at: null,
  cancel_reason: null,
  line_count: 3,
  uncounted_line_count: 0,
  has_stale: true,
  ...over,
});

const SAYIM_DETAYI = {
  ...SAYIM_OTURUMU(),
  lines: [SAYIM_SATIRI(1), SAYIM_SATIRI(2), SAYIM_SATIRI(3, { status: "STALE", stale_reason: "STOCK_MOVED" })],
};

const SIKAYETLER = Array.from({ length: 3 }, (_, i) => ({
  id: 12 + i,
  target_type: ["REVIEW", "MESSAGE", "BOOKING_COMMENT"][i],
  target_id: 88 + i,
  reason: ["HARASSMENT", "SPAM", "CONTACT_INFO"][i],
  description: "Sonda kaydı — gerçek şikâyet değildir.",
  status: "OPEN",
  reporter_role: 3,
  reporter_id: 45,
  created_at: "2027-03-01T10:00:00Z",
}));

const DURAK = (id: number, sequence: number) => ({
  id,
  run_id: 3,
  order_id: 500 + id,
  sequence,
  status: "PENDING",
  qr_payload: `${id}:sonda`,
  recipient: `Sonda Alıcı ${id}`,
  phone: "0500 000 00 00",
  address: `Sonda Sokak ${id}, Çukurova / Adana`,
  lat: 36.98 + id / 200,
  lng: 35.32 + id / 200,
  items: [{ title: "Sonda Kitabı", quantity: 1 }],
  order_total: "150.00",
  delivery_pref: null,
  delivery_pref_note: null,
  eta: null,
  detour_km: null,
  is_outlier: false,
  otp_sent_at: null,
  delivered_at: null,
  proof: null,
  photo_url: null,
  courier_note: null,
  promised_delivery_date: null,
});

const TUR = {
  id: 3,
  run_date: "2027-03-03",
  vehicle_id: 9,
  vehicle: "Sonda Aracı",
  status: "PLANNED",
  notes: null,
  started_at: null,
  completed_at: null,
  created_at: "2027-03-03T06:00:00Z",
  depot_lat: 36.98,
  depot_lng: 35.32,
  optimized_at: null,
  optimize_provider: null,
  total_distance_km: null,
  total_duration_seconds: null,
  route_geometry: null,
  courier: null,
  stops: [DURAK(11, 1), DURAK(12, 2), DURAK(13, 3)],
};

const PAKET = {
  id: 77,
  code: "PKT-000077",
  order_id: 501,
  status: "OPEN",
  qr_payload: "PKG1:77:sonda",
  created_at: "2027-03-01T08:00:00Z",
  packed_at: null,
  handed_over_at: null,
  returned_at: null,
  delivered_at: null,
  void_at: null,
  unpacked_at: null,
  items: [
    {
      order_item_id: 1,
      title: "Sonda Kitabı 1",
      sku: "SND-000001",
      expected_qty: 2,
      scanned_qty: 1,
      remaining: 1,
    },
  ],
};

const KUTUPHANE = {
  id: 12,
  name: "Sonda Kütüphanesi",
  slug: "sonda-kutuphanesi",
  status: "ACTIVE",
  amenities: ["wifi", "sessiz_alan"],
  rating_count: 4,
  rating_average: 4.5,
  hours: [],
  images: [],
  city: "Adana",
  district: "Çukurova",
  neighborhood: "Toros",
  street: "Sonda Caddesi",
  building_no: "5",
  capacity: 40,
  study_hourly_price: "50.00",
  location_lat: 36.9855,
  location_lng: 35.3253,
  location_text: "Toros, Sonda Caddesi No:5, Çukurova / Adana",
  cover_url: null,
  logo_url: null,
  phone: "0322 000 00 00",
  email: "sonda@ornek.test",
  website: null,
  description: "Sonda kaydı.",
  rejection_reason: null,
};

const OPERATOR = {
  id: 77,
  email: "sonda-operator@ornek.test",
  full_name: "Sonda Operatör",
  library_id: 12,
  is_active: true,
  created_at: "2027-01-01T00:00:00Z",
  library_name: "Sonda Kütüphanesi",
};

const EGITMENLER = [
  {
    id: 41,
    email: "sonda-aday@ornek.test",
    first_name: "Sonda",
    last_name: "Aday",
    full_name: "Sonda Aday",
    username: "sondaaday",
    headline: "Sonda ilanı — gerçek eğitmen değildir.",
    hourly_rate: "400.00",
    status: "PENDING_APPROVAL",
    avatar_url: null,
  },
];

apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
  const url = String(config.url);
  const govde = (): unknown => {
    if (/count-sessions\/\d+$/.test(url)) return SAYIM_DETAYI;
    if (url.includes("count-sessions")) return { items: [SAYIM_OTURUMU()], total: 1 };
    if (url.includes("/admin/reports")) return SIKAYETLER;
    if (/\/delivery\/runs\/\d+$/.test(url)) return TUR;
    if (url.includes("/delivery/eligible")) return [];
    if (url.includes("/delivery/runs")) return [TUR];
    if (url.includes("/packing/packages/")) return PAKET;
    if (url.includes("/library-operators/me")) return OPERATOR;
    if (url.includes("/libraries/admin/")) return KUTUPHANE;
    if (url.includes("/earnings")) {
      return {
        currency: "TRY",
        released_earning: "900.00",
        held_earning: "180.00",
        commission_total: "100.00",
        released_count: 10,
        held_count: 2,
        this_month_earning: "450.00",
        refunded_total: "0.00",
      };
    }
    if (url.includes("/payout")) return { payout_status: "PENDING", iban_masked: null };
    if (url.includes("/admin/tutors")) return EGITMENLER;
    if (url.includes("/payments/availability")) {
      return {
        branches: [
          { branch: "store", label: "Mağaza", open: true },
          { branch: "tutor_marketplace", label: "Ders pazaryeri", open: true },
          { branch: "library_marketplace", label: "Kütüphane pazaryeri", open: true },
        ],
      };
    }
    if (url.includes("/auth/me")) {
      return { id: 1, role_id: 1, email: "sonda@ornek.test", email_verified: true };
    }
    return [];
  };
  const data = govde();
  return {
    data,
    status: 200,
    statusText: "OK",
    headers: { "x-total-count": String(Array.isArray(data) ? data.length : 1) },
    config,
  } as never;
};

/* ══════════ Kabuk ══════════ */

const params = new URLSearchParams(location.search);
const ekran = params.get("ekran") ?? "sayim-detayi";
const operatorMu = ekran.startsWith("operator");

useAuthStore.setState({
  token: "sonda",
  isAuthenticated: true,
  // Panel izinleri KOD KOD aranır ("*" joker değildir).
  user: {
    id: operatorMu ? 77 : 1,
    role_id: operatorMu ? 4 : 1,
    email: "sonda@ornek.test",
    full_name: "Sonda Kullanıcı",
    email_verified: true,
    admin_permissions: [
      "inventory.view",
      "inventory.count",
      "inventory.apply",
      "reports.view",
      "reports.manage",
      "delivery.view",
      "delivery.manage",
      "packing.view",
      "packing.pack",
      "packing.manage",
      "tutors.view",
      "tutors.manage",
      "users.view",
      "users.manage",
    ],
  } as never,
});

if (params.get("koyu") === "1") document.documentElement.classList.add("dark");

const qc = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
});

const EKRANLAR: Record<string, { yol: string; desen: string; eleman: JSX.Element }> = {
  "sayim-detayi": {
    yol: ROUTES.adminInventoryCount(7),
    desen: ROUTES.adminInventoryCount(":id"),
    eleman: <CountSessionDetailPage />,
  },
  "sayim-listesi": {
    yol: ROUTES.adminInventoryCounts,
    desen: ROUTES.adminInventoryCounts,
    eleman: <CountSessionsPage />,
  },
  "tur-detayi": {
    yol: ROUTES.adminDeliveryRun(3),
    desen: ROUTES.adminDeliveryRun(":id"),
    eleman: <DeliveryRunDetailPage />,
  },
  sikayetler: { yol: "/sonda", desen: "/sonda", eleman: <AdminReportsPage /> },
  istasyon: {
    yol: "/yonetim/paketleme/paket/77",
    desen: "/yonetim/paketleme/paket/:id",
    eleman: <PackingStationPage />,
  },
  odeme: { yol: "/sonda", desen: "/sonda", eleman: <LibraryPayoutForm libraryId={12} /> },
  "admin-home": {
    yol: "/sonda",
    desen: "/sonda",
    eleman: <AdminHome section="listings" />,
  },
  "operator-kutuphanem": { yol: "/sonda", desen: "/sonda", eleman: <OperatorLibrary /> },
  "operator-panel": { yol: "/sonda", desen: "/sonda", eleman: <OperatorHome /> },
  "operator-oturumlar": { yol: "/sonda", desen: "/sonda", eleman: <OperatorSessions /> },
};

const secili = EKRANLAR[ekran] ?? EKRANLAR["sayim-detayi"];

function Uygulama() {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[secili.yol]}>
        <div className="min-h-screen bg-slate-50 p-4 dark:bg-slate-950">
          <Routes>
            <Route path={secili.desen} element={secili.eleman} />
          </Routes>
        </div>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Uygulama />);
