/**
 * Zoom medya katmanı — üç KALICI `<video-player-container>`:
 *
 *   - `uzak`     tüm video alanı; karşı tarafın oyuncusu (ve platform çoklu
 *                videoyu destekliyorsa kendi görüntünün oyuncusu da) burada
 *   - `paylasim` karşı tarafın ekran paylaşımı ayrı kap ister
 *                (media.d.ts `attachShareView`: `attachVideo` kabıyla karışmaz)
 *   - `ben`      çoklu video desteklenmiyorsa (Firefox/WASM) kendi görüntün
 *                ayrı kapta çizilir (media.d.ts `isSupportMultipleVideos`)
 *
 * Kendi paylaşımım ayrıca kalıcı bir `<video>` ya da `<canvas>`a çizilir
 * (`isStartShareScreenWithVideoElement`); öğe `paylasimOgesiniKaydet` ile
 * sürücüye verilir.
 *
 * Paylaşım başlığı, ayna uyarısı ve karo katmanları GENEL sahnededir
 * (`oda/VideoSahnesi.tsx`); burası yalnız medyayı çizer. Kaplar ve oyuncular
 * koşullu çizilmez, yeniden kurulmaz: yalnız hesaplanan dikdörtgenlerle
 * (`style`) yer değiştirir. Bağlama efektleri yalnız `(kimlik, video açık mı)`
 * değişince çalışır.
 *
 * Özel öğelere `className` verilmez (React 18'de `class` eşlemesine
 * güvenilmez); boyut `style` ve sarmalayıcı `div`lerden gelir.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import type { MedyaKatmaniProps } from "../tipler";
import { yer } from "../yer";
import {
  cokluVideoMu,
  paylasimBagla,
  paylasimCoz,
  paylasimOgesiniKaydet,
  paylasimVideoOgesiIster,
  videoBagla,
  videoCoz,
} from "./istemci";

const KAP: CSSProperties = { display: "block", position: "absolute", inset: 0 };
const OYUNCU: CSSProperties = { display: "block", width: "100%", height: "100%" };
const PAYLASIM_OGESI: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  objectFit: "contain",
};

export function MedyaKatmani({
  yerlesim: y,
  paylasimBaslikPx,
  benId,
  benVideo,
  karsiId,
  karsiVideo,
  aktifPaylasim,
  benPaylasiyorum,
}: MedyaKatmaniProps) {
  // Katıldıktan sonra çizilir: çoklu video ve paylaşım öğesi türü artık bilinir, sabittir.
  const [coklu] = useState(cokluVideoMu);
  const [paylasimVideo] = useState(paylasimVideoOgesiIster);
  const paylasimOgesiRef = useCallback((oge: HTMLVideoElement | HTMLCanvasElement | null) => {
    paylasimOgesiniKaydet(oge);
  }, []);

  const uzakOyuncu = useRef<HTMLElement>(null);
  const benOyuncuCoklu = useRef<HTMLElement>(null);
  const benOyuncuTekli = useRef<HTMLElement>(null);
  const paylasimOyuncu = useRef<HTMLElement>(null);

  useEffect(() => {
    const oyuncu = uzakOyuncu.current;
    if (karsiId === null || !karsiVideo || !oyuncu) return;
    const userId = Number(karsiId);
    void videoBagla(userId, oyuncu);
    return () => void videoCoz(userId, oyuncu);
  }, [karsiId, karsiVideo]);

  useEffect(() => {
    const oyuncu = coklu ? benOyuncuCoklu.current : benOyuncuTekli.current;
    if (benId === null || !benVideo || !oyuncu) return;
    const userId = Number(benId);
    void videoBagla(userId, oyuncu);
    return () => void videoCoz(userId, oyuncu);
  }, [benId, benVideo, coklu]);

  // Karşı tarafın paylaşımı: yalnız paylaşan değişince bağlanır/çözülür.
  useEffect(() => {
    const oyuncu = paylasimOyuncu.current;
    if (aktifPaylasim === null || !oyuncu) return;
    const userId = Number(aktifPaylasim);
    void paylasimBagla(userId, oyuncu);
    return () => void paylasimCoz(userId, oyuncu);
  }, [aktifPaylasim]);

  const paylasimGorunur = (benPaylasiyorum || aktifPaylasim !== null) && y.paylasim !== null;
  // Kendi paylaşımım varken onu gösteririm (SDK o sırada başkasınınkini vermez).
  const uzakPaylasimGorunur = paylasimGorunur && !benPaylasiyorum;
  const uzakK = karsiId !== null ? y.karsiKaro : null;
  const yuzenSinif = y.yuzen ? "rounded-ders shadow-[0_8px_32px_rgba(18,17,23,0.15)]" : "";
  // İki karolu yüzen kutu: kendi karo sol köşeler, karşı taraf sağ köşeler.
  const benKose = y.yuzen && uzakK ? "rounded-l-ders" : "rounded-ders";
  const karsiKose = y.yuzen ? "rounded-r-ders" : "rounded-ders";

  return (
    <>
      {/* 1) video kabı — karoların alanı (araçsızda sahne, Kenar çubuğunda
          yan panel, yüzen görünümde 200×133/200×100 kutu). Kap AYNI
          düğümdür; yalnız boyutu/konumu değişir, oyuncular yeniden kurulmaz. */}
      <div className={`absolute z-10 ${yuzenSinif}`} style={yer(y.video)}>
        <video-player-container style={KAP}>
          <div className={`absolute overflow-hidden ${karsiKose}`} style={yer(uzakK, y.video)}>
            <video-player ref={uzakOyuncu} style={OYUNCU} />
          </div>
          <div
            className={`absolute overflow-hidden ${benKose} ${coklu ? "" : "invisible"}`}
            style={yer(y.benKaro, y.video)}
          >
            <video-player ref={benOyuncuCoklu} style={OYUNCU} />
          </div>
        </video-player-container>
      </div>

      {/* 2) paylaşım paneli — kalıcı; paylaşım yokken gizli. Başlık (üstteki
          `paylasimBaslikPx`) genel sahnede, bu panelin üstüne çizilir. */}
      <div
        className="absolute overflow-hidden rounded-t-ders bg-black"
        style={yer(paylasimGorunur ? y.paylasim : null)}
        aria-hidden={!paylasimGorunur}
      >
        <div className="absolute inset-x-0 bottom-0" style={{ top: paylasimBaslikPx }}>
          {/* 2a) karşı tarafın paylaşımı — `attachShareView` kabı */}
          <div className={`absolute inset-0 ${uzakPaylasimGorunur ? "" : "invisible"}`}>
            <video-player-container style={KAP}>
              <video-player ref={paylasimOyuncu} style={OYUNCU} />
            </video-player-container>
          </div>
          {/* 2b) kendi paylaşımım — `startShareScreen` öğesi */}
          <div className={`absolute inset-0 ${benPaylasiyorum ? "" : "invisible"}`}>
            {paylasimVideo ? (
              <video ref={paylasimOgesiRef} style={PAYLASIM_OGESI} muted playsInline />
            ) : (
              <canvas ref={paylasimOgesiRef} style={PAYLASIM_OGESI} />
            )}
          </div>
        </div>
      </div>

      {/* 3) ayrı kendi-görüntü kabı — yalnız çoklu video yoksa */}
      <div
        className={`absolute z-10 overflow-hidden ${benKose} ${coklu ? "invisible" : ""}`}
        style={yer(y.benKaro)}
      >
        <video-player-container style={KAP}>
          <video-player ref={benOyuncuTekli} style={OYUNCU} />
        </video-player-container>
      </div>
    </>
  );
}
