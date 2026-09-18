// @vitest-environment node
import { describe, expect, it } from "vitest";

import { normalizePhoneTR } from "./phone";

// Backend `phone_service.normalize_phone` ile aynı sözleşme: iki taraf
// ayrışırsa form istemcide geçip sunucuda 422 alır (ya da tersi).
describe("normalizePhoneTR", () => {
  it("yaygın yazımları tek E.164 biçimine indirger", () => {
    expect(normalizePhoneTR("0532 123 45 67")).toBe("+905321234567");
    expect(normalizePhoneTR("5321234567")).toBe("+905321234567");
    expect(normalizePhoneTR("+90 (532) 123-45-67")).toBe("+905321234567");
    expect(normalizePhoneTR("90 532 123 45 67")).toBe("+905321234567");
  });

  it("cep olmayan ya da eksik numarayı reddeder", () => {
    expect(normalizePhoneTR("")).toBeNull();
    expect(normalizePhoneTR("0322 111 22 33")).toBeNull(); // sabit hat
    expect(normalizePhoneTR("0532 123 45 6")).toBeNull(); // eksik hane
    expect(normalizePhoneTR("telefonum yok")).toBeNull();
  });
});
