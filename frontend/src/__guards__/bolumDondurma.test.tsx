/**
 * BÖLÜM DONDURMA — "Kütüphaneler" ve "Denemeler" lansmana yetişmiyor.
 *
 * Karar: iki bölüm arayüzde DONDURULUR. Menü öğeleri GÖRÜNÜR kalır (ürünün
 * yol haritası okunsun diye) ama tıklanamaz olur, yanlarında "Yakında" rozeti
 * durur, klavyeyle de erişilemez; doğrudan URL yazan kullanıcı gerçek sayfayı
 * DEĞİL "Yakında" sayfasını görür. Backend'e dokunulmaz — bu yalnız arayüz
 * dondurmasıdır.
 *
 * ## Bu dosya üretim kodundan ÖNCE yazıldı
 *
 * Bir şeyin "tıklanamadığını" iddia eden test, o şey hiç render edilmemiş
 * olsa da geçer — dondurma testlerinin en olası yalancı yeşil kılığı budur
 * (kök CLAUDE.md §E). Bu yüzden her dondurma iddiasının yanında bir DOLULUK
 * NÖBETÇİSİ vardır: donmayan komşunun (Eğitmenler / /egitmenler / Öğren
 * hub'ının diğer kartları) hâlâ ÇALIŞTIĞI ayrıca ölçülür. Nöbetçi olmadan
 * "kategori çubuğu hiç render olmadı" ile "kategori donduruldu" ayırt
 * edilemezdi.
 *
 * Kırmızı faz: bayraklar ve `Yakinda` sayfası henüz yokken koşuldu, çıktı
 * commit mesajına yazıldı.
 *
 * Test türleri (kök CLAUDE.md §H): tamamı GERÇEK DOM (jsdom + RTL); rota
 * düğümleri ayrıca GERÇEK `App` + gerçek react-router kullanır. Kaynak/AST
 * taraması YOKTUR.
 *
 * SINIR (§F): jsdom gerçek tarayıcının yerine geçmez — gerçek gezinme, lazy
 * chunk yüklenmesi ve görsel yerleşim burada ölçülmez.
 *
 * Bu dosya bayrak KAPALI hâli ölçer. Bayrak açıkken eski davranışın aynen
 * geri geldiği `bolumDondurmaBayrakAcik.test.tsx` dosyasında ölçülür.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
// Tembel rota hedeflerini TOPLAMA evresinde çözdür: `React.lazy` sınırı
// `act` ile akıtılıyor, ama modülün kendisi önbellekte olsun (aynı gerekçe
// `flashcardsKaldirildi.test.tsx` R7'de belgelendi).
import "@/pages/NotFound";
import "@/pages/Yakinda";

import { CategoryBar } from "@/components/CategoryBar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { TUTOR_NAV } from "@/lib/nav";
import Learn from "@/pages/Learn";
import { DENEMELER_ACIK, KUTUPHANELER_ACIK } from "@/lib/ozellikBayraklari";

const DONMUS_ETIKETLER = ["Kütüphaneler", "Denemeler"] as const;

function sar(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

describe("ÖN KOŞUL — bayraklar kapalı", () => {
  it("KUTUPHANELER_ACIK ve DENEMELER_ACIK varsayılanı `false`", () => {
    // Bu dosyadaki her iddia bayrakların KAPALI olmasına dayanır. Biri
    // sessizce `true` yapılırsa aşağıdaki düğümler kırılır ama sebebi
    // anlaşılmaz olurdu; burada açıkça söylenir.
    expect(KUTUPHANELER_ACIK).toBe(false);
    expect(DENEMELER_ACIK).toBe(false);
  });
});

describe("A — kategori çubuğu (gerçek DOM)", () => {
  it("NÖBETÇİ: çubuk gerçekten render oluyor ve donmayan kategoriler ÇALIŞIYOR", () => {
    // Boş kümede ölçüm yapılmasın: aşağıdaki "tıklanamaz" iddiaları çubuk hiç
    // basılmadığında da geçerdi.
    sar(<CategoryBar />);
    expect(screen.getByRole("link", { name: /Hepsi/ }).getAttribute("href")).toBe("/");
    expect(
      screen.getByRole("link", { name: /Eğitmenler/ }).getAttribute("href")
    ).toBe("/egitmenler");
  });

  it.each(DONMUS_ETIKETLER)("%s hâlâ GÖRÜNÜR (menüden silinmedi)", (etiket) => {
    sar(<CategoryBar />);
    expect(screen.getByText(etiket)).toBeTruthy();
  });

  it.each(DONMUS_ETIKETLER)("%s bir bağlantı DEĞİL (tıklanamaz)", (etiket) => {
    const { container } = sar(<CategoryBar />);
    // 1. Erişilebilirlik ağacında link/button olarak görünmüyor.
    expect(screen.queryByRole("link", { name: new RegExp(etiket) })).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(etiket) })).toBeNull();
    // 2. `href` de kalmadı: rolü gizleyip anchor'ı bırakmak tıklanabilirliği
    //    korurdu (fare kullanıcısı için hiçbir şey değişmezdi).
    const oluLink = Array.from(container.querySelectorAll("a[href]")).filter((a) =>
      (a.textContent ?? "").includes(etiket)
    );
    expect(oluLink.map((a) => a.getAttribute("href"))).toEqual([]);
  });

  it.each(DONMUS_ETIKETLER)("%s klavyeden erişilemez (aria-disabled + tabIndex)", (etiket) => {
    sar(<CategoryBar />);
    const oge = screen.getByText(etiket).closest("[aria-disabled]");
    expect(oge).not.toBeNull();
    expect(oge!.getAttribute("aria-disabled")).toBe("true");
    expect(oge!.getAttribute("tabindex")).toBe("-1");
  });

  it.each(DONMUS_ETIKETLER)("%s yanında 'Yakında' rozeti YOK (kullanıcı kararı, 29 Ağu)", (etiket) => {
    // Rozet kaldırıldı: soluk + tıklanamaz hâl durumu zaten anlatıyor,
    // ek "Yakında" metni gürültüydü. Donukluk yukarıdaki iddialarla sınanır.
    sar(<CategoryBar />);
    const oge = screen.getByText(etiket).closest("[aria-disabled]");
    expect(within(oge as HTMLElement).queryByText("Yakında")).toBeNull();
  });

  it("sekme kipinde donmuş kategoriye tıklamak sekmeyi DEĞİŞTİRMEZ", () => {
    // Landing kategorileri sekme gibi kullanır (`onSelect`): rota
    // değişmediği için rota kapısı burada koruma sağlamaz. Donmuş sekme
    // seçilebilirse kullanıcı boş/kırık içeriğe düşer.
    const onSelect = vi.fn();
    sar(<CategoryBar active="hepsi" onSelect={onSelect} />);

    for (const etiket of DONMUS_ETIKETLER) {
      fireEvent.click(screen.getByText(etiket));
    }
    expect(onSelect).not.toHaveBeenCalled();

    // NÖBETÇİ: donmamış sekme hâlâ seçilebiliyor — yoksa "onSelect hiç
    // bağlanmamış" durumu da yukarıdaki iddiayı geçirirdi.
    fireEvent.click(screen.getByText("Eğitmenler"));
    expect(onSelect).toHaveBeenCalledWith("egitmenler");
  });
});

describe("B — rota kapısı (gerçek App + gerçek router)", () => {
  const yoluBas = async (yol: string) => {
    window.history.pushState({}, "", yol);
    const sonuc = render(
      <HelmetProvider>
        <App />
      </HelmetProvider>
    );
    // Tembel sınırı akıt (bkz. flashcardsKaldirildi.test.tsx R7).
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    return sonuc;
  };

  const DONMUS_YOLLAR = [
    "/kutuphaneler",
    "/kutuphaneler/bizim-kutuphane",
    "/kutuphane-kayit",
    "/denemeler",
  ];

  it.each(DONMUS_YOLLAR)("%s → 'Yakında' sayfası (gerçek sayfa açılmıyor)", async (yol) => {
    await yoluBas(yol);
    expect(screen.getByRole("heading", { name: /Yakında/i })).toBeTruthy();
  });

  it("NÖBETÇİ: donmayan /egitmenler 'Yakında' göstermiyor", async () => {
    // Yukarıdaki dört iddia, router tamamen bozulup HER yol 'Yakında'ya
    // düşse de geçerdi.
    await yoluBas("/egitmenler");
    expect(screen.queryByRole("heading", { name: /^Yakında$/i })).toBeNull();
  });

  it("NÖBETÇİ: tanımsız bir yol hâlâ 404 veriyor ('Yakında' her şeyi yutmuyor)", async () => {
    await yoluBas("/boyle-bir-sayfa-yok-42");
    expect(
      screen.getByRole("heading", { name: /Aradığınız sayfa bulunamadı/i })
    ).toBeTruthy();
  });
});

describe("C — Öğren hub'ındaki 'Denemelerim' kartı (gerçek DOM)", () => {
  function hubuBas() {
    return sar(<Learn />);
  }

  it("NÖBETÇİ: hub render oluyor ve donmayan kartlar hâlâ bağlantı", () => {
    hubuBas();
    expect(screen.getByRole("heading", { level: 1, name: "Öğren" })).toBeTruthy();
    const { container } = { container: document.body };
    const hedefler = Array.from(container.querySelectorAll("a[href]")).map((a) =>
      a.getAttribute("href")
    );
    expect(hedefler).toContain("/ogren/tekrar");
  });

  it("'Denemelerim' görünür ama /denemeler'e giden bağlantı kalmadı", () => {
    hubuBas();
    expect(screen.getByText("Denemelerim")).toBeTruthy();
    const olu = Array.from(document.body.querySelectorAll("a[href]")).filter(
      (a) => (a.getAttribute("href") ?? "") === "/denemeler"
    );
    expect(olu).toEqual([]);
  });

  it("'Denemelerim' kartı aria-disabled ve rozetsiz (29 Ağu: 'Yakında' metni kalktı)", () => {
    hubuBas();
    const kart = screen.getByText("Denemelerim").closest("[aria-disabled]");
    expect(kart).not.toBeNull();
    expect(kart!.getAttribute("aria-disabled")).toBe("true");
    expect(kart!.getAttribute("tabindex")).toBe("-1");
    expect(within(kart as HTMLElement).queryByText("Yakında")).toBeNull();
  });
});

describe("D — eğitmen menüsündeki 'Kütüphaneler' girdisi (gerçek DOM)", () => {
  /** Yan menü (avatar açılırı) gerçek tıklamayla açılır — girdi orada METİNLE görünür. */
  function menuyuAc() {
    sar(<DashboardHeader navItems={TUTOR_NAV} />);
    fireEvent.click(screen.getByRole("button", { name: "Hesap menüsü" }));
  }

  it("NÖBETÇİ: menü render oluyor ve donmayan girdiler hâlâ bağlantı", () => {
    menuyuAc();
    // Üst bar kısayolu + yan menü girdisi: aynı hedefe iki bağlantı normaldir.
    const mesajlar = screen.getAllByRole("link", { name: /Mesajlar/ });
    expect(mesajlar.length).toBeGreaterThan(0);
    for (const a of mesajlar) expect(a.getAttribute("href")).toBe("/mesajlar");
  });

  it("'Kütüphaneler' görünür ama /kutuphaneler'e giden bağlantı kalmadı", () => {
    menuyuAc();
    expect(screen.getByText("Kütüphaneler")).toBeTruthy();
    const olu = Array.from(document.body.querySelectorAll("a[href]")).filter(
      (a) => (a.getAttribute("href") ?? "") === "/kutuphaneler"
    );
    expect(olu).toEqual([]);
  });

  it("'Kütüphaneler' girdisi aria-disabled + tabIndex=-1 ve rozetsiz", () => {
    menuyuAc();
    const oge = screen.getByText("Kütüphaneler").closest("[aria-disabled]");
    expect(oge).not.toBeNull();
    expect(oge!.getAttribute("aria-disabled")).toBe("true");
    expect(oge!.getAttribute("tabindex")).toBe("-1");
    // Görünür "Yakında" metni kalktı (29 Ağu); ekran okuyucu için durum
    // aria-label'da ("… — Yakında") anlatılmaya devam eder.
    expect(within(oge as HTMLElement).queryByText("Yakında")).toBeNull();
  });

  it("üst bar kısayolu da bağlantı değil (yan menüyü açmadan)", () => {
    // Yan menü kapalıyken üst barda ikon-only bir kısayol duruyor. Yalnız yan
    // menüyü dondurmak, kullanıcının en sık gördüğü yüzeyi açık bırakırdı.
    sar(<DashboardHeader navItems={TUTOR_NAV} />);
    expect(
      screen.queryByRole("link", { name: /Kütüphaneler/ })
    ).toBeNull();
    const kisayol = screen.getByLabelText("Kütüphaneler — Yakında");
    expect(kisayol.getAttribute("aria-disabled")).toBe("true");
    expect(kisayol.getAttribute("tabindex")).toBe("-1");
  });
});
