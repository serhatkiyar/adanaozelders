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
 * Düzen Preply sınıfınınkidir (`lib/sinifDuzeni.ts`: Odaklanma, Kareler,
 * Kenar çubuğu, Köşe/yüzen kutu, paylaşım + tahta bölmesi). Kaplar ve
 * oyuncular koşullu çizilmez, yeniden kurulmaz: yalnız hesaplanan
 * dikdörtgenlerle (`style`) yer değiştirir. Telefonu döndürmek, tahtayı
 * açmak ya da düzen değişmek yeni `attachVideo` doğurmaz: bağlama efektleri
 * yalnız `(userId, video açık mı)` değişince çalışır.
 *
 * Özel öğelere `className` verilmez (React 18'de `class` eşlemesine
 * güvenilmez); boyut `style` ve sarmalayıcı `div`lerden gelir.
 *
 * Görünüm: Meet `ParticipantTile` / `.lk-participant-tile` (La Suite Meet,
 * MIT — DINUM/Etalab).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";
import { katilimciRengi } from "@/lib/canliDers";
import type { Kutu, Yerlesim } from "@/lib/sinifDuzeni";

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
import { Avatar } from "./Avatar";
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

/** Kutuyu sahne koordinatında mutlak yerleştirir (animasyon YOK — Preply §6). */
function yer(k: Kutu | null, goreli?: Kutu): CSSProperties {
  if (!k || k.w <= 0 || k.h <= 0) {
    return { visibility: "hidden", left: 0, top: 0, width: 0, height: 0 };
  }
  return {
    left: k.x - (goreli?.x ?? 0),
    top: k.y - (goreli?.y ?? 0),
    width: k.w,
    height: k.h,
  };
}

/** Preply paylaşım paneli başlığı: 40px. */
const PAYLASIM_BASLIGI = 40;

