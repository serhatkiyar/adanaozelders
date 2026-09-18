// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildAxes,
  istenenCoz,
  karsilanmayanSecim,
  seciciGosterilsin,
} from "./variantAxes";
import type { ProductVariantMember, ProductVariants } from "@/types";

let sonrakiId = 1;

function uye(
  o1: string,
  o2: string | null,
  over: Partial<ProductVariantMember> = {}
): ProductVariantMember {
  const id = over.id ?? sonrakiId++;
  return {
    id,
    slug: `u-${o1}-${o2 ?? "tek"}`.toLowerCase(),
    title: `${o1}${o2 ? ` / ${o2}` : ""}`,
    option1_value: o1,
    option2_value: o2,
    variant_sort: 0,
    in_stock: true,
    price: "100.00",
    ...over,
  };
}

function grup(members: ProductVariantMember[], ikiEksen = true): ProductVariants {
  return {
    group_id: 1,
    title: "Kalem",
    option1_name: "Renk",
    option2_name: ikiEksen ? "Ebat" : null,
    members,
  };
}

describe("buildAxes — eksen ızgarası", () => {
  it("iki ekseni AYRI ızgaralara böler (kartezyen düz liste değil)", () => {
    const uyeler = [
      uye("Kırmızı", "S", { id: 1 }),
      uye("Kırmızı", "M", { id: 2 }),
      uye("Mavi", "S", { id: 3 }),
      uye("Mavi", "M", { id: 4 }),
    ];
    const axes = buildAxes(grup(uyeler), 1);

    expect(axes.map((a) => a.name)).toEqual(["Renk", "Ebat"]);
    expect(axes[0].values.map((v) => v.value)).toEqual(["Kırmızı", "Mavi"]);
    expect(axes[1].values.map((v) => v.value)).toEqual(["S", "M"]);
  });

  it("tek eksenli grupta ikinci ızgara hiç çizilmez", () => {
    const axes = buildAxes(grup([uye("70g", null, { id: 1 })], false), 1);
    expect(axes).toHaveLength(1);
  });

  it("seçili değer HER eksende işaretlenir (başlıkta yazılabilsin)", () => {
    const uyeler = [
      uye("Kırmızı", "S", { id: 1 }),
      uye("Kırmızı", "M", { id: 2 }),
      uye("Mavi", "S", { id: 3 }),
      uye("Mavi", "M", { id: 4 }),
    ];
    const axes = buildAxes(grup(uyeler), 4); // Mavi / M
    expect(axes[0].secili).toBe("Mavi");
    expect(axes[1].secili).toBe("M");
    expect(axes[0].values.find((v) => v.value === "Mavi")!.durum).toBe("secili");
    expect(axes[1].values.find((v) => v.value === "M")!.durum).toBe("secili");
  });

  it("diğer eksendeki seçimi KORUR: renk değişince ebat aynı kalır", () => {
    const uyeler = [
      uye("Kırmızı", "S", { id: 1 }),
      uye("Kırmızı", "M", { id: 2 }),
      uye("Mavi", "S", { id: 3 }),
      uye("Mavi", "M", { id: 4 }),
    ];
    const axes = buildAxes(grup(uyeler), 2); // Kırmızı / M
    const mavi = axes[0].values.find((v) => v.value === "Mavi")!;
    expect(mavi.hedef!.id).toBe(4); // Mavi / M — ebat korundu
    expect(mavi.digerEksenDegisecek).toBe(false);
  });

  it("tükenen kombinasyon GİZLENMEZ, 'tukendi' işaretlenir", () => {
    const uyeler = [
      uye("Kırmızı", "S", { id: 1 }),
      uye("Kırmızı", "M", { id: 2, in_stock: false }),
    ];
    const axes = buildAxes(grup(uyeler), 1);
    const m = axes[1].values.find((v) => v.value === "M")!;
    expect(m.durum).toBe("tukendi");
    expect(m.hedef!.id).toBe(2); // tıklanabilir: o sayfada "gelince haber ver" var
  });

  it("hiç üretilmemiş kombinasyon 'yok'tur ve 'tukendi'den AYRIDIR", () => {
    // Mavi yalnız S'te üretilmiş; Mavi/M diye bir kalem hiç yok.
    const uyeler = [
      uye("Kırmızı", "S", { id: 1 }),
      uye("Kırmızı", "M", { id: 2 }),
      uye("Mavi", "S", { id: 3 }),
    ];
    const axes = buildAxes(grup(uyeler), 2); // Kırmızı / M
    const mavi = axes[0].values.find((v) => v.value === "Mavi")!;
    expect(mavi.durum).toBe("yok");
  });

  it("'yok' değer ÇIKMAZ SOKAK değildir: en yakın kardeşe götürür", () => {
    const uyeler = [
      uye("Kırmızı", "S", { id: 1 }),
      uye("Kırmızı", "M", { id: 2 }),
      uye("Mavi", "S", { id: 3 }),
    ];
    const axes = buildAxes(grup(uyeler), 2); // Kırmızı / M
    const mavi = axes[0].values.find((v) => v.value === "Mavi")!;
    expect(mavi.hedef!.id).toBe(3); // Mavi / S
    expect(mavi.digerEksenDegisecek).toBe(true);
  });

  it("kaybedilen seçim bağlantıda taşınır — TIKLANAN değil", () => {
    const uyeler = [
      uye("Kırmızı", "S", { id: 1 }),
      uye("Kırmızı", "M", { id: 2 }),
      uye("Mavi", "S", { id: 3 }),
    ];
    const axes = buildAxes(grup(uyeler), 2); // Kırmızı / M
    const mavi = axes[0].values.find((v) => v.value === "Mavi")!;
    // Kaybedilen: Ebat M. "Renk:Mavi" taşımak işe yaramazdı — varışta zaten seçili.
    expect(mavi.kayipIpucu).toBe("Ebat:M");
  });

  it("korunan geçişte ipucu YOKTUR (gereksiz uyarı çıkmasın)", () => {
    const uyeler = [
      uye("Kırmızı", "S", { id: 1 }),
      uye("Mavi", "S", { id: 2 }),
    ];
    const axes = buildAxes(grup(uyeler), 1);
    expect(axes[0].values.find((v) => v.value === "Mavi")!.kayipIpucu).toBeNull();
  });

  it("sıra dayatmaz: ebattan başlanınca da renkler kısıtlanır", () => {
    const uyeler = [
      uye("Kırmızı", "S", { id: 1 }),
      uye("Kırmızı", "M", { id: 2 }),
      uye("Mavi", "S", { id: 3 }),
    ];
    // Kırmızı / S'teyken "M"ye bakalım: Kırmızı M var → seçilebilir.
    const axes = buildAxes(grup(uyeler), 1);
    expect(axes[1].values.find((v) => v.value === "M")!.durum).toBe("secilebilir");
    // Mavi / S'teyken "M": Mavi M yok → yok.
    const axes2 = buildAxes(grup(uyeler), 3);
    expect(axes2[1].values.find((v) => v.value === "M")!.durum).toBe("yok");
  });

  it("renk örneği eşleşen eksen değerine bağlanır", () => {
    const uyeler = [uye("Kırmızı", null, { id: 1 }), uye("Mavi", null, { id: 2 })];
    const g: ProductVariants = {
      ...grup(uyeler, false),
      swatches: [{ axis_name: "Renk", value: "Kırmızı", hex: "#C0392B" }],
    };
    const axes = buildAxes(g, 1);
    expect(axes[0].values[0].swatchHex).toBe("#C0392B");
    expect(axes[0].values[1].swatchHex).toBeNull();
  });
});

