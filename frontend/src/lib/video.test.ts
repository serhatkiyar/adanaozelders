// @vitest-environment node
import { describe, it, expect } from "vitest";
import { videoEmbedUrl } from "./video";

describe("videoEmbedUrl", () => {
  it("YouTube watch URL'ini embed'e çevirir", () => {
    expect(videoEmbedUrl("https://www.youtube.com/watch?v=abc123")).toBe(
      "https://www.youtube.com/embed/abc123"
    );
  });

  it("youtu.be kısa bağlantısını çözer", () => {
    expect(videoEmbedUrl("https://youtu.be/xyz789")).toBe(
      "https://www.youtube.com/embed/xyz789"
    );
  });

  it("zaten embed olan YouTube bağlantısını korur", () => {
    expect(videoEmbedUrl("https://www.youtube.com/embed/abc123")).toBe(
      "https://www.youtube.com/embed/abc123"
    );
  });

  it("Vimeo bağlantısını player URL'sine çevirir", () => {
    expect(videoEmbedUrl("https://vimeo.com/123456789")).toBe(
      "https://player.vimeo.com/video/123456789"
    );
  });

  it("boş/desteklenmeyen bağlantıda null döner", () => {
    expect(videoEmbedUrl(null)).toBeNull();
    expect(videoEmbedUrl("")).toBeNull();
    expect(videoEmbedUrl("https://example.com/video")).toBeNull();
    expect(videoEmbedUrl("not-a-url")).toBeNull();
  });
});
