// F30 kuyruk satırı — eylemi SUNUCU söyler (`next_action`), ekran çıkarmaz.
//
// ## Bu dosya neden sonradan eklendi
//
// Commit 6 kabul matrisi (`packingScreens.acceptance.test.tsx`) `next_action`
// alanı henüz YOKKEN yazılmıştı; alan bu dilimde arka uç P2'si olarak geldi.
// Mutasyon provası boşluğu açıkça gösterdi: `SatirAksiyonu`'nun ilk dalı
// `row.next_action === "OPEN_NEW_PACKAGE" && canPack` yerine yalnız `canPack`
// yapıldığında **hiçbir test kırılmadı**. Yani ekran her satıra "Paketlemeye
// başla" demeye başlasa suite yeşil kalıyordu.
//
// Kaçan davranışın bedeli soyut değil: `RETURNED` bir paketin satırında "yeni
// paket aç" göstermek, operatörü aynı siparişin ürünlerini **ikinci kez raftan
// toplamaya** gönderir (sözleşme §3.6 çıkmazı). Uç idempotent olduğu için
// sunucu ikinci kutuyu üretmez — ama insan rafa gitmiş, kutu açılmış ve ekran
// yanlış işi vaat etmiş olur.
//
// Testler gerçek bileşeni render eder, gerçek tıklama yapar ve **gerçekten
// giden axios isteğini** gözler; "buton görünüyor mu" tek başına yeterli kanıt
// sayılmaz.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import PackingQueuePage from "@/pages/admin/packing/PackingQueuePage";
import { useAuthStore } from "@/store/authStore";

import type { AxiosRequestConfig } from "axios";

/* ══════════════ Sahte sunucu (kabul matrisiyle aynı desen) ══════════════ */

interface Istek {
  method: string;
  url: string;
}

let istekler: Istek[] = [];
let kuyrukYaniti: unknown = { items: [], total: 0 };
let eskiAdapter: unknown;

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  istekler = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const url = String(config.url);
    istekler.push({ method: (config.method ?? "get").toLowerCase(), url });
    const data = url.includes("/packing/queue")
      ? kuyrukYaniti
      : // Yeniden paketleme/açma yanıtı: içeriği bu dosyanın iddialarına
        // girmiyor, yalnız mutasyonun isteği ATIP atmadığı ölçülüyor.
        { id: 77, code: "PKT-000077", order_id: 501, status: "PACKED" };
    return { data, status: 200, statusText: "OK", headers: {}, config } as never;
  };
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
});

function izinVer(...kodlar: string[]) {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: kodlar } as never,
  });
}

const SATIR = (over: Record<string, unknown>) => ({
  order_id: 501,
  recipient: "Ayşe Yılmaz",
  address: "Seyhan, Adana",
  item_count: 2,
  items: [{ title: "Palme TYT Matematik", quantity: 2 }],
  promised_delivery_date: "2026-08-03",
  created_at: "2026-08-01T09:00:00Z",
  prepared_at: null,
  package: null,
  next_action: null,
  ...over,
});

async function sar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const sonuc = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/yonetim/paketleme"]}>
        <Routes>
          <Route path="/yonetim/paketleme" element={<PackingQueuePage />} />
          <Route path="/yonetim/paketleme/paket/:id" element={<p>İSTASYON</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText(/Ayşe Yılmaz/);
  return sonuc;
}

/** Kuyruğun yeni paket açma isteği gerçekten gitti mi? */
const acmaIstegi = () =>
  istekler.filter((i) => i.method === "post" && /\/packing\/orders\/\d+\/open$/.test(i.url));

describe("kuyruk satırı sunucunun söylediği eylemi uygular", () => {
  it("OPEN_NEW_PACKAGE: 'Paketlemeye başla' gerçekten open ucuna POST eder", async () => {
    izinVer("packing.view", "packing.pack");
    kuyrukYaniti = {
      items: [SATIR({ next_action: "OPEN_NEW_PACKAGE" })],
      total: 1,
      limit: 50,
      offset: 0,
    };
    await sar();

    fireEvent.click(screen.getByRole("button", { name: /paketlemeye başla/i }));
    await waitFor(() => expect(acmaIstegi()).toHaveLength(1));
    expect(acmaIstegi()[0].url).toContain("/packing/orders/501/open");
  });

  it("REPACK_RETURNED: yeni paket açma SUNULMAZ, yeniden paketleme sunulur", async () => {
    // Depoya dönmüş kutu zaten var. "Yeni paket aç" demek, aynı ürünleri
    // ikinci kez raftan toplatmaktır.
    izinVer("packing.view", "packing.pack", "packing.manage");
    kuyrukYaniti = {
      items: [
        SATIR({
          next_action: "REPACK_RETURNED",
          package: { id: 77, code: "PKT-000077", status: "RETURNED" },
        }),
      ],
      total: 1,
      limit: 50,
      offset: 0,
    };
    await sar();

    expect(screen.queryByRole("button", { name: /paketlemeye başla/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /yeniden paketle/i }));

    await waitFor(() =>
      expect(istekler.some((i) => i.url.includes("/packing/packages/77/repack"))).toBe(true),
    );
    expect(acmaIstegi()).toHaveLength(0);
  });

  it("CONTINUE_PACKING: yarım paket AÇILMAZ, mevcut pakete gidilir", async () => {
    izinVer("packing.view", "packing.pack");
    kuyrukYaniti = {
      items: [
        SATIR({
          next_action: "CONTINUE_PACKING",
          package: { id: 77, code: "PKT-000077", status: "OPEN" },
        }),
      ],
      total: 1,
      limit: 50,
      offset: 0,
    };
    await sar();

    expect(screen.queryByRole("button", { name: /paketlemeye başla/i })).toBeNull();
    const bag = screen.getByRole("link", { name: /paketlemeye devam et/i });
    expect(bag.getAttribute("href")).toBe("/yonetim/paketleme/paket/77");

    fireEvent.click(bag);
    await screen.findByText("İSTASYON");
    expect(acmaIstegi()).toHaveLength(0);
  });

  it("bilinmeyen next_action FAIL-CLOSED: hiçbir yazma eylemi sunulmaz", async () => {
    // Backend yarın yeni bir eylem eklerse ekran onu uydurmamalı. Paket varsa
    // yalnız okuma bağlantısı kalır.
    izinVer("packing.view", "packing.pack", "packing.manage");
    kuyrukYaniti = {
      items: [
        SATIR({
          next_action: "YARIN_EKLENEN_EYLEM",
          package: { id: 77, code: "PKT-000077", status: "PACKED" },
        }),
      ],
      total: 1,
      limit: 50,
      offset: 0,
    };
    await sar();

    expect(screen.queryAllByRole("button", { name: /paketlemeye başla|yeniden paketle/i })).toHaveLength(0);
    expect(screen.getByRole("link", { name: /paketi gör/i })).toBeTruthy();
    expect(istekler.filter((i) => i.method === "post")).toHaveLength(0);
  });

  it("next_action null ve paket yoksa satır SALT OKUNUR kalır", async () => {
    izinVer("packing.view", "packing.pack", "packing.manage");
    kuyrukYaniti = { items: [SATIR({})], total: 1, limit: 50, offset: 0 };
    await sar();

    // Satır görünür (operatör işi görmeli) ama tek bir yazma düğmesi yok.
    expect(screen.getByText(/Ayşe Yılmaz/)).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: /paketlemeye başla|yeniden paketle/i })).toHaveLength(0);
    expect(istekler.filter((i) => i.method === "post")).toHaveLength(0);
  });
});
