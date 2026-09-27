/**
 * Sınıf sahnesi — Preply düzeni (spesifikasyon `preply-sinif-tahta-duzen.md`
 * §2, §3, §6): görünüm kararı, panel oranları, yüzen kutu, bölmeler ve karo
 * üstündeki "Video seçenekleri" menüsü. Dikdörtgenler `lib/sinifDuzeni.ts`te
 * saf olarak hesaplanır; bu bileşen yalnız ölçer, durumu tutar ve çizer.
 *
 * - Görünüm seçimi sekmede hatırlanır (sessionStorage, Preply anahtarları);
 *   bölme oranları ve araçsız kendi karonun kayması hatırlanMAZ: düzen
 *   değişince varsayılana döner (Preply §6).
 * - Yüzen kamera kutusu (`lib/kameraKutusu.ts`, depo `durum/kameraKutusu`):
 *   masaüstünde sahnenin her yerine sürüklenir, bırakınca en yakın izinli
 *   köşeye yapışır; telefonda köşeler arasında kaydırılır, dokununca
 *   küçülür. Köşe, boyut ve "kendi görüntümü gizle" cihazda kalıcıdır ve
 *   düzen değişince SIFIRLANMAZ.
 * - Karo menüsü: Görünüm | Boyut + Küçült | Kendi görüntümü gizle/göster
 *   (`menuitemradio`/`menuitemcheckbox`, ok tuşları, Esc, odak dönüşü).
 * - Odak (`odak`, CanliOda'da tutulur): tahta ya da paylaşım tüm sahneyi alır,
 *   kamera yüzen kutuda kalır; düğmeler tahta ve paylaşım başlıklarında.
 * - Hiçbir geçişte animasyon yok.
 * - Video kapları (`VideoSahnesi`) ve tahta (`TahtaAlani`) aynı
 *   ebeveynde kalır; tahta açılıp kapanınca görüşme yeniden bağlanmaz.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { Icon, type IconName } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";
import {
  BOYUTLAR,
  enYakinKose,
  kaydirmaSonucu,
  serbestKonumSinirla,
  type Boyut,
} from "@/lib/kameraKutusu";
import {
  KUCUK_EKRAN_PX,
  gorunumSec,
  gorunumuHatirla,
  kaymayiSinirla,
  secilebilirGorunumler,
  sonAracOku,
  sonVideoOku,
  videolarGizliHatirla,
  videolarGizliOku,
  yerlesimHesapla,
  type AracGorunumu,
  type Gorunum,
  type Kutu,
  type Nokta,
  type Odak,
  type VideoGorunumu,
} from "@/lib/sinifDuzeni";

import { useKameraKutusu } from "./durum/kameraKutusu";
import { useKarsiTaraf, usePaylasimVar } from "./durum/odaDeposu";
import { VideoSahnesi } from "./VideoSahnesi";

const GORUNUM_IKONU: Record<Gorunum, IconName> = {
  SPOTLIGHT: "rectangleLandscape",
  GRID: "splitVertical",
  SIDEBAR: "panelRight",
  CORNER: "pictureInPicture",
};
const BOYUT_ETIKETI: Record<Boyut, string> = {
  kucuk: "duzen.boyutKucuk",
  orta: "duzen.boyutOrta",
  buyuk: "duzen.boyutBuyuk",
};
/** Masaüstünde sürükleme bu kadar hareketten sonra başlar: tık köşe kaydetmez. */
const SURUKLEME_ESIGI_PX = 4;
/** Karo menüsü (`w-56`) ve sahne kenarına en az uzaklığı. */
const MENU_GENISLIK = 224;
const MENU_PAYI = 8;
/** Menü düğmesi karonun sağ üstünde (`right-2 top-2`, 40px). */
const TETIK_UST = 8;
const TETIK_ALT = 48;
/** Aşağıda bu kadar yer varsa menü aşağı açılır. */
const MENU_TAHMINI_YUKSEKLIK = 360;

type MenuDurumu = {
  hangi: "ben" | "karsi";
  sag: number;
  ust: number | null;
  alt: number | null;
  enCok: number;
};

