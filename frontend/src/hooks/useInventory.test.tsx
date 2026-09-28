import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useApplyCountSession, useCreateDamageEvent } from "@/hooks/useInventory";

vi.mock("@/api/inventory", () => ({
  applyCountSession: vi.fn().mockResolvedValue({}),
  createDamageEvent: vi.fn().mockResolvedValue({}),
}));

/**
 * Stok bakiyesini değiştiren işlemden sonra admin ürün listesi ve düzenleme
 * penceresi tazelenmeli. Eskiden `["admin","products"]` düşürülüyordu; bu
 * anahtarla eşleşen sorgu yoktu ve ekran eski stok rakamını gösteriyordu.
 */
function kurulum() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const liste = ["store", "admin", "products", {}];
  const urun = ["store", "admin", "product", 7];
  qc.setQueryData(liste, { items: [] });
  qc.setQueryData(urun, { id: 7 });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const gecersizMi = () => [liste, urun].map((k) => qc.getQueryState(k)?.isInvalidated);
  return { wrapper, gecersizMi };
}

describe("useInventory · ürün önbelleği", () => {
  it("sayım uygulanınca admin ürün listesi ve ürün detayı geçersiz olur", async () => {
    const { wrapper, gecersizMi } = kurulum();
    const { result } = renderHook(() => useApplyCountSession(1), { wrapper });
    await act(() => result.current.mutateAsync("anahtar"));
    expect(gecersizMi()).toEqual([true, true]);
  });

  it("hasar kaydı sonrası admin ürün listesi ve ürün detayı geçersiz olur", async () => {
    const { wrapper, gecersizMi } = kurulum();
    const { result } = renderHook(() => useCreateDamageEvent(), { wrapper });
    await act(() =>
      result.current.mutateAsync({} as Parameters<typeof result.current.mutateAsync>[0]),
    );
    expect(gecersizMi()).toEqual([true, true]);
  });
});
