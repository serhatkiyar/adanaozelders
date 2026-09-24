import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OzgecmisBolumu, yilAraligi } from "@/components/egitmen/OzgecmisBolumu";
import type { Education } from "@/types";

const E = (over: Partial<Education>): Education => ({
  id: 1,
  school_name: "Okul",
  degree: "Lisans",
  field_of_study: "Felsefe",
  start_year: 2016,
  end_year: 2020,
  verification_status: "NONE",
  ...over,
});

describe("OzgecmisBolumu", () => {
  it("eğitim yoksa hiçbir şey çizmez", () => {
    const { container } = render(<OzgecmisBolumu educations={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("en yeni önce sıralar; doğrulama yalnız VERIFIED kayıtta", () => {
    render(
      <OzgecmisBolumu
        educations={[
          E({ id: 1, school_name: "Eski Üniversite", end_year: 2012, start_year: 2008 }),
          E({ id: 2, school_name: "Yeni Üniversite", verification_status: "VERIFIED", document_type: "DIPLOMA" }),
        ]}
      />
    );
    expect(screen.getByRole("heading", { name: "Özgeçmiş" })).toBeTruthy();
    const okullar = screen.getAllByText(/Üniversite$/).map((e) => e.textContent);
    expect(okullar).toEqual(["Yeni Üniversite", "Eski Üniversite"]);
    expect(screen.getAllByText("Diploma doğrulandı")).toHaveLength(1);
    expect(screen.getAllByText("Lisans · Felsefe")).toHaveLength(2);
  });

  it("yıl aralığı", () => {
    expect(yilAraligi(2016, 2020)).toBe("2016 — 2020");
    expect(yilAraligi(null, 2020)).toBe("2020");
    expect(yilAraligi(null, null)).toBe("");
  });
});
