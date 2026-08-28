// "Kuryeler" — kurye profilleri + rol-5 giriş hesapları + teslimat takvimi +
// salt-okunur operasyon yapılandırması. Bölge/kapasite/cutoff runtime'da
// DEĞİŞTİRİLEMEZ (env-only) — burada yalnız mevcut değerler gösterilir ki
// operatör "sistem hangi kurallarla söz veriyor" sorusunun cevabını bulsun.
import { CourierManager } from "@/components/admin/CourierManager";
import { ClosedDays } from "@/components/admin/delivery/ClosedDays";
import { useCapacityOverview, useDeliveryInfo } from "@/hooks/useDelivery";

function ConfigRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-2.5">
      <span className="w-44 shrink-0 text-sm text-slate-600 ">{label}</span>
      <span className="text-sm font-medium tabular-nums text-slate-900 ">{value}</span>
      {hint && <span className="text-xs text-slate-400 ">{hint}</span>}
    </li>
  );
}

/* Salt-okunur yapılandırma — sahte düzenleme butonu YOK: bu değerler .env'de
   yaşar ve deploy ile değişir. Panel yalnız şeffaflık sağlar. */
function DeliveryConfig() {
  const { data: info } = useDeliveryInfo();
  const { data: capacity } = useCapacityOverview();
  const cap = capacity?.[0]?.capacity;

  if (!info) return null;
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white ">
      <div className="border-b border-slate-100 px-6 py-4 ">
        <h2 className="text-base font-bold text-slate-900 ">Operasyon Yapılandırması</h2>
        <p className="mt-0.5 text-xs text-slate-500 ">
          Salt okunur — bu kurallar sunucu yapılandırmasında (.env) tanımlıdır, değişiklik dağıtım gerektirir.
        </p>
      </div>
      <ul className="divide-y divide-slate-100 px-6 ">
        <ConfigRow
          label="Aynı gün teslim eşiği"
          value={`${String(info.cutoff_hour).padStart(2, "0")}:00`}
          hint="bu saatten önce ödenen bölge içi sipariş aynı gün söz alır"
        />
        <ConfigRow
          label="Teslimat bölgesi"
          value={info.districts.join(", ")}
          hint="pin varsa depo yarıçapı önceliklidir"
        />
        {cap != null && (
          <ConfigRow
            label="Günlük söz kapasitesi"
            value={cap > 0 ? `${cap} sipariş` : "sınırsız"}
            hint={cap > 0 ? "dolan güne söz verilmez, sonraki güne kayar" : "kapasite kontrolü kapalı"}
          />
        )}
      </ul>
    </section>
  );
}

export default function DeliveryCouriersPage() {
  return (
    <div>
      <CourierManager />
      <ClosedDays />
      <DeliveryConfig />
    </div>
  );
}
