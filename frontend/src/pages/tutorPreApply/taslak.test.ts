import { beforeEach, describe, expect, it } from "vitest";

import { taslagiOku, taslagiSil, taslagiYaz } from "./taslak";
import { BOS_FORM, type FormDurumu } from "./tipler";

const ANAHTAR = "egitmen-on-basvuru-taslak-v2";

function form(over: Partial<FormDurumu> = {}): FormDurumu {
  return { ...BOS_FORM, ...over };
}

describe("ön başvuru taslağı", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("yazılanı geri okur", () => {
    taslagiYaz(form({ ad: "Ayşe", dersler: "Matematik", ucret: "500" }));
    expect(taslagiOku()?.alanlar).toMatchObject({
      ad: "Ayşe",
      dersler: "Matematik",
      ucret: "500",
    });
  });

  it("tamamen boş formu hiç saklamaz", () => {
    taslagiYaz(form());
    expect(taslagiOku()).toBeNull();
  });

  /**
   * Gizlilik değişmezi: KVKK onayı taslakta taşınırsa, dönen kişi onay
   * kutusunu işaretlemeden gönderim yapabilirdi — rıza taze bir eylem olmalı.
   * Dosya ve fotoğraf da serileşmez, tarayıcıda tutulmaz.
   */
  it("KVKK onayını, fotoğrafı ve belgeleri saklamaz", () => {
    taslagiYaz(form({ ad: "Ayşe", kvkk: true }));
    const ham = window.localStorage.getItem(ANAHTAR) ?? "";
    expect(ham).not.toContain("kvkk");
    expect(ham).not.toContain("foto");
    expect(ham).not.toContain("belge");
  });

  it("süresi geçmiş taslağı döndürmez ve temizler", () => {
    window.localStorage.setItem(
      ANAHTAR,
      JSON.stringify({
        alanlar: { ad: "Eski" },
        kaydedildi: Date.now() - 8 * 24 * 60 * 60 * 1000,
      })
    );
    expect(taslagiOku()).toBeNull();
    expect(window.localStorage.getItem(ANAHTAR)).toBeNull();
  });

  it("bozuk JSON'da çökmez", () => {
    window.localStorage.setItem(ANAHTAR, "{bozuk");
    expect(taslagiOku()).toBeNull();
  });

  it("depodaki beklenmedik anahtarı forma taşımaz", () => {
    window.localStorage.setItem(
      ANAHTAR,
      JSON.stringify({ alanlar: { ad: "Ayşe", kvkk: true, uydurma: 1 }, kaydedildi: Date.now() })
    );
    const alanlar = taslagiOku()!.alanlar as Record<string, unknown>;
    expect(alanlar.ad).toBe("Ayşe");
    expect(alanlar.kvkk).toBeUndefined();
    expect(alanlar.uydurma).toBeUndefined();
  });

  it("silinen taslak geri gelmez", () => {
    taslagiYaz(form({ ad: "Ayşe" }));
    taslagiSil();
    expect(taslagiOku()).toBeNull();
  });
});
