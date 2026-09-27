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
 * Paylaşım başlığında "Tam alana genişlet" (uygulama içi odak, iki tarafta)
 * vardır; karşı tarafın paylaşımı yakınlaştırılabilir
 * (`paylasim/PaylasimYakinlastirma`: dönüşüm sürücünün sarmalayıcısına).
 * Paylaşım sahnede değilse (tahta odağında sahne dışı 1×1) başlık, uyarı ve
 * yakınlaştırma çizilmez: ekran dışı düğmeler odak almasın.
 *
 * Yüzen kutu `role="region"` ("Kamera kutusu") içindedir; küçültülünce
 * yerinde hap (masaüstü) ya da avatar balonu (telefon) durur (`KameraHapi`).
 *
 * Görünüm: Meet `ParticipantTile` / `.lk-participant-tile` (La Suite Meet,
 * MIT — DINUM/Etalab).
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";
import { useGecikmeliKapanis } from "@/hooks/useGecikmeliKapanis";
import { katilimciRengi } from "@/lib/canliDers";
import { videoKalitesi, type VideoKalitesi } from "@/lib/kameraKutusu";
import type { Kutu, Yerlesim } from "@/lib/sinifDuzeni";

import { surucu } from "../video/etkin";
import { yer } from "../video/yer";
import { useKameraKutusu } from "./durum/kameraKutusu";
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
import { PaylasimYakinlastirma } from "./paylasim/PaylasimYakinlastirma";

/** Preply paylaşım paneli başlığı: 40px. */
const PAYLASIM_BASLIGI = 40;
/** Gizlenen video bu kadar sonra durur; gösterme anında. */
const GIZLEME_GECIKMESI_MS = 1000;
/** Karo boyutu yerleştikten sonra kalite değişir. */
const KALITE_GECIKMESI_MS = 500;
/** Durdurulan video yeniden bağlanınca ilk kareye kadar en çok bu kadar avatar. */
const ILK_KARE_MS = 1500;

function ekranPikselOrani(): number {
  return typeof window !== "undefined" && window.devicePixelRatio > 0
    ? window.devicePixelRatio
    : 1;
}

/**
 * Karo genişliğinden istenecek kalite: 500 ms gecikmeli, ±%15
 * histerezisli. Karo gizliyken (sahne dışı 1×1) son değer korunur;
 * yeniden açılınca düşük kaliteyle başlayıp basamak basamak çıkmasın.
 */
function useGecikmeliKalite(w: number, gorunur: boolean): VideoKalitesi {
  const [kalite, setKalite] = useState<VideoKalitesi>(() => videoKalitesi(w, ekranPikselOrani()));

  useEffect(() => {
    if (!gorunur) return;
    const id = setTimeout(
      () => setKalite((onceki) => videoKalitesi(w, ekranPikselOrani(), onceki)),
      KALITE_GECIKMESI_MS,
    );
    return () => clearTimeout(id);
  }, [w, gorunur]);

  return kalite;
}

/**
 * Sürücüye inen görünürlük false → true olunca (video durdurulmuştu, yeniden
 * bağlanıyor) karoda kısa süre avatar örtüsü: siyah/donuk kare görünmesin.
 * Sağlayıcıdan bağımsız katmana ilk kare bildirimi gelmez; üst sınır süredir.
 */
function useIlkKareOrtusu(gorunur: boolean): boolean {
  const [ortu, setOrtu] = useState(false);
  const [onceki, setOnceki] = useState(gorunur);
  if (gorunur !== onceki) {
    setOnceki(gorunur);
    setOrtu(gorunur);
  }
  useEffect(() => {
    if (!ortu) return;
    const id = setTimeout(() => setOrtu(false), ILK_KARE_MS);
    return () => clearTimeout(id);
  }, [ortu]);
  return ortu;
}

/** Hap klavyeyle açılınca odak kutudaki karoya geçer (hap DOM'dan kalkar). */
function kutuyaOdaklan(): void {
  requestAnimationFrame(() => {
    const k =
      document.querySelector<HTMLElement>('[data-karo="karsi"]:not([inert])') ??
      document.querySelector<HTMLElement>('[data-karo="ben"]:not([inert])');
    k?.focus();
  });
}

