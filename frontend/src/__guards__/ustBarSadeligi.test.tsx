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
 * Artık üst barda **en fazla tek kısayol** var (Favorilerim, yalnız o rolde);
 * geri kalan her şey hesap menüsünden açılır.
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
import { OPERATOR_NAV, STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
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
      full_name: "Test Kullanıcı",
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
    sar(STUDENT_NAV);
    expect(ustBardakiHedefler()).toEqual([ROUTES.favorites]);
  });

  it("eğitmende HİÇ kısayol yok (Favoriler onun menüsünde değil)", () => {
    useAuthStore.setState({
      user: { id: 2, role_id: ROLE_IDS.TUTOR, full_name: "Eğitmen", email: "e@example.com" },
    } as never);
    sar(TUTOR_NAV);
    expect(ustBardakiHedefler()).toEqual([]);
  });

  it("DOLULUK: rol menüsü gerçekten kalabalık — kısayollar boş listeden gelmiyor", () => {
    // Bu olmadan yukarıdaki iki iddia, `nav.ts` boşalsa da yeşil kalırdı.
    expect(STUDENT_NAV.length).toBeGreaterThanOrEqual(4);
    expect(TUTOR_NAV.length).toBeGreaterThanOrEqual(4);
    expect(STUDENT_NAV.some((i) => i.to === ROUTES.favorites)).toBe(true);
    expect(TUTOR_NAV.some((i) => i.to === ROUTES.favorites)).toBe(false);
  });
});

describe("üst bar · KALDIRILAN kısayolların hedefi hâlâ erişilebilir", () => {
  const menuyuAc = () =>
    fireEvent.click(screen.getByRole("button", { name: "Hesap menüsü" }));

  it.each([
    ["öğrenci", ROLE_IDS.CLIENT, STUDENT_NAV],
    ["eğitmen", ROLE_IDS.TUTOR, TUTOR_NAV],
    ["operatör", ROLE_IDS.LIBRARY_OPERATOR, OPERATOR_NAV],
  ])("%s: rol menüsündeki HER hedef hesap menüsünde bağlantı", (_ad, rol, nav) => {
    useAuthStore.setState({
      user: { id: 3, role_id: rol, full_name: "K", email: "k@example.com" },
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
