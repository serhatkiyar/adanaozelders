/**
 * Görüntü sahnesi — üç KALICI `<video-player-container>`:
 *
 *   - `uzak`     tüm sahne; karşı tarafın oyuncusu (ve platform çoklu videoyu
 *                destekliyorsa kendi görüntünün oyuncusu da) burada
 *   - `paylasim` karşı tarafın ekran paylaşımı ayrı kap ister
 *                (media.d.ts `attachShareView`: `attachVideo` kabıyla karışmaz)
 *   - `ben`      çoklu video desteklenmiyorsa (Firefox/WASM) kendi görüntün
 *                ayrı kapta çizilir (media.d.ts `isSupportMultipleVideos`)
 *
 * Kendi paylaşımım ayrıca kalıcı bir `<video>` ya da `<canvas>`a çizilir
 * (`isStartShareScreenWithVideoElement`); öğe `paylasimOgesiniKaydet` ile
 * servise verilir, düğme onu `startShareScreen`e geçirir.
 *
 * Düzen (`yalniz` / `birebir` / `paylasim`) YALNIZ sınıflarla değişir; kaplar
 * ve oyuncular koşullu çizilmez, yeniden kurulmaz. Telefonu döndürmek ya da düzen
 * değişmek yeni `attachVideo` doğurmaz: bağlama efektleri yalnız
 * `(userId, video açık mı)` değişince çalışır.
 *
 * Özel öğelere `className` verilmez (React 18'de `class` eşlemesine
 * güvenilmez); boyut `style` ve sarmalayıcı `div`lerden gelir.
 *
 * Görünüm: Meet `ParticipantTile` / `.lk-participant-tile` (La Suite Meet,
 * MIT — DINUM/Etalab).
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { sahneDuzeni, type SahneDuzeni } from "@/lib/canliDers";

import {
  paylasimBagla,
  paylasimCoz,
  paylasimiDurdur,
  paylasimOgesiniKaydet,
  paylasimVideoOgesiIster,
  videoBagla,
  videoCoz,
} from "../zoom/istemci";
import {
  useAgSeviyesi,
  useAktifPaylasim,
  useBenPaylasiyorum,
  useBenTumEkran,
  useBaglanti,
  useBen,
  useCokluVideo,
  useEliKalkik,
  useKarsiTaraf,
  useKonusuyor,
  usePaylasimVar,
} from "../zoom/odaDeposu";
import { KatilimciZemini } from "./Avatar";
import { KaroBilgisi, KaroKatmani } from "./KaroBilgisi";
import { AynaUyarisi } from "./paylasim/AynaUyarisi";

const KAP: CSSProperties = { display: "block", position: "absolute", inset: 0 };
const OYUNCU: CSSProperties = { display: "block", width: "100%", height: "100%" };
const PAYLASIM_OGESI: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  objectFit: "contain",
};

/*
 * Paylaşım düzeni (Meet odak görünümü): paylaşım büyük; masaüstünde iki
 * görüntü sağda 240px'lik sütunda, telefonda altta iki karelik şerit.
 * Sütun: 240 + 8 boşluk + 8 kenar = 256px; şerit: 7rem + 0.5rem kenar.
 */
const PAYLASIM_ALANI = {
  masaustu: "left-2 top-2 bottom-2 right-[256px] rounded-ders",
  telefon: "inset-x-0 top-0 bottom-[8rem]",
} as const;
const YAN_KUTU = {
  masaustu: [
    "right-2 top-2 z-20 aspect-video w-[240px] rounded-ders",
    "right-2 top-[151px] z-20 aspect-video w-[240px] rounded-ders",
  ],
  telefon: [
    "bottom-2 left-2 z-20 h-28 w-[calc(50%-0.75rem)] rounded-ders",
    "bottom-2 right-2 z-20 h-28 w-[calc(50%-0.75rem)] rounded-ders",
  ],
} as const;

function paylasimAlani(duzen: SahneDuzeni, telefon: boolean): string {
  if (duzen !== "paylasim") return "invisible inset-0";
  return telefon ? PAYLASIM_ALANI.telefon : PAYLASIM_ALANI.masaustu;
}

function uzakKutusu(duzen: SahneDuzeni, telefon: boolean): string {
  if (duzen === "paylasim") return YAN_KUTU[telefon ? "telefon" : "masaustu"][0];
  if (duzen !== "birebir") return "invisible inset-0";
  return telefon ? "inset-0" : "inset-2 rounded-ders";
}

function benKutusu(duzen: SahneDuzeni, telefon: boolean, uzakVar: boolean): string {
  if (duzen === "paylasim") {
    // Karşı taraf yoksa kendi görüntüm ilk yuvaya kayar.
    return YAN_KUTU[telefon ? "telefon" : "masaustu"][uzakVar ? 1 : 0];
  }
  if (duzen === "yalniz") return telefon ? "inset-0" : "inset-2 rounded-ders";
  return telefon
    ? "bottom-3 right-3 z-20 aspect-[3/4] w-[28%] rounded-ders shadow-lg"
    : "bottom-4 right-4 z-20 aspect-video w-[22%] min-w-[160px] max-w-[320px] rounded-ders shadow-lg";
}

