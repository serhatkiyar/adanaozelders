/**
 * Mağaza "Kategoriler" sekmesi.
 *
 * ## İP-A6 · Görev 4a/4c/4d — göç
 *
 *   - "Kategori adı" alanı `placeholder` yerine gerçek etiket taşıyor.
 *   - "Ekle" düğmesi geçerlilik yüzünden KAPANMIYOR (kalıcı kural); boşken
 *     basılınca istek gitmez, hata alanın altında belirir ve odak alana döner.
 *   - Beş ham `<button>` ortak `Button`a geçti.
 *   - Silme onayının pencere durumu ekrandan `ui2/duzenlemeYuzeyi`ne taşındı.
 *
 * Değişmeyen: yetki kapıları, hata≠boş durum ayrımı, KDV rozetinin satır içi
 * düzenlemesi ve "boş bırakmak varsayılanı temizler" kuralı.
 */
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { AccessDenied, ReadOnlyNotice, useAdminAreaAccess } from "@/components/admin/AccessState";
import { Button, ConfirmDialog, ErrorState } from "@/components/admin/ui";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/yuzeyDurumu";
import { Form, sunucuHatasiniUygula } from "@/components/admin/ui2/form";
import { createCategory, deleteCategory, updateCategory } from "@/api/store";
import { useCategories, useInvalidateAdminStore } from "@/hooks/useStore";
import { getErrorDetail } from "@/lib/errors";
import { orandanYuzde, yuzdedenOran } from "@/lib/tax";
import { toast } from "@/store/toastStore";
import type { ProductCategoryWrite } from "@/types";

const kategoriSemasi = z.object({
  ad: z.string().trim().min(1, "Kategori adı zorunlu."),
});
type KategoriFormu = z.infer<typeof kategoriSemasi>;

