import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, type AxiosResponse } from "axios";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useToastStore } from "@/store/toastStore";
import { TutorStatus, type TutorIntroVideo, type TutorIntroVideoState, type TutorOut } from "@/types";

/* ── API sahtesi: yalnız ağ sınırı taklit edilir, bileşen ve hook gerçektir ── */

const api = vi.hoisted(() => ({
  fetchMyIntroVideo: vi.fn(),
  startIntroVideoUpload: vi.fn(),
  uploadToPresignedUrl: vi.fn(),
  completeIntroVideoUpload: vi.fn(),
  cancelIntroVideoUpload: vi.fn(),
  removeMyIntroVideo: vi.fn(),
}));
vi.mock("@/api/tutorVideo", () => api);

// Sayfa düzeyi test için sayfanın geri kalan veri kaynakları.
vi.mock("@/components/DashboardShell", () => ({
  DashboardShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ProfileCompleteness", () => ({ ProfileCompleteness: () => null }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ data: undefined }) }));
const ogretmen = {
  id: 7,
  first_name: "Ayşe",
  last_name: "Y",
  status: TutorStatus.APPROVED,
  intro_video_url: null,
  intro_video: null,
  subjects: [],
  availability: [],
} as unknown as TutorOut;
const profilGuncelle = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useTutorProfile", () => ({
  useMyTutorProfile: () => ({ data: ogretmen, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useTutorListingAction: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTutorProfile: () => ({ mutate: profilGuncelle, isPending: false }),
}));

import { VideoAlani } from "./VideoYukleme";
import TutorSettings from "@/pages/TutorSettings";

function kayit(ek: Partial<TutorIntroVideo>): TutorIntroVideo {
  return { id: 41, status: "REJECTED", kind: "UPLOAD", created_at: "", updated_at: "", ...ek };
}

function durum(ek: Partial<TutorIntroVideoState> = {}): TutorIntroVideoState {
  return {
    active: null,
    pending: null,
    link_url: null,
    uploads_enabled: true,
    max_bytes: 300 * 1024 * 1024,
    max_seconds: 130,
    min_seconds: 30,
    min_short_side: 360,
    require_review: true,
    ...ek,
  };
}

function sarmala(ui: ReactNode, yol = "/") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[yol]}>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

function hata503() {
  return new AxiosError("Service Unavailable", "ERR_BAD_RESPONSE", undefined, undefined, {
    status: 503,
    data: {},
  } as AxiosResponse);
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  profilGuncelle.mockReset();
  api.cancelIntroVideoUpload.mockResolvedValue(undefined);
});

describe("VideoAlani", () => {
  it("reddedilen kayıt kartı dururken dosya yükleme de görünür; kart kamerayı açmaz", async () => {
    api.fetchMyIntroVideo.mockResolvedValue(
      durum({ pending: kayit({ status: "REJECTED", review_note: "Ses duyulmuyor" }) })
    );
    sarmala(<VideoAlani tutor={ogretmen} acik />);
    expect(await screen.findByText("Gerekçe: Ses duyulmuyor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dosya yükle" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Başka video seç" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Kapat" }));
    expect(screen.queryByText("Kamerayı aç")).toBeNull();
    expect(screen.queryByText(/kamerayla kaydı desteklemiyor/)).toBeNull();
  });

  it("503 sonrası 'Aynı videoyu yeniden dene' aynı dosyayla yeni init atar", async () => {
    api.fetchMyIntroVideo.mockResolvedValue(durum());
    api.startIntroVideoUpload.mockRejectedValueOnce(hata503()).mockRejectedValueOnce(hata503());
    sarmala(<VideoAlani tutor={ogretmen} acik />);
    await screen.findByRole("button", { name: "Dosya yükle" });
    const dosya = new File(["x"], "tanitim.mp4", { type: "video/mp4" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Tanıtım videosu dosyası"), { target: { files: [dosya] } });
    });
    const dene = await screen.findByRole("button", { name: "Aynı videoyu yeniden dene" });
    await act(async () => {
      fireEvent.click(dene);
    });
    await waitFor(() => expect(api.startIntroVideoUpload).toHaveBeenCalledTimes(2));
    expect(api.startIntroVideoUpload.mock.calls[1][0]).toBe(dosya);
  });

  it("ön kontrol reddinde yeniden deneme düğmesi yok", async () => {
    api.fetchMyIntroVideo.mockResolvedValue(durum());
    sarmala(<VideoAlani tutor={ogretmen} acik />);
    await screen.findByRole("button", { name: "Dosya yükle" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Tanıtım videosu dosyası"), {
        target: { files: [new File(["x"], "resim.png", { type: "image/png" })] },
      });
    });
    expect(await screen.findByText(/Yalnızca video dosyası/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aynı videoyu yeniden dene" })).toBeNull();
    expect(api.startIntroVideoUpload).not.toHaveBeenCalled();
  });

  it("videoyu kaldırmak onay ister; onaylanmadan istek gitmez", async () => {
    api.fetchMyIntroVideo.mockResolvedValue(
      durum({ active: kayit({ status: "ACTIVE", mp4_url: "https://cdn/v.mp4", duration_seconds: 60 }) })
    );
    api.removeMyIntroVideo.mockResolvedValue(undefined);
    sarmala(<VideoAlani tutor={ogretmen} acik />);
    fireEvent.click(await screen.findByRole("button", { name: "Videoyu kaldır" }));
    const pencere = await screen.findByRole("dialog");
    expect(pencere).toHaveTextContent(/yeniden yükleyip onay beklemen gerekir/);
    expect(api.removeMyIntroVideo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(api.removeMyIntroVideo).not.toHaveBeenCalled();
  });

  it("bayat PENDING_UPLOAD yarım kaldığını söyler ve iptal edip yeniden yükletir", async () => {
    api.fetchMyIntroVideo.mockResolvedValue(durum({ pending: kayit({ id: 9, status: "PENDING_UPLOAD" }) }));
    sarmala(<VideoAlani tutor={ogretmen} acik />);
    fireEvent.click(await screen.findByRole("button", { name: "İptal et ve yeniden yükle" }));
    await waitFor(() => expect(api.cancelIntroVideoUpload).toHaveBeenCalledWith(9));
    expect(screen.queryByRole("button", { name: "Yüklemeyi iptal et" })).toBeNull();
  });
});

