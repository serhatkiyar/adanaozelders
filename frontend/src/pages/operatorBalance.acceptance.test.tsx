// İP-14 kırmızı matris — Bakiyem (operatör kolu): hata dürüstlüğü, kesilme
// dürüstlüğü ve ödeme metninin doğruluğu. GERÇEK DOM + gerçek axios.
//
// Neden ayrı dosya: burada ölçülen şey liste düzeni değil, **para ekranının
// söylediği cümle**. Üç yalan aynı ekranda toplanmıştı:
//
//   1. Sunucu hatası "Henüz bir işlem yok" diye görünüyordu — kullanıcı bunu
//      "hiç ödeme almamışım" diye okur (node E-1).
//   2. Liste 200 satırda SESSİZCE kesiliyordu; "eski bir işlem kayboldu"
//      şikâyetinde ekran hiçbir şey söylemiyordu (node K-1/K-2).
//   3. Ekran "tutarlar iyzico üzerinden doğrudan IBAN'ına geçer" diyordu;
//      kurulu mekanizma ise ADMIN'in tuttuğu **elle havale defteri**
//      (`backend/api/routers/payouts.py`: "Ödeme banka üzerinden ELLE
//      yapılır; burada yalnız defter tutulur") — node Y-6.
//
// Kanıt sınıfı: gerçek DOM + gerçek HTTP isteği. `EarningTransaction`
// fixture'ı `backend/schemas/payment.py` alan adlarıyla birebirdir.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "@/api/axios";
import { useAuthStore } from "@/store/authStore";

import type { AxiosRequestConfig } from "axios";
import type { ComponentType } from "react";

/* ══════════════ Sahte sunucu ══════════════ */

interface Istek {
  method: string;
  url: string;
}
type Yanit = { status?: number; data: unknown };

let rotalar: { esles: (i: Istek) => boolean; yanit: Yanit }[] = [];
let eskiAdapter: unknown;

function sunucu(desen: string | RegExp, yanit: Yanit, method?: string) {
  rotalar.unshift({
    esles: (i) => {
      const yol = i.url.split("?")[0];
      return (
        (method ? i.method === method.toLowerCase() : true) &&
        (typeof desen === "string" ? yol.includes(desen) : desen.test(yol))
      );
    },
    yanit,
  });
}

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  rotalar = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const istek: Istek = {
      method: (config.method ?? "get").toLowerCase(),
      url: String(config.url),
    };
    const rota = rotalar.find((r) => r.esles(istek));
    const ham = rota?.yanit ?? { data: {} };
    const status = ham.status ?? 200;
    if (status >= 400) {
      const hata = new Error(`istek başarısız: ${status}`) as Error & {
        isAxiosError: boolean;
        response: unknown;
        config: unknown;
      };
      hata.isAxiosError = true;
      hata.response = { status, data: ham.data, headers: {}, config };
      hata.config = config;
      throw hata;
    }
    return { data: ham.data, status, statusText: "OK", headers: {}, config } as never;
  };
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
  vi.restoreAllMocks();
});

/* ══════════════ Oturum + render ══════════════ */

const OPERATOR_ID = 77;
const LIBRARY_ID = 12;

function operatorOturumu() {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: OPERATOR_ID, role_id: 4, email: "op@k.example.com", full_name: "Operatör Test", email_verified: true } as never,
  });
}

const EKRAN = import.meta.glob(["./Balance.tsx"]);

