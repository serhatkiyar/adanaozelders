// Grafik çizici için saf yardımcılar (canvas'tan bağımsız, test edilebilir).

export interface Viewport {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

// "Güzel" ızgara adımı: 1, 2, 5 × 10ⁿ.
export function niceTickStep(range: number, targetTicks = 10): number {
  if (range <= 0 || !Number.isFinite(range)) return 1;
  const raw = range / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step: number;
  if (norm < 1.5) step = 1;
  else if (norm < 3) step = 2;
  else if (norm < 7) step = 5;
  else step = 10;
  return step * mag;
}

// Eksen etiketi — adıma göre gerektiği kadar ondalık, "-0" temizlenir.
export function formatTick(v: number, step: number): string {
  const decimals = step < 1 ? Math.min(6, Math.ceil(-Math.log10(step))) : 0;
  let s = v.toFixed(decimals);
  if (s === "-0" || /^-0\.0+$/.test(s)) s = s.slice(1);
  return s;
}

// Dünya (matematik) ↔ ekran (piksel) dönüşümleri. Ekranda y aşağı doğru artar.
export function worldToScreenX(x: number, v: Viewport, width: number): number {
  return ((x - v.xMin) / (v.xMax - v.xMin)) * width;
}
export function worldToScreenY(y: number, v: Viewport, height: number): number {
  return height - ((y - v.yMin) / (v.yMax - v.yMin)) * height;
}
export function screenToWorldX(px: number, v: Viewport, width: number): number {
  return v.xMin + (px / width) * (v.xMax - v.xMin);
}
export function screenToWorldY(py: number, v: Viewport, height: number): number {
  return v.yMin + ((height - py) / height) * (v.yMax - v.yMin);
}

// Bir aralıkta kökler (f(x)=0). İşaret değişimi + bisection ile bulunur.
export function findRoots(
  fn: (x: number) => number,
  xMin: number,
  xMax: number,
  samples = 1000
): number[] {
  const roots: number[] = [];
  const dx = (xMax - xMin) / samples;
  let prevX = xMin;
  let prevY = fn(xMin);
  const push = (r: number) => {
    if (roots.length === 0 || Math.abs(roots[roots.length - 1] - r) > dx * 0.5) {
      roots.push(r);
    }
  };
  for (let i = 1; i <= samples; i++) {
    const x = xMin + i * dx;
    const y = fn(x);
    if (Number.isFinite(prevY) && Number.isFinite(y)) {
      if (prevY === 0) push(prevX);
      else if (prevY * y < 0) push(bisect(fn, prevX, x));
    }
    prevX = x;
    prevY = y;
  }
  return roots;
}

function bisect(
  fn: (x: number) => number,
  a: number,
  b: number,
  iters = 50
): number {
  let fa = fn(a);
  for (let i = 0; i < iters; i++) {
    const m = (a + b) / 2;
    const fm = fn(m);
    if (fm === 0 || !Number.isFinite(fm)) return m;
    if (fa * fm < 0) {
      b = m;
    } else {
      a = m;
      fa = fm;
    }
  }
  return (a + b) / 2;
}
