// Tarayıcıda kamerayla tanıtım videosu kaydı — saf yardımcılar (test edilir).
//
// Kayıt `MediaRecorder` ile yapılır; çıkan dosya mevcut yükleme hattına
// (imzalı PUT → worker → 720p MP4) aynen girer. Sunucu tipi baz haliyle alır
// (`video/webm;codecs=vp9,opus` → `video/webm`), bu yüzden dosya da baz tiple
// oluşturulur.

/** Tercih sırası: Safari mp4 kaydeder, Chrome/Firefox webm. İlk desteklenen seçilir. */
export const KAYIT_MIME_ADAYLARI = [
  "video/mp4;codecs=avc1,mp4a",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

export function kayitMimeSec(destekliMi: (tip: string) => boolean): string | null {
  for (const tip of KAYIT_MIME_ADAYLARI) {
    try {
      if (destekliMi(tip)) return tip;
    } catch {
      /* bazı tarayıcılar bilinmeyen tipte hata fırlatır */
    }
  }
  return null;
}

export function bazTip(mime: string): "video/mp4" | "video/webm" {
  return mime.split(";", 1)[0].trim().toLowerCase() === "video/mp4" ? "video/mp4" : "video/webm";
}

export function kayitDosyaAdi(mime: string): string {
  return bazTip(mime) === "video/mp4" ? "kamera-kaydi.mp4" : "kamera-kaydi.webm";
}

export function kameraDestekleniyor(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof window !== "undefined" &&
    typeof (window as { MediaRecorder?: unknown }).MediaRecorder === "function"
  );
}

/** getUserMedia / MediaRecorder hatasını eğitmene sade Türkçe anlatır. */
export function kameraHataMesaji(err: unknown): string {
  const ad = (err as { name?: string } | null)?.name ?? "";
  if (ad === "NotAllowedError" || ad === "SecurityError") {
    return "Kamera veya mikrofon izni verilmedi. Adres çubuğundaki kamera simgesinden izin verip yeniden dene.";
  }
  if (ad === "NotFoundError" || ad === "OverconstrainedError") {
    return "Kamera ya da mikrofon bulunamadı. Bağlı olduğundan emin ol veya video dosyası yükle.";
  }
  if (ad === "NotReadableError" || ad === "AbortError") {
    return "Kamera başka bir uygulama tarafından kullanılıyor. O uygulamayı kapatıp yeniden dene.";
  }
  return "Kamera açılamadı. Sayfayı yenileyip yeniden dene veya video dosyası yükle.";
}

/** Kamera kısıtları: 720p hedef, ön kamera; ses açık. */
export function kameraKisitlari(kameraId?: string, mikrofonId?: string): MediaStreamConstraints {
  return {
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      ...(kameraId ? { deviceId: { exact: kameraId } } : { facingMode: "user" }),
    },
    audio: mikrofonId ? { deviceId: { exact: mikrofonId } } : true,
  };
}
