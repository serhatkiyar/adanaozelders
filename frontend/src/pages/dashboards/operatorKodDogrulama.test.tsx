/**
 * Operatör katılım doğrulaması — kod var, kamera YOK.
 *
 * Bu nöbetçi bir ürün kararını koruyor: müşteri ekranında artık QR
 * gösterilmiyor, dolayısıyla operatörde okutulacak bir şey de yok. Kamera
 * düğmesi geri gelirse operatöre çalışmayacak bir yol vaat edilmiş olur —
 * kamerayı açar, öğrencinin ekranında QR bulamaz.
 *
 * Doğrulama zinciri değişmedi: `POST /exam-attendance/verify` hem `qr_token`
 * hem `short_code` kabul ediyor (`library_exam_service.py:1315-1345`), yani
 * kısa kod yolu sunucuda zaten çalışıyordu.
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { OperatorSessionsQrKart } from "./OperatorSessions";

function kur() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <OperatorSessionsQrKart />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("operatör katılım doğrulama", () => {
  it("rezervasyon kodu alanı ve Doğrula düğmesi vardır", () => {
    kur();
    expect(screen.getByLabelText("Rezervasyon kodu")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Doğrula" })).toBeTruthy();
  });

  it("KAMERA düğmesi YOKTUR", () => {
    kur();
    expect(screen.queryByRole("button", { name: /kamera/i })).toBeNull();
    expect(screen.queryByText(/QR tara/i)).toBeNull();
  });

  it("başlıkta ve alan metninde 'QR' geçmez", () => {
    const { container } = kur();
    expect(container.textContent).not.toMatch(/QR/);
  });

  it("alan 'bilet' değil 'rezervasyon' der", () => {
    kur();
    expect(screen.queryByLabelText(/bilet/i)).toBeNull();
  });
});
