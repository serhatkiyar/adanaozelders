// F30 çoklu etiket sayfası — kâğıt sözleşmesi ve HATA GÖRÜNÜRLÜĞÜ.
//
// Neden ayrı bir dosya: tek etiketin kuralları `PackageLabel.test.tsx`'te
// sabit. Burada ölçülen şey sayfanın kendisi — N paket için N etiket basılıyor
// mu, getirilemeyen etiket sessizce düşüyor mu, kâğıt ölçüsü sözleşmede yazan
// sayıyı veriyor mu.
//
// Sayfa gerçek axios örneğiyle (yalnız adapter değişir) gerçek `useQueries`
// üzerinden veri çeker; "N bileşen render oldu" değil, "N GERÇEK etiket ve
// içindeki GERÇEK QR yükü" ölçülür.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Ağır ortak modül BİLE BİLE statik import ediliyor (İP-A7d3 · Görev 5) ──
//
// Bu dosya ekran/bileşen modüllerini TEMBEL yüklüyor ve maliyeti ilk testin
// İÇİNDE ödüyor. İP-A7d3'te `admin/ui` demeti `ui2/duzenlemeYuzeyi` üzerinden
// `@medusajs/ui`ye bağlandı (SK-7: `ReasonDialog`ın kirli form bekçisi) ve
// paralel yük altında ilk test bütçeyi aştı.
//
// Bütçe BÜYÜTÜLMEDİ: yavaşlık üretim kodunda değil test kurulumunda; statik
// import maliyeti TOPLAMA (collect) evresine taşır (A7d2'nin kararı).
import "@/components/admin/ui2/duzenlemeYuzeyi";


import { apiClient } from "@/api/axios";

import type { AxiosRequestConfig } from "axios";
import type { ComponentType } from "react";

const { qrCagrilari } = vi.hoisted(() => ({
  qrCagrilari: [] as Record<string, unknown>[],
}));

vi.mock("qrcode.react", () => ({
  QRCodeSVG: (props: Record<string, unknown>) => {
    qrCagrilari.push(props);
    return <svg data-testid="qr" />;
  },
}));

/* ══════════════ Sahte sunucu ══════════════ */

interface Istek {
  method: string;
  url: string;
}

let istekler: Istek[] = [];
let eskiAdapter: unknown;
/** `packageId` → yanıt (veya hata durumu). */
let etiketler: Record<number, { status?: number; data: unknown }> = {};

beforeEach(() => {
  qrCagrilari.length = 0;
  istekler = [];
  etiketler = {};
  eskiAdapter = apiClient.defaults.adapter;
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const url = String(config.url);
    istekler.push({ method: (config.method ?? "get").toLowerCase(), url });
    const eslesme = /\/packing\/packages\/(\d+)\/label$/.exec(url);
    const ham = eslesme ? etiketler[Number(eslesme[1])] : undefined;
    const status = ham?.status ?? 200;
    if (!ham || status >= 400) {
      const hata = new Error(`istek başarısız: ${status}`) as Error & {
        isAxiosError: boolean;
        response: unknown;
        config: unknown;
      };
      hata.isAxiosError = true;
      hata.response = { status: ham ? status : 404, data: ham?.data ?? {}, headers: {}, config };
      hata.config = config;
      throw hata;
    }
    return { data: ham.data, status, statusText: "OK", headers: {}, config } as never;
  };
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
});

const ETIKET = (id: number, over: Record<string, unknown> = {}) => ({
  package_id: id,
  code: `PKT-${String(id).padStart(6, "0")}`,
  status: "PACKED",
  qr_payload: `PKG1:${id}:tok${id}`,
  order_id: 500 + id,
  recipient: `Alıcı ${id}`,
  address: `Adres ${id}`,
  city: "Adana",
  district: "Seyhan",
  delivery_pref: "ADRESIMDEYIM",
  delivery_pref_note: null,
  items: [{ order_item_id: id * 10, sku: `SKU-${id}`, title: `Kitap ${id}`, expected_qty: 1 }],
  ...over,
});

const MODULLER = import.meta.glob("./PackingLabelSheet.tsx");

/** Glob yükleyicisinin `unknown` çıktısına verilen ad — `any` DEĞİL. */
interface SayfaModulu {
  PackingLabelSheet: ComponentType<{
    packageIds: readonly number[];
    onClose: () => void;
  }>;
  /** Kâğıt sözleşmesinin sayısal hâli; testte doğrudan ölçülür. */
  LABELS_PER_PAGE: number;
}

async function modul(): Promise<SayfaModulu> {
  const yukle = MODULLER["./PackingLabelSheet.tsx"];
  if (!yukle) {
    throw new Error("HENÜZ YAZILMADI: src/components/admin/packing/PackingLabelSheet.tsx");
  }
  return (await yukle()) as unknown as SayfaModulu;
}

async function sayfa(): Promise<SayfaModulu["PackingLabelSheet"]> {
  return (await modul()).PackingLabelSheet;
}

