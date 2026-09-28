import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchMyIntroVideo: vi.fn(),
  startIntroVideoUpload: vi.fn(),
  uploadToPresignedUrl: vi.fn(),
  completeIntroVideoUpload: vi.fn(),
  cancelIntroVideoUpload: vi.fn(),
  removeMyIntroVideo: vi.fn(),
}));
vi.mock("@/api/tutorVideo", () => api);
vi.mock("@/lib/tanitimVideo", async (orijinal) => ({
  ...(await orijinal<typeof import("@/lib/tanitimVideo")>()),
  videoBilgisiniOku: vi.fn(async () => null),
}));

import { useIntroVideoUpload } from "./useTutorIntroVideo";

function sarmalayici({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function ertelenmis<T>() {
  let coz!: (v: T) => void;
  const soz = new Promise<T>((r) => (coz = r));
  return { soz, coz };
}

describe("useIntroVideoUpload", () => {
  it("init sürerken iptal edilip yeni yükleme başlarsa eski akış yenisini ezmez", async () => {
    const dosya = new File(["x"], "a.mp4", { type: "video/mp4" });
    const init1 = ertelenmis<{ video_id: number }>();
    const put2 = ertelenmis<void>();
    api.startIntroVideoUpload
      .mockReturnValueOnce(init1.soz)
      .mockResolvedValueOnce({ video_id: 2 });
    api.uploadToPresignedUrl.mockImplementation(
      (_init: unknown, _f: File, o: { signal: AbortSignal }) =>
        new Promise<void>((coz, red) => {
          o.signal.addEventListener("abort", () => red(new Error("iptal")));
          void put2.soz.then(coz);
        })
    );
    api.cancelIntroVideoUpload.mockResolvedValue(undefined);

    const { result } = renderHook(
      () => useIntroVideoUpload({ maxBytes: 1e9, maxSeconds: 130, minSeconds: 30 }),
      { wrapper: sarmalayici }
    );
    let akis1!: Promise<void>;
    act(() => {
      akis1 = result.current.yukle(dosya);
    });
    await waitFor(() => expect(api.startIntroVideoUpload).toHaveBeenCalledTimes(1));
    await act(() => result.current.iptal());
    act(() => {
      void result.current.yukle(dosya);
    });
    await waitFor(() => expect(result.current.asama).toMatchObject({ tur: "yukleniyor", videoId: 2 }));

    // Eski init şimdi döner: kendi yarım kaydını siler, ekrana dokunmaz.
    await act(async () => {
      init1.coz({ video_id: 1 });
      await akis1;
    });
    expect(api.cancelIntroVideoUpload).toHaveBeenCalledWith(1);
    expect(result.current.asama).toMatchObject({ tur: "yukleniyor", videoId: 2 });

    // Yeni akış hâlâ iptal edilebilir ve kendi kaydı silinir.
    await act(() => result.current.iptal());
    expect(api.cancelIntroVideoUpload).toHaveBeenCalledWith(2);
    expect(result.current.asama).toEqual({ tur: "bos" });
  });
});
