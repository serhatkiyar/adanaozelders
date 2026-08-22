/**
 * İP-C2 · Duyuru şeridi — nöbetçi matrisi (8 test: kırmızı matrisin 11-18'i).
 *
 * Bu dosya üretim kodundan ÖNCE yazıldı (kırmızı faz): `DuyuruSeridi.tsx`,
 * `hooks/useDuyuru.ts` ve `api/duyuru.ts` henüz yoktu — ilk koşuda tüm dosya
 * import hatasıyla KIRMIZI düşer (bu, testin gerçek davranışı ölçtüğünün
 * kanıtıdır — "her zaman yeşil" bir test değildir).
 *
 * Test türleri (kök CLAUDE.md §H): tamamı GERÇEK DOM (jsdom + RTL) + gerçek
 * axios adapter üzerinden giden istekler (davranış testi, kaynak taraması
 * yok). Kontrast/CLS ölçümü jsdom'un SINIRIDIR (§F) — gerçek Chrome + CDP
 * ölçümü `scripts/duyuru_kontrast_cls.mjs`dedir.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PublicNavbar } from "@/components/PublicNavbar";
import { DuyuruSeridi } from "@/components/DuyuruSeridi";
import * as duyuruCache from "@/lib/duyuruCache";

import type { AxiosRequestConfig } from "axios";

const AKTIF_YOLU = "/duyuru-seridi/aktif";

let eskiAdapter: unknown;

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  // İZOLASYON: `useAktifDuyuru` başarılı her sorgudan sonra gerçek
  // `localStorage`a yazar (madde D — CLS düzeltmesi). Temizlenmezse bir
  // testin bıraktığı önbellek bir SONRAKİ testte "önceden kayıtlı durum"
  // sanılır ve test 12'nin "ilk ziyaret" iddiası sessizce yanlış olur.
  localStorage.clear();
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
  localStorage.clear();
});

/** İsteği tek bir sabit yanıtla karşılayan sahte adapter. */
function adapterKur(yanit: { status: number; data?: unknown } | "hata") {
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    if (!String(config.url).includes(AKTIF_YOLU)) {
      throw new Error(`beklenmeyen istek: ${config.url}`);
    }
    if (yanit === "hata") {
      throw new Error("ağ hatası (simüle)");
    }
    return {
      data: yanit.data ?? "",
      status: yanit.status,
      statusText: yanit.status === 204 ? "No Content" : "OK",
      headers: {},
      config,
    } as never;
  };
}

function sar(element: React.ReactElement, yol = "/") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <ErrorBoundary>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[yol]}>
          <Routes>
            <Route path="*" element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

const ORNEK_BILGI = {
  metin: "Yeni sezon indirimleri başladı",
  link_url: "https://example.com/kampanya",
  link_metni: "İncele",
  varyant: "bilgi" as const,
};

