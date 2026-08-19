/**
 * Mağaza "Kategoriler" sekmesi — İP-A5'te `AdminStore.tsx`ten AYNEN taşındı.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { AccessDenied, ReadOnlyNotice, useAdminAreaAccess } from "@/components/admin/AccessState";
import { ConfirmDialog, ErrorState } from "@/components/admin/ui";
import { createCategory, deleteCategory, updateCategory } from "@/api/store";
import { useCategories, useInvalidateAdminStore } from "@/hooks/useStore";
import { getErrorDetail } from "@/lib/errors";
import { orandanYuzde, yuzdedenOran } from "@/lib/tax";
import { toast } from "@/store/toastStore";

export function CategoriesPanel() {
  const { canView, canManage } = useAdminAreaAccess("products");
  const { data: categories, isError, error } = useCategories();
  const invalidate = useInvalidateAdminStore();
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: () => createCategory({ name }),
    onSuccess: () => {
      toast.success("Kategori eklendi");
      setName("");
      invalidate();
    },
  });
  const [deleting, setDeleting] = useState<{ id: number; name: string } | null>(null);
  const remove = useMutation({
    mutationFn: (id: number) => deleteCategory(id),
    onSuccess: () => {
      toast.success("Kategori silindi");
      setDeleting(null);
      invalidate();
    },
    onError: (err: unknown) => toast.error(getErrorDetail(err, "Kategori silinemedi")),
  });

  if (!canView) return <AccessDenied area="Kategoriler" />;
  if (isError) {
    return <ErrorState description={getErrorDetail(error, "Kategoriler yüklenemedi.")} />;
  }

  return (
    <div>
      {canManage ? (
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Kategori adı" className="input flex-1" />
          <button
            type="button"
            disabled={!name || create.isPending}
            onClick={() => create.mutate()}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
          >
            Ekle
          </button>
        </div>
      ) : (
        <ReadOnlyNotice />
      )}
      <div className="mt-4 space-y-2">
        {(categories ?? []).map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800">
            <span className="text-sm text-slate-700 dark:text-slate-300">
              {c.name} <span className="text-slate-400">({c.product_count ?? 0})</span>
            </span>
            <span className="flex items-center gap-3">
              <KategoriKdvRozeti category={c} canManage={canManage} onChange={invalidate} />
              {canManage && (
                <button type="button" onClick={() => setDeleting({ id: c.id, name: c.name })} className="text-xs font-medium text-rose-500 hover:underline">
                  Sil
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={deleting !== null}
        title="Kategoriyi sil"
        description={deleting ? `"${deleting.name}" kategorisi silinecek.` : ""}
        confirmLabel="Kategoriyi sil"
        danger
        isPending={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}

/** Kategori satırındaki varsayılan KDV göstergesi + satır içi düzenleme.
 *
 *  Oranlar mali müşavir onayı bekliyor — bu yüzey değerlerin GİRİLECEĞİ
 *  yerdir, kod hiçbir oran önermez. "miras" etiketi, kendi değeri boş olup
 *  atasından devralan kategoriyi ayırt eder (yanlışlıkla "burada tanımlı"
 *  sanılıp kökteki değer aranmasın).
 */
function KategoriKdvRozeti({
  category,
  canManage,
  onChange,
}: {
  category: import("@/types").ProductCategory;
  canManage: boolean;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [percent, setPercent] = useState(orandanYuzde(category.default_tax_rate));
  const save = useMutation({
    mutationFn: (default_tax_rate: string | null) =>
      updateCategory(category.id, { default_tax_rate }),
    onSuccess: () => {
      toast.success("Varsayılan KDV güncellendi");
      setEditing(false);
      onChange();
    },
    onError: (err: unknown) =>
      toast.error(getErrorDetail(err, "Varsayılan KDV güncellenemedi")),
  });

  const kendi = orandanYuzde(category.default_tax_rate);
  const efektif = orandanYuzde(category.effective_tax_rate);
  const etiket = kendi
    ? `KDV %${kendi}`
    : efektif
      ? `KDV %${efektif} (miras)`
      : "KDV —";

  if (!editing) {
    return (
      <span className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
        {etiket}
        {canManage && (
          <button
            type="button"
            onClick={() => {
              setPercent(kendi);
              setEditing(true);
            }}
            className="font-medium text-slate-600 hover:underline dark:text-slate-300"
          >
            Düzenle
          </button>
        )}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <input
        value={percent}
        onChange={(e) => setPercent(e.target.value)}
        placeholder="%"
        inputMode="decimal"
        aria-label={`${category.name} varsayılan KDV (%)`}
        className="input w-20 py-1 text-xs"
      />
      <button
        type="button"
        disabled={save.isPending}
        onClick={() => {
          if (!percent.trim()) {
            save.mutate(null); // boş bırakmak varsayılanı TEMİZLER
            return;
          }
          const oran = yuzdedenOran(percent);
          if (!oran.ok) {
            toast.error(oran.hata ?? "KDV oranı geçersiz");
            return;
          }
          save.mutate(oran.oran);
        }}
        className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
      >
        Kaydet
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
      >
        Vazgeç
      </button>
    </span>
  );
}
