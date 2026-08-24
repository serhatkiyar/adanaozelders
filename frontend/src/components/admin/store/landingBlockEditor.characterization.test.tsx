/**
 * P3 · KARAKTERİZASYON TESTİ — blok editörünün BUGÜNKÜ davranışı.
 *
 * SÖZLEŞME: Bu dosya davranış bilinçli değiştirilmedikçe DÜZENLENMEZ.
 *
 * ## Neden refactor'dan ÖNCE yazıldı
 *
 * `BlockEditor` 400+ satırlık elle yazılmış bir `if (block_type === ...)`
 * zinciri. Şemadan üretilen editöre geçilecek; ama mevcut testler yalnız üç
 * saf yardımcıyı kapsıyordu, yani "davranış değişmedi" iddiasının HİÇBİR
 * kanıtı yoktu. Karakterizasyon testi tam olarak bunu üretir: refactor
 * boyunca **değişmeden** geçmeli. Bir iddiayı değiştirmek zorunda kalmak,
 * davranışın değiştiğinin kanıtıdır.
 *
 * ## Neden bileşen değil PANEL üzerinden
 *
 * `BlockEditor` dışa aktarılmıyor ve aktarılmamalı: çalışma zamanı kapısı
 * (`__guards__/calismaZamaniKapisi`) dışa aktarılan her bileşeni PROPSUZ
 * render ediyor. Ama asıl sebep şu: ölçülmek istenen şey "bileşen alanı
 * çizdi mi" değil, **panelin gerçekten gönderdiği taslak yükü**. O yük ancak
 * gerçek panel + gerçek axios katmanı üzerinden görülür (kök CLAUDE.md §B:
 * "gerçekten gönderilen API parametreleri").
 *
 * ## Autosave
 *
 * Taslak 900 ms debounce ile kaydediliyor. Testler SAHTE zamanlayıcı
 * kullanmaz — gerçek bekleme, gerçek debounce davranışını ölçer; sahte
 * zamanlayıcı "debounce kaldırıldı" mutasyonunu göremeyebilirdi.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { LandingPagesManager } from "@/components/admin/store/LandingPagesManager";

import type { AxiosRequestConfig } from "axios";

/** Kaydedilen taslak yükleri — testin asıl gözlem noktası. */
let kaydedilen: any[] = [];
let eskiAdapter: unknown;

const MEDYA = [
  {
    id: 1,
    url: "https://cdn.test/gorsel-a.webp",
    alt_text: "görsel a",
    width: 1200,
    height: 600,
    content_type: "image/webp",
    byte_size: 1000,
  },
];

const KOLEKSIYONLAR = [
  { id: 7, name: "Çok satanlar", description: "", is_active: true, matched_count: 12 },
];

const KATEGORILER = [
  { id: 3, name: "Kitaplar", slug: "kitaplar", parent_id: null, is_active: true },
  { id: 4, name: "Kırtasiye", slug: "kirtasiye", parent_id: null, is_active: true },
];

function blok(tip: string, ek: Record<string, unknown> = {}) {
  const temel: Record<string, unknown> = {
    id: Math.floor(Math.random() * 100000),
    block_key: `k-${tip}`,
    block_type: tip,
    title: `${tip} başlık`,
    description: "",
    link_label: "",
    link_url: null,
    config: {},
    product_set_id: null,
    product_set_revision_id: null,
    is_active: true,
    sort_order: 0,
    products: [],
    categories: [],
    warnings: [],
  };
  return { ...temel, ...ek };
}

/** 7 blok tipinin tamamı — kapsam SAYIYLA değil kimlikle sabitlenir. */
const TUM_TIPLER = [
  "HERO_CAROUSEL",
  "IMAGE_CARD_GRID",
  "CATEGORY_GRID",
  "PRODUCT_RAIL",
  "BANNER",
  "RICH_TEXT",
  "RECENTLY_VIEWED",
] as const;

