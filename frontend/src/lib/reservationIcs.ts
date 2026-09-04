// Rezervasyonu telefonun takvimine ekleyen `.ics` üretimi (RFC 5545).
//
// Neden var: LibCal (gerçek kütüphane koltuk ürünü) giriş kodunu takvim ekine
// de gömüyor — çünkü kullanıcılar kodu e-posta zincirinde bulamıyordu. Aynı
// mantık burada: randevu takvime düşerse kod da yanında gider.
//
// Kütüphane için sunucu tarafı gerekmiyor: dosya istemcide üretilip indirilir.
import type { ReservationItem } from "./reservationModel";

/** ICS'te tarih: `20260903T140000Z`. */
function icsZaman(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** RFC 5545: virgül, noktalı virgül, ters bölü ve satır sonu kaçırılır. */
function kacir(metin: string): string {
  return metin
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export function rezervasyonIcs(item: ReservationItem): { adSoyad: string; icerik: string } {
  const bas = item.baslangic;
  // Bitişi olmayan kayıt için bir saatlik varsayılan blok: takvimde sıfır
  // uzunluklu etkinlik bazı istemcilerde hiç görünmüyor.
  const bit = item.bitis ?? (bas ? new Date(new Date(bas).getTime() + 3_600_000).toISOString() : null);

  const baslik = item.altBaslik ? `${item.baslik} · ${item.altBaslik}` : item.baslik;
  const aciklama = item.girisKodu
    ? `Girişte bu kodu görevliye söyle: ${item.girisKodu}`
    : "Rezervasyon detayı Adana Özel Ders hesabındadır.";

  const satirlar = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Adana Ozel Ders//Rezervasyon//TR",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${item.tur}-${item.id}@adanaozelders`,
    `DTSTAMP:${icsZaman(new Date().toISOString())}`,
    ...(bas ? [`DTSTART:${icsZaman(bas)}`] : []),
    ...(bit ? [`DTEND:${icsZaman(bit)}`] : []),
    `SUMMARY:${kacir(baslik)}`,
    `DESCRIPTION:${kacir(aciklama)}`,
    ...(item.altBaslik ? [`LOCATION:${kacir(item.altBaslik)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return {
    adSoyad: `rezervasyon-${item.tur}-${item.id}.ics`,
    icerik: `${satirlar.join("\r\n")}\r\n`,
  };
}

/** Üretilen dosyayı indirir. */
export function icsIndir({ adSoyad, icerik }: { adSoyad: string; icerik: string }): void {
  const blob = new Blob([icerik], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = adSoyad;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
