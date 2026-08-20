/**
 * İP-A7d2 · Görev 6 — göç eden ALTI ekranın gerçek tarayıcı sondası.
 *
 * jsdom'da ölçülemeyen şeyler burada ölçülür:
 *
 *   1. Mobil kart düzeni (380 px) — taşma, dokunma hedefi, kart içinde
 *      aksiyon + satır tıklaması bir arada (`PackagesPage` — SK-1'in ve
 *      SK-5'in ilk GERÇEK ekranı).
 *   2. Odak tuzağı — gerçek `Tab`/`Shift+Tab`, ESC ve odak iadesi.
 *   3. Gönderim sonrası odağın ilk hatalı alana taşınması (gerçek klavye).
 *   4. Hata kırmızısının kontrastı.
 *   5. Sayı ve tarih girdilerinin koyu temadaki `color-scheme` değeri —
 *      A6c'nin düzeltmesi ilk kez sayısal ağırlıklı GERÇEK ekranlarda.
 *
 * **Canlı `ceyhandb`ye BAĞLANILMAZ.** Sayfa axios adapter'ını kendi sahte
 * sunucusuyla değiştirir; veriler uydurma ve kişisel veri içermez.
 *
 * Ekran `?ekran=…` ile seçilir; tema `?koyu=1` ile açılır.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { apiClient } from "@/api/axios";
import { CourierManager } from "@/components/admin/CourierManager";
import { ExamSessionsManager } from "@/components/ExamSessionsManager";
import AdminExamCatalogs from "@/pages/dashboards/AdminExamCatalogs";
import AdminPayoutsPage from "@/pages/admin/AdminPayoutsPage";
import DeliveryVehiclesPage from "@/pages/admin/delivery/DeliveryVehiclesPage";
import PackagesPage from "@/pages/admin/packing/PackagesPage";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import "@/index.css";

import type { AxiosRequestConfig } from "axios";

/* ── Sahte sunucu — uydurma veri, dış bağlantı YOK ── */

const OTURUMLAR = Array.from({ length: 3 }, (_, i) => ({
  id: i + 1,
  library_id: 12,
  catalog_id: null,
  catalog_name: null,
  is_nationwide: i === 0,
  exam_type: ["TYT", "AYT", "LGS"][i],
  title: `Sonda Denemesi ${i + 1}`,
  description: "Sonda kaydı — gerçek oturum değildir.",
  starts_at: "2027-03-15T07:00:00Z",
  duration_minutes: 180,
  capacity: 50,
  price: "150.00",
  status: "SCHEDULED",
  registered_count: 3,
  results_published: false,
  results_entered_count: 0,
}));

const KATALOGLAR = Array.from({ length: 3 }, (_, i) => ({
  id: i + 1,
  exam_name: `Sonda Ortak Deneme ${i + 1}`,
  exam_type: ["TYT", "AYT", "YKS"][i],
  publisher_name: "Sonda Yayınları",
  description: "Sonda kaydı.",
  question_count: 120,
  duration_minutes: 165,
  is_public: true,
  is_nationwide: i === 0,
  session_count: 4,
  answer_key_url: null,
}));

const BAKIYELER = Array.from({ length: 3 }, (_, i) => ({
  payee_type: i % 2 === 0 ? "TUTOR" : "LIBRARY",
  payee_id: 10 + i,
  name: ["Sonda Eğitmen", "Sonda Kütüphane", "Sonda Eğitmen 2"][i],
  iban: i === 1 ? null : "TR120006200000000000000001",
  earned: "1200.00",
  paid: "200.00",
  balance: "1000.00",
  pending: "150.00",
}));

const PAKETLER = Array.from({ length: 3 }, (_, i) => ({
  id: i + 1,
  code: `PKT-00000${i + 1}`,
  order_id: 500 + i,
  status: ["PACKED", "RETURNED", "VOID"][i],
  qr_payload: "PKG1:1:sonda",
  created_at: "2027-03-01T08:00:00Z",
  packed_at: "2027-03-01T09:00:00Z",
  handed_over_at: null,
  returned_at: "2027-03-02T09:00:00Z",
  delivered_at: null,
  void_at: null,
  unpacked_at: null,
  items: [],
}));

