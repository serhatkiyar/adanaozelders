/**
 * Görüntü sahnesi — üç KALICI `<video-player-container>`:
 *
 *   - `uzak`     tüm sahne; karşı tarafın oyuncusu (ve platform çoklu videoyu
 *                destekliyorsa kendi görüntünün oyuncusu da) burada
 *   - `paylasim` ekran paylaşımı ayrı kap ister (media.d.ts; Paket 4)
 *   - `ben`      çoklu video desteklenmiyorsa (Firefox/WASM) kendi görüntün
 *                ayrı kapta çizilir (media.d.ts `isSupportMultipleVideos`)
 *
 * Düzen (`yalniz` / `birebir`) YALNIZ sınıflarla değişir; kaplar ve oyuncular
 * koşullu çizilmez, yeniden kurulmaz. Telefonu döndürmek ya da düzen
 * değişmek yeni `attachVideo` doğurmaz: bağlama efektleri yalnız
 * `(userId, video açık mı)` değişince çalışır.
 *
 * Özel öğelere `className` verilmez (React 18'de `class` eşlemesine
 * güvenilmez); boyut `style` ve sarmalayıcı `div`lerden gelir.
 *
 * Görünüm: Meet `ParticipantTile` / `.lk-participant-tile` (La Suite Meet,
 * MIT — DINUM/Etalab).
 */
import { useEffect, useRef, type CSSProperties } from "react";

import { sahneDuzeni, type SahneDuzeni } from "@/lib/canliDers";

import { videoBagla, videoCoz } from "../zoom/istemci";
import {
  useAgSeviyesi,
  useBaglanti,
  useBen,
  useCokluVideo,
  useKarsiTaraf,
  useKonusuyor,
} from "../zoom/odaDeposu";
import { KatilimciZemini } from "./Avatar";
import { KaroBilgisi, KaroKatmani } from "./KaroBilgisi";

const KAP: CSSProperties = { display: "block", position: "absolute", inset: 0 };
const OYUNCU: CSSProperties = { display: "block", width: "100%", height: "100%" };

function uzakKutusu(duzen: SahneDuzeni, telefon: boolean): string {
  if (duzen !== "birebir") return "invisible inset-0";
  return telefon ? "inset-0" : "inset-2 rounded-ders";
}

function benKutusu(duzen: SahneDuzeni, telefon: boolean): string {
  if (duzen === "yalniz") return telefon ? "inset-0" : "inset-2 rounded-ders";
  return telefon
    ? "bottom-3 right-3 z-20 aspect-[3/4] w-[28%] rounded-ders shadow-lg"
    : "bottom-4 right-4 z-20 aspect-video w-[22%] min-w-[160px] max-w-[320px] rounded-ders shadow-lg";
}

export function ZoomVideoSahnesi({ telefon }: { telefon: boolean }) {
  const uzak = useKarsiTaraf();
  const ben = useBen();
  const coklu = useCokluVideo();
  const uzakKonusuyor = useKonusuyor(uzak?.userId);
  const benKonusuyor = useKonusuyor(ben?.userId);
  const uzakAg = useAgSeviyesi(uzak?.userId);
  const benAg = useAgSeviyesi(ben?.userId);
  // Kendi bağlantımız koptuysa kendi kartımız da "yeniden bağlanıyor" der.
  const benKoptu = useBaglanti() === "yenidenBaglaniyor";

  const uzakOyuncu = useRef<HTMLElement>(null);
  const benOyuncuCoklu = useRef<HTMLElement>(null);
  const benOyuncuTekli = useRef<HTMLElement>(null);

  const uzakId = uzak?.userId;
  const uzakVideo = uzak?.videoAcik ?? false;
  const benId = ben?.userId;
  const benVideo = ben?.videoAcik ?? false;

  useEffect(() => {
    const oyuncu = uzakOyuncu.current;
    if (uzakId === undefined || !uzakVideo || !oyuncu) return;
    void videoBagla(uzakId, oyuncu);
    return () => void videoCoz(uzakId, oyuncu);
  }, [uzakId, uzakVideo]);

  useEffect(() => {
    const oyuncu = coklu ? benOyuncuCoklu.current : benOyuncuTekli.current;
    if (benId === undefined || !benVideo || !oyuncu) return;
    void videoBagla(benId, oyuncu);
    return () => void videoCoz(benId, oyuncu);
  }, [benId, benVideo, coklu]);

  const duzen = sahneDuzeni(Boolean(uzak), false);
  const uzakK = uzakKutusu(duzen, telefon);
  const benK = benKutusu(duzen, telefon);
  const kucukBen = duzen === "birebir";

  return (
    <div className="absolute inset-0 overflow-hidden bg-ders-zemin" data-duzen={duzen}>
      {/* 1) uzak kap — sahnenin tamamı */}
      <video-player-container style={KAP}>
        <div className={`absolute overflow-hidden ${uzakK}`}>
          <video-player ref={uzakOyuncu} style={OYUNCU} />
        </div>
        <div className={`absolute overflow-hidden ${benK} ${coklu ? "" : "invisible"}`}>
          <video-player ref={benOyuncuCoklu} style={OYUNCU} />
        </div>
      </video-player-container>

      {/* 2) paylaşım kabı — Paket 4 (kalıcı, şimdilik gizli) */}
      <div className="invisible absolute inset-0" aria-hidden>
        <video-player-container style={KAP} />
      </div>

      {/* 3) ayrı kendi-görüntü kabı — yalnız çoklu video yoksa */}
      <div className={`absolute overflow-hidden ${benK} ${coklu ? "invisible" : ""}`}>
        <video-player-container style={KAP}>
          <video-player ref={benOyuncuTekli} style={OYUNCU} />
        </video-player-container>
      </div>

      {/* Kart katmanları: oyuncuların KARDEŞİ, üstte */}
      <KaroKatmani
        className={`z-10 ${uzakK}`}
        ad={uzak?.ad}
        konusuyor={Boolean(uzak) && uzakKonusuyor}
        agSeviyesi={uzakAg}
        telefon={telefon}
      >
        {uzak && !uzakVideo && <KatilimciZemini ad={uzak.ad} konusuyor={uzakKonusuyor} />}
        {uzak && (
          <KaroBilgisi
            ad={uzak.ad}
            mikKapali={uzak.mikKapali}
            agSeviyesi={uzakAg}
            yenidenBaglaniyor={uzak.yenidenBaglaniyor}
          />
        )}
      </KaroKatmani>
      <KaroKatmani
        className={benK}
        ad={ben?.ad}
        konusuyor={Boolean(ben) && benKonusuyor}
        agSeviyesi={benAg}
        telefon={telefon}
      >
        {ben && !benVideo && <KatilimciZemini ad={ben.ad} konusuyor={benKonusuyor} />}
        {ben && (
          <KaroBilgisi
            ad={ben.ad}
            mikKapali={ben.mikKapali}
            agSeviyesi={benAg}
            yenidenBaglaniyor={ben.yenidenBaglaniyor || benKoptu}
            kucuk={kucukBen}
          />
        )}
      </KaroKatmani>
    </div>
  );
}
