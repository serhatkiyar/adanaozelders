/**
 * BÖLÜM BAYRAKLARI — güncel sözleşme (29 Ağu 2026, kullanıcı kararları):
 *
 *   • KUTUPHANELER_ACIK = true  → Kütüphaneler HER YERDE gerçek bağlantı.
 *   • DENEMELER_ACIK   = false → Denemeler donuk-görünür DEĞİL, tamamen
 *     GİZLİ (menülerde hiç render edilmez); doğrudan URL "Yakında" açar.
 *   • "Hepsi" sekmesi KALDIRILDI — varsayılan yüzey Eğitmenler.
 *
 * Tarihçe: bu dosya iki bölümün de DONDURULDUĞU dönemin nöbetçisiydi
 * (görünür + tıklanamaz + "Yakında" rozeti). Rozetler 29 Ağu'da kalktı,
 * ardından aynı gün Denemeler tam gizlemeye, Kütüphaneler açık hâle geçti;
 * iddialar buna göre TERSİNE çevrildi. Bayrak kombinasyonlarının mock'lu
 * provaları `bolumDondurmaBayrakAcik` ve `bolumDondurmaBayrakBagimsiz`
 * dosyalarındadır — buradaki her iddia GERÇEK bayrak değerleriyle koşar.
 *
 * Yalancı yeşile karşı her iddianın yanında DOLULUK NÖBETÇİSİ vardır:
 * "görünmüyor" iddiaları, komşu öğelerin görünüp ÇALIŞTIĞI ölçülmeden
 * geçemez (kök CLAUDE.md §E).
 *
 * Test türleri (kök CLAUDE.md §H): tamamı GERÇEK DOM (jsdom + RTL); rota
 * düğümleri gerçek `App` + gerçek react-router kullanır.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
// Tembel rota hedeflerini TOPLAMA evresinde çözdür: `React.lazy` sınırı
// `act` ile akıtılıyor, ama modülün kendisi önbellekte olsun (aynı gerekçe
// `flashcardsKaldirildi.test.tsx` R7'de belgelendi).
import "@/pages/NotFound";
import "@/pages/Yakinda";

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { CategoryBar } from "@/components/CategoryBar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { UYE_NAV, TUTOR_NAV } from "@/lib/nav";
import { ROUTES } from "@/lib/routes";
import Learn from "@/pages/Learn";
import {
  DENEMELER_ACIK,
  KISISELLESTIRME_ACIK,
  KUTUPHANELER_ACIK,
  OGREN_ACIK,
} from "@/lib/ozellikBayraklari";

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

const SRC_KOK = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
);

describe("ÖN KOŞUL — bayrak değerleri", () => {
  it("KUTUPHANELER_ACIK=true, DENEMELER_ACIK=false", () => {
    // Bu dosyadaki her iddia bu ikiliye dayanır. Biri sessizce değişirse
    // aşağıdaki düğümler kırılır ama sebebi anlaşılmaz olurdu; burada
    // açıkça söylenir.
    expect(KUTUPHANELER_ACIK).toBe(true);
    expect(DENEMELER_ACIK).toBe(false);
  });

  it("OGREN_ACIK=false, KISISELLESTIRME_ACIK=false", () => {
    expect(OGREN_ACIK).toBe(false);
    expect(KISISELLESTIRME_ACIK).toBe(false);
  });
});

describe("A — kategori çubuğu (gerçek DOM)", () => {
  it("NÖBETÇİ: çubuk render oluyor; Eğitmenler ve Kütüphaneler GERÇEK bağlantı", () => {
    sar(<CategoryBar />);
    expect(
      screen.getByRole("link", { name: /Eğitmenler/ }).getAttribute("href")
    ).toBe("/egitmenler");
    expect(
      screen.getByRole("link", { name: /Kütüphaneler/ }).getAttribute("href")
    ).toBe("/kutuphaneler");
  });

  it("'Hepsi' sekmesi KALDIRILDI", () => {
    sar(<CategoryBar />);
    expect(screen.queryByText("Hepsi")).toBeNull();
  });

  it("'Denemeler' HİÇ görünmüyor (bayrak kapalıyken tamamen gizli)", () => {
    sar(<CategoryBar />);
    expect(screen.queryByText("Denemeler")).toBeNull();
  });

  it("'Mağaza' kapısı sekme kipinde bile bağlantı (onSelect'e düşmez)", () => {
    const onSelect = vi.fn();
    sar(<CategoryBar active="egitmenler" onSelect={onSelect} />);
    expect(screen.getByRole("link", { name: /Mağaza/ }).getAttribute("href")).toBe(
      "/magaza"
    );
    fireEvent.click(screen.getByText("Mağaza"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("sekme kipinde Kütüphaneler artık SEÇİLEBİLİR", () => {
    const onSelect = vi.fn();
    sar(<CategoryBar active="egitmenler" onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Kütüphaneler"));
    expect(onSelect).toHaveBeenCalledWith("kutuphaneler");
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

  it("/denemeler → 'Yakında' sayfası (gerçek sayfa açılmıyor)", async () => {
    await yoluBas("/denemeler");
    expect(screen.getByRole("heading", { name: /Yakında/i })).toBeTruthy();
  });

  it("/kutuphaneler artık 'Yakında' DEĞİL (bölüm açık)", async () => {
    await yoluBas("/kutuphaneler");
    expect(screen.queryByRole("heading", { name: /^Yakında$/i })).toBeNull();
  });

  it("NÖBETÇİ: /egitmenler 'Yakında' göstermiyor", async () => {
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

  it("NÖBETÇİ: hub render oluyor ve diğer kartlar hâlâ bağlantı", () => {
    hubuBas();
    expect(screen.getByRole("heading", { level: 1, name: "Öğren" })).toBeTruthy();
    const hedefler = Array.from(document.body.querySelectorAll("a[href]")).map((a) =>
      a.getAttribute("href")
    );
    expect(hedefler).toContain("/ogren/tekrar");
  });

  it("'Denemelerim' kartı HİÇ görünmüyor ve /denemeler'e bağlantı yok (tam gizleme)", () => {
    hubuBas();
    expect(screen.queryByText("Denemelerim")).toBeNull();
    const olu = Array.from(document.body.querySelectorAll("a[href]")).filter(
      (a) => (a.getAttribute("href") ?? "") === "/denemeler"
    );
    expect(olu).toEqual([]);
  });
});

describe("D — eğitmen menüsündeki 'Kütüphaneler' girdisi (gerçek DOM)", () => {
  /** Yan menü (avatar açılırı) gerçek tıklamayla açılır — girdi orada METİNLE görünür. */
  function menuyuAc() {
    sar(<DashboardHeader navItems={TUTOR_NAV} />);
    fireEvent.click(screen.getByRole("button", { name: "Hesap menüsü" }));
  }

  it("NÖBETÇİ: menü render oluyor ve diğer girdiler hâlâ bağlantı", () => {
    menuyuAc();
    // Üst bar artık rol kısayollarını basmıyor (bkz. ustBarSadeligi.test.tsx),
    // yani bu hedefe tek bağlantı kalıyor: yan menüdeki. Eşik yine `>0`
    // çünkü buradaki iddia SAYI değil, girdinin bağlantı OLMASI.
    const mesajlar = screen.getAllByRole("link", { name: /Mesajlar/ });
    expect(mesajlar.length).toBeGreaterThan(0);
    for (const a of mesajlar) expect(a.getAttribute("href")).toBe("/mesajlar");
  });

  it("'Kütüphaneler' yeniden GERÇEK bağlantı (/kutuphaneler)", () => {
    menuyuAc();
    const linkler = screen.getAllByRole("link", { name: /Kütüphaneler/ });
    expect(linkler.length).toBeGreaterThan(0);
    for (const a of linkler) expect(a.getAttribute("href")).toBe("/kutuphaneler");
    // Donuk kalıntı yok: aria-disabled taşıyan Kütüphaneler öğesi kalmadı.
    const donuk = Array.from(document.body.querySelectorAll("[aria-disabled='true']")).filter(
      (el) => (el.textContent ?? "").includes("Kütüphaneler")
    );
    expect(donuk).toEqual([]);
  });
});