const KURYELER = Array.from({ length: 3 }, (_, i) => ({
  id: i + 1,
  name: ["Sonda Kurye", "Sonda Kurye 2", "Sonda Kurye 3"][i],
  phone: "0500 000 00 00",
  photo_url: null,
  is_active: i !== 2,
}));

const ARACLAR = Array.from({ length: 2 }, (_, i) => ({
  id: i + 1,
  code: ["DOBLO", "KANGOO"][i],
  label: ["Doblo", "Kangoo"][i],
  plate: "01 ABC 123",
  max_stops: 40,
  shift_start: "09:00:00",
  shift_end: "18:00:00",
  fixed_cost: 250,
  sort_order: i,
  is_active: true,
}));

const NOKTALAR = [
  {
    id: 1,
    name: "Sonda Başlangıç",
    kind: "BASE",
    address: "Sonda caddesi",
    lat: 36.9855,
    lng: 35.3253,
    sort_order: 0,
    is_active: true,
  },
];

apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
  const url = String(config.url);
  const govde = (): unknown => {
    if (url.includes("/exam-catalogs")) return KATALOGLAR;
    if (url.includes("/exam-sessions")) return OTURUMLAR;
    if (url.includes("/payouts/pending")) return BAKIYELER;
    if (url.includes("/payouts")) return [];
    if (url.includes("/packing/packages")) return { items: PAKETLER, total: PAKETLER.length };
    if (url.includes("/delivery/couriers")) return KURYELER;
    if (url.includes("/delivery/vehicles")) return ARACLAR;
    if (url.includes("/delivery/pickup-points")) return NOKTALAR;
    return [];
  };
  const data = govde();
  return {
    data,
    status: 200,
    statusText: "OK",
    headers: { "x-total-count": String(Array.isArray(data) ? data.length : 0) },
    config,
  } as never;
};

useAuthStore.setState({
  token: "sonda",
  isAuthenticated: true,
  // Panel izinleri KOD KOD aranır ("*" joker değildir).
  user: {
    id: 1,
    role_id: 1,
    admin_permissions: [
      "catalogs.view",
      "catalogs.manage",
      "payments.view",
      "payments.manage",
      "packing.view",
      "packing.manage",
      "delivery.view",
      "delivery.manage",
    ],
  } as never,
});

/* ── Kabuk ── */

const params = new URLSearchParams(location.search);
const ekran = params.get("ekran") ?? "oturumlar";
if (params.get("koyu") === "1") document.documentElement.classList.add("dark");

const qc = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
});

const EKRANLAR: Record<string, { yol: string; eleman: JSX.Element }> = {
  oturumlar: { yol: "/sonda", eleman: <ExamSessionsManager libraryId={12} /> },
  kataloglar: { yol: "/sonda", eleman: <AdminExamCatalogs /> },
  hakedis: { yol: ROUTES.adminPayouts, eleman: <AdminPayoutsPage /> },
  paketler: { yol: "/yonetim/paketleme/paketler", eleman: <PackagesPage /> },
  kuryeler: { yol: "/sonda", eleman: <CourierManager /> },
  araclar: { yol: "/sonda", eleman: <DeliveryVehiclesPage /> },
};

const secili = EKRANLAR[ekran] ?? EKRANLAR.oturumlar;

function Uygulama() {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[secili.yol]}>
        <div className="min-h-screen bg-slate-50 p-4 dark:bg-slate-950">
          <Routes>
            <Route path={secili.yol} element={secili.eleman} />
            <Route path="/yonetim/paketleme/paket/:id" element={<p>PAKET DETAYI</p>} />
          </Routes>
        </div>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Uygulama />);
