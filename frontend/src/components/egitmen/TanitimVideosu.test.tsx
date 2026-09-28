import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TanitimVideosu, tanitimVideosuVar } from "./TanitimVideosu";

const yuklenen = {
  kind: "upload" as const,
  mp4_url: "https://cdn.test/tutor-videos/a.mp4",
  poster_url: "https://cdn.test/tutor-videos/a.jpg",
  width: 1280,
  height: 720,
  duration_seconds: 61,
};

const videoAl = () => screen.getByLabelText("Ayşe tanıtım videosu") as HTMLVideoElement;

describe("TanitimVideosu", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("yüklenen video: yerel oynatıcı, kontroller, YouTube gibi SESSİZ otomatik oynatma", () => {
    render(<TanitimVideosu video={yuklenen} linkUrl={null} ad="Ayşe" />);
    const v = screen.getByLabelText("Ayşe tanıtım videosu") as HTMLVideoElement;
    expect(v.tagName).toBe("VIDEO");
    expect(v).toHaveAttribute("controls");
    expect(v).toHaveAttribute("playsinline");
    expect(v).toHaveAttribute("poster", yuklenen.poster_url);
    // Sessiz autoplay: `autoplay` özniteliği + `muted` özelliği (ref ile de
    // yazılır; muted olmadan tarayıcılar otomatik oynatmayı reddeder).
    expect(v).toHaveAttribute("autoplay");
    expect(v.muted).toBe(true);
    expect(v).toHaveAttribute("preload", "auto");
    // `<source>` yerine `src`: hata `<video>`nun kendi onError'ına düşer.
    expect(v).toHaveAttribute("src", yuklenen.mp4_url);
    expect(screen.queryByTitle("Ayşe tanıtım videosu")).toBeNull(); // iframe yok
  });

  it("kullanıcının açtığı ses yeniden render'da kapanmaz", () => {
    const { rerender } = render(<TanitimVideosu video={yuklenen} linkUrl={null} ad="Ayşe" />);
    videoAl().muted = false;
    rerender(<TanitimVideosu video={yuklenen} linkUrl={null} ad="Ayşe" />);
    expect(videoAl().muted).toBe(false);
  });

  it("sessiz oynarken 'Sesi aç' düğmesi sesi açar ve kaybolur", () => {
    render(<TanitimVideosu video={yuklenen} linkUrl={null} ad="Ayşe" />);
    const v = videoAl();
    // Duraklatılmışken (otomatik oynatma engellendi) düğme yok.
    expect(screen.queryByRole("button", { name: "Sesi aç" })).toBeNull();
    Object.defineProperty(v, "paused", { configurable: true, value: false });
    fireEvent.play(v);
    fireEvent.click(screen.getByRole("button", { name: "Sesi aç" }));
    expect(v.muted).toBe(false);
    expect(screen.queryByRole("button", { name: "Sesi aç" })).toBeNull();
  });

  it("hareketi azaltma tercihinde otomatik oynatmaz, yalnız üst veriyi yükler", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    );
    render(<TanitimVideosu video={yuklenen} linkUrl={null} ad="Ayşe" />);
    const v = videoAl();
    expect(v).not.toHaveAttribute("autoplay");
    expect(v).toHaveAttribute("preload", "metadata");
    expect(v).toHaveAttribute("controls");
    expect(v).toHaveAttribute("poster", yuklenen.poster_url);
    expect(v.muted).toBe(true);
  });

  it("MP4 oynatılamazsa bağlantıya düşer; bağlantı yoksa hiçbir şey çizmez", () => {
    const { container, rerender } = render(
      <TanitimVideosu video={yuklenen} linkUrl="https://youtu.be/abc" ad="Ayşe" />
    );
    fireEvent.error(videoAl());
    expect(screen.getByTitle("Ayşe tanıtım videosu").tagName).toBe("IFRAME");

    rerender(<TanitimVideosu video={yuklenen} linkUrl={null} ad="Ayşe" />);
    expect(container).toBeEmptyDOMElement();

    // Yeni video gelince hata sıfırlanır.
    const yeni = { ...yuklenen, mp4_url: "https://cdn.test/tutor-videos/b.mp4" };
    rerender(<TanitimVideosu video={yeni} linkUrl={null} ad="Ayşe" />);
    expect(videoAl()).toHaveAttribute("src", yeni.mp4_url);
  });

  it("bolum: <section> ile sarar; MP4 yüklenemez ve bağlantı yoksa boş kabuk bırakmaz", () => {
    const { container, rerender } = render(
      <TanitimVideosu bolum video={yuklenen} linkUrl={null} ad="Ayşe" />
    );
    expect(container.firstElementChild?.tagName).toBe("SECTION");
    fireEvent.error(videoAl());
    expect(container).toBeEmptyDOMElement();

    // Bağlantı varsa iframe yine bölüm içinde.
    rerender(<TanitimVideosu bolum video={yuklenen} linkUrl="https://youtu.be/abc" ad="Ayşe" />);
    expect(container.firstElementChild?.tagName).toBe("SECTION");
    expect(screen.getByTitle("Ayşe tanıtım videosu").tagName).toBe("IFRAME");
  });

  it("yüklenen video varsa bağlantı yok sayılır (tek kaynak)", () => {
    render(<TanitimVideosu video={yuklenen} linkUrl="https://youtu.be/abc" ad="Ayşe" />);
    expect(screen.getByLabelText("Ayşe tanıtım videosu").tagName).toBe("VIDEO");
  });

  it("YouTube bağlantısı: mevcut iframe davranışı korunur", () => {
    render(<TanitimVideosu video={null} linkUrl="https://youtu.be/abc" ad="Ayşe" />);
    const f = screen.getByTitle("Ayşe tanıtım videosu");
    expect(f.tagName).toBe("IFRAME");
    expect(f).toHaveAttribute("src", expect.stringContaining("/embed/abc"));
  });

  it("ikisi de yoksa hiçbir şey çizmez", () => {
    const { container } = render(<TanitimVideosu video={null} linkUrl={null} ad="Ayşe" />);
    expect(container).toBeEmptyDOMElement();
    expect(tanitimVideosuVar(null, null)).toBe(false);
    expect(tanitimVideosuVar(yuklenen, null)).toBe(true);
    expect(tanitimVideosuVar(null, "https://youtu.be/abc")).toBe(true);
    expect(tanitimVideosuVar(null, "https://kotu.site/x")).toBe(false);
  });
});
