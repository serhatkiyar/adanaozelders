/**
 * İP-A2 · `Form.*` sözleşmesi — gerçek DOM davranış testleri.
 *
 * Bu dosya implementasyondan ÖNCE yazıldı ve kırmızı olduğu gösterildi
 * (`docs/ip-a2-rapor.md` → Görev 3). Her test, katmanın bir SÖZLEŞME maddesini
 * kullanıcının gördüğü sonuçtan doğrular: etiket bağı, `aria-invalid`,
 * `aria-describedby`, `role="alert"`, tek slot ve `id` çakışmazlığı.
 *
 * Kaynak taraması YOK: hepsi `@testing-library` ile render edilip DOM'dan
 * okunur (kök CLAUDE.md §B).
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { Form } from "./form";

const sema = z.object({
  ad: z.string().min(1, "Ad zorunlu."),
  not: z.string().optional(),
});

type Degerler = z.infer<typeof sema>;

function TekAlanliForm({
  hint = "Kimliğinizdeki ad.",
  onGonder,
}: {
  hint?: string | null;
  onGonder?: (d: Degerler) => void;
}) {
  const form = useForm<Degerler>({
    resolver: zodResolver(sema),
    defaultValues: { ad: "", not: "" },
    mode: "onChange",
  });
  return (
    <form onSubmit={form.handleSubmit((d) => onGonder?.(d))}>
      <Form.Field
        control={form.control}
        name="ad"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Ad</Form.Label>
            <Form.Control>
              <input {...field} />
            </Form.Control>
            {hint === null ? null : <Form.Hint>{hint}</Form.Hint>}
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
      <button type="submit">Kaydet</button>
    </form>
  );
}

function IkiAlanliForm() {
  const form = useForm<Degerler>({
    resolver: zodResolver(sema),
    defaultValues: { ad: "", not: "" },
  });
  return (
    <form>
      <Form.Field
        control={form.control}
        name="ad"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Ad</Form.Label>
            <Form.Control>
              <input {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
      <Form.Field
        control={form.control}
        name="not"
        render={({ field }) => (
          <Form.Item>
            <Form.Label optional>Not</Form.Label>
            <Form.Control>
              <input {...field} value={field.value ?? ""} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
    </form>
  );
}

describe("İP-A2 · Form sözleşmesi", () => {
  it("M1 — Label/kontrol bağı otomatik kurulur: getByLabelText kontrole ulaşır", () => {
    render(<TekAlanliForm />);
    const kontrol = screen.getByLabelText("Ad");
    expect(kontrol.tagName).toBe("INPUT");

    // Bağ gerçekten htmlFor/id üzerinden: elle yazılmış bir id YOK.
    const etiket = screen.getByText("Ad").closest("label")!;
    expect(etiket.getAttribute("for")).toBe(kontrol.getAttribute("id"));
    expect(kontrol.getAttribute("id")).toBeTruthy();
  });

  it("M2 — alan geçersizken kontrolde aria-invalid=true var", async () => {
    render(<TekAlanliForm />);
    const kontrol = screen.getByLabelText("Ad");
    // Geçerli başlangıç: bayrak asılı DEĞİL.
    expect(kontrol.getAttribute("aria-invalid")).not.toBe("true");

    fireEvent.change(kontrol, { target: { value: "x" } });
    fireEvent.change(kontrol, { target: { value: "" } });

    await waitFor(() =>
      expect(screen.getByLabelText("Ad").getAttribute("aria-invalid")).toBe(
        "true"
      )
    );
  });

  it("M3 — aria-describedby hata varken hatayı, yokken hint'i gösterir", async () => {
    render(<TekAlanliForm />);
    const kontrol = screen.getByLabelText("Ad");

    const hintId = kontrol.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId!)?.textContent).toContain(
      "Kimliğinizdeki ad."
    );

    fireEvent.change(kontrol, { target: { value: "x" } });
    fireEvent.change(kontrol, { target: { value: "" } });

    await waitFor(() => {
      const hataId = screen
        .getByLabelText("Ad")
        .getAttribute("aria-describedby");
      expect(hataId).toBeTruthy();
      expect(hataId).not.toBe(hintId);
      expect(document.getElementById(hataId!)?.textContent).toContain(
        "Ad zorunlu."
      );
    });
  });

  it("M4 — hata mesajında role=alert var", async () => {
    render(<TekAlanliForm />);
    const kontrol = screen.getByLabelText("Ad");
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.change(kontrol, { target: { value: "x" } });
    fireEvent.change(kontrol, { target: { value: "" } });

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Ad zorunlu.")
    );
  });

  it("M5 — tek slot: hint→hata geçişinde kabın kutusu değişmez", async () => {
    // jsdom düzen hesaplamaz; bu yüzden test YÜKSEKLİĞİ değil, yüksekliği
    // belirleyen MEKANİZMAYI doğrular: slot her iki durumda da AYNI DOM
    // düğümüdür (mount/unmount yok), sınıf listesi birebir aynıdır ve içinde
    // her an en fazla bir mesaj vardır. Gerçek piksel ölçümü tarayıcıda
    // yapıldı — `docs/ip-a2-rapor.md` → Görev 4 "slot piksel ölçümü".
    const { container } = render(<TekAlanliForm />);
    const slotOnce = container.querySelector("[data-form-slot]")!;
    expect(slotOnce).toBeTruthy();
    const sinifOnce = slotOnce.className;
    expect(slotOnce.children).toHaveLength(1);

    const kontrol = screen.getByLabelText("Ad");
    fireEvent.change(kontrol, { target: { value: "x" } });
    fireEvent.change(kontrol, { target: { value: "" } });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    const slotSonra = container.querySelector("[data-form-slot]")!;
    // AYNI düğüm: React bu kabı yeniden oluşturmadı, yalnız içeriğini değişti.
    expect(slotSonra).toBe(slotOnce);
    expect(slotSonra.className).toBe(sinifOnce);
    expect(slotSonra.children).toHaveLength(1);
    // Slot yükseklik rezervi sınıfla verilir; kaldırılırsa boş alan çöker.
    expect(sinifOnce).toMatch(/min-h-/);
  });

  it("M5b — hint hiç yokken bile slot durur (hatanın doğuşu yerleşimi itmez)", async () => {
    const { container } = render(<TekAlanliForm hint={null} />);
    const slot = container.querySelector("[data-form-slot]");
    expect(slot).toBeTruthy();
    expect(slot!.className).toMatch(/min-h-/);
  });

  it("M6 — aynı formdaki iki alanın id'leri çakışmaz", () => {
    render(<IkiAlanliForm />);
    const ad = screen.getByLabelText("Ad");
    const not = screen.getByLabelText(/^Not/);
    expect(ad.id).toBeTruthy();
    expect(not.id).toBeTruthy();
    expect(ad.id).not.toBe(not.id);
  });

  it("zorunluluk tersten işaretlenir: yıldız yok, isteğe bağlıya '(opsiyonel)'", () => {
    render(<IkiAlanliForm />);
    expect(screen.getByText(/opsiyonel/i)).toBeTruthy();
    expect(document.body.textContent).not.toContain("*");
  });
});
