// Paket etiketi — GERÇEK yazdırma önizlemesinde bulunan iki hatanın nöbetçisi.
//
// F26 doğrulaması sırasında etiket çıktısı gerçek Chrome ile PDF'e basıldı ve
// iki bağımsız kusur çıktı. İkisi de jsdom'da "görünmez"di (jsdom yerleşim
// hesaplamaz), o yüzden burada **kaynak sözleşmesi** doğrulanıyor: ölçüm
// tarayıcıda yapıldı, kural burada sabitleniyor.
//
// 1) BASKI BOMBOŞTU. `index.css` fatura kuralı `@media print`te
//    `body * { visibility: hidden }` yapıp yalnız `#order-invoice`'i geri
//    açıyor. Etiket sayfası portal ile `body`'ye basıldığı için o kuralın
//    kapsamına giriyordu ve görünürlüğünü geri vermiyordu → 1 KB'lık boş PDF.
//
// 2) QR EZİLİYORDU. `QRCodeSVG` bir flex öğesi; varsayılan `flex-shrink: 1`
//    ile uzun metin kardeşi onu yatay olarak sıkıştırıyordu (ölçüm: 96px → 36px,
//    yükseklik 96 kalıyor) — kare bozulunca karekod okunamaz.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LabelSheet } from "./LabelSheet";

import type { DeliveryRun, DeliveryStop } from "@/types";

const UZUN_BASLIK =
  "TYT ve AYT İçin Kapsamlı Matematik Soru Bankası Video Çözümlü " +
  "Genişletilmiş 2026 Baskısı Set Halinde Toplam Dört Kitap";

function stop(over: Partial<DeliveryStop> = {}): DeliveryStop {
  return {
    id: 1,
    run_id: 9,
    order_id: 1922,
    sequence: 1,
    status: "PENDING",
    qr_payload: "1:abc",
    recipient: "Ayşe Yıldız",
    address: "Kurtuluş Mah. 64019 Sk. No:12 D:4, Seyhan",
    phone: "+905550001000",
    items: [{ title: "TYT Matematik Soru Bankası", quantity: 1 }],
    ...over,
  } as DeliveryStop;
}

function run(stops: DeliveryStop[]): DeliveryRun {
  return { id: 909, run_date: "2027-08-24", vehicle: "LADA", status: "PLANNED", stops } as DeliveryRun;
}

describe("LabelSheet baskı sözleşmesi", () => {
  it("print CSS'i etiket sayfasının GÖRÜNÜRLÜĞÜNÜ geri verir", () => {
    // Bu satır olmadan baskı bomboş çıkıyor (index.css `body *` kuralı).
    const { container } = render(<LabelSheet run={run([stop()])} onClose={() => {}} />);
    const style = document.querySelector("style");
    expect(style?.textContent).toContain("@media print");
    expect(style?.textContent).toMatch(
      /\.delivery-label-sheet\s*,\s*\.delivery-label-sheet\s*\*\s*\{[^}]*visibility:\s*visible/,
    );
    expect(container).toBeTruthy();
  });

  it("QR shrink-0 taşır (uzun metin onu ezmesin)", () => {
    render(
      <LabelSheet
        run={run([stop({ items: [{ title: UZUN_BASLIK, quantity: 2 }] })])}
        onClose={() => {}}
      />,
    );
    const svg = document.querySelector(".delivery-label-paper svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("class") ?? "").toContain("shrink-0");
  });

  it("kalem başlıkları ve adetleri basılır; adet 1'de × yazılmaz", () => {
    render(
      <LabelSheet
        run={run([
          stop({
            items: [
              { title: "AYT Fizik Konu Anlatımı", quantity: 1 },
              { title: "Paragraf Denemeleri", quantity: 2 },
            ],
          }),
        ])}
        onClose={() => {}}
      />,
    );
    const text = document.querySelector(".delivery-label-paper")?.textContent ?? "";
    expect(text).toContain("AYT Fizik Konu Anlatımı");
    expect(text).toContain("Paragraf Denemeleri × 2");
    expect(text).not.toContain("AYT Fizik Konu Anlatımı × 1");
    // "N parça" özeti kalem listesinin yerine geçmiyor; ikisi birlikte.
    expect(text).toContain("3 parça");
  });

  it("kalemsiz siparişte eksik-veri metni basılır (sessiz boşluk yok)", () => {
    render(<LabelSheet run={run([stop({ items: [] })])} onClose={() => {}} />);
    const text = document.querySelector(".delivery-label-paper")?.textContent ?? "";
    expect(text).toContain("Kalem bilgisi yok");
  });
});