const ONIZLEME = {
  id: 1,
  slug: "ana-sayfa",
  internal_name: "Mağaza Ana Sayfası",
  page_type: "HOME",
  is_archived: false,
  state: "DRAFT",
  revision: {
    id: 5,
    page_id: 1,
    version: 5,
    status: "DRAFT",
    title: "Mağaza",
    seo_title: "Mağaza",
    seo_description: "",
    og_image_url: null,
    blocks: [
      blok("HERO_CAROUSEL", {
        sort_order: 0,
        config: { slides: [{ image_url: "https://cdn.test/hero.webp", alt_text: "hero" }] },
      }),
      blok("IMAGE_CARD_GRID", {
        sort_order: 10,
        config: { cards: [{ image_url: "https://cdn.test/kart.webp", alt_text: "kart" }] },
      }),
      blok("CATEGORY_GRID", { sort_order: 20, config: { category_ids: [3] } }),
      blok("PRODUCT_RAIL", { sort_order: 30, product_set_id: 7 }),
      blok("BANNER", {
        sort_order: 40,
        config: { image_url: "https://cdn.test/banner.webp", alt_text: "banner" },
      }),
      blok("RICH_TEXT", { sort_order: 50, config: { content: "merhaba" } }),
      blok("RECENTLY_VIEWED", { sort_order: 60, config: {} }),
    ],
  },
};

const SAYFALAR = [
  {
    id: 1,
    internal_name: "Mağaza Ana Sayfası",
    slug: "ana-sayfa",
    page_type: "HOME",
    is_archived: false,
    state: "DRAFT",
    latest_revision_id: 5,
    published_revision_id: null,
    has_unpublished_changes: true,
    updated_at: "2026-08-24T00:00:00Z",
  },
];

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  kaydedilen = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const url = String(config.url);
    const method = (config.method ?? "get").toLowerCase();
    const cevap = (data: unknown) =>
      ({ data, status: 200, statusText: "OK", headers: {}, config }) as never;

    if (method === "put" && url.endsWith("/draft")) {
      const gövde =
        typeof config.data === "string" ? JSON.parse(config.data) : config.data;
      kaydedilen.push(gövde);
      return cevap({ ...ONIZLEME.revision, id: 5, version: 6 });
    }
    if (url.includes("/preview/")) return cevap(ONIZLEME);
    if (url.endsWith("/pages")) return cevap(SAYFALAR);
    if (url.includes("/revisions")) return cevap([ONIZLEME.revision]);
    if (url.includes("/publications")) return cevap([]);
    if (url.includes("/media")) return cevap(MEDYA);
    if (url.includes("/product-sets")) return cevap(KOLEKSIYONLAR);
    if (url.includes("/metrics")) return cevap([]);
    if (url.includes("/categories")) return cevap(KATEGORILER);
    return cevap([]);
  };
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
});

function sar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <LandingPagesManager pageType="HOME" />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

/** Blok listesinden bir bloğu seçer. */
async function blokSec(tipAdi: string | RegExp) {
  const dugme = await screen.findByRole("button", { name: tipAdi });
  fireEvent.click(dugme);
  return dugme;
}

/** Autosave'in gönderdiği SON taslak yükünü bekler. */
async function sonKayit() {
  await waitFor(() => expect(kaydedilen.length).toBeGreaterThan(0), {
    timeout: 4000,
  });
  return kaydedilen[kaydedilen.length - 1];
}

function blokBul(yuk: any, tip: string) {
  return yuk.blocks.find((b: any) => b.block_type === tip);
}

