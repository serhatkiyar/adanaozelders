// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  FEEDBACK_PROBLEMS,
  FEEDBACK_PROBLEM_LABEL,
  canSubmitFeedback,
} from "./deliveryFeedback";

describe("teslimat geri bildirimi", () => {
  it("sorun kodlarının Türkçe etiketlerini sunar", () => {
    expect(FEEDBACK_PROBLEMS).toHaveLength(7);
    expect(FEEDBACK_PROBLEM_LABEL.GEC_TESLIMAT).toBe("Geç geldi");
    expect(FEEDBACK_PROBLEM_LABEL.YANLIS_EKSIK_URUN).toBe("Yanlış/eksik ürün");
  });

  it("olumlu değerlendirme sorun kodu olmadan gönderilebilir", () => {
    expect(canSubmitFeedback(true, [])).toBe(true);
  });

  it("olumsuz değerlendirmede en az bir sorun kodu ister", () => {
    expect(canSubmitFeedback(false, [])).toBe(false);
    expect(canSubmitFeedback(false, ["GEC_TESLIMAT"])).toBe(true);
  });
});
