/**
 * Arama hapı alan başlıkları — GERÇEK DOM nöbetçisi.
 *
 * ## Karar (kullanıcı, 8 Eyl 2026)
 *
 * Airbnb deseni: alanın **üstünde** kalıcı başlık, **içinde** gri örnek metni.
 * Bizde başlık yoktu — alan adını `placeholder` taşıyordu
 * (`Ders "Matematik"`), yani kullanıcı yazmaya başlayınca alanın ne olduğu
 * kayboluyordu.
 *
 * ## Bu nöbetçinin ASIL iddiası
 *
 * Sessizce yanlış gidebilecek şey `aria-label`ın geri gelmesi. Görünür etiket
 * ile `aria-label` **birlikteyken ekran okuyucu `aria-label`ı okur ve görünen
 * başlık yok sayılır** — gören kullanıcı "Ders" görürken ekran okuyucu
 * "Ders ara… (ör. Lise Matematik)" der. Derleme geçer, ESLint geçer
 * (`assert: "either"` ikisini de kabul eder), kimse fark etmez.
 *
 * Bu yüzden kıyas görünür metne yapılır: her girdinin erişilebilir adı, **o
 * girdinin üstünde yazan başlığın kendisi** olmalı. `aria-label` geri
 * konulursa ad başlıktan sapar ve test kırılır.
 *
 * `aramaHapiIkizligi.test.ts` iki ana sayfa hapının birbirinin ikizi kalmasını
 * KAYNAK düzeyinde çıpalıyor; burası üç hapın da tarayıcıda doğru adı
 * verdiğini çıpalar. `BigSearch` ötekinin kapsamında değil — başlıkları
 * çağıran verdiği için ancak render edilerek sınanabilir.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Gerçek bileşenler + jsdom. jsdom LAYOUT hesaplamaz: başlık satırının
 * navbar'ın `max-h-24` kabında kırpılıp kırpılmadığını bu test göremez, o
 * elle doğrulanır.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { BigSearch, DersArama, KutuphaneArama } from "@/components/HeroSearch";

// `DersArama` ders katalogunu React Query ile çekiyor; sağlayıcı olmadan
// bileşen render edilemiyor. Ağ yok — sorgu boşta kalır, başlıklar yine basılır.
const sar = (jsx: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>{jsx}</MemoryRouter>
    </QueryClientProvider>
  );

const yok = () => {};

afterEach(() => cleanup());

/**
 * Bir başlığın hem GÖRÜNDÜĞÜNÜ hem de o alanın erişilebilir ADI olduğunu
 * doğrular. Tek başına `getByLabelText` yetmez: `aria-label` da onu geçirir,
 * oysa asıl sorun tam olarak `aria-label`ın görünür başlığı gölgelemesi.
 */
function baslikAlaninAdi(baslik: string) {
  // 1) Başlık ekranda gerçekten yazıyor mu (yalnız erişilebilirlik ağacında değil)?
  const yazi = screen.getByText(baslik);
  expect(yazi, `"${baslik}" başlığı görünmüyor`).toBeTruthy();

  // 2) O başlık bir alana bağlı mı ve alanın adı BU mu?
  const alan = screen.getByLabelText(baslik);
  expect(alan, `"${baslik}" hiçbir alana bağlı değil`).toBeTruthy();

  // 3) `aria-label` kalıntısı: varsa başlığı gölgeler.
  const kalinti = alan.getAttribute("aria-label");
  expect(
    kalinti,
    `"${baslik}" alanında aria-label="${kalinti}" var — görünür başlığı gölgeler`
  ).toBeNull();

  return alan;
}

describe("arama hapı · alan başlıkları", () => {
  it("`DersArama`: başlıklar 'Ders' ve 'Ders şekli'", () => {
    sar(
      <DersArama
        ders=""
        dersEtiket=""
        onDersChange={yok}
        sekil=""
        setSekil={yok}
        yer={null}
        setYer={yok}
        onSubmit={yok}
      />
    );
    const ders = baslikAlaninAdi("Ders");
    // 8 Eyl: "Ders yeri" → "Ders şekli". Yer artık AYRI bir bölme ve yalnız
    // "Yüz yüze" seçiliyken var (bkz. AramaSecicileri.tsx).
    baslikAlaninAdi("Ders şekli");

    // DOLULUK: başlık placeholder'ın YERİNE geçmedi, YANINA geldi. Placeholder
    // boşalsaydı yukarıdaki iddiaların hepsi yine geçerdi.
    expect(ders.getAttribute("placeholder")).toBeTruthy();
  });

  it("`KutuphaneArama`: başlıklar 'Kütüphane' ve 'Yer'", () => {
    sar(<KutuphaneArama q="" setQ={yok} yer={null} setYer={yok} onSubmit={yok} />);
    const ad = baslikAlaninAdi("Kütüphane");
    baslikAlaninAdi("Yer");
    expect(ad.getAttribute("placeholder")).toBeTruthy();
  });

  it("`BigSearch`: başlıkları ÇAĞIRAN verir, ikisi de alana bağlanır", () => {
    // İlçe tarafı bir <button>; `<label htmlFor>` ona bağlanmaz, ad
    // `aria-labelledby` ile gelir. Bu testin görmesi gereken şey ikisinin de
    // aynı sonucu vermesi: başlık = erişilebilir ad.
    sar(
      <BigSearch
        q=""
        setQ={yok}
        district={[]}
        setDistrict={yok}
        onSubmit={yok}
        placeholder="Matematik, İngilizce…"
        solBaslik="Yer"
        sagBaslik="Ders"
      />
    );
    baslikAlaninAdi("Yer");
    const q = baslikAlaninAdi("Ders");
    expect(q.getAttribute("placeholder")).toBe("Matematik, İngilizce…");
  });

  it("sağ başlık ZORUNLU — 'Ara' varsayılanı gönder düğmesiyle çakışıyordu", () => {
    // Bu ölçülmüş bir kusur: `sagBaslik` varsayılanı "Ara" iken hapta iki
    // "Ara" oluyordu (alan başlığı + gönder düğmesinin `aria-label`ı). Ekran
    // okuyucuda ayırt edilemezdi. Varsayılan kaldırıldı, prop zorunlu oldu.
    sar(
      <BigSearch
        q=""
        setQ={yok}
        district={[]}
        setDistrict={yok}
        onSubmit={yok}
        placeholder="Kütüphane adı"
        sagBaslik="Kütüphane"
      />
    );
    baslikAlaninAdi("Yer"); // sol başlık varsayılanı hâlâ çalışıyor
    baslikAlaninAdi("Kütüphane");

    // Hapta "Ara" adında TEK öğe kalmalı: gönder düğmesi.
    const aralar = screen.getAllByLabelText("Ara");
    expect(aralar).toHaveLength(1);
    expect(aralar[0].tagName).toBe("BUTTON");
  });

  it("TERS PROVA: `aria-label` görünür başlığı gölgelerse yakalanır", () => {
    // Nöbetçinin kendisi çalışıyor mu? Kusurlu bir hapı elle kurup aynı
    // yardımcıdan geçiriyoruz — geçerse yukarıdaki dört test bedavadır.
    render(
      <div>
        <label htmlFor="x">Ders</label>
        <input id="x" aria-label="Ders ara… (ör. Lise Matematik)" placeholder="…" />
      </div>
    );
    expect(() => baslikAlaninAdi("Ders")).toThrow();
  });
});
