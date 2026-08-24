/**
 * B-2b: `warnings` mekanizması vardı ama panelde ÖLÜYDÜ.
 *
 * Backend blok başına uyarı üretip gönderiyordu; panel taslağı kurarken bu
 * alanı ayıklayıp atıyordu (`warnings: _warnings`) ve hiçbir yerde
 * basmıyordu. Yani yönetici "bu kart hiçbir yere gitmiyor" veya "N sabit
 * ürün gizlendi" uyarılarını hiç görmüyordu.
 *
 * Burada iki şey ayrı ayrı kanıtlanır:
 *  1. uyarıların blok anahtarına göre eşlenmesi (saf),
 *  2. uyarının GERÇEKTEN DOM'a basılması (RTL) — saf eşleme tek başına
 *     "kullanıcı uyarıyı görüyor" demez.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  BlockWarnings,
  warningsByBlockKey,
} from "@/components/admin/store/LandingPagesManager";

describe("warningsByBlockKey", () => {
  it("blok anahtarina gore uyarilari eslestirir", () => {
    const harita = warningsByBlockKey([
      { block_key: "a", warnings: ["1 slayt hiçbir yere gitmiyor."] },
      { block_key: "b", warnings: [] },
    ]);
    expect(harita.a).toEqual(["1 slayt hiçbir yere gitmiyor."]);
    expect(harita.b).toBeUndefined();
  });

  it("onizleme verisi yokken cokmez", () => {
    expect(warningsByBlockKey(undefined)).toEqual({});
    expect(warningsByBlockKey([])).toEqual({});
  });

  it("anahtarsiz bloklari atlar", () => {
    expect(warningsByBlockKey([{ warnings: ["x"] }])).toEqual({});
  });
});

describe("BlockWarnings", () => {
  it("uyari metnini DOM'a basar", () => {
    render(
      <BlockWarnings
        warnings={[
          "1 görsel kart hiçbir yere gitmiyor: hedef adres boş.",
          "2 sabit ürün gizlendi.",
        ]}
      />,
    );
    // Proje jest-dom kullanmiyor; iddialar dogrudan DOM uzerinden kurulur.
    expect(screen.getByText(/1 görsel kart hiçbir yere gitmiyor/)).toBeTruthy();
    expect(screen.getByText(/2 sabit ürün gizlendi/)).toBeTruthy();
  });

  it("uyari yokken hicbir sey basmaz", () => {
    const { container } = render(<BlockWarnings warnings={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("uyari bolgesi erisilebilir bir uyari olarak duyurulur", () => {
    render(<BlockWarnings warnings={["bir sorun var"]} />);
    // `role="status"` DEĞİL: bu bir dikkat çekme, nötr bir durum satırı değil.
    expect(screen.getByRole("alert").textContent).toContain("bir sorun var");
  });
});