/** Menüdeki öğeler (ok tuşlarıyla gezilenler). */
const menuOgeleri = (kap: HTMLElement | null) =>
  kap ? Array.from(kap.querySelectorAll<HTMLElement>('[role^="menuitem"]')) : [];

/** Pencere ölçüsü ve yönü (Preply `ry`: 200 ms debounce). */
function usePencere() {
  const oku = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [p, setP] = useState(oku);
  useEffect(() => {
    let z: number | undefined;
    const degisti = () => {
      window.clearTimeout(z);
      z = window.setTimeout(() => setP(oku()), 200);
    };
    window.addEventListener("resize", degisti);
    return () => {
      window.clearTimeout(z);
      window.removeEventListener("resize", degisti);
    };
  }, []);
  return p;
}

function useOlcu(ref: React.RefObject<HTMLElement | null>) {
  const [olcu, setOlcu] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setOlcu({ w: r.width, h: r.height });
    if (typeof ResizeObserver === "undefined") return;
    const g = new ResizeObserver(([k]) =>
      setOlcu({ w: k.contentRect.width, h: k.contentRect.height }),
    );
    g.observe(el);
    return () => g.disconnect();
  }, [ref]);
  return olcu;
}

const kutuStili = (k: Kutu) => ({ left: k.x, top: k.y, width: k.w, height: k.h });

