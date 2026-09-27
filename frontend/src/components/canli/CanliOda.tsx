/**
 * Canlı ders odası — sağlayıcıdan bağımsız, La Suite Meet görünümüyle.
 *
 * Görsel katman Meet'ten uyarlandı (La Suite Meet, MIT — DINUM/Etalab; bkz.
 * frontend/THIRD_PARTY_NOTICES.md); medya sürücü cephesinden geçer
 * (`video/tipler.ts` `VideoSurucusu`, etkin sürücü `video/etkin.ts`). SDK
 * yalnız sürücüde (`video/zoom/*`). LiveKit/Panda/valtio/react-aria taşınmadı.
 *
 * `pages/CanliDers.tsx` bu dosyayı sürücüyü kurduktan SONRA `lazy()` ile
 * yükler: SDK ve i18next YALNIZ bu parçaya girer. Sayfaya giriş/çıkış tam
 * sayfa yüklemesiyledir (`lib/tamSayfaGezinme.ts`).
 *
 * ## Dış sözleşme
 *
 * `CanliOdaTutamak.ayril()` toolkit sürümüyle aynı; bilet nötrdür
 * (`NotrBilet`). İsteğe bağlı props (`onAyrilIstegi`, `biletTazele`, `dersBilgisi`,
 * `sohbet`, `sahneUstu`). Sayfanın üst şeridi yok (Meet): Ayrıl ve Sohbet
 * yalnız kontrol çubuğunda.
 *
 * ## Yan panel (Katılımcılar, ders içi sohbet) — Preply yerleşimi
 *
 * Odanın en sağında tam yükseklik (`YanPanel`): >880px'te sahneyi ve
 * kontrol çubuğunu daraltır, ≤880px'te karartmalı kaplayan pencere,
 * telefonda tam ekran (sahne altta çizili kalır, ses sürer). Sohbet
 * telefonda ve ≤880px'te kapalıyken gelen mesaj sahnede önizleme balonu
 * gösterir. Ağaç sabit:
 * yalnız sınıflar değişir, video kapları yeniden kurulmaz. Sohbet bir kez
 * açılınca DOM'da kalır (kapalıyken gizli): taslak ve kaydırma korunur.
 *
 * ## Beyaz tahta — Preply sınıfı (spesifikasyon `preply-sinif-tahta-duzen.md`)
 *
 * Yalnız öğretmen açar/kapatır ("Araçlar" menüsü, telefonda "Seçenekler";
 * başlıktaki X). Durum sunucuda saklanır ve `ders:{id}` kanalından iki tarafa
 * yayılır: öğrencide bildirimsiz kendiliğinden açılır/kapanır, geç katılan
 * son durumu token yanıtından okur. Düzen (Odaklanma/Kareler, Kenar
 * çubuğu/Köşe, paylaşım + tahta bölmesi) `SinifSahnesi`nde.
 *
 * ## Ayrılma = argümansız `leave()`
 *
 * Öğretmen dahil herkes yalnız KENDİSİ ayrılır, ders karşı taraf için sürer
 * (kullanıcı kararı, 24 Eyl 2026). Oturumu bitiren çağrı kod tabanında yok.
 *
 * ## Akış
 *
 * önizleme → "Derse katıl" → (karşı taraf sayfada değilse bekleme) → bilet tazeliği → önizleme izleri durur → `join`
 * → ses (tercihe göre sessiz) → kamera (tercih açıksa) → oda.
 *
 * Mikrofon/kamera açık tercihi ve seçilen cihazlar tarayıcıda saklanır
 * (`oda/durum/tercihler.ts`); önizlemede seçilen cihazla derse girilir.
 *
 * ## Karşı tarafı bekleme (kullanıcı kararı, 25 Eyl 2026)
 *
 * İlk gelen "Derse katıl"a basınca sağlayıcıya BAĞLANMAZ (kredi harcanmaz):
 * önizlemede "{ad} bekleniyor…" der; karşı taraf ders sayfasına gelince
 * (Centrifugo `ders:{id}` varlığı) kendiliğinden bağlanır. Karşı taraf zaten
 * sayfadaysa doğrudan bağlanır. Kanal/varlık yoksa beklenmez (geri dönüş).
 * Karar `oda/durum/bekleme.ts`; bu yüzden ders kanalı önizlemede de açıktır.
 *
 * ## Odak ve tam ekran
 *
 * Tahta ya da paylaşım başlığındaki "Tam alana genişlet" o aracı tüm sahneye
 * yayar (yalnız bakan kişide; `sinifDuzeni` `odak`). Odakta yan panel
 * kapanır (panel açmak odaktan çıkarır), kontrol çubuğu sahnenin üstüne
 * biner ve 3 sn sonra kendiliğinden gizlenir (`durum/cubukGizleme`). Esc
 * odaktan çıkarır; tahta odağında yalnız odak tahtanın DIŞINDAYKEN
 * (Excalidraw Esc'i kullanır). Tarayıcı tam ekranı ayrı: Seçenekler menüsü
 * ve Ctrl+Shift+F (`durum/tamEkran`).
 *
 * ## Tepkiler ve el kaldırma
 *
 * Taşıyıcı tahtayla aynı Centrifugo `ders:{id}` kanalı (`oda/durum/tepkiler.ts`);
 * kanal hazır değilse düğmeler gizlenir.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { I18nextProvider } from "react-i18next";

import { biletTazeMi, type KarsiTarafDurumu } from "@/lib/canliDers";
import { onizlemeGerekli, onizlemeMetni, type SohbetOzeti } from "@/lib/sohbetCekmecesi";
import type { Odak } from "@/lib/sinifDuzeni";
import { toast } from "@/store/toastStore";

import { dersI18n } from "./i18n";
import { Modal } from "@/components/ui/Modal";
import { PlainButton } from "@/components/ui/PlainButton";
import { useTahtaDurumu } from "@/hooks/useBookings";

import { AyarlarPenceresi, type AyarSekmesi } from "./oda/AyarlarPenceresi";
import { useDersKonusmasi, type DersSohbetBilgisi } from "./oda/dersKonusmasi";
import { DersSohbeti } from "./oda/DersSohbeti";
import { DurumSeritleri } from "./oda/DurumSeritleri";
import { IzinPenceresi } from "./oda/IzinPenceresi";
import { KatilimciListesi } from "./oda/KatilimciListesi";
import { KontrolCubugu, type AracDenetimi, type PanelDenetimi } from "./oda/KontrolCubugu";
import { OnIzleme, type DersBilgisi } from "./oda/OnIzleme";
import { TelefonCubugu } from "./oda/TelefonCubugu";
import { UcanTepkiler } from "./oda/Tepkiler";
import { YanPanel, type PanelTuru } from "./oda/YanPanel";
import { SohbetOnizlemesi } from "./oda/SohbetOnizlemesi";
import { SinifSahnesi } from "./oda/SinifSahnesi";
import { TahtaAlani } from "./oda/TahtaAlani";
import { beklemeSuresi, katilimKarari, type KanalVarligi } from "./oda/durum/bekleme";
import { useCubukGizleme } from "./oda/durum/cubukGizleme";
import { bostaKalmayiIzle } from "./oda/durum/bostaKalma";
import {
  beklenmedikKapanis,
  kameraHataAnahtari,
  digerAdlari,
  karsiTarafDurumu,
  katilimciFarki,
  katilimcilariEsitle,
  type Katilimci,
} from "./oda/durum/indirgeyiciler";
import { izinleriIzle } from "./oda/durum/izinler";
import { ayril as oturumdanAyril, kamerayiDegistir, sesiBaslat } from "./oda/durum/medya";
import { olaylariBagla } from "./oda/durum/olayBagla";
import {
  depoyaUygula,
  depoyuSifirla,
  useAsama,
  useOdaDeposu,
  usePaylasimVar,
} from "./oda/durum/odaDeposu";
import { tamEkranDegistir, tamEkranDestekli, tamEkranKisayoluMu } from "./oda/durum/tamEkran";
import { tercihleriOku, tercihleriYaz } from "./oda/durum/tercihler";
import { arkaPlanDesteginiOnbellegeAl } from "./oda/durum/useMedyaKontrolleri";
import { elleriEsitle, tepkileriBagla } from "./oda/durum/tepkiler";
import { dersKanaliAc, type DersKanali } from "./tahta/dersKanali";
import { surucu } from "./video/etkin";
import type { NotrBilet } from "./video/tipler";
import {
  etkinOturumKamerasiAnahtari,
  oturumKamerasiAnahtari,
  oturumKamerasiOku,
  oturumKamerasiYaz,
} from "./oda/durum/oturumKamerasi";
import { useAuthStore } from "@/store/authStore";

export type { DersBilgisi, DersSohbetBilgisi };

/** "Mikrofonun kapalı" uyarısı en sık bu aralıkla (olay sürekli yinelenir). */
const KAPALI_KONUSMA_ARALIGI_MS = 30_000;

