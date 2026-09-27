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

  it("userKey adın önüne geçer: aynı adlı iki farklı kişi ayrı kalır", () => {
    const liste = listeyiCevir(
      [BEN, k(2, "Ali", { isInFailover: true, userKey: "c7" }), k(4, "Ali", { userKey: "c9" })],
      BEN,
      "ogretmen",
    );
    expect(kimlikler(liste)).toEqual(["3", "2", "4"]);
  });

  it("yeniden katılan: aynı userKey'in failover kaydı atılır, yeni userId kalır", () => {
    const liste = listeyiCevir(
      [BEN, k(2, "Serhat", { isInFailover: true, userKey: "c6" }), k(5, "Serhat", { userKey: "c6" })],
      BEN,
      "ogretmen",
    );
    expect(kimlikler(liste)).toEqual(["3", "5"]);
  });

  it("iki canlı kayıt: user-added ile kanıtlanan güncel kimlik seçilir (sıradan bağımsız)", () => {
    const guncel = new Map([["c6", 2]]);
    const liste = listeyiCevir(
      [BEN, k(2, "Serhat", { userKey: "c6" }), k(5, "Serhat", { userKey: "c6" })],
      BEN,
      "ogretmen",
      { guncel },
    );
    expect(kimlikler(liste)).toEqual(["3", "2"]);
  });

  it("iki canlı kayıt, olay kanıtı yok: önceki gösterilen kimlik korunur", () => {
    const onceki = new Map([["c6", 5]]);
    const liste = listeyiCevir(
      [BEN, k(2, "Serhat", { userKey: "c6" }), k(5, "Serhat", { userKey: "c6" })],
      BEN,
      "ogretmen",
      { onceki },
    );
    expect(kimlikler(liste)).toEqual(["3", "5"]);
  });

  it("iki canlı kayıt, hiç kanıt yok: sessiz seçim yok, hepsi kalır ve uyarılır", () => {
    const uyarilar: Array<[string, number[]]> = [];
    const liste = listeyiCevir(
      [BEN, k(2, "Serhat", { userKey: "c6" }), k(5, "Serhat", { userKey: "c6" })],
      BEN,
      "ogretmen",
      { uyar: (a, idler) => uyarilar.push([a, idler]) },
    );
    expect(kimlikler(liste)).toEqual(["3", "2", "5"]);
    expect(uyarilar).toEqual([["c6", [2, 5]]]);
  });

  it("güncel kimlik listede artık yoksa (ayrıldı) tek canlı kayıt doğal olarak seçilir", () => {
    const liste = listeyiCevir(
      [BEN, k(5, "Serhat", { userKey: "c6" })],
      BEN,
      "ogretmen",
      { guncel: new Map([["c6", 2]]) },
    );
    expect(kimlikler(liste)).toEqual(["3", "5"]);
  });

  it("tek başına failover kaydı: görüntüsü açık görünse de video kapalı, yeniden bağlanıyor", () => {
    const [, fo] = listeyiCevir(
      [BEN, k(2, "Serhat", { isInFailover: true, bVideoOn: true, userKey: "c6" })],
      BEN,
      "ogretmen",
    );
    expect(fo.id).toBe("2");
    expect(fo.videoAcik).toBe(false);
    expect(fo.yenidenBaglaniyor).toBe(true);
  });

  it("aynı userKey ile yeni aktif kayıt gelince normal videoya döner; failover kaydı atılır", () => {
    const liste = listeyiCevir(
      [
        BEN,
        k(2, "Serhat", { isInFailover: true, bVideoOn: true, userKey: "c6" }),
        k(5, "Serhat", { bVideoOn: true, userKey: "c6" }),
      ],
      BEN,
      "ogretmen",
    );
    expect(kimlikler(liste)).toEqual(["3", "5"]);
    expect(liste[1].videoAcik).toBe(true);
    expect(liste[1].yenidenBaglaniyor).toBe(false);
  });

  it("failover kaydı sonradan ayrılınca (user-removed) yeni kayıt etkilenmez", () => {
    const guncel = new Map([["c6", 5]]);
    const once = listeyiCevir(
      [BEN, k(2, "Serhat", { isInFailover: true, userKey: "c6" }), k(5, "Serhat", { bVideoOn: true, userKey: "c6" })],
      BEN,
      "ogretmen",
      { guncel },
    );
    const sonra = listeyiCevir([BEN, k(5, "Serhat", { bVideoOn: true, userKey: "c6" })], BEN, "ogretmen", {
      guncel,
    });
    expect(kimlikler(once)).toEqual(["3", "5"]);
    expect(kimlikler(sonra)).toEqual(["3", "5"]);
    expect(sonra[1].videoAcik).toBe(true);
  });

  it("kendi kaydım listede yoksa başa eklenir ve hayaletim atılır", () => {
    const liste = listeyiCevir([k(1, "Dilan", { isInFailover: true }), k(4, "Serhat")], BEN, "ogretmen");
    expect(kimlikler(liste)).toEqual(["3", "4"]);
  });
});
