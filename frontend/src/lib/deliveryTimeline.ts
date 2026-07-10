// Müşteri takip sayfası sözlüğü — backend timeline kodlarını (services/
// delivery_timeline.py whitelist'i) Türkçe kopyaya çevirir. Kod bilinmiyorsa
// satır GÖSTERİLMEZ (ileri sürüm backend'i eski frontend'i bozmasın).

export const TIMELINE_LABELS: Record<string, string> = {
  ORDER_RECEIVED: "Siparişin alındı",
  PAYMENT_CONFIRMED: "Ödemen onaylandı",
  PLANNED_FOR_DELIVERY: "Dağıtım planlandı",
  OUT_FOR_DELIVERY: "Kuryemiz dağıtıma çıktı",
  DELIVERY_FAILED: "Teslim edilemedi — yeniden planlanacak",
  POSTPONED: "Teslimat isteğinle ertelendi",
  DELIVERED: "Teslim edildi",
  CANCELLED: "Sipariş iptal edildi",
  REFUNDED: "Ücret iade edildi",
};

const timeFmt = new Intl.DateTimeFormat("tr-TR", {
  hour: "2-digit",
  minute: "2-digit",
});
const dayTimeFmt = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** Olay damgası: bugünse yalnız saat ("14:05"), değilse "8 Tem 14:05". */
export function formatEventTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? timeFmt.format(d) : dayTimeFmt.format(d);
}

/** Varış penceresi: "18:00 – 19:00 arası" (uçlar sunucuda yuvarlanmış gelir). */
export function formatEtaWindow(
  startIso?: string | null,
  endIso?: string | null,
): string | null {
  if (!startIso || !endIso) return null;
  return `${timeFmt.format(new Date(startIso))} – ${timeFmt.format(new Date(endIso))} arası`;
}

/** Teslim kanıtı türü → müşteri kopyası. */
export function proofLabel(proof?: string | null): string | null {
  if (proof === "OTP") return "SMS kodu doğrulanarak teslim edildi";
  if (proof === "ADMIN") return "Görevli onayıyla teslim edildi";
  if (proof === "PHOTO") return "Fotoğraflı teslim kanıtıyla bırakıldı";
  return null;
}
