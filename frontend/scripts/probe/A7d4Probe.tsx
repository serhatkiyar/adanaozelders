/**
 * İP-A7d4 · Görev 5 — göç dalgası 4'ün gerçek tarayıcı sondası.
 *
 * jsdom'da ölçülemeyen şeyler burada ölçülür:
 *
 *   1. Mobil düzen (380 px) — yatay taşma, dokunma hedefi, iç içe düğme.
 *   2. Odak tuzağı — gerçek `Tab`/`Shift+Tab`, ESC ve odak iadesi.
 *   3. **SK-9'un gerçek tarayıcı kanıtı** — rol penceresinde yazıp ESC'e
 *      basınca "Kaydedilmemiş değişiklikler var" çıkıyor mu.
 *   4. Gönderim sonrası odağın ilk hatalı alana taşınması + hata kontrastı.
 *   5. Koyu temada yerel widget şeması (`color-scheme`) — bu dalganın tek
 *      yeni yerel widget'ı `ClosedDays`in `type="date"` kutusudur.
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
import { ClosedDays } from "@/components/admin/delivery/ClosedDays";
import AdminAccessPage from "@/pages/admin/AdminAccessPage";
import AdminOperationsPage from "@/pages/admin/AdminOperationsPage";
import AdminSettingsPage from "@/pages/admin/AdminSettingsPage";
import DeliveryBoardPage from "@/pages/admin/delivery/DeliveryBoardPage";
import DeliveryTodayPage from "@/pages/admin/delivery/DeliveryTodayPage";
import { useAuthStore } from "@/store/authStore";
import "@/index.css";

import type { AxiosRequestConfig } from "axios";

/* ══════════ Sahte veri — dış bağlantı YOK, kişisel veri YOK ══════════ */

const IZINLER = [
  { id: 1, code: "orders.view", name: "Siparişleri görüntüle", group: "Sipariş" },
  { id: 2, code: "orders.manage", name: "Siparişleri yönet", group: "Sipariş" },
  { id: 3, code: "delivery.view", name: "Dağıtımı görüntüle", group: "Dağıtım" },
  { id: 4, code: "delivery.manage", name: "Dağıtımı yönet", group: "Dağıtım" },
  { id: 5, code: "settings.manage", name: "Ayarları yönet", group: "Platform" },
  { id: 6, code: "reports.view", name: "Şikâyetleri görüntüle", group: "Moderasyon" },
];

const ROLLER = [
  {
    id: 7,
    code: "ICERIK_EDITORU",
    name: "Sonda içerik editörü",
    description: "Sonda kaydı — gerçek rol değildir.",
    is_system: false,
    permission_codes: ["orders.view"],
    assignment_count: 2,
  },
  {
    id: 1,
    code: "SUPER_ADMIN",
    name: "Sonda süper yönetici",
    description: null,
    is_system: true,
    permission_codes: IZINLER.map((i) => i.code),
    assignment_count: 1,
  },
];

const ATAMALAR = [
  { admin_id: 3, admin_name: "Sonda Yönetici", admin_email: "sonda@ornek.test", role_id: 7 },
];

const KAPALI_GUNLER = [
  { id: 5, day: "2027-08-30", label: "Sonda tatili", source: "holiday" },
  { id: 6, day: "2027-09-15", label: null, source: "manual" },
];

const BAYRAKLAR = [
  {
    key: "store_checkout",
    label: "Sonda mağaza ödemesi",
    enabled: true,
    enforced: true,
    default: true,
    description: "Sonda kaydı — gerçek bayrak değildir.",
    note: null,
    updated_at: null,
    locked_reason: null,
  },
];

const OLU_ISLER = [
  {
    id: 42,
    kind: "order.delivered.sms",
    attempts: 5,
    last_error: "Sonda sağlayıcısı 503 döndü",
    updated_at: "2027-03-03T09:00:00Z",
  },
];

const ARACLAR = [
  { id: 7, code: "LADA", label: "Sonda Lada", max_stops: 3, is_active: true, sort_order: 0 },
  { id: 9, code: "COROLLA", label: "Sonda Corolla", max_stops: 10, is_active: true, sort_order: 1 },
];

const HAVUZ = [
  { order_id: 101, address: "Seyhan / Sonda Sok.", lat: 36.99, lng: 35.32 },
  { order_id: 102, address: "Çukurova / Sonda Sok.", lat: 37.0, lng: 35.33 },
];

const TAHTA = {
  unassigned: HAVUZ,
  runs: [
    {
      id: 55,
      vehicle_id: 7,
      status: "PLANNED",
      stops: [{ id: 1, order_id: 201, sequence: 1, address: "Yüreğir / Sonda Sok." }],
    },
  ],
};

const ISTISNA_KUYRUGU = [
  {
    order_id: 909,
    address: "Seyhan / Sonda Sok.",
    attempts: 3,
    last_failure_reason: "Adreste bulunamadı",
  },
];

apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
  const url = String(config.url);
  const govde = (): unknown => {
    if (url.includes("/admin/access/permissions")) return IZINLER;
    if (url.includes("/admin/access/roles")) return ROLLER;
    if (url.includes("/admin/access/assignments")) return ATAMALAR;
    if (url.includes("/delivery/calendar")) return KAPALI_GUNLER;
    if (url.includes("/admin/feature-flags")) return BAYRAKLAR;
    if (url.includes("/admin/outbox/failed")) return OLU_ISLER;
    if (url.includes("/admin/escrow")) return [];
    if (url.includes("/delivery/attention-orders")) return ISTISNA_KUYRUGU;
    if (url.includes("/delivery/vehicles")) return ARACLAR;
    if (url.includes("/delivery/board")) return TAHTA;
    if (url.includes("/delivery/eligible-orders")) return HAVUZ;
    if (url.includes("/delivery/runs")) return TAHTA.runs;
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
const ekran = params.get("ekran") ?? "yetki";

useAuthStore.setState({
  token: "sonda",
  isAuthenticated: true,
  // Panel izinleri KOD KOD aranır ("*" joker değildir).
  user: {
    id: 1,
    role_id: 1,
    email: "sonda@ornek.test",
    full_name: "Sonda Kullanıcı",
    email_verified: true,
    admin_permissions: [
      "admin_roles.view",
      "admin_roles.manage",
      "delivery.view",
      "delivery.manage",
      "settings.view",
      "settings.manage",
      "operations.view",
      "operations.manage",
    ],
  } as never,
});

if (params.get("koyu") === "1") document.documentElement.classList.add("dark");

const qc = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
});

const EKRANLAR: Record<string, JSX.Element> = {
  yetki: <AdminAccessPage />,
  takvim: <ClosedDays />,
  ayarlar: <AdminSettingsPage />,
  operasyon: <AdminOperationsPage />,
  bugun: <DeliveryTodayPage />,
  tahta: <DeliveryBoardPage />,
};

const secili = EKRANLAR[ekran] ?? EKRANLAR.yetki;

function Uygulama() {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/sonda"]}>
        <div className="min-h-screen bg-slate-50 p-4 dark:bg-slate-950">
          <Routes>
            <Route path="/sonda" element={secili} />
          </Routes>
        </div>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Uygulama />);
