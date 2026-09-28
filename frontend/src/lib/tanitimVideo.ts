// Tanıtım videosu yükleme — saf yardımcılar (pytest'li backend sınırlarının
// istemci aynası; asıl doğrulama sunucuda ve worker'da ffprobe ile yapılır).
import type { TutorIntroVideoStatus } from "@/types";

/** Yolda sayılan durumlar: eğitmen bu sırada yeni yükleme başlatamaz. */
export const YOLDA_DURUMLAR: ReadonlySet<TutorIntroVideoStatus> = new Set([
  "PENDING_UPLOAD",
  "UPLOADED",
  "PROCESSING",
  "PENDING_REVIEW",
]);

/** Sunucunun işlemesini beklediğimiz durumlar — bu sırada yoklama açık. */
export const ISLENIYOR_DURUMLAR: ReadonlySet<TutorIntroVideoStatus> = new Set([
  "UPLOADED",
  "PROCESSING",
]);

export function mbBiciminde(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function sureBiciminde(saniye: number | null | undefined): string {
  if (saniye == null || !Number.isFinite(saniye) || saniye < 0) return "";
  const s = Math.round(saniye);
  const dk = Math.floor(s / 60);
  const sn = s % 60;
  return `${dk}:${String(sn).padStart(2, "0")}`;
}

/**
 * Seçilen dosyanın erken ön kontrolü. Sunucu yine doğrular; burası kullanıcıya
 * 300 MB'lık dosyayı yüklemeye başlamadan ÖNCE haber vermek için.
 * Dönen: hata metni ya da null (geçti).
 */
export function dosyaOnKontrol(
  file: Pick<File, "size" | "type" | "name">,
  maxBytes: number
): string | null {
  if (!file.type.toLowerCase().startsWith("video/")) {
    return "Yalnızca video dosyası yükleyebilirsin (MP4, MOV, WebM gibi).";
  }
  if (file.size <= 0) return "Dosya boş görünüyor.";
  if (file.size > maxBytes) {
    return `Dosya ${mbBiciminde(file.size)}; en fazla ${mbBiciminde(maxBytes)} olabilir.`;
  }
  return null;
}

export type VideoBilgisi = {
  /** Saniye; okunamazsa (ör. tarayıcı kaydı webm) null. */
  sure: number | null;
  genislik: number;
  yukseklik: number;
};

/** Tarayıcıda videonun metadata'sını okur (süre + görüntülenen boyut).
 *  Okunamazsa null — engel değildir, karar sunucuda verilir. */
export function videoBilgisiniOku(file: File): Promise<VideoBilgisi | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    const bitir = (deger: VideoBilgisi | null) => {
      URL.revokeObjectURL(url);
      resolve(deger);
    };
    v.onloadedmetadata = () =>
      bitir({
        sure: Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null,
        genislik: v.videoWidth,
        yukseklik: v.videoHeight,
      });
    v.onerror = () => bitir(null);
    v.src = url;
  });
}

/**
 * Yüklemeden ÖNCE erken uyarı (sunucu aynı kuralları yine uygular):
 * süre sınırları ve dikey görüntü. Bilgi okunamadıysa null döner.
 */
export function videoBilgisiKontrol(
  bilgi: VideoBilgisi | null,
  sinir: { minSeconds: number; maxSeconds: number }
): string | null {
  if (!bilgi) return null;
  if (bilgi.genislik > 0 && bilgi.yukseklik > bilgi.genislik) {
    return "Video dikey çekilmiş; telefonu yatay tutarak yeniden çek.";
  }
  if (bilgi.sure != null && bilgi.sure > sinir.maxSeconds) {
    return `Video ${Math.round(bilgi.sure)} saniye; en fazla ${Math.floor(sinir.maxSeconds / 60)} dakika olabilir. Kısaltıp yeniden dene.`;
  }
  if (bilgi.sure != null && bilgi.sure < sinir.minSeconds) {
    return `Video ${Math.round(bilgi.sure)} saniye; en az ${sinir.minSeconds} saniye olmalı.`;
  }
  return null;
}

export type DurumAnlatimi = {
  etiket: string;
  aciklama: string;
  ton: "notr" | "bilgi" | "basari" | "uyari" | "hata";
};

/** Eğitmen paneli: yolda/başarısız kaydın kullanıcıya anlatımı. */
export function durumAnlatimi(
  status: TutorIntroVideoStatus,
  opts: { requireReview: boolean; eskiVideoVar: boolean }
): DurumAnlatimi {
  const eski = opts.eskiVideoVar ? " Şu anki videon bu sırada yayında kalır." : "";
  switch (status) {
    case "PENDING_UPLOAD":
      return { etiket: "Yükleniyor", aciklama: "Dosya depoya aktarılıyor.", ton: "bilgi" };
    case "UPLOADED":
    case "PROCESSING":
      return {
        etiket: "İşleniyor",
        aciklama: `Video web için dönüştürülüyor; bu birkaç dakika sürebilir. Sayfadan ayrılabilirsin.${eski}`,
        ton: "bilgi",
      };
    case "PENDING_REVIEW":
      return {
        etiket: "Onay bekliyor",
        aciklama: `Video hazır; ekibimiz kontrol edince profilinde yayına girecek.${eski}`,
        ton: "uyari",
      };
    case "ACTIVE":
      return { etiket: "Yayında", aciklama: "Profilinin en üstünde oynatılıyor.", ton: "basari" };
    case "REJECTED":
      return {
        etiket: "Onaylanmadı",
        aciklama: "Video kurallara uymadığı için yayına alınmadı. Yeni bir video yükleyebilirsin.",
        ton: "hata",
      };
    case "FAILED":
      return {
        etiket: "İşlenemedi",
        aciklama: "Video dönüştürülemedi. Başka bir dosya seçip yeniden deneyebilirsin.",
        ton: "hata",
      };
    case "EXPIRED":
      return { etiket: "Yükleme tamamlanmadı", aciklama: "Yeniden yükleyebilirsin.", ton: "notr" };
    default:
      return { etiket: "Kaldırıldı", aciklama: "", ton: "notr" };
  }
}
