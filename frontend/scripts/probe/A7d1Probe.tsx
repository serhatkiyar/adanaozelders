/**
 * İP-A7d1 · Görev 5 — göç eden üç ekranın GERÇEK tarayıcı sondası.
 *
 * jsdom'da ölçülemeyen beş şey burada ölçülür:
 *
 *   1. Mobil kart düzeni (380 px) — taşma, okunabilirlik ve Görev 1'in
 *      kararının gerçekte nasıl göründüğü (kart tıklanabilir, içindeki
 *      aksiyon düğmesi kendi işini görüyor).
 *   2. Odak tuzağı — gerçek `Tab`/`Shift+Tab`, ESC ve odak iadesi.
 *   3. Gönderim sonrası odağın ilk hatalı alana taşınması (gerçek klavye).
 *   4. Hata kırmızısının kontrastı (A6c 4,70 → 6,29 yapmıştı; doğrulanır).
 *   5. Sayı girdisinin koyu temadaki `color-scheme` değeri (A6c ekledi).
 *
 * **Canlı `ceyhandb`ye BAĞLANILMAZ.** Sayfa axios adapter'ını kendi sahte
 * sunucusuyla değiştirir; veriler uydurma ve kişisel veri içermez.
 *
 * Ekran `?ekran=a|b|c` ile seçilir; tema `?koyu=1` ile açılır.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { apiClient } from "@/api/axios";
import AdminAuditLogsPage from "@/pages/admin/AdminAuditLogsPage";
import AdminBookingsPage from "@/pages/admin/AdminBookingsPage";
import {
  LibraryEditorModal,
  emptyEditor,
  type EditorState,
} from "@/components/LibraryEditorModal";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { DataTable } from "@/components/admin/data-table";
import { Button } from "@/components/admin/ui";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import "@/index.css";

import type { AxiosRequestConfig } from "axios";

/* ── Sahte sunucu — uydurma veri, dış bağlantı YOK ── */

const REZERVASYONLAR = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1,
  tutor_id: 100 + i,
  client_id: 200 + i,
  tutor_name: ["Deniz Aksoy", "Ece Tanrıöver", "Mert Karaağaç"][i % 3],
  client_name: ["Sonda Öğrenci", "Örnek Kullanıcı", "Deneme Hesabı"][i % 3],
  start_at: `2027-03-0${(i % 8) + 1}T11:00:00+00:00`,
  end_at: `2027-03-0${(i % 8) + 1}T12:30:00+00:00`,
  price: 350 + i * 25,
  status: ["PENDING", "ACCEPTED", "COMPLETED"][i % 3],
  is_disputed: i % 4 === 0,
  admin_notes: i % 4 === 0 ? "Öğrenci ders içeriğinden şikâyetçi." : null,
  cancel_reason: null,
  created_at: "2027-02-20T09:00:00+00:00",
}));

const DENETIM = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1,
  action: ["BOOKING_CANCEL", "LIBRARY_APPROVE", "USER_SUSPEND"][i % 3],
  target_type: ["booking", "library", "user"][i % 3],
  target_id: 10 + i,
  actor_id: 1,
  actor_role: 1,
  reason: "Sonda kaydı — gerçek gerekçe değildir.",
  details: null,
  ip_address: "10.0.0.1",
  request_id: `req-sonda-${i}`,
  before_values: { status: "ACCEPTED" },
  after_values: { status: "CANCELLED" },
  meta: null,
  created_at: "2027-03-03T11:00:00+00:00",
}));

apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
  const url = String(config.url);
  const dizi = url.includes("audit-logs")
    ? DENETIM
    : url.includes("/admin/bookings")
      ? REZERVASYONLAR
      : [];
  return {
    data: dizi,
    status: 200,
    statusText: "OK",
    headers: { "x-total-count": String(dizi.length) },
    config,
  } as never;
};

useAuthStore.setState({
  token: "sonda",
  isAuthenticated: true,
  // Panel izinleri KOD KOD aranir ("*" joker degildir); sonda gercek
  // kodlari verir, yoksa satir aksiyonlari hic render edilmez.
  user: {
    id: 1,
    role_id: 1,
    admin_permissions: ["bookings.manage", "libraries.manage", "audit.view"],
  } as never,
});

