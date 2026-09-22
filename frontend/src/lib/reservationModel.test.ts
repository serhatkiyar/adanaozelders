// @vitest-environment node
import { describe, expect, it } from "vitest";

import { BookingStatus } from "@/types";
import { toReservationItem } from "./reservationModel";
import type { BookingOut, RegistrationOut, StudyReservationOut } from "@/types";

// Bu dosya `pages/Tickets.tsx`'in SİLİNECEK olan mantığını kurtarıyor:
// `terminalView` durum matrisi, 24 saat iade penceresi ve İKİ AYRI süre-doldu
// hesabı (sınav `starts_at + duration_minutes`, çalışma `ends_at`). Üçü de
// bugün sıfır testli; dosya silinmeden önce ağ burada gerilir.

const SIMDI = new Date("2026-09-03T10:00:00+03:00");

function kayit(over: Partial<RegistrationOut> = {}): RegistrationOut {
  return {
    id: 1,
    session_id: 10,
    client_id: 5,
    status: "PAID",
    amount: "150.00",
    currency: "TRY",
    paid_at: "2026-09-01T10:00:00+03:00",
    attended_at: null,
    qr_token: "tok",
    short_code: "4F6E8Y3F",
    created_at: "2026-09-01T09:00:00+03:00",
    result_published: false,
    session: {
      id: 10,
      library_id: 2,
      exam_type: "TYT",
      title: "TYT Genel Deneme",
      starts_at: "2026-09-05T10:00:00+03:00",
      duration_minutes: 135,
      capacity: 40,
      price: "150.00",
      library_name: "Merkez Kütüphane",
      library_slug: "merkez",
    },
    ...over,
  } as RegistrationOut;
}

function calisma(over: Partial<StudyReservationOut> = {}): StudyReservationOut {
  return {
    id: 2,
    library_id: 2,
    library_name: "Merkez Kütüphane",
    library_slug: "merkez",
    client_id: 5,
    client_name: "Ayşe",
    starts_at: "2026-09-05T09:00:00+03:00",
    ends_at: "2026-09-05T13:00:00+03:00",
    status: "PAID",
    amount: "80.00",
    currency: "TRY",
    paid_at: "2026-09-01T10:00:00+03:00",
    attended_at: null,
    qr_token: "tok",
    short_code: "9K2M4P7Q",
    created_at: "2026-09-01T09:00:00+03:00",
    ...over,
  } as StudyReservationOut;
}

function ders(over: Partial<BookingOut> = {}): BookingOut {
  return {
    id: 3,
    tutor_id: 7,
    client_id: 5,
    status: BookingStatus.ACCEPTED,
    start_at: "2026-09-05T14:00:00+03:00",
    end_at: "2026-09-05T15:00:00+03:00",
    price: "300.00",
    notes: null,
    created_at: "2026-09-01T09:00:00+03:00",
    tutor_name: "Ahmet Yılmaz",
    reviewed: false,
    ...over,
  } as BookingOut;
}

// ── Üç veri şekli → tek model ────────────────────────────────────────────────

describe("üç kaynak tek modele iner", () => {
  it("deneme kaydı: başlık oturumdan, alt başlık kütüphaneden", () => {
    const i = toReservationItem(kayit(), SIMDI);
    expect(i.tur).toBe("deneme");
    expect(i.baslik).toBe("TYT Genel Deneme");
    expect(i.altBaslik).toBe("Merkez Kütüphane");
    expect(i.baslangic).toBe("2026-09-05T10:00:00+03:00");
  });

  it("çalışma rezervasyonu: başlık sabit, alt başlık kütüphane", () => {
    const i = toReservationItem(calisma(), SIMDI);
    expect(i.tur).toBe("calisma");
    expect(i.baslik).toBe("Çalışma alanı");
    expect(i.altBaslik).toBe("Merkez Kütüphane");
    expect(i.bitis).toBe("2026-09-05T13:00:00+03:00");
  });

  it("ders: alt başlık öğretmen adı", () => {
    const i = toReservationItem(ders(), SIMDI);
    expect(i.tur).toBe("ders");
    expect(i.altBaslik).toBe("Ahmet Yılmaz");
    expect(i.tutar).toBe("300.00");
  });

  it("kayıt tipi TEK alana bağlı değildir (kısmi yükte de doğru dal)", () => {
    // Gerçek kusur: `session_id` olmayan ama gömülü `session` taşıyan kayıt
    // DERS sanılıyordu; başlık "Ders" oluyor, tarih ve kütüphane kayboluyordu.
    const kismi = {
      id: 11,
      status: "PENDING_PAYMENT",
      amount: "150.00",
      session: {
        title: "TYT Genel Deneme",
        starts_at: "2026-09-05T10:00:00+03:00",
        duration_minutes: 135,
        library_name: "Merkez Kütüphane",
      },
    } as unknown as RegistrationOut;
    const i = toReservationItem(kismi, SIMDI);
    expect(i.tur).toBe("deneme");
    expect(i.baslik).toBe("TYT Genel Deneme");
    expect(i.baslangic).toBe("2026-09-05T10:00:00+03:00");
  });

  it("oturumu okunamayan deneme kaydı ekranı çökertmez", () => {
    const i = toReservationItem(kayit({ session: undefined }), SIMDI);
    expect(i.baslik).toBeTruthy();
    expect(i.baslangic).toBeNull();
  });
});

// ── Durum türetimi (eski `terminalView`) ─────────────────────────────────────

