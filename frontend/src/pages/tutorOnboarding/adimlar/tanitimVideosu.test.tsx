import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TutorIntroVideo, TutorIntroVideoState } from "@/types";

import { BOS_DURUM, type DisDurum } from "../sozlesme";
import { TanitimVideosu } from "./Metinler";

const api = vi.hoisted(() => ({ fetchMyIntroVideo: vi.fn() }));
vi.mock("@/api/tutorVideo", () => api);

const LINK = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function durum(pending: Partial<TutorIntroVideo> | null): TutorIntroVideoState {
  return {
    active: null,
    pending: pending
      ? { id: 3, status: "PENDING_REVIEW", kind: "LINK", created_at: "", updated_at: "", ...pending }
      : null,
    link_url: null,
    uploads_enabled: true,
    max_bytes: 1,
    max_seconds: 1,
    min_seconds: 1,
    min_short_side: 1,
    require_review: true,
  };
}

function ciz() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TanitimVideosu d={BOS_DURUM} guncelle={vi.fn()} dis={{} as DisDurum} odakla={false} gitAdim={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => api.fetchMyIntroVideo.mockReset());

describe("sihirbaz → tanıtım videosu alanı", () => {
  it("onay bekleyen bağlantı notla görünür; alan yayındaki değeri korur", async () => {
    api.fetchMyIntroVideo.mockResolvedValue(durum({ link_url: LINK }));
    ciz();
    expect(await screen.findByText("Onay bekliyor:")).toBeInTheDocument();
    expect(screen.getByText(LINK)).toBeInTheDocument();
    // Bekleyen alana yazılmaz: boşaltmak bekleyeni değil yayındakini kaldırırdı.
    expect(screen.getByLabelText(/Tanıtım videosu/)).toHaveValue("");
  });

  it("reddedilen bağlantı ya da bekleyen yükleme için not yok", async () => {
    api.fetchMyIntroVideo.mockResolvedValue(durum({ status: "REJECTED", link_url: LINK }));
    const { unmount } = ciz();
    await vi.waitFor(() => expect(api.fetchMyIntroVideo).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("Onay bekliyor:")).toBeNull();
    unmount();

    api.fetchMyIntroVideo.mockResolvedValue(durum({ kind: "UPLOAD" }));
    ciz();
    await vi.waitFor(() => expect(api.fetchMyIntroVideo).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("Onay bekliyor:")).toBeNull();
  });
});
