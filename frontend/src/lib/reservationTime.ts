// Rezervasyon ekranlarının zaman dili — saf, pytest'li kardeşi yok, vitest'li.
//
// ## Neden mutlak birincil, göreli ikincil
//
// Randevu ekranları ekran görüntüsü alınıp paylaşılır ve kullanıcı "hangi gün"
// sorusunu doğrulayabilmelidir. "Yarın 14:00" tek başına yazıldığında bu
// doğrulama imkânsızdır ve göreli zaman zihinsel hesap yükü bindirir
// (UX Movement · Close · erişilebilirlik literatürü). Bu yüzden ekranlar
// `mutlakZaman()` yazar, `goreliGun()` yanına küçük punto not düşer.
//
// ## Neden İstanbul saati
//
// Mekân fizikseldir: kütüphane koltuğu Adana'dadır. Sunucu UTC gönderir;
// tarayıcının saat dilimi UTC ise 14:00'lık rezervasyon "11:00" görünür ve
// operatör kapıda yanlış saati söyler (`lib/datetime.ts` aynı gerekçeyle
// `formatIstanbulTime`i tutuyor).
const TZ = "Europe/Istanbul";

const gunAyFmt = new Intl.DateTimeFormat("tr-TR", {
  timeZone: TZ,
  day: "numeric",
  month: "long",
  weekday: "long",
});
const saatFmt = new Intl.DateTimeFormat("tr-TR", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const cipaFmt = new Intl.DateTimeFormat("tr-TR", {
  timeZone: TZ,
  weekday: "short",
  day: "2-digit",
  month: "short",
});
//: Takvim günü karşılaştırması için İstanbul günü ("2026-09-03").
const gunAnahtariFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function tarih(iso?: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** İstanbul takvim günü anahtarı — gün farkı SAATTEN değil bundan hesaplanır. */
function gunAnahtari(d: Date): string {
  return gunAnahtariFmt.format(d);
}

/**
 * "3 Eylül Perşembe · 14:00–15:00".
 *
 * Aralık gece yarısını aşıyorsa İKİ tarih de yazılır: tek tarih yazmak
 * "23:00–01:00"i aynı güne aitmiş gibi gösterir ve kullanıcı hangi gün
 * bittiğini bilemez.
 */
export function mutlakZaman(startIso?: string | null, endIso?: string | null): string {
  const bas = tarih(startIso);
  if (bas === null) return "";
  const bit = tarih(endIso);
  if (bit === null) return `${gunAyFmt.format(bas)} · ${saatFmt.format(bas)}`;
  if (gunAnahtari(bas) !== gunAnahtari(bit)) {
    return (
      `${gunAyFmt.format(bas)} ${saatFmt.format(bas)}` +
      ` → ${gunAyFmt.format(bit)} ${saatFmt.format(bit)}`
    );
  }
  return `${gunAyFmt.format(bas)} · ${saatFmt.format(bas)}–${saatFmt.format(bit)}`;
}

/** "bugün" | "yarın" | "3 gün sonra" | "geçti"; bozuk tarihte null. */
export function goreliGun(iso?: string | null, simdi: Date = new Date()): string | null {
  const d = tarih(iso);
  if (d === null) return null;
  // Fark TAKVİM GÜNÜ üzerinden: 23:00 → ertesi 01:00 yalnız 2 saattir ama "yarın"dır.
  const hedef = new Date(`${gunAnahtari(d)}T00:00:00Z`).getTime();
  const bugun = new Date(`${gunAnahtari(simdi)}T00:00:00Z`).getTime();
  const fark = Math.round((hedef - bugun) / 86_400_000);
  if (fark === 0) return "bugün";
  if (fark === 1) return "yarın";
  if (fark < 0) return "geçti";
  return `${fark} gün sonra`;
}

/** Liste satırının sol çıpası: `{ gun: "Per", sayi: "03", ay: "Eyl" }`. */
export function tarihCipasi(iso?: string | null): { gun: string; sayi: string; ay: string } {
  const d = tarih(iso);
  if (d === null) return { gun: "", sayi: "", ay: "" };
  const parcalar = cipaFmt.formatToParts(d);
  const al = (tur: string) => parcalar.find((p) => p.type === tur)?.value ?? "";
  return {
    gun: al("weekday").replace(".", ""),
    sayi: al("day"),
    ay: al("month").replace(".", ""),
  };
}
