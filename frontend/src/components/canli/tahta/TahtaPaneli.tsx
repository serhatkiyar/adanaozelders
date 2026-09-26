/* ──────────────────────────────────────────────────────────────────────────
 * ORTAK TAHTA YÜZEYİ — Excalidraw
 *
 * Bu dosya `ZoomOdasi`nda `lazy()` ile yüklenir: Excalidraw, pdf.js ve jsPDF
 * YALNIZ tahta ilk açıldığında inen parçadadır. Başlık şeridi ("Beyaz tahta",
 * "Paylaşımlı", X) bu dosyada DEĞİL (`oda/TahtaAlani`): tahta yüklenirken de
 * görünür.
 *
 * ## Yüzey
 *
 * `EXCALIDRAW_TAM` (varsayılan): Excalidraw'ın KENDİ arayüzü, LiveKit
 * tahtasındaki gibi kısılmadan — araç çubuğu, özellikler, alt çubuk
 * (yakınlaştırma + geri al/yinele), kütüphane, yardım; herkes bütün araçları
 * kullanır (silgi, çerçeve, web gömme, resim). ☰ menü elle kurulur (+ PDF
 * indir/yükle, öğretmende "tam yetkiyi kaldır"). Sayfa denetimi
 * (‹ 1/3 › + ekle + sil) masaüstünde Excalidraw'ın alt çubuğunun SAĞINDA,
 * yardım düğmesinin yanında (`<Footer>`); telefonda sağdaki kilit/el sütununun altında.
 *
 * `EXCALIDRAW_TAM = false`: Preply yüzeyi (sol dikey araç çubuğu, alt solda
 * geri al/yinele + yakınlaştırma; `tahta.css` Excalidraw arayüzünü gizler).
 *
 * ## Eşitleme
 *
 * Senkronizasyon birimi PİKSEL DEĞİL ELEMANDIR: her şekil kendi `id` ve
 * `version` sayacını taşır, yalnız sürümü değişen elemanlar yayınlanır —
 * Excalidraw'ın kendi çoklu kullanıcı uygulamasının (`excalidraw-app`
 * `collab/`) deseni; çakışmayı paketin `reconcileElements`i çözer. Taşıyıcı
 * Centrifugo `ders:{id}` kanalı (`dersKanali.ts`). Kayıp mesaja karşı
 * periyodik TAM SAHNE yayını var (`TAM_SENKRON_MS`).
 *
 * Karşı tarafın imleci her zaman adıyla görünür (en çok 10/sn; pencereden
 * çıkınca ya da uzun hareketsizlikte gizlenir). Karşı tarafın KAYDI
 * (Excalidraw collaborator: sağ üstteki avatar) karşı taraf derste kaldıkça
 * durur; imleç gizlenince yalnız `pointer` alanı kalkar. Avatar giderse
 * Excalidraw öğretmenin öğrenciyi takibini bitirir.
 *
 * ## Takip (`lib/tahtaTakip.ts`)
 *
 * Öğrenci öğretmeni varsayılan olarak TAKİP EDER: öğretmenin görünür alanı
 * öğrencinin ekranına sığdırılır. Öğrenci kendisi kaydırır/yakınlaştırırsa
 * takip kopar, şerit "Öğretmene dön" der; öğretmen "Öğrenciyi bana getir"
 * ile geri çağırır. Bu takip BİZİM durumumuzdur (Excalidraw'ın
 * `userToFollow`u tuvale her dokunuşta takibi bitirir, öğrenci çizerken
 * kopmamalı). Öğretmen öğrenciyi Excalidraw'ın kendi mekanizmasıyla (avatara
 * tıklayarak) takip eder; o sırada öğrenci kendi alanını yayınlar.
 *
 * ## Sahiplik ve izin (`lib/tahtaIzin.ts`)
 *
 * Her eleman oluşturanındır. Öğrenci (tam yetkisi yoksa) öğretmenin
 * elemanını değiştirirse değişiklik yerelde GERİ ALINIR ve bir hareketin
 * değişiklikleri tek istek olarak öğretmene gider; öğretmen izin verir,
 * reddeder ya da derste tam yetki verir. Öğretmen istemcisi de yetkisiz
 * güncellemeyi uygulamaz ve kendi sürümünü yeniden yayınlar. Tam yetki
 * kanal üstünden yayınlanır; geç katılan "istek"le öğrenir.
 *
 * ## Dosyalar telden GİTMEZ
 *
 * PDF ve resim, ders kaynağı olarak yüklenir (private/ + kısa ömürlü imzalı
 * adres; karşı tarafa mevcut "derse yeni dosya paylaşıldı" bildirimi de
 * gider). PDF'te telden yalnız kaynak kimliği ve sayfa numarası gider (zemin
 * görüntüsünün dosya kimliği `pdf-{kaynak}-{no}`); resimde elemanın
 * `customData.kaynak` alanı (`lib/tahtaResim.ts`). Her taraf eksik dosyayı
 * imzalı adresten indirip kendisi ekler.
 *
 * ## Kalıcılık (Preply'dan FARKLI)
 *
 * Preply tahtası sunucuda kalıcı. Burada sahne, sayfa açık kaldıkça modül
 * önbelleğinde durur (tahta kapatılıp açılınca geri gelir) ve açılışta karşı
 * taraftan istenir; iki taraf da sayfayı kapatırsa içerik kaybolur.
 * ────────────────────────────────────────────────────────────────────────── */
import "./excalidrawVarlik";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  CaptureUpdateAction,
  Excalidraw,
  Footer,
  MainMenu,
  convertToExcalidrawElements,
  exportToBlob,
  exportToCanvas,
  mutateElement,
  reconcileElements,
  restoreElements,
  useDevice,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type {
  ExcalidrawElement,
  FileId,
  OrderedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  Collaborator,
  ExcalidrawImperativeAPI,
  NormalizedZoomValue,
  SocketId,
} from "@excalidraw/excalidraw/types";

import { fetchBooking, uploadBookingResource } from "@/api/bookings";
import { Icon, type IconName } from "@/components/AppIcon";
import { Modal } from "@/components/ui/Modal";
import { PlainButton } from "@/components/ui/PlainButton";
import { pdfAc, type AcikPdf } from "@/lib/pdfSayfa";
import {
  anlamliFark,
  damgala,
  gidenKopya,
  ogrenciDegisikliginiAyir,
  ogretmenDenetimi,
  onerileriHazirla,
  pdfZeminiMi,
  type IzinElemani,
  type TahtaRolu,
} from "@/lib/tahtaIzin";
import {
  RESIM_SINIRI,
  dataUrlCoz,
  resimDosyaAdi,
  resimKaynagi,
  resimUzantisi,
} from "@/lib/tahtaResim";
import {
  BASLANGIC_SAYFALARI,
  degisenler,
  elemanSayfasi,
  gorunurMu,
  mezarTasi,
  pdfDosyaCoz,
  pdfDosyaKimligi,
  pdfSayfalariniYerlestir,
  sayfaEkle,
  sayfaEtiketle,
  sayfaGec,
  sayfaSil,
  sayfalariBirlestir,
  surumleriYaz,
  type PdfYeri,
  type SayfaDurumu,
  type TahtaEleman,
  type TahtaMesaji,
  type TahtaSayfasi,
} from "@/lib/tahtaSenkron";
import {
  alanaSigdir,
  ayniGorunum,
  gorunumDegisti,
  gorunurAlan,
  takipKoptuMu,
  yayinlamaliMi,
  type Alan,
  type Gorunum,
} from "@/lib/tahtaTakip";

import type { DersKanali, Gonderen } from "./dersKanali";
import { IzinIstegiPenceresi, PdfYeriPenceresi, type GelenIstek } from "./IzinPencereleri";
import "./tahta.css";

/** Çizim yayını bu aralıkta biriktirilir (60 fps'de her kareyi yollamamak için). */
const YAYIN_ARALIGI_MS = 120;
/** Periyodik tam sahne yayını — düşen mesajın bıraktığı ayrışmayı kapatır. */
const TAM_SENKRON_MS = 10_000;
/** İmleç (lazer dahil) yayını en çok 10/sn. */
const IMLEC_ARALIGI_MS = 100;
/** Görünür alan yayını (takip) en çok 10/sn. */
const GORUNUM_ARALIGI_MS = 100;
/** Bu kadar hareketsiz kalan karşı imleç gizlenir. */
const IMLEC_SUSMA_MS = 30_000;
/** Öğrencinin yetkisiz değişikliği: parmak kalktıktan bu kadar sonra tek istek. */
const ISTEK_BEKLEME_MS = 700;
/**
 * Yetkisiz değişiklik yalnız bu süre içinde kullanıcı etkileşimi (dokunma,
 * tuş, yapıştırma) olduysa istek olur; yoksa Excalidraw'ın kendiliğinden
 * yaptığı bir düzeltmedir (ör. yazı tipi yüklenince metin ölçüsü) ve
 * sessizce geri alınır — öğretmene boş yere istek gitmez.
 */
const ETKILESIM_PENCERESI_MS = 5_000;
/** İndirilemeyen resim bu süre dolmadan yeniden denenmez. */
const YENIDEN_DENEME_MS = 10_000;
/** Görünür alanın PDF zemini için ayrılan payı (kenarda nefes payı kalsın). */
const ZEMIN_PAYI = 0.88;

/** Araç çubuğu düğmeleri (Excalidraw araç türleri + "şekil" grubu). */
type AracTuru = "selection" | "laser" | "freedraw" | "text" | "sekil" | "eraser" | "hand";
type SekilTuru = "rectangle" | "ellipse" | "diamond" | "arrow" | "line";

const SEKIL_IKONU: Record<SekilTuru, IconName> = {
  rectangle: "square",
  ellipse: "circle",
  diamond: "diamond",
  arrow: "arrowUpRight",
  line: "lineHorizontal",
};

/**
 * Preply yüzeyinde (`EXCALIDRAW_TAM = false`) öğrencinin kullanabildiği araç
 * türleri (kısayolla da seçilse sıfırlanır). Tam modda sıfırlama YOK.
 */
const OGRENCI_ARACLARI = new Set([
  "selection",
  "laser",
  "freedraw",
  "text",
  "rectangle",
  "ellipse",
  "diamond",
  "arrow",
  "line",
  "hand",
]);
const OGRETMEN_ARACLARI = new Set([...OGRENCI_ARACLARI, "eraser"]);

const RENKLER = [
  { ad: "siyah", deger: "#1e1e1e" },
  { ad: "kirmizi", deger: "#e03131" },
  { ad: "mavi", deger: "#1971c2" },
  { ad: "yesil", deger: "#2f9e44" },
  { ad: "turuncu", deger: "#f08c00" },
] as const;
const KALINLIKLAR = [
  { ad: "ince", deger: 1 },
  { ad: "orta", deger: 2 },
  { ad: "kalin", deger: 4 },
] as const;
const BOYUTLAR = [
  { ad: "kucuk", deger: 16 },
  { ad: "orta", deger: 20 },
  { ad: "buyuk", deger: 28 },
] as const;

type Kutu = { x: number; y: number; genislik: number; yukseklik: number };

function kutuyaSigdir(hedef: Kutu, gGenislik: number, gYukseklik: number): Kutu {
  const olcek = Math.min(hedef.genislik / gGenislik, hedef.yukseklik / gYukseklik);
  const genislik = Math.round(gGenislik * olcek);
  const yukseklik = Math.round(gYukseklik * olcek);
  return {
    x: Math.round(hedef.x + (hedef.genislik - genislik) / 2),
    y: Math.round(hedef.y + (hedef.yukseklik - yukseklik) / 2),
    genislik,
    yukseklik,
  };
}

/* ── Modül önbelleği: tahta kapatılıp açılınca sahne geri gelir ────────── */

type Onbellek = {
  defter: Map<string, OrderedExcalidrawElement>;
  sayfalar: SayfaDurumu;
  dosyalar: Map<string, BinaryFileData>;
  zeminCercevesi: Kutu | null;
  /** Bu istemcide doğan elemanlar (`lib/tahtaIzin.ts`). */
  yerelDogan: Set<string>;
  /** Öğrencinin bu dersteki tam yetkisi (iki tarafta da tutulur). */
  tamYetki: boolean;
};
const onbellekler = new Map<number, Onbellek>();
function onbellek(dersId: number): Onbellek {
  let o = onbellekler.get(dersId);
  if (!o) {
    o = {
      defter: new Map(),
      sayfalar: BASLANGIC_SAYFALARI,
      dosyalar: new Map(),
      zeminCercevesi: null,
      yerelDogan: new Set(),
      tamYetki: false,
    };
    onbellekler.set(dersId, o);
  }
  return o;
}

