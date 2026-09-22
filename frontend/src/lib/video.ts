// Tanıtım videosu — YouTube/Vimeo bağlantısını gömülü oynatıcı (iframe) URL'sine
// çevirir. Desteklenmeyen/parse edilemeyen bağlantıda null döner (oynatıcı gizlenir).
//
// Otomatik oynatma (Preply karşılaştırması, 21 Eyl 2026): sayfa açılır açılmaz
// sessiz oynar (`mute=1` ZORUNLU — tarayıcıların autoplay politikası sesli
// autoplay'i zaten engeller, mute olmadan `autoplay=1` sessizce hiçbir şey
// yapmaz). `playsinline=1` mobilde tam ekrana sıçramayı önler.
const YT_PARAMS = "autoplay=1&mute=1&playsinline=1&rel=0";
const VIMEO_PARAMS = "autoplay=1&muted=1";

export function videoEmbedUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();

    // YouTube: youtu.be/<id> veya youtube.com/watch?v=<id> (ya da /embed/<id>)
    if (host === "youtu.be") {
      const id = u.pathname.slice(1);
      return id ? `https://www.youtube.com/embed/${id}?${YT_PARAMS}` : null;
    }
    if (host === "youtube.com") {
      if (u.pathname.startsWith("/embed/")) {
        return `https://www.youtube.com${u.pathname}?${YT_PARAMS}`;
      }
      const id = u.searchParams.get("v");
      return id ? `https://www.youtube.com/embed/${id}?${YT_PARAMS}` : null;
    }

    // Vimeo: vimeo.com/<id>
    if (host === "vimeo.com") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      return id && /^\d+$/.test(id)
        ? `https://player.vimeo.com/video/${id}?${VIMEO_PARAMS}`
        : null;
    }
  } catch {
    return null;
  }
  return null;
}