describe("karsilanmayanSecim", () => {
  const uyeler = [
    uye("Kırmızı", "S", { id: 1 }),
    uye("Kırmızı", "M", { id: 2 }),
    uye("Mavi", "S", { id: 3 }),
  ];

  it("kayıp gerçekleştiyse hangi değerlerin mevcut olduğunu YAZAR", () => {
    const axes = buildAxes(grup(uyeler), 3); // Mavi / S
    const mesaj = karsilanmayanSecim(axes, { axisName: "Ebat", value: "M" });
    expect(mesaj).toContain("M");
    expect(mesaj).toContain("Mevcut: S");
  });

  it("kayıp YOKSA sessiz kalır (eski URL yanlış uyarı üretmesin)", () => {
    const axes = buildAxes(grup(uyeler), 2); // Kırmızı / M — M zaten seçili
    expect(karsilanmayanSecim(axes, { axisName: "Ebat", value: "M" })).toBeNull();
  });

  it("ipucu yoksa hiçbir şey yazmaz", () => {
    const axes = buildAxes(grup(uyeler), 1);
    expect(karsilanmayanSecim(axes, null)).toBeNull();
  });

  it("tanınmayan eksen adında sessiz kalır", () => {
    const axes = buildAxes(grup(uyeler), 1);
    expect(karsilanmayanSecim(axes, { axisName: "Gramaj", value: "80" })).toBeNull();
  });
});

describe("istenenCoz", () => {
  it("Eksen:Değer ayrıştırır", () => {
    expect(istenenCoz("Ebat:M")).toEqual({ axisName: "Ebat", value: "M" });
  });

  it("değerdeki iki nokta korunur (ilk ayraçtan bölünür)", () => {
    expect(istenenCoz("Not:10:30")).toEqual({ axisName: "Not", value: "10:30" });
  });

  it("bozuk girdide null döner", () => {
    expect(istenenCoz(null)).toBeNull();
    expect(istenenCoz("")).toBeNull();
    expect(istenenCoz("Ebat")).toBeNull();
    expect(istenenCoz(":M")).toBeNull();
    expect(istenenCoz("Ebat:")).toBeNull();
  });
});

describe("seciciGosterilsin", () => {
  it("tek üyeli grupta seçici çizilmez", () => {
    expect(seciciGosterilsin(grup([uye("Kırmızı", null, { id: 1 })], false))).toBe(false);
  });

  it("grupsuz üründe çizilmez", () => {
    expect(seciciGosterilsin(null)).toBe(false);
    expect(seciciGosterilsin(undefined)).toBe(false);
  });

  it("iki üyeden itibaren çizilir", () => {
    expect(
      seciciGosterilsin(grup([uye("A", null, { id: 1 }), uye("B", null, { id: 2 })], false))
    ).toBe(true);
  });
});
