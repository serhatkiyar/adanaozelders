import { Link, useLocation, useParams } from "react-router-dom";
import { Avatar } from "@/components/Avatar";
import { Badge, ErrorState, PageSkeleton } from "@/components/admin/ui";
import { useAdminUser } from "@/hooks/useAdmin";
import { formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import type { AdminUserRolePath } from "@/types";

const VALID_ROLES = new Set<AdminUserRolePath>(["admin", "tutor", "client"]);

export default function AdminUserDetailPage() {
  const { role: rawRole, id: rawId } = useParams();
  const location = useLocation();
  const role = rawRole && VALID_ROLES.has(rawRole as AdminUserRolePath) ? (rawRole as AdminUserRolePath) : undefined;
  const id = Number(rawId);
  const query = useAdminUser(role, id);
  const backUrl = `${ROUTES.adminUsers}${location.search}`;

  if (!role || !Number.isInteger(id) || id <= 0) {
    return <ErrorState title="Geçersiz kullanıcı" description="Kullanıcı bağlantısı geçerli bir rol ve kimlik içermiyor." />;
  }
  if (query.isLoading) return <PageSkeleton rows={4} />;
  if (query.isError || !query.data) {
    return <ErrorState description={getErrorMessage(query.error, "Kullanıcı detayı yüklenemedi.")} onRetry={() => query.refetch()} />;
  }

  const user = query.data;
  const summary = [
    ["Rezervasyon", user.booking_count],
    ["Değerlendirme", user.review_count],
    ...(user.role === "CLIENT" ? [["Talep", user.demand_count], ["Sipariş", user.order_count]] as [string, number][] : []),
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-12">
      <Link to={backUrl} className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 transition hover:text-indigo-700 dark:text-indigo-400">
        <span aria-hidden="true">←</span> Kullanıcılara dön
      </Link>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar name={user.full_name} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-xl font-bold text-slate-950 dark:text-white">{user.full_name}</h2>
                <Badge tone={user.is_active ? "success" : "neutral"}>{user.is_active ? "Aktif" : "Pasif"}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">@{user.username}</p>
              <p className="mt-1 break-all text-sm text-slate-600 dark:text-slate-300">{user.email}</p>
            </div>
          </div>
          <Badge tone="info">{user.role === "ADMIN" ? "Yönetici" : user.role === "TUTOR" ? "Eğitmen" : "Öğrenci"}</Badge>
        </div>

        <dl className="mt-6 grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2 lg:grid-cols-4 dark:border-slate-800">
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">E-posta</dt><dd className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-200">{user.email_verified ? "Doğrulandı" : "Doğrulanmadı"}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Kayıt</dt><dd className="mt-1 text-sm text-slate-700 dark:text-slate-300">{formatDateTime(user.created_at)}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Son güncelleme</dt><dd className="mt-1 text-sm text-slate-700 dark:text-slate-300">{formatDateTime(user.updated_at)}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Son görülme</dt><dd className="mt-1 text-sm text-slate-700 dark:text-slate-300">{user.last_seen_at ? formatDateTime(user.last_seen_at) : "Henüz yok"}</dd></div>
          {user.tutor_status && <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">İlan durumu</dt><dd className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-200">{user.tutor_status}</dd></div>}
        </dl>
      </section>

      {summary.length > 0 && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {summary.map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
              <p className="mt-2 text-3xl font-bold text-slate-950 dark:text-white">{value}</p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
