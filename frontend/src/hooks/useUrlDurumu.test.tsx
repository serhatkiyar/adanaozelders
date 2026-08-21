/**
 * İP-A4 · Görev 3b — URL filtre deseninin testleri.
 *
 * A7'de 70 ekran bu hook'u kullanacak; buradaki dört karar orada tekrar tekrar
 * uygulanacak, o yüzden davranış olarak sabitleniyor:
 *
 *   1. Varsayılana eşit değer adrese yazılmaz.
 *   2. Filtre değişince sayfa başa döner.
 *   3. `push` varsayılan (geri tuşu çalışır); serbest metin `replace` ile
 *      geçmişi şişirmez.
 *   4. `filtreliMi` yalnız GERÇEK filtreleri sayar (sayfa/boyut değil).
 *
 * Gerçek `react-router` + gerçek jsdom geçmişi kullanılır; `useSearchParams`
 * mock'lanmaz — mock'lansaydı test yalnız kendi mock'unu doğrulardı.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { useUrlDurumu } from "./useUrlDurumu";

function Ekran() {
  const { degerler, ayarla, temizle, filtreliMi } = useUrlDurumu(
    { durum: "", urun: "", sayfa: 1, boyut: 25 },
    { sayfaAnahtari: "sayfa", filtreDisi: ["sayfa", "boyut"] }
  );
  return (
    <div>
      <span data-testid="adres">{window.location.search}</span>
      <span data-testid="degerler">{JSON.stringify(degerler)}</span>
      <span data-testid="filtreli">{String(filtreliMi)}</span>
      <button onClick={() => ayarla({ durum: "ACIK" })}>Durumu daralt</button>
      <button onClick={() => ayarla({ urun: "5" }, { replace: true })}>Yazıyor gibi</button>
      <button onClick={() => ayarla({ sayfa: 3 })}>3. sayfa</button>
      <button onClick={() => ayarla({ boyut: 50 })}>Boyut 50</button>
      <button onClick={temizle}>Temizle</button>
    </div>
  );
}

function ac(sorgu = "") {
  window.history.replaceState({}, "", `/deneme${sorgu}`);
  return render(
    <BrowserRouter>
      <Ekran />
    </BrowserRouter>
  );
}

const degerler = () => JSON.parse(screen.getByTestId("degerler").textContent ?? "{}");
const adres = () => screen.getByTestId("adres").textContent ?? "";
const tikla = (ad: string) => fireEvent.click(screen.getByRole("button", { name: ad }));

beforeEach(() => window.history.replaceState({}, "", "/deneme"));

describe("useUrlDurumu", () => {
  it("adres boşken varsayılanları verir", () => {
    ac();
    expect(degerler()).toEqual({ durum: "", urun: "", sayfa: 1, boyut: 25 });
    expect(screen.getByTestId("filtreli").textContent).toBe("false");
  });

  it("adresteki değerler TİPİYLE okunur", () => {
    ac("?durum=ACIK&sayfa=3");
    expect(degerler()).toMatchObject({ durum: "ACIK", sayfa: 3 });
    expect(typeof degerler().sayfa).toBe("number");
  });

  it("adresteki çöp sayı varsayılana düşer (NaN ekrana sızmaz)", () => {
    ac("?sayfa=abc");
    expect(degerler().sayfa).toBe(1);
  });

  it("varsayılana eşit değer adrese YAZILMAZ", () => {
    ac("?durum=ACIK");
    tikla("Temizle");
    expect(adres()).toBe("");
  });

  it("filtre değişince sayfa BAŞA döner", () => {
    ac("?sayfa=3");
    expect(degerler().sayfa).toBe(3);
    tikla("Durumu daralt");
    expect(degerler().sayfa, "3. sayfada daraltılan filtre boş ekran gösterir").toBe(1);
    expect(adres()).toContain("durum=ACIK");
    expect(adres()).not.toContain("sayfa=3");
  });

  it("sayfa AÇIKÇA verilirse sıfırlanmaz", () => {
    ac("?durum=ACIK");
    tikla("3. sayfa");
    expect(degerler()).toMatchObject({ durum: "ACIK", sayfa: 3 });
  });

  it("filtreliMi sayfa ve boyutu SAYMAZ", () => {
    ac();
    tikla("3. sayfa");
    expect(screen.getByTestId("filtreli").textContent).toBe("false");
    tikla("Boyut 50");
    expect(screen.getByTestId("filtreli").textContent).toBe("false");
    tikla("Durumu daralt");
    expect(screen.getByTestId("filtreli").textContent).toBe("true");
  });

  it("varsayılan yazım PUSH'tur: geri tuşu önceki filtreye döner", async () => {
    ac();
    const once = window.history.length;
    tikla("Durumu daralt");
    expect(adres()).toContain("durum=ACIK");
    expect(window.history.length, "push yerine replace kullanılmış").toBeGreaterThan(once);
  });

  it("serbest metin yazımı geçmişi ŞİŞİRMEZ (replace)", () => {
    ac();
    const once = window.history.length;
    tikla("Yazıyor gibi");
    tikla("Yazıyor gibi");
    tikla("Yazıyor gibi");
    expect(adres()).toContain("urun=5");
    expect(window.history.length, "her tuş vuruşu geçmişe girdi").toBe(once);
  });

  it("bilinmeyen arama parametreleri KORUNUR", () => {
    // Ekranın bilmediği bir parametre (ör. bir başka bileşenin sekmesi)
    // filtre yazılırken silinmemeli.
    ac("?sekme=ozet");
    tikla("Durumu daralt");
    expect(adres()).toContain("sekme=ozet");
    expect(adres()).toContain("durum=ACIK");
  });
});
