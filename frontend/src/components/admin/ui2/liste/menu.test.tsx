/**
 * İP-B2 — açılır menünün klavye ve odak sözleşmesi.
 *
 * Menü panelin üç yerinde kullanılıyor (satır aksiyonları, "Filtre ekle",
 * "Sırala") ve üçünde de aynı davranışı vermek zorunda. Radix yerine elle
 * yazılmasının gerekçesi `menu.tsx`in başında: jsdom `pointer capture` ve
 * `pointermove` uygulamadığı için Radix menüsünün davranışı ancak shim'lerle
 * ölçülebiliyor ve o shim'ler ürünü değil test ortamının kılığını ölçüyor
 * (İP-A7d5'in dersi).
 *
 * Bedeli: davranışı bizim garanti etmemiz. Bu dosya o garantiyi tutar.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Menu, MenuOgesi } from "./menu";

function bas(onSec = vi.fn()) {
  const sonuc = render(
    <div>
      <button type="button">dışarıdaki düğme</button>
      <Menu etiket="Kayıt işlemleri">
        {(kapat) => (
          <>
            <MenuOgesi
              onSec={() => {
                kapat();
                onSec();
              }}
            >
              Birinci
            </MenuOgesi>
            <MenuOgesi onSec={kapat}>İkinci</MenuOgesi>
            <MenuOgesi onSec={kapat}>Üçüncü</MenuOgesi>
          </>
        )}
      </Menu>
    </div>
  );
  return { ...sonuc, tetikleyici: screen.getByRole("button", { name: "Kayıt işlemleri" }) };
}

describe("İP-B2 · menü — açılma ve kapanma", () => {
  it("kapalıyken içerik DOM'DA YOK", () => {
    bas();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("tıklayınca açılır ve aria-expanded doğruyu söyler", () => {
    const { tetikleyici } = bas();
    fireEvent.click(tetikleyici);
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(tetikleyici.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
  });

  it("ESC kapatır VE odağı tetikleyiciye döndürür", () => {
    // Odağın dönmesi kozmetik değil: dönmezse klavye kullanıcısı belgenin
    // başına düşer ve otuz satırlık bir tabloda yerini kaybeder.
    const { tetikleyici } = bas();
    fireEvent.click(tetikleyici);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(tetikleyici);
  });

  it("dışarı tıklamak kapatır", () => {
    const { tetikleyici } = bas();
    fireEvent.click(tetikleyici);
    fireEvent.pointerDown(screen.getByRole("button", { name: "dışarıdaki düğme" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("menünün İÇİNE tıklamak KAPATMAZ (ters prova)", () => {
    // Dış tıklama dinleyicisi kabı hesaba katmasaydı menü kendi öğesine
    // basıldığında da kapanır ve seçim hiç gerçekleşmezdi.
    const { tetikleyici } = bas();
    fireEvent.click(tetikleyici);
    fireEvent.pointerDown(screen.getByRole("menuitem", { name: "İkinci" }));
    expect(screen.queryByRole("menu")).not.toBeNull();
  });
});

describe("İP-B2 · menü — klavye gezinmesi", () => {
  /**
   * ⚠️ İddialar ÖĞE KİMLİĞİ üzerinden yapılır, `textContent` üzerinden DEĞİL.
   *
   * İlk yazımda `expect(document.activeElement?.textContent).toContain("Birinci")`
   * yazılmıştı ve **tautolojiydi**: odak henüz verilmemişken `activeElement`
   * `<body>`dir ve `body.textContent` menünün bütün öğelerini içerir — yani
   * iddia, odak HİÇ verilmese de geçiyordu. Ölçüldü (sonda: `AKTIF INDEX -1`,
   * `AKTIF TAG BODY`) ve kusur ancak "ArrowDown'dan sonra hâlâ Birinci"
   * kırmızısıyla görüldü.
   *
   * Kök CLAUDE.md §E'nin sorusu tam olarak buydu: "beklenen değer davranışı
   * gerçekten ayırt ediyor mu?" Etmiyordu. Kimlik karşılaştırması ayırt ediyor.
   */
  it("açılışta ilk öğe odaklanır", async () => {
    const { tetikleyici } = bas();
    fireEvent.click(tetikleyici);
    const ogeler = screen.getAllByRole("menuitem");
    // Odak bir sonraki tikte veriliyor (menü henüz commit edilmemiş olabilir).
    await waitFor(() => expect(document.activeElement).toBe(ogeler[0]));
  });

  it("ok tuşları öğeler arasında dolaşır ve SARMALAR", async () => {
    const { tetikleyici } = bas();
    fireEvent.click(tetikleyici);
    const menu = screen.getByRole("menu");
    const [birinci, ikinci, ucuncu] = screen.getAllByRole("menuitem");
    await waitFor(() => expect(document.activeElement).toBe(birinci));

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(ikinci);

    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(ucuncu);

    // Son öğede aşağı → başa sarar (WAI-ARIA menu button deseni).
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(birinci);

    // İlk öğede yukarı → sona sarar.
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(ucuncu);
  });

  it("kapalıyken ok tuşu menüyü AÇAR", () => {
    const { tetikleyici } = bas();
    fireEvent.keyDown(tetikleyici, { key: "ArrowDown" });
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("Tab menüyü kapatır ama odağı GERİ ALMAZ", () => {
    // Tab "ileri git" demektir; tetikleyiciye dönmek geri gitmek olurdu.
    const { tetikleyici } = bas();
    fireEvent.click(tetikleyici);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).not.toBe(tetikleyici);
  });
});

describe("İP-B2 · menü — overlay eşiğini bozmuyor", () => {
  it("tam ekran zemin katmanı SERMEZ", () => {
    // `fixed inset-0` yazan her katman ölçüm tabanında overlay sayılır ve
    // `role="dialog"` + `aria-modal` ister (`uiBaseline` eşiği `toBe(0)`).
    // Menü bir pencere değildir; arkasını kilitlemesi de yanlış olurdu.
    const { container, tetikleyici } = bas();
    fireEvent.click(tetikleyici);
    expect(container.querySelectorAll(".fixed.inset-0")).toHaveLength(0);
    expect(screen.getByRole("menu").getAttribute("aria-modal")).toBeNull();
  });
});
