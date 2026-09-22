// @vitest-environment node
import { describe, it, expect } from "vitest";
import { videoEmbedUrl } from "./video";

describe("videoEmbedUrl", () => {
  it("YouTube watch URL'ini otomatik-oynatan embed'e çevirir", () => {
    expect(videoEmbedUrl("https://www.youtube.com/watch?v=abc123")).toBe(
      "https://www.youtube.com/embed/abc123?autoplay=1&mute=1&playsinline=1&rel=0"
    );
  });

  it("youtu.be kısa bağlantısını çözer", () => {
    expect(videoEmbedUrl("https://youtu.be/xyz789")).toBe(
      "https://www.youtube.com/embed/xyz789?autoplay=1&mute=1&playsinline=1&rel=0"
    );
  });

  it("zaten embed olan YouTube bağlantısına otomatik oynatma parametrelerini ekler", () => {
    expect(videoEmbedUrl("https://www.youtube.com/embed/abc123")).toBe(
      "https://www.youtube.com/embed/abc123?autoplay=1&mute=1&playsinline=1&rel=0"
    );
  });

  it("Vimeo bağlantısını otomatik-oynatan player URL'sine çevirir", () => {
    expect(videoEmbedUrl("https://vimeo.com/123456789")).toBe(
      "https://player.vimeo.com/video/123456789?autoplay=1&muted=1"
    );
  });

  it("boş/desteklenmeyen bağlantıda null döner", () => {
    expect(videoEmbedUrl(null)).toBeNull();
    expect(videoEmbedUrl("")).toBeNull();
    expect(videoEmbedUrl("https://example.com/video")).toBeNull();
    expect(videoEmbedUrl("not-a-url")).toBeNull();
  });
});
