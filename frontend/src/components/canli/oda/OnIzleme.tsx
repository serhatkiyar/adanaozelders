/**
 * Katılmadan önceki önizleme — Meet `Join` düzeni (La Suite Meet, MIT —
 * DINUM/Etalab): koyu yüzey, 16:9 önizleme, üstte ve altta gradyan, ipucu
 * katmanı (kamera yok / izin yok / kullanımda / kapalı / açılıyor), altta
 * yuvarlak Mikrofon/Kamera düğmeleri; altında cihaz seçiciler, mikrofon
 * seviyesi, hoparlör testi ve arka plan seçimi (Meet `EffectsConfiguration`;
 * önizlemenin iç öğesini ve aynasını sürücü kurar); sağda (telefonda altta) 360px sütun: ad
 * (biletten, salt okunur), ders ve saati, "Derse katıl". Lobi ve isim
 * alanı yok.
 *
 * Karşı taraf beklenirken (`bekleme`, `oda/durum/bekleme.ts`) önizleme
 * sürer; "Derse katıl"ın yerinde "{ad} bekleniyor…" ve iptal düğmesi durur.
 *
 * Seçimler tarayıcıda saklanır (`durum/tercihler.ts`) ve derse taşınır.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { PlainButton } from "@/components/ui/PlainButton";

import { DUGME_TABANI } from "../stiller";
import type { ArkaPlan } from "../video/arkaPlan";
import { surucu } from "../video/etkin";
import {
  cihazlarDegisti,
  gecerliCihazId,
  gorunenCihazId,
  kameraHataAnahtari,
  listeleriKur,
  mikIzniReddedildiMi,
  type CihazListeleri,
  type CihazTuru,
} from "./durum/indirgeyiciler";
import {
  depoyaUygula,
  izinPenceresiniAc,
  useCihazlar,
  useIzinler,
  useOdaDeposu,
} from "./durum/odaDeposu";
import { tercihleriOku, tercihleriYaz } from "./durum/tercihler";
import { useArkaPlanDestegi } from "./durum/useMedyaKontrolleri";
import { useOnizlemeSeviyesi } from "./durum/useOnizlemeSeviyesi";
import { ArkaPlanSecici } from "./ArkaPlanSecici";
import { CihazSecici, HoparlorTesti } from "./CihazSecici";
import { MedyaDugmesi } from "./MedyaDugmeleri";
import { SesSeviyesi } from "./SesSeviyesi";

type KameraDurumu = "kapali" | "aciliyor" | "acik" | { hata: string };
type MikDurumu = "kapali" | "aciliyor" | "acik" | "izinYok" | "hata";

export interface DersBilgisi {
  baslik: string;
  saat: string;
}

/** Cihaz listesini okuyup depoya yazar; okunan listeyi döndürür. */
async function listeyiYenile(): Promise<CihazListeleri> {
  const cihazlar = listeleriKur(await surucu().onizleme.cihazlariGetir());
  depoyaUygula((d) => cihazlarDegisti(d, cihazlar, {}));
  return useOdaDeposu.getState().cihazlar;
}

function seciliKimlik(tur: CihazTuru): string | undefined {
  const t = tercihleriOku();
  return tur === "mikrofon" ? t.mikrofonId : tur === "hoparlor" ? t.hoparlorId : t.kameraId;
}

