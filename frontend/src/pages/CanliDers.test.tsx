/**
 * Canlı ders (Zoom) sayfası — kapı hataları, oda yerleşimi ve çıkış akışı.
 *
 * jsdom Zoom toolkit'ini yükleyemez: `ZoomOdasi` taklit edilir; taklit aldığı
 * geri çağrıları dışarı verir ki karşı taraf/kopma olayları sürülebilsin.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBooking, getZoomToken } from "@/api/bookings";
import type { ZoomOdasiProps, ZoomOdasiTutamak } from "@/components/canli/ZoomOdasi";
import { tamSayfaGit } from "@/lib/tamSayfaGezinme";
import { PATHS } from "@/lib/routes";
import CanliDers from "@/pages/CanliDers";
import type { BookingOut, ZoomDersTokenOut } from "@/types";

const oda = vi.hoisted(() => ({
  props: null as ZoomOdasiProps | null,
  ayril: vi.fn(async () => {}),
  sohbetiDegistir: vi.fn(),
  kurulum: 0,
}));

vi.mock("@/components/canli/ZoomOdasi", () => ({
  default: forwardRef<ZoomOdasiTutamak, ZoomOdasiProps>(function SahteOda(props, ref) {
    oda.props = props;
    useImperativeHandle(
      ref,
      () => ({ ayril: oda.ayril, sohbetiDegistir: oda.sohbetiDegistir }),
      [],
    );
    return <div data-testid="zoom-kabi" />;
  }),
}));
vi.mock("@/api/bookings", async (asil) => ({
  ...((await asil()) as object),
  fetchBooking: vi.fn(),
  getZoomToken: vi.fn(),
}));
vi.mock("@/lib/tamSayfaGezinme", () => ({ tamSayfaGit: vi.fn() }));

const BILET: ZoomDersTokenOut = {
  token: "jwt",
  oturum_adi: "adana-5-abc",
  kullanici_adi: "Ayşe",
  rol: "host",
  expires_at: "2026-09-24T16:00:00Z",
};

const DERS = {
  id: 5,
  tutor_id: 10,
  client_id: 20,
  tutor_name: "Ayşe Hoca",
  client_name: "Mehmet",
  start_at: "2026-09-24T14:00:00Z",
  end_at: "2026-09-24T15:00:00Z",
  mode: "ONLINE",
  meeting_room: "adana-5-abc",
  canli_ders_saglayici: "zoom",
} as BookingOut;

function hataYaniti(status: number, detail?: string) {
  return Object.assign(new Error("istek"), { response: { status, data: { detail } } });
}

function ciz(adres = "/canli-ders/5") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[adres]}>
        <Routes>
          <Route path={PATHS.canliDers} element={<CanliDers />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  oda.props = null;
  vi.clearAllMocks();
  vi.mocked(fetchBooking).mockResolvedValue(DERS);
  vi.mocked(getZoomToken).mockResolvedValue(BILET);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CanliDers — giriş kapıları", () => {
  it("402: ödeme metni, dönüş ders sayfasına TAM SAYFA", async () => {
    vi.mocked(getZoomToken).mockRejectedValue(hataYaniti(402, "Ders ücreti…"));
    ciz();

    expect(await screen.findByText("Canlı derse girilemedi")).toBeInTheDocument();
    expect(screen.getByText(/ödenmeden canlı derse katılınamaz/)).toBeInTheDocument();
    expect(screen.queryByTestId("zoom-kabi")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ders sayfasına dön" }));
    expect(tamSayfaGit).toHaveBeenCalledWith("/ders-talepleri/5");
  });

  it("409: sunucunun nedeni gösterilir", async () => {
    vi.mocked(getZoomToken).mockRejectedValue(
      hataYaniti(409, "Canlı ders yalnız ders saatinde açıktır."),
    );
    ciz();
    expect(
      await screen.findByText("Canlı ders yalnız ders saatinde açıktır."),
    ).toBeInTheDocument();
  });

  it("503: altyapı metni ve yeniden deneme", async () => {
    vi.mocked(getZoomToken).mockRejectedValue(hataYaniti(503));
    ciz();
    expect(await screen.findByText(/altyapısı şu an kullanılamıyor/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yeniden dene" })).toBeInTheDocument();
  });

  it("geçersiz adres sunucuya sorulmadan reddedilir", () => {
    ciz("/canli-ders/abc");
    expect(screen.getByText("Ders bulunamadı.")).toBeInTheDocument();
    expect(getZoomToken).not.toHaveBeenCalled();
  });
});

describe("CanliDers — oda", () => {
  it("bilet gelince oda sunucunun verdiği biletle kurulur", async () => {
    ciz();
    expect(await screen.findByTestId("zoom-kabi")).toBeInTheDocument();
    expect(oda.props?.bilet).toEqual(BILET);
    expect(screen.getByText("Canlı ders · Mehmet")).toBeInTheDocument();
    // Mesajlar yeni sekme/bağlantı değil; oda sohbete hazır olana dek yok.
    expect(screen.queryByRole("link", { name: /Mesajlar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Mesajlar/ })).toBeNull();
  });

  it("Mesajlar yan paneldeki ders içi sohbeti açıp kapatır", async () => {
    ciz();
    await screen.findByTestId("zoom-kabi");
    act(() => oda.props!.onSohbetDurumu?.({ kullanilabilir: true, acik: false, okunmamis: 2 }));

    const dugme = screen.getByRole("button", { name: "Mesajlar, 2 okunmamış" });
    expect(dugme).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(dugme);
    expect(oda.sohbetiDegistir).toHaveBeenCalledTimes(1);

    act(() => oda.props!.onSohbetDurumu?.({ kullanilabilir: true, acik: true, okunmamis: 0 }));
    expect(screen.getByRole("button", { name: "Mesajlar" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("karşı taraf ayrılınca bekleme notu, dönünce kalkar", async () => {
    ciz();
    await screen.findByTestId("zoom-kabi");

    act(() => oda.props!.onKarsiTaraf("ayrildi"));
    expect(
      screen.getByText("Öğrencin dersten ayrıldı, geri dönmesi bekleniyor."),
    ).toBeInTheDocument();

    act(() => oda.props!.onKarsiTaraf("odada"));
    expect(screen.queryByText(/dersten ayrıldı/)).toBeNull();
  });

  it("öğrenci için not öğretmenden söz eder", async () => {
    vi.mocked(getZoomToken).mockResolvedValue({ ...BILET, rol: "katilimci" });
    ciz();
    await screen.findByTestId("zoom-kabi");
    act(() => oda.props!.onKarsiTaraf("bekleniyor"));
    expect(screen.getByText("Öğretmenin henüz derse katılmadı.")).toBeInTheDocument();
  });

  it("Dersten ayrıl → onay → yalnız ayrılır (bitirmez) ve ders sayfasına döner", async () => {
    ciz();
    await screen.findByTestId("zoom-kabi");

    fireEvent.click(screen.getByRole("button", { name: /Dersten ayrıl/ }));
    const pencere = screen.getByRole("dialog");
    expect(within(pencere).getByText(/karşı taraf için açık kalır/)).toBeInTheDocument();

    // Vazgeç: hiçbir şey olmaz.
    fireEvent.click(within(pencere).getByRole("button", { name: "Vazgeç" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(oda.ayril).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Dersten ayrıl/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Ayrıl" }));

    await waitFor(() => expect(tamSayfaGit).toHaveBeenCalledWith("/ders-talepleri/5"));
    expect(oda.ayril).toHaveBeenCalledTimes(1);
  });

  it("oturum kendiliğinden kapanırsa yeniden katılma seçeneği", async () => {
    ciz();
    await screen.findByTestId("zoom-kabi");
    act(() => oda.props!.onKapandi());
    expect(screen.getByText("Canlı dersle bağlantın kesildi")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yeniden katıl" })).toBeInTheDocument();
    // Oda sökülmez: görüşme kabı yerinde.
    expect(screen.getByTestId("zoom-kabi")).toBeInTheDocument();
  });

  it("son 5 dakikada sayaç, süre dolunca 'doldu' — oda açık kalır", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-09-24T14:56:30Z") });
    ciz();
    await screen.findByTestId("zoom-kabi");
    expect(screen.getByText("Ders 4 dk sonra bitiyor")).toBeInTheDocument();

    await act(async () => {
      vi.setSystemTime(new Date("2026-09-24T15:00:10Z"));
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.getByText("Ders süresi doldu")).toBeInTheDocument();
    expect(screen.getByTestId("zoom-kabi")).toBeInTheDocument();
  });
});
