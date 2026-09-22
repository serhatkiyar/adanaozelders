// Tanıtım videosu — YouTube/Vimeo bağlantısını gömülü oynatıcı (iframe) URL'sine
// çevirir. Desteklenmeyen/parse edilemeyen bağlantıda null döner (oynatıcı gizlenir).
export function videoEmbedUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();

    // YouTube: youtu.be/<id> veya youtube.com/watch?v=<id> (ya da /embed/<id>)
    if (host === "youtu.be") {
      const id = u.pathname.slice(1);
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host === "youtube.com") {
      if (u.pathname.startsWith("/embed/")) return `https://www.youtube.com${u.pathname}`;
      const id = u.searchParams.get("v");
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }

    // Vimeo: vimeo.com/<id>
    if (host === "vimeo.com") {
      const id = u.pathname.replace(/^\/+/, "").split("/")[0];
      return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null;
    }
  } catch {
    return null;
  }
  return null;
}
