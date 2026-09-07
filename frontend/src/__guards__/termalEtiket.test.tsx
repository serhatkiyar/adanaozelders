/**
 * 100 × 150 mm termal kargo etiketi — nöbetçi.
 *
 * ## Karar (kullanıcı, 7 Eyl 2026)
 *
 * *"100x150 kargo etiketi gibi tasarım oluşturur musun etiketler için."*
 *
 * Önceki kâğıt A4'e göre yazılmıştı ve **fiziksel bir ölçüsü yoktu**: etiket
 * yazıcısına basıldığında ölçek yazıcının kendi yorumuna kalıyordu. Artık
 * kâğıt 100×150 mm, `@page` ile ilan ediliyor ve kartın kendisi de aynı
 * ölçüde.
 *
 * ## Bu nöbetçinin ASIL iddiası
 *
 * Sessizce yanlış gidebilecek üç şey var ve üçü de KÂĞIDA basıldıktan sonra
 * anlaşılır — yani en pahalı yerde:
 *
 *   1. **Ölçü `px`e döner.** `px` yazıcının DPI'ına göre kayar (203 vs 300
 *      dpi); milimetre fiziksel gerçektir. Etiket 3 mm kayınca barkod
 *      kenardan taşar.
 *   2. **`@page` düşer.** O zaman tarayıcı A4 varsayar ve 100×150'lik tasarım
 *      A4'ün sol üst köşesinde minik bir kare olarak basılır.
 *   3. **Gri zemin girer.** Termal kafa gri tonu nokta seyreltmesiyle taklit
 *      eder; sonuç lekeli ve okunmaz olur. Bu yüzden etikette ara ton YOKTUR.
 *
 * ## Gerçek Chrome ölçümü (kanıt)
 *
 * Gerçek admin oturumu → gerçek paket (PKT-000003) → `Page.printToPDF`:
 *
 *     ekran     : 100.0 mm × 150.0 mm
 *     PDF sayfa :  99.8 mm × 149.9 mm   (yuvarlama payı)
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * KAYNAK SÖZLEŞMESİ + gerçek DOM. "Yazıcıdan doğru çıkıyor" iddiasını
 * kanıtlamaz — onun kanıtı yukarıdaki PDF ölçümü ve fiziksel baskı denemesidir
 * (fiziksel deneme HÂLÂ YAPILMADI, bkz. docs/teknik-borc.md F30).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("qrcode.react", () => ({
  QRCodeSVG: (props: Record<string, unknown>) => (
    <svg data-testid="qr" data-size={String(props.size)} data-level={String(props.level)} />
  ),
}));

import { OPERATOR } from "@/lib/legalContent";
import {
  TERMAL_BOY_MM,
  TERMAL_EN_MM,
  TERMAL_PRINT_CSS,
  TermalEtiketKarti,
  type PackageLabelData,
} from "@/components/admin/packing/PackageLabel";

const KOK = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  ".."
);
const KAYNAK = readFileSync(
  join(KOK, "src", "components", "admin", "packing", "PackageLabel.tsx"),
  "utf8"
);

const PAKET: PackageLabelData = {
  package_id: 3,
  code: "PKT-000003",
  order_id: 3772,
  qr_payload: "PKG1:3:TOKEN",
  recipient: "Serhat Kıyar",
  address: "Adana Merkez",
  city: "Adana",
  district: "Seyhan",
  items: [{ order_item_id: 1, title: "Soru Bankası", expected_qty: 1, sku: "FZK-1" }],
};

describe("termal kargo etiketi · 100 × 150 mm", () => {
  it("ölçü tek kaynaktan gelir ve MİLİMETREDİR", () => {
    // `px` yazıcı DPI'ına göre kayar; kâğıt ölçüsü fiziksel bir gerçektir.
    expect(TERMAL_EN_MM).toBe(100);
    expect(TERMAL_BOY_MM).toBe(150);
  });

  it("`@page` kâğıdı 100×150 mm ilan eder, kenar payı SIFIR", () => {
    // Düşerse tarayıcı A4 varsayar ve etiket köşede minik bir kare olur.
    expect(TERMAL_PRINT_CSS).toContain("@page { size: 100mm 150mm; margin: 0; }");
  });

  it("her etiket KENDİ sayfasına basılır", () => {
    // Termal yazıcı etiket etiket keser; iki etiket bir sayfaya sığdırılamaz.
    expect(TERMAL_PRINT_CSS).toMatch(/break-after:\s*page/);
    expect(TERMAL_PRINT_CSS).toMatch(/break-inside:\s*avoid/);
  });

  it("kart GERÇEKTEN 100 mm genişliğinde ve en az 150 mm boyunda çizilir", () => {
    // DOLULUK + kararın kendisi: sınıf adı değil, uygulanan ÖLÇÜ ölçülür.
    const { container } = render(<TermalEtiketKarti package={PAKET} />);
    const kart = container.querySelector(".termal-etiket") as HTMLElement;
    expect(kart, "etiket çizilmedi").toBeTruthy();
    expect(kart.style.width).toBe("100mm");
    expect(kart.style.minHeight).toBe("150mm");
    // Sabit `height` DEĞİL: uzun adres/kalem listesi kırpılmamalı, etiket uzar.
    expect(kart.style.height).toBe("");
  });

  it("etikette GRİ ara ton yok (termal kafa griyi lekeye çevirir)", () => {
    // Kaynak sözleşmesi: termal kartın gövdesinde `text-slate-*` / `bg-slate-*`
    // gibi ara tonlar aranır. A4 kâğıdı (PackageLabelCard) kapsam DIŞI —
    // o normal yazıcıya basılıyor ve grisi sorun değil.
    const bas = KAYNAK.indexOf("export function TermalEtiketKarti");
    const son = KAYNAK.indexOf("/* ═", bas);
    const govde = KAYNAK.slice(bas, son > 0 ? son : undefined);
    expect(govde.length, "termal kart gövdesi bulunamadı").toBeGreaterThan(500);
    expect(govde, "etikette gri ton var").not.toMatch(/(text|bg|border)-slate-[1-7]00/);
  });

  it("karekod okunabilir ölçüde ve yüksek tolerans düzeyinde", () => {
    // Depo ortamında etiket buruşur/lekelenir: "L" (%7) yetmez, "M" (%15)
    // gerekir. Ölçü de bir eşiktir — küçülürse okutma başarısız olur.
    const { getByTestId } = render(<TermalEtiketKarti package={PAKET} />);
    const qr = getByTestId("qr");
    expect(qr.getAttribute("data-level")).toBe("M");
    expect(Number(qr.getAttribute("data-size"))).toBeGreaterThanOrEqual(120);
  });

  it("LOGO basılır ve SİYAH sürümdür", () => {
    // Kullanıcı isteği. Renkli logo termal kafada gri lekeye dönerdi; siyah
    // sürüm `public/logo-yatay-siyah.svg` olarak projeye alındı.
    const { container } = render(<TermalEtiketKarti package={PAKET} />);
    const logo = container.querySelector("img");
    expect(logo, "logo yok").toBeTruthy();
    expect(logo!.getAttribute("src")).toBe("/logo-yatay-siyah.svg");
    // Genişlik mm cinsinden sabitlenir: `px` yazıcı DPI'ında kayar.
    expect(logo!.style.width).toMatch(/mm$/);
  });

  it("GÖNDERİCİ bloğu işletme kimliğinin TEK kaynağından gelir", () => {
    // Kargo etiketinin değişmezi: teslim edilemeyen paketin döneceği adres.
    // Uydurulmuş metin DEĞİL — `legalContent.ts::OPERATOR`, yani yasal
    // metinlerdeki bilgiyle aynı kaynak. İkisi ayrışamaz.
    const { container } = render(<TermalEtiketKarti package={PAKET} />);
    const metin = container.querySelector(".termal-etiket")!.textContent ?? "";
    // Büyük harf CSS ile yapılır (`uppercase`), metin kaynakta "Gönderici".
    expect(metin).toContain("Gönderici");
    expect(metin).toContain(OPERATOR.entity);
    expect(metin).toContain(OPERATOR.phone);
    expect(metin).toContain(OPERATOR.address);
  });

  it("adres ve alıcı KIRPILMAZ (kâğıtta truncate yasağı sürüyor)", () => {
    // Kesilen adres kuryeyi yanlış kapıya götürür ve kesildiğini göstermez.
    const { container } = render(<TermalEtiketKarti package={PAKET} />);
    const kart = container.querySelector(".termal-etiket")!;
    expect(kart.querySelectorAll(".truncate, [class*='line-clamp']").length).toBe(0);
    expect(kart.textContent).toContain("Serhat Kıyar");
    expect(kart.textContent).toContain("Adana Merkez");
  });
});
