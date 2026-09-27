/**
 * Karşı tarafın ekran paylaşımında yakınlaştırma — La Suite Meet
 * `ScreenShareZoomableVideo` + `ScreenShareZoomControls` +
 * `useScreenShareZoom` (MIT — DINUM/Etalab) uyarlaması, sağlayıcıdan bağımsız.
 *
 * - Oyuncu kabı TAŞINMAZ: sürücünün medya katmanı paylaşım oyuncusunu bir
 *   dönüşüm sarmalayıcısına koyar (`MedyaKatmaniProps.paylasimDonusumKabi`);
 *   burası o sarmalayıcıya `scale()/translate()` uygular (çizim yok, React
 *   yeniden çizimi yok).
 * - 1–4×; yakınken sürükleyerek kaydırma, Ctrl + tekerlek (imleç altında),
 *   yüzeye odaklanınca ok tuşları ve +/−/0. "Pencereye sığdır" 1×'e döner.
 * - Yüzey `touch-action: pinch-zoom`: dokunmatikte tarayıcının iki parmak
 *   yakınlaştırması açık kalır, tek parmak kaydırır.
 * - Araç çubuğu altta ortada: köşeler yüzen kamera kutusunun. Odakta
 *   kontrol çubuğu görünürken onun üstüne çıkar; çubuğa dokunmak kontrol
 *   çubuğunu açmaz (`data-cubugu-acmaz`).
 * - Telefon dikeyken bir kez "yan çevir" ipucu.
 *
 * Paylaşan değişince bileşen `key` ile yeniden kurulur (1×'ten başlar);
 * kalkınca dönüşüm temizlenir.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";
import {
  EN_AZ_YAKINLIK,
  EN_COK_YAKINLIK,
  KAYDIRMA_ADIMI,
  TAM_ORAN,
  TEKERLEK_HIZI,
  YAKINLIK_ADIMI,
  donusum,
  imlecteYakinlastir,
  imlecYuzdesi,
  kaydir,
  kaymaSinirla,
  resimOrani,
  yakinlikSinirla,
  type Kayma,
  type ResimOrani,
} from "@/lib/paylasimYakinlastirma";
import type { Kutu } from "@/lib/sinifDuzeni";

import { yer } from "../../video/yer";

const ARAC_DUGMESI =
  "inline-flex h-9 w-9 items-center justify-center rounded-full text-white hover:bg-white/15 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marka-focus";

/** Telefon dikey mi (yan çevir ipucu için). */
function useDikey(): boolean {
  const sorgu = "(orientation: portrait)";
  const [dikey, setDikey] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia(sorgu).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(sorgu);
    const degisti = () => setDikey(mq.matches);
    mq.addEventListener?.("change", degisti);
    return () => mq.removeEventListener?.("change", degisti);
  }, []);
  return dikey;
}

/** Ders boyunca bir kez kapatılır (modül düzeyi; sayfa yenilenince sıfır). */
let yanCevirKapatildi = false;

