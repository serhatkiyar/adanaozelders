import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { PublicRoute } from "@/routes/PublicRoute";
import { useAuthStore } from "@/store/authStore";

function ciz() {
  const qc = new QueryClient();
  // Oturumlu eğitmen: /auth/me önbellekte (çıkış isteği henüz bitmemiş hal).
  qc.setQueryData(["me"], { id: 1, role_id: 2 });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/giris"]}>
        <Routes>
          <Route element={<PublicRoute />}>
            <Route path="/giris" element={<p>giriş formu</p>} />
          </Route>
          <Route path="*" element={<p>pano</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("PublicRoute", () => {
  afterEach(() => useAuthStore.setState({ token: null, cikisYapiliyor: false }));

  it("oturumlu kullanıcıyı girişten kendi panosuna yollar", () => {
    useAuthStore.setState({ token: "t", cikisYapiliyor: false });
    ciz();
    expect(screen.getByText("pano")).toBeInTheDocument();
  });

  it("çıkış sürerken eski token'la panoya geri yollamaz", () => {
    useAuthStore.setState({ token: "t", cikisYapiliyor: true });
    ciz();
    expect(screen.getByText("giriş formu")).toBeInTheDocument();
  });
});