export function SinifSahnesi({
  telefon,
  ogretmen,
  tahtaAcik,
  odak,
  onOdak,
  tahta,
  children,
}: {
  telefon: boolean;
  ogretmen: boolean;
  tahtaAcik: boolean;
  /** Uygulama içi odak (yalnız bende); açık olmayan araç için yok sayılır. */
  odak: Odak | null;
  onOdak: (hedef: Odak) => void;
  /** Tahta paneli (başlık + yüzey); yalnız tahta açıkken çizilir. */
  tahta: ReactNode;
  /** Sahnenin üstündeki katmanlar (tepkiler, şeritler, haplar). */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const sahne = useRef<HTMLDivElement>(null);
  const olcu = useOlcu(sahne);
  const pencere = usePencere();
  const paylasim = usePaylasimVar();
  const karsiTarafVar = Boolean(useKarsiTaraf());
  const [sonVideo, setSonVideo] = useState<VideoGorunumu | null>(sonVideoOku);
  const [sonArac, setSonArac] = useState<AracGorunumu | null>(sonAracOku);
  const [yanPanelOrani, setYanPanelOrani] = useState<number | null>(null);
  const [bolunmusOran, setBolunmusOran] = useState<number | null>(null);
  const [surukleme, setSurukleme] = useState<Nokta>({ x: 0, y: 0 });
  // Masaüstünde sürüklenen yüzen kutunun mutlak sol üst noktası (bırakınca null).
  const [suruklenen, setSuruklenen] = useState<Nokta | null>(null);
  const [menu, setMenu] = useState<MenuDurumu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const tetikRef = useRef<HTMLElement | null>(null);
  // Kenar çubuğunda videolar gizli mi (sekmede hatırlanır; düzen değişince korunur).
  const [videolarGizli, setVideolarGizli] = useState(videolarGizliOku);
  // Kamera kutusu tercihleri (cihazda kalıcı; küçültme yalnız bellekte).
  const kose = useKameraKutusu((s) => (telefon ? s.koseTelefon : s.koseMasaustu));
  const boyut = useKameraKutusu((s) => s.boyut);
  const kucuk = useKameraKutusu((s) => s.kucuk);
  const kendiGizli = useKameraKutusu((s) => s.kendiGizli);
  const koseAyarla = useKameraKutusu((s) => s.koseAyarla);
  const boyutAyarla = useKameraKutusu((s) => s.boyutAyarla);
  const kucukAyarla = useKameraKutusu((s) => s.kucukAyarla);
  const kendiGizliAyarla = useKameraKutusu((s) => s.kendiGizliAyarla);
  const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;

  const kucukEkran = pencere.w < KUCUK_EKRAN_PX;
  const gorunum = gorunumSec({
    paylasim,
    aracAcik: tahtaAcik,
    mobilKucuk: telefon && kucukEkran,
    sonVideo,
    sonArac,
  });

  // Düzen değişince sürükleme ve bölmeler varsayılana döner (Preply §6);
  // kamera kutusunun saklanan köşesi/boyutu korunur.
  const imza = `${gorunum}|${paylasim}|${tahtaAcik}|${odak}`;
  const [sonImza, setSonImza] = useState(imza);
  if (imza !== sonImza) {
    setSonImza(imza);
    setSurukleme({ x: 0, y: 0 });
    setSuruklenen(null);
    setYanPanelOrani(null);
    setBolunmusOran(null);
    setMenu(null);
  }

  const y = useMemo(
    () =>
      yerlesimHesapla({
        genislik: olcu.w,
        yukseklik: olcu.h,
        gorunum,
        paylasim,
        aracAcik: tahtaAcik,
        karsiTarafVar,
        telefon,
        dikey: pencere.h > pencere.w,
        ogrenciTelefon: telefon && !ogretmen,
        kucukEkran,
        pencereDikey: pencere.h > pencere.w,
        yanPanelOrani,
        bolunmusOran,
        surukleme,
        videolarGizli,
        kose,
        boyut,
        kucuk,
        kendiGizli,
        suruklenen,
        dpr,
        odak,
      }),
    [olcu, gorunum, paylasim, tahtaAcik, karsiTarafVar, telefon, pencere, ogretmen, kucukEkran, yanPanelOrani, bolunmusOran, surukleme, videolarGizli, kose, boyut, kucuk, kendiGizli, suruklenen, dpr, odak],
  );
  const yRef = useRef(y);
  yRef.current = y;

  /*
   * Yüzen kutu: masaüstünde serbest sürükleme → bırakınca en yakın izinli
   * köşe (depoya); telefonda kaydırma → köşe, dokunma → küçült. Araçsız
   * kendi karon: kayma (sınır tüm sahne, hatırlanmaz).
   */
  const surukleBasla = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const hedefOge = e.target as HTMLElement;
      // Küçültülmüş balon bir düğmedir; telefonda o da kaydırılır.
      const hap = hedefOge.closest("[data-kamera-hapi]") !== null;
      if (hedefOge.closest("button") && !hap) return;
      if (e.button !== 0) return;
      const y0 = yRef.current;
      const hedef = e.currentTarget;
      const dinle = (
        hareket: ((h: PointerEvent) => void) | null,
        birak: (h: PointerEvent) => void,
      ) => {
        const son = (h: PointerEvent) => {
          if (hareket) hedef.removeEventListener("pointermove", hareket);
          hedef.removeEventListener("pointerup", son);
          hedef.removeEventListener("pointercancel", son);
          birak(h);
        };
        if (hareket) hedef.addEventListener("pointermove", hareket);
        hedef.addEventListener("pointerup", son);
        hedef.addEventListener("pointercancel", son);
      };

      if (y0.yuzen && y0.kaydirilabilir) {
        hedef.setPointerCapture(e.pointerId);
        const bas = { x: e.clientX, y: e.clientY, t: performance.now() };
        dinle(null, (h) => {
          const y1 = yRef.current;
          if (h.type === "pointercancel" || !y1.kose || !y1.koseAlani) return;
          const s = kaydirmaSonucu(
            y1.kose,
            { dx: h.clientX - bas.x, dy: h.clientY - bas.y, sureMs: performance.now() - bas.t },
            y1.koseAlani.izinli,
          );
          if (s.tur === "kaydirma") koseAyarla(true, s.kose);
          // Balona dokunma düğmenin kendi tıklamasıyla açılır (çift geçiş olmasın).
          else if (s.tur === "dokunma" && !hap) kucukAyarla(true);
        });
        return;
      }
      if (hap) return;

      if (y0.suruklenebilir === "yuzen") {
        e.preventDefault();
        hedef.setPointerCapture(e.pointerId);
        const bas = { x: e.clientX, y: e.clientY };
        const ilk = { x: y0.video.x, y: y0.video.y };
        let son: Nokta | null = null;
        dinle(
          (h) => {
            const dx = h.clientX - bas.x;
            const dy = h.clientY - bas.y;
            if (!son && Math.hypot(dx, dy) < SURUKLEME_ESIGI_PX) return;
            son = { x: ilk.x + dx, y: ilk.y + dy };
            setSuruklenen(son);
          },
          (h) => {
            if (!son) return;
            const y1 = yRef.current;
            if (h.type !== "pointercancel" && y1.koseAlani && y1.serbestAlan) {
              const olcu = { w: y1.video.w, h: y1.video.h };
              const k = serbestKonumSinirla(son, y1.serbestAlan, olcu);
              koseAyarla(
                false,
                enYakinKose({ ...k, ...olcu }, y1.koseAlani.alan, y1.koseAlani.izinli),
              );
            }
            setSuruklenen(null);
          },
        );
        return;
      }

      const siniri = y0.suruklemeSiniri;
      if (!siniri) return;
      e.preventDefault();
      hedef.setPointerCapture(e.pointerId);
      const bas = { x: e.clientX, y: e.clientY };
      const ilk = kaymayiSinirla(surukleme, siniri);
      dinle(
        (h) => {
          const s = yRef.current.suruklemeSiniri ?? siniri;
          setSurukleme(kaymayiSinirla({ x: ilk.x + h.clientX - bas.x, y: ilk.y + h.clientY - bas.y }, s));
        },
        () => {},
      );
    },
    [surukleme, koseAyarla, kucukAyarla],
  );

  /* Bölme tutamağı: yan panel (240px…%50) ya da paylaşım/tahta (%35–65). */
  const bolmeSurukle = (e: ReactPointerEvent<HTMLDivElement>) => {
    const b = yRef.current.bolme;
    const el = sahne.current;
    if (!b || !el) return;
    e.preventDefault();
    const hedef = e.currentTarget;
    hedef.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const hareket = (h: PointerEvent) => {
      const g = yRef.current.grup;
      if (b.tur === "yanPanel") {
        setYanPanelOrani((r.left + g.x + g.w - h.clientX) / g.w);
      } else if (b.yon === "yatay") {
        setBolunmusOran(((h.clientX - r.left - g.x) / g.w) * 100);
      } else {
        setBolunmusOran(((h.clientY - r.top - g.y) / g.h) * 100);
      }
    };
    const birak = () => {
      hedef.removeEventListener("pointermove", hareket);
      hedef.removeEventListener("pointerup", birak);
      hedef.removeEventListener("pointercancel", birak);
    };
    hedef.addEventListener("pointermove", hareket);
    hedef.addEventListener("pointerup", birak);
    hedef.addEventListener("pointercancel", birak);
  };

  const secenekler = secilebilirGorunumler(paylasim, tahtaAcik);
  // Menü bölümleri: Görünüm (seçilebilir mod varsa), Boyut + Küçült (yüzen
  // kutu), kendi görüntün (karşı taraf varken; yoksa gizleme uygulanmaz).
  const kutuBolumu = y.yuzen;
  const kendiBolumu = karsiTarafVar;
  const menuVar = !telefon && (secenekler.length > 0 || kutuBolumu || kendiBolumu);

  /**
   * Menüyü kapatır; `odak` verilirse odağı oraya taşır: "tetik" (menü
   * düğmesi; görünmüyorsa karonun kendisi), "karsi" (kendi karon gizlendi),
   * "hap" (kutu küçültüldü).
   */
  const menuyuKapat = useCallback((odak: "tetik" | "karsi" | "hap" | null) => {
    setMenu(null);
    if (!odak) return;
    const tetik = tetikRef.current;
    requestAnimationFrame(() => {
      const kap = sahne.current;
      if (odak === "hap") {
        kap?.querySelector<HTMLElement>("[data-kamera-hapi]")?.focus();
        return;
      }
      if (odak === "karsi") {
        kap?.querySelector<HTMLElement>('[data-karo="karsi"]')?.focus();
        return;
      }
      if (!tetik?.isConnected) return;
      tetik.focus();
      // Düğme görünmez (fare durdu) ya da karo `inert` ise karoya dön.
      if (document.activeElement !== tetik) {
        tetik.closest<HTMLElement>("[data-karo]")?.focus();
      }
    });
  }, []);

  const gorunumSecildi = (g: Gorunum) => {
    gorunumuHatirla(g);
    if (g === "SPOTLIGHT" || g === "GRID") setSonVideo(g);
    else setSonArac(g);
    menuyuKapat("tetik");
  };

  const menuAc = (hangi: "ben" | "karsi", tetik: HTMLElement) => {
    const kutu = hangi === "ben" ? yRef.current.benKaro : yRef.current.karsiKaro;
    if (!kutu) return;
    tetikRef.current = tetik;
    // Sahne `overflow-hidden`: menü kırpılmasın. Aşağıda yer yoksa yukarı
    // açılır; yatayda sahnenin içinde kalır; en çok yükseklik kaydırılır.
    const sag = Math.min(
      Math.max(MENU_PAYI, olcu.w - (kutu.x + kutu.w)),
      Math.max(MENU_PAYI, olcu.w - MENU_GENISLIK - MENU_PAYI),
    );
    const asagi = olcu.h - (kutu.y + TETIK_ALT) - MENU_PAYI;
    const yukari = kutu.y + TETIK_UST - 2 * MENU_PAYI;
    setMenu(
      asagi >= MENU_TAHMINI_YUKSEKLIK || asagi >= yukari
        ? { hangi, sag, ust: kutu.y + TETIK_ALT, alt: null, enCok: asagi }
        : { hangi, sag, ust: null, alt: olcu.h - (kutu.y + TETIK_UST - 4), enCok: yukari },
    );
  };

  const karoUstu = !menuVar
    ? undefined
    : (hangi: "ben" | "karsi") => (
        <PlainButton
          data-duzen-tetik
          onClick={(e) => {
            e.stopPropagation();
            if (menu) menuyuKapat(null);
            else menuAc(hangi, e.currentTarget);
          }}
          aria-label={t("duzen.secenekler")}
          title={t("duzen.secenekler")}
          aria-haspopup="menu"
          aria-expanded={menu?.hangi === hangi}
          className="inline-flex h-10 w-10 items-center justify-center rounded-ders bg-black/60 text-white hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marka-focus"
        >
          <Icon name="grid" className="h-5 w-5" />
        </PlainButton>
      );

  // Menü açılınca odak seçili (yoksa ilk) öğeye.
  const menuAcik = menu !== null;
  useEffect(() => {
    if (!menuAcik) return;
    const ogeler = menuOgeleri(menuRef.current);
    (ogeler.find((o) => o.getAttribute("aria-checked") === "true") ?? ogeler[0])?.focus();
  }, [menuAcik]);

  useEffect(() => {
    if (!menuAcik) return;
    const kapat = (e: PointerEvent) => {
      const h = e.target as HTMLElement;
      // Tetik kendi tıklamasıyla kapatır (burada kapatılırsa yeniden açılırdı).
      if (!h.closest("[data-duzen-menusu]") && !h.closest("[data-duzen-tetik]")) setMenu(null);
    };
    const tus = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      menuyuKapat("tetik");
    };
    document.addEventListener("pointerdown", kapat, true);
    document.addEventListener("keydown", tus, true);
    return () => {
      document.removeEventListener("pointerdown", kapat, true);
      document.removeEventListener("keydown", tus, true);
    };
  }, [menuAcik, menuyuKapat]);

  /** Menü klavyesi: ↑/↓ döngüsel, Home/End, Tab kapatır. */
  const menuTusu = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const ogeler = menuOgeleri(menuRef.current);
    if (ogeler.length === 0) return;
    const i = ogeler.indexOf(document.activeElement as HTMLElement);
    let hedef: number | null = null;
    if (e.key === "ArrowDown") hedef = (i + 1) % ogeler.length;
    else if (e.key === "ArrowUp") hedef = (i - 1 + ogeler.length) % ogeler.length;
    else if (e.key === "Home") hedef = 0;
    else if (e.key === "End") hedef = ogeler.length - 1;
    else if (e.key === "Tab") {
      setMenu(null);
      return;
    }
    if (hedef === null) return;
    e.preventDefault();
    ogeler[hedef].focus();
  };

  const menuOgesi =
    "flex h-11 w-full items-center gap-3 px-4 text-left text-[15px] font-medium outline-none hover:bg-slate-50 focus-visible:bg-slate-100";
  const bolumBasligi = "px-4 pb-1 pt-2 text-xs font-semibold text-slate-500";

  const bolme = y.bolme;
  const daralt = y.daraltDugmesi;

  return (
    <div ref={sahne} className="relative h-full w-full overflow-hidden bg-ders-zemin">
      {/* Tahta paneli — yalnız açıkken; video kaplarından BAĞIMSIZ düğüm. */}
      {tahtaAcik && y.arac && (
        <div
          className="absolute z-0 overflow-hidden"
          style={y.arac.w > 0 ? kutuStili(y.arac) : { display: "none" }}
        >
          {tahta}
        </div>
      )}

      <VideoSahnesi
        telefon={telefon}
        yerlesim={y}
        karoUstu={karoUstu}
        onSurukleBasla={surukleBasla}
        sahneGenisligi={olcu.w}
        onPaylasimOdak={() => onOdak("paylasim")}
      />

      {bolme && (
        // Odaklanabilir `separator` ARIA'da etkileşimli pencere bölücüdür.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div
          role="separator"
          aria-orientation={bolme.tur === "bolunmus" && bolme.yon === "dikey" ? "horizontal" : "vertical"}
          aria-label={t(bolme.tur === "yanPanel" ? "duzen.yanPanelBoyutu" : "duzen.bolmeBoyutu")}
          aria-valuemin={bolme.enAz}
          aria-valuemax={bolme.enCok}
          aria-valuenow={Math.round(bolme.deger)}
          tabIndex={0}
          onPointerDown={bolmeSurukle}
          onKeyDown={(e) => {
            const adim =
              e.key === "ArrowLeft" || e.key === "ArrowUp"
                ? -1
                : e.key === "ArrowRight" || e.key === "ArrowDown"
                  ? 1
                  : 0;
            if (!adim) return;
            e.preventDefault();
            if (bolme.tur === "yanPanel") setYanPanelOrani((bolme.deger - adim * 16) / y.grup.w);
            else setBolunmusOran(bolme.deger + adim * 2);
          }}
          className={`group absolute z-20 flex touch-none items-center justify-center outline-none focus-visible:bg-marka-focus ${
            bolme.tur === "bolunmus" && bolme.yon === "dikey" ? "cursor-row-resize" : "cursor-col-resize"
          }`}
          style={kutuStili(bolme.kutu)}
        >
          {/* Preply: görünmez 4px bölme, ortada ~24px gri tutamak. */}
          <span
            aria-hidden
            className={`rounded-full bg-slate-500 ${
              bolme.tur === "bolunmus" && bolme.yon === "dikey" ? "h-1 w-6" : "h-6 w-1"
            }`}
          />
        </div>
      )}

      {/* Kenar çubuğu + tahta: videoları gizle/göster. İki durumda AYNI öğe
          (odak kaybolmaz); yalnız konumu ve etiketi değişir. */}
      {daralt && (
        <PlainButton
          onClick={() => {
            const gizli = !daralt.gizli;
            videolarGizliHatirla(gizli);
            setVideolarGizli(gizli);
          }}
          aria-label={t(daralt.gizli ? "duzen.videolariGoster" : "duzen.videolariGizle")}
          title={t(daralt.gizli ? "duzen.videolariGoster" : "duzen.videolariGizle")}
          aria-expanded={!daralt.gizli}
          aria-controls="ders-video-alani"
          className="absolute z-20 inline-flex items-center justify-center rounded-l-lg bg-ders-yuzey text-white shadow-md hover:bg-ders-dugme focus-visible:outline focus-visible:outline-2 focus-visible:outline-marka-focus"
          style={kutuStili(daralt.kutu)}
        >
          <Icon name={daralt.gizli ? "chevronLeft" : "chevronRight"} className="h-4 w-4" />
        </PlainButton>
      )}

      {menu && (
        <div
          ref={menuRef}
          role="menu"
          tabIndex={-1}
          data-duzen-menusu
          aria-label={t("duzen.secenekler")}
          onKeyDown={menuTusu}
          className="absolute z-30 w-56 overflow-y-auto rounded-lg bg-white py-1 text-slate-900 shadow-xl"
          style={{
            right: menu.sag,
            top: menu.ust ?? undefined,
            bottom: menu.alt ?? undefined,
            maxHeight: Math.max(120, menu.enCok),
          }}
        >
          {secenekler.length > 0 && (
            <div role="group" aria-labelledby="duzen-menu-gorunum">
              <p id="duzen-menu-gorunum" aria-hidden className={bolumBasligi}>
                {t("duzen.gorunum")}
              </p>
              {secenekler.map((g) => (
                <PlainButton
                  key={g}
                  role="menuitemradio"
                  aria-checked={g === gorunum}
                  tabIndex={-1}
                  onClick={() => gorunumSecildi(g)}
                  className={menuOgesi}
                >
                  <Icon name={GORUNUM_IKONU[g]} className="h-5 w-5" />
                  <span className="flex-1">{t(`duzen.${g}`)}</span>
                  {g === gorunum && <Icon name="checkmark" className="h-5 w-5" />}
                </PlainButton>
              ))}
            </div>
          )}
          {kutuBolumu && (
            <div
              role="group"
              aria-labelledby="duzen-menu-boyut"
              className={secenekler.length > 0 ? "border-t border-slate-200" : ""}
            >
              <p id="duzen-menu-boyut" aria-hidden className={bolumBasligi}>
                {t("duzen.boyut")}
              </p>
              {BOYUTLAR.map((b) => (
                <PlainButton
                  key={b}
                  role="menuitemradio"
                  aria-checked={b === boyut}
                  tabIndex={-1}
                  onClick={() => {
                    boyutAyarla(b);
                    menuyuKapat("tetik");
                  }}
                  className={menuOgesi}
                >
                  <span className="w-5" aria-hidden />
                  <span className="flex-1">{t(BOYUT_ETIKETI[b])}</span>
                  {b === boyut && <Icon name="checkmark" className="h-5 w-5" />}
                </PlainButton>
              ))}
              <PlainButton
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  kucukAyarla(true);
                  menuyuKapat("hap");
                }}
                className={menuOgesi}
              >
                <Icon name="subtract" className="h-5 w-5" />
                <span className="flex-1">{t("duzen.kucult")}</span>
              </PlainButton>
            </div>
          )}
          {kendiBolumu && (
            <div
              role="group"
              aria-label={t("settings.video.selfView.heading")}
              className={secenekler.length > 0 || kutuBolumu ? "border-t border-slate-200" : ""}
            >
              <PlainButton
                role="menuitemcheckbox"
                aria-checked={kendiGizli}
                tabIndex={-1}
                onClick={() => {
                  const gizle = !kendiGizli;
                  kendiGizliAyarla(gizle);
                  // Kendi karonun menüsünden gizlenince o karo ekrandan kalkar.
                  menuyuKapat(gizle && menu.hangi === "ben" ? "karsi" : "tetik");
                }}
                className={menuOgesi}
              >
                <Icon name="videoOff" className="h-5 w-5" />
                <span className="flex-1">{t("duzen.kendiGizle")}</span>
                {kendiGizli && <Icon name="checkmark" className="h-5 w-5" />}
              </PlainButton>
            </div>
          )}
        </div>
      )}

      {children}
    </div>
  );
}
