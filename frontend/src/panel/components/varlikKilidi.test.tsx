/**
 * Ortak varlık kilidi (`useVarlikKilidi`) ve kilide uyan düğme (`VarlikDugmesi`) — Kuryeler/Araçlar'ın paylaştığı
 * sözleşme: aynı varlık + aynı işlem aynı sözü paylaşır, farklı işlem reddedilir, farklı varlık paralel, kilit
 * `finally` ile kalkar, senkron throw kilit/state sızdırmaz; düğme çağıranın disabled/loading/title'ını ezmez.
 */
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { App } from "antd";
import type { ReactNode } from "react";
import { MESGUL_NEDENI, VarlikDugmesi, useVarlikKilidi } from "@/panel/components/varlikKilidi";

const uyari = vi.fn();
const hata = vi.fn();
const mesaj = { warning: uyari, error: hata } as never;
const sarmal = ({ children }: { children: ReactNode }) => <App>{children}</App>;

beforeEach(() => {
  uyari.mockReset();
  hata.mockReset();
});

describe("useVarlikKilidi", () => {
  it("aynı varlık + aynı işlem aynı Promise'i paylaşır (tek çağrı); farklı işlem reddedilir ve neden gösterilir; farklı varlık paralel; finally'de kilit kalkar", async () => {
    const { result } = renderHook(() => useVarlikKilidi(mesaj));
    const cozumler: ((v: unknown) => void)[] = [];
    const calistir = vi.fn(() => new Promise((res) => { cozumler.push(res); }));
    let a: Promise<unknown> | null = null;
    let b: Promise<unknown> | null = null;
    let c: Promise<unknown> | null = null;
    let d: Promise<unknown> | null = null;
    act(() => {
      a = result.current.kilitle("vehicle:1", "sil", calistir);
      b = result.current.kilitle("vehicle:1", "sil", calistir);
      c = result.current.kilitle("vehicle:1", "aktif", calistir);
      d = result.current.kilitle("vehicle:2", "aktif", calistir);
    });
    expect(calistir).toHaveBeenCalledTimes(2);
    expect(b).toBe(a);
    expect(c).toBeNull();
    expect(uyari).toHaveBeenCalledWith(MESGUL_NEDENI);
    expect(d).not.toBe(a);
    expect(result.current.surenIslem("vehicle:1")).toBe("sil");
    expect(result.current.surenIslem("vehicle:2")).toBe("aktif");
    expect(result.current.kilitli("vehicle:1")).toBe(true);
    // Onay yardımcıları: kilitliyken kapatma reddedilir, çakışan onOk reddedilir.
    await expect(result.current.kapatmaEngeli("vehicle:1")()).rejects.toThrow("bekleniyor");
    expect(result.current.kapatmaEngeli("vehicle:3")()).toBeUndefined();
    await expect(result.current.onayla("vehicle:1", "aktif", calistir)()).rejects.toThrow("mesgul");
    await act(async () => { cozumler[0](undefined); await a; });
    expect(result.current.kilitli("vehicle:1")).toBe(false);
    expect(result.current.surenIslem("vehicle:1")).toBeUndefined();
    expect(result.current.surenIslem("vehicle:2")).toBe("aktif");
    await act(async () => { cozumler[1](undefined); await d; });
    expect(result.current.kilitli("vehicle:2")).toBe(false);
  });

  it("hata yolunda da kilit kalkar; senkron throw kilit/state sızdırmaz ve reddedilmiş söz döner", async () => {
    const { result } = renderHook(() => useVarlikKilidi(mesaj));
    let soz: Promise<unknown> | null = null;
    act(() => {
      soz = result.current.kilitle("point:1", "duzenle", () => Promise.reject(new Error("409")));
    });
    expect(result.current.kilitli("point:1")).toBe(true);
    await act(async () => { await soz!.catch(() => {}); });
    await waitFor(() => expect(result.current.surenIslem("point:1")).toBeUndefined());
    expect(result.current.kilitli("point:1")).toBe(false);
    let sync: Promise<unknown> | null = null;
    act(() => {
      sync = result.current.kilitle("point:1", "duzenle", () => { throw new Error("senkron patladı"); });
    });
    await expect(sync).rejects.toThrow("senkron patladı");
    expect(hata).toHaveBeenCalledTimes(1);
    expect(result.current.kilitli("point:1")).toBe(false);
    expect(result.current.surenIslem("point:1")).toBeUndefined();
    // Sızıntı yok: aynı varlıkta yeni işlem hemen başlayabilir.
    let sonra: Promise<unknown> | null = null;
    act(() => { sonra = result.current.kilitle("point:1", "sil", () => Promise.resolve()); });
    expect(sonra).not.toBeNull();
    await act(async () => { await sonra; });
  });
});

describe("VarlikDugmesi", () => {
  it("kendi işlemi loading, başka işlem disabled + neden; çağıranın disabled/loading/title önkoşulları ezilmez (kilit nedeni öncelikli)", () => {
    render(
      <>
        <VarlikDugmesi islem="sil" mesgulIslem={undefined}>Serbest</VarlikDugmesi>
        <VarlikDugmesi islem="sil" mesgulIslem="sil">Kendi</VarlikDugmesi>
        <VarlikDugmesi islem="sil" mesgulIslem="aktif" title="kendi nedeni">Başka</VarlikDugmesi>
        <VarlikDugmesi islem="sil" mesgulIslem={undefined} disabled title="Önce durak ekleyin.">Önkoşul</VarlikDugmesi>
        <VarlikDugmesi islem="sil" mesgulIslem={undefined} loading>Dış loading</VarlikDugmesi>
      </>,
      { wrapper: sarmal },
    );
    expect(screen.getByRole("button", { name: "Serbest" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Serbest" })).not.toHaveAttribute("title");
    expect(screen.getByRole("button", { name: /Kendi$/ })).toHaveClass("ant-btn-loading");
    expect(screen.getByRole("button", { name: /Kendi$/ })).not.toBeDisabled();
    const baska = screen.getByRole("button", { name: "Başka" });
    expect(baska).toBeDisabled();
    expect(baska).toHaveAttribute("title", MESGUL_NEDENI);
    const onkosul = screen.getByRole("button", { name: "Önkoşul" });
    expect(onkosul).toBeDisabled();
    expect(onkosul).toHaveAttribute("title", "Önce durak ekleyin.");
    expect(screen.getByRole("button", { name: /Dış loading$/ })).toHaveClass("ant-btn-loading");
    const tik = vi.fn();
    render(<VarlikDugmesi islem="sil" mesgulIslem="aktif" onClick={tik}>Tıkla</VarlikDugmesi>, { wrapper: sarmal });
    fireEvent.click(screen.getByRole("button", { name: "Tıkla" }));
    expect(tik).not.toHaveBeenCalled();
  });

  it("`islem` beyansız mount atar (kapı guard'ı gerekçesi)", () => {
    const sessiz = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<VarlikDugmesi {...({ mesgulIslem: undefined } as never)}>x</VarlikDugmesi>, { wrapper: sarmal })).toThrow("`islem` zorunlu");
    sessiz.mockRestore();
  });
});
