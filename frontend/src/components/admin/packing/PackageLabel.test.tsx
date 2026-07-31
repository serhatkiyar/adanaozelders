// F30 paket etiketi — baskı sözleşmesi.
//
// `LabelSheet.test.tsx`'in devamı ve aynı gerekçeyle yazıldı: F26
// doğrulamasında gerçek Chrome ile PDF'e basıldığında iki bağımsız kusur
// çıkmıştı (boş baskı + ezilen QR). jsdom yerleşim hesaplamadığı için ölçüm
// tarayıcıda yapılır, **kural burada sabitlenir**. Gerçek baskı turu commit
// 8'de (Chrome + DevTools Protocol) ayrıca koşacak.
//
// F30'a özel iki yeni kural:
//   1) Etiketteki QR **paket** QR'ıdır (`PKG1:` önekli), durak QR'ı DEĞİL.
//      Durak token'ı tur iptalinde kayboluyordu (G3): basılı etiket 2. teslim
//      denemesinde geçersizleşiyordu.
//   2) Etikette insan okunur paket kodu (`PKT-000077`) bulunur — telefonda
//      okunabilsin, QR okunamazsa operasyon durmasın.
//
// Bileşen henüz yazılmadığı için tüm düğümler KIRMIZIDIR.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

const UZUN_BASLIK =
  "TYT ve AYT İçin Kapsamlı Matematik Soru Bankası Video Çözümlü " +
  "Genişletilmiş 2026 Baskısı Set Halinde Toplam Dört Kitap";

// `import.meta.glob`: Vite düz dinamik import'u derleme anında çözer ve dosya
// yoksa tüm matrisi collection'da düşürür ("no tests"). Glob boş eşleşme döner.
const MODULLER = import.meta.glob("./PackageLabel.tsx");

async function bilesen(): Promise<any> {
  const yukle = MODULLER["./PackageLabel.tsx"];
  if (!yukle) {
    throw new Error("HENÜZ YAZILMADI: src/components/admin/packing/PackageLabel.tsx");
  }
  return ((await yukle()) as Record<string, any>).PackageLabel;
}

const paket = (over: Record<string, unknown> = {}) => ({
  id: 77,
  code: "PKT-000077",
  order_id: 1922,
  status: "PACKED",
  qr_payload: "PKG1:77:UzunTokenDegeri",
  recipient: "Ayşe Yıldız",
  address: "Kurtuluş Mah. 64019 Sk. No:12 D:4, Seyhan",
  phone: "+905550001000",
  delivery_pref: "ADRESIMDEYIM",
  items: [
    {
      order_item_id: 1,
      sku: "FZK-000011",
      title: "TYT Matematik Soru Bankası",
      expected_qty: 1,
      scanned_qty: 1,
    },
  ],
  ...over,
});

describe("PackageLabel baskı sözleşmesi", () => {
  it("print CSS'i etiketin GÖRÜNÜRLÜĞÜNÜ geri verir", async () => {
    // `index.css:268-286` fatura kuralı `body * { visibility: hidden }` yapıyor;
    // portal `body`'ye bastığı için etiket o kapsama giriyor. Geri verilmezse
    // baskı 1 KB'lık boş PDF olur (bir kez yaşandı).
    const PackageLabel = await bilesen();
    render(<PackageLabel package={paket()} onClose={() => {}} />);
    const style = document.querySelector("style");
    expect(style?.textContent).toContain("@media print");
    expect(style?.textContent).toMatch(
      /\.package-label\s*,\s*\.package-label\s*\*\s*\{[^}]*visibility:\s*visible/,
    );
  });

  it("QR PAKET uzayındadır (PKG1 önekli), durak QR'ı değil", async () => {
    // G3'ün düzeltmesinin etiket tarafındaki kanıtı.
    const PackageLabel = await bilesen();
    render(<PackageLabel package={paket()} onClose={() => {}} />);
    const svg = document.querySelector(".package-label svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("data-qr-value") ?? "").toMatch(/^PKG1:/);
  });

  it("QR shrink-0 taşır ve okunabilir boyutun altına inmez", async () => {
    // Ölçüm gerçek Chrome'da yapıldı: flex kardeşi uzun metin QR'ı 96→36 px'e
    // eziyordu; kare bozulunca karekod okunamaz.
    const PackageLabel = await bilesen();
    render(
      <PackageLabel
        package={paket({
          items: [
            { order_item_id: 1, sku: "FZK-000011", title: UZUN_BASLIK, expected_qty: 2, scanned_qty: 2 },
          ],
        })}
        onClose={() => {}}
      />,
    );
    const svg = document.querySelector(".package-label svg");
    expect(svg?.getAttribute("class") ?? "").toContain("shrink-0");
    expect(Number(svg?.getAttribute("width") ?? 0)).toBeGreaterThanOrEqual(96);
  });

  it("hata düzeltme seviyesi M'dir (etiket buruşur/lekelenir)", async () => {
    // Varsayılan "L" %7 tolerans verir; depo ortamında yetersiz.
    const PackageLabel = await bilesen();
    render(<PackageLabel package={paket()} onClose={() => {}} />);
    const svg = document.querySelector(".package-label svg");
    expect(svg?.getAttribute("data-qr-level")).toBe("M");
  });

  it("insan okunur paket kodu ve sipariş numarası basılır", async () => {
    const PackageLabel = await bilesen();
    render(<PackageLabel package={paket()} onClose={() => {}} />);
    const text = document.querySelector(".package-label")?.textContent ?? "";
    expect(text).toContain("PKT-000077");
    expect(text).toContain("1922");
  });

  it("kalemler SKU ve adetle basılır; adet 1'de × yazılmaz", async () => {
    const PackageLabel = await bilesen();
    render(
      <PackageLabel
        package={paket({
          items: [
            { order_item_id: 1, sku: "FZK-000011", title: "AYT Fizik Konu Anlatımı", expected_qty: 1, scanned_qty: 1 },
            { order_item_id: 2, sku: "FZK-000012", title: "Paragraf Denemeleri", expected_qty: 2, scanned_qty: 2 },
          ],
        })}
        onClose={() => {}}
      />,
    );
    const text = document.querySelector(".package-label")?.textContent ?? "";
    expect(text).toContain("FZK-000011");
    expect(text).toContain("Paragraf Denemeleri × 2");
    expect(text).not.toContain("AYT Fizik Konu Anlatımı × 1");
    expect(text).toContain("3 parça");
  });

  it("kalemsiz pakette eksik-veri metni basılır (sessiz boşluk yok)", async () => {
    // F26'da etiket bomboş basılmıştı; boşluk hatayı gizler.
    const PackageLabel = await bilesen();
    render(<PackageLabel package={paket({ items: [] })} onClose={() => {}} />);
    const text = document.querySelector(".package-label")?.textContent ?? "";
    expect(text).toContain("Kalem bilgisi yok");
  });

  it("teslimat talimatı bandı basılır (kapıya/komşuya bırak)", async () => {
    const PackageLabel = await bilesen();
    render(
      <PackageLabel package={paket({ delivery_pref: "KOMSUYA_BIRAK" })} onClose={() => {}} />,
    );
    expect(document.querySelector(".package-label")?.textContent ?? "").toMatch(
      /KOMŞUYA/i,
    );
  });
});
