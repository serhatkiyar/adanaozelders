import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/auth", () => ({
  fetchMe: vi.fn(() => Promise.resolve({ id: 7, role_id: 3 })),
  logout: vi.fn(() => Promise.resolve()),
}));

import { StoreAccountMenu } from "@/components/store/StoreAccountMenu";
import { useAuthStore } from "@/store/authStore";

function ciz() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/magaza"]}>
        <StoreAccountMenu />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("StoreAccountMenu", () => {
  afterEach(() => useAuthStore.setState({ token: null, user: null }));

  it("tam sayfa yüklemede (yalnız token kalıcı) oturum açıkken 'Giriş Yap' değil hesap menüsü gösterir", async () => {
    useAuthStore.setState({ token: "t", user: null });
    ciz();
    expect(screen.queryByText("Giriş Yap")).not.toBeInTheDocument();
    expect(await screen.findByText("Hesabım")).toBeInTheDocument();
  });

  it("oturum yoksa 'Giriş Yap' gösterir", () => {
    ciz();
    expect(screen.getByText("Giriş Yap")).toBeInTheDocument();
  });
});
