/**
 * Ders listesi satırı — hangi aksiyon satırda, hangisi detayda?
 *
 * `StudentBookings` bugüne kadar SIFIR testliydi ve satırında yedi aksiyon
 * taşıyordu (öde · derse katıl · değerlendir · ertele · iptal · soru sor ·
 * detay). Ortak rezervasyon diline geçerken kural şu:
 *
 *   Satırda YALNIZ zamana duyarlı ve tamamlayıcı aksiyon kalır.
 *
 * • **Öde** kalır: ödenmemiş kaydın tek işi tamamlanmaktır.
 * • **Derse katıl** kalır: ders 10 dakika sonra başlıyorsa öğrenciyi bir tık
 *   daha uzağa göndermek yanlıştır.
 * • Ertele / iptal / değerlendir / soru sor DETAYA taşındı — hepsi
 *   `LessonDetail`de zaten var (Resy · Zocdoc · Preply deseni).
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { BookingStatus, PaymentStatus } from "@/types";
import { BookingRow } from "./StudentBookings";
import type { BookingOut } from "@/types";

function ders(over: Partial<BookingOut> = {}): BookingOut {
  return {
    id: 3,
    tutor_id: 7,
    client_id: 5,
    status: BookingStatus.ACCEPTED,
    start_at: new Date(Date.now() + 86_400_000).toISOString(),
    end_at: new Date(Date.now() + 90_000_000).toISOString(),
    price: "300.00",
    created_at: new Date().toISOString(),
    tutor_name: "Ahmet Yılmaz",
    reviewed: false,
    ...over,
  } as BookingOut;
}

// Ödeme kolu verisi olmadan `isBranchOpen` FAIL-CLOSED davranır (doğrusu
// budur): kol bilinmiyorsa ödeme düğmesi çizilmez. Testin ölçtüğü şey o
// değil, o yüzden kol AÇIK olarak önbelleğe konur.
function sar(booking: BookingOut, kolAcik = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["payments", "availability"], {
    branches: [
      { branch: "tutor_marketplace", open: kolAcik, flag_enabled: kolAcik, blockers: [] },
    ],
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BookingRow booking={booking} onJoinMeeting={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ders satırı", () => {
  it("eğitmen adı ve detay bağlantısı vardır", () => {
    sar(ders());
    expect(screen.getByText(/Ahmet Yılmaz/)).toBeTruthy();
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/ders-talepleri/3");
  });

  it("ERTELE, İPTAL, DEĞERLENDİR ve SORU SOR satırda YOKTUR (detayda)", () => {
    sar(ders({ status: BookingStatus.COMPLETED }));
    for (const ad of [/ertele/i, /iptal et/i, /değerlendir/i, /soru sor/i]) {
      expect(screen.queryByRole("button", { name: ad })).toBeNull();
    }
  });

  it("ödenmemiş onaylı derste ÖDE düğmesi satırda kalır", () => {
    sar(
      ders({
        payment: { status: PaymentStatus.PENDING, amount: "300.00" },
      } as Partial<BookingOut>),
    );
    expect(screen.getByRole("button", { name: /Öde/ })).toBeTruthy();
  });

  it("ders saati gelmemişken KATIL düğmesi pasif metne düşer", () => {
    // Canlı ders başlangıçtan 15 dk önce açılır; erken tıklama boş oda üretir.
    sar(ders({ meeting_room: "oda-1" }));
    expect(screen.queryByRole("button", { name: /Derse Katıl/ })).toBeNull();
    expect(screen.getByText(/Ders saatinde açılır/)).toBeTruthy();
  });

  it("ödeme kolu KAPALIYKEN düğme yerine sebep yazar", () => {
    sar(
      ders({
        payment: { status: PaymentStatus.PENDING, amount: "300.00" },
      } as Partial<BookingOut>),
      false,
    );
    expect(screen.queryByRole("button", { name: /Öde/ })).toBeNull();
    expect(screen.getByText(/Ödeme yolu şu an kapalı/)).toBeTruthy();
  });

  it("ders saati gelince KATIL düğmesi satırda görünür", () => {
    sar(
      ders({
        meeting_room: "oda-1",
        start_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        end_at: new Date(Date.now() + 65 * 60_000).toISOString(),
      }),
    );
    expect(screen.getByRole("button", { name: /Derse Katıl/ })).toBeTruthy();
  });
});
