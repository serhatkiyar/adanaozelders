/**
 * GİRİŞ KAPISI FİLTRELERİ UÇURMAZ — canlı bir bug'ın nöbetçisi.
 *
 * ## Ölçülmüş kusur (9 Eyl 2026'ya kadar üretimde)
 *
 * Kapı sekiz ayrı yerde `<Link to="?modal=login">` / `navigate("?modal=login")`
 * ile elle kuruluyordu. React Router'da search-only bir `to`, mevcut sorguyu
 * **birleştirmez, DEĞİŞTİRİR**. Yani
 * `/egitmenler?ders=Matematik&ilce=Seyhan&sirala=puan&sayfa=2` sayfasında kalbe
 * basmak dört parametreyi de siliyordu; kullanıcı giriş yapıp pencereyi
 * kapattığında filtresiz listeye düşüyordu.
 *
 * Kusur SESSİZDİR: hata yok, uyarı yok, sayfa çalışmaya devam ediyor — yalnız
 * gösterilen liste artık kullanıcının aradığı liste değil. Filtreler URL
 * şemasına taşındıkça (`lib/aramaUrl.ts`) her yeni filtre bu kaybı büyütüyordu.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * İki katman: saf kodek iddiaları (`girisAdresi`) ve GERÇEK DOM'da gerçek
 * tıklama (`BookmarkButton` + `MemoryRouter`). İkincisi olmadan kodek doğru
 * olup çağrı yeri onu hiç kullanmıyor olabilirdi. Sunucu davranışını
 * KANITLAMAZ.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { BookmarkButton } from "@/components/BookmarkButton";
import { girisAdresi } from "@/lib/girisAdresi";
import { niyetiGozle, niyetiTemizle } from "@/lib/bekleyenNiyet";
import { useAuthStore } from "@/store/authStore";

/* ─── Saf kodek ──────────────────────────────────────────────────────── */

const sp = (q: string) => new URLSearchParams(q);
const anahtarlar = (adres: string) => [
  ...new URLSearchParams(adres.slice(1)).keys(),
];

describe("giriş adresi · saf kodek", () => {
  it("MEVCUT ANAHTARLAR KORUNUR", () => {
    // Bug'ın kapandığı satırın doğrudan ölçümü.
    const adres = girisAdresi(sp("ders=Matematik&ilce=Seyhan&sayfa=2"));
    const p = new URLSearchParams(adres.slice(1));
    expect(p.get("ders")).toBe("Matematik");
    expect(p.get("ilce")).toBe("Seyhan");
    expect(p.get("sayfa")).toBe("2");
    expect(p.get("modal")).toBe("login");
  });

  it("YOL değiştirmez — yalnız arama dizesi döner", () => {
    // `/egitmenler` yerine `/?modal=login` üretmek kullanıcıyı sayfadan atardı.
    expect(girisAdresi(sp(""))).toBe("?modal=login");
    expect(girisAdresi(sp("a=1")).startsWith("?")).toBe(true);
  });

  it("çağıranın parametrelerini YERİNDE DEĞİŞTİRMEZ", () => {
    // `useSearchParams()` nesnesi mutable; yerinde değiştirmek sessiz bug.
    const mevcut = sp("ders=Matematik");
    girisAdresi(mevcut, "register", "tutor");
    expect([...mevcut.keys()]).toEqual(["ders"]);
  });

  it("eski Google hatası yeni pencereye TAŞINMAZ", () => {
    expect(anahtarlar(girisAdresi(sp("hata=oauth_iptal&q=x")))).not.toContain("hata");
  });

  it("rol verilmezse `role` SİLİNİR (kalıntı bırakmaz)", () => {
    // Eğitmen kaydından çıkıp normal girişe dönen kullanıcı, hâlâ "eğitmen
    // kaydı" kipinde bir pencere görmemeli.
    expect(anahtarlar(girisAdresi(sp("role=tutor")))).not.toContain("role");
    expect(girisAdresi(sp(""), "register", "tutor")).toContain("role=tutor");
  });

  it("İDEMPOTENT: zaten açık pencerede ikinci çağrı anahtarı çoğaltmaz", () => {
    const bir = girisAdresi(sp("ders=Matematik"));
    const iki = girisAdresi(new URLSearchParams(bir.slice(1)));
    expect(new URLSearchParams(iki.slice(1)).getAll("modal")).toEqual(["login"]);
  });
});

/* ─── Gerçek tıklama ─────────────────────────────────────────────────── */

function AdresGozcusu() {
  const konum = useLocation();
  return <div data-testid="adres">{konum.pathname + konum.search}</div>;
}

function ciz(adres: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(["bookmarks"], []);
  qc.setQueryData(["library-bookmarks"], []);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[adres]}>
        <AdresGozcusu />
        <BookmarkButton tutorId={42} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const adres = () => screen.getByTestId("adres").textContent ?? "";

afterEach(() => {
  cleanup();
  niyetiTemizle();
  useAuthStore.setState({ token: null, user: null } as never);
});

describe("giriş kapısı · filtreli listede tıklama", () => {
  it("ASIL İDDİA: dört filtre de KALIR ve pencere açılır", () => {
    ciz("/egitmenler?ders=Matematik&ilce=Seyhan&sirala=puan&sayfa=2");
    fireEvent.click(screen.getByRole("button"));

    const p = new URLSearchParams(adres().split("?")[1]);
    expect(p.get("ders"), "ders filtresi uçtu").toBe("Matematik");
    expect(p.get("ilce"), "ilçe filtresi uçtu").toBe("Seyhan");
    expect(p.get("sirala"), "sıralama uçtu").toBe("puan");
    expect(p.get("sayfa"), "sayfa uçtu").toBe("2");
    expect(p.get("modal")).toBe("login");
    expect(adres().startsWith("/egitmenler")).toBe(true);
  });

  it("niyet SAKLANIR (giriş sonrası tekrar tıklamak gerekmesin)", () => {
    ciz("/egitmenler?ders=Matematik");
    fireEvent.click(screen.getByRole("button"));
    expect(niyetiGozle()).toEqual({ tip: "favori", hedef: "egitmen", id: 42 });
  });

  it("GİRİŞLİ kullanıcıda pencere AÇILMAZ", () => {
    /*
     * Kapı `token`a bakar, `useCurrentUser().data`ya değil. `user` token
     * varken kısa süre `undefined` kalıyor; kapı ona baksaydı o pencerede
     * kalbe basan GİRİŞLİ kullanıcıya giriş penceresi açılırdı.
     */
    useAuthStore.setState({ token: "t", user: null } as never);
    ciz("/egitmenler?ders=Matematik");
    fireEvent.click(screen.getByRole("button"));

    expect(adres()).not.toContain("modal=login");
    expect(niyetiGozle()).toBeNull();
  });
});
