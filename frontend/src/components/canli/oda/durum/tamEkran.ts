/**
 * Tarayıcı tam ekranı — La Suite Meet `useFullScreen` deseni (MIT —
 * DINUM/Etalab). Hedef HER ZAMAN `document.documentElement`: tahta/paylaşım
 * düğümü tam ekrana alınmaz (Zoom oyuncuları taşınamaz, yüzen kamera kardeş
 * düğümdür, portal pencereler ve bildirimler görünmez olurdu).
 *
 * iPhone Safari'de `fullscreenEnabled` yoktur: `destekli` false, öğe gizlenir.
 * `requestFullscreen` kullanıcı hareketinin İÇİNDE, beklemeden çağrılır.
 */
import { useCallback, useEffect, useState } from "react";

type SaticiBelgesi = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type SaticiOgesi = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function belge(): SaticiBelgesi | null {
  return typeof document === "undefined" ? null : (document as SaticiBelgesi);
}

export function tamEkranDestekli(): boolean {
  const d = belge();
  return Boolean(d && (d.fullscreenEnabled || d.webkitFullscreenEnabled));
}

export function tamEkranda(): boolean {
  const d = belge();
  return Boolean(d && (d.fullscreenElement || d.webkitFullscreenElement));
}

/** Aç/kapat; hata (izin, iframe) yalnız günlüğe yazılır. */
export function tamEkranDegistir(): void {
  const d = belge();
  if (!d) return;
  try {
    if (tamEkranda()) {
      const s = d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.();
      void Promise.resolve(s).catch((e) => console.warn("Tam ekrandan çıkış", e));
      return;
    }
    const kok = d.documentElement as SaticiOgesi;
    const s = kok.requestFullscreen ? kok.requestFullscreen() : kok.webkitRequestFullscreen?.();
    void Promise.resolve(s).catch((e) => console.warn("Tam ekran", e));
  } catch (e) {
    console.warn("Tam ekran", e);
  }
}

/** Tam ekran durumu (`fullscreenchange` ile) ve geçiş. */
export function useTamEkran(): { destekli: boolean; acik: boolean; degistir: () => void } {
  const [destekli] = useState(tamEkranDestekli);
  const [acik, setAcik] = useState(tamEkranda);
  useEffect(() => {
    const d = belge();
    if (!d) return;
    const degisti = () => setAcik(tamEkranda());
    d.addEventListener("fullscreenchange", degisti);
    d.addEventListener("webkitfullscreenchange", degisti);
    return () => {
      d.removeEventListener("fullscreenchange", degisti);
      d.removeEventListener("webkitfullscreenchange", degisti);
    };
  }, []);
  const degistir = useCallback(() => tamEkranDegistir(), []);
  return { destekli, acik, degistir };
}

/** Ctrl+Shift+F (Meet kısayolu). Shift basılıyken `key` büyük "F" gelir. */
export function tamEkranKisayoluMu(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "f";
}
