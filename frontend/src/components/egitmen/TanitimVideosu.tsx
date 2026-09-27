import { videoEmbedUrl } from "@/lib/video";
import type { IntroVideoPublic } from "@/types";

/**
 * Public profildeki tanıtım videosu — iki kaynak, tek bileşen.
 *
 * * Siteye yüklenen video (`intro_video`): yerel HTML5 `<video controls>`.
 *   Oynat/duraklat, ses, zaman çizgisi, tam ekran ve klavye (Boşluk, ←/→,
 *   ↑/↓, F, M) tarayıcının kendi erişilebilir kontrolleriyle gelir; ağır bir
 *   oynatıcı kütüphanesi gerekmez. `preload="metadata"` + faststart MP4:
 *   sayfa açılınca yalnız ilk baytlar iner, oynatma/atlama Range ile sürer.
 *   Otomatik oynatma YOK; `playsInline` telefonda tam ekrana sıçramayı önler.
 * * YouTube/Vimeo bağlantısı (`intro_video_url`): mevcut iframe davranışı
 *   (sessiz otomatik oynatma) AYNEN korunur — bkz. `lib/video.ts`.
 *
 * Sunucu yalnız ACTIVE videoyu döndürür: işlenen/onay bekleyen yeni video
 * burada asla görünmez, eski video gösterilmeye devam eder.
 */
export function TanitimVideosu({
  video,
  linkUrl,
  ad,
  className = "",
}: {
  video?: IntroVideoPublic | null;
  linkUrl?: string | null;
  /** Eğitmenin görünen adı — oynatıcının erişilebilir adı için. */
  ad: string;
  className?: string;
}) {
  const baslik = `${ad} tanıtım videosu`;
  const kabuk = `w-full overflow-hidden rounded-2xl bg-black shadow-sm ${className}`;

  if (video?.mp4_url) {
    // Dikey/kare video için harf kutusu yerine kabuk oranı içeriğe uyar; oran
    // bilinmiyorsa 16:9. Yükseklik viewport'a göre sınırlı kalır.
    const oran =
      video.width && video.height ? `${video.width} / ${video.height}` : "16 / 9";
    return (
      <div className={kabuk} style={{ aspectRatio: oran, maxHeight: "min(80vh, 40rem)" }}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- eğitmenin kendi tanıtım kaydı; altyazı dosyası üretilmiyor (V1). */}
        <video
          className="h-full w-full"
          controls
          playsInline
          preload="metadata"
          poster={video.poster_url ?? undefined}
          aria-label={baslik}
          controlsList="nodownload"
        >
          <source src={video.mp4_url} type="video/mp4" />
          Tarayıcın video oynatmayı desteklemiyor.
        </video>
      </div>
    );
  }

  const embedUrl = videoEmbedUrl(linkUrl);
  if (!embedUrl) return null;
  return (
    <div className={`aspect-video ${kabuk}`}>
      <iframe
        src={embedUrl}
        title={baslik}
        className="h-full w-full border-0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

/** Profilde gösterilecek bir video var mı (bölüm kabuğunu çizmek için)? */
export function tanitimVideosuVar(
  video?: IntroVideoPublic | null,
  linkUrl?: string | null
): boolean {
  return Boolean(video?.mp4_url) || videoEmbedUrl(linkUrl) !== null;
}
