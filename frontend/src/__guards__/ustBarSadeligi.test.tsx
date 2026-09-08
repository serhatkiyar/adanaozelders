/**
 * Üst bar sadeliği — kullanıcı kararı (6 Eyl 2026).
 *
 * ## Karar
 *
 * Oturum içi üst barda rol menüsünün tamamı ikon olarak basılıyordu:
 * öğrencide beş, eğitmende altı kısayol. Aynı bağlantılar avatar açılırında
 * ZATEN duruyordu — yani üst bar, menünün eksiksiz bir KOPYASIYDI ve tek
 * ürettiği şey kalabalıktı.
 *
 * Artık üst barda **en fazla tek kısayol** var (Favorilerim); geri kalan her
 * şey hesap menüsünden açılır. 6 Eyl 2026'dan beri o kısayol eğitmende de
 * görünür — favori eğitmene açıldı (ÜK-6), kural değişmedi.
 *
 * ## Bu nöbetçinin ASIL iddiası
 *
 * "İkonlar kalktı" önemli değil — kolayca geri konur ve konması da bir hata
 * değil. Sessizce yanlış gidebilecek olan şu: **kaldırılan bir kısayolun
 * hedefine artık HİÇBİR YERDEN gidilememesi.**
 *
 * Bugün güvenli olmasının sebebi `defaultVisible("sidebar", …)`ın her öğe için
 * `true` dönmesi, yani açılır menünün üst barın ÜST KÜMESİ olması. Bu, kodun
 * başka bir yerinde duran ve buradan görünmeyen bir varsayım — biri
 * `DEFAULT_SIDEBAR_HIDDEN` gibi bir liste eklediği gün üst bardan da menüden
 * de düşen bir ekran doğar ve hiçbir şey itiraz etmez. Aşağıdaki ikinci düğüm
 * tam olarak o günü yakalar.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Gerçek DOM'da çalışır (jsdom + gerçek `DashboardHeader`), yani "menüyü aç,
 * bağlantı var mı" iddiası davranışsaldır. Görsel yoğunluk ("kalabalık mı")
 * ölçülmez; ölçülen şey SAYI ve ERİŞİLEBİLİRLİKtir.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DashboardHeader } from "@/components/DashboardHeader";
import {
  OPERATOR_NAV,
  UYE_NAV,
  TUTOR_NAV,
  TUTOR_PANO_SEKMELERI,
} from "@/lib/nav";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { ROLE_IDS, type NavItem } from "@/types";

function sar(navItems: NavItem[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DashboardHeader navItems={navItems} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  useAuthStore.setState({
    user: {
      id: 1,
      role_id: ROLE_IDS.CLIENT,
      display_name: "Test",
      email: "t@example.com",
    },
  } as never);
});

afterEach(() => cleanup());

/**
 * Hesap menüsü AÇILMADAN önce üst barda görünen AYRIK gezinme hedefleri.
 *
 * Ayrık: duyarlı düzen aynı kısayolu iki kez çiziyor (`hidden sm:flex` masaüstü
 * ikizi + `sm:hidden` mobil ikizi) ve jsdom ikisini de DOM'da tutar — CSS
 * gizler, kaldırmaz. Sayıyı değil KİMLİĞİ ölçmek doğru olan: "kaç düğüm var"
 * duyarlı düzenin ayrıntısı, "nereye gidiliyor" ise kararın kendisi.
 */
function ustBardakiHedefler(): string[] {
  const hepsi = Array.from(document.body.querySelectorAll("a[href]"))
    .map((a) => a.getAttribute("href") ?? "")
    .filter((h) => h !== "/" && h !== ROUTES.home);
  return [...new Set(hepsi)].sort();
}

