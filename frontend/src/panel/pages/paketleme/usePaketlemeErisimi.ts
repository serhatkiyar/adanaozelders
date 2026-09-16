// Paketleme ekranlarının üç kademeli izin okuması (view · pack · manage; birbirini ima etmez).
// Saf karar `lib/packing.ts::packingAccess`; kesin karar her zaman backend'de.
import { packingAccess, type PackingAccess } from "@/lib/packing";
import { useAuthStore } from "@/store/authStore";

export function usePaketlemeErisimi(): PackingAccess {
  const permissions = useAuthStore((state) => state.user?.admin_permissions);
  return packingAccess(permissions);
}