describe("durum türetimi", () => {
  it("ATTENDED → giriş yapıldı", () => {
    expect(toReservationItem(kayit({ status: "ATTENDED" }), SIMDI).durum).toBe("GIRIS_YAPILDI");
  });

  it("iade durumları ayrışır", () => {
    expect(toReservationItem(kayit({ status: "REFUNDING" }), SIMDI).durum).toBe("IADE_EDILIYOR");
    expect(toReservationItem(kayit({ status: "REFUNDED" }), SIMDI).durum).toBe("IADE_EDILDI");
  });

  it("ödeme bekleyen kayıt BEKLIYOR'dur", () => {
    expect(toReservationItem(kayit({ status: "PENDING_PAYMENT" }), SIMDI).durum).toBe("BEKLIYOR");
  });

  it("ders durumları kendi eşlemesini korur", () => {
    expect(toReservationItem(ders({ status: BookingStatus.PENDING }), SIMDI).durum).toBe("BEKLIYOR");
    expect(toReservationItem(ders({ status: BookingStatus.REJECTED }), SIMDI).durum).toBe("REDDEDILDI");
    expect(toReservationItem(ders({ status: BookingStatus.COMPLETED }), SIMDI).durum).toBe("TAMAMLANDI");
  });
});

// ── İKİ AYRI süre-doldu hesabı ───────────────────────────────────────────────

describe("süresi doldu (no-show)", () => {
  const gecmis = new Date("2026-09-06T10:00:00+03:00");

  it("DENEME: bitiş = başlangıç + süre", () => {
    // 5 Eylül 10:00 + 135 dk = 12:15. 12:00'de HENÜZ dolmamıştır.
    const erken = toReservationItem(kayit(), new Date("2026-09-05T12:00:00+03:00"));
    expect(erken.durum).toBe("ONAYLANDI");
    const gec = toReservationItem(kayit(), new Date("2026-09-05T12:30:00+03:00"));
    expect(gec.durum).toBe("SURESI_DOLDU");
  });

  it("ÇALIŞMA: bitiş doğrudan ends_at", () => {
    const erken = toReservationItem(calisma(), new Date("2026-09-05T12:00:00+03:00"));
    expect(erken.durum).toBe("ONAYLANDI");
    const gec = toReservationItem(calisma(), new Date("2026-09-05T13:30:00+03:00"));
    expect(gec.durum).toBe("SURESI_DOLDU");
  });

  it("giriş yapılmış kayıt geçmişte de SÜRESİ DOLMUŞ sayılmaz", () => {
    const i = toReservationItem(kayit({ status: "ATTENDED", attended_at: "2026-09-05T10:05:00+03:00" }), gecmis);
    expect(i.durum).toBe("GIRIS_YAPILDI");
  });

  it("iade edilmiş kayıt geçmişte de SÜRESİ DOLMUŞ sayılmaz", () => {
    expect(toReservationItem(kayit({ status: "REFUNDED" }), gecmis).durum).toBe("IADE_EDILDI");
  });

  it("DERSTE süre-doldu kuralı YOKTUR (bugünkü davranış korunur)", () => {
    // Ders tarafında no-show kavramı yok; geçmiş ders ACCEPTED kalır.
    expect(toReservationItem(ders(), gecmis).durum).toBe("ONAYLANDI");
  });
});

// ── 24 saat iade penceresi ───────────────────────────────────────────────────

describe("tam iade penceresi", () => {
  it("başlangıca 24 saatten FAZLA varsa iade edilebilir", () => {
    // 3 Eylül 10:00 → 5 Eylül 10:00 = 48 saat.
    expect(toReservationItem(kayit(), SIMDI).tamIade).toBe(true);
  });

  it("24 saatin altına inince iade hakkı düşer", () => {
    expect(toReservationItem(kayit(), new Date("2026-09-04T11:00:00+03:00")).tamIade).toBe(false);
  });

  it("tam sınırda (24 saat) iade YOKTUR — kural 'fazla' der", () => {
    expect(toReservationItem(kayit(), new Date("2026-09-04T10:00:00+03:00")).tamIade).toBe(false);
  });

  it("derste 24 saat kuralı yoktur — null döner", () => {
    expect(toReservationItem(ders(), SIMDI).tamIade).toBeNull();
  });
});

// ── Giriş kodu ───────────────────────────────────────────────────────────────

describe("giriş kodu", () => {
  it("ödenmiş kayıtta kod görünür", () => {
    expect(toReservationItem(kayit(), SIMDI).girisKodu).toBe("4F6E8Y3F");
  });

  it("ödenmemiş kayıtta kod YOKTUR (sunucu null'lar)", () => {
    expect(toReservationItem(kayit({ status: "PENDING_PAYMENT", short_code: null }), SIMDI).girisKodu).toBeNull();
  });

  it("GİRİŞ YAPILMIŞ kayıtta kod yok ama bu 'ödeme bekliyor' DEĞİLDİR", () => {
    // Gizli bug: sunucu `status != PAID` iken short_code'u null'lıyor, eski
    // ekran bunu "Ödeme sonrası QR oluşur" diye gösteriyordu — giriş yapmış
    // kullanıcıya ödeme yapmamış gibi davranıyordu.
    const i = toReservationItem(kayit({ status: "ATTENDED", short_code: null }), SIMDI);
    expect(i.girisKodu).toBeNull();
    expect(i.durum).toBe("GIRIS_YAPILDI");
  });

  it("derste giriş kodu kavramı yoktur", () => {
    expect(toReservationItem(ders(), SIMDI).girisKodu).toBeNull();
  });
});
