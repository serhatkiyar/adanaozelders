/**
 * İP-A2 · M8 — sunucu 422'si ALANA yazılır, toast'a değil.
 *
 * FastAPI/pydantic doğrulama hatası `detail[]` dizisi döner ve her öğenin
 * `loc` yolu hangi alanın reddedildiğini söyler (`["body", "qty"]`). Bugün bu
 * bilgi çöpe gidiyor: hata tek bir metne indirgenip toast'a basılıyor,
 * kullanıcı hangi alanı düzelteceğini formda göremiyor.
 *
 * Sözleşme (İP-A2, kasıtlı davranış değişikliği):
 *   - `loc` bilinen bir alana düşüyorsa → mesaj O ALANIN altına, toast YOK
 *   - düşmüyorsa (ya da 500/ağ hatası) → genel mesaj, toast/uyarı şeridi
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { Form, sunucuHatasiniUygula } from "./form";

const sema = z.object({ miktar: z.string().min(1, "Miktar zorunlu.") });
type Degerler = z.infer<typeof sema>;

/** Axios'un 422 yanıtının şekli — gerçek `AxiosError` gövdesiyle aynı. */
function hata422(loc: (string | number)[], msg: string) {
  return {
    isAxiosError: true,
    response: { status: 422, data: { detail: [{ loc, msg, type: "value_error" }] } },
  };
}

function Deneme({
  sunucuHatasi,
  toast,
}: {
  sunucuHatasi: unknown;
  toast: (m: string) => void;
}) {
  const [genel, setGenel] = useState<string | null>(null);
  const form = useForm<Degerler>({
    resolver: zodResolver(sema),
    defaultValues: { miktar: "3" },
  });

  const gonder = form.handleSubmit(() => {
    const kalan = sunucuHatasiniUygula(sunucuHatasi, form, ["miktar"]);
    setGenel(kalan);
    if (kalan) toast(kalan);
  });

  return (
    <form onSubmit={gonder}>
      <Form.Field
        control={form.control}
        name="miktar"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Miktar</Form.Label>
            <Form.Control>
              <input {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
      {genel ? <p data-testid="genel-uyari">{genel}</p> : null}
      <button type="submit">Gönder</button>
    </form>
  );
}

describe("İP-A2 · sunucu hatası eşlemesi", () => {
  it("M8 — 422 loc'u bir alana düşüyorsa mesaj alanın altına yazılır, toast atılmaz", async () => {
    const toast = vi.fn();
    render(
      <Deneme
        toast={toast}
        sunucuHatasi={hata422(["body", "miktar"], "Stokta bu kadar yok")}
      />
    );

    fireEvent.click(screen.getByText("Gönder"));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Stokta bu kadar yok"
      )
    );

    // Mesaj gerçekten ALANA bağlı: kontrolün aria-describedby'ı onu gösteriyor.
    const kontrol = screen.getByLabelText("Miktar");
    const id = kontrol.getAttribute("aria-describedby");
    expect(document.getElementById(id!)?.textContent).toContain(
      "Stokta bu kadar yok"
    );
    expect(kontrol.getAttribute("aria-invalid")).toBe("true");

    // Ve toast'a GİTMEDİ — aynı hatayı iki yerde göstermek gürültüdür.
    expect(toast).not.toHaveBeenCalled();
    expect(screen.queryByTestId("genel-uyari")).toBeNull();
  });

  it("M8b — loc bilinen bir alana düşmüyorsa genel mesaja düşer", async () => {
    const toast = vi.fn();
    render(
      <Deneme
        toast={toast}
        sunucuHatasi={hata422(["body", "bilinmeyen_alan"], "Kapsam dışı")}
      />
    );

    fireEvent.click(screen.getByText("Gönder"));

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("genel-uyari").textContent).toContain(
      "Kapsam dışı"
    );
    // Alanın altında hata YOK: sunucu o alanı reddetmedi.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("M8c — 500/ağ hatası alana yazılmaz, genel kanaldan gider", async () => {
    const toast = vi.fn();
    render(
      <Deneme
        toast={toast}
        sunucuHatasi={{
          isAxiosError: true,
          response: { status: 500, data: { detail: "Sunucu hatası" } },
        }}
      />
    );

    fireEvent.click(screen.getByText("Gönder"));

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
