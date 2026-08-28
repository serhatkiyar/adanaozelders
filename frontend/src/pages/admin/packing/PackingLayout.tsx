// F30 paketleme istasyonu kabuğu — URL tabanlı alt sekmeler (Envanter/Dağıtım
// deseni: tek dev sayfa yerine odaklı ekranlar + deep-link'lenebilir paket).
//
// Paketlemenin izni ÜÇ kademelidir ve bu yüzden `useAdminAreaAccess`
// kullanılamaz (o `.view`/`.manage` ikilisini varsayar):
//   packing.view    → kuyruğu, paketleri ve geri dönüş kuyruğunu görür
//   packing.pack    → paket açar, okutur, geri alır, kapatır, açık paketi bozar
//   packing.manage  → depoya alır, yeniden paketler, "bozuldu" damgası vurur
//
// Saf karar `lib/packing.ts::packingAccess`'te (Vitest'li); burası yalnız React
// bağlamasıdır. Kesin karar HER ZAMAN backend'dedir — buradaki kapı sadece
// yapılamayacak işi vaat etmemek ve yetkisiz kullanıcı adına istek atmamak
// içindir (yetkisizken sorgular `enabled` ile hiç kurulmaz).
import { NavLink, Outlet } from "react-router-dom";

import { ReadOnlyNotice } from "@/components/admin/AccessState";
import { EmptyState } from "@/components/admin/ui";
import { packingAccess, type PackingAccess } from "@/lib/packing";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";

/**
 * Paketleme ekranlarının ortak izin okuması (`hooks/useInventoryAccess` muadili).
 *
 * Kabuğun içinde durur çünkü tüketicisi yalnız bu dört ekran; ayrı bir hook
 * dosyası bir çağrı noktası daha eklemeden dizini büyütürdü.
 */
export function usePackingAccess(): PackingAccess {
  const permissions = useAuthStore((state) => state.user?.admin_permissions);
  return packingAccess(permissions);
}

const TABS: { to: string; label: string; end?: boolean }[] = [
  { to: ROUTES.adminPacking, label: "Kuyruk", end: true },
  { to: ROUTES.adminPackingPackages, label: "Paketler" },
  { to: ROUTES.adminPackingReturns, label: "Geri dönüş" },
];

export default function PackingLayout() {
  const { canView, canPack, canManage } = usePackingAccess();

  if (!canView) {
    // Ortak `AccessState.AccessDenied` yerine `EmptyState`: reddin ekranda TEK
    // bir düğümde okunması gerekiyor (kabul sözleşmesi tek eşleşme arar),
    // AccessDenied ise "yetki"yi hem başlıkta hem açıklamada geçiriyor. Görsel
    // dil aynı bileşen ailesinden geldiği için panelde fark edilmez.
    return (
      <EmptyState
        title="Paketleme için yetkiniz yok"
        description="Bu bölümü görüntülemek için gereken izin rolünüzde tanımlı değil. Erişim gerekiyorsa rol tanımından sorumlu yöneticinizle görüşün."
      />
    );
  }

  return (
    <div>
      <nav aria-label="Paketleme bölümleri" className="mb-4 flex flex-wrap gap-2">
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
      {!canPack && !canManage && (
        <div className="mb-4">
          <ReadOnlyNotice />
        </div>
      )}
      <Outlet />
    </div>
  );
}
