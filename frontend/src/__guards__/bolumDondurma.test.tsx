/**
 * BÖLÜM BAYRAKLARI — güncel sözleşme (26 Eyl 2026, kullanıcı kararları):
 *
 *   • KUTUPHANELER_ACIK = false → Kütüphaneler lansman için KAPALI: kategori
 *     şeridinde GİZLİ, doğrudan URL "Yakında" açar (29 Ağu–26 Eyl arası açıktı).
 *   • MAGAZA_ACIK      = true  → Mağaza şeritte gerçek bağlantı.
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
import { UYE_NAV, TUTOR_NAV, type NavItem } from "@/lib/nav";
import { ROUTES } from "@/lib/routes";
import Learn from "@/pages/Learn";
import {
  DENEMELER_ACIK,
  KISISELLESTIRME_ACIK,
  KUTUPHANELER_ACIK,
  MAGAZA_ACIK,
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
  it("KUTUPHANELER_ACIK=false, DENEMELER_ACIK=false, MAGAZA_ACIK=true", () => {
    // Bu dosyadaki her iddia bu ikiliye dayanır. Biri sessizce değişirse
    // aşağıdaki düğümler kırılır ama sebebi anlaşılmaz olurdu; burada
    // açıkça söylenir.
    expect(KUTUPHANELER_ACIK).toBe(false);
    expect(DENEMELER_ACIK).toBe(false);
    expect(MAGAZA_ACIK).toBe(true);
  });

  it("OGREN_ACIK=false, KISISELLESTIRME_ACIK=false", () => {
    expect(OGREN_ACIK).toBe(false);
    expect(KISISELLESTIRME_ACIK).toBe(false);
  });
});

describe("A — kategori çubuğu (gerçek DOM)", () => {
  it("NÖBETÇİ: çubuk render oluyor; Öğretmenler ve Mağaza GERÇEK bağlantı, Kütüphaneler GİZLİ", () => {
    sar(<CategoryBar />);
    // Eğitmenler hedefi 10 Eyl 2026'da `/egitmenler`den `/`e çekildi:
    // kategori değiştirmek arama yapmak değildir, hedef o kategorinin KEŞİF
    // yüzeyidir (kullanıcı kararı — bkz. `CategoryBar` içindeki gerekçe).
    expect(
      screen.getByRole("link", { name: /Öğretmenler/ }).getAttribute("href")
    ).toBe("/");
    expect(
      screen.getByRole("link", { name: /Mağaza/ }).getAttribute("href")
    ).toBe("/magaza");
    expect(screen.queryByText("Kütüphaneler")).toBeNull();
  });

  it("'Hepsi' sekmesi KALDIRILDI", () => {
    sar(<CategoryBar />);
    expect(screen.queryByText("Hepsi")).toBeNull();
  });

  it("'Denemeler' HİÇ görünmüyor (bayrak kapalıyken tamamen gizli)", () => {
    sar(<CategoryBar />);
    expect(screen.queryByText("Denemeler")).toBeNull();
  });

  /*
   * SEKME KİPİ KALKTI (kullanıcı kararı, 9 Eyl 2026).
   *
   * `CategoryBar` eskiden iki kipte çalışıyordu: `onSelect` verilirse
   * `<button>` (URL değişmez), verilmezse `<Link>`. Ana sayfa buton kipini
   * kullanıyordu, yani sekmeye tıklamak adresi değiştirmiyordu — ekran
   * paylaşılamıyor, geri tuşu sekmeyi geri almıyor, yenileyince ilk sekmeye
   * düşülüyordu. Üstelik aynı çubukta Mağaza her zaman `<Link>`ti.
   *
   * Buradaki iki eski düğüm ("Mağaza onSelect'e düşmez", "Kütüphaneler
   * seçilebilir") yerini DAHA GÜÇLÜ tek bir iddiaya bıraktı: çubukta
   * hiç `button` yok, her kategori gerçek bir adrese gider.
   */
  it("çubukta BUTON YOK — her kategori gerçek bir bağlantı", () => {
    sar(<CategoryBar active="egitmenler" />);
    expect(
      screen.queryAllByRole("button"),
      "sekme kipi geri gelmiş: tıklanınca adres değişmez"
    ).toEqual([]);

    // Mağaza ve Kütüphaneler yalnız bayrakları açıkken çubukta.
    for (const [etiket, hedef] of [
      ["Öğretmenler", "/"],
      ...(KUTUPHANELER_ACIK ? ([["Kütüphaneler", "/kutuphaneler"]] as const) : []),
      ...(MAGAZA_ACIK ? ([["Mağaza", "/magaza"]] as const) : []),
    ] as const) {
      expect(
        screen.getByRole("link", { name: new RegExp(etiket) }).getAttribute("href"),
        `${etiket} bağlantısı yanlış hedefte`
      ).toBe(hedef);
    }
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

  it("/kutuphaneler → 'Yakında' (bölüm lansman için kapalı)", async () => {
    await yoluBas("/kutuphaneler");
    expect(screen.getByRole("heading", { name: /Yakında/i })).toBeTruthy();
  });

  it("NÖBETÇİ: /egitmenler 'Yakında' göstermiyor", async () => {
    await yoluBas("/egitmenler");
    expect(screen.queryByRole("heading", { name: /^Yakında$/i })).toBeNull();
  });

  it("NÖBETÇİ: tanımsız bir yol hâlâ 404 veriyor ('Yakında' her şeyi yutmuyor)", async () => {
    // Modül 6: tireli TEK parçalı yollar artık kök SEO rotasına gider ve
    // sunucuya sorulur (ağ beklemesi). Bu nöbetçinin iddiası "tanımsız yol
    // 404" olduğu için SEO biçiminde OLMAYAN bir yol seçildi: iki parçalı ve
    // `-ozel-ders` ile bitmeyen yol sunucuya sorulmadan 404'tür.
    await yoluBas("/boyle-bir/sayfa-yok-42");
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

describe("D — hesap menüsünde DONMUŞ girdi mekanizması (gerçek DOM)", () => {
  /** Yan menü (avatar açılırı) gerçek tıklamayla açılır. */
  function menuyuAc(nav: NavItem[]) {
    sar(<DashboardHeader navItems={nav} />);
    fireEvent.click(screen.getByRole("button", { name: "Hesap menüsü" }));
  }

  /* Bu bölüm 7 Eyl 2026'da TUTOR_NAV'dan KOPARILDI.
     Önce "eğitmen menüsündeki Kütüphaneler girdisi" deniyordu; Kütüphaneler ve
     Mağaza o gün yan panelden çıktı (kullanıcı kararı) ve iddia öznesiz kaldı.
     Dahası: `yakinda` bayrağını taşıyan TEK ürün girdisi oydu, yani düğüm
     silinseydi dondurma mekanizması hiç nöbetsiz kalacaktı.

     Çözüm: düğüm artık ÜRÜN listesine değil MEKANİZMAYA bakıyor — sentetik
     bir nav öğesiyle. Böylece hangi bölümün donduğu değişse de "donmuş girdi
     bağlantı DEĞİLDİR" sözleşmesi çıpalı kalır. */

  const CANLI: NavItem = { to: "/mesajlar", label: "Mesajlar", icon: "messages" };
  const DONMUS: NavItem = { to: "/deneme-bolum", label: "Deneme Bölüm", yakinda: true };

  it("DONMUŞ girdi bağlantı DEĞİL ve klavyeyle odaklanamaz", () => {
    menuyuAc([CANLI, DONMUS]);
    expect(screen.queryByRole("link", { name: /Deneme Bölüm/ })).toBeNull();
    const donuk = screen.getByText("Deneme Bölüm").closest("[aria-disabled='true']");
    expect(donuk, "donmuş girdi aria-disabled taşımıyor").toBeTruthy();
    expect(donuk?.getAttribute("tabindex")).toBe("-1");
    // Not: "Yakında" ROZETİ bu yüzeyde basılmıyor — `NavItem.yakinda`
    // açıklaması rozeti vaat ediyor ama `DashboardHeader` yalnız soluklaştırıp
    // devre dışı bırakıyor. İddia gerçeğe göre yazıldı; rozet istenirse ayrı
    // bir kalem (bugün donmuş girdi zaten yok — aşağıdaki KAPSAM düğümü).
    // Anchor'a hiç dönüşmemeli: `href` taşıyan bir öğe tıklamayı yutar.
    const hedefler = Array.from(document.body.querySelectorAll("a[href]")).map((a) =>
      a.getAttribute("href")
    );
    expect(hedefler).not.toContain("/deneme-bolum");
  });

  it("DOLULUK: aynı menüdeki CANLI girdi gerçek bağlantı", () => {
    // Bu olmadan yukarıdaki üç olumsuz iddia, menü hiç render olmadığında da
    // yeşil kalırdı.
    menuyuAc([CANLI, DONMUS]);
    // Üst bardaki ikon da "Mesajlar" adını taşır (ÜK-2, 17 Eyl 2026); ölçülen
    // şey hesap MENÜSÜNDEKİ girdi, ikonlar `aria-label` ile ayrılır.
    const linkler = screen
      .getAllByRole("link", { name: /Mesajlar/ })
      .filter((a) => !a.hasAttribute("aria-label"));
    expect(linkler.length).toBeGreaterThan(0);
    for (const a of linkler) expect(a.getAttribute("href")).toBe("/mesajlar");
  });

  it("KAPSAM: bugün hiçbir rol menüsünde donmuş girdi YOK", () => {
    // Mekanizma yaşıyor ama ürün tarafında taşıyıcısı kalmadı. Bu düğüm o
    // durumu YAZILI tutar: biri yeniden bir bölümü dondurursa burası kırılır
    // ve dondurmanın bilinçli olduğu görülür.
    for (const nav of [UYE_NAV, TUTOR_NAV]) {
      expect(nav.some((i) => i.yakinda)).toBe(false);
    }
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

  it("İKİ UÇ birden kalktı: öğrencinin 'Taleplerim'i ve öğretmenin 'Gelen Talepler'i", () => {
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