export function ZoomVideoSahnesi({
  telefon,
  yerlesim: y,
  karoUstu,
  onSurukleBasla,
}: {
  telefon: boolean;
  /** Preply düzeni (`lib/sinifDuzeni.ts`): tüm dikdörtgenler sahneye göre. */
  yerlesim: Yerlesim;
  /** Karo üstü denetim ("Düzeni değiştir"); yalnız masaüstünde. */
  karoUstu?: (hangi: "ben" | "karsi") => ReactNode;
  /** Sürüklenebilir karo/kutu için işaretçi başlangıcı. */
  onSurukleBasla?: (e: ReactPointerEvent<HTMLElement>) => void;
}) {
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

  const paylasimGorunur = paylasimVar && y.paylasim !== null;
  // Kendi paylaşımım varken onu gösteririm (SDK o sırada başkasınınkini vermez).
  const uzakPaylasimGorunur = paylasimGorunur && !benPaylasiyorum;
  const uzakK = uzak ? y.karsiKaro : null;
  const yuzenSinif = y.yuzen ? "rounded-ders shadow-[0_8px_32px_rgba(18,17,23,0.15)]" : "";
  // İki karolu yüzen kutu: kendi karo sol köşeler, karşı taraf sağ köşeler.
  const benKose = y.yuzen && uzakK ? "rounded-l-ders" : "rounded-ders";
  const karsiKose = y.yuzen ? "rounded-r-ders" : "rounded-ders";
  const benSurukle = y.suruklenebilir !== null ? onSurukleBasla : undefined;
  const karsiSurukle = y.suruklenebilir === "yuzen" ? onSurukleBasla : undefined;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
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

      {/* 2) paylaşım paneli — kalıcı; paylaşım yokken gizli. Preply: 40px
          başlık ("Ekranını paylaşıyorsun" + X) + görüntü. */}
      <div
        className="absolute overflow-hidden rounded-t-ders bg-black"
        style={yer(paylasimGorunur ? y.paylasim : null)}
        aria-hidden={!paylasimGorunur}
      >
        <div className="pointer-events-auto flex h-10 items-center gap-2 bg-ders-yuzey pl-3 pr-1 text-sm font-semibold text-white">
          <span className="min-w-0 flex-1 truncate">
            {benPaylasiyorum
              ? t("paylasimBasligi.ben")
              : t("paylasimBasligi.karsi", { ad: uzak?.ad ?? "" })}
          </span>
          {benPaylasiyorum && (
            <PlainButton
              onClick={() => void paylasimiDurdur()}
              aria-label={t("paylasimBasligi.durdur")}
              title={t("paylasimBasligi.durdur")}
              className="inline-flex h-10 w-10 items-center justify-center rounded hover:bg-ders-dugme focus-visible:outline focus-visible:outline-2 focus-visible:outline-marka-focus"
            >
              <Icon name="dismiss" className="h-5 w-5" />
            </PlainButton>
          )}
        </div>
        <div className="absolute inset-x-0 bottom-0" style={{ top: PAYLASIM_BASLIGI }}>
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
            {benPaylasiyorum && benTumEkran && !aynaUyarisiKapali && (
              <div className="pointer-events-auto absolute inset-0">
                <AynaUyarisi
                  onDurdur={() => void paylasimiDurdur()}
                  onYoksay={() => setAynaUyarisiKapali(true)}
                />
              </div>
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

      {/* Kart katmanları: oyuncuların KARDEŞİ, üstte; işaretçiyi yalnız
          bunlar alır (tahtanın üstündeki yüzen kutu çizimi yutmasın). */}
      <KaroKatmani
        className={`z-20 ${karsiKose}`}
        style={yer(uzakK)}
        ad={uzak?.ad}
        konusuyor={Boolean(uzak) && uzakKonusuyor}
        agSeviyesi={uzakAg}
        telefon={telefon}
        ust={uzak ? karoUstu?.("karsi") : undefined}
        onPointerDown={karsiSurukle}
      >
        {uzak && !uzakVideo && <KapaliKamera ad={uzak.ad} cap={y.karsiAvatar} />}
        {uzak && (
          <KaroBilgisi
            ad={uzak.ad}
            mikKapali={uzak.mikKapali}
            agSeviyesi={uzakAg}
            elKalkik={uzakEl}
            yenidenBaglaniyor={uzak.yenidenBaglaniyor}
            kucuk={uzakK !== null && uzakK.w < 400}
          />
        )}
      </KaroKatmani>
      <KaroKatmani
        className={`z-20 ${benKose}`}
        style={yer(y.benKaro)}
        ad={ben?.ad}
        konusuyor={Boolean(ben) && benKonusuyor}
        agSeviyesi={benAg}
        telefon={telefon}
        ust={ben ? karoUstu?.("ben") : undefined}
        onPointerDown={benSurukle}
      >
        {ben && !benVideo && <KapaliKamera ad={ben.ad} cap={y.benAvatar} />}
        {ben && (
          <KaroBilgisi
            ad={ben.ad}
            mikKapali={ben.mikKapali}
            agSeviyesi={benAg}
            elKalkik={benEl}
            yenidenBaglaniyor={ben.yenidenBaglaniyor || benKoptu}
            kucuk={y.benKaro.w < 400}
          />
        )}
      </KaroKatmani>
    </div>
  );
}

/**
 * Kamera kapalı karo (Preply §3.4): karo boyutu DEĞİŞMEZ, gizlenmez; koyu
 * zemin (`#302F3B`) + ortada yuvarlak avatar (çap düzene göre 32/48/96),
 * ad etiketi `KaroBilgisi`nde kalır.
 */
function KapaliKamera({ ad, cap }: { ad: string; cap: number }) {
  const renk = useMemo(() => katilimciRengi(ad), [ad]);
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#302F3B]">
      <div className="aspect-square" style={{ width: cap }}>
        <Avatar ad={ad} renk={renk} />
      </div>
    </div>
  );
}
