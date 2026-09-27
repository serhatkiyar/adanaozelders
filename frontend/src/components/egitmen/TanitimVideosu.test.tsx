import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TanitimVideosu, tanitimVideosuVar } from "./TanitimVideosu";

const yuklenen = {
  kind: "upload" as const,
  mp4_url: "https://cdn.test/tutor-videos/a.mp4",
  poster_url: "https://cdn.test/tutor-videos/a.jpg",
  width: 1280,
  height: 720,
  duration_seconds: 61,
};

describe("TanitimVideosu", () => {
  it("yüklenen video: yerel oynatıcı, kontroller, otomatik oynatma YOK, hafif ön yükleme", () => {
    render(<TanitimVideosu video={yuklenen} linkUrl={null} ad="Ayşe" />);
    const v = screen.getByLabelText("Ayşe tanıtım videosu") as HTMLVideoElement;
    expect(v.tagName).toBe("VIDEO");
    expect(v).toHaveAttribute("controls");
    expect(v).toHaveAttribute("playsinline");
    expect(v).toHaveAttribute("preload", "metadata");
    expect(v).toHaveAttribute("poster", yuklenen.poster_url);
    expect(v).not.toHaveAttribute("autoplay");
    expect(v.querySelector("source")).toHaveAttribute("src", yuklenen.mp4_url);
    expect(screen.queryByTitle("Ayşe tanıtım videosu")).toBeNull(); // iframe yok
  });

  it("yüklenen video varsa bağlantı yok sayılır (tek kaynak)", () => {
    render(<TanitimVideosu video={yuklenen} linkUrl="https://youtu.be/abc" ad="Ayşe" />);
    expect(screen.getByLabelText("Ayşe tanıtım videosu").tagName).toBe("VIDEO");
  });

  it("YouTube bağlantısı: mevcut iframe davranışı korunur", () => {
    render(<TanitimVideosu video={null} linkUrl="https://youtu.be/abc" ad="Ayşe" />);
    const f = screen.getByTitle("Ayşe tanıtım videosu");
    expect(f.tagName).toBe("IFRAME");
    expect(f).toHaveAttribute("src", expect.stringContaining("youtube.com/embed/abc"));
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
