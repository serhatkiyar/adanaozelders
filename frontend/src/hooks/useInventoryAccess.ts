// Envanterin üç kademeli iznini auth store'dan türetir.
//
// `useAdminAreaAccess` burada kullanılamaz: o `.view`/`.manage` ikilisini
// varsayar. Saf mantık ve fail-open sözleşmesi `lib/inventory.ts`'te
// (Vitest'li); bu dosya yalnız React bağlamasıdır.
import { inventoryAccess, type InventoryAccess } from "@/lib/inventory";
import { useAuthStore } from "@/store/authStore";

export function useInventoryAccess(): InventoryAccess {
  const permissions = useAuthStore((state) => state.user?.admin_permissions);
  return inventoryAccess(permissions);
}