/**
 * "Ayrıldı" bildirimi bu kadar ertelenir: karşı tarafın kısa kopması
 * (failover, yeni `userId` ile dönüş) ayrılma gibi bildirilmesin.
 */
const AYRILDI_BEKLEME_MS = 5_000;

export interface CanliOdaTutamak {
  /** Yalnız KENDİNİ oturumdan çıkarır (host için de). En çok ~3 sn bekler. */
  ayril: () => Promise<void>;
}

/** Preply: ≤880px masaüstünde yan panel kaplayan pencereye döner. */
const DAR_PENCERE = "(max-width: 880px)";

function useDarPencere(): boolean {
  const [dar, setDar] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia(DAR_PENCERE).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(DAR_PENCERE);
    const degisti = () => setDar(mq.matches);
    degisti();
    mq.addEventListener?.("change", degisti);
    return () => mq.removeEventListener?.("change", degisti);
  }, []);
  return dar;
}

/** Tahta kapatma onayında "Bir daha gösterme" (tarayıcıda, kişiye özel). */
const KAPATMA_ONAYI_GIZLI = "ders_tahta_kapatma_onayi_gizli";

function kapatmaOnayiGizliMi(): boolean {
  try {
    return window.localStorage.getItem(KAPATMA_ONAYI_GIZLI) === "1";
  } catch {
    return false;
  }
}