describe("İP-C2 · duyuru şeridi", () => {
  it("11: 200 yanıtta şerit render edilir, metin ve link doğru", async () => {
    adapterKur({ status: 200, data: ORNEK_BILGI });
    sar(<DuyuruSeridi />);

    const bolge = await screen.findByRole("region", { name: "Duyuru" });
    expect(bolge.textContent).toContain(ORNEK_BILGI.metin);

    const link = screen.getByRole("link", { name: ORNEK_BILGI.link_metni });
    expect(link.getAttribute("href")).toBe(ORNEK_BILGI.link_url);
  });

  it("12: önceden kayıtlı durum YOKKEN 204'te DOM'a hiçbir şey basılmaz (ilk ziyaret; boş konteyner de yok)", async () => {
    adapterKur({ status: 204 });
    const { container } = sar(<DuyuruSeridi />);

    // İstek gerçekten dönene kadar bekle, sonra hâlâ boş olduğunu doğrula.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByRole("region", { name: "Duyuru" })).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  /**
   * Madde D (düzeltme turu, CLS): önceden kayıtlı durum VARSA ilk boyamada
   * ANINDA (gerçek ağ yanıtı beklenmeden) iyimser render edilir. `findBy`
   * DEĞİL `getBy` kullanılır — asenkron bekleme testin kendisini yavaşça
   * yeşile "kayabilir" kılardı; iddia tam olarak "İLK senkron render'da
   * zaten orada" olduğu için `await` YOK.
   */
  it("D-1: önceden kayıtlı durum VARSA ilk boyamada şerit ANINDA görünür (yanıt beklenmeden)", () => {
    duyuruCache.yaz(ORNEK_BILGI);
    adapterKur({ status: 200, data: ORNEK_BILGI });
    sar(<DuyuruSeridi />);

    const bolge = screen.getByRole("region", { name: "Duyuru" });
    expect(bolge.textContent).toContain(ORNEK_BILGI.metin);
  });

  it("D-2: kayıtlı durum varken sonradan 204 gelirse şerit KALDIRILIR", async () => {
    duyuruCache.yaz(ORNEK_BILGI);
    adapterKur({ status: 204 }); // gerçek yanıt: artık aktif duyuru yok
    sar(<DuyuruSeridi />);

    // İlk karede iyimser olarak GÖRÜNÜR (önbellek "aktifti" diyor):
    expect(screen.getByRole("region", { name: "Duyuru" })).toBeTruthy();

    // Gerçek yanıt (204 → null) gelince kalkar:
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByRole("region", { name: "Duyuru" })).toBeNull();
  });

  it("D-3: kayıtlı içerik gerçek yanıttan FARKLIYSA, gerçek olan kazanır", async () => {
    duyuruCache.yaz({ ...ORNEK_BILGI, metin: "ESKİ (önbellekteki) metin" });
    const guncelYanit = { ...ORNEK_BILGI, metin: "YENİ (gerçek) metin" };
    adapterKur({ status: 200, data: guncelYanit });
    sar(<DuyuruSeridi />);

    // İlk karede ESKİ (önbellekteki) içerik görünür:
    expect(screen.getByRole("region", { name: "Duyuru" }).textContent).toContain(
      "ESKİ (önbellekteki) metin"
    );

    // Gerçek yanıt gelince YENİ içerik kazanır — kayıtlı olan DEĞİL.
    await screen.findByText("YENİ (gerçek) metin");
    expect(screen.queryByText("ESKİ (önbellekteki) metin")).toBeNull();
  });

  it("13: kapatma düğmesi YOK (negatif test)", async () => {
    adapterKur({ status: 200, data: ORNEK_BILGI });
    sar(<DuyuruSeridi />);

    await screen.findByRole("region", { name: "Duyuru" });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("14: link_url boşsa <a> render edilmez", async () => {
    adapterKur({
      status: 200,
      data: { metin: "Linksiz duyuru", link_url: null, link_metni: null, varyant: "bilgi" },
    });
    sar(<DuyuruSeridi />);

    const bolge = await screen.findByRole("region", { name: "Duyuru" });
    expect(bolge.textContent).toContain("Linksiz duyuru");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("15: şerit sticky navbar konteynerinin İÇİNDE DEĞİL — DOM hiyerarşisi", async () => {
    adapterKur({ status: 200, data: ORNEK_BILGI });
    // Gerçek App.tsx sırasıyla AYNI: DuyuruSeridi, PublicNavbar'dan (sticky
    // `<header>`) ÖNCE ve onun DIŞINDA, kardeş düğüm olarak durur.
    sar(
      <>
        <DuyuruSeridi />
        <PublicNavbar />
      </>
    );

    const bolge = await screen.findByRole("region", { name: "Duyuru" });
    const header = document.querySelector("header");
    expect(header, "PublicNavbar <header> bulunamadı").not.toBeNull();

    // Kardeş düğüm: biri diğerini İÇERMEZ.
    expect(header!.contains(bolge)).toBe(false);
    expect(bolge.contains(header!)).toBe(false);

    // Belge sırasında duyuru header'DAN ÖNCE gelir (sticky konteynerin dışında,
    // normal akışta üstte durur).
    const konum = bolge.compareDocumentPosition(header!);
    expect(konum & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("16: panel (/yonetim) rotasında render edilmez", async () => {
    adapterKur({ status: 200, data: ORNEK_BILGI });
    sar(<DuyuruSeridi />, "/yonetim");

    // Ağ isteği atılsa bile (ya da atılmasa) hiçbir zaman görünmemeli;
    // biraz bekleyip hâlâ yok olduğunu doğrula.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(screen.queryByRole("region", { name: "Duyuru" })).toBeNull();
  });

  it("17: varyant → doğru sınıf/renk eşlemesi", async () => {
    adapterKur({ status: 200, data: { ...ORNEK_BILGI, varyant: "dikkat" } });
    sar(<DuyuruSeridi />);

    const bolge = await screen.findByRole("region", { name: "Duyuru" });
    expect(bolge.getAttribute("data-varyant")).toBe("dikkat");
    expect(bolge.className).toContain("#F6AD55");
    expect(bolge.className).not.toContain("#1A365D");
  });

  it("17b: bilgi varyantı lacivert sınıfını taşır", async () => {
    adapterKur({ status: 200, data: ORNEK_BILGI });
    sar(<DuyuruSeridi />);

    const bolge = await screen.findByRole("region", { name: "Duyuru" });
    expect(bolge.getAttribute("data-varyant")).toBe("bilgi");
    expect(bolge.className).toContain("#1A365D");
  });

  /**
   * Madde B (düzeltme turu): link renkle DEĞİL, kalıcı alt çizgiyle de
   * ayrışmalı. Bu bir KAYNAK SÖZLEŞMESİ testidir (§C, düşük güçlü) —
   * jsdom Tailwind'in gerçek CSS'ini uygulamadığı için "hesaplanmış stilde
   * gerçekten alt çizgi var mı" burada ÖLÇÜLEMEZ; o soru gerçek Chrome'da
   * `scripts/duyuru_kontrast_cls.mjs::dekorasyonBilgisi` ile her ölçüm
   * turunda sorulur (rapor: ip-c2 düzeltme turu, madde B). Burada yalnız
   * sınıfın KALICI olduğunu (yalnız `hover:` önekiyle değil) doğruluyoruz.
   */
  it("B: link sınıfı KALICI `underline` taşır (hover'a bağlı değil)", async () => {
    adapterKur({ status: 200, data: ORNEK_BILGI });
    sar(<DuyuruSeridi />);

    const link = await screen.findByRole("link", { name: ORNEK_BILGI.link_metni });
    const siniflar = link.className.split(/\s+/);
    expect(siniflar).toContain("underline");
    expect(siniflar).not.toContain("hover:underline");
  });

  it("18: ağ hatasında sessizce hiçbir şey render edilmez, hata sınırı tetiklenmez", async () => {
    adapterKur("hata");
    sar(<DuyuruSeridi />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(screen.queryByRole("region", { name: "Duyuru" })).toBeNull();
    // ErrorBoundary'nin devreye girmediğini doğrula: onun ürettiği herhangi
    // bir "bir şeyler ters gitti" metni sahnede olmamalı.
    expect(screen.queryByText(/ters gitti|hata oluştu/i)).toBeNull();
  });
});