export function OnIzleme({
  telefon,
  mikAcik,
  kameraAcik,
  onMik,
  onKamera,
  onKatil,
  onAyril,
  katiliyor,
  hata,
  ad,
  dersBilgisi,
  deneme,
  bekleme = null,
  karsiAd,
  onBeklemeIptal,
}: {
  telefon: boolean;
  mikAcik: boolean;
  kameraAcik: boolean;
  onMik: (ac: boolean) => void;
  onKamera: (ac: boolean) => void;
  onKatil: () => void;
  /** Sayfada üst şerit yok (Meet): önizlemeden çıkış buradan. */
  onAyril?: () => void;
  katiliyor: boolean;
  hata: string | null;
  /** Karşı tarafa görünen ad — giriş biletinden, değiştirilemez. */
  ad: string;
  dersBilgisi?: DersBilgisi;
  /** İzin penceresindeki "Yeniden dene" her basışta artırır. */
  deneme: number;
  /**
   * "Derse katıl"dan sonra bağlanmadan önceki bekleme: ders kanalı açılıyor
   * (`hazirlaniyor`) ya da karşı taraf sayfada değil (`karsiTaraf`).
   * Önizleme (kamera/mikrofon) bu sürede açık kalır.
   */
  bekleme?: "hazirlaniyor" | "karsiTaraf" | null;
  /** Beklenen karşı tarafın adı; yoksa adsız metin. */
  karsiAd?: string;
  onBeklemeIptal?: () => void;
}) {
  const { t } = useTranslation();
  // Önizlemenin kabı: iç öğeyi (`<video>`/`<canvas>`) ve aynayı sürücü kurar.
  const kap = useRef<HTMLDivElement>(null);
  // Telefon tarayıcılarında sanal arka plan yok.
  const arkaPlanVar = useArkaPlanDestegi(!telefon);
  const [arkaPlan, setArkaPlan] = useState<ArkaPlan>(() => tercihleriOku().arkaPlan);
  // Kameraya verilen arka plan: telefonda hiç yok (sürücü desteği ayrıca sınar).
  const etkinArkaPlan: ArkaPlan = telefon ? "yok" : arkaPlan;
  const arkaPlanSecimi = useRef(etkinArkaPlan);
  arkaPlanSecimi.current = etkinArkaPlan;
  const [arkaPlanHatasi, setArkaPlanHatasi] = useState(false);
  const cihazlar = useCihazlar();
  const izinler = useIzinler();
  const [kamera, setKamera] = useState<KameraDurumu>(kameraAcik ? "aciliyor" : "kapali");
  const [mik, setMik] = useState<MikDurumu>("kapali");
  const [secili, setSecili] = useState(() => ({
    mikrofon: seciliKimlik("mikrofon"),
    hoparlor: seciliKimlik("hoparlor"),
    kamera: seciliKimlik("kamera"),
  }));
  // Kamera sırasında okunan güncel seçim (efekt kamerayı seçim değişince
  // yeniden kurmasın; açıkken değişim `onizleme.kameraSec` ile yapılır).
  const kameraSecimi = useRef(secili.kamera);
  kameraSecimi.current = secili.kamera;
  const [yerelDeneme, setYerelDeneme] = useState(0);
  // Hatalı kamerada yeni seçim: iz yok, `switchCamera` işsiz; efekt yeniden kurar.
  const [kameraDeneme, setKameraDeneme] = useState(0);
  const hoparlorVar = surucu().destekler.hoparlorSecimi();
  const pencereAcildi = useRef(false);
  // "Derse katıl" bekleme kutusuna dönüşünce odak kaybolmasın: iptale taşınır.
  const iptalDugmesi = useRef<HTMLButtonElement>(null);
  const karsiBekleniyor = bekleme === "karsiTaraf";
  useEffect(() => {
    if (karsiBekleniyor) iptalDugmesi.current?.focus();
  }, [karsiBekleniyor]);
  const katilDugmesiMesgul = katiliyor || bekleme === "hazirlaniyor";

  // Cihaz listesi: açılışta (daha önce izin verildiyse kimlikler hemen
  // gelir) ve cihaz takılıp çıkarıldıkça.
  useEffect(() => {
    void listeyiYenile();
    const md = navigator.mediaDevices;
    const degisti = () => void listeyiYenile();
    md?.addEventListener?.("devicechange", degisti);
    return () => md?.removeEventListener?.("devicechange", degisti);
  }, []);

  // Kamera önizlemesi.
  useEffect(() => {
    const el = kap.current;
    if (!kameraAcik || !el || katiliyor) {
      setKamera("kapali");
      return;
    }
    let gecerli = true;
    setKamera("aciliyor");
    void (async () => {
      try {
        const liste = await listeyiYenile();
        if (!gecerli) return;
        const { arkaPlanUygulandi } = await surucu().onizleme.kameraBaslat(el, {
          kameraId: gecerliCihazId(kameraSecimi.current, liste.kamera),
          ayna: tercihleriOku().ayna,
          arkaPlan: arkaPlanSecimi.current,
        });
        if (!gecerli) return;
        setKamera("acik");
        if (!arkaPlanUygulandi) setArkaPlanHatasi(true);
        // İzin şimdi verildiyse cihaz adları artık okunabilir.
        void listeyiYenile();
      } catch (e) {
        if (gecerli) setKamera({ hata: kameraHataAnahtari(e) });
      }
    })();
    return () => {
      gecerli = false;
      void surucu().onizleme.kameraDurdur();
    };
  }, [kameraAcik, katiliyor, deneme, yerelDeneme, kameraDeneme]);

  // Arka plan değişimi: sürücü iz yeniden kurulmadan günceller ya da
  // (`<video>` ↔ canvas) izi yeni öğede kurar.
  const kameraHazir = kamera === "acik";
  useEffect(() => {
    if (!kameraHazir) return;
    surucu()
      .onizleme.arkaPlan(etkinArkaPlan)
      .then(({ uygulandi }) => {
        if (!uygulandi) setArkaPlanHatasi(true);
      })
      .catch((e: unknown) => {
        console.warn("Önizleme arka planı", e);
        setArkaPlanHatasi(true);
      });
  }, [etkinArkaPlan, kameraHazir]);

  const arkaPlanSec = useCallback((ap: ArkaPlan) => {
    setArkaPlanHatasi(false);
    setArkaPlan(ap);
    tercihleriYaz({ arkaPlan: ap });
  }, []);

  // Mikrofon önizlemesi (seviye çubuğu). Mikrofon değişince iz yeniden kurulur.
  const mikId = secili.mikrofon;
  useEffect(() => {
    if (!mikAcik || katiliyor) {
      setMik("kapali");
      void surucu().onizleme.sesDurdur();
      return;
    }
    let gecerli = true;
    setMik("aciliyor");
    void (async () => {
      try {
        const liste = await listeyiYenile();
        if (!gecerli) return;
        await surucu().onizleme.sesBaslat(gecerliCihazId(mikId, liste.mikrofon));
        if (!gecerli) return;
        setMik("acik");
        void listeyiYenile();
      } catch (e) {
        if (gecerli) setMik(mikIzniReddedildiMi(e) ? "izinYok" : "hata");
      }
    })();
    return () => {
      gecerli = false;
    };
  }, [mikAcik, katiliyor, mikId, deneme, yerelDeneme]);

  const kameraIzniYok = typeof kamera === "object" && kamera.hata === "join.cameraNotGranted";
  const mikIzniYok = mik === "izinYok" || izinler.mikrofon === "denied";

  // İzin reddedilince yönlendirme penceresi bir kez kendiliğinden açılır;
  // sonra ipucundaki düğmeyle yeniden açılabilir.
  useEffect(() => {
    if ((kameraIzniYok || mik === "izinYok") && !pencereAcildi.current) {
      pencereAcildi.current = true;
      izinPenceresiniAc(true);
    }
  }, [kameraIzniYok, mik]);

  // Tarayıcı ayarından izin verilince önizleme kendiliğinden yeniden dener.
  const kameraIzni = izinler.kamera;
  const mikrofonIzni = izinler.mikrofon;
  const kameraHatali = typeof kamera === "object";
  useEffect(() => {
    if (
      (kameraIzni === "granted" && kameraHatali) ||
      (mikrofonIzni === "granted" && (mik === "izinYok" || mik === "hata"))
    ) {
      setYerelDeneme((n) => n + 1);
    }
    // Yalnız izin DEĞİŞİMİNDE; hata durumu kendi başına döngü kurmasın.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kameraIzni, mikrofonIzni]);

  const seviye = useOnizlemeSeviyesi(mikAcik && mik === "acik");

  const sec = useCallback(
    (tur: CihazTuru, id: string) => {
      setSecili((s) => ({ ...s, [tur]: id }));
      if (tur === "mikrofon") tercihleriYaz({ mikrofonId: id });
      if (tur === "hoparlor") tercihleriYaz({ hoparlorId: id });
      if (tur === "kamera") {
        tercihleriYaz({ kameraId: id });
        if (kameraAcik && kameraHatali) {
          setKameraDeneme((n) => n + 1);
        } else if (kameraAcik) {
          surucu()
            .onizleme.kameraSec(id)
            .catch((e: unknown) => setKamera({ hata: kameraHataAnahtari(e) }));
        }
      }
    },
    [kameraAcik, kameraHatali],
  );

  // İpucu (Meet `getPreviewMessages`): hata `alert`, durum `status`.
  let ipucu: string | null = null;
  let izinDugmesi: string | null = null;
  if (typeof kamera === "object") {
    if (kameraIzniYok) {
      const anahtar = mikIzniYok ? "cameraAndMicNotGranted" : "cameraNotGranted";
      ipucu = t(`join.${anahtar}`);
      izinDugmesi = t(`join.permissionsButton.${anahtar}`);
    } else {
      ipucu = t(kamera.hata);
    }
  } else if (kamera === "kapali") {
    ipucu = t("join.cameraDisabled");
  } else if (kamera === "aciliyor") {
    ipucu = t("join.cameraStarting");
  }
  const hataVar = typeof kamera === "object";

  const bosMetin = (tur: CihazTuru) =>
    (tur === "kamera" ? kameraIzniYok : mikIzniYok)
      ? t("selectDevice.permissionsNeeded")
      : (tur === "kamera" ? kamera === "aciliyor" : mik === "aciliyor")
        ? t("selectDevice.loading")
        : t("selectDevice.permissionsNeeded");

  return (
    <div className="absolute inset-0 overflow-y-auto bg-ders-zemin text-white">
      <div className="flex min-h-full w-full flex-col items-center justify-center gap-4 p-2 sm:gap-8 sm:p-4 lg:flex-row">
        <div className="flex w-full min-w-0 max-w-[764px] items-center justify-center lg:flex-1">
          <div className="flex w-full min-w-0 flex-col">
            <div className="relative w-full min-w-0 overflow-hidden rounded-2xl sm:min-w-[320px]">
              <div className="relative aspect-video w-full">
                <div className="absolute inset-0 overflow-hidden bg-black">
                  <div
                    role="status"
                    aria-label={t(`join.videoPreview.${kamera === "acik" ? "enabled" : "disabled"}`)}
                    className="absolute inset-0"
                  >
                    <div
                      ref={kap}
                      className={`absolute inset-0 transition-opacity duration-300 ${
                        kamera === "acik" ? "opacity-100" : "opacity-0"
                      }`}
                    />
                  </div>
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-4 text-center">
                    <p
                      role="alert"
                      className="text-balance text-base text-white sm:text-xl lg:text-2xl"
                    >
                      {hataVar ? ipucu : null}
                    </p>
                    <p
                      role="status"
                      className="text-balance text-base text-white sm:text-xl lg:text-2xl"
                    >
                      {!hataVar ? ipucu : null}
                    </p>
                    {izinDugmesi && (
                      <PlainButton
                        onClick={() => izinPenceresiniAc(true)}
                        className={`${DUGME_TABANI} h-10 rounded-ders bg-white px-4 text-sm text-ders-zemin hover:bg-white/90`}
                      >
                        {izinDugmesi}
                      </PlainButton>
                    )}
                  </div>
                </div>
                <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-20 bg-gradient-to-b from-black/60 via-black/20 to-transparent" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-20 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                <div className="absolute bottom-4 left-1/2 z-[2] flex -translate-x-1/2 gap-4">
                  {/* Katılma sürerken tercih kilitli: görünen durum = derse girilen durum. */}
                  <MedyaDugmesi
                    tur="mik"
                    gorunum="onizleme"
                    acik={mikAcik}
                    mesgul={katiliyor}
                    onDegistir={onMik}
                  />
                  <MedyaDugmesi
                    tur="kamera"
                    gorunum="onizleme"
                    acik={kameraAcik}
                    mesgul={katiliyor}
                    onDegistir={onKamera}
                  />
                </div>
              </div>
            </div>

            {/* Meet `DeviceSelectors`: telefonda alt alta, geniş ekranda yan yana. */}
            <div
              className={`mx-auto mt-3 grid w-full gap-3 px-1 sm:w-4/5 sm:px-0 ${
                hoparlorVar ? "sm:grid-cols-3" : "sm:grid-cols-2"
              }`}
            >
              <div className="min-w-0">
                <CihazSecici
                  tur="mikrofon"
                  cihazlar={cihazlar.mikrofon}
                  secili={gorunenCihazId(secili.mikrofon, cihazlar.mikrofon)}
                  onSec={(id) => sec("mikrofon", id)}
                  bosMetin={bosMetin("mikrofon")}
                />
                <SesSeviyesi oran={seviye} />
              </div>
              {hoparlorVar && (
                <div className="min-w-0">
                  <CihazSecici
                    tur="hoparlor"
                    cihazlar={cihazlar.hoparlor}
                    secili={gorunenCihazId(secili.hoparlor, cihazlar.hoparlor)}
                    onSec={(id) => sec("hoparlor", id)}
                    bosMetin={bosMetin("mikrofon")}
                  />
                  <HoparlorTesti
                    hoparlorId={gecerliCihazId(secili.hoparlor, cihazlar.hoparlor)}
                  />
                </div>
              )}
              <div className="min-w-0">
                <CihazSecici
                  tur="kamera"
                  cihazlar={cihazlar.kamera}
                  secili={gorunenCihazId(secili.kamera, cihazlar.kamera)}
                  onSec={(id) => sec("kamera", id)}
                  bosMetin={bosMetin("kamera")}
                />
              </div>
            </div>
            <div className="mx-auto mt-3 w-full px-1 sm:w-4/5 sm:px-0">
              <p className="mb-1.5 text-sm font-medium text-white/80">
                {t("settings.video.background.heading")}
              </p>
              <ArkaPlanSecici
                secili={arkaPlan}
                onSec={arkaPlanSec}
                destekli={arkaPlanVar}
                mesgul={katiliyor}
              />
              {arkaPlanHatasi && (
                <p role="alert" className="mt-1.5 text-sm text-ders-hata-fg">
                  {t("media.backgroundFailed")}
                </p>
              )}
            </div>
          </div>
        </div>

        <div
          className={`flex w-full flex-col items-center gap-4 text-center lg:w-ders-panel lg:flex-none ${
            telefon ? "pb-4" : ""
          }`}
        >
          <h2 className="text-2xl font-semibold">{t("join.heading")}</h2>
          <dl className="w-full max-w-xs space-y-3 rounded-ders bg-ders-yuzey px-4 py-3 text-left">
            <div>
              <dt className="text-xs font-medium text-white/60">{t("join.usernameLabel")}</dt>
              <dd className="truncate text-base font-semibold">{ad}</dd>
              <dd className="text-xs text-white/60">{t("join.usernameHint")}</dd>
            </div>
            {dersBilgisi && (
              <div>
                <dt className="text-xs font-medium text-white/60">{t("join.lessonTime")}</dt>
                <dd className="truncate text-base font-semibold">{dersBilgisi.baslik}</dd>
                <dd className="text-sm tabular-nums text-white/80">{dersBilgisi.saat}</dd>
              </div>
            )}
          </dl>
          <p className="text-sm text-white/70">
            {t("join.micHint", { durum: t(mikAcik ? "join.micOn" : "join.micOff") })}
          </p>
          {karsiBekleniyor ? (
            <>
              <div
                role="status"
                className="flex w-full max-w-xs flex-col items-center gap-1 rounded-ders bg-ders-yuzey px-4 py-3"
              >
                <span className="flex items-center gap-2 text-base font-semibold">
                  <span
                    className="h-4 w-4 flex-none animate-spin rounded-full border-2 border-white/30 border-t-white"
                    aria-hidden
                  />
                  {karsiAd
                    ? t("join.waiting.title", { name: karsiAd })
                    : t("join.waiting.titleAnon")}
                </span>
                <span className="text-xs text-white/60">{t("join.waiting.hint")}</span>
              </div>
              <PlainButton
                ref={iptalDugmesi}
                onClick={onBeklemeIptal}
                className={`${DUGME_TABANI} h-11 w-full max-w-xs rounded-ders bg-ders-dugme px-6 text-base text-white hover:bg-ders-hover`}
              >
                {t("join.waiting.cancel")}
              </PlainButton>
            </>
          ) : (
            <PlainButton
              onClick={onKatil}
              disabled={katilDugmesiMesgul}
              className={`${DUGME_TABANI} h-12 w-full max-w-xs rounded-ders bg-marka px-6 text-lg font-semibold text-marka-fg hover:bg-marka-hover`}
            >
              {katilDugmesiMesgul && (
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-marka-fg/30 border-t-marka-fg"
                  aria-hidden
                />
              )}
              {t(katilDugmesiMesgul ? "join.joining" : "join.joinLabel")}
            </PlainButton>
          )}
          {onAyril && (
            <PlainButton
              onClick={onAyril}
              disabled={katiliyor}
              className={`${DUGME_TABANI} h-11 w-full max-w-xs rounded-ders bg-ders-dugme px-6 text-base text-white hover:bg-ders-hover`}
            >
              {t("controls.leave")}
            </PlainButton>
          )}
          {hata && (
            <p role="alert" className="max-w-xs text-sm text-ders-hata-fg">
              {t(hata)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
