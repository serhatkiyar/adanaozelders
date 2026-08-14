// İP-17 V-10 — vade metninin GERÇEK DOM kanıtı.
//
// Sunucu artık gün ölçekli vadeyi çalışma gününün başına yuvarlıyor; bu
// yüzden her REVIEW kartı aynı saati taşıyor ve o saat kullanıcıya bilgi
// vermiyor. Karar: REVIEW'da yalnız tarih, intraday adımlarda tarih + saat.
//
// Saat dilimi bağımsız ölçüm: literal "04:00" beklenmez (test makinesinin
// TZ'ine göre kayar ve CI'da yalancı kırmızı üretirdi). Ölçülen şey metinde
// SAAT DESENİ olup olmadığıdır — kararın kendisi zaten budur.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SrsDueLabel } from "./SrsDueLabel";

const SAAT_DESENI = /\d{1,2}:\d{2}/;
// 2026-08-11 04:00 Europe/Istanbul — sunucunun yuvarladığı gün başı.
const GUN_BASI = "2026-08-11T01:00:00Z";

describe("SrsDueLabel", () => {
  it("REVIEW kartında saat GÖSTERİLMEZ, yalnız tarih", () => {
    const { container } = render(
      <SrsDueLabel state="REVIEW" dueAt={GUN_BASI} />,
    );
    const metin = container.textContent ?? "";
    expect(metin).not.toMatch(SAAT_DESENI);
    expect(metin).toContain("2026");
    expect(metin.length).toBeGreaterThan(0);
  });

  it("LEARNING kartında saat GÖSTERİLİR (intraday adım, saat bilgi taşır)", () => {
    const { container } = render(
      <SrsDueLabel state="LEARNING" dueAt="2026-08-11T01:10:00Z" />,
    );
    expect(container.textContent ?? "").toMatch(SAAT_DESENI);
  });

  it("RELEARNING kartında da saat gösterilir", () => {
    const { container } = render(
      <SrsDueLabel state="RELEARNING" dueAt="2026-08-11T01:10:00Z" />,
    );
    expect(container.textContent ?? "").toMatch(SAAT_DESENI);
  });

  it("vadesi olmayan kartta tire basılır", () => {
    const { container } = render(<SrsDueLabel state="NEW" dueAt={null} />);
    expect(container.textContent).toBe("—");
  });

  it("aynı güne düşen iki REVIEW kartı AYNI metni gösterir", () => {
    // Yuvarlamadan sonra iki kartın damgası birebir eşit olur; ekranda da
    // ayırt edilemez görünmeleri beklenen davranıştır (V-8'in yüzeyi).
    const a = render(<SrsDueLabel state="REVIEW" dueAt={GUN_BASI} />);
    const b = render(<SrsDueLabel state="REVIEW" dueAt={GUN_BASI} />);
    expect(a.container.textContent).toBe(b.container.textContent);
  });
});