describe("üst bar · en fazla TEK kısayol", () => {
  it("öğrencide yalnız Favorilerim kalır", () => {
    sar(UYE_NAV);
    expect(ustBardakiHedefler()).toEqual([ROUTES.favorites]);
  });

  it("eğitmende de yalnız Favorilerim kalır", () => {
    // 6 Eyl 2026'da DEĞİŞTİ. Önce "eğitmende HİÇ kısayol yok" iddia
    // ediliyordu, sebebi favorilerin eğitmene kapalı olmasıydı — kararın
    // kendisi değil, o günkü kısıtın yansımasıydı. ÜK-6 favoriyi eğitmene
    // açtı; ÜK-2'nin ASIL kuralı ("en fazla TEK kısayol, o da Favorilerim")
    // bozulmadı, iki rolde de aynı tek kısayol var.
    useAuthStore.setState({
      user: { id: 2, role_id: ROLE_IDS.TUTOR, display_name: "Eğitmen", email: "e@example.com" },
    } as never);
    sar(TUTOR_NAV);
    expect(ustBardakiHedefler()).toEqual([ROUTES.favorites]);
  });

  it("üst bara TEK kısayol sızabilir — ikinci ikon eklenirse kırılır", () => {
    // ÜK-2'nin sayısal çıpası. Yukarıdaki iki iddia rol menüsüne bakıyor;
    // bu düğüm "menüde ne varsa üst bara basılmasın" kuralını tutar.
    for (const nav of [UYE_NAV, TUTOR_NAV, OPERATOR_NAV]) {
      cleanup();
      sar(nav);
      expect(ustBardakiHedefler().length).toBeLessThanOrEqual(1);
    }
  });

  it("DOLULUK: rol menüsü gerçekten kalabalık — kısayollar boş listeden gelmiyor", () => {
    // Bu olmadan yukarıdaki iki iddia, `nav.ts` boşalsa da yeşil kalırdı.
    // Eşik 4'ten 3'e indi (7 Eyl 2026): Kütüphaneler ve Mağaza özel dersin
    // yan panelinden çıktı (kullanıcı kararı, bkz. `lib/nav.ts`). Bu düğümün
    // işi menünün DOLU olduğunu kanıtlamaktır, kaç kalem olduğunu dondurmak
    // değil — eşik kararla birlikte gerekçesiyle indi.
    expect(UYE_NAV.length).toBeGreaterThanOrEqual(3);
    /*
     * EĞİTMENDE KAPI DEĞİŞTİ (8 Eyl 2026, kullanıcı kararı).
     *
     * Eskiden `TUTOR_NAV.length >= 3` yazıyordu. O kapı artık YANLIŞ bir şeyi
     * ölçüyor: eğitmenin gezinmesi avatar menüsünden PANEL ŞERİDİNE taşındı
     * (`TUTOR_PANO_SEKMELERI`), menüde yalnız şeride girmeyenler kaldı. Sayıyı
     * eski yerinde tutmak, doğru yapılmış bir taşımayı kırmızıya düşürürdü.
     *
     * Ölçülmesi gereken şey değişmedi: eğitmenin gezinmesi BOŞ bir listeden
     * gelmiyor olsun. Bu yüzden kapı iki yüzeyin BİRLEŞİMİNE bakar — hangisine
     * yazıldığı bu düğümün işi değil, var olması onun işi.
     */
    expect(TUTOR_NAV.length + TUTOR_PANO_SEKMELERI.length).toBeGreaterThanOrEqual(6);
    expect(UYE_NAV.some((i) => i.to === ROUTES.favorites)).toBe(true);
    // ÜK-6: eğitmen menüsünde de var (eskiden `false` çıpalıydı).
    expect(TUTOR_NAV.some((i) => i.to === ROUTES.favorites)).toBe(true);
    // Kapsam: operatörde YOK — favori alıcı yüzeyidir, operatör alıcı değil.
    expect(OPERATOR_NAV.some((i) => i.to === ROUTES.favorites)).toBe(false);
  });
});

describe("üst bar · KALDIRILAN kısayolların hedefi hâlâ erişilebilir", () => {
  const menuyuAc = () =>
    fireEvent.click(screen.getByRole("button", { name: "Hesap menüsü" }));

  it.each([
    ["öğrenci", ROLE_IDS.CLIENT, UYE_NAV],
    ["eğitmen", ROLE_IDS.TUTOR, TUTOR_NAV],
    ["operatör", ROLE_IDS.LIBRARY_OPERATOR, OPERATOR_NAV],
  ])("%s: rol menüsündeki HER hedef hesap menüsünde bağlantı", (_ad, rol, nav) => {
    useAuthStore.setState({
      user: { id: 3, role_id: rol, display_name: "K", email: "k@example.com" },
    } as never);
    sar(nav as NavItem[]);
    menuyuAc();

    const acikHedefler = new Set(
      Array.from(document.body.querySelectorAll("a[href]")).map(
        (a) => a.getAttribute("href") ?? ""
      )
    );
    // Donmuş bölümler (`yakinda`) bilerek bağlantı DEĞİL — kapsam dışı.
    const beklenen = (nav as NavItem[]).filter((i) => !i.yakinda);
    expect(beklenen.length).toBeGreaterThan(0);
    const ulasilamayan = beklenen.filter((i) => !acikHedefler.has(i.to));
    expect(
      ulasilamayan.map((i) => `${i.label} → ${i.to}`),
      "üst bardan kaldırıldı ve menüde de yok: bu ekrana artık gidilemiyor"
    ).toEqual([]);
  });
});

describe("üst bar · bildirim zili kalktı ama BİLDİRİMLER erişilebilir", () => {
  const menuyuAc = () =>
    fireEvent.click(screen.getByRole("button", { name: "Hesap menüsü" }));

  it("`/bildirimler` HİÇBİR rol nav listesinde YOK", () => {
    // Menü girdisinin ZORUNLU olmasının sebebi bu. Biri "nav zaten taşıyor"
    // diye girdiyi silerse, aşağıdaki düğüm değil BU düğüm önce konuşur:
    // varsayım yazılı olduğu için sessizce yanlışlanamaz.
    for (const nav of [UYE_NAV, TUTOR_NAV, OPERATOR_NAV]) {
      expect(nav.some((i) => i.to === ROUTES.notifications)).toBe(false);
    }
  });

  it("üst barda bildirim DÜĞMESİ yok", () => {
    sar(UYE_NAV);
    expect(screen.queryByRole("button", { name: "Bildirimler" })).toBeNull();
  });

  it.each([
    ["öğrenci", ROLE_IDS.CLIENT, UYE_NAV],
    ["eğitmen", ROLE_IDS.TUTOR, TUTOR_NAV],
    ["operatör", ROLE_IDS.LIBRARY_OPERATOR, OPERATOR_NAV],
  ])("%s: hesap menüsünde `/bildirimler` bağlantısı VAR", (_ad, rol, nav) => {
    useAuthStore.setState({
      user: { id: 4, role_id: rol, display_name: "K", email: "k@example.com" },
    } as never);
    sar(nav as NavItem[]);
    menuyuAc();
    const hedefler = Array.from(document.body.querySelectorAll("a[href]")).map(
      (a) => a.getAttribute("href")
    );
    expect(
      hedefler,
      "zil kaldırıldı ve menüde de yok: bildirimlere artık hiçbir yerden gidilemiyor"
    ).toContain(ROUTES.notifications);
  });
});