export function PaylasimYakinlastirma({
  kutu,
  donusumOgesi,
  telefon,
}: {
  /** Paylaşım görüntü alanı (başlığın altı), sahneye göre. */
  kutu: Kutu;
  /** Sürücünün dönüşüm sarmalayıcısı. */
  donusumOgesi: RefObject<HTMLElement | null>;
  telefon: boolean;
}) {
  const { t } = useTranslation();
  const yuzey = useRef<HTMLDivElement>(null);
  const yakinlik = useRef(EN_AZ_YAKINLIK);
  const kayma = useRef<Kayma>({ x: 0, y: 0 });
  const [duzey, setDuzey] = useState(EN_AZ_YAKINLIK);
  const [surukleniyor, setSurukleniyor] = useState(false);
  const dikey = useDikey();
  const [ipucuKapali, setIpucuKapali] = useState(yanCevirKapatildi);

  const uygula = useCallback(() => {
    const el = donusumOgesi.current;
    if (!el) return;
    const z = yakinlik.current;
    el.style.transformOrigin = "center center";
    el.style.transform = z <= EN_AZ_YAKINLIK ? "" : donusum(z, kayma.current);
  }, [donusumOgesi]);

  // Kalkınca (paylaşım bitti / kendi paylaşımım) dönüşüm temizlenir.
  useEffect(() => {
    const el = donusumOgesi.current;
    return () => {
      if (el) el.style.transform = "";
    };
  }, [donusumOgesi]);

  /** `contain` boşlukları: resmin yüzeyi kapladığı oran (okunamazsa tam). */
  const oran = useCallback((): ResimOrani => {
    const y = yuzey.current;
    const v = donusumOgesi.current?.querySelector("video");
    if (!y || !v) return TAM_ORAN;
    return resimOrani(y.clientWidth, y.clientHeight, v.videoWidth, v.videoHeight);
  }, [donusumOgesi]);

  const yakinlikAyarla = useCallback(
    (z: number) => {
      const yeni = yakinlikSinirla(z);
      yakinlik.current = yeni;
      kayma.current = yeni <= EN_AZ_YAKINLIK ? { x: 0, y: 0 } : kaymaSinirla(kayma.current, yeni, oran());
      uygula();
      setDuzey(yeni);
    },
    [oran, uygula],
  );

  const kaydirPx = useCallback(
    (dx: number, dy: number) => {
      const y = yuzey.current;
      if (!y || yakinlik.current <= EN_AZ_YAKINLIK) return;
      kayma.current = kaydir(
        kayma.current,
        dx,
        dy,
        { w: y.clientWidth, h: y.clientHeight },
        yakinlik.current,
        oran(),
      );
      uygula();
    },
    [oran, uygula],
  );

  // Ctrl/⌘ + tekerlek yakınlaştırır (tarayıcı sayfa yakınlaştırması yerine);
  // yakınken iki parmak kaydırma resmi kaydırır. `passive: false` gerekli.
  useEffect(() => {
    const y = yuzey.current;
    if (!y) return;
    const tekerlek = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const onceki = yakinlik.current;
        const sonraki = yakinlikSinirla(onceki - e.deltaY * TEKERLEK_HIZI);
        if (sonraki <= EN_AZ_YAKINLIK) {
          yakinlikAyarla(EN_AZ_YAKINLIK);
          return;
        }
        kayma.current = imlecteYakinlastir({
          kayma: kayma.current,
          onceki,
          sonraki,
          imlec: imlecYuzdesi(e.clientX, e.clientY, y.getBoundingClientRect()),
          oran: oran(),
        });
        yakinlik.current = sonraki;
        uygula();
        setDuzey(sonraki);
        return;
      }
      if (yakinlik.current <= EN_AZ_YAKINLIK) return;
      e.preventDefault();
      kaydirPx(-e.deltaX, -e.deltaY);
    };
    y.addEventListener("wheel", tekerlek, { passive: false });
    return () => y.removeEventListener("wheel", tekerlek);
  }, [oran, uygula, kaydirPx, yakinlikAyarla]);

  const surukleBasla = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || yakinlik.current <= EN_AZ_YAKINLIK) return;
    const hedef = e.currentTarget;
    hedef.setPointerCapture(e.pointerId);
    setSurukleniyor(true);
    let son = { x: e.clientX, y: e.clientY };
    const hareket = (h: PointerEvent) => {
      kaydirPx(h.clientX - son.x, h.clientY - son.y);
      son = { x: h.clientX, y: h.clientY };
    };
    const birak = () => {
      hedef.removeEventListener("pointermove", hareket);
      hedef.removeEventListener("pointerup", birak);
      hedef.removeEventListener("pointercancel", birak);
      setSurukleniyor(false);
    };
    hedef.addEventListener("pointermove", hareket);
    hedef.addEventListener("pointerup", birak);
    hedef.addEventListener("pointercancel", birak);
  };

  /** Yüzey odaktayken: oklar kaydırır, +/−/0 yakınlaştırır. */
  const tus = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const y = yuzey.current;
    if (!y) return;
    const adimX = (KAYDIRMA_ADIMI / 100) * y.clientWidth * yakinlik.current;
    const adimY = (KAYDIRMA_ADIMI / 100) * y.clientHeight * yakinlik.current;
    const yakin = yakinlik.current > EN_AZ_YAKINLIK;
    let islendi = true;
    if (e.key === "+" || e.key === "=") yakinlikAyarla(yakinlik.current + YAKINLIK_ADIMI);
    else if (e.key === "-" && yakin) yakinlikAyarla(yakinlik.current - YAKINLIK_ADIMI);
    else if (e.key === "0" && yakin) yakinlikAyarla(EN_AZ_YAKINLIK);
    else if (e.key === "ArrowLeft" && yakin) kaydirPx(adimX, 0);
    else if (e.key === "ArrowRight" && yakin) kaydirPx(-adimX, 0);
    else if (e.key === "ArrowUp" && yakin) kaydirPx(0, adimY);
    else if (e.key === "ArrowDown" && yakin) kaydirPx(0, -adimY);
    else islendi = false;
    if (islendi) e.preventDefault();
  };

  // 1×'e dönünce "Sığdır"/"Uzaklaştır" kalkar: odak "Yakınlaştır"a geçer.
  const yakinlastirDugmesi = useRef<HTMLButtonElement>(null);
  const kucultVeOdakla = (z: number) => {
    yakinlikAyarla(z);
    if (yakinlik.current <= EN_AZ_YAKINLIK) {
      requestAnimationFrame(() => yakinlastirDugmesi.current?.focus());
    }
  };

  const yakin = duzey > EN_AZ_YAKINLIK;
  const yuzde = Math.round(duzey * 100);
  const ipucu = telefon && dikey && !ipucuKapali;

  return (
    <>
      {/* Odaklanabilir yüzey: klavye kaydırma ve yakınlaştırma burada. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={yuzey}
        role="region"
        tabIndex={0}
        aria-label={t("yakinlastirma.yuzey")}
        onPointerDown={surukleBasla}
        onKeyDown={tus}
        className="pointer-events-auto absolute touch-pinch-zoom select-none outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-marka-focus"
        style={{ ...yer(kutu), cursor: yakin ? (surukleniyor ? "grabbing" : "grab") : "default" }}
      />
      {ipucu && (
        <div
          className="pointer-events-auto absolute flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 py-1 pl-3 pr-1 text-sm text-white"
          style={{ left: kutu.x + kutu.w / 2, top: kutu.y + 8 }}
        >
          <span>{t("yakinlastirma.yanCevir")}</span>
          <PlainButton
            onClick={() => {
              yanCevirKapatildi = true;
              setIpucuKapali(true);
            }}
            aria-label={t("yakinlastirma.yanCevirKapat")}
            className={ARAC_DUGMESI}
          >
            <Icon name="dismiss" className="h-4 w-4" />
          </PlainButton>
        </div>
      )}
      <div
        role="toolbar"
        aria-label={t("yakinlastirma.arac")}
        data-cubugu-acmaz
        className="pointer-events-auto absolute flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-black/60 p-1 text-white opacity-80 hover:opacity-100 focus-within:opacity-100"
        style={{
          left: kutu.x + kutu.w / 2,
          // Odakta görünen kontrol çubuğu (`--cubuk-pay`, CanliOda) altı örter.
          top: `calc(${kutu.y + kutu.h - 12 - 44}px - var(--cubuk-pay, 0px))`,
        }}
      >
        <span className="sr-only">{t("yakinlastirma.kisayol")}</span>
        {yakin && (
          <>
            <PlainButton
              onClick={() => kucultVeOdakla(EN_AZ_YAKINLIK)}
              aria-label={t("yakinlastirma.sigdir")}
              title={t("yakinlastirma.sigdir")}
              className={ARAC_DUGMESI}
            >
              <Icon name="zoomFit" className="h-5 w-5" />
            </PlainButton>
            <PlainButton
              onClick={() => kucultVeOdakla(duzey - YAKINLIK_ADIMI)}
              aria-label={t("yakinlastirma.uzaklastir")}
              title={t("yakinlastirma.uzaklastir")}
              className={ARAC_DUGMESI}
            >
              <Icon name="zoomOut" className="h-5 w-5" />
            </PlainButton>
            <span aria-hidden className="min-w-[3.25rem] select-none text-center text-[13px] font-medium">
              %{yuzde}
            </span>
          </>
        )}
        <PlainButton
          ref={yakinlastirDugmesi}
          onClick={() => yakinlikAyarla(duzey + YAKINLIK_ADIMI)}
          disabled={duzey >= EN_COK_YAKINLIK}
          aria-label={t("yakinlastirma.yakinlastir")}
          title={t("yakinlastirma.yakinlastir")}
          className={ARAC_DUGMESI}
        >
          <Icon name="zoomIn" className="h-5 w-5" />
        </PlainButton>
        {/* Düzey değişimi ekran okuyucuya duyurulur (görsel yüzde gizli). */}
        <span className="sr-only" aria-live="polite">
          {yakin ? t("yakinlastirma.duzey", { duzey: yuzde }) : ""}
        </span>
      </div>
    </>
  );
}
