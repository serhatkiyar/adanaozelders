/**
 * ÜK-6 · favori rol kapısı — nöbetçi.
 *
 * ## Karar
 *
 * Eğitmen de eğitmen ve kütüphane favorileyebilir
 * (`docs/urun-kararlari.md` · ÜK-6). Sunucu tarafında istek gölge `Client`e
 * çevrilir; arayüzün tek işi düğmeyi doğru rollere göstermek.
 *
 * ## Bu nöbetçinin ASIL iddiası — ÖLÜ UÇ YOK
 *
 * Düğmeyi açmak tek başına yetmez. Eğitmen favorileyip listesini göremezse
 * ortaya ölü bir uç çıkar; bu oturumda bildirim zilinde tam olarak o tuzağa
 * düşülmüştü (ÜK-2). Bu yüzden burada ÜÇ katman birlikte çıpalanır:
 *
 *   1. düğme eğitmen oturumunda RENDER OLUR,
 *   2. `/favoriler` rotası eğitmene AÇIKTIR,
 *   3. eğitmen menüsünde bağlantısı VARDIR.
 *
 * Üçünden biri geri alınırsa düğüm kırılır.
 *
 * ## Kapsam sınırı
 *
 * Favori ALICI yüzeyidir. Operatör, kurye ve admin alıcı değildir; düğme
 * onlara gösterilmez (gösterilse sunucudan 403 alırlardı). Anonim ziyaretçiye
 * gösterilmeye devam eder — tıklayınca giriş modalı açılır.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Gerçek DOM (jsdom + gerçek bileşen). Sunucunun eğitmene 204 döndüğünü
 * KANITLAMAZ; onun kanıtı `tests/integration/test_tutor_shopper_pg.py`
 * K-22/K-23'tedir.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { BookmarkButton } from "@/components/BookmarkButton";
import { NiyetUygulayici } from "@/components/NiyetUygulayici";
import { niyetiGozle, niyetiSakla, niyetiTemizle } from "@/lib/bekleyenNiyet";
import { useAuthStore } from "@/store/authStore";
import { LibraryBookmarkButton } from "@/components/LibraryBookmarkButton";
import { OPERATOR_NAV, TUTOR_NAV, UYE_NAV } from "@/lib/nav";
import { ALISVERIS_ROLLERI, alisverisYapabilir } from "@/lib/roles";
import { ROUTES } from "@/lib/routes";
import { ROLE_IDS } from "@/types";

const KOK = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  ".."
);

function sar(roleId: number | null) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (roleId != null) {
    qc.setQueryData(["me"], {
      id: 7,
      role_id: roleId,
      display_name: "Test",
      email: "t@example.com",
    });
  }
  qc.setQueryData(["bookmarks"], []);
  qc.setQueryData(["library-bookmarks"], []);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BookmarkButton tutorId={1} />
        <LibraryBookmarkButton libraryId={2} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** `NiyetUygulayici`yı tek başına, verilen rolde çizer. */
function ciz(roleId: number) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  useAuthStore.setState({
    token: "t",
    user: { id: 7, role_id: roleId, display_name: "Test", email: "t@example.com" },
  } as never);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NiyetUygulayici />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Giden istek yollarını toplar; ağ yok. */
function adapteriSahtele(): string[] {
  const yollar: string[] = [];
  apiClient.defaults.adapter = async (config) => {
    yollar.push(String(config.url));
    return {
      data: null,
      status: 204,
      statusText: "No Content",
      headers: {},
      config,
    } as never;
  };
  return yollar;
}

/** Favori düğmesi DOM'da var mı (iki düğme de `button` basar). */
function dugmeSayisi(): number {
  return screen.queryAllByRole("button").length;
}

const eskiAdapter = apiClient.defaults.adapter;
afterEach(() => {
  cleanup();
  niyetiTemizle();
  apiClient.defaults.adapter = eskiAdapter;
  useAuthStore.setState({ token: null, user: null } as never);
});

