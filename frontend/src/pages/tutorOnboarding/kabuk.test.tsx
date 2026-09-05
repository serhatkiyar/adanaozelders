/**
 * Sihirbaz kabuğunun sözleşmesi.
 *
 * Buradaki dört iddia da "sessizce bozulan" sınıftan: hiçbiri ekrana bakınca
 * fark edilmez, ama üçü erişilebilirliği bozar, biri mobilde akışı tam
 * ortasından keser.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AksiyonCubugu, BilgiKarti, IkiKolon, IlerlemeSeridi } from "./kabuk";
import { ADIMLAR, SON_ADIM } from "./sozlesme";

beforeEach(() => {
  // matchMedia jsdom'da yok; bilgi kartı masaüstü/mobil ayrımı için okuyor.
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((sorgu: string) => ({
      matches: false,
      media: sorgu,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

describe("bilgi kartı", () => {
  it("DOM'da TEK kopya — masaüstü ve mobil için iki ayrı kart basılmaz", () => {
    // İki kopya basmak, ekran okuyucuya aynı yardımı iki kez okutur ve
    // görsel olarak (biri `lg:hidden`) fark edilmez.
    render(
      <BilgiKarti
        ipucu="Başlık ilanının en çok okunan yeri."
        ornekler={["Mühendislik öğrencisi, matematik ve fizik"]}
        hatirlatma="İletişim bilgin başlıkta yer alamaz."
        ad="Serhat"
      />,
    );
    expect(
      screen.getAllByText("Başlık ilanının en çok okunan yeri."),
    ).toHaveLength(1);
    expect(
      screen.getAllByText(/Mühendislik öğrencisi, matematik ve fizik/),
    ).toHaveLength(1);
  });

  it("hatırlatmada kullanıcıya adıyla seslenir", () => {
    render(<BilgiKarti hatirlatma="Numaran ilanında görünmez." ad="Serhat" />);
    expect(screen.getByText(/Unutma Serhat,/)).toBeTruthy();
  });

  it("içeriği yoksa HİÇ basılmaz — boş pembe kutu kalmaz", () => {
    const { container } = render(<BilgiKarti />);
    expect(container.querySelector("details")).toBeNull();
  });
});

describe("iki kolon", () => {
  it("yardım DOM'da sorudan SONRA gelir (mobil sırası doğru)", () => {
    // Mobilde tek sütun: DOM sırası ekran sırasıdır ve ilk görülmesi gereken
    // şey sorunun kendisidir. Masaüstündeki sol/sağ yerleşim `order-*` ile
    // çevrilir — DOM sırası değişmez.
    const { container } = render(
      <IkiKolon bilgi={<p>yardım metni</p>}>
        <h1>soru</h1>
      </IkiKolon>,
    );
    const metin = container.textContent ?? "";
    expect(metin.indexOf("soru")).toBeLessThan(metin.indexOf("yardım metni"));
  });
});

describe("ilerleme şeridi", () => {
  it("oran SÖZLEŞMEDEN türer, sabit yazılmaz", () => {
    const { rerender } = render(<IlerlemeSeridi adimNo={0} />);
    const beklenen = (n: number) =>
      String(Math.round(((n + 1) / ADIMLAR.length) * 100));

    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      beklenen(0),
    );

    rerender(<IlerlemeSeridi adimNo={SON_ADIM} />);
    // Son adımda şerit TAM dolu olmalı; "neredeyse bitti" hissi bırakmak
    // kullanıcıyı bir adım daha arattırır.
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "100",
    );
    expect(beklenen(SON_ADIM)).toBe("100");
  });
});

describe("aksiyon çubuğu", () => {
  it("TEK birincil düğme basar ve doğrulamayla KİLİTLENMEZ", () => {
    render(
      <AksiyonCubugu ileri={() => {}} ileriEtiket="Sırada: Başlığın" geri={() => {}} />,
    );
    const dugmeler = screen.getAllByRole("button", { name: /^Sırada:/ });
    expect(dugmeler).toHaveLength(1);
    expect((dugmeler[0] as HTMLButtonElement).disabled).toBe(false);
    // Geri düğmesinin adı sabittir: ikon-düğmenin tek erişilebilir adı bu.
    expect(screen.getByRole("button", { name: "Önceki adım" })).toBeTruthy();
  });

  it("iOS klavyesi açılınca çubuğu YUKARI çeker, adres çubuğunda ÇEKMEZ", () => {
    // `position: fixed` bir öğe iOS'ta klavye açılınca görsel alanın dışında
    // kalır ve "devam" düğmesi kaybolur — akışı tam ortasından kesen arıza.
    // 120px eşiği bilinçli: küçük farklar adres çubuğunun gizlenmesidir.
    const dinleyiciler: Record<string, () => void> = {};
    vi.stubGlobal("visualViewport", {
      height: 800,
      addEventListener: (ad: string, fn: () => void) => {
        dinleyiciler[ad] = fn;
      },
      removeEventListener: vi.fn(),
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });

    const { container } = render(
      <AksiyonCubugu ileri={() => {}} ileriEtiket="Sırada: Başlığın" />,
    );
    const cubuk = container.firstElementChild as HTMLElement;

    // Adres çubuğu gizlendi (60px): çubuk OYNAMAMALI.
    (window.visualViewport as unknown as { height: number }).height = 740;
    dinleyiciler.resize?.();
    expect(cubuk.style.transform).toBe("");

    // Klavye açıldı (300px): çubuk yukarı çekilmeli.
    (window.visualViewport as unknown as { height: number }).height = 500;
    dinleyiciler.resize?.();
    expect(cubuk.style.transform).toBe("translateY(-300px)");
  });

  it("atla bağlantısı yalnız verilince basılır", () => {
    const { rerender } = render(
      <AksiyonCubugu ileri={() => {}} ileriEtiket="Sırada: Başlığın" />,
    );
    expect(screen.queryByText(/şimdilik atla/i)).toBeNull();

    const atla = vi.fn();
    rerender(
      <AksiyonCubugu ileri={() => {}} ileriEtiket="Sırada: Başlığın" atla={atla} />,
    );
    fireEvent.click(screen.getByText(/şimdilik atla/i));
    expect(atla).toHaveBeenCalledOnce();
  });
});
