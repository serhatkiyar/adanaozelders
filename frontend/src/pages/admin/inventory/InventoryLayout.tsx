// Envanter operasyon paneli kabuğu — URL-tabanlı alt sekmeler (Dağıtım deseni).
//
// Üç kademeli izin: `inventory.view` görür · `inventory.count` sayar ·
// `inventory.apply` uygular ve hasar işlemi yapar. Görev ayrılığı bilinçli:
// sayan kişi tek başına envanteri değiştiremez. Kesin karar backend'dedir;
// buradaki kapı yalnız yapılamayacak işi vaat etmemek içindir.
import { NavLink, Outlet } from "react-router-dom";

import { AccessDenied } from "@/components/admin/AccessState";
import { useInventoryAccess } from "@/hooks/useInventoryAccess";
import { ROUTES } from "@/lib/routes";

const TABS: { to: string; label: string; end?: boolean }[] = [
  { to: ROUTES.adminInventory, label: "Genel", end: true },
  { to: ROUTES.adminInventoryCounts, label: "Sayım oturumları" },
  { to: ROUTES.adminInventoryDamage, label: "Hasar olayları" },
  { to: ROUTES.adminInventoryMovements, label: "Hareketler" },
];

export default function InventoryLayout() {
  const { canView, canCount, canApply } = useInventoryAccess();
  if (!canView) return <AccessDenied area="Envanter" />;

  return (
    <div>
      <nav aria-label="Envanter bölümleri" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                isActive
                  ? "bg-slate-900 text-white "
                  : "text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 "
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      {!canCount && !canApply && (
        <p className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-500 ">
          Salt okunur görünüm: rolünüzde sayım ve hasar işlemi izni tanımlı değil.
        </p>
      )}
      <Outlet />
    </div>
  );
}
