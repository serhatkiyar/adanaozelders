import { useState, type FormEvent } from "react";

import { Button } from "@/components/admin/ui";
import {
  useMerchandisingMutations,
  useStoreAttributes,
} from "@/hooks/useStoreMerchandising";
import { toast } from "@/store/toastStore";

export function StoreAttributesManager() {
  const { data: rawAttributes, isLoading } = useStoreAttributes(true);
  const attributes = Array.isArray(rawAttributes) ? rawAttributes : [];
  const { createAttribute, createAttributeValue } = useMerchandisingMutations();
  const [name, setName] = useState("");
  const [values, setValues] = useState<Record<number, string>>({});
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await createAttribute.mutateAsync({
        name,
        sort_order: attributes.length * 10,
        is_active: true,
      });
      setName("");
      toast.success("Ürün özelliği oluşturuldu");
    } catch {
      toast.error("Ürün özelliği oluşturulamadı");
    }
  };
  return (
    <section className="mt-8 border-t border-panel-border pt-8">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-panel-fg">
          Yönetilen ürün özellikleri
        </h2>
        <p className="mt-1 text-sm text-panel-fg-muted">
          TYT/AYT, ders, sınıf ve kitap türü gibi bilgiler başlıktan tahmin
          edilmez; buradaki kontrollü değerlerden seçilir.
        </p>
      </div>
      <form onSubmit={submit} className="mb-5 flex max-w-xl gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Yeni özellik adı</span>
          <input
            required
            className="input w-full"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Yeni özellik adı"
          />
        </label>
        <Button type="submit" isPending={createAttribute.isPending}>
          Özellik ekle
        </Button>
      </form>
      {isLoading ? (
        <div className="h-24 animate-pulse rounded-xl bg-panel-muted" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {attributes.map((attribute) => (
            <article
              key={attribute.id}
              className="rounded-xl border border-panel-border bg-panel-card p-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-panel-fg">
                  {attribute.name}
                </h3>
                <span className="text-xs text-panel-fg-subtle">
                  {(attribute.values ?? []).length} değer
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(attribute.values ?? []).map((value) => (
                  <span
                    key={value.id}
                    className="rounded-full bg-panel-muted px-2.5 py-1 text-xs text-panel-fg"
                  >
                    {value.label}
                  </span>
                ))}
              </div>
              <form
                className="mt-4 flex gap-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const label = values[attribute.id]?.trim();
                  if (!label) return;
                  try {
                    await createAttributeValue.mutateAsync({
                      definitionId: attribute.id,
                      label,
                      sort_order: (attribute.values ?? []).length * 10,
                      is_active: true,
                    });
                    setValues((current) => ({
                      ...current,
                      [attribute.id]: "",
                    }));
                    toast.success("Değer eklendi");
                  } catch {
                    toast.error("Değer eklenemedi");
                  }
                }}
              >
                <label className="min-w-0 flex-1">
                  <span className="sr-only">{attribute.name} için yeni değer</span>
                  <input
                    className="input w-full"
                    value={values[attribute.id] ?? ""}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [attribute.id]: event.target.value,
                      }))
                    }
                    placeholder="Örn. TYT"
                  />
                </label>
                <Button type="submit" size="sm" variant="secondary">
                  Ekle
                </Button>
              </form>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
