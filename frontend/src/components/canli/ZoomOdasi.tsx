/**
 * Canlı ders odası — ham Zoom Video SDK, La Suite Meet görünümüyle.
 *
 * Görsel katman Meet'ten uyarlandı (La Suite Meet, MIT — DINUM/Etalab; bkz.
 * frontend/THIRD_PARTY_NOTICES.md); medya katmanı `zoom/istemci.ts` üzerinden
 * doğrudan `@zoom/videosdk`. LiveKit/Panda/valtio/react-aria taşınmadı.
 *
 * `pages/CanliDers.tsx` bu dosyayı `lazy()` ile yükler: SDK ve i18next
 * YALNIZ bu parçaya girer. Sayfaya giriş/çıkış tam sayfa yüklemesiyledir
 * (`lib/tamSayfaGezinme.ts`).
 *
 * ## Dış sözleşme değişmedi
 *
 * Props ve `ZoomOdasiTutamak.ayril()` toolkit sürümüyle aynı; yalnız isteğe
 * bağlı props eklendi (`onAyrilIstegi`, `biletTazele`, `dersBilgisi`,
 * `sohbet`).
 *
 * ## Yan panel (Katılımcılar, ders içi sohbet)
 *
 * Masaüstünde sahnenin sağında açılır; sahne kabı AYNI düğümde kalır, yalnız
 * sağ boşluğu değişir (video yeniden bağlanmaz). Telefonda tam ekran açılır,
 * sahne altında çizili kalır ve ses sürer. Sohbet sitenin mesajlaşmasıdır.
 *
 * ## Ayrılma = argümansız `leave()`
 *
 * Öğretmen dahil herkes yalnız KENDİSİ ayrılır, ders karşı taraf için sürer
 * (kullanıcı kararı, 24 Eyl 2026). Oturumu bitiren çağrı kod tabanında yok.
 *
 * ## Akış
 *
 * önizleme → "Derse katıl" → bilet tazeliği → önizleme izleri durur → `join`
 * → ses (tercihe göre sessiz) → kamera (tercih açıksa) → oda.
 *
 * Mikrofon/kamera açık tercihi ve seçilen cihazlar tarayıcıda saklanır
 * (`zoom/tercihler.ts`); önizlemede seçilen cihazla derse girilir.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { I18nextProvider } from "react-i18next";

import { biletTazeMi, type KarsiTarafDurumu } from "@/lib/canliDers";
import { toast } from "@/store/toastStore";
import type { ZoomDersTokenOut } from "@/types";

import { dersI18n } from "./i18n";
import { AyarlarPenceresi, type AyarSekmesi } from "./oda/AyarlarPenceresi";
import { useDersKonusmasi, type DersSohbetBilgisi } from "./oda/dersKonusmasi";
import { DersSohbeti } from "./oda/DersSohbeti";
import { DurumSeritleri } from "./oda/DurumSeritleri";
import { IzinPenceresi } from "./oda/IzinPenceresi";
import { KatilimciListesi } from "./oda/KatilimciListesi";
import { KontrolCubugu, type PanelDenetimi } from "./oda/KontrolCubugu";
import { OnIzleme, type DersBilgisi } from "./oda/OnIzleme";
import { TelefonCubugu } from "./oda/TelefonCubugu";
import { YanPanel, type PanelTuru } from "./oda/YanPanel";
import { ZoomVideoSahnesi } from "./oda/ZoomVideoSahnesi";
import {
  beklenmedikKapanis,
  kameraHataAnahtari,
  digerAdlari,
  karsiTarafDurumu,
  katilimciFarki,
  type Katilimci,
} from "./zoom/indirgeyiciler";
import {
  ayril as istemcidenAyril,
  hazirla,
  izinleriIzle,
  kamerayiDegistir,
  katil,
  olaylariBagla,
  oturumdaMi,
  sesiBaslat,
} from "./zoom/istemci";
import { depoyuSifirla, useAsama, useOdaDeposu } from "./zoom/odaDeposu";
import { onizlemeDurdur } from "./zoom/onizleme";
import { tercihleriOku, tercihleriYaz } from "./zoom/tercihler";

export type { DersBilgisi, DersSohbetBilgisi };

/** "Mikrofonun kapalı" uyarısı en sık bu aralıkla (olay sürekli yinelenir). */
const KAPALI_KONUSMA_ARALIGI_MS = 30_000;

/**
 * "Ayrıldı" bildirimi bu kadar ertelenir: karşı tarafın kısa kopması
 * (failover, yeni `userId` ile dönüş) ayrılma gibi bildirilmesin.
 */
