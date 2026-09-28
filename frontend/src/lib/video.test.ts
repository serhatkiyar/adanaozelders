// @vitest-environment node
import { describe, it, expect } from "vitest";
import { videoEmbedUrl } from "./video";

// Örnekler `backend/tests/test_intro_video_url.py` ile aynı tutulur.
const YT = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1&playsinline=1&rel=0";
const VIMEO_PARAMS = "autoplay=1&muted=1&dnt=1";

describe("videoEmbedUrl", () => {
  it.each([
    "https://youtu.be/dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
  ])("%s → nocookie embed, otomatik sessiz oynatma", (url) => {
    expect(videoEmbedUrl(url)).toBe(YT);
  });

  it.each(["https://vimeo.com/123456789", "https://www.vimeo.com/123456789"])(
    "%s → dnt=1 ile Vimeo player",
    (url) => {
      expect(videoEmbedUrl(url)).toBe(`https://player.vimeo.com/video/123456789?${VIMEO_PARAMS}`);
    }
  );

  it("Vimeo gizli video hash'ini h= parametresine taşır", () => {
    expect(videoEmbedUrl("https://vimeo.com/123456789/abcdef1234")).toBe(
      `https://player.vimeo.com/video/123456789?h=abcdef1234&${VIMEO_PARAMS}`
    );
  });

  it("boş/desteklenmeyen bağlantıda null döner", () => {
    expect(videoEmbedUrl(null)).toBeNull();
    expect(videoEmbedUrl("")).toBeNull();
    expect(videoEmbedUrl("https://example.com/video")).toBeNull();
    expect(videoEmbedUrl("not-a-url")).toBeNull();
    expect(videoEmbedUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBeNull();
    expect(videoEmbedUrl("https://www.youtube.com/@kanal")).toBeNull();
    expect(videoEmbedUrl("https://youtu.be/")).toBeNull();
    expect(videoEmbedUrl("https://vimeo.com/kanal")).toBeNull();
  });

  it("inceleme için otomatik oynatmasız gömme verir", () => {
    expect(videoEmbedUrl("https://youtu.be/dQw4w9WgXcQ", { otomatik: false })).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1&rel=0"
    );
    expect(videoEmbedUrl("https://vimeo.com/123456789", { otomatik: false })).toBe(
      "https://player.vimeo.com/video/123456789?dnt=1"
    );
  });
});
