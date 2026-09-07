import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Avatar } from "@/components/Avatar";
import { Badge, ErrorState, PageSkeleton } from "@/components/admin/ui";
import { Button } from "@/components/admin/ui/Button";
import { deleteAdminUser } from "@/api/admin";
import { useAdminUser } from "@/hooks/useAdmin";
import { adminAreaAccess } from "@/lib/adminAccess";
import { formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/store/toastStore";
import type { AdminUserRolePath } from "@/types";
import { rolEtiketi } from "@/lib/roles";
import { ROLE_IDS } from "@/types";

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
      <Link to={backUrl} className="inline-flex items-center gap-2 text-sm font-semibold text-panel-accent-text transition hover:opacity-80">
        <span aria-hidden="true">←</span> Kullanıcılara dön
      </Link>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar name={user.full_name} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-xl font-bold text-slate-950 ">{user.full_name}</h2>
                <Badge tone={user.is_active ? "success" : "neutral"}>{user.is_active ? "Aktif" : "Pasif"}</Badge>
              </div>
              <p className="mt-1 break-all text-sm text-slate-600 ">{user.email}</p>
            </div>
          </div>
          <Badge tone="info">{rolEtiketi(ROLE_IDS[user.role])}</Badge>
        </div>

        <dl className="mt-6 grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2 lg:grid-cols-4 ">
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">E-posta</dt><dd className="mt-1 text-sm font-semibold text-slate-800 ">{user.email_verified ? "Doğrulandı" : "Doğrulanmadı"}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Kayıt</dt><dd className="mt-1 text-sm text-slate-700 ">{formatDateTime(user.created_at)}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Son güncelleme</dt><dd className="mt-1 text-sm text-slate-700 ">{formatDateTime(user.updated_at)}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Son görülme</dt><dd className="mt-1 text-sm text-slate-700 ">{user.last_seen_at ? formatDateTime(user.last_seen_at) : "Henüz yok"}</dd></div>
          {user.tutor_status && <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">İlan durumu</dt><dd className="mt-1 text-sm font-semibold text-slate-800 ">{user.tutor_status}</dd></div>}
        </dl>
      </section>

      {summary.length > 0 && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {summary.map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
              <p className="mt-2 text-3xl font-bold text-slate-950 ">{value}</p>
            </div>
          ))}
        </section>
      )}

      {(role === "tutor" || role === "client") && (
        <HesapSilmeBolumu role={role} userId={id} fullName={user.full_name} backUrl={backUrl} />
      )}
    </div>
  );
}

/** Tehlikeli bölge: hesabı anonimleştirip kapatma (users.manage; 30 Ağu).
 *  Backend kullanıcının kendi silme akışıyla aynı korumaları uygular — açık
 *  para taahhüdü (emanet ödeme, yoldaki kargo, bekleyen iade) varsa 409 döner
 *  ve gerekçe burada gösterilir. */
function HesapSilmeBolumu({
  role,
  userId,
  fullName,
  backUrl,
}: {
  role: "tutor" | "client";
  userId: number;
  fullName: string;
  backUrl: string;
}) {
  const permissions = useAuthStore((s) => s.user?.admin_permissions);
  const [acik, setAcik] = useState(false);
  const [gerekce, setGerekce] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();

  const sil = useMutation({
    mutationFn: () => deleteAdminUser({ role, user_id: userId, reason: gerekce.trim() }),
    onSuccess: () => {
      toast.success(`${fullName} hesabı anonimleştirilip kapatıldı.`);
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      navigate(backUrl);
    },
    onError: (err) => toast.error(getErrorMessage(err, "Hesap silinemedi.")),
  });

  if (!adminAreaAccess(permissions, "users").canManage) return null;

  return (
    <section className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm sm:p-6">
      <h3 className="text-sm font-bold text-rose-700">Hesabı sil</h3>
      <p className="mt-1 text-sm text-slate-600">
        Kimlik ve iletişim verisi geri döndürülemez biçimde anonimleştirilir,
        hesap kapatılır. Mali kayıtlar mevzuat gereği durur; açık siparişi,
        dersi veya bekleyen ödemesi olan hesap silinemez.
      </p>
      {!acik ? (
        <Button variant="secondary" className="mt-4" onClick={() => setAcik(true)}>
          Hesabı silmek istiyorum
        </Button>
      ) : (
        <div className="mt-4 space-y-3">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Gerekçe (denetim kaydına yazılır)
            <textarea
              value={gerekce}
              onChange={(e) => setGerekce(e.target.value)}
              rows={2}
              minLength={3}
              className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-800 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
              placeholder="Örn. kullanıcının KVKK silme talebi (destek kaydı #123)"
            />
          </label>
          <div className="flex items-center gap-2">
            {/* Gerekçe uzunluğu disabled'a BAĞLANMAZ (gönder düğmesi sözleşmesi):
                kısa gerekçede tıklama açıklayıcı hata verir, düğme kilitlenmez. */}
            <Button
              variant="danger"
              isPending={sil.isPending}
              onClick={() => {
                if (gerekce.trim().length < 3) {
                  toast.error("Gerekçe en az 3 karakter olmalı (denetim kaydına yazılır).");
                  return;
                }
                sil.mutate();
              }}
            >
              Kalıcı olarak sil
            </Button>
            <Button variant="ghost" onClick={() => setAcik(false)}>
              Vazgeç
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
