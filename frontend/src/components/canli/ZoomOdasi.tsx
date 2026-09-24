/**
 * Zoom Video SDK UI Toolkit odası — toolkit YALNIZ bu modülde import edilir.
 *
 * `pages/CanliDers.tsx` bu dosyayı `lazy()` ile yükler; ~9 MB'lık paket (kendi
 * React kopyası ve Video SDK'sı içinde) ve kapsamsız CSS'i böylece yalnız canlı
 * ders parçasına girer. Sayfaya giriş/çıkış tam sayfa yüklemesiyledir
 * (`lib/tamSayfaGezinme.ts`).
 *
 * ## Bileşik (composite) arayüz
 *
 * `joinSession(kap, ayar)` videoyu VE toolkit'in kendi kontrol çubuğunu (alt
 * bilgi) aynı kaba çizer. Parça parça `show*Component` API'leri telefonda
 * çalışmıyor (`isSupportCustomLayout` → mobilde false) ve `showVideoComponent`
 * 2.5'te işlevsiz; tek yol bu.
 *
 * ## Kap BOŞ ve SABİT kalır
 *
 * Toolkit kaba kendi `createRoot`'unu kurar. Bizim React'imiz bu `div`in
 * içine ASLA çocuk çizmez; notlar, sayaç, pencereler kardeş öğelerdir. İleride
 * tahta açılıp kapanınca (Paket 5) yalnız bu kutunun yerleşimi değişmeli —
 * yeniden bağlanma olmasın diye düğüm aynı kalır.
 *
 * ## Ayrılma = `leaveSession`, ASLA `closeSession`
 *
 * Toolkit'te `closeSession()` = `client.leave(true)`: host çağırırsa oturumu
 * HERKES için bitirir. Kullanıcı kararı (24 Eyl 2026, Preply gibi): öğretmen
 * dahil herkes yalnız kendisi ayrılır, ders karşı taraf için sürer. Toolkit'in
 * kendi "Ayrıl" menüsü host'a "End Session" sunduğu için tümden kapalı
 * (`leave.enable: false`); ayrılma sayfanın onaylı düğmesinden yapılır.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import uitoolkit, {
  type CustomizationOptions,
  type SuspensionViewValue,
} from "@zoom/videosdk-ui-toolkit";
import "@zoom/videosdk-ui-toolkit/dist/videosdk-ui-toolkit.css";

import type { KarsiTarafDurumu } from "@/lib/canliDers";
import type { ZoomDersTokenOut } from "@/types";

export interface ZoomOdasiTutamak {
  /** Yalnız KENDİNİ oturumdan çıkarır (host için de). En çok ~3 sn bekler. */
  ayril: () => Promise<void>;
}

export interface ZoomOdasiProps {
  bilet: ZoomDersTokenOut;
  /** Telefon düzeni: ekran paylaşımı kapalı (mobil tarayıcı gönderemez). */
  telefon: boolean;
  /** Tek kişi kalınca oturumun kapanma süresi (dk; yalnız host'unki geçer). */
  bostaKalmaDk: number;
  onKarsiTaraf: (durum: KarsiTarafDurumu) => void;
  /** Oturum BİZİM ayrılmamız dışında kapandı (bağlantı koptu, atıldı…). */
  onKapandi: () => void;
}

/**
 * StrictMode'da efekt iki kez çalışır (kur → sök → kur). Toolkit tekil bir
 * örnek tuttuğundan iki `joinSession` aynı oturuma iki kez girmeye çalışırdı.
 * Başlatma bir sonraki tura ertelenir ve nesil sayacıyla bekçilenir (desen:
 * `store/centrifugoStore.ts`): ilk kurulumun sökümü sayacı artırır, ertelenen
 * başlatma kendi neslini göremeyince hiç çalışmaz.
 */
let nesil = 0;

const AYRILMA_BEKLEME_MS = 3000;

function ayarlar(
  bilet: ZoomDersTokenOut,
  telefon: boolean,
  bostaKalmaDk: number,
): CustomizationOptions {
  const tipli: NonNullable<CustomizationOptions["featuresOptions"]> = {
    // Kamera/mikrofon seçimi ve deneme — girişten önce.
    preview: { enable: true, isAllowModifyName: false },
    video: { enable: true },
    audio: { enable: true },
    share: { enable: !telefon },
    // Sohbet bizim mesajlaşmamızdan yürür (maskeleme, kalıcılık; Paket 4).
    chat: { enable: false, enableEmoji: false },
    users: { enable: true },
    settings: { enable: true },
    // Host'a "End Session" sunan menü — bkz. dosya başı.
    leave: { enable: false },
    header: { enable: false },
    footer: { enable: true },
    // Kullanıcı kararları: kayıt yok, sanal arka plan yok.
    recording: { enable: false },
    virtualBackground: { enable: false },
    invite: { enable: false },
    phone: { enable: false },
    caption: { enable: false },
    subsession: { enable: false },
    feedback: { enable: false },
    troubleshoot: { enable: false },
    playback: { enable: false, audioVideoPlaybacks: [] },
    theme: { enable: false, defaultTheme: "light" },
    // Birebir derste karşı taraf büyük, kendi görüntün küçük (Preply gibi).
    viewMode: {
      enable: true,
      defaultViewMode: "speaker" as SuspensionViewValue,
      viewModes: ["speaker", "gallery"] as SuspensionViewValue[],
    },
    screenshot: { video: { enable: false }, share: { enable: false } },
  };
  // `index.d.ts`te olmayan ama varsayılanı AÇIK gelen özellikler: Zoom'un
  // kendi beyaz tahtası (bizimki Paket 5), çağrı/yayın.
  const tipDisi = {
    whiteboard: { enable: false },
    crc: { enable: false },
    livestream: { enable: false },
  };
  return {
    videoSDKJWT: bilet.token,
    sessionName: bilet.oturum_adi,
    userName: bilet.kullanici_adi,
    sessionIdleTimeoutMins: bostaKalmaDk,
    // Sekme kapanınca/başka sayfaya geçilince yalnız AYRIL (bitirme değil).
    leaveOnPageUnload: true,
    featuresOptions: { ...tipli, ...tipDisi },
  };
}

