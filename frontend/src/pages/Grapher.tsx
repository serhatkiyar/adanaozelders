import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ROLE_IDS } from "@/types";
import { useThemeStore } from "@/store/themeStore";
import { compile, type CompiledFn } from "@/lib/mathParse";
import {
  type Viewport,
  niceTickStep,
  formatTick,
  findRoots,
  worldToScreenX,
  worldToScreenY,
  screenToWorldX,
  screenToWorldY,
} from "@/lib/plotMath";

const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#0ea5e9", "#a855f7", "#ec4899"];
const DEFAULT_VIEW: Viewport = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 };
const STORAGE_KEY = "ceyhan-grapher";

interface FnRow {
  id: number;
  expr: string;
  color: string;
  visible: boolean;
}

interface Persisted {
  functions: FnRow[];
  view: Viewport;
}

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Persisted;
      if (Array.isArray(p.functions) && p.view) return p;
    }
  } catch {
    /* yoksay */
  }
  return {
    functions: [{ id: 1, expr: "x^2", color: PALETTE[0], visible: true }],
    view: DEFAULT_VIEW,
  };
}

interface Theme {
  bg: string;
  grid: string;
  axis: string;
  tick: string;
  cross: string;
}
const LIGHT: Theme = { bg: "#ffffff", grid: "#eef2f7", axis: "#94a3b8", tick: "#64748b", cross: "#94a3b8" };
const DARK: Theme = { bg: "#0f172a", grid: "#1e293b", axis: "#475569", tick: "#94a3b8", cross: "#64748b" };