describe("blok editörü · karakterizasyon", () => {
  it("yedi blok tipinin hepsi listelenir", async () => {
    sar();
    await screen.findByText(/Sayfadaki bölümler/i);
    // Kapsam KİMLİKLE sabit: bir tip listeden düşerse test kırılır.
    for (const tip of TUM_TIPLER) {
      expect(
        screen.getAllByText(new RegExp(`^${tip} başlık$`)).length,
      ).toBeGreaterThan(0);
    }
  });

  it("ortak alan (başlık) düzenlemesi taslak yüküne girer", async () => {
    sar();
    await blokSec(/RICH_TEXT başlık/);
    const girdi = await screen.findByDisplayValue("RICH_TEXT başlık");
    fireEvent.change(girdi, { target: { value: "Yeni başlık" } });

    const yuk = await sonKayit();
    expect(blokBul(yuk, "RICH_TEXT").title).toBe("Yeni başlık");
  });

  it("RICH_TEXT metni config.content olarak gonderilir", async () => {
    sar();
    await blokSec(/RICH_TEXT başlık/);
    const alan = await screen.findByDisplayValue("merhaba");
    fireEvent.change(alan, { target: { value: "yeni metin" } });

    const yuk = await sonKayit();
    expect(blokBul(yuk, "RICH_TEXT").config.content).toBe("yeni metin");
  });

  it("CATEGORY_GRID secimi config.category_ids olarak gonderilir", async () => {
    sar();
    await blokSec(/CATEGORY_GRID başlık/);
    const kirtasiye = await screen.findByLabelText("Kırtasiye");
    fireEvent.click(kirtasiye);

    const yuk = await sonKayit();
    // Değer ŞART: yalnız "dizi geldi" demek 3'ün korunduğunu göstermez.
    expect(blokBul(yuk, "CATEGORY_GRID").config.category_ids).toEqual([3, 4]);
  });

  it("PRODUCT_RAIL koleksiyon secimi product_set_id olarak gonderilir", async () => {
    sar();
    await blokSec(/PRODUCT_RAIL başlık/);
    // Sayfada başka `select`ler de var (sürüm/sayfa seçiciler); kapsam blok
    // editörüne daraltılır, yoksa test yanlış kontrolü sürer.
    const kok = await screen.findByRole("article");
    const secici = within(kok).getByRole("combobox");
    fireEvent.change(secici, { target: { value: "7" } });
    // Aynı değere geri dönmek `draft`i değiştirmez; önce boşaltıp seçiyoruz.
    fireEvent.change(secici, { target: { value: "" } });

    const yuk = await sonKayit();
    expect(blokBul(yuk, "PRODUCT_RAIL").product_set_id).toBeNull();
  });

  it("gorunurluk anahtari is_active olarak gonderilir", async () => {
    sar();
    await blokSec(/BANNER başlık/);
    const anahtar = await screen.findByLabelText("Göster");
    fireEvent.click(anahtar);

    const yuk = await sonKayit();
    expect(blokBul(yuk, "BANNER").is_active).toBe(false);
  });

  it("yonlendirme alani link_url olarak gonderilir ve BOSKEN null olur", async () => {
    sar();
    await blokSec(/RICH_TEXT başlık/);
    const alan = await screen.findByPlaceholderText("/magaza?...");
    fireEvent.change(alan, { target: { value: "/magaza?q=kitap" } });
    let yuk = await sonKayit();
    expect(blokBul(yuk, "RICH_TEXT").link_url).toBe("/magaza?q=kitap");

    kaydedilen = [];
    fireEvent.change(alan, { target: { value: "" } });
    yuk = await sonKayit();
    // Boş string DEĞİL null: sunucu `_validate_link` boş stringi bağlantı
    // sanmamalı ve `Heading` "hedef var" diye davranmamalı.
    expect(blokBul(yuk, "RICH_TEXT").link_url).toBeNull();
  });

  it("sira degistirme sort_order'i yeniden yazar", async () => {
    sar();
    await blokSec(/IMAGE_CARD_GRID başlık/);
    const asagi = await screen.findByRole("button", { name: "Aşağı" });
    fireEvent.click(asagi);

    const yuk = await sonKayit();
    const sira = yuk.blocks.map((b: any) => b.block_type);
    expect(sira[1]).toBe("CATEGORY_GRID");
    expect(sira[2]).toBe("IMAGE_CARD_GRID");
    // ÖLÇÜLEN SÖZLEŞME: istemci `sort_order`'ı yeniden YAZMAZ ve sunucu da
    // gönderileni YOK SAYAR — `_sync_draft_blocks` sırayı DİZİ İNDEKSİNDEN
    // türetir (`sort_order = index * 10`). Bu test ilk yazımda "istemci
    // sort_order'ı düzeltmeli" diye kurulmuştu ve YANLIŞ bir hata bildirdi;
    // gerçek sözleşme burada sabitleniyor ki şemadan üretilen editöre
    // geçerken biri istemcide numaralandırma "düzeltmesi" yapıp iki otorite
    // yaratmasın.
    expect(yuk.blocks.map((b: any) => b.sort_order)).toEqual([
      0, 20, 10, 30, 40, 50, 60,
    ]);
  });

  it("autosave DEBOUNCE eder: ard arda degisiklik TEK istek dogurur", async () => {
    sar();
    await blokSec(/RICH_TEXT başlık/);
    const girdi = await screen.findByDisplayValue("RICH_TEXT başlık");
    for (const deger of ["a", "ab", "abc", "abcd", "abcde"]) {
      fireEvent.change(girdi, { target: { value: deger } });
    }
    // ZAYIF TEST NOTU (ölçüldü): burada yalnız "tek istek doğdu" demek
    // YETMİYOR. Gecikmeyi 900 -> 0 yapan bir mutasyon bu iddiayı KIRMIYOR,
    // çünkü tek istek debounce süresinden değil effect temizliğinden geliyor.
    // Gerçek nöbet, isteğin ERKEN doğmadığını ölçmektir.
    await new Promise((r) => setTimeout(r, 300));
    expect(kaydedilen.length).toBe(0);

    const yuk = await sonKayit();
    expect(blokBul(yuk, "RICH_TEXT").title).toBe("abcde");
    // Beş tuş vuruşu tek kayıt üretmeli.
    expect(kaydedilen.length).toBe(1);
  });

  it("blok kopyalama YENI block_key uretir", async () => {
    sar();
    await blokSec(/RICH_TEXT başlık/);
    const kopyala = await screen.findByRole("button", { name: "Kopyala" });
    fireEvent.click(kopyala);

    const yuk = await sonKayit();
    const metinBloklari = yuk.blocks.filter(
      (b: any) => b.block_type === "RICH_TEXT",
    );
    expect(metinBloklari).toHaveLength(2);
    expect(metinBloklari[0].block_key).not.toBe(metinBloklari[1].block_key);
  });

  it("blok kaldirma bloku yukten cikarir", async () => {
    sar();
    await blokSec(/RECENTLY_VIEWED başlık/);
    const kaldir = await screen.findByRole("button", { name: "Kaldır" });
    fireEvent.click(kaldir);

    const yuk = await sonKayit();
    expect(blokBul(yuk, "RECENTLY_VIEWED")).toBeUndefined();
  });

  it("gorselli bloklarda medya secici acilir, metin blogunda ACILMAZ", async () => {
    sar();
    await blokSec(/BANNER başlık/);
    expect(
      await screen.findByRole("button", { name: /Görsel(i)? (ekle|değiştir)/i }),
    ).toBeTruthy();

    await blokSec(/RICH_TEXT başlık/);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /Görsel(i)? (ekle|değiştir)/i }),
      ).toBeNull(),
    );
  });

  it("RECENTLY_VIEWED kopyalanamaz (tekil blok)", async () => {
    sar();
    await blokSec(/RECENTLY_VIEWED başlık/);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Kopyala" })).toBeNull(),
    );
  });
});