export interface CanliOdaProps {
  /** Sunucunun bileti, nötr biçimde (sağlayıcı adı dahil). */
  bilet: NotrBilet;
  /** Ders kimliği — tahta kanalı ve ders kaynağı yüklemesi için. */
  dersId?: number;
  /** Telefon düzeni: etiketli alt çubuk, kamerayı çevir. */
  telefon: boolean;
  /** Karşı taraf bu kadar dk yoksa oturumdan çıkılır (Zoom'a da verilir). */
  bostaKalmaDk: number;
  onKarsiTaraf: (durum: KarsiTarafDurumu) => void;
  /** Oturum BİZİM ayrılmamız dışında kapandı (bağlantı koptu, atıldı…). */
  onKapandi: () => void;
  /** Kontrol çubuğundaki Ayrıl → sayfanın onaylı çıkış penceresi. */
  onAyrilIstegi?: () => void;
  /** Bilet bayatsa (5 dk'dan az kaldıysa) katılmadan önce yenisini getirir. */
  biletTazele?: () => Promise<NotrBilet | undefined>;
  /** Önizlemenin sağ sütunu: ders adı ve saati. */
  dersBilgisi?: DersBilgisi;
  /** Ders içi sohbetin karşı tarafı; yoksa sohbet düğmesi görünmez. */
  sohbet?: DersSohbetBilgisi;
  /**
   * Sahnenin üst ortasındaki durum hapları (tarayıcı uyarısı, karşı taraf
   * notu, ders sayacı). Sahnenin İÇİNDE: yan panelin üstüne binmez.
   */
  sahneUstu?: ReactNode;
}