async function sar() {
  const yukle = EKRAN["./Balance.tsx"];
  if (!yukle) throw new Error("HENÜZ YAZILMADI: src/pages/Balance.tsx");
  const Bilesen = ((await yukle()) as { default: ComponentType }).default;
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/bakiyem"]}>
        <Routes>
          <Route path="*" element={<Bilesen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/* ══════════════ Fixture'lar ══════════════ */

/** `schemas/payment.py::EarningTransaction` */
const ISLEM = (i: number) => ({
  id: i,
  source: "EXAM",
  title: `Ağustos TYT Denemesi #${i}`,
  counterparty: `Öğrenci ${i}`,
  gross: "100.00",
  commission: "10.00",
  net: "90.00",
  status: "RELEASED",
  currency: "TRY",
  occurred_at: "2026-08-01T10:00:00Z",
  created_at: "2026-08-01T10:00:00Z",
});

function temelUclar(islemler: Yanit) {
  sunucu("/auth/me", { data: { id: OPERATOR_ID, role_id: 4, email: "op@k.example.com", full_name: "Operatör Test", email_verified: true } });
  sunucu("/library-operators/me", {
    data: { id: OPERATOR_ID, email: "op@k.example.com", full_name: "Operatör Test", library_id: LIBRARY_ID, is_active: true, created_at: "2026-01-01T00:00:00Z", library_name: "Test Kütüphanesi" },
  });
  sunucu("/libraries/12/earnings/transactions", islemler);
  sunucu("/libraries/12/earnings", {
    data: {
      currency: "TRY",
      released_earning: "900.00",
      held_earning: "180.00",
      commission_total: "100.00",
      released_count: 10,
      held_count: 2,
      this_month_earning: "450.00",
      refunded_total: "0.00",
    },
  });
  sunucu("/libraries/admin/12/payout", { data: { payout_status: "ACTIVE", iban_masked: "TR** **** 1234" } });
  sunucu("/messages/unread-count", { data: { inbox: 0, sent: 0 } });
  sunucu("/notifications/unread-count", { data: { count: 0 } });
}

/* ════════════════════════════════════════════════════════════════════════════ */

describe("E-1 · Bakiyem hatası 'işlem yok' diye okunmuyor", () => {
  it("işlem dökümü sorgusu patlarsa ErrorState görünür", async () => {
    operatorOturumu();
    temelUclar({ status: 500, data: { detail: "patladı" } });

    await sar();

    const uyari = await screen.findByTestId("islem-hata");
    expect(uyari).toHaveAttribute("role", "alert");
    expect(screen.queryByText(/Henüz bir işlem yok/i)).not.toBeInTheDocument();
  });

  it("E-5 · boş liste ile hata FARKLI metin gösterir", async () => {
    operatorOturumu();
    temelUclar({ data: [] });
    const bos = await sar();
    const bosMetin = (await screen.findByTestId("islem-bos")).textContent ?? "";
    bos.unmount();

    rotalar = [];
    temelUclar({ status: 500, data: { detail: "patladı" } });
    await sar();
    const hataMetin = (await screen.findByTestId("islem-hata")).textContent ?? "";

    expect(bosMetin.trim()).not.toBe("");
    expect(hataMetin.trim()).not.toBe("");
    expect(hataMetin).not.toBe(bosMetin);
  });
});

describe("K · 200 satır tavanı görünür", () => {
  it("K-1 · liste tavana dayanınca 'son 200 işlem' uyarısı görünür", async () => {
    operatorOturumu();
    temelUclar({ data: Array.from({ length: 200 }, (_, i) => ISLEM(i + 1)) });

    await sar();

    const uyari = await screen.findByTestId("islem-tavan-uyarisi");
    expect(uyari).toHaveTextContent(/200/);
  });

  it("K-2 · tavana dayanmayan listede uyarı YOK", async () => {
    operatorOturumu();
    temelUclar({ data: Array.from({ length: 199 }, (_, i) => ISLEM(i + 1)) });

    await sar();

    await screen.findByText(/İşlem Dökümü/i);
    expect(screen.queryByTestId("islem-tavan-uyarisi")).not.toBeInTheDocument();
  });
});

describe("Y-6 · ödeme metni gerçeği söylüyor", () => {
  it("hakedişin elle havaleyle ödendiği yazar; 'iyzico doğrudan IBAN'ına geçer' vaadi YOKTUR", async () => {
    operatorOturumu();
    temelUclar({ data: [ISLEM(1)] });

    await sar();

    const aciklama = await screen.findByTestId("bakiye-odeme-aciklamasi");
    // Kurulu mekanizma: admin'in tuttuğu defter + banka havalesi.
    expect(aciklama).toHaveTextContent(/havale/i);
    // Yanlış vaat: pazaryeri alt üye işyeri kurulmadan iyzico IBAN'a para geçmez.
    expect(within(aciklama).queryByText(/iyzico/i)).not.toBeInTheDocument();
    expect(aciklama.textContent ?? "").not.toMatch(/iyzico/i);
  });
});
