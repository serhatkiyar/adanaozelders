/* ──────────────────────────────────────────────────────────────────────────
 * ORTAK TAHTA YÜZEYİ — Excalidraw, Preply tahta yüzeyinin düzeniyle
 * (spesifikasyon `preply-sinif-tahta-duzen.md` §4).
 *
 * Bu dosya `ZoomOdasi`nda `lazy()` ile yüklenir: Excalidraw, pdf.js ve jsPDF
 * YALNIZ tahta ilk açıldığında inen parçadadır. Başlık şeridi ("Beyaz tahta",
 * "Paylaşımlı", X) bu dosyada DEĞİL (`oda/TahtaAlani`): tahta yüklenirken de
 * görünür.
 *
 * ## Yüzey (Preply §4)
 *
 * - Sol dikey araç çubuğu: seç · lazer · kalem · metin · şekil · silgi ·
 *   temizle · kaydır · uygulamalar. Öğrencide silgi, temizle ve uygulamalar
 *   YOK (Preply `TOOLBAR_ITEMS.slice(0,5)+slice(7)`; kullanıcı kararı:
 *   öğrenci çizebilir, silgi/temizle yalnız öğretmende).
 * - Alt sol: geri al / yinele + yakınlaştırma (+, %, −, ortala).
 * - Alt sağ: sayfa denetimi ‹ 1/1 › + sayfa ekle + sayfa sil (öğretmen).
 * - Excalidraw'ın kendi menüsü, araç çubuğu, kütüphanesi, yardımı ve
 *   karşılama ekranı gizli (`tahta.css`). Mevcut "PDF olarak indir" özelliği
 *   Preply'daki gibi "Uygulamalar" menüsünde ("PDF olarak kaydet").
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
 * PDF sayfa görüntüleri telden GİTMEZ: öğretmenin seçtiği PDF ders kaynağı
 * olarak yüklenir (private/ + imzalı adres; karşı tarafa mevcut "derse yeni
 * dosya paylaşıldı" bildirimi de gider), telden yalnız kaynak kimliği ve sayfa
 * numarası gider (zemin görüntüsünün dosya kimliği `pdf-{kaynak}-{no}`). Her
 * taraf eksik zemini imzalı adresten indirip kendisi çizer.
 *
 * ## Kalıcılık (Preply'dan FARKLI)
 *
 * Preply tahtası sunucuda kalıcı. Burada sahne, sayfa açık kaldıkça modül
 * önbelleğinde durur (tahta kapatılıp açılınca geri gelir) ve açılışta karşı
 * taraftan istenir; iki taraf da sayfayı kapatırsa içerik kaybolur.
 * ────────────────────────────────────────────────────────────────────────── */
import "./excalidrawVarlik";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  convertToExcalidrawElements,
  exportToBlob,
  exportToCanvas,
  reconcileElements,
  restoreElements,
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
  Collaborator,
  ExcalidrawImperativeAPI,
  SocketId,
} from "@excalidraw/excalidraw/types";

import { fetchBooking, uploadBookingResource } from "@/api/bookings";
import { Icon, type IconName } from "@/components/AppIcon";
import { Modal } from "@/components/ui/Modal";
import { PlainButton } from "@/components/ui/PlainButton";
import { pdfAc, type AcikPdf } from "@/lib/pdfSayfa";
import {
  BASLANGIC_SAYFALARI,
  degisenler,
  elemanSayfasi,
  gorunurMu,
  mezarTasi,
  pdfDosyaCoz,
  pdfDosyaKimligi,
  sayfaEkle,
  sayfaEtiketle,
  sayfaGec,
  sayfaSil,
  sayfalariBirlestir,
  surumleriYaz,
  type SayfaDurumu,
  type TahtaEleman,
  type TahtaMesaji,
  type TahtaSayfasi,
} from "@/lib/tahtaSenkron";

import type { DersKanali, Gonderen } from "./dersKanali";
import "./tahta.css";

