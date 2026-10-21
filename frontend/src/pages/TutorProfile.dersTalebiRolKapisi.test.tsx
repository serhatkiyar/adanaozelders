/**
 * DERS TALEBİ ROL KAPISI — giriş yapmış kabuk (`TutorProfile`).
 *
 * Ders talebi yalnız üye (CLIENT) hesabıyla yapılır; sunucu başka rolü
 * reddeder. Kapı açık kalırsa eğitmen ya da admin saate basar, pencere açılır,
 * formu doldurur ve ancak gönderince hata görür. Bekleyen niyet için de aynı:
 * anonimken saate basıp eğitmen hesabıyla giren kişiye pencere açılmamalı ve
 * niyet sekmede kalıp sonraki bir girişte patlamamalı.
 *
 * ## Gücü ve sınırı
 *
 * Gerçek sayfa bileşeni + gerçek niyet kancası. Takvim ve ders penceresi
 * sahtedir: ölçülen şey kapının kimi içeri aldığı, pencerenin içeriği değil.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import TutorProfile from "@/pages/TutorProfile";
import { niyetiGozle, niyetiSakla, niyetiTemizle } from "@/lib/bekleyenNiyet";
import { useAuthStore } from "@/store/authStore";
import { ROLE_IDS } from "@/types";

const EGITMEN_ID = 42;
const EGITMEN = {
  id: EGITMEN_ID,
  display_name: "Ali",
  headline: "Matematik",
  hourly_rate: 300,
  subjects: [],
  districts: [],
  rating_count: 0,
  
};
const SAAT = { date: "2026-10-05", start_at: "2026-10-05T07:00:00Z", duration: 60 };

let aktifKullanici: { id: number; role_id: number } | null = null;

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: aktifKullanici, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useTutorSearch", () => ({
  useTutorDetail: () => ({ data: EGITMEN, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useReviews", () => ({
  useReviewsByTutor: () => ({ data: [] }),
  useTutorRatingDistribution: () => ({ data: null }),
}));
vi.mock("@/hooks/useBookings", () => ({
  useBookings: () => ({ data: [] }),
}));
vi.mock("@/hooks/useCanonicalTutorSlug", () => ({
  useCanonicalTutorSlug: () => undefined,
}));
vi.mock("@/hooks/useNavSearch", () => ({
  useNavSearch: () => ({ center: null, bottom: null, open: false, setOpen: () => {} }),
}));
vi.mock("@/components/DashboardShell", () => ({
  DashboardShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/BookmarkButton", () => ({ BookmarkButton: () => null }));
vi.mock("@/components/egitmen/ProgramTakvimi", () => ({
  ProgramTakvimi: ({ onSaatSec }: { onSaatSec?: (s: typeof SAAT) => void }) =>
    onSaatSec ? (
      <button type="button" onClick={() => onSaatSec(SAAT)}>
        Saat seç
      </button>
    ) : (
      <p>salt okunur program</p>
    ),
}));
vi.mock("@/components/BookingModal", () => ({
  BookingModal: () => <div>DERS PENCERESİ</div>,
}));

function ciz(roleId: number, id = 7) {
  aktifKullanici = { id, role_id: roleId };
  useAuthStore.setState({
    token: "t",
    user: { id, role_id: roleId, display_name: "Test", email: "t@example.com" },
  } as never);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/egitmenler/ali-${EGITMEN_ID}`]}>
          <Routes>
            <Route path="/egitmenler/:slug" element={<TutorProfile />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

afterEach(() => {
  cleanup();
  niyetiTemizle();
  aktifKullanici = null;
  useAuthStore.setState({ token: null, user: null } as never);
});

describe("ders talebi · rol kapısı", () => {
  it("ÜYE: saat ve 'Ders Talep Et' ders penceresini açar", () => {
    ciz(ROLE_IDS.CLIENT);
    fireEvent.click(screen.getByRole("button", { name: "Saat seç" }));
    expect(screen.getByText("DERS PENCERESİ")).toBeTruthy();
    cleanup();

    ciz(ROLE_IDS.CLIENT);
    fireEvent.click(screen.getByRole("button", { name: /Ders Talep Et/i }));
    expect(screen.getByText("DERS PENCERESİ")).toBeTruthy();
  });

  it.each([
    ["başka eğitmen", ROLE_IDS.TUTOR],
    ["admin", ROLE_IDS.ADMIN],
    ["kurye", ROLE_IDS.COURIER],
  ])("%s: saatler salt okunur, talep düğmesi yok", (_ad, roleId) => {
    ciz(roleId);
    expect(screen.queryByRole("button", { name: "Saat seç" })).toBeNull();
    expect(screen.getByText("salt okunur program")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ders Talep Et/i })).toBeNull();
    expect(screen.queryByText("DERS PENCERESİ")).toBeNull();
  });
});

describe("ders talebi · bekleyen niyet", () => {
  it("ÜYE girişinde niyet uygulanır ve tüketilir", async () => {
    niyetiSakla({ tip: "dersTalebi", egitmenId: EGITMEN_ID, saat: SAAT });
    ciz(ROLE_IDS.CLIENT);
    await waitFor(() => expect(screen.getByText("DERS PENCERESİ")).toBeTruthy());
    expect(niyetiGozle()).toBeNull();
  });

  it("EĞİTMEN girişinde pencere açılmaz, niyet silinir", async () => {
    niyetiSakla({ tip: "dersTalebi", egitmenId: EGITMEN_ID, saat: SAAT });
    ciz(ROLE_IDS.TUTOR);
    await waitFor(() => expect(niyetiGozle()).toBeNull());
    expect(screen.queryByText("DERS PENCERESİ")).toBeNull();
  });

  it("başka eğitmenin niyeti bu sayfada TÜKETİLMEZ", async () => {
    // Kapsam çıpası: `at` dalı eşleşmeyen niyeti de yerse 99'a giden
    // kullanıcının niyeti burada sessizce kaybolurdu.
    niyetiSakla({ tip: "dersTalebi", egitmenId: 99 });
    ciz(ROLE_IDS.TUTOR);
    await Promise.resolve();
    expect(niyetiGozle()).toEqual({ tip: "dersTalebi", egitmenId: 99 });
  });
});
