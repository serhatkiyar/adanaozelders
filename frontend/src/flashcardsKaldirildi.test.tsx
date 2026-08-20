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
import { act, cleanup, render, screen } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";

import App from "@/App";
// ── İP-A7d5 · Görev 2: TEMBEL ROTA HEDEFLERİ de statik alınıyor ──
//
// `App` rota tablosunu `React.lazy` ile kuruyor: ekran modülü ancak o rotaya
// GİDİLDİĞİNDE, yani testin `findBy*` beklemesinin İÇİNDE yükleniyor. Sınıfın
// en saf hâli bu — ve ölçüldü: tohum 5103'te R7 tam olarak bu yüzden düştü
// (Suspense yedeği ekrandayken 1000 ms'lik bütçe doldu, "Aradığınız sayfa
// bulunamadı" başlığı henüz yoktu).
//
// Yan etki importu modülü TOPLAMA evresinde değerlendirir; `lazy` sonra onu
// önbellekten alır ve bekleme tek bir mikro-göreve iner. Bütçe BÜYÜTÜLMEDİ.
//
// ## İP-A8 · Görev 5 — düzeltme YETMEDİ ve sebebi ölçüldü
//
// Bağımsız denetim #3 (B-4) iki tohumda (7001, 7137) R7'yi yine kırmızı buldu.
// A7d5'in teşhisi doğru ama TAM DEĞİLDİ: statik import tembel modülün
// ÇÖZÜMLENME maliyetini kaldırır, **bekleyişin kendisini** kaldırmaz.
// `React.lazy` her hâlükârda en az bir mikro-görev geciktirir ve
// `findByRole` bunu DUVAR SAATİYLE bekler (1000 ms). Yani iddia hâlâ
// "makine yeterince hızlı mı" sorusuna bağlıydı; paralel yük altında
// `render(<App/>)`ın kendi maliyeti de aynı bütçeden ödeniyor.
//
// Doğru düzeltme bütçeyi büyütmek DEĞİL, bekleyişi ORTADAN KALDIRMAKTIR:
// tembel sınırı `act` ile AKITILIR ve iddia eşzamanlı `getByRole` olur.
// `getBy*`ın zaman aşımı yoktur — bu düğüm artık duvar saatinden tamamen
// bağımsızdır ve hiçbir makinede "yavaştı" diye düşemez.
import "@/pages/NotFound";
import "@/pages/srs/SrsDecks";
import { afterEach, describe, expect, it } from "vitest";

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

// ── R7: ROTA TABLOSU — App.tsx'in kendisi ─────────────────────────────────
//
// Bağımsız denetim bulgusu F8 (14 Ağu 2026): "eski URL'ler 404 döner"
// iddiasının OTOMATIK nöbetçisi yoktu. R5 yalnız `routes.ts` sözlüğünü,
// R6 yalnız Öğren hub'ının DOM'unu tarar; `App.tsx`'in `<Routes>` tablosu
// hiçbir düğümde ölçülmüyordu. Geri sızmanın en olası kılığı tam da orada:
// biri `PATHS`'a hiç dokunmadan `<Route path="/ogren/kelime-kartlari">`
// yazarsa mevcut düğümlerin hiçbiri kırılmaz — sayfa geri gelir.
//
// Tek kanıt elle tarayıcı turuydu (sözleşme §7.2), yani tekrarlanabilir
// değildi. Bu düğüm onu otomatikleştirir: gerçek `App` bileşeni, gerçek
// react-router, gerçek DOM.
//
// SINIR (kök CLAUDE.md §F): jsdom gerçek tarayıcının yerine GEÇMEZ — lazy
// chunk yüklenmesi, gerçek gezinme ve soğuk başlangıç burada ölçülmez.
// §7.2'nin elle turu bu düğümle birlikte okunmalıdır, onun yerine değil.
describe("R7 — App.tsx rota tablosunda eski yol yok (gerçek DOM)", () => {
  const ESKI_YOLLAR = [
    "/ogren/kelime-kartlari",
    "/ogren/kelime-kartlari/1",
    "/panel/ogren/kelime-kartlari",
    "/panel/ogren/kelime-kartlari/1",
  ];

  // `App` kompozisyon kökünün TAMAMI değildir: `main.tsx` onu
  // `<HelmetProvider>` ile sarar (react-helmet-async). Sarmadan render
  // edilirse `Seo` bileşeni kullanan her sayfa — NotFound dahil — "Cannot
  // read properties of undefined (reading 'add')" ile patlar ve
  // `RouteErrorBoundary` bunu "Bu sayfa yüklenemedi" ekranına çevirir.
  // Yani sarmayı unutmak, 404 iddiasını sessizce ölçülemez hâle getirirdi:
  // test kırmızı düşerdi ama sebebi rota tablosu olmazdı.
  // İP-A7d5 · Görev 2: `App` STATİK import ediliyor (dosya başında). Eskiden
  // her testin İÇİNDE `await import("@/App")` vardı: bütün rota tablosunun
  // değerlendirilmesi ilk testin bütçesinden ödeniyordu. Modül önbelleği
  // sayesinde davranış aynı — yalnız maliyet TOPLAMA evresine geçti.
  const yoluBas = async (yol: string) => {
    window.history.pushState({}, "", yol);

    const sonuc = render(
      <HelmetProvider>
        <App />
      </HelmetProvider>
    );

    // ── Tembel sınırı AKIT, bekleme (İP-A8 · Görev 5) ──
    //
    // `React.lazy`in promise'i modül önbellekten gelse bile çözülmüş bir
    // promise'tir ve React onu ancak bir sonraki mikro-görevde işler.
    // `findBy*` bunu duvar saatiyle beklerdi; `act` içindeki boş bekleyiş
    // React'in kuyruğunu boşaltır ve sonuç DETERMİNİSTİK olur. İki tur:
    // birincisi `lazy`nin `.then`ini, ikincisi ondan doğan yeniden render'ı
    // akıtır (`GlobalMeeting`/`AuthModal` gibi kardeş sınırlar da aynı
    // kuyruğu paylaşıyor).
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    return sonuc;
  };

  afterEach(() => {
    cleanup();
    window.history.pushState({}, "", "/");
  });

  it.each(ESKI_YOLLAR)("%s → 404 sayfası", async (yol) => {
    await yoluBas(yol);
    // `getBy*` — zaman aşımı YOK. Bekleyiş `yoluBas` içinde akıtıldı;
    // burada duvar saatine bağlı hiçbir şey kalmadı (İP-A8 · Görev 5 · B-4).
    expect(
      screen.getByRole("heading", { name: /Aradığınız sayfa bulunamadı/i })
    ).toBeTruthy();
  });

  // DOLULUK NÖBETÇİSİ — yalancı yeşile karşı.
  // Yukarıdaki dört iddia, router tamamen bozulsa (her yol 404'e düşse) da
  // geçerdi. Yerine geçen yüzeyin AYRI davrandığını ölçmek şart.
  it("NÖBETÇİ: yaşayan `/ogren/tekrar` 404'e düşmüyor", async () => {
    await yoluBas("/ogren/tekrar");
    // Anonim oturumda korumalı rota `/giris`'e yönlenir; ölçülen şey
    // "404 DEĞİL" — yani yol hâlâ router tarafından tanınıyor.
    const dortyuzdort = screen.queryByRole("heading", {
      name: /Aradığınız sayfa bulunamadı/i,
    });
    expect(dortyuzdort).toBeNull();
  });
});