/* ══════════ E — Öğren hub'ı donduruldu (5 Eyl 2026) ══════════ */

describe("E — Öğren rota kapısı (gerçek App + gerçek router)", () => {
  const yoluBas = async (yol: string) => {
    window.history.pushState({}, "", yol);
    const sonuc = render(
      <HelmetProvider>
        <App />
      </HelmetProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    return sonuc;
  };

  it.each([
    "/ogren",
    "/ogren/tekrar",
    "/ogren/zamanlayici",
    "/ogren/grafik",
    "/ogren/aliskanliklar",
  ])("%s → 'Yakında' (gerçek sayfa açılmıyor, giriş kapısına da düşmüyor)", async (yol) => {
    await yoluBas(yol);
    expect(await screen.findByText(/Yakında/i)).toBeTruthy();
  });

  // DOLULUK: "Yakında" her şeyi yutmuyor; router hâlâ ayırt ediyor.
  it("NÖBETÇİ: tanımsız yol hâlâ 404, /egitmenler 'Yakında' değil", async () => {
    await yoluBas("/boyle-bir-yol-yok-12345");
    expect(screen.queryByText(/Yakında/i)).toBeNull();
    cleanup();
    await yoluBas("/egitmenler");
    expect(screen.queryByText(/Yakında/i)).toBeNull();
  });
});

describe("F — öğrenci talepleri donduruldu (6 Eyl · gerçek App + gerçek DOM)", () => {
  const yoluBas = async (yol: string) => {
    window.history.pushState({}, "", yol);
    const sonuc = render(
      <HelmetProvider>
        <App />
      </HelmetProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    return sonuc;
  };

  it("/talepler → 'Yakında' (giriş kapısına DÜŞMEZ)", async () => {
    // Rota bilerek korumanın DIŞINDA: doğrudan URL yazan kullanıcı, giriş
    // ekranı ya da 404 yerine ne olduğunu anlatan bir sayfa görmeli.
    await yoluBas("/talepler");
    expect(await screen.findByText(/Yakında/i)).toBeTruthy();
  });

  it("İKİ UÇ birden kalktı: öğrencinin 'Taleplerim'i ve eğitmenin 'Gelen Talepler'i", () => {
    // Tek uç kapatılsaydı eğitmen, hiç dolmayacak bir gelen kutusuna bakmaya
    // devam ederdi — akışın iki ucu aynı bayrağa bağlı olmak ZORUNDA.
    expect(UYE_NAV.some((i) => i.to === ROUTES.demands)).toBe(false);
    expect(TUTOR_NAV.some((i) => i.to === ROUTES.demands)).toBe(false);
  });

  it("menüde ölü bağlantı kalmadı (gerçek DOM, iki rol)", () => {
    for (const nav of [UYE_NAV, TUTOR_NAV]) {
      const { unmount } = sar(<DashboardHeader navItems={nav} />);
      fireEvent.click(screen.getByRole("button", { name: "Hesap menüsü" }));
      const olu = Array.from(document.body.querySelectorAll("a[href]")).filter(
        (a) => (a.getAttribute("href") ?? "") === "/talepler"
      );
      expect(olu).toEqual([]);
      unmount();
    }
  });

  it("DOLULUK: menü gerçekten doldu — 'bağlantı yok' iddiası boş DOM'dan gelmiyor", () => {
    sar(<DashboardHeader navItems={UYE_NAV} />);
    fireEvent.click(screen.getByRole("button", { name: "Hesap menüsü" }));
    expect(
      Array.from(document.body.querySelectorAll("a[href]")).length
    ).toBeGreaterThan(3);
  });

  it("kopya metni donmuş bölümü VAAT ETMİYOR", () => {
    // "Derslerin, kütüphane rezervasyonların ve talep durumların" — bu ibare
    // Hesabım kartında duruyordu ve donmuş bir bölümü vaat ediyordu. Kopya
    // artık bayrağa bağlı; sabit metin geri gelirse burası konuşur.
    const kaynak = readFileSync(
      join(SRC_KOK, "pages", "AccountHub.tsx"),
      "utf8"
    );
    expect(kaynak).toContain("TALEPLER_ACIK");
    expect(
      kaynak,
      "kopya sabit: donmuş bölüm hâlâ vaat ediliyor"
    ).not.toContain('desc: "Derslerin, kütüphane rezervasyonların ve talep durumların."');
  });
});

describe("E — Pomodoro kartı her sayfadan kalktı", () => {
  // Kart rota tablosunun DIŞINDA mount ediliyordu. Donmuş bölüme giden bu
  // bağlantı kalsaydı her sayfada ölü link olurdu — ve hiçbir rota nöbetçisi
  // görmezdi, çünkü rota değil.
  it("hiçbir sayfada /ogren/zamanlayici bağlantısı yok", async () => {
    window.history.pushState({}, "", "/");
    render(
      <HelmetProvider>
        <App />
      </HelmetProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });
    const olu = Array.from(document.body.querySelectorAll("a[href]")).filter((a) =>
      (a.getAttribute("href") ?? "").includes("/ogren")
    );
    expect(olu.map((a) => a.getAttribute("href"))).toEqual([]);
  });
});

describe("E — 'Görünüm ve tercihler' sekmesi SİLİNMEDİ, bayrağa bağlandı", () => {
  // Sekme listesi bileşenin içinde kuruluyor ve dışa verilmiyor; render etmek
  // oturum + profil verisi ister. Bu yüzden düğüm bir KAYNAK sözleşmesidir ve
  // sınırını açıkça söyler: "sekme ekranda yok" demez, "sekme bayrağa bağlı"
  // der. Ekrandaki karşılığı elle tur listesindedir.
  //
  // Değeri şu: biri sekmeyi bayrağa bağlamak yerine SİLERSE burası kırılır —
  // dondurma ile silmeyi ayıran şey tam olarak bu.
  const kaynak = readFileSync(
    join(SRC_KOK, "pages", "Settings.tsx"),
    "utf8",
  );

  it("sekme tanımı ve içeriği KISISELLESTIRME_ACIK ile korunuyor", () => {
    expect(kaynak).toContain("KISISELLESTIRME_ACIK");
    // İki yerde birden: sekme listesi ve içerik dalı. Yalnız birine bağlamak,
    // seçili sekme olarak açık kalan bir bölüm bırakırdı.
    const gecis = kaynak.split("KISISELLESTIRME_ACIK").length - 1;
    expect(gecis, "bayrak yalnız tek yerde okunuyor").toBeGreaterThanOrEqual(3);
  });

  it("DOLULUK: panel bileşeni ve etiket hâlâ kodda (silinmedi)", () => {
    expect(kaynak).toContain("PersonalizePanel");
    expect(kaynak).toContain("Görünüm ve tercihler");
  });
});
