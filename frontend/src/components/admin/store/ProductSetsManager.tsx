import { useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/admin/ui";
import { useDebounce } from "@/hooks/useDebounce";
import { useCategories, useProducts } from "@/hooks/useStore";
import {
  useMerchandisingMutations,
  useProductSets,
  useStoreAttributes,
} from "@/hooks/useStoreMerchandising";
import { toast } from "@/store/toastStore";
import type {
  ProductSearchOut,
  ProductSet,
  ProductSetInput,
  ProductSetRule,
} from "@/types";

const empty = (): ProductSetInput => ({
  name: "",
  description: "",
  is_active: true,
  revision: {
    match_mode: "ALL",
    rules: [{ field: "AVAILABLE", operator: "EQ", value: true }],
    pinned_product_ids: [],
    excluded_product_ids: [],
    sort_mode: "NEWEST",
    max_items: 12,
  },
});

export function ProductSetsManager() {
  const { data: rawSets, isLoading } = useProductSets();
  const { data: rawCategories } = useCategories();
  const { data: rawAttributes } = useStoreAttributes(true);
  const sets = Array.isArray(rawSets) ? rawSets : [];
  const categories = Array.isArray(rawCategories) ? rawCategories : [];
  const attributes = Array.isArray(rawAttributes) ? rawAttributes : [];
  const { saveProductSet, publishProductSet } = useMerchandisingMutations();
  const [editingId, setEditingId] = useState<number | undefined>();
  const [draft, setDraft] = useState<ProductSetInput>(empty);
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search, 250);
  const { data: products = [] } = useProducts(
    { q: debounced, limit: 16 },
    debounced.length >= 2,
  );

  const selectedCategory = useMemo(
    () =>
      draft.revision.rules.find((rule) => rule.field === "CATEGORY")
        ?.values[0] ?? "",
    [draft.revision.rules],
  );
  const selectedAttributes = useMemo(
    () =>
      new Set(
        draft.revision.rules
          .filter((rule) => rule.field === "ATTRIBUTE")
          .flatMap((rule) => rule.values),
      ),
    [draft.revision.rules],
  );

  const updateRules = (categoryId: number | null, valueIds: number[]) => {
    const retained = draft.revision.rules.filter(
      (rule) => !["CATEGORY", "ATTRIBUTE"].includes(rule.field),
    );
    const next: ProductSetRule[] = [...retained];
    if (categoryId)
      next.push({
        field: "CATEGORY",
        operator: "IN",
        values: [categoryId],
        include_descendants: true,
      });
    if (valueIds.length)
      next.push({ field: "ATTRIBUTE", operator: "IN", values: valueIds });
    setDraft((current) => ({
      ...current,
      revision: { ...current.revision, rules: next },
    }));
  };

  const edit = (set: ProductSet) => {
    setEditingId(set.id);
    setDraft({
      name: set.name,
      description: set.description,
      is_active: set.is_active,
      revision: {
        match_mode: set.revision.match_mode,
        rules: set.revision.rules,
        pinned_product_ids: set.revision.pinned_product_ids,
        excluded_product_ids: set.revision.excluded_product_ids,
        sort_mode: set.revision.sort_mode,
        max_items: set.revision.max_items,
      },
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await saveProductSet.mutateAsync({ payload: draft, id: editingId });
      toast.success(
        editingId
          ? "Koleksiyon taslağı kaydedildi"
          : "Koleksiyon oluşturuldu",
      );
      setEditingId(undefined);
      setDraft(empty());
    } catch {
      toast.error(
        "Koleksiyon kaydedilemedi. Alanları ve kuralları kontrol edin.",
      );
    }
  };

  const toggleProduct = (
    product: ProductSearchOut,
    target: "pin" | "exclude",
  ) => {
    setDraft((current) => {
      const key =
        target === "pin" ? "pinned_product_ids" : "excluded_product_ids";
      const opposite =
        target === "pin" ? "excluded_product_ids" : "pinned_product_ids";
      const selected = current.revision[key].includes(product.id);
      return {
        ...current,
        revision: {
          ...current.revision,
          [key]: selected
            ? current.revision[key].filter((id) => id !== product.id)
            : [...current.revision[key], product.id],
          [opposite]: current.revision[opposite].filter(
            (id) => id !== product.id,
          ),
        },
      };
    });
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_430px]">
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-panel-fg">
            Koleksiyonlar
          </h2>
          <p className="mt-1 text-sm text-panel-fg-muted">
            Vitrinlerde kullanılacak ürün akışlarını kurallarla veya sabit ürünlerle yönetin.
          </p>
        </div>
        {isLoading ? (
          <div className="h-40 animate-pulse rounded-xl bg-panel-muted" />
        ) : sets.length === 0 ? (
          <Empty />
        ) : (
          sets.map((set) => (
            <article
              key={set.id}
              className="rounded-xl border border-panel-border bg-panel-card p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-panel-fg">{set.name}</h3>
                    <span className="rounded-full bg-panel-muted px-2 py-0.5 text-xs text-panel-fg-muted">
                      v{set.revision.version} ·{" "}
                      {set.revision.status === "PUBLISHED"
                        ? "Yayında"
                        : "Taslak"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-panel-fg-muted">
                    {set.matched_count} eşleşen ürün · en fazla{" "}
                    {set.revision.max_items} gösterim
                  </p>
                </div>
                <div className="flex gap-2">
                  {set.revision.status === "DRAFT" && (
                    <Button
                      size="sm"
                      variant="success"
                      isPending={publishProductSet.isPending}
                      onClick={async () => {
                        try {
                          await publishProductSet.mutateAsync(set.id);
                          toast.success("Koleksiyon yayınlandı");
                        } catch {
                          toast.error("Koleksiyon yayınlanamadı.");
                        }
                      }}
                    >
                      Yayınla
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => edit(set)}>Düzenle</Button>
                </div>
              </div>
              {set.warnings.map((warning) => (
                <p
                  key={warning}
                  className="mt-3 text-xs text-amber-700 dark:text-amber-300"
                >
                  {warning}
                </p>
              ))}
              <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
                {set.preview_products.slice(0, 8).map((product) => (
                  <div key={product.id} className="w-20 shrink-0">
                    <div className="aspect-square overflow-hidden rounded-lg bg-panel-muted">
                      {product.cover_url && (
                        <img
                          src={product.cover_url}
                          alt=""
                          className="h-full w-full object-contain"
                        />
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] text-panel-fg-muted">
                      {product.title}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          ))
        )}
      </section>

      <form
        onSubmit={submit}
        className="h-fit space-y-5 rounded-xl border border-panel-border bg-panel-card p-5 xl:sticky xl:top-24"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-panel-fg">
            {editingId ? "Koleksiyonu düzenle" : "Yeni koleksiyon"}
          </h3>
          {editingId && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditingId(undefined);
                setDraft(empty());
              }}
            >
              Vazgeç
            </Button>
          )}
        </div>
        <Field label="Yönetim adı">
          <input
            className="input w-full"
            required
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
            placeholder="Örn. TYT Matematik Çok Satanlar"
          />
        </Field>
        <Field label="Açıklama">
          <input
            className="input w-full"
            value={draft.description}
            onChange={(event) =>
              setDraft({ ...draft, description: event.target.value })
            }
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kurallar">
            <select
              className="input w-full"
              value={draft.revision.match_mode}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  revision: {
                    ...draft.revision,
                    match_mode: event.target.value as "ALL" | "ANY",
                  },
                })
              }
            >
              <option value="ALL">Tümü eşleşsin</option>
              <option value="ANY">Herhangi biri</option>
            </select>
          </Field>
          <Field label="Sıralama">
            <select
              className="input w-full"
              value={draft.revision.sort_mode}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  revision: {
                    ...draft.revision,
                    sort_mode: event.target
                      .value as ProductSetInput["revision"]["sort_mode"],
                  },
                })
              }
            >
              <option value="NEWEST">En yeni</option>
              <option value="POPULAR">En çok satan</option>
              <option value="RATING">Puanı yüksek</option>
              <option value="PRICE_ASC">Fiyat artan</option>
              <option value="PRICE_DESC">Fiyat azalan</option>
              <option value="MANUAL">Sabit sıra</option>
            </select>
          </Field>
        </div>
        <Field label="Kategori">
          <select
            className="input w-full"
            value={selectedCategory}
            onChange={(event) =>
              updateRules(
                event.target.value ? Number(event.target.value) : null,
                [...selectedAttributes],
              )
            }
          >
            <option value="">Tüm kategoriler</option>
            {categories
              .filter((category) => category.is_active !== false)
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {category.parent_id ? "↳ " : ""}
                  {category.name}
                </option>
              ))}
          </select>
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-panel-fg">
            Yönetilen özellikler
          </legend>
          {attributes
            .filter((attribute) => attribute.is_active !== false && Array.isArray(attribute.values))
            .map((attribute) => (
              <div key={attribute.id}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-panel-fg-subtle">
                  {attribute.name}
                </p>
                <div className="flex flex-wrap gap-2">
                  {attribute.values
                    .filter((value) => value.is_active !== false)
                    .map((value) => (
                      <label
                        key={value.id}
                        className="flex items-center gap-1.5 rounded-full border border-panel-border px-2.5 py-1 text-xs text-panel-fg"
                      >
                        <input
                          type="checkbox"
                          checked={selectedAttributes.has(value.id)}
                          onChange={() => {
                            const next = new Set(selectedAttributes);
                            next.has(value.id)
                              ? next.delete(value.id)
                              : next.add(value.id);
                            updateRules(
                              selectedCategory
                                ? Number(selectedCategory)
                                : null,
                              [...next],
                            );
                          }}
                        />
                        {value.label}
                      </label>
                    ))}
                </div>
              </div>
            ))}
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Field label="En fazla ürün">
            <input
              type="number"
              min={1}
              max={48}
              className="input w-full"
              value={draft.revision.max_items}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  revision: {
                    ...draft.revision,
                    max_items: Number(event.target.value),
                  },
                })
              }
            />
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm text-panel-fg">
            <input
              type="checkbox"
              checked={draft.is_active}
              onChange={(event) =>
                setDraft({ ...draft, is_active: event.target.checked })
              }
            />
            Kullanıma açık
          </label>
        </div>
        <Field label="Ürün sabitle / hariç tut">
          <input
            className="input w-full"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="En az 2 harf ile ürün ara"
          />
        </Field>
        {products.length > 0 && (
          <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-panel-border p-2">
            {products.map((product) => (
              <div
                key={product.id}
                className="flex items-center gap-2 rounded-lg p-2 hover:bg-panel-muted"
              >
                <span className="min-w-0 flex-1 truncate text-xs text-panel-fg">
                  {product.title}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant={
                    draft.revision.pinned_product_ids.includes(product.id)
                      ? "primary"
                      : "secondary"
                  }
                  onClick={() => toggleProduct(product, "pin")}
                >
                  Sabitle
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={
                    draft.revision.excluded_product_ids.includes(product.id)
                      ? "danger"
                      : "ghost"
                  }
                  onClick={() => toggleProduct(product, "exclude")}
                >
                  Hariç
                </Button>
              </div>
            ))}
          </div>
        )}
        <Button
          type="submit"
          className="w-full"
          isPending={saveProductSet.isPending}
        >
          {editingId ? "Değişiklikleri kaydet" : "Koleksiyon oluştur"}
        </Button>
      </form>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1 text-sm font-medium text-panel-fg">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Empty() {
  return (
    <div className="rounded-xl border border-dashed border-panel-border p-10 text-center">
      <p className="font-medium text-panel-fg">Henüz koleksiyon yok</p>
      <p className="mt-1 text-sm text-panel-fg-muted">
        Sağdaki formdan ilk otomatik vitrini oluşturun.
      </p>
    </div>
  );
}
