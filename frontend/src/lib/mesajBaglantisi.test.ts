// @vitest-environment node
import { describe, expect, it } from "vitest";

import { mesajParcala } from "@/lib/mesajBaglantisi";

describe("mesajParcala", () => {
  it("javascript: ve data: adresleri bağlantıya dönüşmez", () => {
    const parcalar = mesajParcala(
      "tıkla javascript:alert(1) ya da data:text/html,x",
      "adanaozelders.com"
    );
    expect(parcalar.every((p) => p.tur === "metin")).toBe(true);
  });

  it("www. adresi https ile tamamlanır, sondaki nokta bağlantıya girmez", () => {
    const parcalar = mesajParcala("bak: www.ornek.com/a.", "adanaozelders.com");
    const baglanti = parcalar.find((p) => p.tur === "baglanti");
    expect(baglanti).toMatchObject({
      deger: "www.ornek.com/a",
      href: "https://www.ornek.com/a",
      dis: true,
    });
    expect(parcalar[parcalar.length - 1]).toEqual({ tur: "metin", deger: "." });
  });

  it("sitenin kendi alan adı iç bağlantı sayılır", () => {
    const parcalar = mesajParcala(
      "profilim https://www.adanaozelders.com/egitmenler/1",
      "adanaozelders.com"
    );
    expect(parcalar.find((p) => p.tur === "baglanti")).toMatchObject({ dis: false });
  });
});
