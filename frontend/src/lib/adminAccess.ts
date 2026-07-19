// Admin-altı RBAC'in frontend yansıması (saf, Vitest'li).
// Kesin karar HER ZAMAN backend'dedir (require_admin_permission) — buradaki
// sonuç yalnız UI iyileştirmesidir: yetkisiz butonu hiç gösterme, deep-link'te
// dostane 403. `permissions` undefined ise (eski persist edilmiş oturum, /me
// henüz tazelenmedi) fail-open: her şeyi göster, backend reddederse hata görünür
// (AdminSidebar ile aynı sözleşme).

export interface AdminAreaAccess {
  canView: boolean;
  canManage: boolean;
}

export function adminAreaAccess(
  permissions: string[] | undefined,
  ...prefixes: string[]
): AdminAreaAccess {
  if (!permissions) return { canView: true, canManage: true };
  const canManage = prefixes.some((p) => permissions.includes(`${p}.manage`));
  return {
    // manage'i olup view'u olmayan rol tanımına karşı: manage görüntülemeyi ima eder.
    canView: canManage || prefixes.some((p) => permissions.includes(`${p}.view`)),
    canManage,
  };
}