describe("VideoAlani — bağlantı ön onayı", () => {
  const LINK = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

  it("onay bekleyen bağlantı önizlenir, yayındaki video yerinde kalır ve geri çekilebilir", async () => {
    api.fetchMyIntroVideo.mockResolvedValue(
      durum({
        active: kayit({ id: 5, status: "ACTIVE", mp4_url: "https://cdn/v.mp4", duration_seconds: 60 }),
        pending: kayit({ id: 12, status: "PENDING_REVIEW", kind: "LINK", link_url: LINK }),
      })
    );
    sarmala(<VideoAlani tutor={ogretmen} acik />);
    expect(await screen.findByText("Bağlantı onay bekliyor")).toBeInTheDocument();
    expect(screen.getByText(/Şu anki videon bu sırada yayında kalır/)).toBeInTheDocument();
    expect(screen.getByTitle("Onay bekleyen video bağlantın")).toHaveAttribute(
      "src",
      expect.stringContaining("youtube-nocookie.com/embed/dQw4w9WgXcQ")
    );
    expect(screen.getByText("Profilinde yayında")).toBeInTheDocument();
    // Bekleyen bağlantı yeni video eklemeyi engellemez (sunucu onu yenisiyle değiştirir).
    expect(screen.getByRole("button", { name: "Dosya yükle" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Onaydan geri çek" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(/bağlantı geri çekilecek/);
    expect(api.cancelIntroVideoUpload).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Onaydan geri çek" }).at(-1)!);
    await waitFor(() => expect(api.cancelIntroVideoUpload).toHaveBeenCalledWith(12));
  });

  it("bekleyen bağlantı varken kayda/dosyaya başlamak önce onay ister", async () => {
    api.fetchMyIntroVideo.mockResolvedValue(
      durum({ pending: kayit({ id: 12, status: "PENDING_REVIEW", kind: "LINK", link_url: LINK }) })
    );
    const tikla = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    try {
      sarmala(<VideoAlani tutor={ogretmen} acik />);
      await screen.findByText("Bağlantı onay bekliyor");

      // Kamera: Vazgeç hiçbir şeyi değiştirmez; onay kayıt görünümünü açar.
      fireEvent.click(screen.getByRole("button", { name: "Kamerayla kaydet" }));
      expect(await screen.findByRole("dialog")).toHaveTextContent(/Onay bekleyen bağlantın geri çekilecek/);
      expect(screen.queryByText("Kamerayı aç")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(screen.queryByText("Kamerayı aç")).toBeNull();
      expect(api.cancelIntroVideoUpload).not.toHaveBeenCalled();

      // Dosya: onay dosya seçiciyi aynı tıklamada açar.
      fireEvent.click(screen.getByRole("button", { name: "Dosya yükle" }));
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(tikla).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Devam et, dosya seç" }));
      expect(tikla).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

      fireEvent.click(screen.getByRole("button", { name: "Kamerayla kaydet" }));
      fireEvent.click(await screen.findByRole("button", { name: "Devam et, kaydet" }));
      await waitFor(() => expect(screen.queryByRole("button", { name: "Kamerayla kaydet" })).toBeNull());
      expect(api.startIntroVideoUpload).not.toHaveBeenCalled();
    } finally {
      tikla.mockRestore();
    }
  });

  it("bekleyen bağlantı yoksa (reddedilmiş bağlantı dahil) onay sorulmaz", async () => {
    api.fetchMyIntroVideo.mockResolvedValue(
      durum({ pending: kayit({ status: "REJECTED", kind: "LINK", link_url: LINK, review_note: "x" }) })
    );
    const tikla = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    try {
      sarmala(<VideoAlani tutor={ogretmen} acik />);
      fireEvent.click(await screen.findByRole("button", { name: "Dosya yükle" }));
      expect(tikla).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      tikla.mockRestore();
    }
  });

  it("reddedilen bağlantı gerekçesiyle görünür", async () => {
    api.fetchMyIntroVideo.mockResolvedValue(
      durum({ pending: kayit({ status: "REJECTED", kind: "LINK", link_url: LINK, review_note: "Başka biri anlatıyor" }) })
    );
    sarmala(<VideoAlani tutor={ogretmen} acik />);
    expect(await screen.findByText("Bağlantı onaylanmadı")).toBeInTheDocument();
    expect(screen.getByText("Gerekçe: Başka biri anlatıyor")).toBeInTheDocument();
    expect(screen.queryByTitle("Onay bekleyen video bağlantın")).toBeNull();
  });

  it("bağlantı kaydı yüklenmiş videoyu kaldırma onayı sormadan onaya gönderilir", async () => {
    const eski = ogretmen.intro_video;
    (ogretmen as { intro_video: unknown }).intro_video = { kind: "upload", mp4_url: "https://cdn/v.mp4" };
    try {
      api.fetchMyIntroVideo.mockResolvedValue(
        durum({ active: kayit({ id: 5, status: "ACTIVE", mp4_url: "https://cdn/v.mp4" }) })
      );
      sarmala(<TutorSettings />, "/?bolum=video");
      fireEvent.click(await screen.findByRole("button", { name: "Bağlantı yerleştir" }));
      fireEvent.change(screen.getByLabelText("Video bağlantısı"), { target: { value: ` ${LINK} ` } });
      fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(profilGuncelle).toHaveBeenCalledTimes(1);
      expect(profilGuncelle.mock.calls[0][0]).toEqual({ intro_video_url: LINK });
    } finally {
      (ogretmen as { intro_video: unknown }).intro_video = eski;
    }
  });

  it("yalnız onay bekleyen bağlantı varken boş kayıt 'kaldırıldı' demez, sunucuya gitmez", async () => {
    profilGuncelle.mockClear();
    useToastStore.setState({ toasts: [] });
    api.fetchMyIntroVideo.mockResolvedValue(
      durum({ pending: kayit({ status: "PENDING_REVIEW", kind: "LINK", link_url: LINK }) })
    );
    sarmala(<TutorSettings />, "/?bolum=video");
    fireEvent.click(await screen.findByRole("button", { name: "Bağlantı yerleştir" }));
    await screen.findByTitle("Onay bekleyen video bağlantın");
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(profilGuncelle).not.toHaveBeenCalled();
    const mesajlar = useToastStore.getState().toasts.map((t) => t.message);
    expect(mesajlar).toEqual([
      "Onay bekleyen bağlantın yerinde duruyor. Geri çekmek için “Onaydan geri çek”i kullan.",
    ]);
  });

  it("geçersiz bağlantı sunucuya gitmez; hata alanın altında söylenir", async () => {
    profilGuncelle.mockClear();
    api.fetchMyIntroVideo.mockResolvedValue(durum());
    sarmala(<TutorSettings />, "/?bolum=video");
    fireEvent.click(await screen.findByRole("button", { name: "Bağlantı yerleştir" }));
    // Videosuz öğretmene "yayında kalır / kaldırılır" denmez.
    expect(screen.getByText("Bağlantın kısa bir kontrolden sonra profilinde yayına girer.")).toBeInTheDocument();
    const girdi = screen.getByLabelText("Video bağlantısı");
    fireEvent.change(girdi, { target: { value: "https://example.com/video" } });
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(profilGuncelle).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Yalnızca YouTube veya Vimeo bağlantısı desteklenir.");
    expect(girdi).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(girdi, { target: { value: "https://example.com/v" } });
    expect(girdi).not.toHaveAttribute("aria-invalid");
  });
});

describe("Profilim → Video gezinme koruması", () => {
  it("kamera kaydı açıkken başka bölüme geçmek onay ister", async () => {
    api.fetchMyIntroVideo.mockResolvedValue(durum());
    sarmala(<TutorSettings />, "/?bolum=video");
    fireEvent.click(await screen.findByRole("button", { name: "Kamerayla kaydet" }));
    const bolumler = screen.getByRole("navigation", { name: "Profil bölümleri" });
    const digerBolum = bolumler.querySelector("button:not([aria-current])") as HTMLButtonElement;
    fireEvent.click(digerBolum);
    expect(await screen.findByRole("dialog")).toHaveTextContent(/Bölümden ayrılınsın mı/);
    // Vazgeçince bölüm değişmez.
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(screen.getByRole("button", { name: /Dosya yüklemeye dön|Kamerayı aç/ })).toBeInTheDocument();
  });
});
