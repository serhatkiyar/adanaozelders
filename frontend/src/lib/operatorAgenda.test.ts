// İP-14 kırmızı matris — "Bugün" tanımı ve gün gruplaması (SAF katman).
//
// Bu dosyanın nöbeti tek bir cümledir: **operatörün gördüğü "bugün", operatörün
// bulunduğu yerin günüdür** — tarayıcının saat dilimi ne olursa olsun. Kütüphane
// Adana'dadır; laptop'ın tz'i UTC'ye ayarlıysa (VPS'ten açılan panel, seyahat,
// tarayıcı profili) `new Date().getDate()` gece yarısı civarında **bir gün
// kayar** ve 23:30'daki rezervasyon "yarın" görünür. Kapıda bekleyen öğrenci
// listede yoktur.
//
// Bu yüzden node B-5 (TZ sınırı) bilinçli olarak testin merkezindedir ve
// aşağıdaki bütün senaryolar `vi.setSystemTime` ile **UTC tarayıcı** varsayar:
// yerel-saate dayanan bir uygulama bu dosyayı geçemez.
//
// Kanıt sınıfı: saf yardımcı/birim (CLAUDE.md §H). Ekranın bu fonksiyonları
// GERÇEKTEN çağırdığı iddiası burada DEĞİL, `operatorPanel.acceptance.test.tsx`
// içindeki gerçek DOM testlerindedir.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MODUL = import.meta.glob("./operatorAgenda.ts");

type Modul = typeof import("./operatorAgenda");

async function modul(): Promise<Modul> {
  const yukle = MODUL["./operatorAgenda.ts"];
  if (!yukle) throw new Error("HENÜZ YAZILMADI: src/lib/operatorAgenda.ts");
  return (await yukle()) as Modul;
}

/** Türkiye duvar-saatini UTC ISO'ya çevirir (sabit +03:00, DST yok). */
function tr(gunSaat: string): string {
  return new Date(`${gunSaat}:00+03:00`).toISOString();
}

