// Tanıtım videosu — YouTube/Vimeo bağlantısını gömülü oynatıcı (iframe) URL'sine
// çevirir. Desteklenmeyen/parse edilemeyen bağlantıda null döner (oynatıcı gizlenir).
// Kabul edilen biçimler backend'deki `schemas.tutor.validate_intro_video_url`
// ile aynıdır; biri değişirse diğeri de değişir.
//
// Otomatik oynatma (Preply karşılaştırması, 21 Eyl 2026): sayfa açılır açılmaz
// sessiz oynar (`mute=1` ZORUNLU — tarayıcıların autoplay politikası sesli
// autoplay'i zaten engeller, mute olmadan `autoplay=1` sessizce hiçbir şey
// yapmaz). `playsinline=1` mobilde tam ekrana sıçramayı önler.
//
// Gizlilik: YouTube `youtube-nocookie.com`, Vimeo `dnt=1` ile gömülür. Bu
// izlemeyi azaltır ama sıfırlamaz; oynatıcıyı yalnız tıklamayla yüklemek ayrı
// bir karardır.
const YT_EMBED = "https://www.youtube-nocookie.com/embed/";
const YT_OTOMATIK = "autoplay=1&mute=1&playsinline=1&rel=0";
const YT_ELLE = "playsinline=1&rel=0";
const VIMEO_OTOMATIK = "autoplay=1&muted=1&dnt=1";
const VIMEO_ELLE = "dnt=1";

/**
 * `otomatik: false` — inceleme yüzeyleri (admin video onayı) için: yüklenen
 * MP4 gibi bağlantı da kendiliğinden oynamaz, sessiz de başlamaz.
 */
export function videoEmbedUrl(
  url?: string | null,
  { otomatik = true }: { otomatik?: boolean } = {}
): string | null {
  const ytParams = otomatik ? YT_OTOMATIK : YT_ELLE;
  const vimeoParams = otomatik ? VIMEO_OTOMATIK : VIMEO_ELLE;
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
    const parts = u.pathname.split("/").filter(Boolean);

    // YouTube: youtu.be/<id>, youtube.com/watch?v=<id> veya /embed/<id>
    if (host === "youtu.be") {
      const id = parts[0];
      return id ? `${YT_EMBED}${id}?${ytParams}` : null;
    }
    if (host === "youtube.com") {
      if (parts[0] === "embed") {
        return parts[1] ? `${YT_EMBED}${parts[1]}?${ytParams}` : null;
      }
      const id = u.searchParams.get("v");
      return id ? `${YT_EMBED}${id}?${ytParams}` : null;
    }

    // Vimeo: vimeo.com/<id>, gizli video için vimeo.com/<id>/<hash>
    if (host === "vimeo.com") {
      const [id, hash] = parts;
      if (!id || !/^\d+$/.test(id)) return null;
      const h = hash ? `h=${encodeURIComponent(hash)}&` : "";
      return `https://player.vimeo.com/video/${id}?${h}${vimeoParams}`;
    }
  } catch {
    return null;
  }
  return null;
}
