type Tone = "indigo" | "amber" | "emerald" | "slate" | "red";

interface StatCardProps {
  label: string;
  value: number | string;
  hint?: string;
  tone?: Tone;
}

const TONES: Record<Tone, string> = {
  indigo: "text-marka",
  amber: "text-amber-600",
  emerald: "text-emerald-600",
  slate: "text-slate-900",
  red: "text-red-600",
};

export function StatCard({ label, value, hint, tone = "slate" }: StatCardProps) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${TONES[tone]}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
