// "Bakiyem" eğitmen şeridinden kalktı (17 Eyl 2026). Eski adres (/pano/bakiyem),
// legacy /bakiyem yönlendirmesi ve bildirimlerdeki bağlantılar hâlâ oraya
// gidiyor; eğitmen Kazançlar'a düşmeli, operatör kendi Bakiyem ekranını
// görmeye devam etmeli, Kazançlar'a da giremez.
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ROUTES } from "@/lib/routes";
import { ROLE_IDS } from "@/types";

let rol: number = ROLE_IDS.TUTOR;

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: { id: 1, role_id: rol }, isLoading: false }),
}));

// Operatör görünümü ağır hook'lar çağırır; burada yalnız yönlendirme ölçülür.
vi.mock("@/hooks/useLibraryExams", () => ({
  useOperatorMe: () => ({ data: undefined, isLoading: true }),
}));
vi.mock("@/hooks/useLibraries", () => ({
  useLibraryEarnings: () => ({ data: undefined, isLoading: true }),
  useLibraryEarningsTransactions: () => ({ data: undefined, isLoading: true }),
}));
vi.mock("@/components/DashboardShell", () => ({
  DashboardShell: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

import Balance from "@/pages/Balance";
import TutorEarnings from "@/pages/TutorEarnings";

function ciz(yol: string) {
  render(
    <MemoryRouter initialEntries={[yol]}>
      <Routes>
        <Route path={ROUTES.balance} element={<Balance />} />
        <Route path={ROUTES.tutorEarnings} element={<div>kazanclar-yonlendirildi</div>} />
        <Route path={ROUTES.home} element={<div>ana-sayfa</div>} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  rol = ROLE_IDS.TUTOR;
});

describe("Bakiyem → Kazançlar yönlendirmesi", () => {
  it("eğitmen eski Bakiyem adresinden Kazançlar'a gider", () => {
    rol = ROLE_IDS.TUTOR;
    ciz(ROUTES.balance);
    expect(screen.getByText("kazanclar-yonlendirildi")).toBeTruthy();
  });

  it("operatör Bakiyem'de kalır", () => {
    rol = ROLE_IDS.LIBRARY_OPERATOR;
    ciz(ROUTES.balance);
    expect(screen.queryByText("kazanclar-yonlendirildi")).toBeNull();
    expect(screen.getByText("Bakiyem")).toBeTruthy();
  });

  it("operatör Kazançlar adresine girerse Bakiyem'e döner", () => {
    rol = ROLE_IDS.LIBRARY_OPERATOR;
    render(
      <MemoryRouter initialEntries={[ROUTES.tutorEarnings]}>
        <Routes>
          <Route path={ROUTES.tutorEarnings} element={<TutorEarnings />} />
          <Route path={ROUTES.balance} element={<div>bakiyem-yonlendirildi</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText("bakiyem-yonlendirildi")).toBeTruthy();
  });
});
