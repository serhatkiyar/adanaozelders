import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DersSecici } from "./DersSecici";
import type { Ders, SeviyeMerdiveni } from "@/api/subjects";

/**
 * Seçicinin tek kritik davranışı: SEVİYELER DERSE GÖRE DEĞİŞİR ve kuralı
 * sunucu söyler (`Ders.scales`). İstemci kendi kuralını üretirse Matematik'e
 * A1–C2 sunmaya başlar; kullanıcı seçer, sunucu 422 döner, kimse anlamaz.
 */

const ders = (o: Partial<Ders> & Pick<Ders, "id" | "name" | "scales">): Ders => ({
  slug: o.name.toLowerCase(),
  parent_id: null,
  group_code: "OKUL",
  sort_order: 0,
  aliases: [],
  ...o,
});

const KATALOG: Ders[] = [
  ders({ id: 1, name: "Matematik", scales: ["OKUL"] }),
  ders({ id: 2, name: "İngilizce", scales: ["OKUL", "CEFR"], group_code: "DIL" }),
  ders({ id: 3, name: "Gitar", scales: ["SANAT"], group_code: "MUZIK" }),
];

const MERDIVENLER: SeviyeMerdiveni[] = [
  {
    code: "OKUL",
    name: "Okul kademesi",
    sort_order: 1,
    levels: [
      { id: 10, scale_code: "OKUL", code: "ilkokul", name: "İlkokul", sort_order: 1 },
      { id: 11, scale_code: "OKUL", code: "lise", name: "Lise", sort_order: 2 },
    ],
  },
  {
    code: "CEFR",
    name: "Avrupa dil seviyesi",
    sort_order: 2,
    levels: [
      { id: 20, scale_code: "CEFR", code: "b1", name: "B1", sort_order: 3 },
    ],
  },
  {
    code: "SANAT",
    name: "Yetkinlik",
    sort_order: 3,
    levels: [
      { id: 30, scale_code: "SANAT", code: "baslangic", name: "Başlangıç", sort_order: 1 },
    ],
  },
];

function ekran(props: Partial<Parameters<typeof DersSecici>[0]> = {}) {
  const onToggle = vi.fn();
  const onSeviye = vi.fn();
  render(
    <DersSecici
      katalog={KATALOG}
      merdivenler={MERDIVENLER}
      secili={[]}
      seviyeler={{}}
      duzenlenebilir
      onToggle={onToggle}
      onSeviye={onSeviye}
      {...props}
    />
  );
  return { onToggle, onSeviye };
}

describe("ders seçici", () => {
  it("boş sorguda katalog basılmaz, arama beklenir", () => {
    ekran();
    // 846 kalemi düz basmak okunamaz; kullanıcı yazarak süzer.
    expect(screen.queryByRole("button", { name: "Matematik" })).toBeNull();
    expect(screen.getByText(/3 ders arasından/)).toBeTruthy();
  });

  it("yazarak süzer ve seçimi bildirir", () => {
    const { onToggle } = ekran();
    fireEvent.change(screen.getByLabelText("Ders ara"), { target: { value: "mat" } });
    const dugme = screen.getByRole("button", { name: "Matematik" });
    fireEvent.click(dugme);
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it("seviye seçenekleri DERSE GÖRE değişir", () => {
    ekran({ secili: ["Matematik"] });
    expect(screen.getByRole("button", { name: "Lise" })).toBeTruthy();
    // Matematik'in merdiveni OKUL — CEFR basamağı sunulmamalı.
    expect(screen.queryByRole("button", { name: "B1" })).toBeNull();
  });

  it("iki merdivenli ders ikisini de gösterir", () => {
    ekran({ secili: ["İngilizce"] });
    expect(screen.getByRole("button", { name: "Lise" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "B1" })).toBeTruthy();
  });

  it("seçili seviye basılı görünür ve tıklama bildirilir", () => {
    const { onSeviye } = ekran({ secili: ["Gitar"], seviyeler: { 3: [30] } });
    const dugme = screen.getByRole("button", { name: "Başlangıç" });
    expect(dugme.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(dugme);
    expect(onSeviye).toHaveBeenCalledWith(3, 30);
  });

  it("düzenlenemez durumda tüm kontroller kapalı", () => {
    ekran({ secili: ["Matematik"], duzenlenebilir: false });
    expect(screen.getByLabelText("Ders ara").hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByRole("button", { name: "Lise" }).hasAttribute("disabled")
    ).toBe(true);
  });
});
