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
  UYE_PANO_SEKMELERI,
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
  // Logo bağlantısı KİMLİĞİYLE (`aria-label="Ana sayfa"`) dışarıda tutulur,
  // adresiyle değil (24 Eyl 2026): öğretmenin logosu artık kendi panosuna
  // (`/genel-bakis`) gider (`roleHome`, kullanıcı kararı 22 Eyl 2026). Adresi
  // süzgece yazmak, aynı adrese giden GERÇEK bir kısayolu da gizlerdi.
  const hepsi = Array.from(document.body.querySelectorAll("a[href]"))
    .filter((a) => a.getAttribute("aria-label") !== "Ana sayfa")
    .map((a) => a.getAttribute("href") ?? "")
    .filter((h) => h !== "/" && h !== ROUTES.home);
  return [...new Set(hepsi)].sort();
}

/*
 * ÜK-2 17 Eylül 2026'da DEĞİŞTİ (kullanıcı kararı, Preply üst menüsü
 * örnek gösterilerek): üst barda mesaj + bildirim + (rol menüsünde varsa)
 * favori durur; okunmamış sayılar doğrudan görünür. Kalan her şey hâlâ hesap
 * menüsünde. Nöbetçinin asıl işi değişmedi: menüde ne varsa üst bara
 * basılmasın, üst bardaki kümeyi bilinçli karar belirlesin.
 *
 * 22 Eylül 2026'da DEĞİŞTİ (kullanıcı kararı: "bildirimlere tıklayınca modal
 * açılması yerine tam sayfa açılıyor, düzelt"): bildirim artık `<a href>`
 * DEĞİL — `NotificationsBell` (buton + açılır panel). `UST_BAR_SABIT` bu
 * yüzden yalnız Mesajlar'ı taşır; bildirim düğmesinin varlığı ayrıca,
 * `screen.getByRole("button", { name: "Bildirimler" })` ile ölçülür. Panelin
 * kendi içindeki "Tüm bildirimleri gör" bağlantısı tam sayfayı KAPATMAZ,
 * üstüne bir hızlı-bakış ekler (bkz. aşağıdaki üçüncü `describe`).
 *
 * 24 Eylül 2026'da GÜNCELLENDİ (iki kullanıcı kararı bu nöbetçiye
 * yansıtılmamıştı):
 *  - Mesajlar da artık `<a href>` DEĞİL (22 Eyl 2026, Preply referansı:
 *    "mesajlar sayfasında değilken tam sayfa yerine panel açılsın") —
 *    `MesajlarPaneli` düğmesi. Yalnız `/mesajlar` sayfasındayken düz
 *    bağlantıdır. `UST_BAR_SABIT` bu yüzden BOŞ; mesaj ve bildirim
 *    `UST_BAR_DUGMELERI` ile, düğme olarak ölçülür.
 *  - Öğretmende üst bara CÜZDAN düğmesi girdi (23 Eyl 2026, "feat(cuzdan)":
 *    ayrı kazançlar ekranı kalktı, bakiye + "Para çek" bu kutuda). Yalnız
 *    öğretmende vardır; öğrencide OLMADIĞI da ölçülür.
 */
const UST_BAR_SABIT: string[] = [];
const UST_BAR_DUGMELERI = ["Mesajlar", "Bildirimler"];

function dugmelerVar(adlar: string[]) {
  for (const ad of adlar) {
    expect(screen.getAllByRole("button", { name: ad }).length, `üst barda "${ad}" düğmesi yok`)
      .toBeGreaterThan(0);
  }
}

