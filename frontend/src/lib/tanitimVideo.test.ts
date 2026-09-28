// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  dikeyMi,
  dosyaOnKontrol,
  durumAnlatimi,
  mbBiciminde,
  sureBiciminde,
  videoBilgisiKontrol,
} from "./tanitimVideo";

const MB = 1024 * 1024;

describe("videoBilgisiKontrol (yüklemeden önce erken uyarı)", () => {
  const sinir = { minSeconds: 30, maxSeconds: 130 };
  it("yatay ve sınırlar içinde geçer; bilgi yoksa karar sunucuda", () => {
    expect(videoBilgisiKontrol({ sure: 45, genislik: 1280, yukseklik: 720 }, sinir)).toBeNull();
    expect(videoBilgisiKontrol(null, sinir)).toBeNull();
    // Tarayıcı kaydı webm'inde süre okunamaz: yalnız yön kontrol edilir.
    expect(videoBilgisiKontrol({ sure: null, genislik: 1280, yukseklik: 720 }, sinir)).toBeNull();
  });
  it("dikey, kısa ve uzun ayrı mesajlarla durdurulur", () => {
    expect(videoBilgisiKontrol({ sure: 45, genislik: 720, yukseklik: 1280 }, sinir)).toMatch(/dikey/);
    expect(videoBilgisiKontrol({ sure: 12, genislik: 1280, yukseklik: 720 }, sinir)).toMatch(/en az 30 saniye/);
    expect(videoBilgisiKontrol({ sure: 200, genislik: 1280, yukseklik: 720 }, sinir)).toMatch(/en fazla 2 dakika/);
  });
  it("kısa kenarı sınırın altındaki video yüklemeden önce durdurulur", () => {
    const s = { ...sinir, minShortSide: 360 };
    expect(videoBilgisiKontrol({ sure: 45, genislik: 640, yukseklik: 358 }, s)).toMatch(
      /çözünürlüğü çok düşük \(640×358\); en az 360p/
    );
    expect(videoBilgisiKontrol({ sure: 45, genislik: 640, yukseklik: 360 }, s)).toBeNull();
    // Boyut okunamadıysa (0) ya da sınır bilinmiyorsa karar sunucuda.
    expect(videoBilgisiKontrol({ sure: 45, genislik: 0, yukseklik: 0 }, s)).toBeNull();
    expect(videoBilgisiKontrol({ sure: 45, genislik: 640, yukseklik: 240 }, sinir)).toBeNull();
  });
});

describe("dikeyMi", () => {
  it("yalnız yükseklik genişlikten büyükse dikey; boyut bilinmiyorsa değil", () => {
    expect(dikeyMi(720, 1280)).toBe(true);
    expect(dikeyMi(1280, 720)).toBe(false);
    expect(dikeyMi(720, 720)).toBe(false);
    expect(dikeyMi(0, 0)).toBe(false);
    expect(dikeyMi(0, 480)).toBe(false);
  });
});

describe("dosyaOnKontrol", () => {
  it("video türü ve sınır içi boyut geçer", () => {
    expect(dosyaOnKontrol({ size: 50 * MB, type: "video/mp4", name: "a.mp4" }, 300 * MB)).toBeNull();
    expect(dosyaOnKontrol({ size: 1, type: "video/quicktime", name: "a.MOV" }, 300 * MB)).toBeNull();
  });
  it("uzantıya değil MIME türüne bakar: .mp4 adlı resim reddedilir", () => {
    expect(dosyaOnKontrol({ size: 10, type: "image/png", name: "sahte.mp4" }, 300 * MB)).toMatch(/video dosyası/);
    expect(dosyaOnKontrol({ size: 10, type: "", name: "a.mp4" }, 300 * MB)).toMatch(/video dosyası/);
  });
  it("boyut sınırı aşımı ve boş dosya", () => {
    expect(dosyaOnKontrol({ size: 301 * MB, type: "video/mp4", name: "a.mp4" }, 300 * MB)).toMatch(/300 MB/);
    expect(dosyaOnKontrol({ size: 0, type: "video/mp4", name: "a.mp4" }, 300 * MB)).toMatch(/boş/);
  });
});

describe("biçimler", () => {
  it("süre m:ss", () => {
    expect(sureBiciminde(61.4)).toBe("1:01");
    expect(sureBiciminde(0)).toBe("0:00");
    expect(sureBiciminde(null)).toBe("");
    expect(sureBiciminde(125.6)).toBe("2:06");
  });
  it("MB yuvarlar", () => {
    expect(mbBiciminde(300 * MB)).toBe("300 MB");
  });
});

describe("durumAnlatimi", () => {
  it("işlenirken eski videonun yayında kaldığını söyler", () => {
    const a = durumAnlatimi("PROCESSING", { requireReview: true, eskiVideoVar: true });
    expect(a.etiket).toBe("İşleniyor");
    expect(a.aciklama).toMatch(/yayında kalır/);
    expect(durumAnlatimi("PROCESSING", { requireReview: true, eskiVideoVar: false }).aciklama).not.toMatch(/yayında kalır/);
  });
  it("başarısız ve reddedilen yeniden denemeye yönlendirir", () => {
    expect(durumAnlatimi("FAILED", { requireReview: true, eskiVideoVar: false }).ton).toBe("hata");
    expect(durumAnlatimi("REJECTED", { requireReview: true, eskiVideoVar: false }).aciklama).toMatch(/Yeni bir video/);
  });
  it("bayat PENDING_UPLOAD: sekmede yükleme yoksa iptal edip yeniden yüklemeye yönlendirir", () => {
    const bayat = durumAnlatimi("PENDING_UPLOAD", { requireReview: true, eskiVideoVar: false, yuklemeSuruyor: false });
    expect(bayat.aciklama).toMatch(/iptal edip videoyu yeniden yükle/);
    // Seçenek verilmezse eski anlatım korunur.
    expect(durumAnlatimi("PENDING_UPLOAD", { requireReview: true, eskiVideoVar: false }).etiket).toBe("Yükleniyor");
  });
});
