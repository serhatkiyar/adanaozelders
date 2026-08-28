/**
 * ÖNE ÇIKARMA BLOĞU — yasal ve ürün sözleşmesi.
 *
 * ## Neden nöbetçi
 *
 * Ücretli yerleşimin "Reklam" ibaresiyle ayırt edilmesi Ticari Reklam ve
 * Haksız Ticari Uygulamalar Yönetmeliği gereğidir: etiketi kaldıran ya da
 * "Öne çıkan" gibi yumuşatan bir düzenleme, ekranda güzel görünür ve hiçbir
 * testi kırmazdı. Buradaki iddialar tam olarak o sessiz gerilemeyi tutar.
 *
 * Ölçülen şey ekrandaki DOM'dur; bileşen ve react-query gerçektir, yalnız ağ
 * sınırı (`api/tutors::fetchFeaturedTutors`) taklit edilir.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FeaturedTutorParams } from "@/api/tutors";

const gonderilenParametreler: FeaturedTutorParams[] = [];
let sonuc: unknown[] = [];

vi.mock("@/api/tutors", async (orijinal) => {
  const mod = await orijinal<typeof import("@/api/tutors")>();
  return {
    ...mod,
    fetchFeaturedTutors: vi.fn(async (params: FeaturedTutorParams) => {
      gonderilenParametreler.push(params);
      return sonuc as never;
    }),
  };
});

import { FeaturedTutorBlock } from "@/components/FeaturedTutorBlock";

function egitmen(id: number, ad: string) {
  return {
    id,
    slug: `${ad.toLowerCase()}-${id}`,
    first_name: ad,
    last_name: "Test",
    full_name: `${ad} Test`,
    hourly_rate: "300.00",
    rating_avg: 4.5,
    rating_count: 3,
    teaching_mode: "ONLINE",
    subjects: ["Matematik"],
  };
}

function bas(props: Partial<React.ComponentProps<typeof FeaturedTutorBlock>> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FeaturedTutorBlock params={{}} {...props} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  gonderilenParametreler.length = 0;
  sonuc = [];
});
afterEach(cleanup);

describe("öne çıkarma bloğu", () => {
  it("NÖBETÇİ: kartlar gerçekten çiziliyor (boş kümede ölçüm yok)", async () => {
    sonuc = [egitmen(1, "Ayse")];
    bas();
    await waitFor(() => expect(screen.getByText("Ayse")).toBeTruthy());
  });

  it("T-25: çizilen HER kart 'Reklam' ibaresi taşır", async () => {
    sonuc = [egitmen(1, "Ayse"), egitmen(2, "Mehmet")];
    bas();
    await waitFor(() => expect(screen.getByText("Mehmet")).toBeTruthy());
    // 1 blok başlığı + kart başına 1 rozet.
    expect(screen.getAllByText("Reklam")).toHaveLength(3);
  });

  it("T-26: sonuç 3'ten fazla olsa da blok 3 kartla sınırlıdır", async () => {
    // Sunucu zaten `SLOT_LIMIT` uygular; arayüz onu AŞMAMALIDIR. Bu iddia,
    // ileride uca limit parametresi eklenirse arayüzün sessizce taşmasını
    // engeller.
    sonuc = [1, 2, 3, 4, 5].map((i) => egitmen(i, `Kisi${i}`));
    bas();
    await waitFor(() => expect(screen.getByText("Kisi1")).toBeTruthy());
    const rozetler = screen.getAllByText("Reklam").length - 1; // başlık hariç
    expect(rozetler).toBeLessThanOrEqual(3);
  });

  it("eşleşme yoksa blok HİÇ çizilmez (boş başlık kalmaz)", async () => {
    sonuc = [];
    const { container } = bas();
    await waitFor(() => expect(gonderilenParametreler.length).toBeGreaterThan(0));
    expect(screen.queryByText("Reklam")).toBeNull();
    expect(container.querySelector("section")).toBeNull();
  });

  it("T-27: enabled=false iken istek HİÇ atılmaz (2. sayfada reklam yok)", async () => {
    sonuc = [egitmen(1, "Ayse")];
    bas({ enabled: false });
    await new Promise((r) => setTimeout(r, 50));
    expect(gonderilenParametreler).toHaveLength(0);
    expect(screen.queryByText("Reklam")).toBeNull();
  });

  it("T-28: gösterilen id'ler çağırana bildirilir (organik listede tekrar yok)", async () => {
    sonuc = [egitmen(7, "Ayse"), egitmen(9, "Mehmet")];
    const bildirilen: number[][] = [];
    bas({ onIds: (ids) => bildirilen.push(ids) });
    await waitFor(() => expect(bildirilen.at(-1)).toEqual([7, 9]));
  });

  it("aramanın filtreleri uca AYNEN geçer (ilgisiz reklam çıkmaz)", async () => {
    sonuc = [egitmen(1, "Ayse")];
    bas({ params: { subject: ["Fizik"], district: ["Seyhan"] } });
    await waitFor(() => expect(gonderilenParametreler.length).toBeGreaterThan(0));
    expect(gonderilenParametreler[0]).toEqual({
      subject: ["Fizik"],
      district: ["Seyhan"],
    });
  });

  it("sıralama kriterleri sayfasına bağlantı verir (şeffaflık yükümlülüğü)", async () => {
    sonuc = [egitmen(1, "Ayse")];
    bas();
    await waitFor(() => expect(screen.getByText("Ayse")).toBeTruthy());
    const link = screen.getByRole("link", { name: /sıralama nasıl/i });
    expect(link.getAttribute("href")).toBe("/siralama-kriterleri");
  });
});
