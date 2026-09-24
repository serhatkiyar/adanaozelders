/**
 * Tam ekran — Meet `useFullScreen`. iOS Safari'de öğe tam ekranı yoktur
 * (`fullscreenEnabled` false): o zaman menü öğesi hiç gösterilmez.
 */
import { useCallback, useEffect, useState } from "react";

export function useTamEkran() {
  const destekli = typeof document !== "undefined" && Boolean(document.fullscreenEnabled);
  const [acik, setAcik] = useState(
    () => typeof document !== "undefined" && document.fullscreenElement !== null,
  );

  useEffect(() => {
    if (!destekli) return;
    const degisti = () => setAcik(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", degisti);
    return () => document.removeEventListener("fullscreenchange", degisti);
  }, [destekli]);

  const degistir = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // kullanıcı reddetti ya da tarayıcı izin vermedi
    }
  }, []);

  return { destekli, acik, degistir };
}