describe("ÜK-6 · favori düğmesi doğru rollere görünür", () => {
  it("EĞİTMEN oturumunda düğmeler RENDER OLUR", () => {
    // Kararın kendisi. Değişiklikten önce ikisi de `null` dönüyordu.
    sar(ROLE_IDS.TUTOR);
    expect(dugmeSayisi()).toBe(2);
  });

  it("üye oturumunda değişen bir şey yok", () => {
    sar(ROLE_IDS.CLIENT);
    expect(dugmeSayisi()).toBe(2);
  });

  it("anonim ziyaretçide gösterilmeye devam eder (giriş modalı yolu)", () => {
    sar(null);
    expect(dugmeSayisi()).toBe(2);
  });

  it.each([
    ["admin", ROLE_IDS.ADMIN],
    ["operatör", ROLE_IDS.LIBRARY_OPERATOR],
    ["kurye", ROLE_IDS.COURIER],
  ])("%s alıcı değildir — düğme YOK", (_ad, roleId) => {
    // Kapsam çıpası. Bu olmadan "herkese göster" da yeşil kalırdı ve o roller
    // sunucudan 403 alan bir düğmeye tıklardı.
    sar(roleId);
    expect(dugmeSayisi()).toBe(0);
  });

  it("DOLULUK: rol kapısı gerçekten iki rol tanıyor", () => {
    // `ALISVERIS_ROLLERI` boşalsa yukarıdaki "düğme YOK" iddiaları bedava
    // geçer, "render olur" iddiaları ise kırılırdı; bu düğüm listeyi de tutar.
    expect([...ALISVERIS_ROLLERI].sort()).toEqual(
      [ROLE_IDS.CLIENT, ROLE_IDS.TUTOR].sort()
    );
    expect(alisverisYapabilir(ROLE_IDS.TUTOR)).toBe(true);
    expect(alisverisYapabilir(ROLE_IDS.LIBRARY_OPERATOR)).toBe(false);
  });
});

describe("favori düğmesinin GÖRÜNÜMÜ", () => {
  /* Kullanıcı kararı, 7 Eyl 2026: *"favorileme ve paylaşma sembolleri
     olmamış."* Ölçüldü ve haklıydı — kart içindeki iki düğme ayrışmıştı:

       paylaş : dairesel gri zemin + çizgi ikon
       kalp   : zemin YOK + DOLU açık gri kalp

     Dolu gri kalp "favorilenmiş ama pasif" gibi okunuyordu; oysa favori
     DEĞİLDİ. Kalp artık favorilenmemişken çizgi, favorilenince dolu; kap da
     paylaş düğmesiyle aynı daire. */

  const kalpSvg = (): SVGElement => {
    const svg = document.querySelector("button svg");
    expect(svg, "kalp çizilmedi").toBeTruthy();
    return svg as SVGElement;
  };

  it("kart içinde (onSolid) favorilenmemiş kalp DOLU DEĞİL", () => {
    // Asıl kusur sınıfı. `fill-slate-300` görsel olarak "dolu" demekti.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["me"], { id: 7, role_id: ROLE_IDS.CLIENT, display_name: "T", email: "t@x.co" });
    qc.setQueryData(["bookmarks"], []);
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <BookmarkButton tutorId={1} size="md" onSolid />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const sinif = kalpSvg().getAttribute("class") ?? "";
    expect(sinif, "kalp dolu görünüyor ama favori değil").toContain("fill-none");
    expect(sinif).not.toContain("fill-slate");
  });

  it("kart içinde kalp, paylaş düğmesiyle AYNI dairesel kabı taşır", () => {
    // İkisi yan yana duruyor; ölçü ve zemin ayrışırsa göze batıyor.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["me"], { id: 7, role_id: ROLE_IDS.CLIENT, display_name: "T", email: "t@x.co" });
    qc.setQueryData(["bookmarks"], []);
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <BookmarkButton tutorId={1} size="md" onSolid />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const sinif = screen.getByRole("button").className;
    for (const parca of ["rounded-full", "h-9", "w-9", "bg-slate-100"]) {
      expect(sinif, `kap '${parca}' taşımıyor`).toContain(parca);
    }
  });
});

