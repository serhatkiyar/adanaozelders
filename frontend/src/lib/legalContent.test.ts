import { describe, expect, it } from "vitest";
import {
  LEGAL_DOCS,
  OPERATOR,
  SIGNUP_CONSENT_DOCS,
  currentConsentVersion,
  getLegalDoc,
} from "@/lib/legalContent";
import { LEGAL_NAV } from "@/lib/legalNav";
import { LEGAL_ROUTES } from "@/lib/routes";

describe("legalContent", () => {
  it("her belge başlık, açıklama ve en az 4 bölüm içerir", () => {
    expect(LEGAL_DOCS.length).toBe(6);
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