/** Ders kaynağının kısa ömürlü imzalı adresi (ders yanıtı taze çekilir). */
async function kaynakAdresi(dersId: number, kaynak: number): Promise<string> {
  // Önbellekteki ders yanıtı yeni yüklenen kaynağı içermez: taze çekilir.
  // Yanıttaki adres sunucuda kısa ömürlü imzalı adrese çevrilmiştir.
  const ders = await fetchBooking(dersId);
  const k = ders.resources?.find((r) => r.id === kaynak && r.kind === "file");
  if (!k) throw new Error("kaynak yok");
  return k.url;
}

/** Ders kaynağı PDF'leri: kaynak kimliği → açık belge. */
const pdfler = new Map<number, Promise<AcikPdf>>();

async function kaynakPdfiniAc(dersId: number, kaynak: number): Promise<AcikPdf> {
  // Tüm dosya tek istekte (pdf.js `url` modu parça/aralık istekleri açar).
  const yanit = await fetch(await kaynakAdresi(dersId, kaynak));
  if (!yanit.ok) throw new Error(`HTTP ${yanit.status}`);
  return pdfAc(await yanit.arrayBuffer());
}

function pdfGetir(dersId: number, kaynak: number): Promise<AcikPdf> {
  let p = pdfler.get(kaynak);
  if (!p) {
    p = kaynakPdfiniAc(dersId, kaynak);
    p.catch(() => pdfler.delete(kaynak));
    pdfler.set(kaynak, p);
  }
  return p;
}

/** Resim kaynağını indirir (`data:` adresi + tür). */
async function resimIndir(dersId: number, kaynak: number): Promise<{ dataURL: string; tur: string }> {
  const yanit = await fetch(await kaynakAdresi(dersId, kaynak));
  if (!yanit.ok) throw new Error(`HTTP ${yanit.status}`);
  const blob = await yanit.blob();
  if (!resimUzantisi(blob.type)) throw new Error("tür");
  const dataURL = await new Promise<string>((coz, reddet) => {
    const okuyucu = new FileReader();
    okuyucu.onload = () => coz(String(okuyucu.result));
    okuyucu.onerror = () => reddet(okuyucu.error);
    okuyucu.readAsDataURL(blob);
  });
  return { dataURL, tur: blob.type };
}

/** Yüklenen dosyanın ders kaynağı kimliği: aynı adlı kaynakların en yenisi. */
function yeniKaynak(
  ders: Awaited<ReturnType<typeof uploadBookingResource>>,
  ad: string,
): number | null {
  return (ders.resources ?? [])
    .filter((r) => r.kind === "file" && r.file_name === ad)
    .reduce<number | null>((en, r) => (en === null || r.id > en ? r.id : en), null);
}

/** Excalidraw klavye kısayolunu kabın üstünde tetikler (geri al, yakınlaştır). */
function kisayol(kap: HTMLElement | null, key: string, code: string, shift = false) {
  const hedef = kap?.querySelector<HTMLElement>(".excalidraw");
  if (!hedef) return;
  hedef.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      code,
      ctrlKey: true,
      metaKey: true,
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function indir(blob: Blob, ad: string) {
  const adres = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = adres;
  a.download = ad;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(adres), 1000);
}

const damga = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const kimlikUret = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const izinE = (e: unknown) => e as IzinElemani;
const excE = (e: unknown) => e as OrderedExcalidrawElement;

/** Excalidraw'ın cihaz bilgisini (telefon düzeni mi) dışarı bildirir. */
function CihazBildir({ onMobil }: { onMobil: (mobil: boolean) => void }) {
  const mobil = useDevice().editor.isMobile;
  useEffect(() => onMobil(mobil), [mobil, onMobil]);
  return null;
}

type Props = {
  kanal: DersKanali;
  dersId: number;
  ogretmen: boolean;
  /** Karşı tarafın adı: imleç etiketi ve izin pencereleri. */
  karsiAd: string;
};