export default function Grapher() {
  const { data: user } = useCurrentUser();
  const navItems = user?.role_id === ROLE_IDS.TUTOR ? TUTOR_NAV : STUDENT_NAV;
  const theme = useThemeStore((s) => s.theme);

  const initial = useRef(loadPersisted());
  const [functions, setFunctions] = useState<FnRow[]>(initial.current.functions);
  const [view, setView] = useState<Viewport>(initial.current.view);
  const [showRoots, setShowRoots] = useState(false);
  const [cursor, setCursor] = useState<{ px: number; py: number } | null>(null);

  const nextId = useRef(
    Math.max(0, ...initial.current.functions.map((f) => f.id)) + 1
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ px: number; py: number } | null>(null);

  // İfadeleri derle (hata → satırda gösterilecek mesaj).
  const compiled = useMemo(
    () =>
      functions.map((f) => {
        try {
          return { fn: compile(f.expr) as CompiledFn, error: null as string | null };
        } catch (e) {
          return { fn: null as CompiledFn | null, error: (e as Error).message };
        }
      }),
    [functions]
  );

  // Kalıcılık
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ functions, view }));
    } catch {
      /* yoksay */
    }
  }, [functions, view]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const palette = theme === "dark" ? DARK : LIGHT;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW === 0 || cssH === 0) return;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Arka plan (opak → PNG şeffaf olmaz)
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, cssW, cssH);

    const stepX = niceTickStep(view.xMax - view.xMin, Math.max(6, cssW / 90));
    const stepY = niceTickStep(view.yMax - view.yMin, Math.max(6, cssH / 70));

    // Izgara
    ctx.lineWidth = 1;
    ctx.strokeStyle = palette.grid;
    ctx.beginPath();
    for (let gx = Math.ceil(view.xMin / stepX) * stepX; gx <= view.xMax; gx += stepX) {
      const sx = Math.round(worldToScreenX(gx, view, cssW)) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, cssH);
    }
    for (let gy = Math.ceil(view.yMin / stepY) * stepY; gy <= view.yMax; gy += stepY) {
      const sy = Math.round(worldToScreenY(gy, view, cssH)) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(cssW, sy);
    }
    ctx.stroke();

    // Eksenler
    const x0 = worldToScreenX(0, view, cssW);
    const y0 = worldToScreenY(0, view, cssH);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = palette.axis;
    ctx.beginPath();
    if (y0 >= 0 && y0 <= cssH) {
      ctx.moveTo(0, y0);
      ctx.lineTo(cssW, y0);
    }
    if (x0 >= 0 && x0 <= cssW) {
      ctx.moveTo(x0, 0);
      ctx.lineTo(x0, cssH);
    }
    ctx.stroke();

    // Tik etiketleri
    ctx.fillStyle = palette.tick;
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    const labelY = Math.min(Math.max(y0, 12), cssH - 4);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let gx = Math.ceil(view.xMin / stepX) * stepX; gx <= view.xMax; gx += stepX) {
      if (Math.abs(gx) < stepX / 1000) continue; // 0'ı atla
      const sx = worldToScreenX(gx, view, cssW);
      ctx.fillText(formatTick(gx, stepX), sx, labelY + 3);
    }
    const labelX = Math.min(Math.max(x0, 4), cssW - 4);
    ctx.textAlign = x0 < 28 ? "left" : "right";
    ctx.textBaseline = "middle";
    for (let gy = Math.ceil(view.yMin / stepY) * stepY; gy <= view.yMax; gy += stepY) {
      if (Math.abs(gy) < stepY / 1000) continue;
      const sy = worldToScreenY(gy, view, cssH);
      ctx.fillText(formatTick(gy, stepY), labelX + (x0 < 28 ? 4 : -6), sy);
    }

    // Fonksiyonlar
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    functions.forEach((f, idx) => {
      const { fn } = compiled[idx];
      if (!fn || !f.visible) return;
      ctx.strokeStyle = f.color;
      ctx.beginPath();
      let pen = false;
      let prevSy = 0;
      for (let px = 0; px <= cssW; px++) {
        const x = screenToWorldX(px, view, cssW);
        const y = fn(x);
        if (!Number.isFinite(y)) {
          pen = false;
          continue;
        }
        const sy = worldToScreenY(y, view, cssH);
        if (!pen) {
          ctx.moveTo(px, sy);
          pen = true;
        } else if (Math.abs(sy - prevSy) > cssH * 1.5) {
          ctx.moveTo(px, sy); // asimptot kopuşu (yanlış dikey çizgi olmasın)
        } else {
          ctx.lineTo(px, sy);
        }
        prevSy = sy;
      }
      ctx.stroke();
    });

    // Kökler
    if (showRoots) {
      functions.forEach((f, idx) => {
        const { fn } = compiled[idx];
        if (!fn || !f.visible) return;
        const roots = findRoots(fn, view.xMin, view.xMax, Math.max(1000, cssW * 2));
        ctx.fillStyle = f.color;
        ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        roots.forEach((rx) => {
          const sx = worldToScreenX(rx, view, cssW);
          const sy = worldToScreenY(0, view, cssH);
          ctx.beginPath();
          ctx.arc(sx, sy, 3.5, 0, 2 * Math.PI);
          ctx.fill();
          ctx.fillText(rx.toFixed(2), sx, sy - 5);
        });
      });
    }

    // İmleç okuması
    if (cursor) {
      const wx = screenToWorldX(cursor.px, view, cssW);
      const wy = screenToWorldY(cursor.py, view, cssH);
      ctx.strokeStyle = palette.cross;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cursor.px, 0);
      ctx.lineTo(cursor.px, cssH);
      ctx.moveTo(0, cursor.py);
      ctx.lineTo(cssW, cursor.py);
      ctx.stroke();
      ctx.setLineDash([]);
      // Etiket kutusu
      const label = `(${wx.toFixed(2)}, ${wy.toFixed(2)})`;
      ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
      const w = ctx.measureText(label).width + 12;
      let bx = cursor.px + 8;
      let by = cursor.py + 8;
      if (bx + w > cssW) bx = cursor.px - w - 8;
      if (by + 22 > cssH) by = cursor.py - 26;
      ctx.fillStyle = theme === "dark" ? "rgba(15,23,42,0.9)" : "rgba(255,255,255,0.9)";
      ctx.fillRect(bx, by, w, 20);
      ctx.strokeStyle = palette.axis;
      ctx.strokeRect(bx, by, w, 20);
      ctx.fillStyle = palette.tick;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(label, bx + 6, by + 10);
    }
  }, [view, functions, compiled, showRoots, cursor, theme]);

  // Çiz + boyut değişiminde yeniden çiz
  useEffect(() => {
    draw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  // ── Etkileşim ──
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { px: e.nativeEvent.offsetX, py: e.nativeEvent.offsetY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const px = e.nativeEvent.offsetX;
    const py = e.nativeEvent.offsetY;
    setCursor({ px, py });
    const canvas = canvasRef.current;
    if (drag.current && canvas) {
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      const wpp = (view.xMax - view.xMin) / cssW;
      const hpp = (view.yMax - view.yMin) / cssH;
      const dpx = px - drag.current.px;
      const dpy = py - drag.current.py;
      setView((v) => ({
        xMin: v.xMin - dpx * wpp,
        xMax: v.xMax - dpx * wpp,
        yMin: v.yMin + dpy * hpp,
        yMax: v.yMax + dpy * hpp,
      }));
      drag.current = { px, py };
    }
  };
  const endDrag = () => {
    drag.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    const px = e.nativeEvent.offsetX;
    const py = e.nativeEvent.offsetY;
    const wx = screenToWorldX(px, view, cssW);
    const wy = screenToWorldY(py, view, cssH);
    const factor = e.deltaY < 0 ? 1 / 1.15 : 1.15;
    setView((v) => {
      const xMin = wx + (v.xMin - wx) * factor;
      const xMax = wx + (v.xMax - wx) * factor;
      const yMin = wy + (v.yMin - wy) * factor;
      const yMax = wy + (v.yMax - wy) * factor;
      const range = xMax - xMin;
      if (range < 1e-6 || range > 1e9) return v; // dejenere yakınlaşma/uzaklaşma engeli
      return { xMin, xMax, yMin, yMax };
    });
  };

  // ── Fonksiyon listesi işlemleri ──
  const updateExpr = (id: number, expr: string) =>
    setFunctions((fs) => fs.map((f) => (f.id === id ? { ...f, expr } : f)));
  const toggleVisible = (id: number) =>
    setFunctions((fs) => fs.map((f) => (f.id === id ? { ...f, visible: !f.visible } : f)));
  const removeFn = (id: number) =>
    setFunctions((fs) => (fs.length > 1 ? fs.filter((f) => f.id !== id) : fs));
  const addFn = () =>
    setFunctions((fs) => [
      ...fs,
      { id: nextId.current++, expr: "", color: PALETTE[fs.length % PALETTE.length], visible: true },
    ]);

  const downloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "grafik.png";
    a.click();
  };

  return (
    <DashboardShell title="Grafik Çizici" navItems={navItems}>
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Grafik Çizici</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Fonksiyon yaz, grafiğini gör. Sürükleyerek kaydır, tekerlekle yakınlaştır,
          görseli indir. Örn: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">x^2-3</code>,{" "}
          <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">sin(x)</code>,{" "}
          <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">2x+1</code>
        </p>

        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[320px_1fr]">
          {/* Sol panel: fonksiyonlar + kontroller */}
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Fonksiyonlar
              </h2>
              <div className="mt-3 space-y-3">
                {functions.map((f, idx) => (
                  <div key={f.id}>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleVisible(f.id)}
                        title={f.visible ? "Gizle" : "Göster"}
                        className="h-4 w-4 shrink-0 rounded-full ring-2 ring-offset-1 ring-offset-white transition dark:ring-offset-slate-800"
                        style={{
                          backgroundColor: f.visible ? f.color : "transparent",
                          // @ts-expect-error CSS değişkeni
                          "--tw-ring-color": f.color,
                        }}
                      />
                      <span className="shrink-0 text-sm font-medium text-slate-400">f(x)=</span>
                      <input
                        value={f.expr}
                        onChange={(e) => updateExpr(f.id, e.target.value)}
                        spellCheck={false}
                        placeholder="örn. x^2"
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                      />
                      <button
                        onClick={() => removeFn(f.id)}
                        disabled={functions.length <= 1}
                        title="Sil"
                        className="shrink-0 text-slate-400 transition hover:text-red-500 disabled:opacity-30"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    {f.expr.trim() && compiled[idx].error && (
                      <p className="ml-6 mt-1 text-xs text-red-500">{compiled[idx].error}</p>
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={addFn}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 py-2 text-sm font-semibold text-slate-500 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-indigo-500/50 dark:hover:text-indigo-400"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m7-7H5" />
                </svg>
                Fonksiyon ekle
              </button>
            </div>

            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
              <label className="flex cursor-pointer items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-300">Kökleri göster</span>
                <input
                  type="checkbox"
                  checked={showRoots}
                  onChange={(e) => setShowRoots(e.target.checked)}
                  className="h-4 w-4 accent-indigo-600"
                />
              </label>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setView(DEFAULT_VIEW)}
                  className="flex-1 rounded-xl bg-slate-100 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                >
                  Görünümü sıfırla
                </button>
                <button
                  onClick={downloadPng}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  PNG indir
                </button>
              </div>
            </div>
          </div>

          {/* Canvas */}
          <div className="overflow-hidden rounded-2xl shadow-sm ring-1 ring-slate-100 dark:ring-slate-700">
            <canvas
              ref={canvasRef}
              className="h-[520px] w-full touch-none cursor-crosshair select-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerLeave={() => {
                endDrag();
                setCursor(null);
              }}
              onWheel={onWheel}
            />
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