/** Çizim yayını bu aralıkta biriktirilir (60 fps'de her kareyi yollamamak için). */
const YAYIN_ARALIGI_MS = 120;
/** Periyodik tam sahne yayını — düşen mesajın bıraktığı ayrışmayı kapatır. */
const TAM_SENKRON_MS = 10_000;
/** Lazer yayını en çok 10/sn (plan §4: imleç ≤10/sn). */
const LAZER_ARALIGI_MS = 100;
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

/** Öğrencinin kullanabildiği araç türleri (kısayolla da seçilse sıfırlanır). */
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
    };
    onbellekler.set(dersId, o);
  }
  return o;
}

/** Ders kaynağı PDF'leri: kaynak kimliği → açık belge. */
const pdfler = new Map<number, Promise<AcikPdf>>();

async function kaynakPdfiniAc(dersId: number, kaynak: number): Promise<AcikPdf> {
  // Önbellekteki ders yanıtı yeni yüklenen kaynağı içermez: taze çekilir.
  // Yanıttaki adres sunucuda kısa ömürlü imzalı adrese çevrilmiştir.
  const ders = await fetchBooking(dersId);
  const k = ders.resources?.find((r) => r.id === kaynak && r.kind === "file");
  if (!k) throw new Error("kaynak yok");
  // Tüm dosya tek istekte (pdf.js `url` modu parça/aralık istekleri açar).
  const yanit = await fetch(k.url);
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

type Props = {
  kanal: DersKanali;
  dersId: number;
  ogretmen: boolean;
};

export default function TahtaPaneli({ kanal, dersId, ogretmen }: Props) {
  const { t } = useTranslation();
  const o = onbellek(dersId);
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

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  apiRef.current = api;
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

  /** "Karşı tarafın bildiğine inandığım sürüm" — eko döngüsünü bu kırar. */
  const bilinen = useRef(new Map<string, number>());
  /** DEFTER — bütün sayfaların bütün elemanları; sahnede yalnız aktif sayfa. */
  const defter = o.defter;
  const yayinZamani = useRef<number | null>(null);
  const sonLazer = useRef(0);
  const lazerAcik = useRef(false);
  const lazerler = useRef(new Map<SocketId, Collaborator>());
  const yukleniyor = useRef(new Set<string>());

  /* ── Defter ───────────────────────────────────────────────────────────── */

  const defteriDoldur = useCallback(
    (elemanlar: readonly OrderedExcalidrawElement[]) => {
      for (const e of elemanlar) defter.set(e.id, e);
    },
    [defter],
  );

  const dosyaEkle = useCallback(
    (a: ExcalidrawImperativeAPI, id: string, dataURL: string) => {
      const dosya = {
        id: id as FileId,
        dataURL: dataURL as BinaryFileData["dataURL"],
        mimeType: "image/jpeg",
        created: Date.now(),
      } as BinaryFileData;
      o.dosyalar.set(id, dosya);
      a.addFiles([dosya]);
    },
    [o],
  );

  /** Görünür PDF zeminlerinden dosyası eksik olanları indirip çizer. */
  const eksikZeminleriYukle = useCallback(
    (a: ExcalidrawImperativeAPI) => {
      const dosyalar = a.getFiles();
      for (const e of a.getSceneElements()) {
        if (e.type !== "image" || !e.fileId || dosyalar[e.fileId]) continue;
        const pdf = pdfDosyaCoz(e.fileId);
        if (!pdf || yukleniyor.current.has(e.fileId)) continue;
        const fid = e.fileId;
        yukleniyor.current.add(fid);
        void pdfGetir(dersId, pdf.kaynak)
          .then((b) => b.sayfayiCiz(pdf.no))
          .then((g) => dosyaEkle(a, fid, g.dataURL))
          .catch(() => setDurum(t("tahta.durum.sayfaAcilamadi")))
          .finally(() => yukleniyor.current.delete(fid));
      }
    },
    [dersId, dosyaEkle, t],
  );

  /** Sahneyi defterin aktif sayfaya düşen alt kümesiyle yeniden yazar. */
  const gorunuruYaz = useCallback(
    (a: ExcalidrawImperativeAPI) => {
      const gorunur = [...defter.values()]
        .filter((e) => gorunurMu(e as unknown as TahtaEleman, aktifSayfa()))
        .sort((x, y) =>
          (x.index ?? "") < (y.index ?? "") ? -1 : (x.index ?? "") > (y.index ?? "") ? 1 : 0,
        );
      a.updateScene({ elements: gorunur, captureUpdate: CaptureUpdateAction.NEVER });
      eksikZeminleriYukle(a);
    },
    [defter, eksikZeminleriYukle],
  );

  /* ── Gönderim ─────────────────────────────────────────────────────────── */

  const gonder = useCallback((m: TahtaMesaji) => kanal.yayinla(m), [kanal]);

  const tamSahneyiGonder = useCallback(() => {
    const a = apiRef.current;
    if (!a) return;
    defteriDoldur(a.getSceneElementsIncludingDeleted());
    const elemanlar = [...defter.values()] as unknown as TahtaEleman[];
    surumleriYaz(elemanlar, bilinen.current);
    gonder({ t: "durum", elemanlar: [...elemanlar], sayfalar: sayfaRef.current });
  }, [defter, defteriDoldur, gonder]);

  /** Yalnız DEĞİŞENLERİ yayınlar (mezar taşları dahil: silgi böyle yayılır). */
  const degisenleriGonder = useCallback(() => {
    const a = apiRef.current;
    if (!a) return;
    defteriDoldur(a.getSceneElementsIncludingDeleted());
    // Yeni doğan elemanları AÇIK sayfaya etiketle; çizilmekte olan atlanır.
    const d = a.getAppState();
    const mesgulIdler = new Set(
      [d.newElement?.id, d.editingTextElement?.id, d.resizingElement?.id].filter(
        (id): id is string => typeof id === "string",
      ),
    );
    let etiketlendi = false;
    for (const e of [...defter.values()]) {
      if (mesgulIdler.has(e.id)) continue;
      if (elemanSayfasi(e as unknown as TahtaEleman) !== null) continue;
      defter.set(
        e.id,
        sayfaEtiketle(e as unknown as TahtaEleman, aktifSayfa()) as unknown as OrderedExcalidrawElement,
      );
      etiketlendi = true;
    }
    if (etiketlendi) gorunuruYaz(a);
    const yeni = degisenler([...defter.values()] as unknown as TahtaEleman[], bilinen.current);
    if (yeni.length === 0) return;
    surumleriYaz(yeni, bilinen.current);
    gonder({ t: "durum", elemanlar: yeni });
  }, [defter, defteriDoldur, gonder, gorunuruYaz]);

  const degisimeTepki = useCallback(
    (_e: readonly unknown[], appState: AppState) => {
      // Kısayolla seçilen, çubukta olmayan araç (görüntü, çerçeve…; öğrencide
      // silgi) sıfırlanır.
      const tur = appState.activeTool.type;
      const izinli = ogretmen ? OGRETMEN_ARACLARI : OGRENCI_ARACLARI;
      if (!izinli.has(tur)) {
        apiRef.current?.setActiveTool({ type: "selection" });
      } else if (tur !== aktifArac) {
        setAktifArac(tur);
      }
      if (appState.zoom.value !== yakinlik) setYakinlik(appState.zoom.value);
      if (tur !== "laser" && lazerAcik.current) {
        lazerAcik.current = false;
        gonder({ t: "lazerBitti" });
      }
      if (yayinZamani.current !== null) return;
      yayinZamani.current = window.setTimeout(() => {
        yayinZamani.current = null;
        degisenleriGonder();
      }, YAYIN_ARALIGI_MS);
    },
    [aktifArac, degisenleriGonder, gonder, ogretmen, yakinlik],
  );

  /* ── Alım ─────────────────────────────────────────────────────────────── */

  const uygula = useCallback(
    (m: TahtaMesaji, g: Gonderen) => {
      const a = apiRef.current;
      if (!a) return;
      if (m.t === "istek") {
        tamSahneyiGonder();
        return;
      }
      if (m.t === "lazer" || m.t === "lazerBitti") {
        const id = g.istemci as SocketId;
        if (m.t === "lazerBitti") lazerler.current.delete(id);
        else
          lazerler.current.set(id, {
            pointer: { x: m.x, y: m.y, tool: "laser" },
            button: m.dugme,
          });
        a.updateScene({ collaborators: new Map(lazerler.current) });
        return;
      }
      // Sayfa listesi: öğretmenden her zaman (sürümle); öğrenciden yalnız
      // yerelimiz hiç değişmemişse (öğretmen sayfayı yenilediyse geri alır).
      if (m.sayfalar && (g.ogretmen || sayfaRef.current.surum === 0)) {
        const birlesik = sayfalariBirlestir(sayfaRef.current, m.sayfalar);
        if (birlesik !== sayfaRef.current) {
          defteriDoldur(a.getSceneElementsIncludingDeleted());
          setSayfalar(birlesik);
        }
      }
      if (m.elemanlar.length > 0) {
        const uzak = restoreElements(m.elemanlar as unknown as ExcalidrawElement[], null, {
          repairBindings: true,
        }) as unknown as readonly RemoteExcalidrawElement[];
        surumleriYaz(uzak as unknown as TahtaEleman[], bilinen.current);
        defteriDoldur(a.getSceneElementsIncludingDeleted());
        const birlesik = reconcileElements([...defter.values()], uzak, a.getAppState());
        defter.clear();
        defteriDoldur(birlesik);
      }
      gorunuruYaz(a);
    },
    [defter, defteriDoldur, gorunuruYaz, setSayfalar, tamSahneyiGonder],
  );

  useEffect(() => kanal.dinle(uygula), [kanal, uygula]);

  /* Açılışta ve her yeniden abonelikte sahneyi iste; periyodik tam senkron. */
  useEffect(() => {
    if (!api) return;
    // Önbellekteki sahne ve PDF zeminleri geri konur.
    if (o.dosyalar.size > 0) api.addFiles([...o.dosyalar.values()]);
    gorunuruYaz(api);
    gonder({ t: "istek" });
    const coz = kanal.aboneOlununca(() => gonder({ t: "istek" }));
    const sayac = window.setInterval(tamSahneyiGonder, TAM_SENKRON_MS);
    return () => {
      coz();
      window.clearInterval(sayac);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useEffect(
    () => () => {
      if (yayinZamani.current !== null) window.clearTimeout(yayinZamani.current);
    },
    [],
  );

  /* Görüntü yapıştırma/bırakma engellenir: dosyalar telden gitmez, karşı
     tarafta kırık görsel olurdu (PDF "Dosya yükle" ile gelir). */
  useEffect(() => {
    const yapistir = (e: ClipboardEvent) => {
      const hedef = e.target as Node | null;
      const bizde = !hedef || hedef === document.body || kap.current?.contains(hedef);
      if (bizde && (e.clipboardData?.files.length ?? 0) > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("paste", yapistir, true);
    return () => window.removeEventListener("paste", yapistir, true);
  }, []);

  /* ── Sayfalar (öğretmen) ──────────────────────────────────────────────── */

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
      const yeni = { ...ham, customData: { tahtaSayfa: sayfa.id } };
      // Zemin dizinin BAŞINA: kesirli z-sırası dizi sırasından türer.
      const gorunur = [...defter.values()].filter((e) =>
        gorunurMu(e as unknown as TahtaEleman, aktifSayfa()),
      );
      if (sayfa.id === aktifSayfa()) {
        a.updateScene({ elements: [yeni, ...gorunur], captureUpdate: CaptureUpdateAction.NEVER });
        defteriDoldur(a.getSceneElementsIncludingDeleted());
      } else {
        defter.set(yeni.id, yeni as unknown as OrderedExcalidrawElement);
      }
      const yerlesmis = defter.get(yeni.id) as unknown as TahtaEleman | undefined;
      if (!yerlesmis) return;
      surumleriYaz([yerlesmis], bilinen.current);
      gonder({ t: "durum", elemanlar: [yerlesmis], sayfalar: sayfaRef.current });
    },
    [defter, defteriDoldur, dersId, dosyaEkle, gonder, o],
  );

  /** Sayfa listesini değiştirir, sahneyi yeniler, yayınlar (+ zemin). */
  const sayfalariDegistir = useCallback(
    (yeni: SayfaDurumu, elemanlar: TahtaEleman[] = []) => {
      const a = apiRef.current;
      if (!a || yeni === sayfaRef.current) return;
      defteriDoldur(a.getSceneElementsIncludingDeleted());
      setSayfalar(yeni);
      gorunuruYaz(a);
      surumleriYaz(elemanlar, bilinen.current);
      gonder({ t: "durum", elemanlar, sayfalar: yeni });
      const aktif = yeni.liste.find((s) => s.id === yeni.aktif);
      if (aktif?.pdf) {
        void zeminiKur(aktif).catch(() => setDurum(t("tahta.durum.sayfaAcilamadi")));
      }
    },
    [defteriDoldur, gonder, gorunuruYaz, setSayfalar, t, zeminiKur],
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
    surumleriYaz(mezarlar, bilinen.current);
    gonder({ t: "durum", elemanlar: mezarlar });
  }, [defter, defteriDoldur, gonder, gorunuruYaz]);

  /** "Dosya yükle": PDF ders kaynağı olur, her sayfası tahtaya sayfa olarak eklenir. */
  const dosyaYukle = useCallback(
    async (dosya: File) => {
      setDurum(null);
      if (dosya.type !== "application/pdf" && !dosya.name.toLowerCase().endsWith(".pdf")) {
        setDurum(t("tahta.durum.yalnizPdf"));
        return;
      }
      setMesgul(t("tahta.durum.yukleniyor"));
      try {
        const ders = await uploadBookingResource(dersId, dosya);
        const kaynak = (ders.resources ?? [])
          .filter((r) => r.kind === "file" && r.file_name === dosya.name)
          .reduce<number | null>((en, r) => (en === null || r.id > en ? r.id : en), null);
        if (kaynak === null) throw new Error("kaynak");
        const belge = pdfAc(dosya);
        pdfler.set(kaynak, belge);
        const { sayfaSayisi } = await belge;
        const yeni: TahtaSayfasi[] = Array.from({ length: sayfaSayisi }, (_, i) => ({
          id: `k${kaynak}-${i + 1}`,
          pdf: { kaynak, no: i + 1 },
        }));
        sayfalariDegistir(sayfaEkle(sayfaRef.current, yeni));
      } catch {
        setDurum(t("tahta.durum.yuklemeHatasi"));
      } finally {
        setMesgul(null);
      }
    },
    [dersId, sayfalariDegistir, t],
  );

  /* ── Dışa aktarım (Uygulamalar menüsü) ────────────────────────────────── */

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

  /* ── Lazer ────────────────────────────────────────────────────────────── */

  const imlecGuncelle = useCallback(
    ({ pointer, button }: { pointer: { x: number; y: number; tool: string }; button: "up" | "down" }) => {
      if (pointer.tool !== "laser") return;
      const simdi = Date.now();
      if (simdi - sonLazer.current < LAZER_ARALIGI_MS) return;
      sonLazer.current = simdi;
      lazerAcik.current = true;
      gonder({ t: "lazer", x: pointer.x, y: pointer.y, dugme: button });
    },
    [gonder],
  );

  /* ── Araç seçimi ──────────────────────────────────────────────────────── */

  const aracSec = (tur: string) => {
    apiRef.current?.setActiveTool({ type: tur as never });
    setAktifArac(tur);
  };
  const stilAyarla = (d: Partial<AppState>) =>
    apiRef.current?.updateScene({
      appState: d as never,
      captureUpdate: CaptureUpdateAction.NEVER,
    });

  const sayfaNo = sayfalar.liste.findIndex((s) => s.id === sayfalar.aktif) + 1;
  const toplam = sayfalar.liste.length;

  return (
    <div
      ref={kap}
      className={`ders-tahta relative h-full w-full bg-white ${EXCALIDRAW_TAM ? "ders-tahta--tam" : ""}`}
      onDropCapture={(e) => {
        if (e.dataTransfer.files.length > 0) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <Excalidraw
        excalidrawAPI={setApi}
        onChange={degisimeTepki}
        onPointerUpdate={imlecGuncelle}
        onPaste={(veri) =>
          !(
            (veri.files && Object.keys(veri.files).length > 0) ||
            veri.elements?.some((e) => e.type === "image") ||
            veri.mixedContent?.some((p) => p.type === "imageUrl")
          )
        }
        isCollaborating
        langCode="tr-TR"
        UIOptions={
          EXCALIDRAW_TAM
            ? { tools: { image: false } }
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
        {/* Tam Excalidraw denemesi: ☰ menü LiveKit tahtasındaki gibi ELLE
            kurulur (94a3fa7a) — Excalidraw'ın kendi öğeleri varsayılan
            sırasıyla, `Socials` hariç; PDF olarak indirme ve PDF yükleme
            eklenir. Sahneyi değiştiren "Aç" ve "Tuvali sıfırla" yalnız
            öğretmende (silgi/temizle kararı). */}
        {EXCALIDRAW_TAM && (
          <MainMenu>
            {ogretmen && <MainMenu.DefaultItems.LoadScene />}
            <MainMenu.DefaultItems.SaveToActiveFile />
            <MainMenu.DefaultItems.Export />
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.Item
              icon={<Icon name="arrowDownload" className="h-4 w-4" />}
              onSelect={() => void pdfKaydet()}
            >
              {t("tahta.uygulama.pdfKaydet")}
            </MainMenu.Item>
            {ogretmen && (
              <MainMenu.Item
                icon={<Icon name="arrowUpload" className="h-4 w-4" />}
                onSelect={() => pdfGirdisi.current?.click()}
              >
                {t("tahta.uygulama.dosyaYukle")}
              </MainMenu.Item>
            )}
            <MainMenu.Separator />
            <MainMenu.DefaultItems.CommandPalette />
            <MainMenu.DefaultItems.SearchMenu />
            <MainMenu.DefaultItems.Help />
            {ogretmen && <MainMenu.DefaultItems.ClearCanvas />}
            <MainMenu.Separator />
            <MainMenu.DefaultItems.ToggleTheme />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
          </MainMenu>
        )}
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
            if (secilen) void dosyaYukle(secilen);
          }}
        />
      )}

      {!EXCALIDRAW_TAM && (
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
          onDosya={(f) => void dosyaYukle(f)}
          onResim={() => void resimKaydet()}
          onPdf={() => void pdfKaydet()}
        />
      )}

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
      <div className="absolute bottom-4 right-4 z-10" role="group" aria-label={t("tahta.sayfa.denetim")}>
        <div className={KUTU}>
          {ogretmen && (
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
          {ogretmen && (
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
      </div>

      {(mesgul || durum) && (
        <p
          role="status"
          className="absolute left-1/2 top-3 z-20 max-w-[90%] -translate-x-1/2 rounded bg-slate-900/85 px-3 py-1.5 text-sm text-white"
        >
          {mesgul ?? durum}
        </p>
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