const CanliOda = forwardRef<CanliOdaTutamak, CanliOdaProps>(function CanliOda(
  props,
  ref,
) {
  // Geri çağrılar her çizimde güncel; bilet/süre ise İLK değerleriyle donar.
  const guncel = useRef(props);
  guncel.current = props;
  const { telefon, onAyrilIstegi, dersBilgisi, bilet, sohbet, sahneUstu, dersId } = props;
  const darPencere = useDarPencere();
  const ogretmen = bilet.rol === "ogretmen";

  const asama = useAsama();
  const [mikTercihi, setMikTercihiDurumu] = useState(() => tercihleriOku().mikAcik);
  // Ders içi kamera tercihi bu sekmenin oturumunda (ders + rol + kullanıcı):
  // kamerayı kapatıp yenileyen kişinin kamerası kendiliğinden açılmaz. Kayıt
  // yoksa (ilk giriş) mevcut varsayılan (`tercihler.ts`) geçerli.
  const kullaniciId = useAuthStore((s) => s.user?.id);
  const kameraAnahtari = oturumKamerasiAnahtari(dersId, bilet.rol, kullaniciId);
  const [kameraTercihi, setKameraTercihiDurumu] = useState(
    () => oturumKamerasiOku(kameraAnahtari) ?? tercihleriOku().kameraAcik,
  );
  useEffect(() => {
    etkinOturumKamerasiAnahtari(kameraAnahtari);
    return () => etkinOturumKamerasiAnahtari(null);
  }, [kameraAnahtari]);
  const setMikTercihi = useCallback((mikAcik: boolean) => {
    setMikTercihiDurumu(mikAcik);
    tercihleriYaz({ mikAcik });
  }, []);
  const setKameraTercihi = useCallback(
    (kameraAcik: boolean) => {
      setKameraTercihiDurumu(kameraAcik);
      tercihleriYaz({ kameraAcik });
      oturumKamerasiYaz(kameraAnahtari, kameraAcik);
    },
    [kameraAnahtari],
  );
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
  // Uygulama içi odak (yalnız bende): panel açmak odaktan çıkarır.
  const [odakIstegi, setOdakIstegi] = useState<Odak | null>(null);
  const panelDegistir = useCallback((tur: PanelTuru) => {
    setOdakIstegi(null);
    setPanel((p) => (p === tur ? null : tur));
  }, []);
  const paneliKapat = useCallback(() => setPanel(null), []);
  const konusma = useDersKonusmasi(sohbet);
  // Sohbet bir kez açılınca DOM'da kalır (Preply `SidebarPanelChat`).
  const [sohbetKuruldu, setSohbetKuruldu] = useState(false);
  if (panel === "sohbet" && !sohbetKuruldu) setSohbetKuruldu(true);
  const panelDenetimi: PanelDenetimi = {
    panel,
    onPanel: panelDegistir,
    sohbetVar: Boolean(sohbet),
    okunmamis: konusma.okunmamis,
    karsiAd: sohbet?.karsiTarafAd ?? "",
  };

  // Sohbet açılınca önizleme balonu kalkar.
  const [onizleme, setOnizleme] = useState<{ metin: string; zaman: string | null } | null>(null);
  const [oncekiPanel, setOncekiPanel] = useState(panel);
  if (panel !== oncekiPanel) {
    setOncekiPanel(panel);
    if (panel === "sohbet") setOnizleme(null);
  }
  const onizlemeKapat = useCallback(() => setOnizleme(null), []);
  // Sohbet kapalıyken yeni mesaj: telefonda / dar pencerede önizleme balonu.
  // İlk yüklemedeki okunmamışlar balon açmaz (önceki durum yüklenince tutulur).
  const oncekiOzet = useRef<SohbetOzeti | null>(null);
  const { yuklendi, okunmamis: sohbetOkunmamis, sonMesaj, sonMesajZamani } = konusma;
  useEffect(() => {
    if (!yuklendi) return;
    const simdi: SohbetOzeti = { okunmamis: sohbetOkunmamis, zaman: sonMesajZamani };
    const onceki = oncekiOzet.current;
    oncekiOzet.current = simdi;
    if ((telefon || darPencere) && onizlemeGerekli(onceki, simdi, panel === "sohbet")) {
      setOnizleme({ metin: onizlemeMetni(sonMesaj), zaman: sonMesajZamani });
    }
  }, [yuklendi, sohbetOkunmamis, sonMesaj, sonMesajZamani, telefon, darPencere, panel]);

  // ── Beyaz tahta ──
  const odada = asama === "odada";
  const [kanal, setKanal] = useState<DersKanali | null>(null);
  const [tahtaHazir, setTahtaHazir] = useState(false);
  const [tahtaAcik, setTahtaAcik] = useState(false);
  const [kapatmaOnayi, setKapatmaOnayi] = useState(false);
  const [birDahaGosterme, setBirDahaGosterme] = useState(false);
  const tahtaDurumu = useTahtaDurumu(dersId ?? 0);
  // Kanal önizlemeden itibaren açık: karşı tarafın varlığı (bekleme) buradan.
  const [varlik, setVarlik] = useState<KanalVarligi>(() => ({
    durum: dersId ? "aciliyor" : "yok",
    karsiVar: false,
  }));
  useEffect(() => {
    if (!dersId) {
      setVarlik({ durum: "yok", karsiVar: false });
      return;
    }
    const k = dersKanaliAc(dersId, { onTahta: setTahtaAcik, onHazir: setTahtaHazir });
    setVarlik(k.varlik());
    const varlikSokumu = k.varlikDinle(setVarlik);
    setKanal(k);
    return () => {
      varlikSokumu();
      k.kapat();
      setKanal(null);
      setTahtaHazir(false);
      setVarlik({ durum: "aciliyor", karsiVar: false });
    };
  }, [dersId]);
  // Aynı kanal tepki ve el kaldırmanın da taşıyıcısı — yalnız odada: hazır
  // olunca düğmeler görünür.
  const benimRolum = bilet.rol;
  const tepkiKanali = odada && tahtaHazir;
  useEffect(() => {
    useOdaDeposu.setState({ tepkiKanali });
  }, [tepkiKanali]);
  useEffect(() => {
    if (!odada || !kanal) return;
    const tepkiSokumu = tepkileriBagla(
      { gonder: kanal.odaYayinla, dinle: kanal.odaDinle },
      benimRolum,
      {
        elKaldirildi: (ad) => toast.info(dersI18n.t("notifications.handRaised", { name: ad })),
      },
    );
    // (Yeniden) abonelik: kanalda geçmiş yok, kalkık eller yeniden eşitlenir.
    // Kanal önizlemede abone olduğu için odaya girişte de bir kez.
    const aboneSokumu = kanal.aboneOlununca(elleriEsitle);
    elleriEsitle();
    return () => {
      aboneSokumu();
      tepkiSokumu();
    };
  }, [odada, kanal, benimRolum]);
  const tahtaMutasyonu = tahtaDurumu.mutate;
  const tahtayiDegistir = useCallback(
    (acik: boolean) => {
      tahtaMutasyonu(acik, {
        onSuccess: (d) => setTahtaAcik(d.acik),
        onError: () => toast.error(dersI18n.t("tahta.acilamadi")),
      });
    },
    [tahtaMutasyonu],
  );
  const tahtaKapatIstegi = useCallback(() => {
    if (kapatmaOnayiGizliMi()) tahtayiDegistir(false);
    else {
      setBirDahaGosterme(false);
      setKapatmaOnayi(true);
    }
  }, [tahtayiDegistir]);
  // Odak yalnız açık araç için geçerli; araç kapanınca odak düşer.
  const paylasimVar = usePaylasimVar();
  const tahtaGorunur = tahtaAcik && kanal !== null && dersId !== undefined;
  const odak: Odak | null =
    odakIstegi === "tahta" && tahtaGorunur
      ? "tahta"
      : odakIstegi === "paylasim" && paylasimVar
        ? "paylasim"
        : null;
  if (odakIstegi !== null && odak === null) setOdakIstegi(null);
  const odakDegistir = useCallback(
    (hedef: Odak) => {
      if (odak === hedef) {
        setOdakIstegi(null);
        return;
      }
      setOdakIstegi(hedef);
      setPanel(null);
    },
    [odak],
  );
  const cubukKabi = useRef<HTMLDivElement>(null);
  const cubukGizli = useCubukGizleme(odak !== null, cubukKabi);
  // Odakta görünen çubuk sahnenin alt şeridini örter: yüksekliği
  // `--cubuk-pay` olarak iner, paylaşım yakınlaştırma çubuğu onun üstüne çıkar.
  const [cubukYuksekligi, setCubukYuksekligi] = useState(0);
  useLayoutEffect(() => {
    const el = cubukKabi.current;
    if (odak === null || !el) return;
    setCubukYuksekligi(el.offsetHeight);
    if (typeof ResizeObserver === "undefined") return;
    const g = new ResizeObserver(() => setCubukYuksekligi(el.offsetHeight));
    g.observe(el);
    return () => g.disconnect();
  }, [odak]);
  const cubukPayi = odak !== null && !cubukGizli ? cubukYuksekligi : 0;

  // Esc odaktan çıkarır. `window` kabarcık evresi: açık menüler (Acilir,
  // karo menüsü) olayı durdurur. Tahta odağında yalnız odak tahtanın
  // DIŞINDA bir öğedeyken (Excalidraw Esc'i kullanır; tuval tıklamasından
  // sonra odak gövdede de kalabilir, o da "içeride" sayılır). Tahta
  // başlığındaki düğmeler (ör. "Tam alana genişlet") dışarıda sayılır.
  useEffect(() => {
    if (odak === null) return;
    const tus = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const etkin = document.activeElement;
      if (etkin?.closest('[role="dialog"], dialog, [role="menu"]')) return;
      const tahtada =
        !etkin ||
        etkin === document.body ||
        (etkin.closest("[data-tahta-alani]") && !etkin.closest("[data-tahta-basligi]"));
      if (odak === "tahta" && tahtada) return;
      setOdakIstegi(null);
    };
    window.addEventListener("keydown", tus);
    return () => window.removeEventListener("keydown", tus);
  }, [odak]);

  // Tarayıcı tam ekranı: Ctrl+Shift+F (Meet kısayolu); iPhone'da yok.
  useEffect(() => {
    if (!odada || !tamEkranDestekli()) return;
    const tus = (e: KeyboardEvent) => {
      if (!tamEkranKisayoluMu(e)) return;
      e.preventDefault();
      tamEkranDegistir();
    };
    window.addEventListener("keydown", tus);
    return () => window.removeEventListener("keydown", tus);
  }, [odada]);

  const aracDenetimi: AracDenetimi | undefined =
    ogretmen && tahtaHazir
      ? {
          tahtaAcik,
          onTahtaAc: () => tahtayiDegistir(true),
          onTahtaKapat: tahtaKapatIstegi,
        }
      : undefined;

  useImperativeHandle(ref, () => ({ ayril: () => odadanAyril() }), []);

  // "Bağlantın kesildi" penceresi bir kez: beklenmedik kapanış ve boşta kalma ortak.
  const kapandiBildirildi = useRef(false);
  const kapandiBildir = useCallback(() => {
    if (kapandiBildirildi.current) return;
    kapandiBildirildi.current = true;
    guncel.current.onKapandi();
  }, []);

  // Kurulum: depo sıfır, init (WASM ön yükleme) önizleme sırasında başlar,
  // olay köprüsü bağlanır. StrictMode'un kur-sök-kur döngüsü: söküm yalnız
  // dinleyicileri çözer; oturumdaysa (gerçek söküm) ayrılır.
  useEffect(() => {
    depoyuSifirla();
    const s = surucu();
    void s.hazirla().catch((e) => console.warn("Görüntülü ders hazırlığı", e));
    let sonUyari = 0;
    const coz = olaylariBagla({
      // Kapalı mikrofonla konuşma uyarısı konuştukça yinelenir; seyrek uyar.
      kapaliykenKonusma: () => {
        const simdi = Date.now();
        if (simdi - sonUyari < KAPALI_KONUSMA_ARALIGI_MS) return;
        sonUyari = simdi;
        toast.info(dersI18n.t("media.speakingWhileMuted"));
      },
      biletTazele: () => guncel.current.biletTazele?.() ?? Promise.resolve(undefined),
    });
    const izinIzleme = izinleriIzle();
    // Karşı taraf uzun süre yoksa kendini çıkarır (Zoom'un tek kişi kalınca
    // kapatmasıyla aynı sonuç); sayfa kapanırken yalnız kendimiz ayrılırız.
    const bostaKalma = bostaKalmayiIzle(guncel.current.bostaKalmaDk, () => {
      void oturumdanAyril();
      kapandiBildir();
    });
    return () => {
      coz();
      izinIzleme();
      bostaKalma();
      if (s.oturumdaMi()) void oturumdanAyril();
      else void s.onizleme.durdur();
    };
  }, [kapandiBildir]);

  // Karşı taraf, katıldı/ayrıldı bildirimleri ve beklenmedik kapanış —
  // yalnız katıldıktan sonra.
  useEffect(() => {
    let onceki: KarsiTarafDurumu | null = null;
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
      // (yeni kimlikle dönüş) karşı ertelenir, dönerse iptal edilir.
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
      if (beklenmedikKapanis(d)) kapandiBildir();
    });
    return () => {
      coz();
      for (const z of bekleyenAyrilma.values()) window.clearTimeout(z);
      window.clearTimeout(ayrildiZamanlayici);
    };
  }, [kapandiBildir]);

  const derseKatil = async () => {
    // Otomatik katılma (karşı taraf geldi) ile tıklama çakışırsa tek giriş.
    if (useOdaDeposu.getState().asama !== "onizleme") return;
    setGirisHatasi(null);
    useOdaDeposu.setState({ asama: "katiliyor", hata: null });
    let bilet = guncel.current.bilet;
    try {
      if (!biletTazeMi(bilet.bitis) && guncel.current.biletTazele) {
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
      await surucu().onizleme.durdur();
      const { ilk } = await surucu().katil(bilet, {
        biletTazele: async () => {
          const yeni = await guncel.current.biletTazele?.();
          if (!yeni) throw new Error("bilet");
          return yeni;
        },
        bostaKalmaDk: guncel.current.bostaKalmaDk,
      });
      depoyaUygula((d) => katilimcilariEsitle(d, ilk));
      // Odadaki arka plan desteği önizlemedekinden farklı okunur: Ayarlar
      // açılmadan önbellekte olsun (seçici "desteklenmiyor"la başlamasın).
      void arkaPlanDesteginiOnbellegeAl();
    } catch (e) {
      console.warn("Derse katılma", e);
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
      console.warn("Ses başlatma", e);
      useOdaDeposu.setState({ sesEngellendi: true });
    }
    // Kamera izni reddedilmişse yalnız sesle girilir: denemek yalnız bir
    // hata şeridi doğururdu (yönlendirme önizlemede gösterildi).
    if (tercih.current.kamera && useOdaDeposu.getState().izinler.kamera !== "denied") {
      try {
        await kamerayiDegistir(true);
      } catch (e) {
        console.warn("Kamera başlatma", e);
        if (kameraHataAnahtari(e) !== "join.cameraNotGranted") {
          useOdaDeposu.setState({ hata: "media.deviceError" });
        }
      }
    }
  };

  // ── Karşı tarafı bekleme ──
  const [katilmaIstegi, setKatilmaIstegi] = useState(false);
  const [beklemeBasladi, setBeklemeBasladi] = useState(false);
  const [sureDoldu, setSureDoldu] = useState(false);
  const katilimiIste = () => {
    if (useOdaDeposu.getState().asama !== "onizleme") return;
    // Beklemek gerekmiyorsa tıklamanın içinde katıl (kullanıcı etkinleşmesi).
    if (katilimKarari(varlik, { beklemeBasladi: false, sureDoldu: false }) === "katil") {
      void derseKatil();
      return;
    }
    setGirisHatasi(null);
    setBeklemeBasladi(false);
    setSureDoldu(false);
    setKatilmaIstegi(true);
  };
  const karar = katilmaIstegi ? katilimKarari(varlik, { beklemeBasladi, sureDoldu }) : null;
  // Kanal hazır görülünce bekleme başlamıştır; kopukluk süresi baştan sayılır.
  const kanalHazir = katilmaIstegi && varlik.durum === "hazir";
  useEffect(() => {
    if (!kanalHazir) return;
    setBeklemeBasladi(true);
    setSureDoldu(false);
  }, [kanalHazir]);
  const katil = useRef(derseKatil);
  katil.current = derseKatil;
  const sure = karar ? beklemeSuresi(karar, varlik.durum) : null;
  useEffect(() => {
    if (karar === "katil") {
      setKatilmaIstegi(false);
      void katil.current();
      return;
    }
    if (sure === null) return;
    const z = window.setTimeout(() => setSureDoldu(true), sure);
    return () => window.clearTimeout(z);
  }, [karar, sure]);

  const izinPenceresi = <IzinPenceresi onYenidenDene={() => setDeneme((n) => n + 1)} />;

  if (asama !== "odada") {
    return (
      <I18nextProvider i18n={dersI18n}>
        {sahneUstu && <SahneUstu>{sahneUstu}</SahneUstu>}
        <OnIzleme
          telefon={telefon}
          mikAcik={mikTercihi}
          kameraAcik={kameraTercihi}
          onMik={setMikTercihi}
          onKamera={setKameraTercihi}
          onKatil={katilimiIste}
          onAyril={onAyrilIstegi}
          katiliyor={asama === "katiliyor"}
          hata={girisHatasi}
          ad={bilet.ad}
          dersBilgisi={dersBilgisi}
          deneme={deneme}
          bekleme={
            karar === "bekle" ? "karsiTaraf" : karar === "hazirlaniyor" ? "hazirlaniyor" : null
          }
          karsiAd={sohbet?.karsiTarafAd}
          onBeklemeIptal={() => setKatilmaIstegi(false)}
        />
        {izinPenceresi}
      </I18nextProvider>
    );
  }

  return (
    <I18nextProvider i18n={dersI18n}>
      {/* Ağaç sabit: [sol sütun: sahne + çubuk] [yan panel]. Düzen yalnız
          sınıflarla değişir; sahne düğümü yeniden kurulmaz. */}
      <div className="absolute inset-0 flex bg-ders-zemin">
        {/* `isolate`: sahnenin z-index'leri (tepkiler, haplar) kendi içinde
            kalır; ≤880px'teki karartma ve panel her zaman üstte. */}
        <div
          className="relative isolate flex min-w-0 flex-1 flex-col"
          style={{ "--cubuk-pay": `${cubukPayi}px` } as CSSProperties}
        >
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <SinifSahnesi
              telefon={telefon}
              ogretmen={ogretmen}
              tahtaAcik={tahtaGorunur}
              odak={odak}
              onOdak={odakDegistir}
              tahta={
                kanal &&
                dersId !== undefined && (
                  <TahtaAlani
                    kanal={kanal}
                    dersId={dersId}
                    ogretmen={ogretmen}
                    karsiAd={sohbet?.karsiTarafAd ?? ""}
                    onKapat={tahtaKapatIstegi}
                    odakta={odak === "tahta"}
                    onOdak={() => odakDegistir("tahta")}
                  />
                )
              }
            >
              <UcanTepkiler />
              <DurumSeritleri mikTercihi={mikTercihi} />
              {sahneUstu && <SahneUstu>{sahneUstu}</SahneUstu>}
              {sohbet && onizleme && panel !== "sohbet" && (
                <SohbetOnizlemesi
                  key={onizleme.zaman ?? ""}
                  ad={sohbet.karsiTarafAd}
                  metin={onizleme.metin}
                  onAc={() => panelDegistir("sohbet")}
                  onKapandi={onizlemeKapat}
                />
              )}
            </SinifSahnesi>
          </div>
          {/* Odakta çubuk sahnenin üstüne biner ve kendiliğinden gizlenir.
              Aynı düğüm (çubuk yeniden kurulmaz); gizliyken yalnız saydam ve
              tıklanmaz: Tab ile ulaşılır, odak girince görünür. Transform
              YOK: telefon çekmecesi (`fixed`) yerinden kaymasın. */}
          <div
            ref={cubukKabi}
            className={
              odak === null
                ? "shrink-0"
                : `absolute inset-x-0 bottom-0 z-30 ${cubukGizli ? "pointer-events-none opacity-0" : ""}`
            }
          >
            {telefon ? (
              <TelefonCubugu
                onAyril={onAyrilIstegi}
                onAyarlar={ayarlariAc}
                panel={panelDenetimi}
                arac={aracDenetimi}
              />
            ) : (
              <KontrolCubugu
                onAyril={onAyrilIstegi}
                onAyarlar={ayarlariAc}
                panel={panelDenetimi}
                arac={aracDenetimi}
              />
            )}
          </div>
        </div>
        <YanPanel panel={panel} telefon={telefon} dar={darPencere} onKapat={paneliKapat}>
          {sohbet && sohbetKuruldu && (
            <div className={panel === "sohbet" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
              <DersSohbeti
                acik={panel === "sohbet"}
                sohbet={sohbet}
                konusma={konusma}
                telefon={telefon}
                dar={telefon || darPencere}
                onKapat={paneliKapat}
              />
            </div>
          )}
          {panel === "katilimcilar" && <KatilimciListesi benimRolum={bilet.rol} />}
        </YanPanel>
      </div>
      <AyarlarPenceresi
        acik={ayarlar.acik}
        sekme={ayarlar.sekme}
        onSekme={(sekme) => setAyarlar({ acik: true, sekme })}
        onKapat={() => setAyarlar((a) => ({ ...a, acik: false }))}
      />
      {izinPenceresi}
      {/* Preply `MODAL_CLOSING_TOOL`: "{araç} kapatılsın mı? / Bu araç
          {öğrenci} için de kapanacak." + "Bir daha gösterme". */}
      <Modal
        open={kapatmaOnayi}
        onClose={() => setKapatmaOnayi(false)}
        title={dersI18n.t("tahta.kapatOnay.baslik")}
        description={
          sohbet?.karsiTarafAd
            ? dersI18n.t("tahta.kapatOnay.metin", { ad: sohbet.karsiTarafAd })
            : dersI18n.t("tahta.kapatOnay.metinAdsiz")
        }
      >
        <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={birDahaGosterme}
            onChange={(e) => setBirDahaGosterme(e.target.checked)}
            className="h-4 w-4"
          />
          {dersI18n.t("tahta.kapatOnay.birDaha")}
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <PlainButton
            onClick={() => setKapatmaOnayi(false)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {dersI18n.t("tahta.kapatOnay.iptal")}
          </PlainButton>
          <PlainButton
            onClick={() => {
              if (birDahaGosterme) {
                try {
                  window.localStorage.setItem(KAPATMA_ONAYI_GIZLI, "1");
                } catch {
                  /* hatırlanmaz */
                }
              }
              setKapatmaOnayi(false);
              tahtayiDegistir(false);
            }}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            {dersI18n.t("tahta.kapatOnay.onay")}
          </PlainButton>
        </div>
      </Modal>
    </I18nextProvider>
  );
});

/** Sahnenin üst ortasındaki haplar; tıklamayı yalnız kendi öğeleri alır. */
function SahneUstu({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex flex-col items-center gap-2 px-4 [&>*]:pointer-events-auto">
      {children}
    </div>
  );
}

/**
 * Önizleme kapanışı BEKLENMEZ: kamera izni sorusu açıkken önizleme sırası
 * (Zoom `onizleme.ts` `siraKur`) soru yanıtlanana dek çözülmez; beklersek
 * "Ayrıl" takılır. İz, sıra açılınca yine durur. Oturumdaysak süre sınırı
 * sürücünün `ayril`ında.
 */
async function odadanAyril(): Promise<void> {
  void surucu().onizleme.durdur();
  await oturumdanAyril();
}

export default CanliOda;