describe("üst bar · mesaj + bildirim + favori (ÜK-2)", () => {
  it("öğrencide mesaj + bildirim (panel düğmeleri) + Favorilerim — cüzdan YOK", () => {
    sar(UYE_NAV);
    expect(ustBardakiHedefler()).toEqual([...UST_BAR_SABIT, ROUTES.favorites].sort());
    dugmelerVar(UST_BAR_DUGMELERI);
    expect(screen.queryByRole("button", { name: "Cüzdan" })).toBeNull();
  });

  it("öğretmende mesaj + bildirim + cüzdan (panel düğmeleri) — bağlantı YOK, kalp YOK, favoriler hesap menüsünde", () => {
    // 18 Eyl 2026'da DEĞİŞTİ (kullanıcı kararı): Preply'da favori yalnız
    // "favori öğretmen"dir ve eğitmenin üst barında kalp yoktur. Eğitmenin
    // favorileri menüde kalır (`ustBarda: false`), üst bara çıkmaz.
    // Aşağıdaki tarihçe önceki kararındır.
    // 6 Eyl 2026'da DEĞİŞTİ. Önce "eğitmende HİÇ kısayol yok" iddia
    // ediliyordu, sebebi favorilerin eğitmene kapalı olmasıydı — kararın
    // kendisi değil, o günkü kısıtın yansımasıydı. ÜK-6 favoriyi eğitmene
    // açtı; ÜK-2'nin ASIL kuralı ("en fazla TEK kısayol, o da Favorilerim")
    // bozulmadı, iki rolde de aynı tek kısayol var.
    useAuthStore.setState({
      user: { id: 2, role_id: ROLE_IDS.TUTOR, display_name: "Öğretmen", email: "e@example.com" },
    } as never);
    sar(TUTOR_NAV);
    expect(ustBardakiHedefler()).toEqual([...UST_BAR_SABIT].sort());
    dugmelerVar([...UST_BAR_DUGMELERI, "Cüzdan"]);
    // Menüden düşmedi: favoriler hesap menüsünden hâlâ açılır.
    expect(TUTOR_NAV.some((i) => i.to === ROUTES.favorites)).toBe(true);
  });

  it("üst bara menüden BAŞKA kısayol sızmaz — üçüncü bağlantı eklenirse kırılır", () => {
    // ÜK-2'nin sayısal çıpası: sabit bağlantılar + en fazla favori.
    // 24 Eyl 2026: sabit bağlantı kalmadı (Mesajlar da düğme oldu), tavan
    // 2'den 1'e indi — gevşek kalsaydı ikinci bir kısayol sessizce sığardı.
    for (const nav of [UYE_NAV, TUTOR_NAV, OPERATOR_NAV]) {
      cleanup();
      sar(nav);
      const hedefler = ustBardakiHedefler();
      expect(hedefler.length).toBeLessThanOrEqual(UST_BAR_SABIT.length + 1);
      for (const h of hedefler) {
        expect([...UST_BAR_SABIT, ROUTES.favorites]).toContain(h);
      }
    }
  });

  it("DOLULUK: rol menüsü gerçekten kalabalık — kısayollar boş listeden gelmiyor", () => {
    // Bu olmadan yukarıdaki iki iddia, `nav.ts` boşalsa da yeşil kalırdı.
    // Eşik 4'ten 3'e indi (7 Eyl 2026): Kütüphaneler ve Mağaza özel dersin
    // yan panelinden çıktı (kullanıcı kararı, bkz. `lib/nav.ts`). Bu düğümün
    // işi menünün DOLU olduğunu kanıtlamaktır, kaç kalem olduğunu dondurmak
    // değil — eşik kararla birlikte gerekçesiyle indi.
    // Öğrencide de kapı iki yüzeyin BİRLEŞİMİNE bakar (Modül 4, 18 Eyl 2026):
    // Mesajlar ve Rezervasyonlar menüden şeride taşındı, menüde Favorilerim
    // kaldı. Gerekçe aşağıdaki eğitmen paragrafıyla aynı.
    expect(UYE_NAV.length + UYE_PANO_SEKMELERI.length).toBeGreaterThanOrEqual(3);
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
    // 6 → 5 (17 Eyl 2026): "Bakiyem" sekmesi kalktı; kazanç dökümü panodaki
    // özet kartlarından açılıyor (erişilebilirliği `panoSeridi.test.tsx` korur).
    expect(TUTOR_NAV.length + TUTOR_PANO_SEKMELERI.length).toBeGreaterThanOrEqual(5);
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

  it("yönetici hesabındaki Yönetim Paneli yeni paneli açar", () => {
    useAuthStore.setState({
      user: { id: 4, role_id: ROLE_IDS.ADMIN, display_name: "Yönetici", email: "a@example.com" },
    } as never);
    sar([]);
    menuyuAc();

    expect(screen.getByRole("link", { name: "Yönetim Paneli" })).toHaveAttribute(
      "href",
      ROUTES.adminNew
    );
  });

  // Eğitmen bu listede YOK (22 Eyl 2026, kullanıcı kararı): masaüstü avatar
  // menüsü sabit bir listedir (aşağıdaki "eğitmen avatar menüsü" düğümü);
  // `TUTOR_NAV` yalnız mobil çekmecede çizilir.
  it.each([
    ["öğrenci", ROLE_IDS.CLIENT, UYE_NAV],
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

describe("üst bar · bildirim paneli açılıyor VE tam sayfa hâlâ erişilebilir", () => {
  /*
   * Bu describe'ın adı 22 Eylül 2026'da DEĞİŞTİ. Eskiden "bildirim zili
   * kalktı" başlığı altında üst barda bildirim DÜĞMESİ OLMADIĞI iddia
   * ediliyordu (o zamanki karar: zil tamamen kalksın, tek erişim hesap
   * menüsündeki tam-sayfa bağlantı olsun). Kullanıcı kararı bunu tersine
   * çevirdi: "bildirimlere tıklayınca modal açılması yerine tam sayfa
   * açılıyor, düzelt" — yani şimdi TERSİ doğru olmalı: üst barda bir düğme
   * OLMALI ve tam sayfaya GİTMEDEN önce bir panel açmalı. Tam sayfaya giden
   * yol (hesap menüsü + panelin kendi "Tüm bildirimleri gör" bağlantısı)
   * KORUNDU — kaldırılan bir şey yok, eklenen bir kısayol var.
   */
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

  it("üst barda bildirim DÜĞMESİ var ve tıklayınca panel açılır (tam sayfaya SIÇRAMADAN)", () => {
    sar(UYE_NAV);
    const dugme = screen.getByRole("button", { name: "Bildirimler" });
    expect(dugme).toBeTruthy();
    // Panel açılmadan önce sayfa DEĞİŞMEDİ — hâlâ aynı bileşendeyiz (jsdom'da
    // "navigasyon olmadı" doğrudan ölçülemez, ama panelin kendisi DOM'a
    // girer; bu, bir <a href> tıklamasının tetikleyeceği tam sayfa geçişinden
    // FARKLI bir mekanizma olduğunu kanıtlar).
    fireEvent.click(dugme);
    expect(
      screen.getByRole("link", { name: /Tüm bildirimleri gör/ }),
      "panel açıldı ama tam sayfaya giden yol kayıp"
    ).toHaveAttribute("href", ROUTES.notifications);
  });

  // Öğretmen ve öğrenci YOK: ikisinin de avatar menüsü sabit liste (22 Eyl
  // 2026); tam sayfaya zil panelindeki "Tüm bildirimleri gör" götürür
  // (yukarıdaki düğüm).
  it.each([
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

describe("öğretmen avatar menüsü (kullanıcı kararı, 22 Eyl 2026)", () => {
  it("sıra: Mesajlar · Öğrenciler · Takvim · Analizler · Profilim · Ayarlar · Yardım · Oturumu kapat", () => {
    useAuthStore.setState({
      user: { id: 5, role_id: ROLE_IDS.TUTOR, display_name: "E", email: "e@example.com" },
    } as never);
    sar(TUTOR_NAV as NavItem[]);
    fireEvent.click(screen.getByRole("button", { name: "Hesap menüsü" }));

    const menu = screen.getByRole("button", { name: "Oturumu kapat" }).parentElement!;
    const satirlar = Array.from(menu.querySelectorAll("a, button")).map((el) =>
      (el.textContent ?? "").trim()
    );
    expect(satirlar).toEqual([
      "Mesajlar",
      "Öğrenciler",
      "Takvim",
      "Analizler",
      "Profilim",
      "Ayarlar",
      "Yardım",
      "Oturumu kapat",
    ]);
    expect(screen.getByRole("link", { name: "Yardım" })).toHaveAttribute("href", ROUTES.faq);
    expect(screen.getByRole("link", { name: "Öğrenciler" })).toHaveAttribute(
      "href",
      ROUTES.tutorStudents
    );
    expect(screen.getByRole("link", { name: "Profilim" })).toHaveAttribute(
      "href",
      ROUTES.tutorListing
    );
  });
});

describe("öğrenci avatar menüsü (kullanıcı kararı, 22 Eyl 2026)", () => {
  it("sıra: Genel Bakış · Mesajlar · Derslerim · Favorilerim · Ayarlar · Yardım · Oturumu kapat", () => {
    useAuthStore.setState({
      user: { id: 6, role_id: ROLE_IDS.CLIENT, display_name: "Ö", email: "o@example.com" },
    } as never);
    sar(UYE_NAV as NavItem[]);
    fireEvent.click(screen.getByRole("button", { name: "Hesap menüsü" }));

    const menu = screen.getByRole("button", { name: "Oturumu kapat" }).parentElement!;
    const satirlar = Array.from(menu.querySelectorAll("a, button")).map((el) =>
      (el.textContent ?? "").trim()
    );
    expect(satirlar).toEqual([
      "Genel Bakış",
      "Mesajlar",
      "Derslerim",
      "Favorilerim",
      "Ayarlar",
      "Yardım",
      "Oturumu kapat",
    ]);
    expect(screen.getByRole("link", { name: "Derslerim" })).toHaveAttribute(
      "href",
      ROUTES.reservations
    );
  });
});
