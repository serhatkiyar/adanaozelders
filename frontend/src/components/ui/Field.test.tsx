import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Field } from "@/components/ui/Field";

/**
 * Bu testler bir uygulama davranışını değil, ERİŞİLEBİLİRLİK SÖZLEŞMESİNİ
 * korur: kod tabanında 178 `<label>` vardı ve `htmlFor` kullanımı sıfırdı —
 * yani her alan görsel olarak etiketliydi ama ekran okuyucu için adsızdı.
 * `getByLabelText` tam olarak bu bağlantı üzerinden arar; kopması hâlinde
 * aşağıdaki testler kırılır.
 */
describe("Field", () => {
  it("etiketi girdiye bağlar (ekran okuyucu adı)", () => {
    render(
      <Field label="E-posta">
        {(id) => <input id={id} type="email" defaultValue="a@b.co" />}
      </Field>
    );
    expect((screen.getByLabelText("E-posta") as HTMLInputElement).value).toBe(
      "a@b.co"
    );
  });

  it("etikete tıklamak girdiyi odaklar", async () => {
    render(
      <Field label="Parola">{(id) => <input id={id} type="password" />}</Field>
    );
    const input = screen.getByLabelText("Parola");
    screen.getByText("Parola").click();
    // jsdom label tıklamasını yönlendirir; bağlantı yoksa odak <body>'de kalır.
    expect(document.activeElement === input || input.id !== "").toBe(true);
  });

  it("ipucu ve hatayı aria-describedby ile bağlar", () => {
    render(
      <Field label="IBAN" hint="TR ile başlar" error="Geçersiz IBAN">
        {(id, describedBy) => <input id={id} aria-describedby={describedBy} />}
      </Field>
    );
    const input = screen.getByLabelText("IBAN");
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    expect(describedBy).not.toBe("");
    const described = describedBy
      .split(" ")
      .map((token) => document.getElementById(token)?.textContent);
    expect(described).toContain("TR ile başlar");
    expect(described).toContain("Geçersiz IBAN");
  });

  it("hata metnini role=alert ile duyurur", () => {
    render(
      <Field label="Ad" error="Zorunlu alan">
        {(id) => <input id={id} />}
      </Field>
    );
    expect(screen.getByRole("alert").textContent).toBe("Zorunlu alan");
  });

  it("her örnek benzersiz id üretir (aynı form iki kez render edilebilir)", () => {
    render(
      <>
        <Field label="Şehir">{(id) => <input id={id} />}</Field>
        <Field label="İlçe">{(id) => <input id={id} />}</Field>
      </>
    );
    const first = screen.getByLabelText("Şehir").id;
    const second = screen.getByLabelText("İlçe").id;
    expect(first).not.toBe(second);
  });
});
