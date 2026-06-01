// Görev son-tarih sınıflandırması (akıllı görünümler için). Saf fonksiyon —
// backend services/task_service.classify_due ile aynı mantık, yerel takvim gününe göre.

export type DueGroup = "overdue" | "today" | "upcoming" | "none";

export function classifyDue(
  dueIso: string | null | undefined,
  now: Date = new Date()
): DueGroup {
  if (!dueIso) return "none";
  const d = new Date(dueIso);
  if (Number.isNaN(d.getTime())) return "none";
  if (d.getTime() < now.getTime()) return "overdue";
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? "today" : "upcoming";
}

// ISO (UTC) -> datetime-local input değeri ("YYYY-MM-DDTHH:mm", yerel saat).
export function isoToLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
