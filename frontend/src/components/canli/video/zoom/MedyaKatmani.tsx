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
 * değişince çalışır. Gizlemek oyuncuyu ÇÖZMEZ (Zoom'da gizle/göster ile
 * çözüp bağlamak iki yönde video akışını çökertiyordu, bkz. `istemci.ts`
 * `videoCoz`): gizli karşı karo bağlı kalır ve kalitesi 90P'ye iner; gizli
 * kendi karom bağlı kalır, yalnız yerleşimde ekran dışındaki 1×1 alana
 * çekilir (kamera yayını sürer).
 *
 * Özel öğelere `className` verilmez (React 18'de `class` eşlemesine
 * güvenilmez); boyut `style` ve sarmalayıcı `div`lerden gelir.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";

import type { MedyaKatmaniProps } from "../tipler";
import { yer } from "../yer";
import {
  cokluVideoMu,
  kaliteDegistir,
  karsiPaylasimBoyutu,
  karsiPaylasimBoyutuDinle,
  paylasimBagla,
  paylasimCoz,
  paylasimOgesiniKaydet,
  paylasimVideoOgesiIster,
  videoBagla,
  videoCoz,
  type ZoomKalitesi,
} from "./istemci";

const KAP: CSSProperties = { display: "block", position: "absolute", inset: 0 };
const OYUNCU: CSSProperties = { display: "block", width: "100%", height: "100%" };
const PAYLASIM_OGESI: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  objectFit: "contain",
};

/**
 * Paylaşım kabını içerik oranıyla alana `contain` sığdırır ve ortalar;
 * boyut bilinmiyorsa alanın tamamı.
 */
function sigdir(
  alan: { w: number; h: number },
  icerik: { w: number; h: number } | null,
): CSSProperties {
  if (!icerik || !icerik.w || !icerik.h || !alan.w || !alan.h) return KAP;
  const olcek = Math.min(alan.w / icerik.w, alan.h / icerik.h);
  const w = Math.round(icerik.w * olcek);
  const h = Math.round(icerik.h * olcek);
  return {
    display: "block",
    position: "absolute",
    left: Math.round((alan.w - w) / 2),
    top: Math.round((alan.h - h) / 2),
    width: w,
    height: h,
  };
}

export function MedyaKatmani({
  yerlesim: y,
  paylasimBaslikPx,
  benId,
  benVideo,
  karsiId,
  karsiVideo,
  aktifPaylasim,
  benPaylasiyorum,
  // benGorunur: Zoom'da kullanılmaz — gizli kendi karom bağlı kalır, yerleşim
  // onu ekran dışına alır (bkz. dosya başı).
  karsiGorunur,
  karsiKalite,
  paylasimDonusumKabi,
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

  // Karşı video: bağlama yalnız (kimlik, video açık) değişince. Görünürlük
  // yalnız KALİTEYİ değiştirir (gizli → 90P); bağlı oyuncuya aynı öğeyle
  // uygulanır. Efekt sırası önemli: önce hedef kalite ref'i.
  const hedefKalite: ZoomKalitesi = karsiGorunur ? karsiKalite : "gizli";
  const hedefKaliteRef = useRef(hedefKalite);
  const karsiBagli = useRef<{ userId: number; kalite: ZoomKalitesi } | null>(null);
  useEffect(() => {
    hedefKaliteRef.current = hedefKalite;
  }, [hedefKalite]);

  useEffect(() => {
    const oyuncu = uzakOyuncu.current;
    if (karsiId === null || !karsiVideo || !oyuncu) return;
    const userId = Number(karsiId);
    const kalite = hedefKaliteRef.current;
    karsiBagli.current = { userId, kalite };
    void videoBagla(userId, oyuncu, kalite);
    return () => {
      karsiBagli.current = null;
      void videoCoz(userId, oyuncu);
    };
  }, [karsiId, karsiVideo]);

  useEffect(() => {
    const bagli = karsiBagli.current;
    const oyuncu = uzakOyuncu.current;
    if (!bagli || !oyuncu || bagli.kalite === hedefKalite) return;
    bagli.kalite = hedefKalite;
    void kaliteDegistir(bagli.userId, oyuncu, hedefKalite);
  }, [hedefKalite]);

  // Kendi görüntüm: gizliyken de bağlı kalır (yerleşim onu ekran dışına alır).
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

  // Karşı paylaşımın içerik boyutu (`share-content-dimension-change`
  // "received"): kap, görüntü alanına `contain` sığdırılır (SDK belgesi).
  const paylasimAlani = useRef<HTMLDivElement>(null);
  const icerikBoyutu = useSyncExternalStore(karsiPaylasimBoyutuDinle, karsiPaylasimBoyutu);
  const [alan, setAlan] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = paylasimAlani.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const g = new ResizeObserver(([k]) =>
      setAlan({ w: k.contentRect.width, h: k.contentRect.height }),
    );
    g.observe(el);
    return () => g.disconnect();
  }, []);
  const paylasimKabi = sigdir(alan, icerikBoyutu);

  const paylasimGorunur = (benPaylasiyorum || aktifPaylasim !== null) && y.paylasim !== null;
  // Kendi paylaşımım varken onu gösteririm (SDK o sırada başkasınınkini vermez).
  const uzakPaylasimGorunur = paylasimGorunur && !benPaylasiyorum;
  const uzakK = karsiId !== null ? y.karsiKaro : null;
  const yuzenSinif = y.yuzen ? "rounded-ders shadow-[0_8px_32px_rgba(18,17,23,0.15)]" : "";
  // İki karolu yüzen kutu: kendi karo sol köşeler, karşı taraf sağ köşeler.
  // Kendi görüntüm gizliyken karşı karo tek başına: dört köşe yuvarlak.
  const benKose = y.yuzen && uzakK ? "rounded-l-ders" : "rounded-ders";
  const karsiKose = y.yuzen && y.benGorunur ? "rounded-r-ders" : "rounded-ders";

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
        <div
          ref={paylasimAlani}
          className="absolute inset-x-0 bottom-0 overflow-hidden"
          style={{ top: paylasimBaslikPx }}
        >
          {/* 2a) karşı tarafın paylaşımı — `attachShareView` kabı. Dönüşüm
              kabı (yakınlaştırma) kabın DIŞINDA: kap ile oyuncu arasına öğe
              girmez. */}
          <div className={`absolute inset-0 ${uzakPaylasimGorunur ? "" : "invisible"}`}>
            <div ref={paylasimDonusumKabi} className="absolute inset-0">
              <video-player-container style={paylasimKabi}>
                <video-player ref={paylasimOyuncu} style={OYUNCU} />
              </video-player-container>
            </div>
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
