/**
 * ANA SAYFA EĞİTMEN KUŞAKLARI — sahte kategoriler kaldırıldı.
 *
 * ## Ölçüm (bu dosyadan önce yapıldı)
 *
 * Ana sayfadaki "TYT'ye hazırlık", "YKS Hazırlık", "AYT'ye hazırlık" başlıkları
 * `pages/Landing.tsx` içinde SABİT yazılıydı — veritabanından ya da ders
 * taksonomisinden gelmiyordu. Daha kötüsü: `exam` parametresi backend'de SERT
 * FİLTRE DEĞİL, yalnız SIRALAMA BOOST'udur (`api/tutors.ts`de belgeli). Yani
 * üç kuşak da aynı eğitmen kümesini döndürüyordu.
 *
 * Canlı ölçüm (yerel veritabanı, 7 onaylı eğitmen · gerçek tarayıcı):
 *   "YKS Hazırlık"    → 7 eğitmen
 *   "TYT'ye hazırlık" → AYNI 7 eğitmen
 *   "AYT'ye hazırlık" → AYNI 7 eğitmen
 *
 * Kullanıcının gördüğü şey buydu: kategori vaat eden, ama kategori
 * uygulamayan üç başlık — "mock gibi duruyor" şikâyetinin sebebi.
 *
 * ## Sözleşme
 *
 * Eğitmen tarafında TEK kuşak kalır ve başlığı "Eğitmenler"dir. Sınav
 * bağlamlı (`exam`) kuşak YOKTUR: sıralama boost'u bir kategori adı
 * hak etmez.
 *
 * Test türü (§H): gerçek DOM (jsdom + RTL) + GERÇEKTEN GÖNDERİLEN istek
 * parametrelerinin doğrulanması. Ağ sınırı (`api/tutors::searchTutors`)
 * taklit edilir; react-query, bileşen ve DOM gerçektir.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TutorSearchParams } from "@/api/tutors";

const gonderilenParametreler: TutorSearchParams[] = [];

vi.mock("@/api/tutors", async (orijinal) => {
  const mod = await orijinal<typeof import("@/api/tutors")>();
  return {
    ...mod,
    searchTutors: vi.fn(async (params: TutorSearchParams) => {
      gonderilenParametreler.push(params);
      return [
        {
          id: 1,
          slug: "ayse-yilmaz-1",
          first_name: "Ayşe",
          last_name: "Yılmaz",
          full_name: "Ayşe Yılmaz",
          hourly_rate: "300.00",
          rating_avg: 4.8,
          rating_count: 12,
          teaching_mode: "ONLINE",
          subjects: ["Matematik"],
        },
        {
          id: 2,
          slug: "mehmet-demir-2",
          first_name: "Mehmet",
          last_name: "Demir",
          full_name: "Mehmet Demir",
          hourly_rate: "250.00",
          rating_avg: 4.5,
          rating_count: 8,
          teaching_mode: "ONSITE",
          subjects: ["Fizik"],
        },
        // Kart yalnız bu alanları okur; tam `TutorOut` şeması gerekmez.
      ] as unknown as Awaited<ReturnType<typeof mod.searchTutors>>;
    }),
  };
});

import Landing from "@/pages/Landing";

function sayfayiBas() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Landing />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

/** Kuşak başlıkları — kategori çubuğu etiketleri (h1/h3) değil, yalnız h2. */
function kusakBasliklari() {
  return screen
    .queryAllByRole("heading", { level: 2 })
    .map((h) => h.textContent?.trim() ?? "");
}

beforeEach(() => {
  gonderilenParametreler.length = 0;
});
afterEach(cleanup);

describe("ana sayfa eğitmen kuşakları", () => {
  it("NÖBETÇİ: kuşak gerçekten dolu render oluyor (boş kümede ölçüm yok)", async () => {
    sayfayiBas();
    // Eğitmen kartları basılmazsa aşağıdaki "sahte başlık yok" iddiaları
    // kendiliğinden geçerdi — dosyanın en olası yalancı yeşil kılığı budur.
    await waitFor(() => expect(screen.getAllByText("Ayşe")[0]).toBeTruthy());
    expect(screen.getAllByText("Mehmet")[0]).toBeTruthy();
  });

  it("tek eğitmen kuşağı var ve başlığı 'Eğitmenler'", async () => {
    sayfayiBas();
    await waitFor(() => expect(screen.getAllByText("Ayşe")[0]).toBeTruthy());
    expect(kusakBasliklari()).toEqual(["Eğitmenler"]);
  });

  it("TYT/AYT/YKS/LGS başlığı KALMADI", async () => {
    sayfayiBas();
    await waitFor(() => expect(screen.getAllByText("Ayşe")[0]).toBeTruthy());
    const sahte = kusakBasliklari().filter((b) =>
      /\b(TYT|AYT|YKS|LGS|KPSS)\b/.test(b)
    );
    expect(sahte).toEqual([]);
  });

  it("GERÇEKTEN GÖNDERİLEN istekte `exam` parametresi yok", async () => {
    // Başlığı silip isteği `exam` ile göndermeye devam etmek, yukarıdaki
    // düğümleri geçerdi — ama kullanıcı yine kategori sanısıyla filtrelenmemiş
    // bir liste görürdü. Ölçülen şey ekranda yazan değil, tele giden.
    sayfayiBas();
    await waitFor(() => expect(gonderilenParametreler.length).toBeGreaterThan(0));
    for (const p of gonderilenParametreler) {
      expect(p.exam).toBeUndefined();
    }
  });

  it("eğitmen araması TEK KEZ yapılıyor (üç kopya kuşak kalktı)", async () => {
    sayfayiBas();
    await waitFor(() => expect(screen.getAllByText("Ayşe")[0]).toBeTruthy());
    // Üç sabit kuşak üç ayrı istek üretiyordu; aynı sonucu üç kez çekmek
    // kullanıcıya da sunucuya da bedeldi.
    expect(gonderilenParametreler).toHaveLength(1);
  });
});
