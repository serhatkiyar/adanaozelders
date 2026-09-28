import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { TutorOut } from "@/types";

vi.mock("@/api/tutors", () => ({
  activateMyListing: vi.fn(),
  fetchMyTutorProfile: vi.fn(),
  submitMyTutorProfile: vi.fn(),
  suspendMyListing: vi.fn(),
  updateMyTutorProfile: vi.fn(async () => ({ id: 7, first_name: "Ayşe" }) as TutorOut),
}));

import { useUpdateTutorProfile } from "./useTutorProfile";

function kur() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const tazele = vi.spyOn(qc, "invalidateQueries");
  const sarici = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useUpdateTutorProfile(), { wrapper: sarici });
  const videoTazelendi = () =>
    tazele.mock.calls.some(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(["tutors", "me", "intro-video"]));
  return { result, videoTazelendi };
}

describe("useUpdateTutorProfile", () => {
  it("bağlantı kaydı video durumunu tazeler (onay bekleyen kart görünsün)", async () => {
    const { result, videoTazelendi } = kur();
    await act(() => result.current.mutateAsync({ intro_video_url: "https://youtu.be/dQw4w9WgXcQ" }));
    expect(videoTazelendi()).toBe(true);
  });

  it("bağlantı içermeyen kayıt video durumuna dokunmaz", async () => {
    const { result, videoTazelendi } = kur();
    await act(() => result.current.mutateAsync({ bio: "Merhaba" }));
    expect(videoTazelendi()).toBe(false);
  });
});
