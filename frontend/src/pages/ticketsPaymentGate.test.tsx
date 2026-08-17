/**
 * Biletlerim / Rezervasyonlarım — ödeme kolu kapısı (GERÇEK DOM).
 *
 * Regresyon: `Tickets.tsx`'teki iki "Ödemeyi tamamla" butonu ödeme kolunu hiç
 * sorgulamıyordu. Üretimde kütüphane pazaryeri kolu kapalıdır
 * (`core/payments/iyzico.py::supports_marketplace = False` +
 * `payment_gates.BRANCH_NEEDS_MARKETPLACE[LIBRARY_MARKETPLACE] = True`), yani
 * buton tıklanabilir kalıyor ve kullanıcı 503'e yürüyordu. `StudentBookings`,
 * `ExamSessionsSection` ve `StudySpaceSection` bu kapıyı zaten uyguluyordu.
 *
 * Kapı, uygunluk bilgisi `GET /payments/availability`'den gelir; burada axios
 * adapter'i ile GERÇEK istek yakalanır — hook mock'lanmaz, böylece test
 * "mock'un kendisini" değil kullanıcının gördüğü sonucu doğrular.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { TicketsContent } from "@/pages/Tickets";
import type { PaymentAvailability } from "@/lib/paymentAvailability";

const KAPALI: PaymentAvailability = {
  branches: [
    { branch: "store", open: true, flag_enabled: true, blockers: [] },
    {
      branch: "library_marketplace",
      open: false,
      flag_enabled: false,
      blockers: ["flag_disabled"],
      message: "Kütüphane ödemeleri şu anda kapalıdır.",
    },
  ],
};

const ACIK: PaymentAvailability = {
  branches: [
    { branch: "store", open: true, flag_enabled: true, blockers: [] },
    {
      branch: "library_marketplace",
      open: true,
      flag_enabled: true,
      blockers: [],
    },
  ],
};

/** Ödenmemiş bir deneme bileti + ödenmemiş bir çalışma rezervasyonu. */
const BILETLER = [
  {
    id: 11,
    status: "PENDING_PAYMENT",
    amount: "150.00",
    qr_token: null,
    attended_at: null,
    session: {
      id: 5,
      title: "TYT Genel Deneme",
      starts_at: new Date(Date.now() + 86_400_000).toISOString(),
      duration_minutes: 135,
      library_name: "Merkez Kütüphane",
      library_id: 3,
      library_slug: "merkez-kutuphane",
    },
  },
];

const REZERVASYONLAR = [
  {
    id: 22,
    status: "PENDING_PAYMENT",
    amount: "90.00",
    qr_token: null,
    attended_at: null,
    starts_at: new Date(Date.now() + 86_400_000).toISOString(),
    ends_at: new Date(Date.now() + 90_000_000).toISOString(),
    library_name: "Merkez Kütüphane",
    library_id: 3,
    library_slug: "merkez-kutuphane",
  },
];

let uygunluk: PaymentAvailability = KAPALI;
const orijinalAdapter = apiClient.defaults.adapter;

beforeEach(() => {
  uygunluk = KAPALI;
  // Gerçek axios katmanı çalışsın, yalnız taşıma katmanı sahte olsun.
  apiClient.defaults.adapter = async (config) => {
    const url = config.url ?? "";
    const govde = url.includes("/payments/availability")
      ? uygunluk
      : url.includes("/exam-registrations")
        ? BILETLER
        : url.includes("/study-reservations")
          ? REZERVASYONLAR
          : [];
    return {
      data: govde,
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    } as never;
  };
});

afterEach(() => {
  apiClient.defaults.adapter = orijinalAdapter;
});

function sar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TicketsContent />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Biletlerim — ödeme kolu kapalıyken", () => {
  it("iki 'Ödemeyi tamamla' butonu da DEVRE DIŞI ve metni 'Ödeme kapalı'", async () => {
    sar();

    const butonlar = await screen.findAllByRole("button", { name: "Ödeme kapalı" });
    // Bilet + çalışma rezervasyonu = iki kart.
    expect(butonlar).toHaveLength(2);
    for (const b of butonlar) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    }
    // Kapalıyken eski metin hiç görünmemeli.
    expect(screen.queryByRole("button", { name: "Ödemeyi tamamla" })).toBeNull();
  });

  it("sunucunun kapalı-kol açıklaması gösterilir (PaymentBranchNotice)", async () => {
    sar();
    const notlar = await screen.findAllByText("Kütüphane ödemeleri şu anda kapalıdır.");
    expect(notlar.length).toBeGreaterThanOrEqual(2);
  });

  it("İptal butonu kapalı kolda da kullanılabilir kalır", async () => {
    sar();
    const iptaller = await screen.findAllByRole("button", { name: "İptal" });
    expect(iptaller.length).toBe(2);
    for (const b of iptaller) {
      expect((b as HTMLButtonElement).disabled).toBe(false);
    }
  });
});

describe("Biletlerim — ödeme kolu açıkken", () => {
  beforeEach(() => {
    uygunluk = ACIK;
  });

  it("butonlar normal metniyle ve ETKİN gelir, uyarı şeridi yok", async () => {
    sar();
    const butonlar = await screen.findAllByRole("button", { name: "Ödemeyi tamamla" });
    expect(butonlar).toHaveLength(2);
    for (const b of butonlar) {
      expect((b as HTMLButtonElement).disabled).toBe(false);
    }
    await waitFor(() => {
      expect(
        screen.queryByText("Kütüphane ödemeleri şu anda kapalıdır.")
      ).toBeNull();
    });
  });
});

describe("kart içeriği", () => {
  it("her iki kart da kendi tutarını gösterir (fixture gerçekten render oldu)", async () => {
    sar();
    // Boş/yanlış fixture yüzünden testin sessizce boş DOM'da geçmesini önler.
    const govde = await screen.findByText(/TYT Genel Deneme/);
    expect(within(document.body).getByText(/150/)).toBeTruthy();
    expect(within(document.body).getByText(/90/)).toBeTruthy();
    expect(govde).toBeTruthy();
  });
});
