/**
 * Katılmadan önceki önizleme — Meet `Join` düzeni (La Suite Meet, MIT —
 * DINUM/Etalab): koyu yüzey, 16:9 önizleme, üstte ve altta gradyan, ipucu
 * katmanı (kamera yok / izin yok / kullanımda / kapalı / açılıyor), altta
 * yuvarlak Mikrofon/Kamera düğmeleri; altında cihaz seçiciler, mikrofon
 * seviyesi ve hoparlör testi; sağda (telefonda altta) 360px sütun: ad
 * (biletten, salt okunur), ders ve saati, "Derse katıl". Lobi ve isim
 * alanı yok.
 *
 * Seçimler tarayıcıda saklanır (`zoom/tercihler.ts`) ve derse taşınır.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { PlainButton } from "@/components/ui/PlainButton";

import { DUGME_TABANI } from "../stiller";
import {
  cihazlarDegisti,
  gecerliCihazId,
  gorunenCihazId,
  kameraHataAnahtari,
  listeleriKur,
  mikIzniReddedildiMi,
  type CihazListeleri,
  type CihazTuru,
} from "../zoom/indirgeyiciler";
import { hoparlorSecilebilir } from "../zoom/istemci";
import {
  depoyaUygula,
  izinPenceresiniAc,
  useCihazlar,
  useIzinler,
  useOdaDeposu,
} from "../zoom/odaDeposu";
import {
  cihazlariGetir,
  kameraOnizlemeDurdur,
  onizlemeBaslat,
  onizlemeKameraSec,
  sesOnizlemeBaslat,
  sesOnizlemeDurdur,
} from "../zoom/onizleme";
import { tercihleriOku, tercihleriYaz } from "../zoom/tercihler";
import { useOnizlemeSeviyesi } from "../zoom/useOnizlemeSeviyesi";
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
  const cihazlar = listeleriKur(await cihazlariGetir());
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
}: {
  telefon: boolean;
  mikAcik: boolean;
  kameraAcik: boolean;
  onMik: (ac: boolean) => void;
  onKamera: (ac: boolean) => void;
  onKatil: () => void;
  /** Telefonda üst şeritte çıkış yok; önizlemeden çıkış buradan. */
  onAyril?: () => void;
  katiliyor: boolean;
  hata: string | null;
  /** Karşı tarafa görünen ad — giriş biletinden, değiştirilemez. */
  ad: string;
  dersBilgisi?: DersBilgisi;
  /** İzin penceresindeki "Yeniden dene" her basışta artırır. */
  deneme: number;
}) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
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
  // yeniden kurmasın; açıkken değişim `onizlemeKameraSec` ile yapılır).
  const kameraSecimi = useRef(secili.kamera);
  kameraSecimi.current = secili.kamera;
  const [yerelDeneme, setYerelDeneme] = useState(0);
  // Hatalı kamerada yeni seçim: iz yok, `switchCamera` işsiz; efekt yeniden kurar.
  const [kameraDeneme, setKameraDeneme] = useState(0);
  const hoparlorVar = hoparlorSecilebilir();
  const pencereAcildi = useRef(false);

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
    const el = video.current;
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
        await onizlemeBaslat(el, gecerliCihazId(kameraSecimi.current, liste.kamera));
        if (!gecerli) return;
        setKamera("acik");
        // İzin şimdi verildiyse cihaz adları artık okunabilir.
        void listeyiYenile();
      } catch (e) {
        if (gecerli) setKamera({ hata: kameraHataAnahtari(e) });
      }
    })();
    return () => {
      gecerli = false;
      void kameraOnizlemeDurdur();
    };
  }, [kameraAcik, katiliyor, deneme, yerelDeneme, kameraDeneme]);

  // Mikrofon önizlemesi (seviye çubuğu). Mikrofon değişince iz yeniden kurulur.
  const mikId = secili.mikrofon;
  useEffect(() => {
    if (!mikAcik || katiliyor) {
      setMik("kapali");
      void sesOnizlemeDurdur();
      return;
    }
    let gecerli = true;
    setMik("aciliyor");
    void (async () => {
      try {
        const liste = await listeyiYenile();
        if (!gecerli) return;
        await sesOnizlemeBaslat(gecerliCihazId(mikId, liste.mikrofon));
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
          onizlemeKameraSec(id).catch((e: unknown) => setKamera({ hata: kameraHataAnahtari(e) }));
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
                    <video
                      ref={video}
                      autoPlay
                      playsInline
                      muted
                      disablePictureInPicture
                      className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
                        tercihleriOku().ayna ? "-scale-x-100" : ""
                      } ${kamera === "acik" ? "opacity-100" : "opacity-0"}`}
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
          <PlainButton
            onClick={onKatil}
            disabled={katiliyor}
            className={`${DUGME_TABANI} h-12 w-full max-w-xs rounded-ders bg-marka px-6 text-lg font-semibold text-marka-fg hover:bg-marka-hover`}
          >
            {katiliyor && (
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-marka-fg/30 border-t-marka-fg"
                aria-hidden
              />
            )}
            {t(katiliyor ? "join.joining" : "join.joinLabel")}
          </PlainButton>
          {telefon && onAyril && (
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
