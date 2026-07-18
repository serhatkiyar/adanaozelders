import { useMemo, useState, type FormEvent } from "react";
import { Badge, Button, Dialog, ErrorState, PageSkeleton } from "@/components/admin/ui";
import {
  useAdminPermissions,
  useAdminRoleAssignments,
  useAdminRoles,
  useAssignAdminRole,
  useCreateAdminRole,
  useUpdateAdminRole,
} from "@/hooks/useAdmin";
import { getErrorMessage } from "@/lib/errors";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/store/toastStore";
import type { AdminRoleOut } from "@/types";

interface RoleDraft {
  id?: number;
  code: string;
  name: string;
  description: string;
  permissionCodes: string[];
}

const EMPTY_DRAFT: RoleDraft = {
  code: "",
  name: "",
  description: "",
  permissionCodes: [],
};

export default function AdminAccessPage() {
  const permissionsQuery = useAdminPermissions();
  const rolesQuery = useAdminRoles();
  const assignmentsQuery = useAdminRoleAssignments();
  const createRole = useCreateAdminRole();
  const updateRole = useUpdateAdminRole();
  const assignRole = useAssignAdminRole();
  const canManage = useAuthStore((state) => state.user?.admin_permissions?.includes("admin_roles.manage")) ?? false;
  const [draft, setDraft] = useState<RoleDraft | null>(null);

  const permissionGroups = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof permissionsQuery.data>>();
    for (const permission of permissionsQuery.data ?? []) {
      const current = groups.get(permission.group) ?? [];
      current.push(permission);
      groups.set(permission.group, current);
    }
    return [...groups.entries()];
  }, [permissionsQuery.data]);

  const openRole = (role?: AdminRoleOut) => {
    setDraft(role ? {
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description ?? "",
      permissionCodes: role.permission_codes,
    } : { ...EMPTY_DRAFT, permissionCodes: [] });
  };

  const togglePermission = (code: string) => setDraft((current) => {
    if (!current) return current;
    const selected = current.permissionCodes.includes(code);
    return {
      ...current,
      permissionCodes: selected
        ? current.permissionCodes.filter((item) => item !== code)
        : [...current.permissionCodes, code],
    };
  });

  const submitRole = (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      permission_codes: draft.permissionCodes,
    };
    const options = {
      onSuccess: () => {
        toast.success(draft.id ? "Yönetici rolü güncellendi." : "Yönetici rolü oluşturuldu.");
        setDraft(null);
      },
      onError: (error: unknown) => toast.error(getErrorMessage(error, "Rol kaydedilemedi.")),
    };
    if (draft.id) {
      updateRole.mutate({ id: draft.id, payload }, options);
    } else {
      createRole.mutate({ ...payload, code: draft.code.trim().toUpperCase() }, options);
    }
  };

  const changeAssignment = (adminId: number, roleId: number) => {
    assignRole.mutate(
      { adminId, roleId },
      {
        onSuccess: () => toast.success("Yönetici rolü atandı."),
        onError: (error) => toast.error(getErrorMessage(error, "Rol atanamadı.")),
      }
    );
  };

  if (permissionsQuery.isLoading || rolesQuery.isLoading || assignmentsQuery.isLoading) {
    return <PageSkeleton rows={5} />;
  }
  const error = permissionsQuery.error ?? rolesQuery.error ?? assignmentsQuery.error;
  if (error) {
    return <ErrorState description={getErrorMessage(error, "Yetki bilgileri yüklenemedi.")} onRetry={() => {
      permissionsQuery.refetch();
      rolesQuery.refetch();
      assignmentsQuery.refetch();
    }} />;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950 dark:text-white">Yönetici rolleri</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Her yönetici tek bir görev rolüne atanır. Kesin izin kontrolü API tarafında uygulanır.</p>
          </div>
          {canManage && <Button onClick={() => openRole()}>Yeni rol</Button>}
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {(rolesQuery.data ?? []).map((role) => (
            <article key={role.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-slate-900 dark:text-white">{role.name}</h3>
                    {role.is_system && <Badge tone="info">Sistem</Badge>}
                  </div>
                  <p className="mt-1 font-mono text-xs text-slate-500">{role.code}</p>
                </div>
                {canManage && role.code !== "SUPER_ADMIN" && <Button size="sm" variant="secondary" onClick={() => openRole(role)}>Düzenle</Button>}
              </div>
              {role.description && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{role.description}</p>}
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Badge tone="neutral">{role.permission_codes.length} izin</Badge>
                <Badge tone="neutral">{role.assignment_count} yönetici</Badge>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-bold text-slate-950 dark:text-white">Yönetici atamaları</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Son Super Admin başka bir role indirilemez.</p>
        <div className="mt-5 divide-y divide-slate-100 dark:divide-slate-800">
          {(assignmentsQuery.data ?? []).map((assignment) => (
            <div key={assignment.admin_id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">{assignment.admin_name}</p>
                <p className="text-xs text-slate-500">{assignment.admin_email}</p>
              </div>
              <label className="sm:w-72">
                <span className="sr-only">{assignment.admin_name} için yönetici rolü</span>
                <select
                  className="input"
                  value={assignment.role_id ?? ""}
                  disabled={!canManage || assignRole.isPending}
                  onChange={(event) => changeAssignment(assignment.admin_id, Number(event.target.value))}
                >
                  {!assignment.role_id && <option value="" disabled>Rol seçin</option>}
                  {(rolesQuery.data ?? []).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
              </label>
            </div>
          ))}
        </div>
      </section>

      <Dialog
        open={draft !== null}
        onClose={() => !(createRole.isPending || updateRole.isPending) && setDraft(null)}
        title={draft?.id ? "Yönetici rolünü düzenle" : "Yeni yönetici rolü"}
        description="İzinler en az yetki ilkesine göre seçilmelidir."
      >
        {draft && (
          <form onSubmit={submitRole}>
            {!draft.id && (
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">Rol kodu</span>
                <input className="input" required minLength={3} maxLength={50} pattern="[A-Z][A-Z0-9_]*" value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} placeholder="ICERIK_EDITORU" />
              </label>
            )}
            <label className="mt-4 block">
              <span className="mb-1.5 block text-sm font-semibold">Rol adı</span>
              <input className="input" required minLength={2} maxLength={100} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-sm font-semibold">Açıklama</span>
              <textarea className="input min-h-20 resize-y" maxLength={500} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
            </label>
            <div className="mt-5 space-y-4">
              {permissionGroups.map(([group, permissions]) => (
                <fieldset key={group}>
                  <legend className="text-sm font-bold text-slate-800 dark:text-slate-100">{group}</legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {permissions.map((permission) => (
                      <label key={permission.code} className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-indigo-600" checked={draft.permissionCodes.includes(permission.code)} onChange={() => togglePermission(permission.code)} />
                        <span><span className="block font-semibold">{permission.name}</span><span className="font-mono text-[10px] text-slate-500">{permission.code}</span></span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDraft(null)} disabled={createRole.isPending || updateRole.isPending}>Vazgeç</Button>
              <Button type="submit" isPending={createRole.isPending || updateRole.isPending}>Kaydet</Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
