/** Ürün görseli hover zoom (Amazon tarzı) — saf geometri.
 *
 * Görsel `object-contain` ile kutuya sığdırılır (letterbox olabilir); lens yalnız
 * ÇİZİLEN görselin üzerinde gezer, panel lens bölgesini `zoom` katı büyütür.
 * Tüm koordinatlar viewport (getBoundingClientRect) uzayındadır; lens çıktısı
 * hero kutusuna (boxLeft/boxTop) görelidir.
 */

export interface ZoomInput {
  cursorX: number;
  cursorY: number;
  /** <img> elementinin kutusu (object-contain'li — çizilen alan içinden hesaplanır). */
  imgLeft: number;
  imgTop: number;
  imgWidth: number;
  imgHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  /** Lens konumunun göreli olduğu hero kutusu. */
  boxLeft: number;
  boxTop: number;
  /** Zoom panelinin piksel boyutu. */
  panelWidth: number;
  panelHeight: number;
  zoom: number;
}

export interface ZoomState {
  lensLeft: number;
  lensTop: number;
  lensWidth: number;
  lensHeight: number;
  /** Panelde background-size / background-position değerleri (px). */
  bgWidth: number;
  bgHeight: number;
  bgX: number;
  bgY: number;
}

/** object-contain ile çizilen görselin gerçek dikdörtgeni (viewport uzayında). */
export function containedRect(i: {
  imgLeft: number;
  imgTop: number;
  imgWidth: number;
  imgHeight: number;
  naturalWidth: number;
  naturalHeight: number;
}): { left: number; top: number; width: number; height: number } {
  const nw = Math.max(1, i.naturalWidth);
  const nh = Math.max(1, i.naturalHeight);
  const scale = Math.min(i.imgWidth / nw, i.imgHeight / nh);
  const width = nw * scale;
  const height = nh * scale;
  return {
    left: i.imgLeft + (i.imgWidth - width) / 2,
    top: i.imgTop + (i.imgHeight - height) / 2,
    width,
    height,
  };
}

/** İmleç çizilen görselin dışındaysa null (zoom kapanır). */
export function computeZoom(i: ZoomInput): ZoomState | null {
  if (i.zoom <= 0 || i.panelWidth <= 0 || i.panelHeight <= 0) return null;
  const r = containedRect(i);
  if (r.width <= 0 || r.height <= 0) return null;
  if (
    i.cursorX < r.left ||
    i.cursorX > r.left + r.width ||
    i.cursorY < r.top ||
    i.cursorY > r.top + r.height
  ) {
    return null;
  }

  const lensWidth = Math.min(r.width, i.panelWidth / i.zoom);
  const lensHeight = Math.min(r.height, i.panelHeight / i.zoom);

  // Lensi imlece ortala ama görselin dışına taşırma.
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const lensX = clamp(i.cursorX - lensWidth / 2, r.left, r.left + r.width - lensWidth);
  const lensY = clamp(i.cursorY - lensHeight / 2, r.top, r.top + r.height - lensHeight);

  return {
    lensLeft: lensX - i.boxLeft,
    lensTop: lensY - i.boxTop,
    lensWidth,
    lensHeight,
    bgWidth: r.width * i.zoom,
    bgHeight: r.height * i.zoom,
    bgX: -((lensX - r.left) * i.zoom),
    bgY: -((lensY - r.top) * i.zoom),
  };
}
