import { describe, expect, it } from "vitest";

import { listeyiCevir, type ZoomKullanici } from "./cevir";

const k = (userId: number, displayName: string, ek: Partial<ZoomKullanici> = {}): ZoomKullanici => ({
  userId,
  displayName,
  bVideoOn: true,
  ...ek,
});

const BEN = k(3, "Dilan");
const kimlikler = (liste: ReturnType<typeof listeyiCevir>) => liste.map((x) => x.id);

describe("zoom/cevir · hayalet (failover) kayıtlar", () => {
  it("yeniden katılanın eski failover kaydı atılır; karşı taraf canlı kayıttır", () => {
    // Canlı denemedeki liste: ben, kendi hayaletim, karşının hayaleti, karşı canlı.
    const liste = listeyiCevir(
      [
        BEN,
        k(1, "Dilan", { bVideoOn: false, isInFailover: true }),
        k(2, "Serhat", { bVideoOn: false, isInFailover: true }),
        k(4, "Serhat"),
      ],
      BEN,
      "ogretmen",
    );
    expect(kimlikler(liste)).toEqual(["3", "4"]);
    expect(liste.find((x) => x.id === "4")?.yenidenBaglaniyor).toBe(false);
  });

  it("tek başına failover kaydı (gerçekten yeniden bağlanan) korunur", () => {
    const liste = listeyiCevir([BEN, k(2, "Serhat", { isInFailover: true })], BEN, "ogretmen");
    expect(kimlikler(liste)).toEqual(["3", "2"]);
    expect(liste[1].yenidenBaglaniyor).toBe(true);
  });

  it("kendi kaydım failover olsa da korunur", () => {
    const ben = k(3, "Dilan", { isInFailover: true });
    const liste = listeyiCevir([ben, k(1, "Dilan"), k(4, "Serhat")], ben, "ogretmen");
    expect(kimlikler(liste)).toContain("3");
  });

  it("userIdentity varsa ad yerine o eşleşir", () => {
    const liste = listeyiCevir(
      [BEN, k(2, "Ali", { isInFailover: true, userIdentity: "u1" }), k(4, "Ali", { userIdentity: "u2" })],
      BEN,
      "ogretmen",
    );
    expect(kimlikler(liste)).toEqual(["3", "2", "4"]);
  });

  it("kendi kaydım listede yoksa başa eklenir ve hayaletim atılır", () => {
    const liste = listeyiCevir([k(1, "Dilan", { isInFailover: true }), k(4, "Serhat")], BEN, "ogretmen");
    expect(kimlikler(liste)).toEqual(["3", "4"]);
  });
});
