/**
 * Şifre taşıyan iki mutation (`useCreateCourierAccount`, `useResetCourierPassword`) settled + `reset()`
 * sonrasında QueryClient mutation cache'inde ve observer state'inde düz metin şifre BIRAKMAZ (`gcTime: 0`
 * + tüketici `reset()`). Test gerçek QueryClient ile koşar; yalnız API katmanı sahtedir.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCreateCourierAccount, useResetCourierPassword } from "@/hooks/useDelivery";
import * as deliveryApi from "@/api/delivery";

vi.mock("@/api/delivery", () => ({
  createCourierAccount: vi.fn(),
  resetCourierPassword: vi.fn(),
}));

const SIFRE = "cokGizliSifre123";
let qc: QueryClient;
const sarmal = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

/** Cache'teki mutation'ların ve observer'daki değişkenlerin serileştirilmiş hâlinde şifre var mı. */
function sifreIzi(gozlemci: { variables?: unknown; data?: unknown; error?: unknown; context?: unknown }) {
  const cache = qc.getMutationCache().getAll();
  const metin = JSON.stringify({ cache: cache.map((m) => m.state), gozlemci: { v: gozlemci.variables, d: gozlemci.data, e: gozlemci.error } });
  return { sifreVar: metin.includes(SIFRE), cacheAdedi: cache.length };
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  vi.mocked(deliveryApi.createCourierAccount).mockReset();
  vi.mocked(deliveryApi.resetCourierPassword).mockReset();
});

describe("şifre taşıyan mutation'lar", () => {
  it.each([
    ["hesap oluşturma", "basari"],
    ["hesap oluşturma", "hata"],
    ["şifre sıfırlama", "basari"],
    ["şifre sıfırlama", "hata"],
  ] as const)("%s · %s yolu: uçuşta şifre görünür (ölçüm anlamlı), settled + reset sonrası cache ve observer temiz", async (islem, yol) => {
    let cozumle: (v: unknown) => void = () => {};
    let reddet: (e: unknown) => void = () => {};
    const ertelenmis = new Promise((res, rej) => { cozumle = res; reddet = rej; });
    const api = islem === "hesap oluşturma" ? vi.mocked(deliveryApi.createCourierAccount) : vi.mocked(deliveryApi.resetCourierPassword);
    api.mockReturnValue(ertelenmis as never);
    const { result } = renderHook(() => (islem === "hesap oluşturma" ? useCreateCourierAccount() : useResetCourierPassword()), { wrapper: sarmal });

    let soz: Promise<unknown>;
    act(() => {
      soz =
        islem === "hesap oluşturma"
          ? (result.current as ReturnType<typeof useCreateCourierAccount>).mutateAsync({ courierId: 1, email: "a@b.co", password: SIFRE, first_name: "A", last_name: "B" })
          : (result.current as ReturnType<typeof useResetCourierPassword>).mutateAsync({ accountId: 5, newPassword: SIFRE });
      soz.catch(() => {});
    });
    // Uçuştayken değişkenler cache'te ve observer'da: ölçüm gerçekten şifreyi yakalıyor.
    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(sifreIzi(result.current)).toEqual({ sifreVar: true, cacheAdedi: 1 });

    await act(async () => {
      if (yol === "basari") cozumle({ id: 9, email: "a@b.co", is_active: true });
      else reddet({ response: { status: 422, data: { detail: [{ loc: ["body", "password"], msg: "Zayıf" }] } } });
      await soz.catch(() => {});
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    // Tüketicinin yaptığı gibi: hata/başarı yerel state'e alındıktan sonra reset.
    if (yol === "hata") expect(result.current.isError).toBe(true);
    act(() => result.current.reset());
    await waitFor(() => expect(result.current.isIdle).toBe(true));
    expect(result.current.variables).toBeUndefined();
    // `gcTime: 0` → mutation cache'ten de düşer; şifre hiçbir yerde yok.
    await waitFor(() => expect(sifreIzi(result.current)).toEqual({ sifreVar: false, cacheAdedi: 0 }));
  });

  it("iki mutation da gcTime: 0 ile tanımlı (varsayılan 5 dk bekletme yok)", async () => {
    vi.mocked(deliveryApi.resetCourierPassword).mockRejectedValue(new Error("x"));
    const { result } = renderHook(() => useResetCourierPassword(), { wrapper: sarmal });
    await act(async () => { await result.current.mutateAsync({ accountId: 1, newPassword: SIFRE }).catch(() => {}); });
    expect(qc.getMutationCache().getAll().every((m) => m.gcTime === 0)).toBe(true);
    vi.mocked(deliveryApi.createCourierAccount).mockRejectedValue(new Error("x"));
    const h = renderHook(() => useCreateCourierAccount(), { wrapper: sarmal });
    await act(async () => { await h.result.current.mutateAsync({ courierId: 1, email: "a@b.co", password: SIFRE, first_name: "A", last_name: "B" }).catch(() => {}); });
    expect(qc.getMutationCache().getAll().every((m) => m.gcTime === 0)).toBe(true);
  });
});
