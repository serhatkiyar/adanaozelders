/**
 * Sınıf sahnesi — Preply düzeni (spesifikasyon `preply-sinif-tahta-duzen.md`
 * §2, §3, §6): görünüm kararı, panel oranları, yüzen kutu, bölmeler ve karo
 * üstündeki "Düzeni değiştir" menüsü. Dikdörtgenler `lib/sinifDuzeni.ts`te
 * saf olarak hesaplanır; bu bileşen yalnız ölçer, durumu tutar ve çizer.
 *
 * - Görünüm seçimi sekmede hatırlanır (sessionStorage, Preply anahtarları);
 *   sürüklenen kutunun konumu ve bölme oranları hatırlanMAZ: düzen
 *   değişince varsayılana döner (Preply §6).
 * - Hiçbir geçişte animasyon yok.
 * - Video kapları (`ZoomVideoSahnesi`) ve tahta (`TahtaAlani`) aynı
 *   ebeveynde kalır; tahta açılıp kapanınca görüşme yeniden bağlanmaz.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { Icon, type IconName } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";
import {
  KUCUK_EKRAN_PX,
  gorunumSec,
  gorunumuHatirla,
  kaymayiSinirla,
  secilebilirGorunumler,
  sonAracOku,
  sonVideoOku,
  yerlesimHesapla,
  type AracGorunumu,
  type Gorunum,
  type Kutu,
  type Nokta,
  type VideoGorunumu,
} from "@/lib/sinifDuzeni";

import { useKarsiTaraf, usePaylasimVar } from "../zoom/odaDeposu";
import { ZoomVideoSahnesi } from "./ZoomVideoSahnesi";

const GORUNUM_IKONU: Record<Gorunum, IconName> = {
  SPOTLIGHT: "rectangleLandscape",
  GRID: "splitVertical",
  SIDEBAR: "panelRight",
  CORNER: "pictureInPicture",
};

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
  tahta,
  children,
}: {
  telefon: boolean;
  ogretmen: boolean;
  tahtaAcik: boolean;
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
  const [yanPanelPx, setYanPanelPx] = useState<number | null>(null);
  const [bolunmusOran, setBolunmusOran] = useState<number | null>(null);
  const [surukleme, setSurukleme] = useState<Nokta>({ x: 0, y: 0 });
  const [menu, setMenu] = useState<{ sag: number; ust: number } | null>(null);

  const kucukEkran = pencere.w < KUCUK_EKRAN_PX;
  const gorunum = gorunumSec({
    paylasim,
    aracAcik: tahtaAcik,
    mobilKucuk: telefon && kucukEkran,
    sonVideo,
    sonArac,
  });

  // Düzen değişince sürükleme ve bölmeler varsayılana döner (Preply §6).
  const imza = `${gorunum}|${paylasim}|${tahtaAcik}`;
  const [sonImza, setSonImza] = useState(imza);
  if (imza !== sonImza) {
    setSonImza(imza);
    setSurukleme({ x: 0, y: 0 });
    setYanPanelPx(null);
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
        yanPanelPx,
        bolunmusOran,
        surukleme,
      }),
    [olcu, gorunum, paylasim, tahtaAcik, karsiTarafVar, telefon, pencere, ogretmen, kucukEkran, yanPanelPx, bolunmusOran, surukleme],
  );
  const yRef = useRef(y);
  yRef.current = y;

  /* Yüzen kutu / araçsız kendi karon: sürükle (sınır tüm sahne). */
  const surukleBasla = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if ((e.target as HTMLElement).closest("button")) return;
      if (e.button !== 0) return;
      const siniri = yRef.current.suruklemeSiniri;
      if (!siniri) return;
      e.preventDefault();
      const hedef = e.currentTarget;
      hedef.setPointerCapture(e.pointerId);
      const bas = { x: e.clientX, y: e.clientY };
      const ilk = kaymayiSinirla(surukleme, siniri);
      const hareket = (h: PointerEvent) => {
        const s = yRef.current.suruklemeSiniri ?? siniri;
        setSurukleme(kaymayiSinirla({ x: ilk.x + h.clientX - bas.x, y: ilk.y + h.clientY - bas.y }, s));
      };
      const birak = () => {
        hedef.removeEventListener("pointermove", hareket);
        hedef.removeEventListener("pointerup", birak);
        hedef.removeEventListener("pointercancel", birak);
      };
      hedef.addEventListener("pointermove", hareket);
      hedef.addEventListener("pointerup", birak);
      hedef.addEventListener("pointercancel", birak);
    },
    [surukleme],
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
        setYanPanelPx(Math.round(r.left + g.x + g.w - h.clientX));
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
  const gorunumSecildi = (g: Gorunum) => {
    gorunumuHatirla(g);
    if (g === "SPOTLIGHT" || g === "GRID") setSonVideo(g);
    else setSonArac(g);
    setMenu(null);
  };

  const karoUstu =
    telefon || secenekler.length === 0
      ? undefined
      : (hangi: "ben" | "karsi") => (
          <PlainButton
            onClick={(e) => {
              const kutu = hangi === "ben" ? yRef.current.benKaro : yRef.current.karsiKaro;
              const el = sahne.current;
              if (!kutu || !el) return;
              e.stopPropagation();
              setMenu((m) =>
                m ? null : { sag: Math.max(0, olcu.w - (kutu.x + kutu.w)), ust: kutu.y + 48 },
              );
            }}
            aria-label={t("duzen.degistir")}
            title={t("duzen.degistir")}
            aria-haspopup="menu"
            aria-expanded={menu !== null}
            className="inline-flex h-10 w-10 items-center justify-center rounded-ders bg-black/60 text-white hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marka-focus"
          >
            <Icon name="grid" className="h-5 w-5" />
          </PlainButton>
        );

  useEffect(() => {
    if (!menu) return;
    const kapat = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest("[data-duzen-menusu]")) setMenu(null);
    };
    const tus = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("pointerdown", kapat, true);
    document.addEventListener("keydown", tus);
    return () => {
      document.removeEventListener("pointerdown", kapat, true);
      document.removeEventListener("keydown", tus);
    };
  }, [menu]);

  const bolme = y.bolme;

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

      <ZoomVideoSahnesi
        telefon={telefon}
        yerlesim={y}
        karoUstu={karoUstu}
        onSurukleBasla={surukleBasla}
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
            if (bolme.tur === "yanPanel") setYanPanelPx(bolme.deger - adim * 16);
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

      {menu && (
        <div
          role="menu"
          data-duzen-menusu
          aria-label={t("duzen.degistir")}
          className="absolute z-30 w-56 overflow-hidden rounded-lg bg-white text-slate-900 shadow-xl"
          style={{ right: menu.sag, top: menu.ust }}
        >
          {secenekler.map((g, i) => (
            <PlainButton
              key={g}
              role="menuitemradio"
              aria-checked={g === gorunum}
              onClick={() => gorunumSecildi(g)}
              className={`flex h-14 w-full items-center gap-3 px-4 text-left text-[15px] font-medium hover:bg-slate-50 ${
                i > 0 ? "border-t border-slate-200" : ""
              }`}
            >
              <Icon name={GORUNUM_IKONU[g]} className="h-5 w-5" />
              <span className="flex-1">{t(`duzen.${g}`)}</span>
              {g === gorunum && <Icon name="checkmark" className="h-5 w-5" />}
            </PlainButton>
          ))}
        </div>
      )}

      {children}
    </div>
  );
}
