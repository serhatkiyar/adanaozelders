// Legacy admin ekranları için ortak erişim durumları (devir belgesi Öncelik 3):
// yetkisiz deep-link'te dostane 403, view-only rolde sakin salt-okunur şerit.
import { useAuthStore } from "@/store/authStore";
import { adminAreaAccess, type AdminAreaAccess } from "@/lib/adminAccess";

/** Ekranın alan izinlerini auth store'daki admin_permissions'tan türetir. */
export function useAdminAreaAccess(...prefixes: string[]): AdminAreaAccess {
  const permissions = useAuthStore((state) => state.user?.admin_permissions);
  return adminAreaAccess(permissions, ...prefixes);
}

/** Yetkisiz deep-link (view izni yok) — tam ekran 403 durumu. */
export function AccessDenied({ area }: { area: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-sm font-bold text-slate-900 dark:text-white">Bu alan için yetkiniz yok</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">
        {area} bölümünü görüntülemek için yönetici rolünüzde ilgili izin tanımlı değil.
        Erişim gerekiyorsa yetki yönetiminden sorumlu yöneticinizle görüşün.
      </p>
    </div>
  );
}

/** Salt-okunur bilgilendirme şeridi (view var, manage yok). */
export function ReadOnlyNotice() {
  return (
    <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
      Salt okunur görünüm — rolünüz bu bölümde değişiklik yapma izni içermiyor.
    </p>
  );
}
