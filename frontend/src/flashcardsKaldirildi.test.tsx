// Eski SM-2 kelime kartı yüzeyi KALDIRILDI — yokluk sözleşmesi (R5 · R6).
//
// Kaldırılan yüzey: `/ogren/kelime-kartlari` (+ `/:id`), `pages/Flashcards.tsx`,
// `pages/FlashcardDeck.tsx`, `api/flashcards.ts`, `hooks/useFlashcards.ts`,
// `lib/srs.ts` ve Öğren hub'ındaki "Kelime Kartları" kartı. Yerine geçen sistem
// FSRS tabanlı `/ogren/tekrar` yüzeyidir; bu dosya ona DOKUNMAZ — tersine, onun
// AYAKTA olduğunu ölçer (aşağıdaki "yalancı yeşil nöbetçisi" notlarına bakın).
//
// ## Neden bu dosya üretim kodundan ÖNCE yazıldı
//
// Bir şeyin yokluğunu iddia eden test, o şey hiç var olmamış olsa da geçer.
// Yeşil olması tek başına hiçbir şey kanıtlamaz; kanıt, kaldırmadan ÖNCE
// gerçekten kırmızı düştüğünün görülmesidir (kök CLAUDE.md §E). İki düğüm de
// kırmızı fazda koşuldu ve çıktı commit mesajına yazıldı.
//
// Kaldırma bitince dosyanın işlevi değişir: kaldırmanın kanıtı olmaktan çıkar,
// **geri sızmanın nöbetçisi** olur.
//
// R5 = saf yapı sözleşmesi (routes tek kaynağı). R6 = GERÇEK DOM (jsdom + RTL).
// R6 ölü linkin tek otomatik nöbetçisidir: route silinip hub kartı bırakılırsa
// kullanıcı tıklayınca boş ekrana düşer ve başka hiçbir test bunu görmez.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import Learn from "@/pages/Learn";
import { PATHS, ROUTES } from "@/lib/routes";

/** Kaldırılan URL parçası — anahtar adı değişse de yakalanmalı. */
const ESKI_YOL_PARCASI = "kelime-kartlari";

describe("R5 — routes tek kaynağında flashcard girdisi yok", () => {
  it("PATHS ve ROUTES `flashcards` / `flashcardDeck` anahtarlarını taşımaz", () => {
    expect(PATHS).not.toHaveProperty("flashcards");
    expect(PATHS).not.toHaveProperty("flashcardDeck");
    expect(ROUTES).not.toHaveProperty("flashcards");
    expect(ROUTES).not.toHaveProperty("flashcardDeck");
  });

  it("hiçbir PATHS/ROUTES değeri `kelime-kartlari` içermez", () => {
    // Anahtarı silip yolu başka bir ad altında bırakmak, yukarıdaki düğümü
    // geçerdi. Burada değerler taranır: URL'nin kendisi ortadan kalkmalı.
    const yollar = Object.entries(PATHS).filter(([, v]) =>
      String(v).includes(ESKI_YOL_PARCASI)
    );
    expect(yollar).toEqual([]);

    const rotalar = Object.entries(ROUTES).filter(
      ([, v]) => typeof v === "string" && v.includes(ESKI_YOL_PARCASI)
    );
    expect(rotalar).toEqual([]);
  });

  it("yeni FSRS yüzeyi yerinde duruyor (ölçüm boş kümede yapılmasın)", () => {
    // Yalancı yeşil nöbetçisi: `routes.ts` boşalsa ya da import kırılsa
    // yukarıdaki iki düğüm de kendiliğinden geçerdi. Komşunun ayakta olduğu
    // önce kanıtlanır.
    expect(PATHS).toHaveProperty("srs");
    expect(String(ROUTES.srs)).toContain("/ogren/tekrar");
  });
});

describe("R6 — Öğren hub'ında Kelime Kartları kartı yok (gerçek DOM)", () => {
  function hubuBas() {
    // `useCurrentUser` token yokken devre dışıdır (`enabled: !!token`), bu
    // yüzden ağ isteği doğmaz ve hub STUDENT_NAV ile render edilir.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Learn />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it("hub gerçekten render oluyor (ölçümün ön koşulu)", () => {
    // Bu düğüm olmadan aşağıdaki "Kelime Kartları yok" iddiası, sayfa hiç
    // render olmadığında ya da patladığında da geçerdi — yalancı yeşilin en
    // olası kılığı budur.
    hubuBas();
    expect(
      screen.getByRole("heading", { level: 1, name: "Öğren" })
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: /aralıklı tekrar/i })).toBeTruthy();
  });

  it("'Kelime Kartları' kartı DOM'da yok", () => {
    hubuBas();
    expect(screen.queryByText(/kelime kart/i)).toBeNull();
  });

  it("`/ogren/kelime-kartlari`'ya giden hiçbir bağlantı kalmadı", () => {
    // Başlık metni değişip bağlantının kalması mümkündür (ör. kart yeniden
    // adlandırılır ama `to` aynı kalır). Ölü linkin asıl tanımı hedefidir.
    const { container } = hubuBas();
    const olu = Array.from(container.querySelectorAll("a[href]")).filter((a) =>
      (a.getAttribute("href") ?? "").includes(ESKI_YOL_PARCASI)
    );
    expect(olu.map((a) => a.getAttribute("href"))).toEqual([]);
  });

  it("yerine geçen kart `/ogren/tekrar`'a gidiyor", () => {
    const { container } = hubuBas();
    const hedefler = Array.from(container.querySelectorAll("a[href]")).map((a) =>
      a.getAttribute("href")
    );
    expect(hedefler).toContain("/ogren/tekrar");
  });
});
