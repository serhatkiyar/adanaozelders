// Teslimat rozeti — SADE (kullanıcı kararı, 30 Ağu): "Cıncık Teslimat" markası
// ve "kendi kuryemizle / geri sayım" anlatısı KALDIRILDI; yerinde yalnız
// "Hızlı Teslimat" yazar. Sunucu geri sayım altyapısı (useDeliveryInfo,
// lib/deliveryPromise) DURUYOR — söz anlatısı geri istenirse oradan bağlanır.

export function DeliveryPromiseBadge({ variant = "default" }: { variant?: "inline" | "default" }) {
  if (variant === "inline") {
    return <span className="text-emerald-700 ">Hızlı Teslimat</span>;
  }

  return (
    <div className="flex items-center gap-2.5 text-slate-600 ">
      <svg
        className="shrink-0 text-emerald-600 "
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="1" y="3" width="15" height="13" />
        <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
      <span className="font-medium text-slate-900 ">Hızlı Teslimat</span>
    </div>
  );
}
