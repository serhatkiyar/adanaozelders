/**
 * KATEGORİ SEKMESİ GERÇEKTEN GEZİNİR — adres değişir.
 *
 * ## Karar (kullanıcı, 9 Eyl 2026)
 *
 * > *"neden menüde eğitmenler kütüphaneler tıklayınca urlde değişiklik
 * > olmuyor? /egitmenler /kutuphaneler olsa daha mantıklı değil mi?"*
 *
 * ## Ölçtüğü kusur sınıfı
 *
 * `CategoryBar` iki kipli bir bileşendi: `onSelect` verilirse `<button>`,
 * verilmezse `<Link>` basıyordu. Ana sayfa buton kipini kullanıyordu, yani
 * sekmeye tıklamak yalnız Landing'in yerel state'ini değiştiriyordu. Sonucu
 * ölçüldü: "Kütüphaneler" seçili ekran PAYLAŞILAMIYOR, geri tuşu sekmeyi geri
 * ALMIYOR, sayfa yenilenince ilk sekmeye düşülüyordu. Üstelik aynı çubukta
 * "Mağaza" her zaman `<Link>`ti — bir çubuk, iki tür öğe.
 *
 * Geri tuşunu kırmak Nielsen'in 1999 "en büyük 10 kullanılabilirlik hatası"
 * listesinde 1 numaraydı; Baymard'ın ölçümünde e-ticaret sitelerinin %27'si
 * hâlâ aynı kusuru taşıyor.
 *
 * Bu kusur SESSİZDİR: ekran doğru içeriği gösterir, yalnız adres yalan söyler.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Gerçek `CategoryBar`ı gerçek router'da basar ve gerçek tıklama gönderir;
 * konumun değiştiğini ÖLÇER. Landing'in çubuğu nereye koyduğunu görmez —
 * onu `bolumDondurma` ailesi ölçüyor.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { CategoryBar } from "@/components/CategoryBar";
import { ROUTES } from "@/lib/routes";

function AdresYansitici() {
  const konum = useLocation();
  return <div data-testid="adres">{konum.pathname + konum.search}</div>;
}

function sar(active?: Parameters<typeof CategoryBar>[0]["active"]) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <AdresYansitici />
      <CategoryBar active={active} />
    </MemoryRouter>
  );
}

const adres = () => screen.getByTestId("adres").textContent ?? "";

describe("kategori sekmesi · gerçek gezinme", () => {
  it("DOLULUK: çubuk gerçekten kategori basıyor", () => {
    sar();
    // Liste boşalırsa ya da render kırılırsa aşağıdaki iddialar hiçbir şey
    // ölçmeden yeşil kalırdı.
    expect(screen.getAllByRole("link").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("Eğitmenler")).toBeTruthy();
  });

  it("çubukta HİÇBİR `button` yok — hepsi bağlantı", () => {
    sar();
    // Asıl kusur buydu: aynı çubukta bazı öğe buton, bazısı link.
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("Kütüphaneler'e tıklamak adresi `/kutuphaneler` yapar", () => {
    sar("egitmenler");
    fireEvent.click(screen.getByText("Kütüphaneler"));
    expect(adres()).toBe(ROUTES.libraries);
  });

  it("Eğitmenler'e tıklamak KEŞİF yüzeyine (`/`) götürür, arama sonucuna DEĞİL", () => {
    /*
     * HEDEF 10 Eyl 2026'da DEĞİŞTİ (kullanıcı kararı), iddia zayıflamadı.
     *
     * Eskiden `/egitmenler`e, yani sorgusuz bir ARAMA SONUÇLARI ekranına
     * gidiyordu. Kullanıcı: *"ana sayfadayken kategori değiştirirken arama
     * sonucu gösterilmeyecek."* Kategori değiştirmek arama yapmak değildir;
     * hedef artık kökteki eğitmen vitrini. `/egitmenler` aramanın kendi
     * adresi olarak durur ve oraya arama hapından gidilir.
     */
    sar("kutuphaneler");
    fireEvent.click(screen.getByText("Eğitmenler"));
    expect(adres()).toBe(ROUTES.home);
    expect(adres(), "kategori hâlâ arama sonucuna götürüyor").not.toBe(
      ROUTES.tutors
    );
  });

  it("aktif sekme `aria-current=page` taşır (görsel değil anlamsal)", () => {
    // Aktiflik yalnız alt çizgiyle anlatılsaydı ekran okuyucu için görünmezdi.
    sar("kutuphaneler");
    const aktif = screen.getByText("Kütüphaneler").closest("a");
    expect(aktif?.getAttribute("aria-current")).toBe("page");
  });
});