const AYRILDI_BEKLEME_MS = 5_000;

export interface ZoomOdasiTutamak {
  /** Yalnız KENDİNİ oturumdan çıkarır (host için de). En çok ~3 sn bekler. */
  ayril: () => Promise<void>;
}

export interface ZoomOdasiProps {
  bilet: ZoomDersTokenOut;
  /** Telefon düzeni: etiketli alt çubuk, kamerayı çevir. */
  telefon: boolean;
  /** Tek kişi kalınca oturumun kapanma süresi (dk; yalnız host'unki geçer). */
  bostaKalmaDk: number;
  onKarsiTaraf: (durum: KarsiTarafDurumu) => void;
  /** Oturum BİZİM ayrılmamız dışında kapandı (bağlantı koptu, atıldı…). */
  onKapandi: () => void;
  /** Kontrol çubuğundaki Ayrıl → sayfanın onaylı çıkış penceresi. */
  onAyrilIstegi?: () => void;
  /** Bilet bayatsa (5 dk'dan az kaldıysa) katılmadan önce yenisini getirir. */
  biletTazele?: () => Promise<ZoomDersTokenOut | undefined>;
  /** Önizlemenin sağ sütunu: ders adı ve saati. */
  dersBilgisi?: DersBilgisi;
  /** Ders içi sohbetin karşı tarafı; yoksa sohbet düğmesi görünmez. */
  sohbet?: DersSohbetBilgisi;
}

