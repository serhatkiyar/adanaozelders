import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGecikmeliKapanis } from "./useGecikmeliKapanis";

describe("useGecikmeliKapanis", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("gösterme anında, gizleme gecikmeli yansır", () => {
    const { result, rerender } = renderHook(({ d }) => useGecikmeliKapanis(d, 1000), {
      initialProps: { d: true },
    });
    rerender({ d: false });
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(999));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
    rerender({ d: true });
    expect(result.current).toBe(true);
  });

  it("süre dolmadan yeniden açılırsa hiç kapanmaz", () => {
    const { result, rerender } = renderHook(({ d }) => useGecikmeliKapanis(d, 1000), {
      initialProps: { d: true },
    });
    rerender({ d: false });
    act(() => vi.advanceTimersByTime(600));
    rerender({ d: true });
    act(() => vi.advanceTimersByTime(0));
    rerender({ d: false });
    act(() => vi.advanceTimersByTime(600));
    expect(result.current).toBe(true);
  });
});