describe("ÜK-6 · ölü uç yok — favorileyen listesini de görebilir", () => {
  it("eğitmen menüsünde Favorilerim bağlantısı VAR", () => {
    expect(TUTOR_NAV.some((i) => i.to === ROUTES.favorites)).toBe(true);
    expect(UYE_NAV.some((i) => i.to === ROUTES.favorites)).toBe(true);
    expect(OPERATOR_NAV.some((i) => i.to === ROUTES.favorites)).toBe(false);
  });

  it("giriş sonrası favori niyeti EĞİTMENDE de uygulanır", async () => {
    /*
     * Beşinci katman — 9 Eyl 2026'da KAYNAK TARAMASINDAN DAVRANIŞA yükseltildi.
     *
     * Eski hâli `PendingFavoriteApplier.tsx`i okuyup erken dönüşün koşul
     * METNİNİ ölçüyordu. Kendi yorumu bile yaklaşımın zayıflığını itiraf
     * ediyordu: ilk yazımda `toContain("alisverisYapabilir")` mutasyon
     * provasında YAKALAMAMIŞTI, çünkü `import` satırı ifadeyi ayakta
     * tutuyordu. Metin ölçmek, dosya yeniden adlandırıldığı anda da kırılır.
     *
     * Artık ölçülen şey isteğin GERÇEKTEN GİDİP GİTMEDİĞİ. Rol kapısı
     * eğitmeni dışarıda bırakırsa niyet tüketilmiştir ama kalp dolmaz ve
     * kullanıcı neden olmadığını göremez — bu düğüm o sessizliği kırar.
     */
    niyetiSakla({ tip: "favori", hedef: "egitmen", id: 42 });
    const yollar = adapteriSahtele();

    ciz(ROLE_IDS.TUTOR);
    await waitFor(() =>
      expect(yollar.some((u) => u.includes("/bookmarks/42"))).toBe(true)
    );
  });

  it("OPERATÖRDE favori niyeti uygulanmaz", async () => {
    // Kapsam çıpası: yukarıdaki iddia "herkese uygula" biçiminde geri
    // alınırsa sunucu 403 dönerdi.
    niyetiSakla({ tip: "favori", hedef: "egitmen", id: 42 });
    const yollar = adapteriSahtele();

    ciz(ROLE_IDS.LIBRARY_OPERATOR);
    await Promise.resolve();
    expect(yollar.some((u) => u.includes("/bookmarks/42"))).toBe(false);
  });

  it("BAŞKA tipteki niyet global uygulayıcıda TÜKETİLMEZ", async () => {
    // Ders talebi niyeti kendi sayfasında uygulanır. Global uygulayıcı onu
    // yerse kullanıcı giriş yapar, rezervasyon penceresi hiç açılmaz ve
    // hiçbir hata görünmez — ÜK-6'nın dersinin birebir tekrarı.
    niyetiSakla({ tip: "dersTalebi", egitmenId: 42 });
    const yollar = adapteriSahtele();

    ciz(ROLE_IDS.CLIENT);
    await Promise.resolve();
    expect(yollar).toEqual([]);
    expect(niyetiGozle()).toEqual({ tip: "dersTalebi", egitmenId: 42 });
  });

  it("`/favoriler` rotası alışveriş rollerine açık — CLIENT'a kilitli DEĞİL", async () => {
    // KAYNAK SÖZLEŞMESİ: rota tanımı `App.tsx`te; render etmek uygulamanın
    // tamamını ayağa kaldırmayı gerektirirdi. Ölçülen şey rotanın hangi rol
    // kapısının ALTINDA durduğu.
    const kaynak = readFileSync(join(KOK, "src", "App.tsx"), "utf8");
    const i = kaynak.indexOf("PATHS.favorites");
    expect(i, "PATHS.favorites App.tsx'te bulunamadı").toBeGreaterThan(0);
    // Rotayı saran EN YAKIN üstteki `ProtectedRoute` satırı.
    const oncesi = kaynak.slice(0, i);
    const kapi = oncesi.slice(oncesi.lastIndexOf("<ProtectedRoute"));
    expect(kapi).toContain("ALISVERIS_ROLLERI");
    expect(kapi).not.toContain("allowedRoleId={ROLE_IDS.CLIENT}");
  });
});
