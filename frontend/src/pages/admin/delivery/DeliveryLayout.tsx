// Dağıtım operasyon paneli kabuğu — URL-tabanlı alt sekmeler (AdminStore deseni)
// + deep-link'li tur detayı. Tek 8000px sayfa yerine 5 odaklı ekran:
//   Bugün (kokpit) · Siparişler (havuz) · Turlar (arşiv + :id detay) ·
//   Performans (KPI) · Kuryeler & Ayarlar.
// Erişim: delivery.view görüntüler, delivery.manage yönetir (AccessState).
import { NavLink, Outlet } from "react-router-dom";

import { AccessDenied, ReadOnlyNotice, useAdminAreaAccess } from "@/components/admin/AccessState";
import { ROUTES } from "@/lib/routes";

const TABS: { to: string; label: string; end?: boolean }[] = [
  { to: ROUTES.adminDelivery, label: "Bugün", end: true },
  { to: ROUTES.adminDeliveryOrders, label: "Siparişler" },
  { to: ROUTES.adminDeliveryRuns, label: "Turlar" },
  { to: ROUTES.adminDeliveryPerformance, label: "Performans" },
  { to: ROUTES.adminDeliveryCouriers, label: "Kuryeler" },
  { to: ROUTES.adminDeliveryBoard, label: "Tahta" },
  { to: ROUTES.adminDeliveryVehicles, label: "Araçlar" },
];

export default function DeliveryLayout() {
  const { canView, canManage } = useAdminAreaAccess("delivery");
  if (!canView) return <AccessDenied area="Dağıtım" />;

  return (
    <div>
      <nav aria-label="Dağıtım bölümleri" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                isActive
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      {!canManage && (
        <div className="mb-4">
          <ReadOnlyNotice />
        </div>
      )}
      <Outlet />
    </div>
  );
}
