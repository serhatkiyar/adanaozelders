/**
 * Görüntü sahnesi — sağlayıcıdan bağımsız GENEL sahne: sürücünün medya
 * katmanı (`surucu().MedyaKatmani`: video kapları ve paylaşım oyuncuları,
 * z-10) ve üstünde karo katmanları (`KaroKatmani`, `KapaliKamera`, z-20),
 * paylaşım panelinin 40px başlığı ve `AynaUyarisi`.
 *
 * Başlık ve ayna uyarısı z-index'siz, medya katmanından SONRA çizilir:
 * paylaşım panelinin üstünde, yüzen video kutusunun (z-10) altında kalır
 * (bölünmeden önceki sıra).
 *
 * Düzen Preply sınıfınınkidir (`lib/sinifDuzeni.ts`: Odaklanma, Kareler,
 * Kenar çubuğu, Köşe/yüzen kutu, paylaşım + tahta bölmesi). Medya katmanı
 * kararlı bir bileşendir; düzen değişmek kapları yeniden kurmaz.
 *
 * Görünüm: Meet `ParticipantTile` / `.lk-participant-tile` (La Suite Meet,
 * MIT — DINUM/Etalab).
 */
import { useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";
import { katilimciRengi } from "@/lib/canliDers";
import type { Yerlesim } from "@/lib/sinifDuzeni";

import { surucu } from "../video/etkin";
import { yer } from "../video/yer";
import { paylasimiDurdur } from "./durum/medya";
import {
  useAgSeviyesi,
  useAktifPaylasim,
  useBenPaylasiyorum,
  useBenTumEkran,
  useBaglanti,
  useBen,
  useEliKalkik,
  useKarsiTaraf,
  useKonusuyor,
  usePaylasimVar,
} from "./durum/odaDeposu";
import { tercihleriOku } from "./durum/tercihler";
import { Avatar } from "./Avatar";
import { KaroBilgisi, KaroKatmani } from "./KaroBilgisi";
import { AynaUyarisi } from "./paylasim/AynaUyarisi";

/** Preply paylaşım paneli başlığı: 40px. */
const PAYLASIM_BASLIGI = 40;

export function VideoSahnesi({
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
  // Kararlı referans: sürücü tekildir, bileşeni modül düzeyindedir.
  const MedyaKatmani = surucu().MedyaKatmani;
  const uzak = useKarsiTaraf();
  const ben = useBen();
  const uzakKonusuyor = useKonusuyor(uzak?.id);
  const benKonusuyor = useKonusuyor(ben?.id);
  const uzakAg = useAgSeviyesi(uzak?.id);
  const benAg = useAgSeviyesi(ben?.id);
  const uzakEl = useEliKalkik(uzak?.id);
  const benEl = useEliKalkik(ben?.id);
  // Kendi bağlantımız koptuysa kendi kartımız da "yeniden bağlanıyor" der.
  const benKoptu = useBaglanti() === "yenidenBaglaniyor";
  const paylasimVar = usePaylasimVar();
  const aktifPaylasim = useAktifPaylasim();
  const benPaylasiyorum = useBenPaylasiyorum();
  const benTumEkran = useBenTumEkran();
  // Meet: "Yoksay" bu ders boyunca geçerli.
  const [aynaUyarisiKapali, setAynaUyarisiKapali] = useState(false);

  const uzakVideo = uzak?.videoAcik ?? false;
  const benVideo = ben?.videoAcik ?? false;

  const paylasimGorunur = paylasimVar && y.paylasim !== null;
  const uzakK = uzak ? y.karsiKaro : null;
  // İki karolu yüzen kutu: kendi karo sol köşeler, karşı taraf sağ köşeler.
  const benKose = y.yuzen && uzakK ? "rounded-l-ders" : "rounded-ders";
  const karsiKose = y.yuzen ? "rounded-r-ders" : "rounded-ders";
  const benSurukle = y.suruklenebilir !== null ? onSurukleBasla : undefined;
  const karsiSurukle = y.suruklenebilir === "yuzen" ? onSurukleBasla : undefined;
  // Paylaşım panelinin başlık şeridi ve altındaki görüntü alanı (sahneye göre).
  const panel = paylasimGorunur ? y.paylasim : null;
  const baslikKutusu = panel ? { ...panel, h: Math.min(PAYLASIM_BASLIGI, panel.h) } : null;
  const icerikKutusu =
    panel && panel.h > PAYLASIM_BASLIGI
      ? { ...panel, y: panel.y + PAYLASIM_BASLIGI, h: panel.h - PAYLASIM_BASLIGI }
      : null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <MedyaKatmani
        yerlesim={y}
        paylasimBaslikPx={PAYLASIM_BASLIGI}
        benId={ben?.id ?? null}
        benVideo={benVideo}
        ayna={tercihleriOku().ayna}
        karsiId={uzak?.id ?? null}
        karsiVideo={uzakVideo}
        aktifPaylasim={aktifPaylasim}
        benPaylasiyorum={benPaylasiyorum}
      />

      {/* Paylaşım paneli başlığı — Preply: 40px ("Ekranını paylaşıyorsun" + X). */}
      <div
        className="pointer-events-auto absolute flex items-center gap-2 overflow-hidden rounded-t-ders bg-ders-yuzey pl-3 pr-1 text-sm font-semibold text-white"
        style={yer(baslikKutusu)}
        aria-hidden={!paylasimGorunur}
      >
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

      {/* Kendi tüm ekranımı paylaşırken sonsuz yansıma uyarısı. */}
      {icerikKutusu && benPaylasiyorum && benTumEkran && !aynaUyarisiKapali && (
        <div className="pointer-events-auto absolute" style={yer(icerikKutusu)}>
          <AynaUyarisi
            onDurdur={() => void paylasimiDurdur()}
            onYoksay={() => setAynaUyarisiKapali(true)}
          />
        </div>
      )}

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
