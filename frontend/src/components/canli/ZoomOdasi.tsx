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
 * bağlı iki prop eklendi (`onAyrilIstegi`, `biletTazele`).
 *
 * ## Ayrılma = argümansız `leave()`
 *
 * Öğretmen dahil herkes yalnız KENDİSİ ayrılır, ders karşı taraf için sürer
 * (kullanıcı kararı, 24 Eyl 2026). Oturumu bitiren çağrı kod tabanında yok.
 *
 * ## Akış
 *
 * önizleme → "Derse katıl" → bilet tazeliği → önizleme izi durur → `join`
 * → ses (tercihe göre sessiz) → kamera (tercih açıksa) → oda.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { I18nextProvider } from "react-i18next";

import { biletTazeMi, type KarsiTarafDurumu } from "@/lib/canliDers";
import type { ZoomDersTokenOut } from "@/types";

import { dersI18n } from "./i18n";
import { DurumSeritleri } from "./oda/DurumSeritleri";
import { KontrolCubugu } from "./oda/KontrolCubugu";
import { OnIzleme } from "./oda/OnIzleme";
import { TelefonCubugu } from "./oda/TelefonCubugu";
import { ZoomVideoSahnesi } from "./oda/ZoomVideoSahnesi";
import { beklenmedikKapanis, karsiTarafDurumu } from "./zoom/indirgeyiciler";
import {
  ayril as istemcidenAyril,
  hazirla,
  kamerayiDegistir,
  katil,
  olaylariBagla,
  oturumdaMi,
  sesiBaslat,
} from "./zoom/istemci";
import { depoyuSifirla, useAsama, useOdaDeposu } from "./zoom/odaDeposu";
import { onizlemeDurdur } from "./zoom/onizleme";

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
}

const ZoomOdasi = forwardRef<ZoomOdasiTutamak, ZoomOdasiProps>(function ZoomOdasi(
  props,
  ref,
) {
  // Geri çağrılar her çizimde güncel; bilet/süre ise İLK değerleriyle donar.
  const guncel = useRef(props);
  guncel.current = props;
  const { telefon, onAyrilIstegi } = props;

  const asama = useAsama();
  const [mikTercihi, setMikTercihi] = useState(true);
  const [kameraTercihi, setKameraTercihi] = useState(true);
  const [girisHatasi, setGirisHatasi] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({ ayril: () => odadanAyril() }), []);

  // Kurulum: depo sıfır, init (WASM ön yükleme) önizleme sırasında başlar,
  // olay köprüsü bağlanır. StrictMode'un kur-sök-kur döngüsü: söküm yalnız
  // dinleyicileri çözer; oturumdaysa (gerçek söküm) ayrılır.
  useEffect(() => {
    depoyuSifirla();
    void hazirla().catch((e) => console.warn("Zoom init", e));
    const coz = olaylariBagla();
    return () => {
      coz();
      if (oturumdaMi()) void istemcidenAyril();
      else void onizlemeDurdur();
    };
  }, []);

  // Karşı taraf ve beklenmedik kapanış — yalnız katıldıktan sonra.
  useEffect(() => {
    let onceki: KarsiTarafDurumu | null = null;
    let kapandiBildirildi = false;
    return useOdaDeposu.subscribe((d) => {
      if (d.asama !== "odada") return;
      const durum = karsiTarafDurumu(d);
      if (durum !== onceki) {
        onceki = durum;
        guncel.current.onKarsiTaraf(durum);
      }
      if (!kapandiBildirildi && beklenmedikKapanis(d)) {
        kapandiBildirildi = true;
        guncel.current.onKapandi();
      }
    });
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
      await sesiBaslat(!mikTercihi);
    } catch (e) {
      // iOS/Safari: `await join()` sonrası kullanıcı etkinleşmesi kaybolur.
      console.warn("Zoom startAudio", e);
      useOdaDeposu.setState({ sesEngellendi: true });
    }
    if (kameraTercihi) {
      try {
        await kamerayiDegistir(true);
      } catch (e) {
        console.warn("Zoom startVideo", e);
        useOdaDeposu.setState({ hata: "media.deviceError" });
      }
    }
  };

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
        />
      </I18nextProvider>
    );
  }

  return (
    <I18nextProvider i18n={dersI18n}>
      <div className="absolute inset-0 flex flex-col bg-ders-zemin">
        <div className="relative min-h-0 flex-1">
          <ZoomVideoSahnesi telefon={telefon} />
          <DurumSeritleri mikTercihi={mikTercihi} />
        </div>
        {telefon ? (
          <TelefonCubugu onAyril={onAyrilIstegi} />
        ) : (
          <KontrolCubugu onAyril={onAyrilIstegi} />
        )}
      </div>
    </I18nextProvider>
  );
});

async function odadanAyril(): Promise<void> {
  await onizlemeDurdur();
  await istemcidenAyril();
}

export default ZoomOdasi;
