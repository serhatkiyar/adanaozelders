import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KameraKaydi } from "./KameraKaydi";

/* ── Sahte kamera + MediaRecorder ─────────────────────────────────────────── */

const trackStop = vi.fn();
const sahteAkis = { getTracks: () => [{ stop: trackStop }, { stop: trackStop }] } as unknown as MediaStream;

class SahteKaydedici {
  static isTypeSupported = (t: string) => t.startsWith("video/webm");
  static son: SahteKaydedici | null = null;
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  akis: MediaStream;
  secenek: { mimeType: string };
  constructor(akis: MediaStream, secenek: { mimeType: string }) {
    this.akis = akis;
    this.secenek = secenek;
    SahteKaydedici.son = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["x"], { type: "video/webm" }) });
    this.onstop?.();
  }
}

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  trackStop.mockClear();
  getUserMedia = vi.fn().mockResolvedValue(sahteAkis);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
  });
  (window as unknown as { MediaRecorder: unknown }).MediaRecorder = SahteKaydedici;
  URL.createObjectURL = vi.fn(() => "blob:kayit");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

async function kamerayiAc() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Kamerayı aç" }));
  });
}

async function kaydet(saniye: number) {
  fireEvent.click(screen.getByRole("button", { name: "Kaydı başlat" }));
  // 3 sn geri sayım + kayıt süresi (Date.now sahte zamanla ilerler).
  await act(async () => {
    vi.advanceTimersByTime(3000 + saniye * 1000);
  });
}

describe("KameraKaydi", () => {
  it("izin reddi anlaşılır mesaj gösterir", async () => {
    getUserMedia.mockRejectedValueOnce({ name: "NotAllowedError" });
    render(<KameraKaydi minSeconds={30} maxSeconds={120} onKullan={vi.fn()} onVazgec={vi.fn()} />);
    await kamerayiAc();
    expect(screen.getByRole("alert")).toHaveTextContent(/izni verilmedi/);
    expect(screen.getByRole("button", { name: "Kamerayı aç" })).toBeInTheDocument();
  });

  it("alt sınır dolmadan Kaydı bitir pasif, sonra etkin; kayıt webm File olarak verilir", async () => {
    const onKullan = vi.fn();
    render(<KameraKaydi minSeconds={30} maxSeconds={120} onKullan={onKullan} onVazgec={vi.fn()} />);
    await kamerayiAc();
    expect(getUserMedia).toHaveBeenCalledOnce();
    await kaydet(10);
    expect(SahteKaydedici.son?.secenek.mimeType).toBe("video/webm;codecs=vp9,opus");
    expect(screen.getByRole("button", { name: "Kaydı bitir" })).toBeDisabled();
    await act(async () => {
      vi.advanceTimersByTime(21_000);
    });
    const bitir = screen.getByRole("button", { name: "Kaydı bitir" });
    expect(bitir).toBeEnabled();
    await act(async () => {
      fireEvent.click(bitir);
    });
    expect(screen.getByLabelText("Kaydettiğin video")).toHaveAttribute("src", "blob:kayit");
    fireEvent.click(screen.getByRole("button", { name: "Bu kaydı kullan" }));
    const file = onKullan.mock.calls[0][0] as File;
    expect(file.name).toBe("kamera-kaydi.webm");
    expect(file.type).toBe("video/webm");
    expect(trackStop).toHaveBeenCalled(); // kamera ışığı söner
  });

  it("üst sınırda kayıt kendiliğinden durur", async () => {
    render(<KameraKaydi minSeconds={30} maxSeconds={120} onKullan={vi.fn()} onVazgec={vi.fn()} />);
    await kamerayiAc();
    await kaydet(121);
    expect(SahteKaydedici.son?.state).toBe("inactive");
    expect(screen.getByRole("button", { name: "Bu kaydı kullan" })).toBeInTheDocument();
  });

  it("vazgeç kamerayı kapatır", async () => {
    const onVazgec = vi.fn();
    render(<KameraKaydi minSeconds={30} maxSeconds={120} onKullan={vi.fn()} onVazgec={onVazgec} />);
    await kamerayiAc();
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(onVazgec).toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalled();
  });
});