export default function TahtaPaneli({ kanal, dersId, ogretmen, karsiAd }: Props) {
  const { t } = useTranslation();
  const o = onbellek(dersId);
  const rol: TahtaRolu = ogretmen ? "ogretmen" : "ogrenci";
  const kap = useRef<HTMLDivElement>(null);
  const pdfGirdisi = useRef<HTMLInputElement>(null);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [durum, setDurum] = useState<string | null>(null);
  const [mesgul, setMesgul] = useState<string | null>(null);
  const [sayfalar, setSayfalarDurumu] = useState<SayfaDurumu>(o.sayfalar);
  const [aktifArac, setAktifArac] = useState<string>("freedraw");
  const [sekil, setSekil] = useState<SekilTuru>("rectangle");
  const [yakinlik, setYakinlik] = useState(1);
  const [silOnay, setSilOnay] = useState(false);
  const [mobil, setMobil] = useState(false);
  const [tamYetki, setTamYetkiDurumu] = useState(o.tamYetki);
  /** Öğretmende: öğrenciden gelen, yanıt bekleyen istekler (ilki gösterilir). */
  const [istekler, setIstekler] = useState<GelenIstek[]>([]);
  /** Açılacak PDF için yer seçimi (öğretmen ya da tam yetkili öğrenci). */
  const [pdfSecim, setPdfSecim] = useState<File | null>(null);
  /** Öğrencide: öğretmenin onayını bekleyen PDF. */
  const [pdfBekleme, setPdfBeklemeDurumu] = useState<{ k: string; dosya: File } | null>(null);
  /** Öğrencide: öğretmeni takip ediyor mu (açılışta evet). */
  const [takip, setTakipDurumu] = useState(true);
  /** Öğretmende: öğrenci takip ediyor mu (`null`: bilinmiyor). */
  const [ogrenciTakip, setOgrenciTakipDurumu] = useState<boolean | null>(null);
  const [karsiVar, setKarsiVarDurumu] = useState(() => kanal.varlik().karsiVar);

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  apiRef.current = api;
  const karsiAdRef = useRef(karsiAd);
  karsiAdRef.current = karsiAd;
  const sayfaRef = useRef<SayfaDurumu>(o.sayfalar);
  const setSayfalar = useCallback(
    (d: SayfaDurumu) => {
      sayfaRef.current = d;
      o.sayfalar = d;
      setSayfalarDurumu(d);
    },
    [o],
  );
  const aktifSayfa = () => sayfaRef.current.aktif;
  const tamYetkiRef = useRef(o.tamYetki);
  const takipRef = useRef(true);
  const setTakip = useCallback((v: boolean) => {
    takipRef.current = v;
    setTakipDurumu(v);
  }, []);
  const ogrenciTakipRef = useRef<boolean | null>(null);
  const setOgrenciTakip = useCallback((v: boolean | null) => {
    ogrenciTakipRef.current = v;
    setOgrenciTakipDurumu(v);
  }, []);
  const karsiVarRef = useRef(karsiVar);
  const pdfBeklemeRef = useRef<{ k: string; dosya: File } | null>(null);
  const setPdfBekleme = (d: { k: string; dosya: File } | null) => {
    pdfBeklemeRef.current = d;
    setPdfBeklemeDurumu(d);
  };

  /** "Karşı tarafın bildiğine inandığım sürüm" — eko döngüsünü bu kırar. */
  const bilinen = useRef(new Map<string, number>());
  /** DEFTER — bütün sayfaların bütün elemanları; sahnede yalnız aktif sayfa. */
  const defter = o.defter;
  const yerelDogan = o.yerelDogan;
  const yayinZamani = useRef<number | null>(null);
  const yukleniyor = useRef(new Set<string>());
  const basarisiz = useRef(new Map<string, number>());

  // İmleç
  const sonImlec = useRef(0);
  const imlecZamani = useRef<number | null>(null);
  const bekleyenImlec = useRef<Extract<TahtaMesaji, { t: "imlec" }> | null>(null);
  const karsiImlecler = useRef(new Map<SocketId, Collaborator>());
  const imlecSusma = useRef<number | null>(null);

  // Takip (`lib/tahtaTakip.ts`)
  /** Öğrencide: öğretmen beni izliyor mu (`izle`). */
  const izleniyor = useRef(false);
  /** Takip edilenin (öğrencide öğretmen, öğretmende izlenen öğrenci) son alanı. */
  const sonAlan = useRef<Alan | null>(null);
  /** Son programatik uyguladığımız görünüm — onu kullanıcı kaydırmasından ayırır. */
  const beklenenGorunum = useRef<Gorunum | null>(null);
  /** Parmak/fare basılıyken gelen alan: bırakınca uygulanır. */
  const bekleyenGorunum = useRef<Alan | null>(null);
  /** Son kaydırma/yakınlaştırma girdisi (tekerlek, dokunma, tuş) zamanı. */
  const sonGorunumGirdisi = useRef(0);
  const sonYayinlananAlan = useRef<Alan | null>(null);
  const gorunumZamani = useRef<number | null>(null);
  const sonBoyut = useRef<{ w: number; h: number } | null>(null);

  // İzin (öğrenci): reddedilen yerel değişiklikler (id → önerilen kopya).
  const bekleyen = useRef(new Map<string, OrderedExcalidrawElement>());
  const hareket = useRef(false);
  const sonEtkilesim = useRef(0);
  const istekZamani = useRef<number | null>(null);
  const istegiGonderRef = useRef<() => void>(() => {});
  // İzin (öğretmen): bekleyen değişiklik önerileri ve onaylanmış PDF istekleri.
  const oneriler = useRef(new Map<string, TahtaEleman[]>());
  const onayliPdf = useRef(new Map<string, PdfYeri>());
  // Resim yüklemeleri (dosya kimliği → sürüyor).
  const resimYuklemeleri = useRef(new Set<string>());

  const benimMi = (e: { id: string }) => !defter.has(e.id) || yerelDogan.has(e.id);

  /* ── Defter ───────────────────────────────────────────────────────────── */

  /**
   * İsteği kurar. Kurulu sayaç YENİLENMEZ: aynı öneri her eşitleme turunda
   * yeniden reddedilir, sayaç her seferinde baştan başlasaydı karşıdan akan
   * trafik isteği sonsuza dek erteleyebilirdi.
   */
  const istekZamanla = useCallback(() => {
    if (istekZamani.current !== null || hareket.current) return; // parmak kalkınca kurulur
    istekZamani.current = window.setTimeout(() => {
      istekZamani.current = null;
      istegiGonderRef.current();
    }, ISTEK_BEKLEME_MS);
  }, []);

  /**
   * Elemanları deftere yazar.
   *
   * DEFTER SAHNEYLE NESNE PAYLAŞMAZ: Excalidraw sürükleme/boyutlandırma/metin
   * düzenlemede elemanı YERİNDE değiştirir (sürümü de yerinde artırır).
   * Paylaşılsaydı defterdeki "son bilinen" kopya da değişmiş olur, öğrencinin
   * öğretmen elemanını taşıması hiç fark edilmezdi. Bu yüzden sahneden
   * deftere KOPYA yazılır (yalnız daha yeni sürüm), sahneye de kopya gider
   * (`sahneIcin`).
   *
   * `yerel` (sahneden okunan) elemanlarda: deftere İLK kez giren eleman bu
   * istemcide doğmuştur; öğrencide (tam yetki yoksa) öğretmenin elemanındaki
   * yetkisiz değişiklik deftere YAZILMAZ, isteğe biriktirilir.
   */
  const defteriDoldur = useCallback(
    (elemanlar: readonly OrderedExcalidrawElement[], yerel = true) => {
      if (!yerel) {
        for (const e of elemanlar) defter.set(e.id, e);
        return;
      }
      const yaz = (e: OrderedExcalidrawElement) => {
        const d = defter.get(e.id);
        if (!d || e.version > d.version) defter.set(e.id, { ...e });
      };
      for (const e of elemanlar) if (!defter.has(e.id)) yerelDogan.add(e.id);
      if (rol === "ogretmen" || tamYetkiRef.current) {
        for (const e of elemanlar) yaz(e);
        return;
      }
      const { kabul, ret } = ogrenciDegisikliginiAyir(
        elemanlar as unknown as IzinElemani[],
        (id) => defter.get(id) as unknown as IzinElemani | undefined,
        yerelDogan,
      );
      for (const e of kabul) yaz(excE(e));
      if (ret.length === 0) return;
      for (const e of ret) bekleyen.current.set(e.id, excE(e));
      istekZamanla();
    },
    [defter, istekZamanla, rol, yerelDogan],
  );

  const dosyaEkle = useCallback(
    (a: ExcalidrawImperativeAPI, id: string, dataURL: string, tur = "image/jpeg") => {
      const dosya = {
        id: id as FileId,
        dataURL: dataURL as BinaryFileData["dataURL"],
        mimeType: tur,
        created: Date.now(),
      } as BinaryFileData;
      o.dosyalar.set(id, dosya);
      a.addFiles([dosya]);
    },
    [o],
  );

  /**
   * Görünür elemanlardan dosyası eksik olanları tamamlar: önbellekte varsa
   * oradan, PDF zemini ise sayfayı çizerek, resim ise kaynağından indirerek.
   */
  const eksikDosyalariYukle = useCallback(
    (a: ExcalidrawImperativeAPI) => {
      const dosyalar = a.getFiles();
      const onbellektekiler: BinaryFileData[] = [];
      for (const e of a.getSceneElements()) {
        if (e.type !== "image" || !e.fileId || dosyalar[e.fileId]) continue;
        const fid = e.fileId;
        const kayitli = o.dosyalar.get(fid);
        if (kayitli) {
          onbellektekiler.push(kayitli);
          continue;
        }
        if (yukleniyor.current.has(fid)) continue;
        const pdf = pdfDosyaCoz(fid);
        if (pdf) {
          yukleniyor.current.add(fid);
          void pdfGetir(dersId, pdf.kaynak)
            .then((b) => b.sayfayiCiz(pdf.no))
            .then((g) => dosyaEkle(a, fid, g.dataURL))
            .catch(() => setDurum(t("tahta.durum.sayfaAcilamadi")))
            .finally(() => yukleniyor.current.delete(fid));
          continue;
        }
        const kaynak = resimKaynagi(defter.values(), fid);
        if (kaynak === null) continue; // yükleyende hâlâ yükleniyor: yer tutucu
        const son = basarisiz.current.get(fid);
        if (son !== undefined && Date.now() - son < YENIDEN_DENEME_MS) continue;
        yukleniyor.current.add(fid);
        void resimIndir(dersId, kaynak)
          .then((r) => {
            basarisiz.current.delete(fid);
            dosyaEkle(a, fid, r.dataURL, r.tur);
          })
          .catch(() => {
            basarisiz.current.set(fid, Date.now());
            setDurum(t("tahta.durum.resimAcilamadi"));
          })
          .finally(() => yukleniyor.current.delete(fid));
      }
      if (onbellektekiler.length > 0) a.addFiles(onbellektekiler);
    },
    [defter, dersId, dosyaEkle, o, t],
  );

  /**
   * Defter elemanlarının sahneye gidecek hâli. Sahnedeki nesne aynı ya da
   * daha yeniyse O NESNE korunur: Excalidraw çizilmekte olan elemanı
   * referansla tutar (değişirse çizgi yarıda kopar) ve öğrencinin henüz
   * istek olarak gitmemiş önerisi, sürükleme yarıda geri çekilmesin diye
   * böyle sahnede kalır. Aksi hâlde defterin KOPYASI gider. `geriAl`daki
   * kimlikler her durumda defterden yazılır.
   */
  const sahneIcin = useCallback(
    (
      a: ExcalidrawImperativeAPI,
      elemanlar: readonly OrderedExcalidrawElement[],
      geriAl?: ReadonlySet<string>,
    ): OrderedExcalidrawElement[] => {
      const sahne = new Map(a.getSceneElementsIncludingDeleted().map((e) => [e.id, e]));
      const d = a.getAppState();
      const mesgul = new Set(
        [d.newElement?.id, d.editingTextElement?.id, d.resizingElement?.id].filter(Boolean),
      );
      return elemanlar.map((e) => {
        const s = sahne.get(e.id);
        if (s && !geriAl?.has(e.id)) {
          if (mesgul.has(e.id) || s.version > e.version) return s;
          if (s.version === e.version && s.versionNonce === e.versionNonce) return s;
        }
        return { ...e };
      });
    },
    [],
  );

  /** Sahneyi defterin aktif sayfaya düşen alt kümesiyle yeniden yazar. */
  const gorunuruYaz = useCallback(
    (a: ExcalidrawImperativeAPI, geriAl?: ReadonlySet<string>) => {
      const gorunur = [...defter.values()]
        .filter((e) => gorunurMu(e as unknown as TahtaEleman, aktifSayfa()))
        .sort((x, y) =>
          (x.index ?? "") < (y.index ?? "") ? -1 : (x.index ?? "") > (y.index ?? "") ? 1 : 0,
        );
      a.updateScene({
        elements: sahneIcin(a, gorunur, geriAl),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      eksikDosyalariYukle(a);
    },
    [defter, eksikDosyalariYukle, sahneIcin],
  );

  /* ── Gönderim ─────────────────────────────────────────────────────────── */

  const gonder = useCallback((m: TahtaMesaji) => kanal.yayinla(m), [kanal]);

  /** İçerik yayını: yerelde doğanlara sahip yazılır, bilinen sürümler güncellenir. */
  const durumGonder = useCallback(
    (elemanlar: readonly TahtaEleman[], sayfaDurumu?: SayfaDurumu) => {
      surumleriYaz(elemanlar, bilinen.current);
      const giden = elemanlar.map((e) => gidenKopya(izinE(e), yerelDogan, rol));
      gonder(
        sayfaDurumu
          ? { t: "durum", elemanlar: giden, sayfalar: sayfaDurumu }
          : { t: "durum", elemanlar: giden },
      );
    },
    [gonder, rol, yerelDogan],
  );

  const tamSahneyiGonder = useCallback(() => {
    const a = apiRef.current;
    if (!a) return;
    defteriDoldur(a.getSceneElementsIncludingDeleted());
    durumGonder([...defter.values()] as unknown as TahtaEleman[], sayfaRef.current);
    if (rol === "ogretmen") gonder({ t: "yetki", tam: tamYetkiRef.current });
  }, [defter, defteriDoldur, durumGonder, gonder, rol]);

  /** Yalnız DEĞİŞENLERİ yayınlar (mezar taşları dahil: silgi böyle yayılır). */
  const degisenleriGonder = useCallback(() => {
    const a = apiRef.current;
    if (!a) return;
    defteriDoldur(a.getSceneElementsIncludingDeleted());
    // Yeni doğan elemanlara sayfa + sahip damgası; çizilmekte olan atlanır.
    // Karşıdan gelen etiketsiz elemanı (eski davranış) öğretmen ya da tam
    // yetkili öğrenci etiketler; yetkisiz öğrenci öğretmenin elemanına dokunmaz.
    const d = a.getAppState();
    const mesgulIdler = new Set(
      [d.newElement?.id, d.editingTextElement?.id, d.resizingElement?.id].filter(
        (id): id is string => typeof id === "string",
      ),
    );
    const etiketleyebilir = rol === "ogretmen" || tamYetkiRef.current;
    const sahne = new Map(a.getSceneElementsIncludingDeleted().map((e) => [e.id, e]));
    let etiketlendi = false;
    for (const e of [...defter.values()]) {
      if (mesgulIdler.has(e.id)) continue;
      let yeni: TahtaEleman | null = null;
      if (yerelDogan.has(e.id)) {
        const s = sahne.get(e.id);
        if (s) {
          // Yerelde doğan eleman sahnedeki KENDİ NESNESİNDE damgalanır.
          // Excalidraw yapıştırılan/bırakılan resmi önce yer tutucu olarak
          // ekler, dosya kimliğini ve boyutunu sonradan (async) AYNI nesneye
          // yazar; sahneye kopya konsaydı bu yazım sahnede olmayan nesneye
          // gider, resim sonsuza dek `fileId: null, status: "pending"` kalırdı.
          const d = damgala(izinE(s), aktifSayfa(), yerelDogan, rol);
          if (!d) continue;
          mutateElement(s, { customData: d.customData ?? undefined }, false); // sürümü de artırır
          defter.set(e.id, { ...s });
          etiketlendi = true;
          continue;
        }
        yeni = damgala(izinE(e), aktifSayfa(), yerelDogan, rol);
      } else if (etiketleyebilir && elemanSayfasi(e as unknown as TahtaEleman) === null) {
        yeni = sayfaEtiketle(e as unknown as TahtaEleman, aktifSayfa());
      }
      if (!yeni) continue;
      defter.set(e.id, excE(yeni));
      etiketlendi = true;
    }
    if (etiketlendi) gorunuruYaz(a);
    const yeni = degisenler([...defter.values()] as unknown as TahtaEleman[], bilinen.current);
    if (yeni.length === 0) return;
    durumGonder(yeni);
  }, [defter, defteriDoldur, durumGonder, gorunuruYaz, rol, yerelDogan]);

  /* ── Resimler ─────────────────────────────────────────────────────────── */

  /** Yükleyemediğimiz resmi (tür/boyut/hata) kendi elemanlarımızdan kaldırır. */
  const resmiKaldir = useCallback(
    (fid: string, mesaj: string) => {
      const a = apiRef.current;
      setDurum(mesaj);
      if (!a) return;
      let degisti = false;
      const sahne = a.getSceneElementsIncludingDeleted().map((e) => {
        if (e.type !== "image" || e.fileId !== fid || e.isDeleted || !benimMi(e)) return e;
        degisti = true;
        return excE(mezarTasi(e as unknown as TahtaEleman));
      });
      if (degisti) a.updateScene({ elements: sahne, captureUpdate: CaptureUpdateAction.NEVER });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Yüklenen resmin kaynağını kendi resim elemanlarımıza yazar (yayılır). */
  const resmiDamgala = useCallback(
    (fid: string, kaynak: number) => {
      const a = apiRef.current;
      if (!a) return;
      // Yerinde: Excalidraw resmin boyutunu hâlâ bu nesneye yazıyor olabilir.
      let degisti = false;
      const sahne = a.getSceneElementsIncludingDeleted();
      for (const e of sahne) {
        if (e.type !== "image" || e.fileId !== fid || !benimMi(e)) continue;
        if (e.customData?.kaynak === kaynak) continue;
        mutateElement(e, { status: "saved", customData: { ...(e.customData ?? {}), kaynak } }, false);
        degisti = true;
      }
      if (degisti) a.updateScene({ elements: [...sahne], captureUpdate: CaptureUpdateAction.NEVER });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * Yeni eklenen (yapıştırılan/bırakılan/araçla seçilen) resimleri ders
   * kaynağı olarak yükler. Dosya telden gitmez; yükleme bitince elemana
   * kaynak kimliği yazılır, karşı taraf oradan indirir.
   */
  const resimleriYukle = useCallback(
    (files: BinaryFiles) => {
      const a = apiRef.current;
      if (!a) return;
      for (const [id, f] of Object.entries(files)) if (!o.dosyalar.has(id)) o.dosyalar.set(id, f);
      for (const e of a.getSceneElements()) {
        if (e.type !== "image" || !e.fileId || !benimMi(e)) continue;
        const fid = e.fileId;
        if (pdfDosyaCoz(fid) || typeof e.customData?.kaynak === "number") continue;
        if (resimYuklemeleri.current.has(fid)) continue;
        // Aynı dosyayı gösteren bir kopya zaten yüklenmişse onu kullan.
        const onceki = resimKaynagi(defter.values(), fid);
        if (onceki !== null) {
          resmiDamgala(fid, onceki);
          continue;
        }
        const dosya = files[fid];
        if (!dosya) continue;
        const cozulen = dataUrlCoz(dosya.dataURL);
        const ad = cozulen ? resimDosyaAdi(fid, cozulen.tur) : null;
        if (!cozulen || !ad) {
          resmiKaldir(fid, t("tahta.durum.resimTuru"));
          continue;
        }
        if (cozulen.veri.byteLength > RESIM_SINIRI) {
          resmiKaldir(fid, t("tahta.durum.resimBuyuk"));
          continue;
        }
        resimYuklemeleri.current.add(fid);
        const dosyaNesnesi = new File([cozulen.veri.slice().buffer], ad, { type: cozulen.tur });
        void uploadBookingResource(dersId, dosyaNesnesi)
          .then((ders) => {
            const kaynak = yeniKaynak(ders, ad);
            if (kaynak === null) throw new Error("kaynak");
            resmiDamgala(fid, kaynak);
          })
          .catch(() => resmiKaldir(fid, t("tahta.durum.resimYuklenemedi")))
          .finally(() => resimYuklemeleri.current.delete(fid));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defter, dersId, o, resmiDamgala, resmiKaldir, t],
  );

  /* ── Takip ────────────────────────────────────────────────────────────── */

  /** Alanı ekrana sığdırır. Programatiktir: yayınlanmaz, takibi koparmaz. */
  const alaniYaz = useCallback((alan: Alan) => {
    const a = apiRef.current;
    if (!a) return;
    const d = a.getAppState();
    if (d.width <= 0 || d.height <= 0) return;
    const g = alanaSigdir(alan, { width: d.width, height: d.height });
    beklenenGorunum.current = g;
    a.updateScene({
      appState: {
        scrollX: g.scrollX,
        scrollY: g.scrollY,
        zoom: { value: g.zoom as NormalizedZoomValue },
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, []);

  /** Parmak/fare basılıyken bekletir (çizim ortasında ekran kaymasın). */
  const alaniUygula = useCallback(
    (alan: Alan) => {
      if (hareket.current) {
        bekleyenGorunum.current = alan;
        return;
      }
      bekleyenGorunum.current = null;
      alaniYaz(alan);
    },
    [alaniYaz],
  );

  /**
   * Görünür alanımı yayınlar. `zorla`: karşı taraf bunu bekliyor (açılış
   * isteği, takip başladı, getir, izle) — değişmemiş ya da programatik
   * görünüm de gider (Centrifugo geçmiş tutmaz).
   */
  const gorunumGonder = useCallback(
    (zorla = false) => {
      const a = apiRef.current;
      if (!a) return;
      const d = a.getAppState();
      if (d.width <= 0 || d.height <= 0) return;
      const simdiki = { scrollX: d.scrollX, scrollY: d.scrollY, zoom: d.zoom.value };
      const alan = gorunurAlan({ ...simdiki, width: d.width, height: d.height });
      if (!zorla) {
        const yayinla = yayinlamaliMi({
          ogretmen: rol === "ogretmen",
          karsiVar: karsiVarRef.current,
          ogrenciTakip: ogrenciTakipRef.current,
          ogretmenTakipEdiyor: d.userToFollow !== null,
          izleniyor: izleniyor.current,
        });
        if (!yayinla) return;
        const b = beklenenGorunum.current;
        if (b && ayniGorunum(b, simdiki)) return; // programatik görünüm ASLA yayınlanmaz
        if (!gorunumDegisti(sonYayinlananAlan.current, alan, simdiki.zoom)) return;
      }
      sonYayinlananAlan.current = alan;
      gonder({ t: "gorunum", ...alan });
    },
    [gonder, rol],
  );

  /** Görünüm yayını: 100 ms sonra (en çok 10/sn), yalnız değiştiyse. */
  const gorunumZamanla = useCallback(() => {
    if (gorunumZamani.current !== null) return;
    gorunumZamani.current = window.setTimeout(() => {
      gorunumZamani.current = null;
      gorunumGonder();
    }, GORUNUM_ARALIGI_MS);
  }, [gorunumGonder]);

  /** ÖĞRENCİ: kendi kaydırdı — takip biter, şerit görünür. */
  const takibiBirak = useCallback(() => {
    if (!takipRef.current) return;
    setTakip(false);
    bekleyenGorunum.current = null;
    gonder({ t: "takip", acik: false });
  }, [gonder, setTakip]);

  /** ÖĞRENCİ: "Öğretmene dön" — öğretmenin bilinen son alanına hemen döner. */
  const ogretmeneDon = useCallback(() => {
    setTakip(true);
    gonder({ t: "takip", acik: true });
    if (sonAlan.current) alaniUygula(sonAlan.current);
  }, [alaniUygula, gonder, setTakip]);

  /** ÖĞRETMEN: "Öğrenciyi bana getir" (öğrenciyi takip ediyorsa önce bırakır). */
  const ogrenciyiGetir = useCallback(() => {
    const a = apiRef.current;
    if (!a) return;
    if (a.getAppState().userToFollow) {
      a.updateScene({ appState: { userToFollow: null }, captureUpdate: CaptureUpdateAction.NEVER });
    }
    gonder({ t: "getir" });
    gorunumGonder(true);
  }, [gonder, gorunumGonder]);

  const degisimeTepki = useCallback(
    (_e: readonly unknown[], appState: AppState, files: BinaryFiles) => {
      // Takip: pencere boyutu değiştiyse son alan yeniden sığdırılır; görünür
      // alan yayını (çizim yayınının erken dönüşünden ÖNCE).
      const boyut = sonBoyut.current;
      if (!boyut || boyut.w !== appState.width || boyut.h !== appState.height) {
        sonBoyut.current = { w: appState.width, h: appState.height };
        const takipte = rol === "ogretmen" ? appState.userToFollow !== null : takipRef.current;
        if (boyut && takipte && sonAlan.current) alaniUygula(sonAlan.current);
      }
      gorunumZamanla();
      const tur = appState.activeTool.type;
      if (!EXCALIDRAW_TAM) {
        // Preply yüzeyi: kısayolla seçilen, çubukta olmayan araç sıfırlanır.
        const izinli = ogretmen ? OGRETMEN_ARACLARI : OGRENCI_ARACLARI;
        if (!izinli.has(tur)) {
          apiRef.current?.setActiveTool({ type: "selection" });
        } else if (tur !== aktifArac) {
          setAktifArac(tur);
        }
        if (appState.zoom.value !== yakinlik) setYakinlik(appState.zoom.value);
      } else {
        resimleriYukle(files);
      }
      if (yayinZamani.current !== null) return;
      yayinZamani.current = window.setTimeout(() => {
        yayinZamani.current = null;
        degisenleriGonder();
      }, YAYIN_ARALIGI_MS);
    },
    [
      aktifArac,
      alaniUygula,
      degisenleriGonder,
      gorunumZamanla,
      ogretmen,
      resimleriYukle,
      rol,
      yakinlik,
    ],
  );

  /* ── İzin ─────────────────────────────────────────────────────────────── */

  const tamYetkiYaz = useCallback(
    (tam: boolean) => {
      tamYetkiRef.current = tam;
      o.tamYetki = tam;
      setTamYetkiDurumu(tam);
    },
    [o],
  );

  /**
   * ÖĞRENCİ: bir hareketin yetkisiz değişikliklerini geri alır ve TEK istek
   * olarak öğretmene yollar. Bu arada tam yetki geldiyse değişiklik kalır.
   */
  const istegiGonder = useCallback(() => {
    const a = apiRef.current;
    if (!a || hareket.current || bekleyen.current.size === 0) return;
    const oneriListesi = [...bekleyen.current.values()];
    bekleyen.current.clear();
    if (rol === "ogretmen" || tamYetkiRef.current) {
      for (const e of oneriListesi) defter.set(e.id, { ...e });
      gorunuruYaz(a);
      degisenleriGonder();
      return;
    }
    // Anlık kopya: sahnedeki nesne geri almadan sonra da Excalidraw'da kalabilir.
    const gercek = oneriListesi
      .filter((e) => {
        const onceki = defter.get(e.id);
        return onceki !== undefined && anlamliFark(izinE(onceki), izinE(e));
      })
      .map((e) => ({ ...e }));
    gorunuruYaz(a, new Set(oneriListesi.map((e) => e.id))); // geri al
    // "Tuvali sıfırla" görüntü önbelleğini boşaltır: geri gelen resimler yeniden eklenir.
    if (o.dosyalar.size > 0) a.addFiles([...o.dosyalar.values()]);
    if (gercek.length === 0) return;
    if (Date.now() - sonEtkilesim.current > ETKILESIM_PENCERESI_MS) return;
    gonder({ t: "izinIstegi", k: kimlikUret(), elemanlar: gercek as unknown as TahtaEleman[] });
    setDurum(t("tahta.izin.istendi"));
  }, [defter, degisenleriGonder, gonder, gorunuruYaz, o, rol, t]);
  istegiGonderRef.current = istegiGonder;

  /* Hareket (parmak/fare basılı) sürerken istek bekler; kalkınca kurulur.
     Son kullanıcı etkileşiminin zamanı da burada tutulur. */
  useEffect(() => {
    const kutu = kap.current;
    if (!kutu) return;
    const etkilesim = () => {
      sonEtkilesim.current = Date.now();
    };
    const basti = () => {
      etkilesim();
      hareket.current = true;
    };
    const birakti = () => {
      if (!hareket.current) return;
      etkilesim();
      hareket.current = false;
      if (bekleyen.current.size > 0) istekZamanla();
    };
    kutu.addEventListener("pointerdown", basti, true);
    window.addEventListener("pointerup", birakti, true);
    window.addEventListener("pointercancel", birakti, true);
    // Excalidraw kısayolları/yapıştırma belge düzeyinde dinler; onay
    // pencereleri (ör. "Tuvali sıfırla") gövdeye çizilir.
    document.addEventListener("pointerdown", etkilesim, true);
    document.addEventListener("keydown", etkilesim, true);
    document.addEventListener("paste", etkilesim, true);
    document.addEventListener("drop", etkilesim, true);
    return () => {
      document.removeEventListener("pointerdown", etkilesim, true);
      document.removeEventListener("keydown", etkilesim, true);
      document.removeEventListener("paste", etkilesim, true);
      document.removeEventListener("drop", etkilesim, true);
      kutu.removeEventListener("pointerdown", basti, true);
      window.removeEventListener("pointerup", birakti, true);
      window.removeEventListener("pointercancel", birakti, true);
    };
  }, [istekZamanla]);

  /* Ctrl/Cmd+P: Excalidraw yazdırmayı engelleyip olmayan komut paletini
     öneren bir bildirim gösterir (npm paketi paleti çizmiyor). Odak
     tahtadayken ikisi de çıkmasın; Excalidraw'ın kapsayıcı `onKeyDown`'ından
     önce yakalanır. */
  useEffect(() => {
    const kutu = kap.current;
    if (!kutu) return;
    const tus = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    kutu.addEventListener("keydown", tus, true);
    return () => kutu.removeEventListener("keydown", tus, true);
  }, []);

  /** ÖĞRETMEN: önerilen kopyaları uygular ve yayınlar (iki tarafta geçerli). */
  const onerileriUygula = useCallback(
    (elemanlar: readonly TahtaEleman[]) => {
      const a = apiRef.current;
      if (!a) return;
      defteriDoldur(a.getSceneElementsIncludingDeleted());
      // Telden gelen öneri, `durum` gibi onarılarak uygulanır.
      const onarilmis = restoreElements(elemanlar as unknown as ExcalidrawElement[], null, {
        repairBindings: true,
      });
      const hazir = onerileriHazirla(
        onarilmis.map(izinE),
        (id) => defter.get(id) as unknown as IzinElemani | undefined,
        yerelDogan,
      );
      if (hazir.length === 0) return;
      for (const e of hazir) defter.set(e.id, excE(e));
      gorunuruYaz(a);
      durumGonder(hazir);
    },
    [defter, defteriDoldur, durumGonder, gorunuruYaz, yerelDogan],
  );

  /** ÖĞRETMEN: tam yetkiyi verir/kaldırır ve yayınlar. */
  const tamYetkiVer = useCallback(
    (tam: boolean) => {
      tamYetkiYaz(tam);
      gonder({ t: "yetki", tam });
    },
    [gonder, tamYetkiYaz],
  );

  /* ── Sayfalar ─────────────────────────────────────────────────────────── */

  /** PDF sayfasının zemin elemanını (yoksa) kurar ve yayınlar. */
  const zeminiKur = useCallback(
    async (sayfa: TahtaSayfasi) => {
      const a = apiRef.current;
      if (!a || !sayfa.pdf) return;
      const fid = pdfDosyaKimligi(sayfa.pdf.kaynak, sayfa.pdf.no);
      const varMi = [...defter.values()].some(
        (e) => e.type === "image" && e.fileId === fid && !e.isDeleted,
      );
      if (varMi) return;
      const belge = await pdfGetir(dersId, sayfa.pdf.kaynak);
      const goruntu = await belge.sayfayiCiz(sayfa.pdf.no);
      dosyaEkle(a, fid, goruntu.dataURL);
      let hedef = o.zeminCercevesi;
      if (!hedef) {
        const d = a.getAppState();
        const solUst = viewportCoordsToSceneCoords(
          { clientX: d.offsetLeft, clientY: d.offsetTop },
          d,
        );
        const sagAlt = viewportCoordsToSceneCoords(
          { clientX: d.offsetLeft + d.width, clientY: d.offsetTop + d.height },
          d,
        );
        const gG = sagAlt.x - solUst.x;
        const gY = sagAlt.y - solUst.y;
        hedef = {
          x: solUst.x + (gG * (1 - ZEMIN_PAYI)) / 2,
          y: solUst.y + (gY * (1 - ZEMIN_PAYI)) / 2,
          genislik: gG * ZEMIN_PAYI,
          yukseklik: gY * ZEMIN_PAYI,
        };
        o.zeminCercevesi = hedef;
      }
      const kutu = kutuyaSigdir(hedef, goruntu.genislik, goruntu.yukseklik);
      // `locked`: ZEMİN — üstüne yazarken kazayla sürüklenmesin.
      const [ham] = convertToExcalidrawElements([
        {
          type: "image",
          fileId: fid as FileId,
          x: kutu.x,
          y: kutu.y,
          width: kutu.genislik,
          height: kutu.yukseklik,
          locked: true,
        },
      ]);
      // Zemin her zaman öğretmenindir (kim açarsa açsın).
      const yeni = { ...ham, customData: { tahtaSayfa: sayfa.id, sahip: "ogretmen" } };
      // Zemin dizinin BAŞINA: kesirli z-sırası dizi sırasından türer.
      const gorunur = [...defter.values()].filter((e) =>
        gorunurMu(e as unknown as TahtaEleman, aktifSayfa()),
      );
      if (sayfa.id === aktifSayfa()) {
        a.updateScene({
          elements: [yeni, ...sahneIcin(a, gorunur)],
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        defteriDoldur(a.getSceneElementsIncludingDeleted());
      } else {
        defter.set(yeni.id, yeni as unknown as OrderedExcalidrawElement);
        yerelDogan.add(yeni.id);
      }
      const yerlesmis = defter.get(yeni.id) as unknown as TahtaEleman | undefined;
      if (!yerlesmis) return;
      durumGonder([yerlesmis], sayfaRef.current);
    },
    [defter, defteriDoldur, dersId, dosyaEkle, durumGonder, o, sahneIcin, yerelDogan],
  );

  /** Sayfa listesini değiştirir, sahneyi yeniler, yayınlar (+ zemin). */
  const sayfalariDegistir = useCallback(
    (yeni: SayfaDurumu, elemanlar: TahtaEleman[] = []) => {
      const a = apiRef.current;
      if (!a || yeni === sayfaRef.current) return;
      defteriDoldur(a.getSceneElementsIncludingDeleted());
      setSayfalar(yeni);
      gorunuruYaz(a);
      durumGonder(elemanlar, yeni);
      const aktif = yeni.liste.find((s) => s.id === yeni.aktif);
      if (aktif?.pdf) {
        void zeminiKur(aktif).catch(() => setDurum(t("tahta.durum.sayfaAcilamadi")));
      }
    },
    [defteriDoldur, durumGonder, gorunuruYaz, setSayfalar, t, zeminiKur],
  );

  const sayfayiSil = useCallback(() => {
    const a = apiRef.current;
    if (!a) return;
    defteriDoldur(a.getSceneElementsIncludingDeleted());
    const silinen = aktifSayfa();
    const mezarlar: TahtaEleman[] = [];
    for (const e of [...defter.values()]) {
      if (e.isDeleted || elemanSayfasi(e as unknown as TahtaEleman) !== silinen) continue;
      const m = mezarTasi(e as unknown as TahtaEleman);
      defter.set(e.id, m as unknown as OrderedExcalidrawElement);
      mezarlar.push(m);
    }
    sayfalariDegistir(sayfaSil(sayfaRef.current), mezarlar);
  }, [defter, defteriDoldur, sayfalariDegistir]);

  /** Preply "temizle": aktif sayfanın çizimleri (PDF zemini kalır). */
  const temizle = useCallback(() => {
    const a = apiRef.current;
    if (!a) return;
    defteriDoldur(a.getSceneElementsIncludingDeleted());
    const mezarlar: TahtaEleman[] = [];
    for (const e of [...defter.values()]) {
      if (e.isDeleted || !gorunurMu(e as unknown as TahtaEleman, aktifSayfa())) continue;
      if (e.type === "image" && e.fileId && pdfDosyaCoz(e.fileId)) continue;
      const m = mezarTasi(e as unknown as TahtaEleman);
      defter.set(e.id, m as unknown as OrderedExcalidrawElement);
      mezarlar.push(m);
    }
    if (mezarlar.length === 0) return;
    gorunuruYaz(a);
    durumGonder(mezarlar);
  }, [defter, defteriDoldur, durumGonder, gorunuruYaz]);

  /**
   * PDF'in sayfalarını yerleştirir. "Bu sayfada aç"ta açık sayfanın eski PDF
   * zemini silinir (yenisi onun yerine kurulur).
   */
  const pdfYerlestir = useCallback(
    (kaynak: number, sayfaSayisi: number, yer: PdfYeri) => {
      const a = apiRef.current;
      if (!a) return;
      defteriDoldur(a.getSceneElementsIncludingDeleted());
      const mezarlar: TahtaEleman[] = [];
      if (yer === "bu") {
        for (const e of [...defter.values()]) {
          if (e.isDeleted || elemanSayfasi(e as unknown as TahtaEleman) !== aktifSayfa()) continue;
          if (!pdfZeminiMi(izinE(e))) continue;
          const m = mezarTasi(e as unknown as TahtaEleman);
          defter.set(e.id, excE(m));
          mezarlar.push(m);
        }
      }
      sayfalariDegistir(
        pdfSayfalariniYerlestir(sayfaRef.current, kaynak, sayfaSayisi, yer),
        mezarlar,
      );
    },
    [defter, defteriDoldur, sayfalariDegistir],
  );

  /** PDF'i ders kaynağı olarak yükler; kaynak kimliğini döner. */
  const pdfKaynagiYukle = useCallback(
    async (dosya: File): Promise<number> => {
      const ders = await uploadBookingResource(dersId, dosya);
      const kaynak = yeniKaynak(ders, dosya.name);
      if (kaynak === null) throw new Error("kaynak");
      pdfler.set(kaynak, pdfAc(dosya));
      return kaynak;
    },
    [dersId],
  );

  /**
   * "Dosya yükle" (PDF). Öğretmen ve tam yetkili öğrenci yeri kendisi seçer;
   * öğrenci (tam yetki yoksa) önce öğretmenden izin ister ve bekler.
   */
  const dosyaSecildi = useCallback(
    (dosya: File) => {
      setDurum(null);
      if (dosya.type !== "application/pdf" && !dosya.name.toLowerCase().endsWith(".pdf")) {
        setDurum(t("tahta.durum.yalnizPdf"));
        return;
      }
      if (rol === "ogretmen" || tamYetkiRef.current) {
        setPdfSecim(dosya);
        return;
      }
      const k = kimlikUret();
      setPdfBekleme({ k, dosya });
      gonder({ t: "pdfIstegi", k, dosya: dosya.name });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gonder, rol, t],
  );

  /** Yer seçildi (kendi açışımız): yükle ve yerleştir. */
  const pdfAcKendi = useCallback(
    async (dosya: File, yer: PdfYeri) => {
      setMesgul(t("tahta.durum.yukleniyor"));
      try {
        const kaynak = await pdfKaynagiYukle(dosya);
        const { sayfaSayisi } = await pdfGetir(dersId, kaynak);
        pdfYerlestir(kaynak, sayfaSayisi, yer);
      } catch {
        setDurum(t("tahta.durum.yuklemeHatasi"));
      } finally {
        setMesgul(null);
      }
    },
    [dersId, pdfKaynagiYukle, pdfYerlestir, t],
  );

  /** ÖĞRENCİ: öğretmen PDF'e izin verdi — yükle, öğretmene kaynağı bildir. */
  const pdfOnaylandi = useCallback(
    async (k: string, dosya: File) => {
      setMesgul(t("tahta.durum.yukleniyor"));
      try {
        const kaynak = await pdfKaynagiYukle(dosya);
        gonder({ t: "pdfEkle", k, kaynak });
      } catch {
        setDurum(t("tahta.durum.yuklemeHatasi"));
      } finally {
        setMesgul(null);
      }
    },
    [gonder, pdfKaynagiYukle, t],
  );

  /* ── Dışa aktarım ─────────────────────────────────────────────────────── */

  const sayfaElemanlari = useCallback(
    (sayfa: string) =>
      [...defter.values()].filter(
        (e) => !e.isDeleted && gorunurMu(e as unknown as TahtaEleman, sayfa),
      ),
    [defter],
  );

  const resimKaydet = useCallback(async () => {
    const a = apiRef.current;
    if (!a) return;
    defteriDoldur(a.getSceneElementsIncludingDeleted());
    const elemanlar = sayfaElemanlari(aktifSayfa());
    if (elemanlar.length === 0) {
      setDurum(t("tahta.durum.bos"));
      return;
    }
    try {
      const blob = await exportToBlob({
        elements: elemanlar as never,
        files: a.getFiles(),
        appState: { exportBackground: true, viewBackgroundColor: "#ffffff" },
        exportPadding: 16,
        mimeType: "image/png",
      });
      indir(blob, `tahta-${damga()}.png`);
    } catch {
      setDurum(t("tahta.durum.disaAktarilamadi"));
    }
  }, [defteriDoldur, sayfaElemanlari, t]);

  /**
   * Tahtayı PDF olarak indirir: her sayfa Excalidraw'ın kendi
   * `exportToCanvas`'ıyla çizilir, jsPDF (tıklamada tembel yüklenir) yalnız
   * tuvalleri sayfa sırasıyla tek dosyada birleştirir. Tamamen istemci tarafı.
   */
  const pdfKaydet = useCallback(async () => {
    const a = apiRef.current;
    if (!a) return;
    setMesgul(t("tahta.durum.hazirlaniyor"));
    setDurum(null);
    try {
      defteriDoldur(a.getSceneElementsIncludingDeleted());
      const { jsPDF } = await import("jspdf");
      let belge: InstanceType<typeof jsPDF> | null = null;
      for (const sayfa of sayfaRef.current.liste) {
        const elemanlar = sayfaElemanlari(sayfa.id);
        if (elemanlar.length === 0) continue;
        const tuval = await exportToCanvas({
          elements: elemanlar as never,
          files: a.getFiles(),
          appState: { exportBackground: true, viewBackgroundColor: "#ffffff" },
          exportPadding: 16,
        });
        const yon = tuval.width >= tuval.height ? "landscape" : "portrait";
        if (!belge) {
          belge = new jsPDF({ unit: "px", format: [tuval.width, tuval.height], orientation: yon });
        } else {
          belge.addPage([tuval.width, tuval.height], yon);
        }
        belge.addImage(tuval.toDataURL("image/png"), "PNG", 0, 0, tuval.width, tuval.height);
      }
      if (!belge) {
        setDurum(t("tahta.durum.bos"));
        return;
      }
      belge.save(`tahta-${damga()}.pdf`);
    } catch {
      setDurum(t("tahta.durum.disaAktarilamadi"));
    } finally {
      setMesgul(null);
    }
  }, [defteriDoldur, sayfaElemanlari, t]);

  /* ── İmleç ────────────────────────────────────────────────────────────── */

  const imleciYolla = useCallback(() => {
    imlecZamani.current = null;
    const m = bekleyenImlec.current;
    if (!m) return;
    bekleyenImlec.current = null;
    sonImlec.current = Date.now();
    gonder(m);
  }, [gonder]);

  /** Her hareket, en çok 10/sn; son konum sonradan da gider (kuyruk yayını). */
  const imlecGuncelle = useCallback(
    ({
      pointer,
      button,
    }: {
      pointer: { x: number; y: number; tool: "pointer" | "laser" };
      button: "up" | "down";
    }) => {
      bekleyenImlec.current = {
        t: "imlec",
        x: pointer.x,
        y: pointer.y,
        dugme: button,
        arac: pointer.tool === "laser" ? "laser" : "pointer",
      };
      const kalan = IMLEC_ARALIGI_MS - (Date.now() - sonImlec.current);
      if (kalan <= 0) {
        if (imlecZamani.current !== null) window.clearTimeout(imlecZamani.current);
        imleciYolla();
      } else if (imlecZamani.current === null) {
        imlecZamani.current = window.setTimeout(imleciYolla, kalan);
      }
    },
    [imleciYolla],
  );

  /**
   * Karşı tarafın kaydını (avatar + imleç) oluşturur/tazeler. Kayıt karşı
   * taraf derste kaldıkça durur; `imlec: "gizle"` yalnız imleci kaldırır
   * (avatar kalır — giderse Excalidraw öğretmenin takibini bitirir). Kimlik
   * roldür: aynı rolden yeni istemci (yeniden bağlanma) eskisinin yerini alır.
   * Sahne yalnız kayıt gerçekten değişince güncellenir.
   */
  const karsiyiKaydet = useCallback(
    (g: Gonderen, imlec?: Pick<Collaborator, "pointer" | "button"> | "gizle") => {
      const a = apiRef.current;
      if (!a || !g.istemci) return;
      const soket = g.istemci as SocketId;
      // Gizleme kayıt DOĞURMAZ: ayrılan (ya da yeniden bağlanıp yeri alınan)
      // tarafın geç kalan 30 sn sayacı avatarı geri getirmesin.
      if (imlec === "gizle" && !karsiImlecler.current.has(soket)) return;
      const kimlik = g.ogretmen ? "ogretmen" : "ogrenci";
      const harita = karsiImlecler.current;
      let degisti = false;
      for (const [k, c] of harita) {
        if (k !== soket && c.id === kimlik) {
          harita.delete(k);
          degisti = true;
        }
      }
      const eski = harita.get(soket);
      const username = karsiAdRef.current || t("tahta.karsiTaraf");
      let yeni: Collaborator =
        eski && eski.username === username
          ? eski
          : { ...eski, id: kimlik, socketId: soket, username };
      if (imlec === "gizle") {
        if (yeni.pointer) yeni = { ...yeni, pointer: undefined, button: undefined };
      } else if (imlec) {
        yeni = { ...yeni, ...imlec };
      }
      if (yeni !== eski) {
        harita.set(soket, yeni);
        degisti = true;
      }
      if (degisti) a.updateScene({ collaborators: new Map(harita) });
    },
    [t],
  );

  /** Karşı taraf dersten ayrıldı: kaydı (avatar + imleç) tamamen kalkar. */
  const imleciGizle = useCallback(() => {
    karsiImlecler.current.clear();
    apiRef.current?.updateScene({ collaborators: new Map() });
  }, []);

  /* Pencereden çıkınca imleç karşıda gizlenir. */
  useEffect(() => {
    const kutu = kap.current;
    if (!kutu) return;
    const cikti = () => {
      if (imlecZamani.current !== null) window.clearTimeout(imlecZamani.current);
      imlecZamani.current = null;
      bekleyenImlec.current = null;
      gonder({ t: "imlecGitti" });
    };
    kutu.addEventListener("pointerleave", cikti);
    return () => kutu.removeEventListener("pointerleave", cikti);
  }, [gonder]);

  /* Karşı taraf dersten ayrılınca kaydı ve takip bilgisi de gider. */
  useEffect(
    () =>
      kanal.varlikDinle((v) => {
        karsiVarRef.current = v.karsiVar;
        setKarsiVarDurumu(v.karsiVar);
        if (v.karsiVar) return;
        imleciGizle();
        setOgrenciTakip(null);
        izleniyor.current = false;
      }),
    [imleciGizle, kanal, setOgrenciTakip],
  );

  /* ── Alım ─────────────────────────────────────────────────────────────── */

  const uygula = useCallback(
    (m: TahtaMesaji, g: Gonderen) => {
      const a = apiRef.current;
      if (!a) return;
      if (m.t === "imlec") {
        karsiyiKaydet(g, { pointer: { x: m.x, y: m.y, tool: m.arac }, button: m.dugme });
        if (imlecSusma.current !== null) window.clearTimeout(imlecSusma.current);
        imlecSusma.current = window.setTimeout(() => karsiyiKaydet(g, "gizle"), IMLEC_SUSMA_MS);
        return;
      }
      // Karşıdan gelen her mesaj kaydı oluşturur/tazeler (avatar görünür kalır).
      karsiyiKaydet(g, m.t === "imlecGitti" ? "gizle" : undefined);
      if (m.t === "imlecGitti") return;
      if (m.t === "istek") {
        tamSahneyiGonder();
        if (rol === "ogretmen") {
          gorunumGonder(true);
        } else {
          // Öğretmen tahtayı yeniden açtı: izlemesi (Excalidraw takibi) bitti.
          if (g.ogretmen) izleniyor.current = false;
          gonder({ t: "takip", acik: takipRef.current });
        }
        return;
      }

      /* Takip: `gorunum` öğretmenden yalnız öğrencide, öğrenciden yalnız onu
         izleyen öğretmende uygulanır; `takip` yalnız öğrenciden; `getir`,
         `izle` yalnız öğretmenden. */
      if (m.t === "gorunum") {
        const alan: Alan = { x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2 };
        if (g.ogretmen && rol === "ogrenci") {
          sonAlan.current = alan;
          if (takipRef.current) alaniUygula(alan);
        } else if (
          !g.ogretmen &&
          rol === "ogretmen" &&
          a.getAppState().userToFollow?.socketId === g.istemci
        ) {
          sonAlan.current = alan;
          alaniUygula(alan);
        }
        return;
      }
      if (m.t === "takip") {
        if (g.ogretmen || rol !== "ogretmen") return;
        setOgrenciTakip(m.acik);
        if (m.acik) gorunumGonder(true);
        return;
      }
      if (m.t === "getir" || m.t === "izle") {
        if (!g.ogretmen || rol === "ogretmen") return;
        if (m.t === "getir") {
          ogretmeneDon();
          return;
        }
        izleniyor.current = m.acik;
        if (m.acik) gorunumGonder(true);
        return;
      }

      /* İzin mesajları: yetki ve yanıt YALNIZ öğretmenden; istekler YALNIZ öğrenciden. */
      if (m.t === "yetki") {
        if (!g.ogretmen || rol === "ogretmen" || m.tam === tamYetkiRef.current) return;
        tamYetkiYaz(m.tam);
        setDurum(t(m.tam ? "tahta.izin.tamYetkiVerildi" : "tahta.izin.tamYetkiKaldirildi"));
        if (m.tam && bekleyen.current.size > 0) istegiGonderRef.current();
        return;
      }
      if (m.t === "izinYaniti") {
        if (!g.ogretmen || rol === "ogretmen") return;
        const bekleme = pdfBeklemeRef.current;
        if (bekleme && bekleme.k === m.k) {
          setPdfBekleme(null);
          if (m.karar === "yeni" || m.karar === "bu") void pdfOnaylandi(m.k, bekleme.dosya);
          else setDurum(t("tahta.izin.pdfReddedildi"));
          return;
        }
        if (m.karar === "ret") setDurum(t("tahta.izin.reddedildi"));
        return;
      }
      if (m.t === "izinIstegi" || m.t === "pdfIstegi" || m.t === "pdfEkle") {
        if (g.ogretmen || rol !== "ogretmen") return;
        if (m.t === "pdfEkle") {
          const yer = onayliPdf.current.get(m.k);
          if (!yer) return;
          onayliPdf.current.delete(m.k);
          void pdfGetir(dersId, m.kaynak)
            .then((b) => pdfYerlestir(m.kaynak, b.sayfaSayisi, yer))
            .catch(() => setDurum(t("tahta.durum.sayfaAcilamadi")));
          return;
        }
        if (m.t === "izinIstegi") {
          if (tamYetkiRef.current) {
            onerileriUygula(m.elemanlar);
            gonder({ t: "izinYaniti", k: m.k, karar: "onay" });
            return;
          }
          oneriler.current.set(m.k, m.elemanlar);
          setIstekler((l) => [...l, { k: m.k, tur: "degisiklik", sayi: m.elemanlar.length }]);
          return;
        }
        setIstekler((l) => [...l, { k: m.k, tur: "pdf", dosya: m.dosya }]);
        return;
      }

      // Sayfa listesi: öğretmenden her zaman (sürümle); tam yetkili
      // öğrenciden de; öğrenciden aksi hâlde yalnız yerelimiz hiç
      // değişmemişse (öğretmen sayfayı yenilediyse geri alır).
      const sayfaKabul =
        g.ogretmen || (rol === "ogretmen" && tamYetkiRef.current) || sayfaRef.current.surum === 0;
      if (m.sayfalar && sayfaKabul) {
        const birlesik = sayfalariBirlestir(sayfaRef.current, m.sayfalar);
        if (birlesik !== sayfaRef.current) {
          defteriDoldur(a.getSceneElementsIncludingDeleted());
          setSayfalar(birlesik);
        }
      }
      let geriYayin: TahtaEleman[] = [];
      if (m.elemanlar.length > 0) {
        let uzak = restoreElements(m.elemanlar as unknown as ExcalidrawElement[], null, {
          repairBindings: true,
        }) as unknown as readonly RemoteExcalidrawElement[];
        defteriDoldur(a.getSceneElementsIncludingDeleted());
        // Öğretmen denetimi: yetkisiz öğrenci güncellemesi uygulanmaz.
        if (rol === "ogretmen" && !g.ogretmen && !tamYetkiRef.current) {
          const denetim = ogretmenDenetimi(
            uzak as unknown as IzinElemani[],
            (id) => defter.get(id) as unknown as IzinElemani | undefined,
            yerelDogan,
          );
          surumleriYaz(uzak as unknown as TahtaEleman[], bilinen.current);
          uzak = denetim.kabul as unknown as readonly RemoteExcalidrawElement[];
          geriYayin = denetim.geriYayin as unknown as TahtaEleman[];
        } else {
          surumleriYaz(uzak as unknown as TahtaEleman[], bilinen.current);
        }
        const birlesik = reconcileElements([...defter.values()], uzak, a.getAppState());
        defter.clear();
        defteriDoldur(birlesik, false);
        for (const e of geriYayin) defter.set(e.id, excE(e));
      }
      gorunuruYaz(a);
      if (geriYayin.length > 0) durumGonder(geriYayin);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      alaniUygula,
      defter,
      defteriDoldur,
      dersId,
      durumGonder,
      gonder,
      gorunumGonder,
      gorunuruYaz,
      karsiyiKaydet,
      ogretmeneDon,
      onerileriUygula,
      pdfOnaylandi,
      pdfYerlestir,
      rol,
      setOgrenciTakip,
      setSayfalar,
      t,
      tamSahneyiGonder,
      tamYetkiYaz,
      yerelDogan,
    ],
  );

  useEffect(() => kanal.dinle(uygula), [kanal, uygula]);

  /* Durum iletisi bir süre sonra kendiliğinden kalkar. */
  useEffect(() => {
    if (!durum) return;
    const z = window.setTimeout(() => setDurum(null), 6000);
    return () => window.clearTimeout(z);
  }, [durum]);

  /* Açılışta ve her yeniden abonelikte sahneyi iste; periyodik tam senkron. */
  useEffect(() => {
    if (!api) return;
    // Önbellekteki sahne ve PDF zeminleri geri konur.
    if (o.dosyalar.size > 0) api.addFiles([...o.dosyalar.values()]);
    gorunuruYaz(api);
    // Öğrenci isteğin yanında takip durumunu da bildirir (öğretmendeki bayat
    // "takip ediyor/etmiyor" bilgisi tazelenir).
    const iste = () => {
      gonder({ t: "istek" });
      if (rol === "ogrenci") gonder({ t: "takip", acik: takipRef.current });
    };
    iste();
    const coz = kanal.aboneOlununca(iste);
    const sayac = window.setInterval(tamSahneyiGonder, TAM_SENKRON_MS);
    return () => {
      coz();
      window.clearInterval(sayac);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  /* Takip: kaydırma kimin (bizim mi kullanıcının mı), Excalidraw avatar
     takibi ve kullanıcının görünüm girdileri. */
  useEffect(() => {
    if (!api) return;
    const kaydirma = api.onScrollChange((scrollX, scrollY, zoom) => {
      const gercek = { scrollX, scrollY, zoom: zoom.value };
      const beklenen = beklenenGorunum.current;
      if (beklenen && ayniGorunum(beklenen, gercek)) return; // bizim uyguladığımız
      const takipte =
        rol === "ogretmen" ? api.getAppState().userToFollow !== null : takipRef.current;
      if (takipKoptuMu(beklenen, gercek, sonGorunumGirdisi.current, Date.now())) {
        // Kullanıcı kendisi kaydırdı/yakınlaştırdı.
        beklenenGorunum.current = null;
        if (!takipte) return;
        if (rol === "ogrenci") takibiBirak();
        else api.updateScene({ appState: { userToFollow: null } });
        return;
      }
      // Girdisiz fark (Excalidraw'ın kendi düzeltmesi): takipteyse geri sığdır.
      if (takipte && sonAlan.current) alaniUygula(sonAlan.current);
    });
    const takipOlayi = api.onUserFollow(({ action }) => {
      if (rol === "ogrenci") {
        // Öğrenci avatara tıklayıp öğretmeni "takip ederse" bizim takibe döner;
        // Excalidraw'ın takibi (tuvale dokununca biten) kullanılmaz.
        if (action !== "FOLLOW") return;
        api.updateScene({ appState: { userToFollow: null } });
        ogretmeneDon();
        return;
      }
      sonAlan.current = null;
      bekleyenGorunum.current = null;
      gonder({ t: "izle", acik: action === "FOLLOW" });
    });
    return () => {
      kaydirma();
      takipOlayi();
    };
  }, [alaniUygula, api, gonder, ogretmeneDon, rol, takibiBirak]);

  useEffect(() => {
    const kutu = kap.current;
    if (!kutu) return;
    // Ayrı zaman damgası: `sonEtkilesim`e tekerlek eklenirse izin isteğini kapılır.
    const girdi = () => {
      sonGorunumGirdisi.current = Date.now();
    };
    const birakti = () => {
      const alan = bekleyenGorunum.current;
      if (!alan) return;
      bekleyenGorunum.current = null;
      alaniYaz(alan);
    };
    kutu.addEventListener("wheel", girdi, { capture: true, passive: true });
    kutu.addEventListener("pointerdown", girdi, true);
    // Klavye yakınlaştırması (Ctrl +/-) odak gövdedeyken de gelir.
    document.addEventListener("keydown", girdi, true);
    window.addEventListener("pointerup", birakti, true);
    window.addEventListener("pointercancel", birakti, true);
    return () => {
      kutu.removeEventListener("wheel", girdi, { capture: true });
      kutu.removeEventListener("pointerdown", girdi, true);
      document.removeEventListener("keydown", girdi, true);
      window.removeEventListener("pointerup", birakti, true);
      window.removeEventListener("pointercancel", birakti, true);
    };
  }, [alaniYaz]);

  useEffect(
    () => () => {
      for (const z of [yayinZamani, imlecZamani, imlecSusma, istekZamani, gorunumZamani]) {
        if (z.current !== null) window.clearTimeout(z.current);
      }
    },
    [],
  );

  /* ── Öğretmen: istek yanıtları ────────────────────────────────────────── */

  const siradakiIstek = istekler[0] ?? null;
  const istegiKapat = (k: string) => setIstekler((l) => l.filter((i) => i.k !== k));

  const degisiklikYaniti = (karar: "onay" | "ret" | "tam") => {
    if (!siradakiIstek || siradakiIstek.tur !== "degisiklik") return;
    const k = siradakiIstek.k;
    const elemanlar = oneriler.current.get(k) ?? [];
    oneriler.current.delete(k);
    istegiKapat(k);
    if (karar === "ret") {
      gonder({ t: "izinYaniti", k, karar: "ret" });
      return;
    }
    onerileriUygula(elemanlar);
    gonder({ t: "izinYaniti", k, karar: "onay" });
    if (karar === "tam") {
      tamYetkiVer(true);
      // Sırada bekleyen öteki değişiklik istekleri de artık sorulmadan uygulanır.
      const kalan = istekler.filter((i) => i.k !== k && i.tur === "degisiklik");
      for (const i of kalan) {
        onerileriUygula(oneriler.current.get(i.k) ?? []);
        oneriler.current.delete(i.k);
        gonder({ t: "izinYaniti", k: i.k, karar: "onay" });
      }
      setIstekler((l) => l.filter((i) => i.tur !== "degisiklik"));
    }
  };

  const pdfYaniti = (karar: PdfYeri | "ret", tam: boolean) => {
    if (!siradakiIstek || siradakiIstek.tur !== "pdf") return;
    const k = siradakiIstek.k;
    istegiKapat(k);
    if (karar !== "ret") onayliPdf.current.set(k, karar);
    gonder({ t: "izinYaniti", k, karar });
    if (karar !== "ret" && tam) tamYetkiVer(true);
  };

  /* ── Araç seçimi (Preply yüzeyi) ──────────────────────────────────────── */

  const aracSec = (tur: string) => {
    apiRef.current?.setActiveTool({ type: tur as never });
    setAktifArac(tur);
  };
  const stilAyarla = (d: Partial<AppState>) =>
    apiRef.current?.updateScene({
      appState: d as never,
      captureUpdate: CaptureUpdateAction.NEVER,
    });

  /* ── Takip arayüzü ────────────────────────────────────────────────────── */

  /** ÖĞRETMEN, masaüstü: kullanıcı listesinin yanında takip durumu / getir. */
  const ustSagArayuz = useCallback(
    (isMobile: boolean) => {
      if (!ogretmen || isMobile || ogrenciTakip === null) return null;
      return ogrenciTakip ? (
        <span
          role="status"
          className="inline-flex h-9 items-center rounded-full bg-slate-100 px-3 text-xs font-medium text-slate-700"
        >
          {t("tahta.takip.takipte")}
        </span>
      ) : (
        <PlainButton
          onClick={ogrenciyiGetir}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marka-focus"
        >
          <Icon name="location" className="h-4 w-4" />
          {t("tahta.takip.getir")}
        </PlainButton>
      );
    },
    [ogrenciTakip, ogrenciyiGetir, ogretmen, t],
  );
  const takipSeridi = !ogretmen && !takip && karsiVar;
  /** Telefon: sayfa denetimi satırında takip düğmeleri. */
  const mobilTakip = ogretmen ? (
    ogrenciTakip === true ? (
      <span
        role="status"
        aria-label={t("tahta.takip.takipte")}
        title={t("tahta.takip.takipte")}
        className={`${KUTU} pointer-events-auto px-1.5 text-slate-700`}
      >
        <Icon name="people" className="h-[18px] w-[18px]" />
      </span>
    ) : ogrenciTakip === false ? (
      <div className={`${KUTU} pointer-events-auto`}>
        <KucukDugme etiket={t("tahta.takip.getir")} ikon="location" onClick={ogrenciyiGetir} />
      </div>
    ) : null
  ) : takipSeridi ? (
    <PlainButton
      onClick={ogretmeneDon}
      aria-label={`${t("tahta.takip.serbest")}. ${t("tahta.takip.don")}`}
      className="pointer-events-auto h-[34px] rounded-lg bg-slate-900/85 px-3 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-marka-focus"
    >
      {t("tahta.takip.don")}
    </PlainButton>
  ) : null;

  const sayfaNo = sayfalar.liste.findIndex((s) => s.id === sayfalar.aktif) + 1;
  const toplam = sayfalar.liste.length;
  const sayfaYetkisi = ogretmen || tamYetki;

  const sayfaDenetimi = (
    <div className={KUTU} role="group" aria-label={t("tahta.sayfa.denetim")}>
      {sayfaYetkisi && (
        <KucukDugme
          etiket={t("tahta.sayfa.onceki")}
          ikon="chevronLeft"
          disabled={sayfaNo <= 1}
          onClick={() => sayfalariDegistir(sayfaGec(sayfaRef.current, -1))}
        />
      )}
      <span className="min-w-[2.5rem] px-1 text-center text-sm tabular-nums text-slate-700">
        {t("tahta.sayfa.konum", { no: sayfaNo, toplam })}
      </span>
      {sayfaYetkisi && (
        <>
          <KucukDugme
            etiket={t("tahta.sayfa.sonraki")}
            ikon="chevronRight"
            disabled={sayfaNo >= toplam}
            onClick={() => sayfalariDegistir(sayfaGec(sayfaRef.current, 1))}
          />
          <KucukDugme
            etiket={t("tahta.sayfa.ekle")}
            ikon="slideAdd"
            onClick={() =>
              sayfalariDegistir(
                sayfaEkle(sayfaRef.current, [
                  { id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` },
                ]),
              )
            }
          />
          <KucukDugme
            etiket={t("tahta.sayfa.sil")}
            ikon="delete"
            disabled={toplam <= 1}
            onClick={() => setSilOnay(true)}
          />
        </>
      )}
    </div>
  );

  return (
    <div
      ref={kap}
      className={`ders-tahta relative h-full w-full bg-white ${EXCALIDRAW_TAM ? "ders-tahta--tam" : ""}`}
      style={{ "--takip-etiketi": JSON.stringify(t("tahta.takip.rozet")) } as CSSProperties}
    >
      <Excalidraw
        excalidrawAPI={setApi}
        onChange={degisimeTepki}
        onPointerUpdate={imlecGuncelle}
        renderTopRightUI={ustSagArayuz}
        isCollaborating
        langCode="tr-TR"
        UIOptions={
          EXCALIDRAW_TAM
            ? undefined
            : {
                canvasActions: {
                  changeViewBackgroundColor: false,
                  clearCanvas: false,
                  export: false,
                  loadScene: false,
                  saveToActiveFile: false,
                  saveAsImage: false,
                  toggleTheme: null,
                },
                tools: { image: false },
              }
        }
        initialData={{
          appState: {
            viewBackgroundColor: "#ffffff",
            activeTool: {
              type: "freedraw",
              customType: null,
              locked: false,
              lastActiveTool: null,
            },
          },
        }}
      >
        {/* ☰ menü LiveKit tahtasındaki gibi ELLE kurulur — Excalidraw'ın
            kendi öğeleri varsayılan sırasıyla, `Socials` hariç; PDF indirme
            ve PDF yükleme eklenir. "Aç" ve "Tuvali sıfırla" öğrencide de
            var: öğretmenin çizimine dokunan kısmı izin kuralına tabidir. */}
        {EXCALIDRAW_TAM && (
          <MainMenu>
            <MainMenu.DefaultItems.LoadScene />
            <MainMenu.DefaultItems.SaveToActiveFile />
            <MainMenu.DefaultItems.Export />
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.Item
              icon={<Icon name="arrowDownload" className="h-4 w-4" />}
              onSelect={() => void pdfKaydet()}
            >
              {t("tahta.uygulama.pdfKaydet")}
            </MainMenu.Item>
            <MainMenu.Item
              icon={<Icon name="arrowUpload" className="h-4 w-4" />}
              onSelect={() => pdfGirdisi.current?.click()}
            >
              {t("tahta.uygulama.dosyaYukle")}
            </MainMenu.Item>
            <MainMenu.Separator />
            <MainMenu.DefaultItems.SearchMenu />
            <MainMenu.DefaultItems.Help />
            <MainMenu.DefaultItems.ClearCanvas />
            {ogretmen && tamYetki && (
              <MainMenu.Item
                icon={<Icon name="people" className="h-4 w-4" />}
                onSelect={() => tamYetkiVer(false)}
              >
                {t("tahta.izin.tamYetkiKaldir")}
              </MainMenu.Item>
            )}
            <MainMenu.Separator />
            <MainMenu.DefaultItems.ToggleTheme />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
          </MainMenu>
        )}
        {EXCALIDRAW_TAM && <CihazBildir onMobil={setMobil} />}
        {/* Masaüstü: Excalidraw'ın alt çubuğunda, yardım düğmesinin solunda. */}
        {EXCALIDRAW_TAM && !mobil && <Footer>{sayfaDenetimi}</Footer>}
      </Excalidraw>
      {EXCALIDRAW_TAM && (
        <input
          ref={pdfGirdisi}
          type="file"
          accept="application/pdf"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const secilen = e.target.files?.[0];
            e.target.value = "";
            if (secilen) dosyaSecildi(secilen);
          }}
        />
      )}

      {!EXCALIDRAW_TAM && (
        <>
          <AracCubugu
            ogretmen={ogretmen}
            aktif={aktifArac}
            sekil={sekil}
            onArac={aracSec}
            onSekil={(s) => {
              setSekil(s);
              aracSec(s);
            }}
            onStil={stilAyarla}
            onTemizle={temizle}
            onDosya={dosyaSecildi}
            onResim={() => void resimKaydet()}
            onPdf={() => void pdfKaydet()}
          />
          {/* Alt sol: geri al / yinele + yakınlaştırma (Preply 62×34 + 131×34). */}
          <div className="absolute bottom-4 left-4 z-10 flex gap-2">
            <div className={KUTU}>
              <KucukDugme etiket={t("tahta.geriAl")} ikon="arrowUndo" onClick={() => kisayol(kap.current, "z", "KeyZ")} />
              <KucukDugme etiket={t("tahta.yinele")} ikon="arrowRedo" onClick={() => kisayol(kap.current, "z", "KeyZ", true)} />
            </div>
            <div className={KUTU}>
              <KucukDugme etiket={t("tahta.yakinlastir")} ikon="add" onClick={() => kisayol(kap.current, "=", "Equal")} />
              <span className="min-w-[3rem] text-center text-sm tabular-nums text-slate-700">
                {Math.round(yakinlik * 100)}%
              </span>
              <KucukDugme etiket={t("tahta.uzaklastir")} ikon="subtract" onClick={() => kisayol(kap.current, "-", "Minus")} />
              <KucukDugme etiket={t("tahta.ortala")} ikon="target" onClick={() => apiRef.current?.scrollToContent()} />
            </div>
          </div>
          {/* Alt sağ: sayfa denetimi (Preply 145×34). */}
          <div className="absolute bottom-4 right-4 z-10">{sayfaDenetimi}</div>
        </>
      )}
      {/* Telefon düzeni: denetim sağda, Excalidraw'ın kilit/el sütununun altında
          (üst araç çubuğunu, sağ sütunu ve alt çubuğu örtmez; tahta.css). */}
      {EXCALIDRAW_TAM && mobil && (
        <div className="tahta-sayfa-mobil pointer-events-none absolute left-3 right-3 z-10 flex items-center justify-end gap-2">
          {mobilTakip}
          <div className="pointer-events-auto">{sayfaDenetimi}</div>
        </div>
      )}

      {/* Bildirim yığını (üst orta): takip şeridi, durum, PDF onay bekleme. */}
      <div
        className={`pointer-events-none absolute left-1/2 z-20 flex w-max max-w-[90%] -translate-x-1/2 flex-col items-center gap-2 ${
          EXCALIDRAW_TAM ? "top-16" : "top-3"
        }`}
      >
        {takipSeridi && !mobil && (
          <div
            role="status"
            className="pointer-events-auto flex items-center gap-3 rounded bg-slate-900/85 px-3 py-1.5 text-sm text-white"
          >
            <span>{t("tahta.takip.serbest")}</span>
            <PlainButton
              onClick={ogretmeneDon}
              className="rounded px-2 py-0.5 font-semibold underline hover:bg-white/10"
            >
              {t("tahta.takip.don")}
            </PlainButton>
          </div>
        )}
        {(mesgul || durum) && (
          <p
            role="status"
            className="pointer-events-auto rounded bg-slate-900/85 px-3 py-1.5 text-sm text-white"
          >
            {mesgul ?? durum}
          </p>
        )}
        {pdfBekleme && !mesgul && (
          <div
            role="status"
            className="pointer-events-auto flex items-center gap-3 rounded bg-slate-900/85 px-3 py-1.5 text-sm text-white"
          >
            <span>{t("tahta.izin.onayBekleniyor")}</span>
            <PlainButton
              onClick={() => setPdfBekleme(null)}
              className="rounded px-2 py-0.5 font-semibold underline hover:bg-white/10"
            >
              {t("tahta.izin.vazgec")}
            </PlainButton>
          </div>
        )}
      </div>

      <PdfYeriPenceresi
        dosya={pdfSecim?.name ?? null}
        onVazgec={() => setPdfSecim(null)}
        onSec={(yer) => {
          const dosya = pdfSecim;
          setPdfSecim(null);
          if (dosya) void pdfAcKendi(dosya, yer);
        }}
      />
      {ogretmen && (
        <IzinIstegiPenceresi
          istek={siradakiIstek}
          ad={karsiAd || t("tahta.izin.ogrenci")}
          onDegisiklik={degisiklikYaniti}
          onPdf={pdfYaniti}
        />
      )}

      <Modal
        open={silOnay}
        onClose={() => setSilOnay(false)}
        title={t("tahta.sayfa.silOnay.baslik")}
        description={t("tahta.sayfa.silOnay.metin")}
      >
        <div className="mt-4 flex justify-end gap-2">
          <PlainButton
            onClick={() => setSilOnay(false)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {t("tahta.sayfa.silOnay.iptal")}
          </PlainButton>
          <PlainButton
            onClick={() => {
              setSilOnay(false);
              sayfayiSil();
            }}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            {t("tahta.sayfa.silOnay.onay")}
          </PlainButton>
        </div>
      </Modal>
    </div>
  );
}

const KUTU =
  "flex h-[34px] items-center gap-0.5 rounded-lg border border-slate-200 bg-white px-1 shadow-sm";

function KucukDugme({
  etiket,
  ikon,
  onClick,
  disabled,
}: {
  etiket: string;
  ikon: IconName;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <PlainButton
      onClick={onClick}
      disabled={disabled}
      aria-label={etiket}
      title={etiket}
      className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-700 hover:bg-slate-100 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marka-focus"
    >
      <Icon name={ikon} className="h-[18px] w-[18px]" />
    </PlainButton>
  );
}

/* ── Sol dikey araç çubuğu (Preply `.fastboard-toolbar`) ─────────────────── */

type AltMenu = "kalem" | "metin" | "sekil" | "uygulamalar" | null;

/**
 * Deneme (25 Eyl 2026, kullanıcı isteği): Excalidraw'ın KENDİ araç çubuğu ve
 * özellikler paneli (renk, kalınlık, ok/çizgi, dolgu…) açık; Preply tarzı
 * sol çubuk gizli, ☰ menü LiveKit tahtasındaki gibi Excalidraw'ın kendi
 * öğeleriyle (+ PDF yükle/indir). Beğenilmezse
 * `false` yapmak Preply'daki kısıtlı araç setine döner.
 */
const EXCALIDRAW_TAM = true;

function AracCubugu({
  ogretmen,
  aktif,
  sekil,
  onArac,
  onSekil,
  onStil,
  onTemizle,
  onDosya,
  onResim,
  onPdf,
}: {
  ogretmen: boolean;
  aktif: string;
  sekil: SekilTuru;
  onArac: (tur: string) => void;
  onSekil: (s: SekilTuru) => void;
  onStil: (d: Partial<AppState>) => void;
  onTemizle: () => void;
  onDosya: (f: File) => void;
  onResim: () => void;
  onPdf: () => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<AltMenu>(null);
  const dosyaGirdisi = useRef<HTMLInputElement>(null);
  const kutu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const disari = (e: PointerEvent) => {
      if (!kutu.current?.contains(e.target as Node)) setMenu(null);
    };
    const tus = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("pointerdown", disari, true);
    document.addEventListener("keydown", tus);
    return () => {
      document.removeEventListener("pointerdown", disari, true);
      document.removeEventListener("keydown", tus);
    };
  }, [menu]);

  const sekilAktif = (Object.keys(SEKIL_IKONU) as SekilTuru[]).includes(aktif as SekilTuru);
  const dugme = (
    tur: AracTuru | "temizle" | "uygulamalar",
    ikon: IconName,
    etiket: string,
    secili: boolean,
    onClick: () => void,
    altMenuVar = false,
  ) => (
    <PlainButton
      key={tur}
      onClick={onClick}
      aria-label={etiket}
      title={etiket}
      aria-pressed={tur === "temizle" || tur === "uygulamalar" ? undefined : secili}
      aria-haspopup={altMenuVar ? "menu" : undefined}
      className={`relative inline-flex h-8 w-8 items-center justify-center rounded hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marka-focus ${
        secili ? "text-blue-600" : "text-slate-700"
      }`}
    >
      <Icon name={ikon} className="h-5 w-5" />
      {altMenuVar && (
        <span
          aria-hidden
          className="absolute bottom-0.5 right-0.5 h-0 w-0 border-b-[4px] border-l-[4px] border-b-current border-l-transparent opacity-70"
        />
      )}
    </PlainButton>
  );
  const altMenuAc = (m: Exclude<AltMenu, null>) => setMenu((x) => (x === m ? null : m));

  return (
    <div
      ref={kutu}
      role="toolbar"
      aria-orientation="vertical"
      aria-label={t("tahta.araclar.cubuk")}
      className="absolute left-4 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-1 rounded-lg border border-slate-200 bg-white p-[5px] shadow-sm"
    >
      {dugme("selection", "cursor", t("tahta.araclar.secim"), aktif === "selection", () => {
        setMenu(null);
        onArac("selection");
      })}
      {dugme("laser", "wand", t("tahta.araclar.lazer"), aktif === "laser", () => {
        setMenu(null);
        onArac("laser");
      })}
      {dugme(
        "freedraw",
        "pen",
        t("tahta.araclar.kalem"),
        aktif === "freedraw",
        () => {
          onArac("freedraw");
          altMenuAc("kalem");
        },
        true,
      )}
      {dugme(
        "text",
        "textT",
        t("tahta.araclar.metin"),
        aktif === "text",
        () => {
          onArac("text");
          altMenuAc("metin");
        },
        true,
      )}
      {dugme(
        "sekil",
        SEKIL_IKONU[sekil],
        t("tahta.araclar.sekil"),
        sekilAktif,
        () => {
          onArac(sekil);
          altMenuAc("sekil");
        },
        true,
      )}
      {ogretmen &&
        dugme("eraser", "eraser", t("tahta.araclar.silgi"), aktif === "eraser", () => {
          setMenu(null);
          onArac("eraser");
        })}
      {ogretmen &&
        dugme("temizle", "broom", t("tahta.araclar.temizle"), false, () => {
          setMenu(null);
          onTemizle();
        })}
      {dugme("hand", "arrowMove", t("tahta.araclar.el"), aktif === "hand", () => {
        setMenu(null);
        onArac("hand");
      })}
      {ogretmen &&
        dugme(
          "uygulamalar",
          "grid",
          t("tahta.araclar.uygulamalar"),
          menu === "uygulamalar",
          () => altMenuAc("uygulamalar"),
          true,
        )}

      {menu && (
        <div
          role="menu"
          className="absolute left-full top-1/2 ml-2 w-56 -translate-y-1/2 rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-800 shadow-lg"
        >
          {menu === "sekil" && (
            <Bolum baslik={t("tahta.araclar.sekil")}>
              <div className="flex gap-1">
                {(Object.keys(SEKIL_IKONU) as SekilTuru[]).map((s) => (
                  <PlainButton
                    key={s}
                    role="menuitemradio"
                    aria-checked={sekil === s}
                    aria-label={t(`tahta.sekiller.${s}`)}
                    title={t(`tahta.sekiller.${s}`)}
                    onClick={() => onSekil(s)}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded hover:bg-slate-100 ${
                      sekil === s ? "bg-slate-100 text-blue-600" : ""
                    }`}
                  >
                    <Icon name={SEKIL_IKONU[s]} className="h-5 w-5" />
                  </PlainButton>
                ))}
              </div>
            </Bolum>
          )}
          {(menu === "kalem" || menu === "metin" || menu === "sekil") && (
            <Bolum baslik={t("tahta.renk")}>
              <div className="flex gap-1.5">
                {RENKLER.map((r) => (
                  <PlainButton
                    key={r.ad}
                    role="menuitem"
                    aria-label={t(`tahta.renkler.${r.ad}`)}
                    title={t(`tahta.renkler.${r.ad}`)}
                    onClick={() => onStil({ currentItemStrokeColor: r.deger })}
                    className="h-6 w-6 rounded-full border border-slate-300"
                    style={{ backgroundColor: r.deger }}
                  />
                ))}
              </div>
            </Bolum>
          )}
          {(menu === "kalem" || menu === "sekil") && (
            <Bolum baslik={t("tahta.kalinlik")}>
              <div className="flex gap-1">
                {KALINLIKLAR.map((k) => (
                  <MetinDugmesi
                    key={k.ad}
                    onClick={() => onStil({ currentItemStrokeWidth: k.deger })}
                  >
                    {t(`tahta.kalinliklar.${k.ad}`)}
                  </MetinDugmesi>
                ))}
              </div>
            </Bolum>
          )}
          {menu === "metin" && (
            <Bolum baslik={t("tahta.boyut")}>
              <div className="flex gap-1">
                {BOYUTLAR.map((b) => (
                  <MetinDugmesi key={b.ad} onClick={() => onStil({ currentItemFontSize: b.deger })}>
                    {t(`tahta.boyutlar.${b.ad}`)}
                  </MetinDugmesi>
                ))}
              </div>
            </Bolum>
          )}
          {menu === "uygulamalar" && (
            <div className="flex flex-col">
              <MenuOgesi
                ikon="arrowUpload"
                onClick={() => {
                  setMenu(null);
                  dosyaGirdisi.current?.click();
                }}
              >
                {t("tahta.uygulama.dosyaYukle")}
              </MenuOgesi>
              <MenuOgesi
                ikon="image"
                onClick={() => {
                  setMenu(null);
                  onResim();
                }}
              >
                {t("tahta.uygulama.resimKaydet")}
              </MenuOgesi>
              <MenuOgesi
                ikon="arrowDownload"
                onClick={() => {
                  setMenu(null);
                  onPdf();
                }}
              >
                {t("tahta.uygulama.pdfKaydet")}
              </MenuOgesi>
            </div>
          )}
        </div>
      )}
      <input
        ref={dosyaGirdisi}
        type="file"
        accept="application/pdf"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const secilen = e.target.files?.[0];
          e.target.value = "";
          if (secilen) onDosya(secilen);
        }}
      />
    </div>
  );
}

function Bolum({ baslik, children }: { baslik: string; children: ReactNode }) {
  return (
    <div className="px-1 py-1.5">
      <p className="mb-1.5 text-xs font-semibold text-slate-500">{baslik}</p>
      {children}
    </div>
  );
}

function MetinDugmesi({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <PlainButton
      role="menuitem"
      onClick={onClick}
      className="rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-100"
    >
      {children}
    </PlainButton>
  );
}

function MenuOgesi({
  ikon,
  onClick,
  children,
}: {
  ikon: IconName;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <PlainButton
      role="menuitem"
      onClick={onClick}
      className="flex h-10 items-center gap-3 rounded px-2 text-left hover:bg-slate-100"
    >
      <Icon name={ikon} className="h-5 w-5" />
      {children}
    </PlainButton>
  );
}
