/**
 * Mağaza "Kuponlar" sekmesi — İP-A5'te `AdminStore.tsx`ten AYNEN taşındı.
 */
import { useState } from "react";

import { AccessDenied, ReadOnlyNotice, useAdminAreaAccess } from "@/components/admin/AccessState";
import { ConfirmDialog, ErrorState } from "@/components/admin/ui";
import {
  useCoupons,
  useCreateCoupon,
  useDeleteCoupon,
  useUpdateCoupon,
} from "@/hooks/useStore";
import { getErrorDetail } from "@/lib/errors";
import { formatTL } from "@/lib/money";
import { toast } from "@/store/toastStore";
import type { CouponCreate, CouponDiscountType } from "@/types";

const EMPTY_COUPON: CouponCreate = {
  code: "",
  discount_type: "PERCENT",
  discount_value: 10,
  min_subtotal: 0,
  max_uses: null,
  per_user_limit: 1,
  is_active: true,
};

export function CouponsPanel() {
  const { canView, canManage } = useAdminAreaAccess("coupons");
  const { data: coupons, isLoading, isError, error, refetch } = useCoupons();
  const create = useCreateCoupon();
  const update = useUpdateCoupon();
  const del = useDeleteCoupon();
  const [form, setForm] = useState<CouponCreate>(EMPTY_COUPON);
  const [deleting, setDeleting] = useState<{ id: number; code: string } | null>(null);

  function submit() {
    if (!form.code.trim()) {
      toast.error("Kod gir");
      return;
    }
    create.mutate(
      { ...form, code: form.code.trim().toUpperCase() },
      {
        onSuccess: () => {
          toast.success("Kupon oluşturuldu");
          setForm(EMPTY_COUPON);
        },
        onError: (err: unknown) => {
          const detail =
            (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
            "Kupon oluşturulamadı";
          toast.error(detail);
        },
      }
    );
  }

  const inputCls =
    "rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white";

  if (!canView) return <AccessDenied area="Kuponlar" />;
  if (isError) {
    return (
      <ErrorState
        description={getErrorDetail(error, "Kuponlar yüklenemedi.")}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      {!canManage && <ReadOnlyNotice />}
      {/* Oluştur */}
      {canManage && (
      <div className="rounded-2xl border border-slate-100 p-4 dark:border-slate-800">
        <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Yeni kupon</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <input
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            placeholder="KOD"
            className={`${inputCls} uppercase`}
          />
          <select
            value={form.discount_type}
            onChange={(e) => setForm({ ...form, discount_type: e.target.value as CouponDiscountType })}
            className={inputCls}
          >
            <option value="PERCENT">Yüzde %</option>
            <option value="FIXED">Sabit TL</option>
          </select>
          <input
            type="number"
            value={form.discount_value}
            onChange={(e) => setForm({ ...form, discount_value: Number(e.target.value) })}
            placeholder="Değer"
            className={inputCls}
          />
          <input
            type="number"
            value={form.min_subtotal ?? 0}
            onChange={(e) => setForm({ ...form, min_subtotal: Number(e.target.value) })}
            placeholder="Min sepet"
            className={inputCls}
          />
          <input
            type="number"
            value={form.max_uses ?? ""}
            onChange={(e) => setForm({ ...form, max_uses: e.target.value ? Number(e.target.value) : null })}
            placeholder="Maks kullanım"
            className={inputCls}
          />
          <input
            type="number"
            value={form.per_user_limit ?? ""}
            onChange={(e) => setForm({ ...form, per_user_limit: e.target.value ? Number(e.target.value) : null })}
            placeholder="Kişi başı"
            className={inputCls}
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={create.isPending}
          className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Kupon oluştur
        </button>
      </div>
      )}

      {/* Liste */}
      {isLoading ? (
        <p className="text-sm text-slate-400">Yükleniyor…</p>
      ) : !coupons || coupons.length === 0 ? (
        <p className="text-sm text-slate-400">Henüz kupon yok.</p>
      ) : (
        <div className="space-y-2">
          {coupons.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-3 dark:border-slate-800"
            >
              <div className="text-sm">
                <span className="font-semibold text-slate-900 dark:text-white">{c.code}</span>
                <span className="ml-2 text-slate-500">
                  {c.discount_type === "PERCENT" ? `%${c.discount_value}` : formatTL(c.discount_value)} indirim
                </span>
                <span className="ml-2 text-xs text-slate-400">
                  min {formatTL(c.min_subtotal)} · kullanım {c.used_count}
                  {c.max_uses ? `/${c.max_uses}` : ""}
                </span>
              </div>
              {canManage && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => update.mutate({ id: c.id, payload: { is_active: !c.is_active } })}
                    className={`rounded-lg px-3 py-1 text-xs font-medium ${
                      c.is_active
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                        : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                    }`}
                  >
                    {c.is_active ? "Aktif" : "Pasif"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting({ id: c.id, code: c.code })}
                    className="rounded-lg px-3 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                  >
                    Sil
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Kuponu sil"
        description={deleting ? `${deleting.code} kuponu silinecek.` : ""}
        confirmLabel="Kuponu sil"
        danger
        isPending={del.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
      />
    </div>
  );
}
