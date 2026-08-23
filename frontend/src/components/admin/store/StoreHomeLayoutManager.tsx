import { useEffect, useState, type FormEvent } from "react";

import { Badge, Button, ErrorState } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { useDebounce } from "@/hooks/useDebounce";
import { useProducts } from "@/hooks/useStore";
import {
  useAdminStoreHome,
  useCreateStoreHomeImageSection,
  useCreateStoreHomeProductSection,
  useDeleteStoreHomeSection,
  useReorderStoreHomeSections,
  useUpdateStoreHomeImageSection,
  useUpdateStoreHomeProductSection,
  useUpdateStoreHomeRecentlyViewedSection,
} from "@/hooks/useStoreHome";
import { getErrorDetail } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type {
  ProductSearchOut,
  StoreHomeImageSectionInput,
  StoreHomeProductSectionInput,
  StoreHomeSection,
  StoreHomeSectionMetaInput,
  StoreHomeSectionType,
} from "@/types";

type ImageDraft = {
  existingIndex: number | null;
  imageUrl: string | null;
  file: File | null;
  label: string;
  altText: string;
  linkUrl: string;
};

type CreatableSectionType = Exclude<StoreHomeSectionType, "RECENTLY_VIEWED">;

const emptyImage = (): ImageDraft => ({
  existingIndex: null,
  imageUrl: null,
  file: null,
  label: "",
  altText: "",
  linkUrl: "/magaza",
});