/* ── Ekran (a) koşumu: editör yüzeyi açık başlar ── */

function EditorSondasi() {
  const yuzey = useDuzenlemeYuzeyi<EditorState, void>();
  useEffect(() => {
    const t: EditorState = { ...emptyEditor(), name: "Sonda Kütüphanesi" };
    t.hours = (t.hours ?? []).map((h) =>
      h.weekday === 0 ? { ...h, is_closed: false, open_minute: 540, close_minute: 1320 } : h
    );
    yuzey.ac(t);
    // Yalnız ilk render'da açılır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <LibraryEditorModal yuzey={yuzey} />;
}

/* ── Ekran (d): satır tıklaması VE satır aksiyonu BİR ARADA ── */

/**
 * Görev 1'in kararı, gerçek tarayıcıda ve 380 px'te.
 *
 * Göç eden üç ekranın hiçbiri ikisini AYNI ANDA istemiyor ((b) aksiyon
 * istiyor, (c) tıklama); bu yüzden ortak katmanın kararı burada, sentetik
 * ama GERÇEK `DataTable` ile ölçülür. Ölçülen: kart içinde iç içe düğme yok,
 * aksiyona basmak satırı açmıyor, kartın boşluğuna basmak açıyor.
 */
function CakismaSondasi() {
  const veri = Array.from({ length: 3 }, (_, i) => ({
    id: i + 1,
    ad: ["Deniz Aksoy", "Ece Tanrıöver", "Mert Karaağaç"][i],
    not: "Uzun bir açıklama satırı — mobil kartta taşma olup olmadığı da ölçülür.",
  }));
  return (
    <div data-sonda="cakisma">
      <p data-sonda="gunluk" className="mb-2 text-sm text-slate-700 dark:text-slate-200" />
      <DataTable
        columns={[
          { accessorKey: "ad", header: "Ad", enableSorting: false },
          {
            id: "islem",
            header: "İşlem",
            enableSorting: false,
            cell: ({ row }) => (
              <Button size="sm" variant="danger" onClick={() => yaz(`aksiyon:${row.original.id}`)}>
                Sil
              </Button>
            ),
          },
        ]}
        data={veri}
        getRowId={(k) => String(k.id)}
        emptyTitle="Kayıt yok"
        onRowClick={(k) => yaz(`satir:${k.id}`)}
        renderMobileRow={(k) => (
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">{k.ad}</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{k.not}</p>
            <Button
              className="mt-3"
              size="sm"
              variant="danger"
              onClick={() => yaz(`aksiyon:${k.id}`)}
            >
              Sil
            </Button>
          </div>
        )}
        page={1}
        pageSize={25}
        total={veri.length}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
      />
    </div>
  );
}

/** Sondanın okuyabilmesi için son olayı DOM'a yazar. */
function yaz(olay: string) {
  const p = document.querySelector('[data-sonda="gunluk"]');
  if (p) p.textContent = `${p.textContent ?? ""}${olay} `.trim() + " ";
}

/* ── Kabuk ── */

const params = new URLSearchParams(location.search);
const ekran = params.get("ekran") ?? "b";
if (params.get("koyu") === "1") document.documentElement.classList.add("dark");

const qc = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
});

const yol =
  ekran === "c"
    ? ROUTES.adminAuditLogs
    : ekran === "b"
      ? ROUTES.adminBookings
      : ekran === "d"
        ? "/cakisma"
        : "/sonda";

function Uygulama() {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[yol]}>
        <div className="min-h-screen bg-slate-50 p-4 dark:bg-slate-950">
          <Routes>
            <Route path={ROUTES.adminBookings} element={<AdminBookingsPage />} />
            <Route path={ROUTES.adminAuditLogs} element={<AdminAuditLogsPage />} />
            <Route path="/sonda" element={<EditorSondasi />} />
            <Route path="/cakisma" element={<CakismaSondasi />} />
          </Routes>
        </div>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Uygulama />);
