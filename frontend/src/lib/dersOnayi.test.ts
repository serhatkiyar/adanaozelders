// @vitest-environment node
import { describe, expect, it } from "vitest";
import { iptalKurali, onayDurumu, sorunNedeniEtiketi } from "@/lib/dersOnayi";
import { BookingStatus, type BookingOut } from "@/types";

const simdi = new Date("2026-09-17T12:00:00Z").getTime();
const saat = (h: number) => new Date(simdi + h * 3600_000).toISOString();

function ders(p: Partial<BookingOut>): BookingOut {
  return {
    id: 1,
    tutor_id: 2,
    client_id: 3,
    status: BookingStatus.ACCEPTED,
    start_at: saat(-2),
    end_at: saat(-1),
    created_at: saat(-100),
    resources: [],
    comments: [],
    private_notes: [],
    issue_report_deadline: saat(71),
    ...p,
  } as BookingOut;
}

describe("onayDurumu", () => {
  it("başlamış, onaylanmamış ders onay bekler", () => {
    expect(onayDurumu(ders({}), simdi)).toBe("bekliyor");
    expect(onayDurumu(ders({ status: BookingStatus.COMPLETED }), simdi)).toBe("bekliyor");
  });
  it("başlamamış ders için kart yok", () => {
    expect(onayDurumu(ders({ start_at: saat(3), end_at: saat(4) }), simdi)).toBe("yok");
  });
  it("iptal edilmiş ders için kart yok", () => {
    expect(onayDurumu(ders({ status: BookingStatus.CANCELLED }), simdi)).toBe("yok");
  });
  it("onaylanmış ve sorun bildirilmiş durumlar", () => {
    expect(onayDurumu(ders({ student_confirmed_at: saat(-0.5) }), simdi)).toBe("onaylandi");
    expect(onayDurumu(ders({ issue_reported_at: saat(-0.5), is_disputed: true }), simdi)).toBe(
      "sorun_bildirildi"
    );
  });
  it("72 saat penceresi dolunca süre doldu", () => {
    expect(onayDurumu(ders({ issue_report_deadline: saat(-1) }), simdi)).toBe("sure_doldu");
  });
});

describe("iptalKurali", () => {
  it("12 saatten fazla varken ücretsiz, azken role göre", () => {
    expect(iptalKurali(ders({ late_for_changes: false }), "CLIENT")).toBe("ucretsiz");
    expect(iptalKurali(ders({ late_for_changes: true }), "CLIENT")).toBe("ogrenci_gec");
    expect(iptalKurali(ders({ late_for_changes: true }), "TUTOR")).toBe("egitmen_gec");
  });
});

it("bilinmeyen sorun nedeni çökmez", () => {
  expect(sorunNedeniEtiketi("YENI")).toBe("Sorun bildirildi");
});
