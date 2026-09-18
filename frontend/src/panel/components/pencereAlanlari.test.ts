// @vitest-environment node
/** Ortak 422 dağıtımı: yalnız beyaz listedeki alanlar; miras adları (`constructor`, `__proto__`, `prototype`) yutulmaz. */
import { sunucuHatasiniDagit } from "@/panel/components/pencereAlanlari";

const h422 = (detail: unknown) => ({ response: { status: 422, data: { detail } } });

describe("sunucuHatasiniDagit", () => {
  it("beyaz liste dışı ve miras adları alan hatası olmaz, genel hataya gider; nesne prototipi kirlenmez", () => {
    const sonuc = sunucuHatasiniDagit(
      h422([
        { loc: ["body", "label"], msg: "Etiket kullanımda" },
        { loc: ["body", "constructor"], msg: "c" },
        { loc: ["body", "__proto__"], msg: "p" },
        { loc: ["body", "prototype"], msg: "q" },
        { loc: ["body", "hasOwnProperty"], msg: "h" },
        { loc: ["body", "toString"], msg: "t" },
      ]),
      "v",
      ["label", "plate"],
    );
    expect(sonuc).toEqual({ alan: { label: "Etiket kullanımda" }, genel: "c p q h t" });
    expect(Object.keys(sonuc.alan)).toEqual(["label"]);
    expect(Object.getPrototypeOf(sonuc.alan)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("konum ön ekleri ayıklanır, iç içe yol son parçadan okunur, boş mesaj varsayılan metin alır; 422 dışı ve dizi olmayan detail genel hatadır", () => {
    expect(sunucuHatasiniDagit(h422([{ loc: ["body", "payload", "lat"], msg: "" }]), "v", ["lat"])).toEqual({ alan: { lat: "Bu alan geçersiz." }, genel: null });
    expect(sunucuHatasiniDagit(h422([{ loc: ["query", "page"], msg: "x" }]), "v", ["lat"])).toEqual({ alan: {}, genel: "x" });
    expect(sunucuHatasiniDagit(h422([]), "v", ["lat"])).toEqual({ alan: {}, genel: "Gönderilen bilgi geçersiz." });
    expect(sunucuHatasiniDagit(h422("Gövde geçersiz"), "v", ["lat"])).toEqual({ alan: {}, genel: "Gövde geçersiz" });
    expect(sunucuHatasiniDagit({ response: { status: 409, data: { detail: "Çakışma" } } }, "v", ["lat"])).toEqual({ alan: {}, genel: "Çakışma" });
    // Yanıtsız hata (ağ): sunucu ayrıntısı yok → çağıranın varsayılan metni.
    expect(sunucuHatasiniDagit(new Error("ağ"), "Varsayılan.", ["lat"])).toEqual({ alan: {}, genel: "Varsayılan." });
  });
});
