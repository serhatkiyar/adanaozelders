import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ALT_KENAR_PX, CUBUK_GIZLEME_MS, useCubukGizleme } from "./cubukGizleme";

/** jsdom'da PointerEvent olmayabilir: MouseEvent + `pointerType`. */
function isaretci(tur: string, p: { y?: number; pointerType?: string; hedef?: Element }) {
  const e = new MouseEvent(tur, { bubbles: true, clientY: p.y ?? 0 });
  Object.defineProperty(e, "pointerType", { value: p.pointerType ?? "mouse" });
  (p.hedef ?? document.body).dispatchEvent(e);
}

describe("useCubukGizleme", () => {
  let kap: HTMLDivElement;
  let dugme: HTMLButtonElement;
  beforeEach(() => {
    vi.useFakeTimers();
    kap = document.createElement("div");
    dugme = document.createElement("button");
    kap.appendChild(dugme);
    document.body.appendChild(kap);
  });
  afterEach(() => {
    vi.useRealTimers();
    kap.remove();
  });

  const kur = (aktif = true) => {
    const ref = { current: kap };
    return renderHook(({ a }) => useCubukGizleme(a, ref), { initialProps: { a: aktif } });
  };

  it("odak dışında hiç gizlenmez", () => {
    const { result } = kur(false);
    act(() => vi.advanceTimersByTime(CUBUK_GIZLEME_MS * 2));
    expect(result.current).toBe(false);
  });

  it("3 sn sonra gizlenir; alt kenara gelen fare geri getirir", () => {
    const { result } = kur();
    act(() => vi.advanceTimersByTime(CUBUK_GIZLEME_MS));
    expect(result.current).toBe(true);
    // Sahnenin ortasındaki hareket (tahtaya çizim) getirmez.
    act(() => isaretci("pointermove", { y: 100 }));
    expect(result.current).toBe(true);
    act(() => isaretci("pointermove", { y: window.innerHeight - ALT_KENAR_PX + 1 }));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(CUBUK_GIZLEME_MS));
    expect(result.current).toBe(true);
  });

  it("dokunma geri getirir; tahtadaki dokunuş (çizim) yalnız alt kenarda", () => {
    const tahta = document.createElement("div");
    tahta.setAttribute("data-tahta-alani", "");
    document.body.appendChild(tahta);
    const { result } = kur();
    act(() => vi.advanceTimersByTime(CUBUK_GIZLEME_MS));
    act(() => isaretci("pointerdown", { y: 100, pointerType: "touch", hedef: tahta }));
    expect(result.current).toBe(true);
    act(() => isaretci("pointerdown", { y: window.innerHeight - 4, pointerType: "touch", hedef: tahta }));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(CUBUK_GIZLEME_MS));
    act(() => isaretci("pointerdown", { y: 100, pointerType: "touch" }));
    expect(result.current).toBe(false);
    tahta.remove();
  });

  it("data-cubugu-acmaz öğesine dokunmak çubuğu açmaz (alt kenarda da)", () => {
    const arac = document.createElement("div");
    arac.setAttribute("data-cubugu-acmaz", "");
    const ic = document.createElement("button");
    arac.appendChild(ic);
    document.body.appendChild(arac);
    const { result } = kur();
    act(() => vi.advanceTimersByTime(CUBUK_GIZLEME_MS));
    act(() => isaretci("pointerdown", { y: window.innerHeight - 4, pointerType: "touch", hedef: ic }));
    expect(result.current).toBe(true);
    arac.remove();
  });

  it("çubukta açık menü varken gizlenmez", () => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "dialog");
    kap.appendChild(menu);
    const { result } = kur();
    act(() => vi.advanceTimersByTime(CUBUK_GIZLEME_MS * 2));
    expect(result.current).toBe(false);
    menu.remove();
    act(() => vi.advanceTimersByTime(CUBUK_GIZLEME_MS));
    expect(result.current).toBe(true);
  });

  it("klavye odağı çubuktayken gizlenmez; odak çıkınca süre yeniden başlar", () => {
    const { result } = kur();
    act(() => vi.advanceTimersByTime(CUBUK_GIZLEME_MS));
    expect(result.current).toBe(true);
    act(() => dugme.focus());
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(CUBUK_GIZLEME_MS * 3));
    expect(result.current).toBe(false);
    act(() => dugme.blur());
    act(() => vi.advanceTimersByTime(CUBUK_GIZLEME_MS));
    expect(result.current).toBe(true);
  });

  it("fare çubuğun üstündeyken gizlenmez", () => {
    const { result } = kur();
    act(() => isaretci("pointermove", { y: 10, hedef: dugme }));
    act(() => vi.advanceTimersByTime(CUBUK_GIZLEME_MS * 2));
    expect(result.current).toBe(false);
  });
});
