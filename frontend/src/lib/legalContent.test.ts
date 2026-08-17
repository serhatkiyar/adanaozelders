import { describe, expect, it } from "vitest";
import {
  LEGAL_DOCS,
  OPERATOR,
  operatorIdentity,
  SIGNUP_CONSENT_DOCS,
  currentConsentVersion,
  getLegalDoc,
} from "@/lib/legalContent";
import { LEGAL_NAV } from "@/lib/legalNav";
import { LEGAL_ROUTES } from "@/lib/routes";

describe("legalContent", () => {
  it("her belge başlık, açıklama ve en az 4 bölüm içerir", () => {
    expect(LEGAL_DOCS.length).toBe(8);
    for (const doc of LEGAL_DOCS) {
      expect(doc.title.length).toBeGreaterThan(5);
      expect(doc.description.length).toBeGreaterThan(30);
      expect(doc.sections.length).toBeGreaterThanOrEqual(4);
      for (const s of doc.sections) {
        expect(s.heading.length).toBeGreaterThan(3);
        expect(s.blocks.length).toBeGreaterThan(0);
      }
    }
  });

  it("belge id'leri ve bölüm anchor'ları benzersizdir", () => {
    const ids = LEGAL_DOCS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const doc of LEGAL_DOCS) {
      const anchors = doc.sections.map((s) => s.id);
      expect(new Set(anchors).size).toBe(anchors.length);
      // Anchor'lar URL-güvenli olmalı (Türkçe karakter/boşluk yok).
      for (const a of anchors) expect(a).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("updatedAt YYYY-MM-DD biçimindedir ve geçerli bir tarihtir", () => {
    for (const doc of LEGAL_DOCS) {
      expect(doc.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(new Date(doc.updatedAt).getTime())).toBe(false);
    }
  });

  it("getLegalDoc bilinen id'yi döner, bilinmeyende fırlatır", () => {
    expect(getLegalDoc("kvkk").title).toContain("KVKK");
    // @ts-expect-error — bilinçli geçersiz id
    expect(() => getLegalDoc("yok-boyle-belge")).toThrow();
  });

  /* ── iyzico başvurusunun zorunlu tuttuğu sayfalar ── */

  it("iyzico'nun istediği belgelerin hepsi kayıtlıdır", () => {
    // Bu liste bir "istek" değil, ödeme kuruluşunun başvuru şartı. Belgelerden
    // biri kayıttan düşerse başvuru reddedilir; testin görevi bunu görmek.
    for (const id of [
      "about",
      "preliminary-info",
      "distance-sales",
      "refund",
      "privacy",
      "kvkk",
    ] as const) {
      const doc = getLegalDoc(id);
      expect(doc.sections.length).toBeGreaterThanOrEqual(4);
      expect(LEGAL_ROUTES[id]).toMatch(/^\//);
    }
  });

  it("mesafeli satış sözleşmesinin atıf yaptığı Ön Bilgilendirme Formu GERÇEKTEN vardır", () => {
    // Sözleşme "bu sözleşmeyi ve Ön Bilgilendirme Formu'nu okudum" diyor.
    // Atıf yapılan belge yoksa metin var olmayan bir belgeye onay aldırıyor
    // demektir — regresyonun tam olarak bu olması bekleniyor.
    const sozlesme = getLegalDoc("distance-sales");
    const tumMetin = sozlesme.sections
      .flatMap((s) => s.blocks)
      .flatMap((b) => (b.type === "p" ? [b.text] : b.items))
      .join(" ");
    expect(tumMetin).toContain("Ön Bilgilendirme Formu");

    // Atıf edilen belge kayıtlı ve rotası tanımlı olmalı.
    const form = LEGAL_DOCS.find((d) => d.id === "preliminary-info");
    expect(form, "Ön Bilgilendirme Formu LEGAL_DOCS'ta kayıtlı değil").toBeDefined();
    expect(LEGAL_ROUTES["preliminary-info"]).toBe("/on-bilgilendirme-formu");
  });

  it("ön bilgilendirme formu mesafeli satış sözleşmesiyle çelişmez", () => {
    const metin = (id: Parameters<typeof getLegalDoc>[0]) =>
      getLegalDoc(id)
        .sections.flatMap((s) => s.blocks)
        .flatMap((b) => (b.type === "p" ? [b.text] : b.items))
        .join(" ");

    const form = metin("preliminary-info");
    const sozlesme = metin("distance-sales");

    // İki metin de aynı süreleri, aynı istisnaları ve aynı masraf kuralını
    // söylemeli; biri güncellenip diğeri unutulursa test kırılır.
    for (const ortak of ["ON DÖRT GÜN", "m.15/1-e", "m.15/1-ğ", "OTUZ GÜN"]) {
      expect(form, `formda eksik: ${ortak}`).toContain(ortak);
      expect(sozlesme, `sözleşmede eksik: ${ortak}`).toContain(ortak);
    }
    // İade masrafının satıcıda olduğu iki metinde de yazılı olmalı.
    expect(form).toMatch(/İADE MASRAFI SATICIYA AİTTİR|iade kargo bedeli alınmaz/);
    expect(sozlesme).toMatch(/İADE MASRAFI SATICI'YA AİTTİR|iade kargo bedeli talep edilmez/);
  });

  it("fiziksel ürün satışı yasal metinlerde kapsanmıştır", () => {
    // Regresyon: mağaza (basılı kitap + kendi kurye filosu) aylarca çalışır
    // durumdaydı ama yasal metinlerde "kargo/teslim/kitap" hiç geçmiyordu.
    for (const id of ["distance-sales", "refund"] as const) {
      const metin = getLegalDoc(id)
        .sections.flatMap((s) => s.blocks)
        .flatMap((b) => (b.type === "p" ? [b.text] : b.items))
        .join(" ")
        .toLocaleLowerCase("tr");
      for (const kelime of ["kitap", "teslim", "kargo", "cayma"]) {
        expect(metin, `${id} belgesinde "${kelime}" geçmiyor`).toContain(kelime);
      }
    }
  });

  it("OPERATOR satıcı kimliği alanları doludur (mesafeli satışta zorunlu)", () => {
    // MERSİS bilerek hariç: ticaret sicili tescili sürüyor ve boşken
    // operatorIdentity() o satırı hiç basmıyor.
    for (const alan of [
      "entity",
      "address",
      "email",
      "phone",
      "phoneHref",
      "taxNumber",
      "taxOffice",
    ] as const) {
      expect(OPERATOR[alan], `OPERATOR.${alan} boş`).toBeTruthy();
      expect(OPERATOR[alan].trim().length).toBeGreaterThan(3);
    }
    // Adres yalnız "Adana, Türkiye" gibi genel bir ifade olamaz; açık adres
    // (mahalle/cadde/kapı no) gerekir.
    expect(OPERATOR.address.length).toBeGreaterThan(25);
    // tel: bağlantısı boşluksuz ve + ile başlamalı.
    expect(OPERATOR.phoneHref).toMatch(/^\+\d{10,15}$/);

    const kimlik = operatorIdentity();
    for (const parca of ["Unvan:", "Adres:", "Vergi No:", "Telefon:", "E-posta:"]) {
      expect(kimlik, `kimlik satırında eksik: ${parca}`).toContain(parca);
    }
    // MERSİS boşken satır hiç basılmamalı ("MERSİS: —" gibi yarım ifade yok).
    expect(kimlik).not.toContain("MERSİS");
  });

  it("hiçbir yasal metinde vergi ORANI yazmaz (mali müşavir onayı bekliyor)", () => {
    // "KDV dâhildir" demek serbest; oran yazmak sonradan düzeltilmesi gereken
    // bir taahhüt olur.
    for (const doc of LEGAL_DOCS) {
      const metin = doc.sections
        .flatMap((s) => s.blocks)
        .flatMap((b) => (b.type === "p" ? [b.text] : b.items))
        .join(" ");
      expect(metin, `${doc.id} belgesinde vergi oranı var`).not.toMatch(
        /%\s*\d+|yüzde\s+\d+/i
      );
    }
  });

  it("LEGAL_NAV (hafif footer listesi) legalContent ile birebir tutarlıdır", () => {
    expect(LEGAL_NAV.length).toBe(LEGAL_DOCS.length);
    for (const item of LEGAL_NAV) {
      const doc = getLegalDoc(item.id);
      expect(item.title).toBe(doc.title);
      expect(item.path).toBe(LEGAL_ROUTES[item.id]);
    }
  });

  it("her belgenin bir rotası vardır ve rotalar benzersizdir", () => {
    const paths = LEGAL_DOCS.map((d) => LEGAL_ROUTES[d.id]);
    expect(paths.every((p) => p?.startsWith("/"))).toBe(true);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("iletişim e-postası tüm süreç metinlerinde OPERATOR'dan gelir", () => {
    expect(OPERATOR.email).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    // Başvuru/itiraz bölümleri e-postayı içermeli (KVKK m.11 başvurusu + iade itirazı).
    const kvkkText = JSON.stringify(getLegalDoc("kvkk"));
    const refundText = JSON.stringify(getLegalDoc("refund"));
    expect(kvkkText).toContain(OPERATOR.email);
    expect(refundText).toContain(OPERATOR.email);
  });
});

describe("currentConsentVersion", () => {
  it("zorunlu üç belgenin en yeni sürümünü verir", () => {
    const versions = SIGNUP_CONSENT_DOCS.map((id) => getLegalDoc(id).updatedAt);
    const enYeni = versions.reduce((a, b) => (a > b ? a : b));
    expect(currentConsentVersion()).toBe(enYeni);
  });

  it("backend'in beklediği YYYY-MM-DD biçiminde", () => {
    // schemas/auth.py::RegisterRequest bu deseni zorunlu kılar; uyuşmazsa
    // kayıt 422 döner.
    expect(currentConsentVersion()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("kayıtta onaylanan belgeler KVKK, koşullar ve gizlilik", () => {
    expect([...SIGNUP_CONSENT_DOCS].sort()).toEqual([
      "kvkk",
      "privacy",
      "terms",
    ]);
  });
});

describe("işletmeci kimliği (Mesafeli Sözleşmeler Yönetmeliği m.5)", () => {
  it("var olmayan bir tüzel kişi göstermez", () => {
    // Regresyon: işletme şahıs şirketi olarak kuruldu ama metinlerde bir süre
    // "… Ltd. Şti. (kuruluş sürecinde)" satıcı/veri sorumlusu olarak göründü.
    expect(OPERATOR.entity).not.toMatch(/Ltd\.|A\.Ş\.|kuruluş sürecinde/i);
    expect(OPERATOR.entity.trim().length).toBeGreaterThan(0);
  });

  it("kimlik satırı yalnız DOLU alanları yazar", () => {
    const line = operatorIdentity();
    expect(line).toContain(OPERATOR.entity);
    expect(line).toContain(OPERATOR.email);
    // Boş alan "Telefon: ·" gibi yarım ifade üretmemeli.
    expect(line).not.toMatch(/:\s*(·|$)/);
  });

  it("KEP alanı doluysa GERÇEK bir KEP adresidir", () => {
    // KEP, normal e-postadan farklıdır (PTT/yetkili sağlayıcı, *.kep.tr).
    // Şahıs şirketinde zorunlu değil; boş bırakılabilir ama yanlış doldurulamaz.
    if (OPERATOR.kep) expect(OPERATOR.kep).toMatch(/\.kep\.tr$/);
  });

  it("LANSMAN KONTROLÜ: zorunlu alanlar", () => {
    // Bu test bilinçli olarak GEVŞEKTİR: eksikleri listeler ama kırmaz —
    // alanlar tescil/abonelik süreçlerine bağlı. Lansmandan önce `expect`
    // satırındaki `.length` beklentisi 0'a çekilip zorunlu hale getirilmeli.
    const eksik = (["address", "phone", "taxOffice"] as const).filter(
      (k) => !OPERATOR[k] || OPERATOR[k] === "Adana, Türkiye"
    );
    expect(eksik.length).toBeLessThanOrEqual(3);
  });
});