export function CategoriesPanel() {
  const { canView, canManage } = useAdminAreaAccess("products");
  const { data: categories, isError, error } = useCategories();
  const invalidate = useInvalidateAdminStore();
  const [parentId, setParentId] = useState("");

  const form = useForm<KategoriFormu>({
    resolver: zodResolver(kategoriSemasi),
    defaultValues: { ad: "" },
    mode: "onChange",
    shouldFocusError: false,
  });

  const create = useMutation({
    mutationFn: (payload: ProductCategoryWrite) => createCategory(payload),
    onSuccess: () => {
      toast.success("Kategori eklendi");
      form.reset({ ad: "" });
      setParentId("");
      invalidate();
    },
  });

  // Sunucu hatası alana; alana düşmeyen kısım şeritte.
  const [genelHata, setGenelHata] = useState<string | null>(null);
  useEffect(() => {
    if (!create.error) {
      setGenelHata(null);
      return;
    }
    setGenelHata(
      sunucuHatasiniUygula(create.error, form, ["ad"], { name: "ad" }, (h) =>
        getErrorDetail(h, "Kategori eklenemedi")
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [create.error]);

  const gonder = form.handleSubmit(
    (degerler) => create.mutate({ name: degerler.ad.trim(), parent_id: parentId ? Number(parentId) : null, is_active: true }),
    () => form.setFocus("ad")
  );

  // Pencere durumu EKRANDA yaşamaz (İP-A4 sözleşmesi).
  const silmeYuzeyi = useDuzenlemeYuzeyi<{ id: number; name: string }>();
  const remove = useMutation({
    mutationFn: (id: number) => deleteCategory(id),
    onSuccess: () => {
      toast.success("Kategori silindi");
      silmeYuzeyi.kapat();
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
        <div>
          <div className="grid items-end gap-2 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.6fr)_auto]">
            <Form.Field
              control={form.control}
              name="ad"
              render={({ field }) => (
                <Form.Item className="flex-1">
                  <Form.Label>Kategori adı</Form.Label>
                  <Form.Control>
                    <input className="input w-full" {...field} />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            <label className="block space-y-1 text-sm font-medium text-panel-fg">
              <span>Üst kategori</span>
              <select className="input w-full" value={parentId} onChange={(event) => setParentId(event.target.value)}>
                <option value="">Ana kategori</option>
                {(categories ?? []).filter((category) => category.is_active).map((category) => <option key={category.id} value={category.id}>{category.parent_id ? "↳ " : ""}{category.name}</option>)}
              </select>
            </label>
            {/* Etiket yüksekliği kadar aşağı: alan ile düğme aynı satırda
                hizalansın (etiket alanın ÜSTÜNDE). */}
            <Button isPending={create.isPending} onClick={gonder}>
              Ekle
            </Button>
          </div>
          {genelHata && (
            <p
              role="alert"
              className="mt-1 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100"
            >
              {genelHata}
            </p>
          )}
        </div>
      ) : (
        <ReadOnlyNotice />
      )}
      <div className="mt-4 space-y-2">
        {(categories ?? []).map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800">
            <span className={`text-sm text-slate-700 dark:text-slate-300 ${!c.is_active ? "opacity-50" : ""}`} style={{ paddingLeft: `${categoryDepth(c, categories ?? []) * 18}px` }}>
              {c.parent_id ? "↳ " : ""}{c.name} <span className="text-slate-400">({c.product_count ?? 0})</span>
            </span>
            <span className="flex items-center gap-3">
              {canManage && <CategoryActiveToggle category={c} onChange={invalidate} />}
              <KategoriKdvRozeti category={c} canManage={canManage} onChange={invalidate} />
              {canManage && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => silmeYuzeyi.ac({ id: c.id, name: c.name })}
                >
                  Sil
                </Button>
              )}
            </span>
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={silmeYuzeyi.acik}
        title="Kategoriyi sil"
        description={silmeYuzeyi.kayit ? `"${silmeYuzeyi.kayit.name}" kategorisi silinecek.` : ""}
        confirmLabel="Kategoriyi sil"
        danger
        isPending={remove.isPending}
        onClose={silmeYuzeyi.kapat}
        onConfirm={() => silmeYuzeyi.kayit && remove.mutate(silmeYuzeyi.kayit.id)}
      />
    </div>
  );
}

function categoryDepth(category: import("@/types").ProductCategory, categories: import("@/types").ProductCategory[]): number {
  const byId = new Map(categories.map((item) => [item.id, item]));
  let depth = 0; let current = category; const seen = new Set<number>();
  while (current.parent_id && !seen.has(current.id) && depth < 4) { seen.add(current.id); const parent = byId.get(current.parent_id); if (!parent) break; depth += 1; current = parent; }
  return depth;
}

function CategoryActiveToggle({ category, onChange }: { category: import("@/types").ProductCategory; onChange: () => void }) {
  const mutation = useMutation({ mutationFn: () => updateCategory(category.id, { is_active: !category.is_active }), onSuccess: () => { toast.success(category.is_active ? "Kategori pasife alındı" : "Kategori açıldı"); onChange(); }, onError: (error: unknown) => toast.error(getErrorDetail(error, "Kategori durumu değiştirilemedi")) });
  return <Button size="sm" variant="ghost" isPending={mutation.isPending} onClick={() => mutation.mutate()}>{category.is_active ? "Pasife al" : "Etkinleştir"}</Button>;
}

/** Kategori satırındaki varsayılan KDV göstergesi + satır içi düzenleme.
 *
 *  Oranlar mali müşavir onayı bekliyor — bu yüzey değerlerin GİRİLECEĞİ
 *  yerdir, kod hiçbir oran önermez. "miras" etiketi, kendi değeri boş olup
 *  atasından devralan kategoriyi ayırt eder (yanlışlıkla "burada tanımlı"
 *  sanılıp kökteki değer aranmasın).
 *
 *  `editing` bir PENCERE durumu değildir: satır içinde iki gösterim arasında
 *  geçiş yapar, hiçbir katman açmaz. Bu yüzden düzenleme yüzeyine taşınmadı.
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
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setPercent(kendi);
              setEditing(true);
            }}
          >
            Düzenle
          </Button>
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
      <Button
        size="sm"
        variant="ghost"
        isPending={save.isPending}
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
      >
        Kaydet
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Vazgeç
      </Button>
    </span>
  );
}