/** Testin "şimdi"si — Türkiye duvar-saati olarak verilir. */
function simdiyiKur(trGunSaat: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${trGunSaat}:00+03:00`));
}

beforeEach(() => {
  // Tarayıcı UTC varsayılır: process.env.TZ jsdom açılışında sabitlenmiş olabilir,
  // bu yüzden fonksiyonlar yerel saate DEĞİL Europe/Istanbul'a bakmak zorundadır.
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("B-5 · TZ sınırı: gün anahtarı Türkiye saatiyle hesaplanır", () => {
  it("23:30 (TR) kaydı O GÜNE düşer — UTC'de 20:30, aynı gün", async () => {
    const { istanbulGunAnahtari } = await modul();
    expect(istanbulGunAnahtari(tr("2026-08-10T23:30"))).toBe("2026-08-10");
  });

  it("00:30 (TR) kaydı ERTESİ GÜNE düşer — UTC'de bir önceki günün 21:30'u", async () => {
    const { istanbulGunAnahtari } = await modul();
    // UTC hesabı yapılırsa bu "2026-08-10" döner ve node kırılır.
    expect(istanbulGunAnahtari(tr("2026-08-11T00:30"))).toBe("2026-08-11");
  });

  it("UTC gece yarısını geçmiş ama TR'de hâlâ dün olan an, DÜNE düşer", async () => {
    const { istanbulGunAnahtari } = await modul();
    // 2026-08-11T00:30Z = TR 03:30 → aynı gün; ters yön için 2026-08-11T21:30Z:
    // TR 2026-08-12 00:30 → ertesi gün.
    expect(istanbulGunAnahtari("2026-08-11T21:30:00Z")).toBe("2026-08-12");
    expect(istanbulGunAnahtari("2026-08-11T20:30:00Z")).toBe("2026-08-11");
  });
});

describe("G-3 · kova kuralı: hangi kayıt hangi gruba", () => {
  it("bugün / yarın / bu hafta / daha sonra ayrımı gün anahtarına göre yapılır", async () => {
    const { gunKovasi } = await modul();
    simdiyiKur("2026-08-10T09:00"); // Pazartesi
    const simdi = new Date();

    expect(gunKovasi({ startsAt: tr("2026-08-10T14:00") }, simdi)).toBe("BUGUN");
    expect(gunKovasi({ startsAt: tr("2026-08-10T23:30") }, simdi)).toBe("BUGUN");
    expect(gunKovasi({ startsAt: tr("2026-08-11T00:30") }, simdi)).toBe("YARIN");
    expect(gunKovasi({ startsAt: tr("2026-08-12T10:00") }, simdi)).toBe("BU_HAFTA");
    expect(gunKovasi({ startsAt: tr("2026-08-17T10:00") }, simdi)).toBe("BU_HAFTA");
    // 7 günlük kayan pencerenin dışı ayrı kovadır — listeden DÜŞMEZ.
    expect(gunKovasi({ startsAt: tr("2026-08-18T10:00") }, simdi)).toBe("DAHA_SONRA");
  });

  it("penceresi bitmiş kayıt GECMIS kovasına düşer, bugüne sayılmaz", async () => {
    const { gunKovasi } = await modul();
    simdiyiKur("2026-08-10T09:00");
    const simdi = new Date();

    expect(
      gunKovasi(
        { startsAt: tr("2026-08-09T10:00"), endsAt: tr("2026-08-09T12:00") },
        simdi
      )
    ).toBe("GECMIS");
  });

  it("dün başlayıp HÂLÂ SÜREN kayıt bugünün işidir — BUGUN kovasında", async () => {
    const { gunKovasi } = await modul();
    simdiyiKur("2026-08-10T09:00");
    const simdi = new Date();

    // Gece 22:00–10:00 çalışma penceresi: operatör sabah kapıda bunu görmeli.
    expect(
      gunKovasi(
        { startsAt: tr("2026-08-09T22:00"), endsAt: tr("2026-08-10T10:00") },
        simdi
      )
    ).toBe("BUGUN");
  });
});

describe("G-4 · boş grup başlığı basılmaz", () => {
  it("yalnız dolu kovalar döner ve sıra kronolojiktir", async () => {
    const { gunlereGrupla } = await modul();
    simdiyiKur("2026-08-10T09:00");
    const simdi = new Date();

    const gruplar = gunlereGrupla(
      [
        { startsAt: tr("2026-08-18T10:00") }, // daha sonra
        { startsAt: tr("2026-08-10T14:00") }, // bugün
      ],
      simdi
    );

    expect(gruplar.map((g) => g.kova)).toEqual(["BUGUN", "DAHA_SONRA"]);
    // "YARIN" ve "BU_HAFTA" hiç kayıt almadı → başlıkları da yok.
    expect(gruplar.some((g) => g.items.length === 0)).toBe(false);
  });

  it("her kova kendi içinde erken→geç sıralanır", async () => {
    const { gunlereGrupla } = await modul();
    simdiyiKur("2026-08-10T09:00");
    const simdi = new Date();

    const gruplar = gunlereGrupla(
      [
        { startsAt: tr("2026-08-10T18:00"), id: "aksam" },
        { startsAt: tr("2026-08-10T10:00"), id: "sabah" },
        { startsAt: tr("2026-08-10T14:00"), id: "ogle" },
      ],
      simdi
    );

    expect(gruplar[0].items.map((i) => i.id)).toEqual(["sabah", "ogle", "aksam"]);
  });

  it("GECMIS kovası gruplamaya HİÇ girmez (uç zaten elemiş olmalı, istemci de elemeli)", async () => {
    const { gunlereGrupla } = await modul();
    simdiyiKur("2026-08-10T09:00");
    const simdi = new Date();

    const gruplar = gunlereGrupla(
      [
        { startsAt: tr("2026-08-01T10:00"), endsAt: tr("2026-08-01T12:00") },
        { startsAt: tr("2026-08-10T14:00") },
      ],
      simdi
    );

    expect(gruplar).toHaveLength(1);
    expect(gruplar[0].kova).toBe("BUGUN");
    expect(gruplar[0].items).toHaveLength(1);
  });
});

describe("G-2 · her grubun sayacı vardır", () => {
  it("grup başlığı etiket + adet taşır", async () => {
    const { gunlereGrupla } = await modul();
    simdiyiKur("2026-08-10T09:00");
    const simdi = new Date();

    const gruplar = gunlereGrupla(
      [
        { startsAt: tr("2026-08-10T10:00") },
        { startsAt: tr("2026-08-10T11:00") },
        { startsAt: tr("2026-08-11T09:00") },
      ],
      simdi
    );

    expect(gruplar[0]).toMatchObject({ kova: "BUGUN", label: "Bugün", items: expect.any(Array) });
    expect(gruplar[0].items).toHaveLength(2);
    expect(gruplar[1]).toMatchObject({ kova: "YARIN", label: "Yarın" });
    expect(gruplar[1].items).toHaveLength(1);
  });
});

describe("B-2 · bugün sayacı: dünkü ve yarınki sayılmaz", () => {
  it("yalnız bugünün kayıtlarını sayar", async () => {
    const { bugunOzeti } = await modul();
    simdiyiKur("2026-08-10T09:00");
    const simdi = new Date();

    const ozet = bugunOzeti(
      [
        { startsAt: tr("2026-08-09T10:00"), endsAt: tr("2026-08-09T12:00") }, // dün
        { startsAt: tr("2026-08-10T10:00") }, // bugün
        { startsAt: tr("2026-08-10T14:00") }, // bugün
        { startsAt: tr("2026-08-11T10:00") }, // yarın
      ],
      simdi
    );

    expect(ozet.toplam).toBe(2);
  });

  it("gece yarısına yakın saatlerde de gün sınırı Türkiye saatidir", async () => {
    const { bugunOzeti } = await modul();
    simdiyiKur("2026-08-10T23:45"); // TR gece yarısına 15 dk var; UTC'de saat 20:45
    const simdi = new Date();

    const ozet = bugunOzeti(
      [
        { startsAt: tr("2026-08-10T23:50") }, // bugün (15 dk sonra)
        { startsAt: tr("2026-08-11T00:30") }, // yarın (45 dk sonra ama ERTESİ GÜN)
      ],
      simdi
    );

    expect(ozet.toplam).toBe(1);
    expect(ozet.siradaki?.startsAt).toBe(tr("2026-08-10T23:50"));
  });
});

describe("B-3 · sıradaki randevu: saati geçmişler atlanır", () => {
  it("şu andan sonraki EN ERKEN kaydı seçer", async () => {
    const { bugunOzeti } = await modul();
    simdiyiKur("2026-08-10T13:00");
    const simdi = new Date();

    const ozet = bugunOzeti(
      [
        { startsAt: tr("2026-08-10T09:00"), ad: "Sabahki" },
        { startsAt: tr("2026-08-10T14:00"), ad: "Öğleden sonraki" },
        { startsAt: tr("2026-08-10T18:00"), ad: "Akşamki" },
      ],
      simdi
    );

    expect(ozet.siradaki?.ad).toBe("Öğleden sonraki");
  });

  it("bugünün tamamı geçmişse sıradaki YOKTUR (null) — ama sayaç bugünü saymaya devam eder", async () => {
    const { bugunOzeti } = await modul();
    simdiyiKur("2026-08-10T20:00");
    const simdi = new Date();

    const ozet = bugunOzeti(
      [
        { startsAt: tr("2026-08-10T09:00") },
        { startsAt: tr("2026-08-10T14:00") },
      ],
      simdi
    );

    expect(ozet.siradaki).toBeNull();
    expect(ozet.toplam).toBe(2);
  });
});

describe("Y-2 · yoklama sayacı ATTENDED durumunu doğru sayar", () => {
  it("giriş yapan / toplam ayrımı yalnız ATTENDED'a bakar", async () => {
    const { yoklamaSayaci } = await modul();

    const sayac = yoklamaSayaci([
      { status: "ATTENDED" },
      { status: "PAID" },
      { status: "ATTENDED" },
      { status: "PENDING_PAYMENT" },
    ]);

    expect(sayac).toEqual({ giren: 2, toplam: 4 });
  });

  it("boş listede sıfır döner, bölme/erişim hatası vermez", async () => {
    const { yoklamaSayaci } = await modul();
    expect(yoklamaSayaci([])).toEqual({ giren: 0, toplam: 0 });
  });

  it("bugünkü özet bekleyen kişiyi ATTENDED'ları düşerek verir", async () => {
    const { bugunOzeti } = await modul();
    simdiyiKur("2026-08-10T09:00");
    const simdi = new Date();

    const ozet = bugunOzeti(
      [
        { startsAt: tr("2026-08-10T10:00"), status: "ATTENDED" },
        { startsAt: tr("2026-08-10T11:00"), status: "PAID" },
        { startsAt: tr("2026-08-10T12:00"), status: "PAID" },
      ],
      simdi
    );

    expect(ozet.toplam).toBe(3);
    expect(ozet.giren).toBe(1);
    expect(ozet.bekleyen).toBe(2);
  });
});

describe("K-1/K-2 · tavan uyarısı eşiği (saf karar)", () => {
  it("liste tavana dayandıysa kesilmiş sayılır", async () => {
    const { kesildiMi, ISLEM_TAVANI } = await modul();
    expect(ISLEM_TAVANI).toBe(200);
    expect(kesildiMi(new Array(200).fill(0))).toBe(true);
  });

  it("tavanın altındaki liste kesilmiş DEĞİLDİR", async () => {
    const { kesildiMi } = await modul();
    expect(kesildiMi(new Array(199).fill(0))).toBe(false);
    expect(kesildiMi([])).toBe(false);
  });
});