const ZoomOdasi = forwardRef<ZoomOdasiTutamak, ZoomOdasiProps>(function ZoomOdasi(
  props,
  ref,
) {
  // Geri çağrılar her çizimde güncel; bilet/süre ise İLK değerleriyle donar.
  const guncel = useRef(props);
  guncel.current = props;
  const { telefon, onAyrilIstegi, dersBilgisi, bilet, sohbet } = props;

  const asama = useAsama();
  const [mikTercihi, setMikTercihiDurumu] = useState(() => tercihleriOku().mikAcik);
  const [kameraTercihi, setKameraTercihiDurumu] = useState(() => tercihleriOku().kameraAcik);
  const setMikTercihi = useCallback((mikAcik: boolean) => {
    setMikTercihiDurumu(mikAcik);
    tercihleriYaz({ mikAcik });
  }, []);
  const setKameraTercihi = useCallback((kameraAcik: boolean) => {
    setKameraTercihiDurumu(kameraAcik);
    tercihleriYaz({ kameraAcik });
  }, []);
  const [deneme, setDeneme] = useState(0);
  const [ayarlar, setAyarlar] = useState<{ acik: boolean; sekme: AyarSekmesi }>({
    acik: false,
    sekme: "ses",
  });
  const ayarlariAc = useCallback((sekme: AyarSekmesi) => setAyarlar({ acik: true, sekme }), []);
  // `derseKatil` await'lerden SONRA okur: tıklama anının kapanımı değil, güncel tercih.
  const tercih = useRef({ mik: mikTercihi, kamera: kameraTercihi });
  tercih.current = { mik: mikTercihi, kamera: kameraTercihi };
  const [girisHatasi, setGirisHatasi] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelTuru | null>(null);
  const panelDegistir = useCallback(
    (tur: PanelTuru) => setPanel((p) => (p === tur ? null : tur)),
    [],
  );
  const paneliKapat = useCallback(() => setPanel(null), []);
  const konusma = useDersKonusmasi(sohbet);
  const [sohbetTaslagi, setSohbetTaslagi] = useState("");
  const panelDenetimi: PanelDenetimi = {
    panel,
    onPanel: panelDegistir,
    sohbetVar: Boolean(sohbet),
    okunmamis: konusma.okunmamis,
  };

  useImperativeHandle(ref, () => ({ ayril: () => odadanAyril() }), []);

  // Kurulum: depo sıfır, init (WASM ön yükleme) önizleme sırasında başlar,
  // olay köprüsü bağlanır. StrictMode'un kur-sök-kur döngüsü: söküm yalnız
  // dinleyicileri çözer; oturumdaysa (gerçek söküm) ayrılır.
  useEffect(() => {
    depoyuSifirla();
    void hazirla().catch((e) => console.warn("Zoom init", e));
    let sonUyari = 0;
    const coz = olaylariBagla({
      // `speaking-while-muted` konuştukça yinelenir; seyrek uyar.
      kapaliykenKonusma: () => {
        const simdi = Date.now();
        if (simdi - sonUyari < KAPALI_KONUSMA_ARALIGI_MS) return;
        sonUyari = simdi;
        toast.info(dersI18n.t("media.speakingWhileMuted"));
      },
    });
    const izinIzleme = izinleriIzle();
    return () => {
      coz();
      izinIzleme();
      if (oturumdaMi()) void istemcidenAyril();
      else void onizlemeDurdur();
    };
  }, []);

  // Karşı taraf, katıldı/ayrıldı bildirimleri ve beklenmedik kapanış —
  // yalnız katıldıktan sonra.
  useEffect(() => {
    let onceki: KarsiTarafDurumu | null = null;
    let kapandiBildirildi = false;
    // İlk görülen liste taban: odadakiler için "katıldı" denmez.
    // Karşı tarafların adları, alındığı andaki `benId` ile.
    let taban: Set<string> | null = null;
    let sonListe: readonly Katilimci[] | null = null;
    const bekleyenAyrilma = new Map<string, number>();
    let ayrildiZamanlayici: number | undefined;
    const yayinla = (durum: KarsiTarafDurumu) => {
      if (durum === onceki) return;
      onceki = durum;
      guncel.current.onKarsiTaraf(durum);
    };
    const coz = useOdaDeposu.subscribe((d) => {
      if (d.asama !== "odada") return;
      // Kendi bağlantımız kopukken liste boşalabilir: fark alınmaz, taban
      // korunur; bağlantı gelince aynı tabana göre karşılaştırılır.
      if (d.baglanti === "bagli" && !d.ayriliyor && d.katilimcilar !== sonListe) {
        sonListe = d.katilimcilar;
        const yeni = digerAdlari(d.katilimcilar, d.benId);
        if (taban === null) {
          taban = yeni;
        } else {
          const { katilanlar, ayrilanlar } = katilimciFarki(taban, yeni);
          taban = yeni;
          for (const ad of katilanlar) {
            const bekleyen = bekleyenAyrilma.get(ad);
            if (bekleyen !== undefined) {
              // Kısa kopma: ne ayrıldı ne katıldı.
              window.clearTimeout(bekleyen);
              bekleyenAyrilma.delete(ad);
            } else {
              toast.info(dersI18n.t("notifications.joined", { name: ad }));
            }
          }
          for (const ad of ayrilanlar) {
            bekleyenAyrilma.set(
              ad,
              window.setTimeout(() => {
                bekleyenAyrilma.delete(ad);
                toast.info(dersI18n.t("notifications.left", { name: ad }));
              }, AYRILDI_BEKLEME_MS),
            );
          }
        }
      }
      // Karşı taraf notu da bildirimle aynı kurala uyar: kendi bağlantımız
      // kopukken durum yayınlanmaz; "odada" → "ayrildi" geçişi kısa kopmaya
      // (yeni `userId` ile dönüş) karşı ertelenir, dönerse iptal edilir.
      if (d.baglanti === "bagli" && !d.ayriliyor) {
        const durum = karsiTarafDurumu(d);
        if (durum === "ayrildi" && onceki === "odada") {
          if (ayrildiZamanlayici === undefined) {
            ayrildiZamanlayici = window.setTimeout(() => {
              ayrildiZamanlayici = undefined;
              const g = useOdaDeposu.getState();
              if (g.baglanti === "bagli" && !g.ayriliyor && karsiTarafDurumu(g) === "ayrildi") {
                yayinla("ayrildi");
              }
            }, AYRILDI_BEKLEME_MS);
          }
        } else {
          window.clearTimeout(ayrildiZamanlayici);
          ayrildiZamanlayici = undefined;
          yayinla(durum);
        }
      }
      if (!kapandiBildirildi && beklenmedikKapanis(d)) {
        kapandiBildirildi = true;
        guncel.current.onKapandi();
      }
    });
    return () => {
      coz();
      for (const z of bekleyenAyrilma.values()) window.clearTimeout(z);
      window.clearTimeout(ayrildiZamanlayici);
    };
  }, []);

  const derseKatil = async () => {
    setGirisHatasi(null);
    useOdaDeposu.setState({ asama: "katiliyor", hata: null });
    let bilet = guncel.current.bilet;
    try {
      if (!biletTazeMi(bilet.expires_at) && guncel.current.biletTazele) {
        const yeni = await guncel.current.biletTazele();
        if (!yeni) throw new Error("bilet");
        bilet = yeni;
      }
    } catch {
      setGirisHatasi("join.errors.ticket");
      useOdaDeposu.setState({ asama: "onizleme" });
      return;
    }
    try {
      // Önizleme izi kamerayı bırakmadan startVideo çağrılırsa mobilde
      // VIDEO_CAMERA_IS_TAKEN.
      await onizlemeDurdur();
      await katil(bilet, guncel.current.bostaKalmaDk);
    } catch (e) {
      console.warn("Zoom join", e);
      setGirisHatasi("join.errors.join");
      useOdaDeposu.setState({ asama: "onizleme" });
      return;
    }
    useOdaDeposu.setState({ asama: "odada" });
    try {
      // İzin reddinde yalnız hoparlörle bağlanır: karşı taraf yine duyulur.
      if ((await sesiBaslat(!tercih.current.mik)) === "yalnizHoparlor") {
        useOdaDeposu.setState({ hata: "media.micNotGranted" });
      }
    } catch (e) {
      // iOS/Safari: `await join()` sonrası kullanıcı etkinleşmesi kaybolur.
      console.warn("Zoom startAudio", e);
      useOdaDeposu.setState({ sesEngellendi: true });
    }
    // Kamera izni reddedilmişse yalnız sesle girilir: denemek yalnız bir
    // hata şeridi doğururdu (yönlendirme önizlemede gösterildi).
    if (tercih.current.kamera && useOdaDeposu.getState().izinler.kamera !== "denied") {
      try {
        await kamerayiDegistir(true);
      } catch (e) {
        console.warn("Zoom startVideo", e);
        if (kameraHataAnahtari(e) !== "join.cameraNotGranted") {
          useOdaDeposu.setState({ hata: "media.deviceError" });
        }
      }
    }
  };

  const izinPenceresi = <IzinPenceresi onYenidenDene={() => setDeneme((n) => n + 1)} />;

  if (asama !== "odada") {
    return (
      <I18nextProvider i18n={dersI18n}>
        <OnIzleme
          telefon={telefon}
          mikAcik={mikTercihi}
          kameraAcik={kameraTercihi}
          onMik={setMikTercihi}
          onKamera={setKameraTercihi}
          onKatil={() => void derseKatil()}
          onAyril={onAyrilIstegi}
          katiliyor={asama === "katiliyor"}
          hata={girisHatasi}
          ad={bilet.kullanici_adi}
          dersBilgisi={dersBilgisi}
          deneme={deneme}
        />
        {izinPenceresi}
      </I18nextProvider>
    );
  }

  return (
    <I18nextProvider i18n={dersI18n}>
      <div className="absolute inset-0 flex flex-col bg-ders-zemin">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {/* Sahne HEP aynı düğüm: panel açılınca yalnız sağ boşluğu değişir
              (Meet `RoomContentArea`); kaplar yeniden kurulmaz. */}
          <div
            className="absolute inset-y-0 left-0 transition-[right] duration-500 ease-in-out"
            style={{ right: panel !== null && !telefon ? "calc(360px + 0.75rem)" : 0 }}
          >
            <ZoomVideoSahnesi telefon={telefon} />
            <DurumSeritleri mikTercihi={mikTercihi} />
          </div>
          <YanPanel panel={panel} telefon={telefon} onKapat={paneliKapat}>
            {(tur) =>
              tur === "sohbet" && sohbet ? (
                <DersSohbeti
                  acik={panel === "sohbet"}
                  sohbet={sohbet}
                  konusma={konusma}
                  taslak={sohbetTaslagi}
                  setTaslak={setSohbetTaslagi}
                />
              ) : (
                <KatilimciListesi benimRolum={bilet.rol} />
              )
            }
          </YanPanel>
        </div>
        {telefon ? (
          <TelefonCubugu onAyril={onAyrilIstegi} onAyarlar={ayarlariAc} panel={panelDenetimi} />
        ) : (
          <KontrolCubugu onAyril={onAyrilIstegi} onAyarlar={ayarlariAc} panel={panelDenetimi} />
        )}
      </div>
      <AyarlarPenceresi
        acik={ayarlar.acik}
        sekme={ayarlar.sekme}
        onSekme={(sekme) => setAyarlar({ acik: true, sekme })}
        onKapat={() => setAyarlar((a) => ({ ...a, acik: false }))}
      />
      {izinPenceresi}
    </I18nextProvider>
  );
});

/**
 * Önizleme kapanışı BEKLENMEZ: kamera izni sorusu açıkken önizleme sırası
 * (`onizleme.ts` `sirala`) soru yanıtlanana dek çözülmez; beklersek "Ayrıl"
 * takılır. İz, sıra açılınca yine durur. Oturumdaysak süre sınırı `ayril`da.
 */
async function odadanAyril(): Promise<void> {
  void onizlemeDurdur();
  await istemcidenAyril();
}

export default ZoomOdasi;
