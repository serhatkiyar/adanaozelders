/**
 * Mağaza merge doğrulaması · Görev 1-2 — marka logosu taşıyan üç yüzeyin
 * gerçek tarayıcı sondası.
 *
 * Neden gerekli: merge turu `logo.png` → `logo.svg` geçişini yaptı ve iki
 * varlığın en/boy oranı AYNI DEĞİL (PNG 6.36, SVG 7.16 — aynı yükseklikte SVG
 * ~%13 daha geniş). Merge raporu "taşma görmedim" dedi; bu göz kararıdır.
 * Burada ölçülen şey px'tir: logo genişliği, kapsayıcı genişliği, kök
 * `scrollWidth > clientWidth` ve logo ⟂ kategori şeridi kesişimi.
 *
 * Ölçülen üç yüzey (gerçek kompozisyonlarında, tek tek bileşen olarak DEĞİL):
 *   • anasayfa → `PublicNavbar` (logo-compact.svg <md · logo.svg ≥md) + `SiteFooter`
 *   • magaza   → `StoreLayout` header (magaza-logo.svg) + `StoreCategoryBar` + `SiteFooter`
 *   • magaza-oturum → aynısı, ama token'lı: `SiteFooter`in kendi auth okuması
 *     (`useAuthStore` + `useCurrentUser`) mağaza bağlamında koşar.
 *
 * **Canlı veritabanına BAĞLANILMAZ.** Sayfa axios adapter'ını kendi sahte
 * sunucusuyla değiştirir; veriler uydurmadır ve gerçek kişisel veri içermez.
 *
 * Ekran `?ekran=…`, tema `?koyu=1` ile seçilir.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { apiClient } from "@/api/axios";
import Landing from "@/pages/Landing";
import { StoreLayout } from "@/pages/store/StoreLayout";
import { useAuthStore } from "@/store/authStore";
import "@/index.css";

import type { AxiosRequestConfig } from "axios";

/* ══════════ Sahte veri — dış bağlantı YOK, kişisel veri YOK ══════════ */

const KATEGORILER = [
  { id: 1, name: "Sonda Kitap", slug: "sonda-kitap", parent_id: null, sort_order: 0 },
  { id: 2, name: "Sonda Kırtasiye", slug: "sonda-kirtasiye", parent_id: null, sort_order: 1 },
  { id: 3, name: "Sonda Teknoloji", slug: "sonda-teknoloji", parent_id: null, sort_order: 2 },
  { id: 4, name: "Sonda Yayınları", slug: "sonda-yayinlari", parent_id: 1, sort_order: 0 },
  { id: 5, name: "Sonda Defter", slug: "sonda-defter", parent_id: 2, sort_order: 0 },
];

apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
  const url = String(config.url);
  const govde = (): unknown => {
    if (url.includes("/store/categories")) return KATEGORILER;
    if (url.includes("/auth/me")) {
      return {
        id: 3,
        role_id: 3,
        email: "sonda@ornek.test",
        full_name: "Sonda Öğrenci",
        email_verified: true,
      };
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
const ekran = params.get("ekran") ?? "anasayfa";

// `anasayfa` BİLEREK oturumsuzdur: Landing oturum açıkken `DashboardHeader`a
// geçer ve ölçmek istediğimiz `PublicNavbar` hiç render edilmez.
if (ekran === "magaza-oturum") {
  useAuthStore.setState({ token: "sonda", isAuthenticated: true, user: null } as never);
} else {
  useAuthStore.setState({ token: null, isAuthenticated: false, user: null } as never);
}

if (params.get("koyu") === "1") document.documentElement.classList.add("dark");

const qc = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
});

function MagazaEkrani() {
  return (
    <StoreLayout title="Sonda">
      <div className="mx-auto max-w-[1464px] px-4 py-10 md:px-8">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Sonda içeriği — ölçüm için yer tutucu.
        </p>
      </div>
    </StoreLayout>
  );
}

const EKRANLAR: Record<string, JSX.Element> = {
  anasayfa: <Landing />,
  magaza: <MagazaEkrani />,
  "magaza-oturum": <MagazaEkrani />,
};

const secili = EKRANLAR[ekran] ?? EKRANLAR.anasayfa;

function Uygulama() {
  return (
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/sonda"]}>
          <Routes>
            <Route path="/sonda" element={secili} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Uygulama />);