export function StoreHomeLayoutManager({ canManage }: { canManage: boolean }) {
  const { data: sections = [], isLoading, isError, error, refetch } = useAdminStoreHome();
  const reorder = useReorderStoreHomeSections();
  const updateRecentlyViewed = useUpdateStoreHomeRecentlyViewedSection();
  const remove = useDeleteStoreHomeSection();
  const [creating, setCreating] = useState<CreatableSectionType | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const deleteDialog = useDuzenlemeYuzeyi<StoreHomeSection, void>();
  const nextSortOrder = sections.length
    ? Math.max(...sections.map((section) => section.sort_order)) + 10
    : 0;

  if (isError) {
    return <ErrorState description={getErrorDetail(error, "Ana sayfa akışı yüklenemedi.")} onRetry={() => void refetch()} />;
  }

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    const ids = sections.map((section) => section.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate(ids, {
      onSuccess: () => toast.success("Bölüm sırası güncellendi"),
      onError: (err) => toast.error(getErrorDetail(err, "Bölüm sırası güncellenemedi")),
    });
  };

  return (
    <section className="space-y-5 border-t border-panel-border pt-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-panel-fg text-xs font-bold text-panel-card">3</span>
            <h2 className="text-base font-semibold text-panel-fg">Mağaza ana sayfa akışı</h2>
          </div>
          <p className="max-w-3xl text-sm text-panel-fg-muted">
            Büyük görselin altındaki sıralamayı buradan kurun. “Romanlar” gibi ürün şeritleriyle kendi görsel bloklarınızı istediğiniz sırada karıştırabilirsiniz.
          </p>
        </div>
        {canManage && (
          <Button
            size="sm"
            onClick={() => {
              setCreating((value) => value ? null : "PRODUCT_RAIL");
              setEditingId(null);
            }}
          >
            {creating ? "Ekleme alanını kapat" : "Yeni bölüm ekle"}
          </Button>
        )}
      </div>

      {canManage && creating && (
        <div className="rounded-2xl border border-panel-border bg-panel-muted/40 p-4 sm:p-5">
          <TypePicker value={creating} onChange={setCreating} />
          <div className="mt-5">
            {creating === "PRODUCT_RAIL" ? (
              <CreateProductSection sortOrder={nextSortOrder} onCreated={() => setCreating(null)} />
            ) : (
              <CreateImageSection sortOrder={nextSortOrder} onCreated={() => setCreating(null)} />
            )}
          </div>
        </div>
      )}

      {sections.length === 0 && !isLoading && (
        <div className="rounded-2xl border border-dashed border-panel-border px-6 py-9 text-center">
          <p className="font-semibold text-panel-fg">Henüz özel akış kurulmadı</p>
          <p className="mx-auto mt-1 max-w-xl text-sm text-panel-fg-muted">
            Şu anda mağaza mevcut otomatik ürün şeritlerini gösteriyor. İlk bölümü yayına aldığınız anda bu liste ana sayfanın akışını yönetmeye başlar.
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((id) => <div key={id} className="h-20 animate-pulse rounded-xl bg-panel-muted" />)}
        </div>
      ) : (
        <div className="divide-y divide-panel-border border-y border-panel-border">
          {sections.map((section, index) => {
            const editing = editingId === section.id;
            return (
              <article key={section.id} className="py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-panel-muted text-sm font-semibold text-panel-fg-muted">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-semibold text-panel-fg">{section.title}</p>
                        <Badge tone={section.is_active ? "success" : "neutral"}>{section.is_active ? "Yayında" : "Taslak"}</Badge>
                      </div>
                      <p className="text-xs text-panel-fg-muted">
                        {section.section_type === "PRODUCT_RAIL"
                          ? `Ürün şeridi · ${section.products.length} ürün`
                          : section.section_type === "IMAGE_GRID"
                            ? `Görsel blok · ${section.image_tiles.length} görsel`
                            : "Kişisel vitrin · Ürünler ziyaretçiye göre otomatik"}
                      </p>
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <Button size="sm" variant="secondary" disabled={index === 0 || reorder.isPending} onClick={() => move(index, -1)}>Yukarı</Button>
                      <Button size="sm" variant="secondary" disabled={index === sections.length - 1 || reorder.isPending} onClick={() => move(index, 1)}>Aşağı</Button>
                      {section.section_type === "RECENTLY_VIEWED" ? (
                        <Button
                          size="sm"
                          variant={section.is_active ? "secondary" : "primary"}
                          isPending={updateRecentlyViewed.isPending}
                          onClick={() => updateRecentlyViewed.mutate(
                            { id: section.id, isActive: !section.is_active },
                            {
                              onSuccess: () => toast.success(
                                section.is_active
                                  ? "Son görüntülediklerin kapatıldı"
                                  : "Son görüntülediklerin yayına alındı",
                              ),
                              onError: (err) => toast.error(
                                getErrorDetail(err, "Vitrin durumu güncellenemedi"),
                              ),
                            },
                          )}
                        >
                          {section.is_active ? "Kapat" : "Yayına al"}
                        </Button>
                      ) : (
                        <>
                          <Button size="sm" variant={editing ? "secondary" : "ghost"} onClick={() => {
                            setEditingId(editing ? null : section.id);
                            setCreating(null);
                          }}>{editing ? "Kapat" : "Düzenle"}</Button>
                          <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400" onClick={() => deleteDialog.ac(section)}>Sil</Button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {editing && (
                  <div className="mt-4 border-t border-panel-border pt-4">
                    {section.section_type === "PRODUCT_RAIL" ? (
                      <EditProductSection section={section} onSaved={() => setEditingId(null)} />
                    ) : (
                      <EditImageSection section={section} onSaved={() => setEditingId(null)} />
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleteDialog.acik}
        title="Ana sayfa bölümünü sil"
        description="Bölüm mağaza akışından kaldırılacak. Seçili ürünler ve ürün kayıtları silinmez. Yüklenen özel görseller kaldırılır."
        confirmLabel="Bölümü sil"
        danger
        isPending={remove.isPending}
        onClose={deleteDialog.kapat}
        onConfirm={() => deleteDialog.kayit && remove.mutate(deleteDialog.kayit.id, {
          onSuccess: () => {
            toast.success("Ana sayfa bölümü silindi");
            if (editingId === deleteDialog.kayit?.id) setEditingId(null);
            deleteDialog.kapat();
          },
          onError: (err) => toast.error(getErrorDetail(err, "Bölüm silinemedi")),
        })}
      />
    </section>
  );
}

function TypePicker({ value, onChange }: { value: CreatableSectionType; onChange: (value: CreatableSectionType) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Yeni bölüm türü">
      <Button variant="ghost" aria-pressed={value === "PRODUCT_RAIL"} onClick={() => onChange("PRODUCT_RAIL")} className={`h-auto items-start rounded-xl border p-4 text-left transition-colors ${value === "PRODUCT_RAIL" ? "border-panel-accent bg-panel-accent/10" : "border-panel-border bg-panel-card hover:border-panel-fg-subtle"}`}>
        <span className="font-semibold text-panel-fg">Ürün şeridi</span>
        <span className="mt-1 block text-sm text-panel-fg-muted">Başlık verin, katalogdan 1–12 ürün seçin.</span>
      </Button>
      <Button variant="ghost" aria-pressed={value === "IMAGE_GRID"} onClick={() => onChange("IMAGE_GRID")} className={`h-auto items-start rounded-xl border p-4 text-left transition-colors ${value === "IMAGE_GRID" ? "border-panel-accent bg-panel-accent/10" : "border-panel-border bg-panel-card hover:border-panel-fg-subtle"}`}>
        <span className="font-semibold text-panel-fg">Görsel blok</span>
        <span className="mt-1 block text-sm text-panel-fg-muted">1–4 görsel yükleyin, her birini ayrı yere yönlendirin.</span>
      </Button>
    </div>
  );
}

function CreateProductSection({ sortOrder, onCreated }: { sortOrder: number; onCreated: () => void }) {
  const mutation = useCreateStoreHomeProductSection();
  return <ProductSectionForm sortOrder={sortOrder} pending={mutation.isPending} submitLabel="Ürün şeridini ekle" onSubmit={(payload) => mutation.mutate(payload, {
    onSuccess: () => { toast.success("Ürün şeridi eklendi"); onCreated(); },
    onError: (err) => toast.error(getErrorDetail(err, "Ürün şeridi eklenemedi")),
  })} />;
}

function EditProductSection({ section, onSaved }: { section: StoreHomeSection; onSaved: () => void }) {
  const mutation = useUpdateStoreHomeProductSection();
  return <ProductSectionForm section={section} pending={mutation.isPending} submitLabel="Değişiklikleri kaydet" onSubmit={(payload) => mutation.mutate({ id: section.id, payload }, {
    onSuccess: () => { toast.success("Ürün şeridi güncellendi"); onSaved(); },
    onError: (err) => toast.error(getErrorDetail(err, "Ürün şeridi güncellenemedi")),
  })} />;
}

function ProductSectionForm({ section, sortOrder, pending, submitLabel, onSubmit }: {
  section?: StoreHomeSection;
  sortOrder?: number;
  pending: boolean;
  submitLabel: string;
  onSubmit: (payload: StoreHomeProductSectionInput) => void;
}) {
  const [selected, setSelected] = useState<ProductSearchOut[]>(section?.products ?? []);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search.trim(), 300);
  const productQuery = useProducts({ q: debouncedSearch, limit: 12 }, debouncedSearch.length >= 2);

  useEffect(() => setSelected(section?.products ?? []), [section]);

  const candidates = (productQuery.data ?? []).filter((product) => !selected.some((item) => item.id === product.id));
  const moveProduct = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= selected.length) return;
    setSelected((items) => {
      const next = [...items];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selected.length === 0) {
      toast.error("En az bir ürün seçin");
      return;
    }
    onSubmit({ ...readMeta(event.currentTarget, section, sortOrder), product_ids: selected.map((product) => product.id) });
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <MetaFields section={section} />
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-panel-fg">Ürünler ({selected.length}/12)</legend>
        <div className="flex items-center justify-end gap-3">
          <span className="text-xs text-panel-fg-subtle">Arama sonuçlarına tıklayarak ekleyin</span>
        </div>
        <label className="block"><span className="sr-only">Bölüm için ürün ara</span><input value={search} onChange={(event) => setSearch(event.target.value)} className="input w-full" placeholder="Ürün adı, yazar, ISBN veya SKU ile ara…" /></label>
        {debouncedSearch.length >= 2 && (
          <div className="max-h-56 overflow-y-auto rounded-xl border border-panel-border bg-panel-card">
            {productQuery.isLoading ? <div className="h-20 animate-pulse bg-panel-muted" /> : productQuery.isError ? (
              <p className="p-3 text-sm text-rose-600 dark:text-rose-400">{getErrorDetail(productQuery.error, "Ürün araması yapılamadı.")}</p>
            ) : candidates.length ? (
              <ul className="divide-y divide-panel-border">
                {candidates.map((product) => (
                  <li key={product.id}>
                    <Button variant="ghost" disabled={selected.length >= 12} onClick={() => setSelected((items) => [...items, product])} className="h-auto w-full justify-start rounded-none px-3 py-2 text-left">
                      <ProductThumb product={product} />
                      <span className="min-w-0">
                        <span className="line-clamp-1 text-sm font-medium text-panel-fg">{product.title}</span>
                        <span className="block truncate text-xs text-panel-fg-muted">{[product.author, product.publisher, product.isbn, product.sku].filter(Boolean).join(" · ")}</span>
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : <p className="p-3 text-sm text-panel-fg-muted">Eklenebilecek eşleşen ürün yok.</p>}
          </div>
        )}
        <div className="grid gap-2 rounded-xl border border-panel-border p-2 sm:grid-cols-2">
          {selected.map((product, index) => (
            <div key={product.id} className="flex items-center gap-2 rounded-lg bg-panel-muted p-2">
              <span className="w-5 text-center text-xs font-semibold text-panel-fg-subtle">{index + 1}</span>
              <ProductThumb product={product} />
              <span className="line-clamp-2 min-w-0 flex-1 text-xs text-panel-fg">{product.title}</span>
              <div className="flex shrink-0 flex-col">
                <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => moveProduct(index, -1)} aria-label={`${product.title} ürününü yukarı taşı`} className="min-h-0 px-1 text-xs">↑</Button>
                <Button size="sm" variant="ghost" disabled={index === selected.length - 1} onClick={() => moveProduct(index, 1)} aria-label={`${product.title} ürününü aşağı taşı`} className="min-h-0 px-1 text-xs">↓</Button>
              </div>
              <Button type="button" size="sm" variant="ghost" className="shrink-0 text-xs text-rose-600 dark:text-rose-400" onClick={() => setSelected((items) => items.filter((item) => item.id !== product.id))}>Kaldır</Button>
            </div>
          ))}
          {selected.length === 0 && <p className="p-2 text-sm text-panel-fg-muted sm:col-span-2">Henüz ürün seçilmedi.</p>}
        </div>
      </fieldset>
      <FormFooter section={section} pending={pending} submitLabel={submitLabel} />
    </form>
  );
}

function ProductThumb({ product }: { product: ProductSearchOut }) {
  return product.cover_url
    ? <img src={product.cover_url} alt="" className="h-10 w-8 shrink-0 rounded bg-white object-contain dark:bg-slate-800" />
    : <span className="h-10 w-8 shrink-0 rounded bg-panel-muted" />;
}

function CreateImageSection({ sortOrder, onCreated }: { sortOrder: number; onCreated: () => void }) {
  const mutation = useCreateStoreHomeImageSection();
  return <ImageSectionForm sortOrder={sortOrder} pending={mutation.isPending} submitLabel="Görsel bloğu ekle" onSubmit={(payload) => mutation.mutate(payload, {
    onSuccess: () => { toast.success("Görsel blok eklendi"); onCreated(); },
    onError: (err) => toast.error(getErrorDetail(err, "Görsel blok eklenemedi")),
  })} />;
}

function EditImageSection({ section, onSaved }: { section: StoreHomeSection; onSaved: () => void }) {
  const mutation = useUpdateStoreHomeImageSection();
  return <ImageSectionForm section={section} pending={mutation.isPending} submitLabel="Değişiklikleri kaydet" onSubmit={(payload) => mutation.mutate({ id: section.id, payload }, {
    onSuccess: () => { toast.success("Görsel blok güncellendi"); onSaved(); },
    onError: (err) => toast.error(getErrorDetail(err, "Görsel blok güncellenemedi")),
  })} />;
}

function ImageSectionForm({ section, sortOrder, pending, submitLabel, onSubmit }: {
  section?: StoreHomeSection;
  sortOrder?: number;
  pending: boolean;
  submitLabel: string;
  onSubmit: (payload: StoreHomeImageSectionInput) => void;
}) {
  const fromSection = () => section?.image_tiles.length
    ? section.image_tiles.map((tile, index) => ({ existingIndex: index, imageUrl: tile.image_url, file: null, label: tile.label, altText: tile.alt_text, linkUrl: tile.link_url }))
    : [emptyImage()];
  const [images, setImages] = useState<ImageDraft[]>(fromSection);
  useEffect(() => setImages(fromSection()), [section]);

  const updateImage = (index: number, changes: Partial<ImageDraft>) => setImages((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item));
  const moveImage = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= images.length) return;
    setImages((items) => {
      const next = [...items];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (images.some((image) => !image.file && image.existingIndex === null)) {
      toast.error("Her kutu için bir görsel seçin");
      return;
    }
    if (images.some((image) => !image.altText.trim() || !image.linkUrl.trim())) {
      toast.error("Her görselin açıklamasını ve bağlantısını doldurun");
      return;
    }
    onSubmit({
      ...readMeta(event.currentTarget, section, sortOrder),
      tiles: images.map((image) => ({ file: image.file, existing_index: image.existingIndex, label: image.label.trim(), alt_text: image.altText.trim(), link_url: image.linkUrl.trim() })),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <MetaFields section={section} />
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-panel-fg">Görseller ({images.length}/4)</legend>
        <div className="flex items-center justify-end gap-3">
          {images.length < 4 && <Button type="button" size="sm" variant="secondary" onClick={() => setImages((items) => [...items, emptyImage()])}>Görsel ekle</Button>}
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {images.map((image, index) => (
            <div key={`${image.imageUrl ?? "new"}-${index}`} className="rounded-xl border border-panel-border bg-panel-card p-3">
              <div className="flex gap-3">
                <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-panel-muted">
                  <ImagePreview image={image} />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <label className="block space-y-1 text-xs font-medium text-panel-fg">
                    <span>{index + 1}. görsel dosyası</span>
                    <input type="file" accept="image/*" className="block w-full text-xs text-panel-fg-muted file:mr-2 file:rounded-lg file:border-0 file:bg-panel-muted file:px-2 file:py-1.5 file:text-panel-fg" onChange={(event) => updateImage(index, { file: event.target.files?.[0] ?? null })} />
                  </label>
                  <label className="block space-y-1 text-xs font-medium text-panel-fg">
                    <span>Görsel altındaki yazı <span className="font-normal text-panel-fg-subtle">(isteğe bağlı)</span></span>
                    <input value={image.label} maxLength={80} onChange={(event) => updateImage(index, { label: event.target.value })} className="input w-full" />
                  </label>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="block space-y-1 text-xs font-medium text-panel-fg">
                  <span>{index + 1}. görsel açıklaması <span className="font-normal text-panel-fg-subtle">(erişilebilirlik)</span></span>
                  <input required value={image.altText} maxLength={180} onChange={(event) => updateImage(index, { altText: event.target.value })} className="input w-full" />
                </label>
                <label className="block space-y-1 text-xs font-medium text-panel-fg">
                  <span>{index + 1}. görsel bağlantısı</span>
                  <input required value={image.linkUrl} onChange={(event) => updateImage(index, { linkUrl: event.target.value })} className="input w-full" placeholder="/magaza?category=…" />
                </label>
              </div>
              {images.length > 1 && (
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="flex gap-1">
                    <Button type="button" size="sm" variant="secondary" disabled={index === 0} onClick={() => moveImage(index, -1)}>Sola al</Button>
                    <Button type="button" size="sm" variant="secondary" disabled={index === images.length - 1} onClick={() => moveImage(index, 1)}>Sağa al</Button>
                  </div>
                  <Button type="button" size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400" onClick={() => setImages((items) => items.filter((_, itemIndex) => itemIndex !== index))}>Görseli kaldır</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </fieldset>
      <FormFooter section={section} pending={pending} submitLabel={submitLabel} />
    </form>
  );
}

function ImagePreview({ image }: { image: ImageDraft }) {
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!image.file) {
      setLocalUrl(null);
      return;
    }
    const url = URL.createObjectURL(image.file);
    setLocalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image.file]);

  const src = localUrl ?? image.imageUrl;
  return src
    ? <img src={src} alt="" className="h-full w-full object-contain" />
    : <span className="px-2 text-center text-xs text-panel-fg-subtle">Görsel seçilmedi</span>;
}

function MetaFields({ section }: { section?: StoreHomeSection }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm font-medium text-panel-fg"><span>Bölüm başlığı</span><input name="title" required maxLength={120} defaultValue={section?.title ?? ""} className="input w-full" placeholder="Örn. Romanlar" /></label>
      <label className="space-y-1 text-sm font-medium text-panel-fg"><span>Kısa açıklama <span className="font-normal text-panel-fg-subtle">(isteğe bağlı)</span></span><input name="description" maxLength={180} defaultValue={section?.description ?? ""} className="input w-full" /></label>
      <label className="space-y-1 text-sm font-medium text-panel-fg"><span>Bölüm bağlantısı <span className="font-normal text-panel-fg-subtle">(isteğe bağlı)</span></span><input name="link_url" defaultValue={section?.link_url ?? ""} className="input w-full" placeholder="/magaza?category=…" /></label>
      <label className="space-y-1 text-sm font-medium text-panel-fg"><span>Bağlantı yazısı</span><input name="link_label" required maxLength={60} defaultValue={section?.link_label ?? "Tümünü gör"} className="input w-full" /></label>
    </div>
  );
}

function readMeta(form: HTMLFormElement, section?: StoreHomeSection, sortOrder = 0): StoreHomeSectionMetaInput {
  const data = new FormData(form);
  const linkUrl = String(data.get("link_url") ?? "").trim();
  return {
    title: String(data.get("title") ?? "").trim(),
    description: String(data.get("description") ?? "").trim(),
    link_url: linkUrl || null,
    link_label: String(data.get("link_label") ?? "Tümünü gör").trim(),
    is_active: data.get("is_active") === "on",
    sort_order: section?.sort_order ?? sortOrder,
  };
}

function FormFooter({ section, pending, submitLabel }: { section?: StoreHomeSection; pending: boolean; submitLabel: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-panel-border pt-4">
      <label className="flex items-center gap-2 text-sm font-medium text-panel-fg">
        <input name="is_active" type="checkbox" defaultChecked={section?.is_active ?? true} />
        Mağazada göster
      </label>
      <Button type="submit" size="sm" isPending={pending}>{submitLabel}</Button>
    </div>
  );
}