export function ZoomVideoSahnesi({ telefon }: { telefon: boolean }) {
  const { t } = useTranslation();
  const uzak = useKarsiTaraf();
  const ben = useBen();
  const coklu = useCokluVideo();
  const uzakKonusuyor = useKonusuyor(uzak?.userId);
  const benKonusuyor = useKonusuyor(ben?.userId);
  const uzakAg = useAgSeviyesi(uzak?.userId);
  const benAg = useAgSeviyesi(ben?.userId);
  const uzakEl = useEliKalkik(uzak?.userId);
  const benEl = useEliKalkik(ben?.userId);
  // Kendi bağlantımız koptuysa kendi kartımız da "yeniden bağlanıyor" der.
  const benKoptu = useBaglanti() === "yenidenBaglaniyor";
  const paylasimVar = usePaylasimVar();
  const aktifPaylasim = useAktifPaylasim();
  const benPaylasiyorum = useBenPaylasiyorum();
  const benTumEkran = useBenTumEkran();
  // Meet: "Yoksay" bu ders boyunca geçerli.
  const [aynaUyarisiKapali, setAynaUyarisiKapali] = useState(false);
  // Katıldıktan sonra çizilir: SDK'nın istediği öğe türü artık bilinir, sabittir.
  const [paylasimVideo] = useState(paylasimVideoOgesiIster);
  const paylasimOgesiRef = useCallback((oge: HTMLVideoElement | HTMLCanvasElement | null) => {
    paylasimOgesiniKaydet(oge);
  }, []);

  const uzakOyuncu = useRef<HTMLElement>(null);
  const benOyuncuCoklu = useRef<HTMLElement>(null);
  const benOyuncuTekli = useRef<HTMLElement>(null);
  const paylasimOyuncu = useRef<HTMLElement>(null);

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

  // Karşı tarafın paylaşımı: yalnız paylaşan değişince bağlanır/çözülür.
  useEffect(() => {
    const oyuncu = paylasimOyuncu.current;
    if (aktifPaylasim === null || !oyuncu) return;
    void paylasimBagla(aktifPaylasim, oyuncu);
    return () => void paylasimCoz(aktifPaylasim, oyuncu);
  }, [aktifPaylasim]);

  const duzen = sahneDuzeni(Boolean(uzak), paylasimVar);
  const alanK = paylasimAlani(duzen, telefon);
  const uzakK = uzakKutusu(duzen, telefon);
  const benK = benKutusu(duzen, telefon, Boolean(uzak));
  const kucukBen = duzen !== "yalniz";
  const kucukUzak = duzen === "paylasim";
  // Kendi paylaşımım varken onu gösteririm (SDK o sırada başkasınınkini vermez).
  const uzakPaylasimGorunur = duzen === "paylasim" && !benPaylasiyorum;

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

      {/* 2) paylaşım alanı — kalıcı; düzen dışında gizli */}
      <div
        className={`absolute overflow-hidden bg-black ${alanK}`}
        aria-hidden={duzen !== "paylasim"}
      >
        {/* 2a) karşı tarafın paylaşımı — `attachShareView` kabı */}
        <div className={`absolute inset-0 ${uzakPaylasimGorunur ? "" : "invisible"}`}>
          <video-player-container style={KAP}>
            <video-player ref={paylasimOyuncu} style={OYUNCU} />
          </video-player-container>
        </div>
        {/* 2b) kendi paylaşımım — `startShareScreen` öğesi (kenarlık/dolgu yok) */}
        <div className={`absolute inset-0 ${benPaylasiyorum ? "" : "invisible"}`}>
          {paylasimVideo ? (
            <video ref={paylasimOgesiRef} style={PAYLASIM_OGESI} muted playsInline />
          ) : (
            <canvas ref={paylasimOgesiRef} style={PAYLASIM_OGESI} />
          )}
          {benPaylasiyorum && benTumEkran && !aynaUyarisiKapali && (
            <AynaUyarisi
              onDurdur={() => void paylasimiDurdur()}
              onYoksay={() => setAynaUyarisiKapali(true)}
            />
          )}
        </div>
        {duzen === "paylasim" && (
          <p className="pointer-events-none absolute bottom-2 left-2 z-10 max-w-[calc(100%-1rem)] truncate rounded bg-black/50 px-2 py-1 text-sm font-medium text-white">
            {benPaylasiyorum
              ? t("participantTile.myScreenShare")
              : t("participantTile.screenShare", { name: uzak?.ad ?? "" })}
          </p>
        )}
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
            elKalkik={uzakEl}
            yenidenBaglaniyor={uzak.yenidenBaglaniyor}
            kucuk={kucukUzak}
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
            elKalkik={benEl}
            yenidenBaglaniyor={ben.yenidenBaglaniyor || benKoptu}
            kucuk={kucukBen}
          />
        )}
      </KaroKatmani>
    </div>
  );
}
