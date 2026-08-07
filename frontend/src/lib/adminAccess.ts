// Admin-altı RBAC'in frontend yansıması (saf, Vitest'li).
//
// Kesin karar HER ZAMAN backend'dedir (`require_admin_permission`); buradaki
// sonuç yalnız UI kararıdır: yetkisiz butonu hiç gösterme, deep-link'te dostane
// 403.
//
// ## FAIL-CLOSED (İP-4/F-1) — bilinçli sözleşme değişikliği
//
// `permissions` `undefined` iken bu fonksiyon eskiden **fail-open**'dı: her şeyi
// göster, backend reddederse hata görünür. İki sebeple terk edildi:
//
// 1. Hata çoğu zaman GÖRÜNMÜYOR. `lib/queryClient.ts` 403'ü bildirimden muaf
//    tutuyor; yetkisiz bir yönetici yıkıcı butona basıp hiçbir şey olmadığını
//    görüyordu. "Karar backend'de" doğru ama kullanıcıya ulaşmıyordu.
// 2. Fail-closed'ın bedeli yok. `ProtectedRoute` admin ekranlarını `/auth/me`
//    çözülene kadar hiç render etmiyor ve `/auth/me` `admin_permissions`'ı HER
//    ZAMAN döndürüyor (`schemas/user.py` varsayılanı `[]`). `undefined` yalnız
//    eski persist edilmiş bir oturumda görülür — orada da doğru davranış
//    "aksiyonu gösterme"dir, "her şeyi aç" değil.

export interface AdminAreaAccess {
  canView: boolean;
  canManage: boolean;
}

export function adminAreaAccess(
  permissions: string[] | undefined,
  ...prefixes: string[]
): AdminAreaAccess {
  if (!permissions) return { canView: false, canManage: false };
  const canManage = prefixes.some((p) => permissions.includes(`${p}.manage`));
  return {
    // manage'i olup view'u olmayan rol tanımına karşı: manage görüntülemeyi ima eder.
    canView: canManage || prefixes.some((p) => permissions.includes(`${p}.view`)),
    canManage,
  };
}
