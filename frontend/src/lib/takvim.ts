/**
 * "Takvime ekle" yardımcıları (Modül 3 başarı ekranı). Sunucu ucu yoktur:
 * Google Takvim şablon bağlantısı ve `.ics` dosyası tarayıcıda üretilir.
 * Saatler UTC ("…Z") yazılır; takvim uygulaması kullanıcının saat dilimine çevirir.
 */

export interface TakvimDersi {
  id: number;
  start_at: string;
  end_at: string;
}

/** ISO → "YYYYMMDDTHHMMSSZ" (UTC, milisaniyesiz). */
function utcDamga(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function googleTakvimLinki(ders: TakvimDersi, baslik: string, detay = ""): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: baslik,
    dates: `${utcDamga(ders.start_at)}/${utcDamga(ders.end_at)}`,
  });
  if (detay) params.set("details", detay);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** RFC 5545 metin kaçışı: ters bölü, noktalı virgül, virgül ve satır sonu. */
function icsMetni(metin: string): string {
  return metin
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export function icsIcerigi(
  ders: TakvimDersi,
  baslik: string,
  detay = "",
  simdi: Date = new Date()
): string {
  const satirlar = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Adana Ozel Ders//Ders Talebi//TR",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:ders-${ders.id}@adanaozelders`,
    `DTSTAMP:${utcDamga(simdi)}`,
    `DTSTART:${utcDamga(ders.start_at)}`,
    `DTEND:${utcDamga(ders.end_at)}`,
    `SUMMARY:${icsMetni(baslik)}`,
    ...(detay ? [`DESCRIPTION:${icsMetni(detay)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${satirlar.join("\r\n")}\r\n`;
}

/** `.ics` içeriğini Blob ve geçici bir `<a download>` ile indirir. */
export function icsIndir(icerik: string, dosyaAdi: string): void {
  const url = URL.createObjectURL(new Blob([icerik], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = dosyaAdi;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Tıklama işlenmeden bağlantı düşmesin diye bir tur sonra bırakılır.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