async function sar(ids: number[]) {
  const PackingLabelSheet = await sayfa();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <PackingLabelSheet packageIds={ids} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe("PackingLabelSheet — çoklu etiket kâğıdı", () => {
  it("N paket için N etiket basar ve her QR'a KENDİ yükü gider", async () => {
    // "Sayfa açıldı" kanıt değildir: her etiketin kendi paketine ait olduğu,
    // QRCodeSVG'ye GERÇEKTEN geçirilen `value`'larla ölçülür. Aynı yükün iki
    // kez basılması (kopya-yapıştır hatası) burada yakalanır.
    etiketler = { 11: { data: ETIKET(11) }, 12: { data: ETIKET(12) }, 13: { data: ETIKET(13) } };
    await sar([11, 12, 13]);

    await waitFor(() =>
      expect(document.querySelectorAll(".package-label")).toHaveLength(3),
    );
    const yukler = qrCagrilari.map((p) => String(p.value));
    expect(yukler).toContain("PKG1:11:tok11");
    expect(yukler).toContain("PKG1:12:tok12");
    expect(yukler).toContain("PKG1:13:tok13");
    expect(new Set(yukler).size).toBe(3);

    // Her etiket kendi kodunu ve kendi alıcısını taşır.
    expect(screen.getByText("PKT-000011")).toBeTruthy();
    expect(screen.getByText("PKT-000013")).toBeTruthy();
    expect(screen.getByText("Alıcı 12")).toBeTruthy();
  });

  it("etiket basmak HİÇBİR yazma isteği atmaz", async () => {
    // Yeniden basım paket durumunu da QR token'ını da değiştirmemeli: `repack`
    // sonrası kutunun üstündeki eski etiket geçerli kalır (boşluk G3).
    etiketler = { 11: { data: ETIKET(11) }, 12: { data: ETIKET(12) } };
    await sar([11, 12]);
    await waitFor(() =>
      expect(document.querySelectorAll(".package-label")).toHaveLength(2),
    );
    expect(istekler.filter((i) => i.method !== "get")).toHaveLength(0);
    expect(istekler.every((i) => /\/label$/.test(i.url))).toBe(true);
  });

  it("getirilemeyen etiket SESSİZCE düşmez: hangi paket olduğu yazar", async () => {
    // F26 dersi: eksik çıktı, kimsenin fark etmediği hatadır. Operatör 3 etiket
    // beklerken 2 basılırsa bunu sayarak anlamamalı.
    etiketler = { 11: { data: ETIKET(11) }, 12: { status: 500, data: { detail: "patladı" } } };
    await sar([11, 12]);

    const uyari = await screen.findByRole("alert");
    expect(uyari.textContent).toMatch(/12/);
    expect(uyari.textContent).toMatch(/basılamadı/i);
    expect(document.querySelectorAll(".package-label")).toHaveLength(1);
  });

  it("qr_payload BOŞ gelirse o etiket basılmaz ve sebebi yazılır", async () => {
    // Karekodsuz etiket kâğıt israfından beteri: kutunun üstünde işe yaramaz
    // bir kare durur, kurye paketi okutamaz ve kimse fark etmez.
    etiketler = {
      11: { data: ETIKET(11) },
      12: { data: ETIKET(12, { qr_payload: "" }) },
    };
    await sar([11, 12]);

    const uyari = await screen.findByRole("alert");
    expect(uyari.textContent).toMatch(/PKT-000012/);
    expect(document.querySelectorAll(".package-label")).toHaveLength(1);
    expect(qrCagrilari.map((p) => String(p.value))).not.toContain("");
  });

  it("kâğıt sözleşmesi: A4, 2 sütun, sayfa başına 8 etiket ve bölünme yasağı", async () => {
    // Sayfa başına etiket sayısı TAHMİN değil: 2 sütun × 4 satır. Baskı
    // kuralları jsdom'da yerleşim üretmez, bu yüzden ölçülen şey sözleşmenin
    // kendisi — kural kaldırılırsa test kırılır.
    etiketler = { 11: { data: ETIKET(11) } };
    const { PackingLabelSheet: _s, LABELS_PER_PAGE } = await modul();
    expect(LABELS_PER_PAGE).toBe(8);
    expect(_s).toBeTruthy();

    await sar([11]);
    await waitFor(() =>
      expect(document.querySelectorAll(".package-label")).toHaveLength(1),
    );
    const stil = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent ?? "")
      .join("\n");
    expect(stil).toMatch(/@page\s*\{[^}]*size:\s*A4 portrait/);
    expect(stil).toMatch(/grid-template-columns:\s*1fr 1fr/);
    // Bir etiket iki sayfaya bölünürse yarım kalan QR okunamaz.
    expect(stil).toMatch(/\.package-label\s*\{[^}]*break-inside:\s*avoid/);
    // Ekran kabuğu (başlık, düğmeler) baskıya karışmaz.
    expect(stil).toMatch(/\.package-label-noprint\s*\{[^}]*display:\s*none/);
    // Fatura kuralının gizlediği görünürlük AÇIKÇA geri verilir.
    expect(stil).toMatch(
      /\.package-label\s*,\s*\.package-label\s*\*\s*\{[^}]*visibility:\s*visible/,
    );
  });
});