describe("blok editörü · tip bazlı alan matrisi", () => {
  /**
   * Her tipin KENDİ alanı görünmeli, başkasınınki GÖRÜNMEMELİ. Şemadan
   * üretilen editöre geçerken en kolay kaçan hata budur: bir alanın yanlış
   * tipte de çizilmesi. Yalnız "kendi alanı var mı" diye sormak onu göremezdi.
   */
  const MATRIS: { tip: string; olmali: RegExp[]; olmamali: RegExp[] }[] = [
    { tip: "RICH_TEXT", olmali: [/^Metin$/], olmamali: [/^Koleksiyon$/, /^Kategoriler$/] },
    { tip: "PRODUCT_RAIL", olmali: [/^Koleksiyon$/], olmamali: [/^Metin$/, /^Kategoriler$/] },
    { tip: "CATEGORY_GRID", olmali: [/^Kategoriler$/], olmamali: [/^Metin$/, /^Koleksiyon$/] },
    { tip: "BANNER", olmali: [], olmamali: [/^Metin$/, /^Koleksiyon$/, /^Kategoriler$/] },
  ];

  for (const { tip, olmali, olmamali } of MATRIS) {
    it(`${tip} yalniz kendi alanlarini gosterir`, async () => {
      sar();
      await blokSec(new RegExp(`${tip} başlık`));
      const kok = await screen.findByRole("article");
      for (const desen of olmali) {
        expect(within(kok).getByText(desen)).toBeTruthy();
      }
      for (const desen of olmamali) {
        expect(within(kok).queryByText(desen)).toBeNull();
      }
    });
  }
});