const ZoomOdasi = forwardRef<ZoomOdasiTutamak, ZoomOdasiProps>(function ZoomOdasi(
  props,
  ref,
) {
  const kapRef = useRef<HTMLDivElement>(null);
  const ayriliyorRef = useRef(false);
  // Geri çağrılar her çizimde güncel; bilet/telefon/süre ise İLK değerleriyle
  // donar — oda bir kez kurulur ve üst bileşenin yeniden çizimi onu sökmez.
  const guncel = useRef(props);
  guncel.current = props;

  useImperativeHandle(
    ref,
    () => ({
      async ayril() {
        ayriliyorRef.current = true;
        // Toolkit ayrılmayı 20 sn'ye kadar bekleyebiliyor; kullanıcıyı
        // tutmayalım. Kalanını `leaveOnPageUnload` sayfa kapanırken yapar.
        await Promise.race([
          uitoolkit.leaveSession().catch(() => undefined),
          new Promise((coz) => window.setTimeout(coz, AYRILMA_BEKLEME_MS)),
        ]);
      },
    }),
    [],
  );

  useEffect(() => {
    const kap = kapRef.current;
    if (!kap) return;
    const benimNesil = ++nesil;
    let temizle: (() => void) | null = null;

    const zamanlayici = window.setTimeout(() => {
      if (benimNesil !== nesil) return;
      const { bilet, telefon, bostaKalmaDk } = guncel.current;

      let karsiTarafGoruldu = false;
      const karsiTarafiDegerlendir = () => {
        if (benimNesil !== nesil) return;
        const ben = uitoolkit.getCurrentUserInfo();
        const digerleri = uitoolkit
          .getAllUser()
          .filter((k) => k.userId !== ben?.userId);
        if (digerleri.length > 0) {
          karsiTarafGoruldu = true;
          guncel.current.onKarsiTaraf("odada");
        } else {
          guncel.current.onKarsiTaraf(karsiTarafGoruldu ? "ayrildi" : "bekleniyor");
        }
      };
      // Olay anında kullanıcı listesi henüz güncellenmemiş olabilir.
      const kullaniciDegisti = () => window.setTimeout(karsiTarafiDegerlendir, 0);
      const katildi = () => karsiTarafiDegerlendir();
      const kapandi = () => {
        if (benimNesil !== nesil || ayriliyorRef.current) return;
        guncel.current.onKapandi();
      };

      // `joinSession` toolkit örneğini EŞZAMANLI kurar, sonra katılmayı
      // bekler; dinleyiciler bu yüzden çağrıdan hemen sonra bağlanabilir.
      const katilim = uitoolkit.joinSession(kap, ayarlar(bilet, telefon, bostaKalmaDk));
      try {
        uitoolkit.onSessionJoined(katildi);
        uitoolkit.onSessionClosed(kapandi);
        uitoolkit.on("user-added", kullaniciDegisti);
        uitoolkit.on("user-removed", kullaniciDegisti);
      } catch (hata) {
        console.warn("Zoom olay dinleyicileri bağlanamadı", hata);
      }
      // Önizleme ekranında 60 sn'den uzun kalınırsa toolkit "Timed out
      // waiting for session to join" ile reddeder ama oda açık kalır ve
      // kullanıcı hâlâ girebilir — hata değildir. Gerçek giriş hatalarını
      // toolkit kendi ekranında gösterir.
      katilim.catch((hata) => console.warn("Zoom joinSession", hata));

      temizle = () => {
        try {
          uitoolkit.offSessionJoined(katildi);
          uitoolkit.offSessionClosed(kapandi);
          uitoolkit.off("user-added", kullaniciDegisti);
          uitoolkit.off("user-removed", kullaniciDegisti);
        } catch {
          // örnek zaten yok
        }
        // closeSession DEĞİL (host'ta herkes için bitirir) — bkz. dosya başı.
        void uitoolkit
          .leaveSession()
          .catch(() => undefined)
          .finally(() => uitoolkit.destroy().catch(() => undefined));
      };
    }, 0);

    return () => {
      nesil += 1;
      window.clearTimeout(zamanlayici);
      temizle?.();
    };
  }, []);

  return <div ref={kapRef} className="absolute inset-0" />;
});

export default ZoomOdasi;
