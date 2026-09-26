import { describe, expect, it } from "vitest";

import {
  agSeviyesi,
  baglantiDurumu,
  ekranMi,
  ekranSahibi,
  kameraHataKodu,
  konusanlar,
  listeyiCevir,
  masaustuChromiumMu,
  paylasimHataKodu,
  type BenimDurumum,
} from "./cevir";

const BEN: BenimDurumum = {
  id: "t7",
  ad: "Ayşe Hoca",
  rol: "ogretmen",
  videoAcik: true,
  sesBagli: true,
  mikKapali: false,
  paylasiyor: false,
};
const KARSI = { id: "c9", ad: "Mehmet", rol: "ogrenci" as const };

describe("agora/cevir · ekran uid'i", () => {
  it("yalnız `-ekran` ekli uid ekran sayılır; sahibi eksiz uid", () => {
    expect(ekranMi("t7-ekran")).toBe(true);
    expect(ekranSahibi("t7-ekran")).toBe("t7");
    expect(ekranMi("t7")).toBe(false);
    expect(ekranSahibi("c9")).toBeNull();
    expect(ekranMi("-ekran")).toBe(false);
  });

  it("ekran kullanıcıları listeye girmez; sahibi `paylasiyor` görünür", () => {
    const liste = listeyiCevir(
      BEN,
      [
        { uid: "c9", hasAudio: true, hasVideo: true },
        { uid: "c9-ekran", hasAudio: false, hasVideo: true },
      ],
      KARSI,
    );
    expect(liste.map((k) => k.id)).toEqual(["t7", "c9"]);
    expect(liste[1].paylasiyor).toBe(true);
  });

  it("kendi ekran uid'im ve kendi kaydımın yinelenmesi listeye girmez", () => {
    const liste = listeyiCevir(
      BEN,
      [
        { uid: "t7-ekran", hasAudio: false, hasVideo: true },
        { uid: "t7", hasAudio: true, hasVideo: true },
      ],
      KARSI,
    );
    expect(liste.map((k) => k.id)).toEqual(["t7"]);
  });

  it("konuşanlardan ekran uid'leri atılır", () => {
    expect(
      konusanlar([
        { id: "t7", duzey: 0.3 },
        { id: "c9-ekran", duzey: 0.5 },
        { id: "c9", duzey: 0.01 },
      ]),
    ).toEqual(["t7"]);
  });
});

describe("agora/cevir · rol ve ad", () => {
  it("karşı tarafın adı ve rolü biletteki `karsi`dan", () => {
    const [ben, karsi] = listeyiCevir(
      BEN,
      [{ uid: "c9", hasAudio: false, hasVideo: false }],
      KARSI,
    );
    expect(ben).toMatchObject({ ben: true, rol: "ogretmen", ad: "Ayşe Hoca" });
    expect(karsi).toMatchObject({
      ben: false,
      rol: "ogrenci",
      ad: "Mehmet",
      videoAcik: false,
      mikKapali: true,
    });
  });

  it("uid `karsi` ile tutmazsa rol öbür rol, ad uid", () => {
    const liste = listeyiCevir(
      { ...BEN, id: "c9", rol: "ogrenci" },
      [{ uid: "t3", hasAudio: true, hasVideo: false }],
      null,
    );
    expect(liste[1]).toMatchObject({ id: "t3", rol: "ogretmen", ad: "t3", mikKapali: false });
  });

  it("ses bağlı değilse mikrofon kapalı sayılır", () => {
    const [ben] = listeyiCevir({ ...BEN, sesBagli: false, mikKapali: false }, [], KARSI);
    expect(ben.mikKapali).toBe(true);
  });
});

describe("agora/cevir · ağ kalitesi", () => {
  it.each([
    [1, 5],
    [2, 4],
    [3, 2],
    [4, 1],
    [5, 0],
    [6, 0],
    [0, null],
    [undefined, null],
  ])("Agora %s → %s", (q, beklenen) => {
    expect(agSeviyesi(q)).toBe(beklenen);
  });
});

describe("agora/cevir · bağlantı ve hatalar", () => {
  it("kendi ayrılmamız ve token sonu kapanış sayılmaz; UID çakışması sayılır", () => {
    expect(baglantiDurumu("CONNECTED", "CONNECTING")).toBe("bagli");
    expect(baglantiDurumu("CONNECTING", "DISCONNECTED")).toBeNull();
    expect(baglantiDurumu("RECONNECTING", "CONNECTED")).toBe("yenidenBaglaniyor");
    expect(baglantiDurumu("DISCONNECTED", "CONNECTED", "LEAVE")).toBeNull();
    expect(baglantiDurumu("DISCONNECTED", "CONNECTED", "TOKEN_EXPIRE")).toBeNull();
    expect(baglantiDurumu("DISCONNECTED", "CONNECTED", "UID_CONFLICT")).toBe("kapandi");
  });

  it("kamera ve paylaşım hataları sınıflandırılır", () => {
    const hata = (code: string, message = "") => Object.assign(new Error(message), { code });
    expect(kameraHataKodu(hata("PERMISSION_DENIED", "NotAllowedError"))).toBe("kameraIzniYok");
    expect(kameraHataKodu(hata("DEVICE_NOT_FOUND"))).toBe("kameraYok");
    expect(kameraHataKodu(hata("NOT_READABLE"))).toBe("kameraMesgul");
    expect(kameraHataKodu(hata("UNEXPECTED_ERROR"))).toBeNull();
    expect(paylasimHataKodu(hata("PERMISSION_DENIED", "NotAllowedError: Permission denied"))).toBe(
      "paylasimIptal",
    );
    expect(
      paylasimHataKodu(hata("PERMISSION_DENIED", "NotAllowedError: Permission denied by system")),
    ).toBe("paylasimReddedildi");
  });

  it("masaüstü Chromium: Chrome/Edge evet; Firefox, Safari, telefon hayır", () => {
    const chrome = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/128.0 Safari/537.36";
    const safari = "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";
    const firefox = "Mozilla/5.0 (Windows NT 10.0; rv:130.0) Gecko/20100101 Firefox/130.0";
    expect(masaustuChromiumMu(chrome, false)).toBe(true);
    expect(masaustuChromiumMu(`${chrome} Edg/128.0`, false)).toBe(true);
    expect(masaustuChromiumMu(chrome, true)).toBe(false);
    expect(masaustuChromiumMu(safari, false)).toBe(false);
    expect(masaustuChromiumMu(firefox, false)).toBe(false);
  });
});
