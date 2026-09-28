import { type ReactNode, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/AppIcon";
import { videoEmbedUrl } from "@/lib/video";
import type { IntroVideoPublic } from "@/types";

/**
 * Public profildeki tanıtım videosu — iki kaynak, tek bileşen.
 *
 * * Siteye yüklenen video (`intro_video`): yerel HTML5 `<video controls>`.
 *   Oynat/duraklat, ses, zaman çizgisi, tam ekran ve klavye (Boşluk, ←/→,
 *   ↑/↓, F, M) tarayıcının kendi erişilebilir kontrolleriyle gelir; ağır bir
 *   oynatıcı kütüphanesi gerekmez. Faststart MP4 + Range: oynatma ve atlama
 *   dosyanın tamamı inmeden başlar.
 *   YouTube embed'iyle AYNI davranış (kullanıcı kararı, 28 Eyl 2026): sayfa
 *   açılınca SESSİZ otomatik oynar (`autoplay` + `muted`; tarayıcılar sesli
 *   autoplay'i zaten engeller, `muted` olmadan hiç başlamaz), `playsInline`
 *   telefonda tam ekrana sıçramayı önler; kullanıcı sesi kontrollerden açar.
 *   `muted` React'te DOM özniteliği olarak yazılmadığından ref ile de
 *   `el.muted = true` verilir — aksi hâlde bazı tarayıcılar autoplay'i reddeder.
 *   Bu yalnız video değişince yapılır; her render'da yeniden susturmak,
 *   kullanıcının açtığı sesi sayfadaki başka bir etkileşimde kapatırdı.
 *   Sessiz oynarken üst köşede "Sesi aç" düğmesi görünür. Hareketi azaltma
 *   tercihi ya da veri tasarrufu açıksa otomatik oynatma yapılmaz, yalnız
 *   üst veri önden yüklenir. Dosya oynatılamazsa (ör. 404) bağlantı varsa
 *   iframe'e düşülür, yoksa bölüm hiç çizilmez.
 * * YouTube/Vimeo bağlantısı (`intro_video_url`): mevcut iframe davranışı
 *   (sessiz otomatik oynatma) AYNEN korunur — bkz. `lib/video.ts`.
 *
 * `bolum` verilirse çıktı bir `<section>` içinde döner. Profil sayfaları
 * bölüm kabuğunu kendileri çizmez: MP4 yüklenemeyip bağlantı da yoksa
 * bileşen null döner ve sayfada boş bir kabuk (ve `space-y` aralığı) kalmaz.
 *
 * Sunucu yalnız ACTIVE videoyu döndürür: işlenen/onay bekleyen yeni video
 * burada asla görünmez, eski video gösterilmeye devam eder.
 */
export function TanitimVideosu({
  video,
  linkUrl,
  ad,
  className = "",
  bolum = false,
}: {
  video?: IntroVideoPublic | null;
  linkUrl?: string | null;
  /** Eğitmenin görünen adı — oynatıcının erişilebilir adı için. */
  ad: string;
  className?: string;
  /** Çıktıyı `<section>` ile sar (gösterilecek bir şey yoksa hiçbiri çizilmez). */
  bolum?: boolean;
}) {
  const baslik = `${ad} tanıtım videosu`;
  const kabuk = `w-full overflow-hidden rounded-2xl bg-black shadow-sm ${className}`;
  const mp4Url = video?.mp4_url ?? null;

  const ref = useRef<HTMLVideoElement>(null);
  const [otomatikOynat] = useState(otomatikOynatmaUygun);
  // Hatalı URL'yi tutmak, mp4_url değişince hatanın kendiliğinden sıfırlanmasını sağlar.
  const [hataliUrl, setHataliUrl] = useState<string | null>(null);
  const [sessizOynuyor, setSessizOynuyor] = useState(false);
  const mp4Kullan = mp4Url !== null && hataliUrl !== mp4Url;
  const sar = (icerik: ReactNode) => (bolum ? <section>{icerik}</section> : icerik);

  useEffect(() => {
    if (ref.current) ref.current.muted = true;
  }, [mp4Url]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !mp4Kullan) return;
    const guncelle = () => setSessizOynuyor(!el.paused && (el.muted || el.volume === 0));
    guncelle();
    el.addEventListener("play", guncelle);
    el.addEventListener("pause", guncelle);
    el.addEventListener("volumechange", guncelle);
    return () => {
      el.removeEventListener("play", guncelle);
      el.removeEventListener("pause", guncelle);
      el.removeEventListener("volumechange", guncelle);
    };
  }, [mp4Url, mp4Kullan]);

  const sesiAc = () => {
    const el = ref.current;
    if (!el) return;
    el.muted = false;
    if (el.volume === 0) el.volume = 1;
    setSessizOynuyor(false);
  };

  if (video && mp4Url && mp4Kullan) {
    // Dikey/kare video için harf kutusu yerine kabuk oranı içeriğe uyar; oran
    // bilinmiyorsa 16:9. Yükseklik viewport'a göre sınırlı kalır.
    const oran =
      video.width && video.height ? `${video.width} / ${video.height}` : "16 / 9";
    return sar(
      <div
        className={`relative ${kabuk}`}
        style={{ aspectRatio: oran, maxHeight: "min(80vh, 40rem)" }}
      >
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- eğitmenin kendi tanıtım kaydı; altyazı dosyası üretilmiyor (V1). */}
        <video
          ref={ref}
          src={mp4Url}
          className="h-full w-full"
          controls
          autoPlay={otomatikOynat}
          muted
          playsInline
          preload={otomatikOynat ? "auto" : "metadata"}
          poster={video.poster_url ?? undefined}
          aria-label={baslik}
          controlsList="nodownload"
          onError={() => setHataliUrl(mp4Url)}
        >
          Tarayıcın video oynatmayı desteklemiyor.
        </video>
        {sessizOynuyor && (
          <button
            type="button"
            aria-label="Sesi aç"
            onClick={sesiAc}
            // Görünür hap 32px; görünmez `before` katmanı dokunma alanını 48px'e çıkarır.
            className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full before:absolute before:-inset-2 before:content-[''] bg-black/60 px-3 py-1.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          >
            <Icon name="speakerMute" className="h-4 w-4" />
            Sesi aç
          </button>
        )}
      </div>
    );
  }

  const embedUrl = videoEmbedUrl(linkUrl);
  if (!embedUrl) return null;
  return sar(
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

/** Hareketi azaltma ya da veri tasarrufu tercihi varken otomatik oynatma yapılmaz. */
function otomatikOynatmaUygun(): boolean {
  if (typeof window === "undefined") return true;
  const azHareket =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const veriTasarrufu =
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData ===
    true;
  return !azHareket && !veriTasarrufu;
}

/** Profilde gösterilecek bir video var mı (bölüm kabuğunu çizmek için)? */
export function tanitimVideosuVar(
  video?: IntroVideoPublic | null,
  linkUrl?: string | null
): boolean {
  return Boolean(video?.mp4_url) || videoEmbedUrl(linkUrl) !== null;
}
