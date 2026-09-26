/**
 * Canlı ders (Zoom) sayfası — kapı hataları, oda yerleşimi ve çıkış akışı.
 * Üst şerit yok (Meet): Ayrıl ve Sohbet odanın kontrol çubuğunda; sayfa
 * yalnız onaylı çıkış penceresini ve sahne üstü haplarını verir.
 *
 * jsdom Zoom SDK'sını yükleyemez: sürücü yükleyicisi (`video/yukle`) ve
 * `CanliOda` taklit edilir; taklit aldığı geri çağrıları dışarı verir ki
 * karşı taraf/kopma olayları sürülebilsin.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBooking, getCanliDersBileti } from "@/api/bookings";
import type { CanliOdaProps, CanliOdaTutamak } from "@/components/canli/CanliOda";
import { tamSayfaGit } from "@/lib/tamSayfaGezinme";
import { PATHS } from "@/lib/routes";
import CanliDers from "@/pages/CanliDers";
import type { BookingOut, CanliDersBiletiOut, ZoomDersTokenOut } from "@/types";

const oda = vi.hoisted(() => ({
  props: null as CanliOdaProps | null,
  ayril: vi.fn(async () => {}),
  kurulum: 0,
}));

vi.mock("@/components/canli/video/yukle", () => ({
  yukle: vi.fn(async () => ({
    oturumdaMi: () => false,
    destekler: { arkaPlan: async () => false },
  })),
}));
vi.mock("@/components/canli/CanliOda", () => ({
  default: forwardRef<CanliOdaTutamak, CanliOdaProps>(function SahteOda(props, ref) {
    oda.props = props;
    useImperativeHandle(ref, () => ({ ayril: oda.ayril }), []);
    return (
      <div data-testid="zoom-kabi">
        <div data-testid="sahne-ustu">{props.sahneUstu}</div>
      </div>
    );
  }),
}));
vi.mock("@/api/bookings", async (asil) => ({
  ...((await asil()) as object),
  fetchBooking: vi.fn(),
  getCanliDersBileti: vi.fn(),
}));
vi.mock("@/lib/tamSayfaGezinme", () => ({ tamSayfaGit: vi.fn() }));

const BILET: ZoomDersTokenOut = {
  token: "jwt",
  oturum_adi: "adana-5-abc",
  kullanici_adi: "Ayşe",
  rol: "host",
  expires_at: "2026-09-24T16:00:00Z",
};

/** `/canli-ders-bileti` yanıtı: sağlayıcı Zoom, yalnız `zoom` dolu. */
const zoomBileti = (zoom: ZoomDersTokenOut): CanliDersBiletiOut => ({
  saglayici: "zoom",
  zoom,
  agora: null,
});

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
  vi.mocked(getCanliDersBileti).mockResolvedValue(zoomBileti(BILET));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CanliDers — giriş kapıları", () => {
  it("402: ödeme metni, dönüş ders sayfasına TAM SAYFA", async () => {
    vi.mocked(getCanliDersBileti).mockRejectedValue(hataYaniti(402, "Ders ücreti…"));
    ciz();

    expect(await screen.findByText("Canlı derse girilemedi")).toBeInTheDocument();
    expect(screen.getByText(/ödenmeden canlı derse katılınamaz/)).toBeInTheDocument();
    expect(screen.queryByTestId("zoom-kabi")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ders sayfasına dön" }));
    expect(tamSayfaGit).toHaveBeenCalledWith("/ders-talepleri/5");
  });

  it("409: sunucunun nedeni gösterilir", async () => {
    vi.mocked(getCanliDersBileti).mockRejectedValue(
      hataYaniti(409, "Canlı ders yalnız ders saatinde açıktır."),
    );
    ciz();
    expect(
      await screen.findByText("Canlı ders yalnız ders saatinde açıktır."),
    ).toBeInTheDocument();
  });

  it("503: altyapı metni ve yeniden deneme", async () => {
    vi.mocked(getCanliDersBileti).mockRejectedValue(hataYaniti(503));
    ciz();
    expect(await screen.findByText(/altyapısı şu an kullanılamıyor/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yeniden dene" })).toBeInTheDocument();
  });

  it("geçersiz adres sunucuya sorulmadan reddedilir", () => {
    ciz("/canli-ders/abc");
    expect(screen.getByText("Ders bulunamadı.")).toBeInTheDocument();
    expect(getCanliDersBileti).not.toHaveBeenCalled();
  });
});

describe("CanliDers — oda", () => {
  it("bilet gelince oda sunucunun verdiği biletle (nötr biçimde) kurulur; üst şerit yok", async () => {
    ciz();
    expect(await screen.findByTestId("zoom-kabi")).toBeInTheDocument();
    expect(oda.props?.bilet).toEqual({
      saglayici: "zoom",
      rol: "ogretmen",
      ad: "Ayşe",
      bitis: BILET.expires_at,
      karsi: null,
      ham: BILET,
    });
    // Ayrıl ve Sohbet yalnız odanın kontrol çubuğunda (Meet): sayfada ikinci
    // bir ayrıl/mesajlar düğmesi ya da başlık yok.
    expect(screen.queryByText("Canlı ders · Mehmet")).toBeNull();
    expect(screen.queryByRole("button", { name: /Dersten ayrıl/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Mesajlar|Sohbet/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Mesajlar/ })).toBeNull();
    expect(screen.queryByRole("banner")).toBeNull();
  });

  it("ders içi sohbet odaya karşı tarafın genel konuşmasıyla verilir", async () => {
    ciz();
    await screen.findByTestId("zoom-kabi");
    await waitFor(() =>
      expect(oda.props?.sohbet).toMatchObject({
        karsiTarafId: 20,
        karsiTarafRol: "CLIENT",
        karsiTarafAd: "Mehmet",
        benimRolum: "TUTOR",
      }),
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
    vi.mocked(getCanliDersBileti).mockResolvedValue(zoomBileti({ ...BILET, rol: "katilimci" }));
    ciz();
    await screen.findByTestId("zoom-kabi");
    act(() => oda.props!.onKarsiTaraf("bekleniyor"));
    expect(screen.getByText("Öğretmenin henüz derse katılmadı.")).toBeInTheDocument();
  });

  it("çubuktaki Ayrıl → onay → yalnız ayrılır (bitirmez) ve ders sayfasına döner", async () => {
    ciz();
    await screen.findByTestId("zoom-kabi");

    // Kontrol çubuğundaki kırmızı Ayrıl (oda taklit edildi: geri çağrısı sürülür).
    act(() => oda.props!.onAyrilIstegi?.());
    const pencere = screen.getByRole("dialog");
    expect(within(pencere).getByText(/karşı taraf için açık kalır/)).toBeInTheDocument();

    // Vazgeç: hiçbir şey olmaz.
    fireEvent.click(within(pencere).getByRole("button", { name: "Vazgeç" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(oda.ayril).not.toHaveBeenCalled();

    act(() => oda.props!.onAyrilIstegi?.());
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
