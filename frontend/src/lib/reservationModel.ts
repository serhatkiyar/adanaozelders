// Üç rezervasyon türünü TEK modele indiren saf katman.
//
// ## Neden var
//
// Ders (`BookingOut`), çalışma alanı (`StudyReservationOut`) ve deneme oturumu
// (`RegistrationOut`) üç ayrı veri şeklidir ama kullanıcı için üçü de aynı şey:
// "gitmem gereken bir randevu". Ortak tasarım dilini mümkün kılan asıl soyutlama
// budur — üç şekli JSX içinde birleştirmeye çalışmak, her ekranda tekrarlanan
// `if (tur === ...)` zincirleri üretirdi.
//
// ## Kurtarılan mantık
//
// Bu dosya `pages/Tickets.tsx`'in silinen `terminalView` matrisini, 24 saat
// iade penceresini ve İKİ AYRI süre-doldu hesabını taşır. Üçü de orada sıfır
// testliydi; burada `reservationModel.test.ts` ile kilitli.
import { BookingStatus } from "@/types";
import type { BookingOut, RegistrationOut, StudyReservationOut } from "@/types";

export type ReservationKind = "ders" | "calisma" | "deneme";

/** Kullanıcıya gösterilen durum — üç kaynağın durumları buraya iner. */
export type ReservationStatusKey =
  | "BEKLIYOR"
  | "ONAYLANDI"
  | "GIRIS_YAPILDI"
  | "TAMAMLANDI"
  | "REDDEDILDI"
  | "IPTAL"
  | "IADE_EDILIYOR"
  | "IADE_EDILDI"
  | "SURESI_DOLDU";

export interface ReservationItem {
  tur: ReservationKind;
  id: number;
  baslik: string;
  /** Kim (eğitmen) ya da nerede (kütüphane). */
  altBaslik: string | null;
  baslangic: string | null;
  bitis: string | null;
  durum: ReservationStatusKey;
  tutar: string | null;
  currency: string;
  /** Girişte görevliye söylenecek kısa kod; yoksa null. Ders'te hep null. */
  girisKodu: string | null;
  girisZamani: string | null;
  /** Şimdi iptal edilirse tam iade alınır mı. Ders'te kural yok → null. */
  tamIade: boolean | null;
}

//: Ödenmiş kütüphane rezervasyonu, başlangıca bu kadar saatten FAZLA varsa
//: iptalde tam iade alır (eski `Tickets.tsx:428`).
const IADE_PENCERESI_SAAT = 24;

//: Bu durumlar terminaldir — geçmişte kalsalar da "süresi doldu" olmazlar.
const SURE_DISI: ReadonlySet<string> = new Set([
  "ATTENDED",
  "CANCELLED",
  "REFUNDING",
  "REFUNDED",
]);

const KUTUPHANE_DURUMU: Record<string, ReservationStatusKey> = {
  PENDING_PAYMENT: "BEKLIYOR",
  PAID: "ONAYLANDI",
  ATTENDED: "GIRIS_YAPILDI",
  CANCELLED: "IPTAL",
  REFUNDING: "IADE_EDILIYOR",
  REFUNDED: "IADE_EDILDI",
};

const DERS_DURUMU: Record<string, ReservationStatusKey> = {
  [BookingStatus.PENDING]: "BEKLIYOR",
  [BookingStatus.ACCEPTED]: "ONAYLANDI",
  [BookingStatus.REJECTED]: "REDDEDILDI",
  [BookingStatus.CANCELLED]: "IPTAL",
  [BookingStatus.COMPLETED]: "TAMAMLANDI",
};

function ms(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Kütüphane kaydının nihai durumu.
 *
 * `bitisMs` iki üründe FARKLI hesaplanır ve bu fark gerçek bir üründür:
 * denemenin bitişi `başlangıç + süre`, çalışma alanınınki doğrudan `ends_at`.
 * Geçmişte kalmış ve okutulmamış kayıt "süresi doldu" (no-show) sayılır.
 */
function kutuphaneDurumu(
  status: string,
  bitisMs: number | null,
  simdi: Date,
): ReservationStatusKey {
  const temel = KUTUPHANE_DURUMU[status] ?? "BEKLIYOR";
  if (SURE_DISI.has(status)) return temel;
  if (bitisMs !== null && bitisMs < simdi.getTime()) return "SURESI_DOLDU";
  return temel;
}

function tamIadeHakki(baslangic: string | null, simdi: Date): boolean {
  const bas = ms(baslangic);
  if (bas === null) return false;
  return bas - simdi.getTime() > IADE_PENCERESI_SAAT * 3_600_000;
}

function denemeMi(x: Kaynak): x is RegistrationOut {
  return "session_id" in x;
}

function calismaMi(x: Kaynak): x is StudyReservationOut {
  return "ends_at" in x && "library_id" in x;
}

type Kaynak = BookingOut | RegistrationOut | StudyReservationOut;

/** Üç kaynaktan birini ekranların konuştuğu tek modele çevirir. */
export function toReservationItem(kaynak: Kaynak, simdi: Date = new Date()): ReservationItem {
  if (denemeMi(kaynak)) {
    const oturum = kaynak.session;
    const baslangic = oturum?.starts_at ?? null;
    const basMs = ms(baslangic);
    const bitisMs =
      basMs === null ? null : basMs + (oturum?.duration_minutes ?? 0) * 60_000;
    return {
      tur: "deneme",
      id: kaynak.id,
      baslik: oturum?.title ?? "Deneme sınavı",
      altBaslik: oturum?.library_name ?? null,
      baslangic,
      bitis: bitisMs === null ? null : new Date(bitisMs).toISOString(),
      durum: kutuphaneDurumu(kaynak.status, bitisMs, simdi),
      tutar: kaynak.amount ?? null,
      currency: kaynak.currency ?? "TRY",
      girisKodu: kaynak.short_code ?? null,
      girisZamani: kaynak.attended_at ?? null,
      tamIade: tamIadeHakki(baslangic, simdi),
    };
  }

  if (calismaMi(kaynak)) {
    return {
      tur: "calisma",
      id: kaynak.id,
      baslik: "Çalışma alanı",
      altBaslik: kaynak.library_name ?? null,
      baslangic: kaynak.starts_at,
      bitis: kaynak.ends_at,
      durum: kutuphaneDurumu(kaynak.status, ms(kaynak.ends_at), simdi),
      tutar: kaynak.amount ?? null,
      currency: kaynak.currency ?? "TRY",
      girisKodu: kaynak.short_code ?? null,
      girisZamani: kaynak.attended_at ?? null,
      tamIade: tamIadeHakki(kaynak.starts_at, simdi),
    };
  }

  // Ders. Süre-doldu kuralı YOKTUR: ders tarafında no-show kavramı yok,
  // geçmiş ders durumunu korur (bugünkü davranış). Giriş kodu da yoktur.
  return {
    tur: "ders",
    id: kaynak.id,
    baslik: kaynak.is_free_lesson ? "Ücretsiz ilk ders" : "Ders",
    altBaslik: kaynak.tutor_name ?? null,
    baslangic: kaynak.start_at,
    bitis: kaynak.end_at ?? null,
    durum: DERS_DURUMU[kaynak.status] ?? "BEKLIYOR",
    tutar: kaynak.price ?? null,
    currency: "TRY",
    girisKodu: null,
    girisZamani: null,
    tamIade: null,
  };
}
