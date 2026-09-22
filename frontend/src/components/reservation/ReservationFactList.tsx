// Detaydaki etiket-değer listesi (süre · ücret · kod…).
//
// Sakin, çerçevesiz, saç-teli ayraçlı: bilgi kutu içine alınmaz. Boş değerler
// çağıran tarafından elenir — "—" yazan satır bilgi değil gürültüdür.
export interface ReservationFact {
  etiket: string;
  deger: React.ReactNode;
}

export function ReservationFactList({ facts }: { facts: ReservationFact[] }) {
  const dolu = facts.filter((f) => f.deger !== null && f.deger !== undefined && f.deger !== "");
  if (dolu.length === 0) return null;
  return (
    <dl className="divide-y divide-slate-200">
      {dolu.map((f) => (
        <div key={f.etiket} className="flex items-baseline gap-4 py-2.5">
          <dt className="w-32 shrink-0 text-sm text-slate-500 sm:w-40">{f.etiket}</dt>
          <dd className="min-w-0 flex-1 text-sm text-slate-800">{f.deger}</dd>
        </div>
      ))}
    </dl>
  );
}