export function VideoSahnesi({
  telefon,
  yerlesim: y,
  karoUstu,
  onSurukleBasla,
  sahneGenisligi,
  onPaylasimOdak,
}: {
  telefon: boolean;
  /** Preply düzeni (`lib/sinifDuzeni.ts`): tüm dikdörtgenler sahneye göre. */
  yerlesim: Yerlesim;
  /** Karo üstü denetim ("Video seçenekleri" menüsü); yalnız masaüstünde. */
  karoUstu?: (hangi: "ben" | "karsi") => ReactNode;
  /** Sürüklenebilir karo/kutu için işaretçi başlangıcı. */
  onSurukleBasla?: (e: ReactPointerEvent<HTMLElement>) => void;
  /** Sahne genişliği: sahne dışındaki (1×1) paylaşım paneli ayırt edilir. */
  sahneGenisligi: number;
  /** Paylaşım başlığındaki "Tam alana genişlet". */
  onPaylasimOdak: () => void;
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
  const kendiGizli = useKameraKutusu((s) => s.kendiGizli);
  const kucukAyarla = useKameraKutusu((s) => s.kucukAyarla);
  const ipucuId = useId();

  const uzakVideo = uzak?.videoAcik ?? false;
  const benVideo = ben?.videoAcik ?? false;
  // Sürücüye inen görünürlük/kalite: gizleme gecikmeli, gösterme anında.
  const benGorunur = useGecikmeliKapanis(y.benGorunur, GIZLEME_GECIKMESI_MS);
  const karsiGorunur = useGecikmeliKapanis(y.karsiGorunur, GIZLEME_GECIKMESI_MS);
  const karsiKalite = useGecikmeliKalite(y.karsiKaro?.w ?? 0, y.karsiGorunur);
  const benOrtu = useIlkKareOrtusu(benGorunur);
  const karsiOrtu = useIlkKareOrtusu(karsiGorunur);

  // Paylaşım sahnede mi: tahta odağında panel sahne dışında 1×1 durur.
  const paylasimGorunur =
    paylasimVar && y.paylasim !== null && y.paylasim.w > 1 && y.paylasim.x < sahneGenisligi;
  const paylasimOdakta = y.odak === "paylasim";
  // Yakınlaştırma: sürücü dönüşüm kabını kaydeder, nötr katman uygular.
  const donusumOgesi = useRef<HTMLDivElement | null>(null);
  const paylasimDonusumKabi = useCallback((el: HTMLDivElement | null) => {
    donusumOgesi.current = el;
  }, []);
  const uzakK = uzak ? y.karsiKaro : null;
  // İki karolu yüzen kutu: kendi karo sol köşeler, karşı taraf sağ köşeler.
  // Kendi görüntüm gizliyken karşı karo tek başına: dört köşe yuvarlak.
  const benKose = y.yuzen && uzakK ? "rounded-l-ders" : "rounded-ders";
  const karsiKose = y.yuzen && y.benGorunur ? "rounded-r-ders" : "rounded-ders";
  // Masaüstü: yüzen kutu serbest sürüklenir; telefon: köşeler arası kaydırma.
  const kutuHareketi = y.suruklenebilir === "yuzen" || (y.yuzen && y.kaydirilabilir);
  const benSurukle = y.suruklenebilir !== null || kutuHareketi ? onSurukleBasla : undefined;
  const karsiSurukle = kutuHareketi ? onSurukleBasla : undefined;
  // Ekran dışındaki (1×1) karolar — videolar gizli, kutu küçültülmüş, kendi
  // görüntün gizli — `inert`: odak ve ekran okuyucu onlara ulaşmasın.
  const gizli = y.daraltDugmesi?.gizli ?? false;
  const benInert = gizli || !y.benGorunur;
  const karsiInert = gizli || !y.karsiGorunur;
  const kendiGizliUygulandi = kendiGizli && Boolean(uzak);
  // Küçültülmüş kutuda karşı taraf (yoksa kendin) gösterilir.
  const hapKisi = uzak ?? ben;
  // Paylaşım panelinin başlık şeridi ve altındaki görüntü alanı (sahneye göre).
  const panel = paylasimGorunur ? y.paylasim : null;
  const baslikKutusu = panel ? { ...panel, h: Math.min(PAYLASIM_BASLIGI, panel.h) } : null;
  const icerikKutusu =
    panel && panel.h > PAYLASIM_BASLIGI
      ? { ...panel, y: panel.y + PAYLASIM_BASLIGI, h: panel.h - PAYLASIM_BASLIGI }
      : null;

  return (
    <div id="ders-video-alani" className="pointer-events-none absolute inset-0 overflow-hidden">
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
        benGorunur={benGorunur}
        karsiGorunur={karsiGorunur}
        karsiKalite={karsiKalite}
        paylasimDonusumKabi={paylasimDonusumKabi}
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
        <PlainButton
          onClick={onPaylasimOdak}
          aria-label={t("duzen.odak")}
          aria-pressed={paylasimOdakta}
          title={t(paylasimOdakta ? "duzen.odaktanCik" : "duzen.odak")}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded hover:bg-ders-dugme focus-visible:outline focus-visible:outline-2 focus-visible:outline-marka-focus"
        >
          <Icon
            name={paylasimOdakta ? "fullScreenMinimize" : "fullScreenMaximize"}
            className="h-5 w-5"
          />
        </PlainButton>
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

      {/* Karşı tarafın paylaşımında yakınlaştırma (paylaşan değişince sıfır). */}
      {icerikKutusu && aktifPaylasim !== null && !benPaylasiyorum && (
        <PaylasimYakinlastirma
          key={aktifPaylasim}
          kutu={icerikKutusu}
          donusumOgesi={donusumOgesi}
          telefon={telefon}
        />
      )}

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
      {/* Yüzen kutu: karolar ve küçültülmüş hali tek bölge. Sarmalayıcı her
          düzende aynı düğüm (karolar yeniden kurulmaz); rolü yalnız yüzerken. */}
      <div
        role={y.yuzen ? "region" : undefined}
        aria-label={y.yuzen ? t("duzen.kameraKutusu") : undefined}
        aria-describedby={y.yuzen && telefon ? ipucuId : undefined}
      >
        {y.yuzen && telefon && (
          <p id={ipucuId} className="sr-only">
            {t("duzen.kaydirIpucu")}
          </p>
        )}
        <KaroKatmani
          className={`z-20 ${karsiKose}`}
          style={yer(uzakK)}
          ad={uzak?.ad}
          konusuyor={Boolean(uzak) && uzakKonusuyor}
          agSeviyesi={uzakAg}
          telefon={telefon}
          gizli={karsiInert}
          ust={uzak ? karoUstu?.("karsi") : undefined}
          onPointerDown={karsiSurukle}
          karo="karsi"
        >
          {uzak && (!uzakVideo || karsiOrtu) && <KapaliKamera ad={uzak.ad} cap={y.karsiAvatar} />}
          {uzak && (
            <KaroBilgisi
              ad={uzak.ad}
              mikKapali={uzak.mikKapali}
              agSeviyesi={uzakAg}
              elKalkik={uzakEl}
              yenidenBaglaniyor={uzak.yenidenBaglaniyor}
              kucuk={uzakK !== null && uzakK.w < 400}
              kendiGizli={kendiGizliUygulandi}
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
          gizli={benInert}
          ust={ben ? karoUstu?.("ben") : undefined}
          onPointerDown={benSurukle}
          karo="ben"
        >
          {ben && (!benVideo || benOrtu) && <KapaliKamera ad={ben.ad} cap={y.benAvatar} />}
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
        {y.kucukHal && hapKisi && (
          <KameraHapi
            tur={y.kucukHal.tur}
            kutu={y.kucukHal.kutu}
            ad={hapKisi.ad}
            konusuyor={uzak ? uzakKonusuyor : benKonusuyor}
            mikKapali={hapKisi.mikKapali}
            onAc={(klavye) => {
              kucukAyarla(false);
              if (klavye) kutuyaOdaklan();
            }}
            onPointerDown={y.kaydirilabilir ? onSurukleBasla : undefined}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Küçültülmüş kamera kutusu: masaüstünde ~200×40 hap (avatar + ad + mik
 * kapalı), telefonda 48px avatar balonu; konuşurken halka. Tıklayınca /
 * dokununca kutu yeniden açılır. Video bu sırada durur.
 */
function KameraHapi({
  tur,
  kutu,
  ad,
  konusuyor,
  mikKapali,
  onAc,
  onPointerDown,
}: {
  tur: "hap" | "balon";
  kutu: Kutu;
  ad: string;
  konusuyor: boolean;
  mikKapali: boolean;
  /** `klavye`: Enter/Boşluk ile açıldı (odak kutuya taşınır). */
  onAc: (klavye: boolean) => void;
  /** Telefonda balon da köşeler arasında kaydırılır. */
  onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
}) {
  const { t } = useTranslation();
  const renk = useMemo(() => katilimciRengi(ad), [ad]);
  const balon = tur === "balon";
  return (
    <PlainButton
      data-kamera-hapi
      onClick={(e) => onAc(e.detail === 0)}
      onPointerDown={onPointerDown}
      aria-label={t("duzen.kutuyuAc", { ad })}
      title={t("duzen.kutuyuAc", { ad })}
      style={yer(kutu)}
      className={`pointer-events-auto absolute z-20 flex items-center rounded-full bg-ders-yuzey text-white shadow-lg hover:bg-ders-dugme focus-visible:outline focus-visible:outline-2 focus-visible:outline-marka-focus ${
        balon ? "touch-none justify-center p-0.5" : "gap-2 pl-1 pr-3"
      }`}
    >
      <span aria-hidden className="aspect-square shrink-0" style={{ width: balon ? 44 : 32 }}>
        <Avatar ad={ad} renk={renk} />
      </span>
      {!balon && <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">{ad}</span>}
      {!balon && mikKapali && (
        <span aria-hidden className="inline-flex shrink-0 rounded bg-ders-tehlike p-0.5">
          <Icon name="micOff" className="h-4 w-4" />
        </span>
      )}
      {konusuyor && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] animate-ders-konusma"
        />
      )}
    </PlainButton>
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
