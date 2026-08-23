import { useEffect, useState, type FormEvent } from "react";

import { Badge, Button, ErrorState } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { useProducts } from "@/hooks/useStore";
import {
  useAdminStoreShowcase,
  useCreateCustomStoreShowcaseCard,
  useCreateStoreShowcaseCard,
  useDeleteStoreShowcaseCard,
  useReorderStoreShowcaseCards,
  useUpdateCustomStoreShowcaseCard,
  useUpdateStoreShowcaseCard,
} from "@/hooks/useStoreShowcase";
import { getErrorDetail } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type {
  ProductSearchOut,
  StoreShowcaseCard,
  StoreShowcaseCardInput,
  StoreShowcaseContentMode,
  StoreShowcaseCustomCardInput,
} from "@/types";

type SelectableProduct = {
  id: number;
  slug: string;
  title: string;
  cover_url?: string | null;
  author?: string | null;
  publisher?: string | null;
  isbn?: string | null;
  sku?: string | null;
};

type TileDraft = {
  existingIndex: number | null;
  imageUrl: string | null;
  file: File | null;
  label: string;
  altText: string;
  linkUrl: string;
};

const emptyTile = (): TileDraft => ({
  existingIndex: null,
  imageUrl: null,
  file: null,
  label: "",
  altText: "",
  linkUrl: "/magaza",
});

export function StoreShowcaseManager({ canManage }: { canManage: boolean }) {
  const { data: cards = [], isLoading, isError, error, refetch } = useAdminStoreShowcase();
  const reorder = useReorderStoreShowcaseCards();
  const remove = useDeleteStoreShowcaseCard();
  const [showCreate, setShowCreate] = useState(false);
  const deleteDialog = useDuzenlemeYuzeyi<StoreShowcaseCard, void>();

  if (isError) {
    return <ErrorState description={getErrorDetail(error, "Vitrin kartları yüklenemedi.")} onRetry={() => void refetch()} />;
  }

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= cards.length) return;
    const ids = cards.map((card) => card.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate(ids, {
      onSuccess: () => toast.success("Kart sırası güncellendi"),
      onError: (err) => toast.error(getErrorDetail(err, "Kart sırası güncellenemedi")),
    });
  };

  return (
    <section className="space-y-5 border-t border-panel-border pt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-panel-fg text-xs font-bold text-panel-card">2</span>
            <p className="text-sm font-semibold text-panel-fg">Büyük görselin üzerindeki kartlar</p>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-panel-fg-muted">
            Kartı mağaza ürünlerinden oluşturun veya kendi 1–4 görselinizi yükleyip her görsele ayrı yönlendirme verin.
          </p>
        </div>
        {canManage && <Button size="sm" onClick={() => setShowCreate((value) => !value)}>{showCreate ? "Formu kapat" : "Yeni kart ekle"}</Button>}
      </div>

      {canManage && showCreate && <CreateCardPanel onCreated={() => setShowCreate(false)} />}

      {cards.length === 0 && !isLoading && (
        <div className="rounded-2xl border border-dashed border-panel-border px-6 py-8 text-center">
          <p className="font-semibold text-panel-fg">Henüz vitrin kartı yok</p>
          <p className="mt-1 text-sm text-panel-fg-muted">Kart eklenene kadar mağazada bu bölüm gösterilmez.</p>
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">{[0, 1].map((id) => <div key={id} className="h-72 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />)}</div>
      ) : (
        <div className="divide-y divide-panel-border">
          {cards.map((card, index) => (
            <EditableCard
              key={card.id}
              card={card}
              canManage={canManage}
              first={index === 0}
              last={index === cards.length - 1}
              reordering={reorder.isPending}
              onMove={(direction) => move(index, direction)}
              onDelete={() => deleteDialog.ac(card)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteDialog.acik}
        title="Vitrin kartını sil"
        description="Kart ve ona yüklenen özel görseller kaldırılacak. Mağaza ürünleri etkilenmez."
        confirmLabel="Kartı sil"
        danger
        isPending={remove.isPending}
        onClose={deleteDialog.kapat}
        onConfirm={() => deleteDialog.kayit && remove.mutate(deleteDialog.kayit.id, {
          onSuccess: () => { toast.success("Vitrin kartı silindi"); deleteDialog.kapat(); },
          onError: (err) => toast.error(getErrorDetail(err, "Kart silinemedi")),
        })}
      />
    </section>
  );
}

function CreateCardPanel({ onCreated }: { onCreated: () => void }) {
  const [mode, setMode] = useState<StoreShowcaseContentMode>("CUSTOM");
  const createProduct = useCreateStoreShowcaseCard();
  const createCustom = useCreateCustomStoreShowcaseCard();

  return (
    <div className="rounded-2xl border border-panel-border bg-panel-muted/40 p-4 sm:p-5">
      <ModePicker value={mode} onChange={setMode} />
      <div className="mt-5">
        {mode === "PRODUCTS" ? (
          <ProductCardForm
            pending={createProduct.isPending}
            submitLabel="Ürün kartını ekle"
            onSubmit={(payload) => createProduct.mutate(payload, {
              onSuccess: () => { toast.success("Ürün kartı eklendi"); onCreated(); },
              onError: (err) => toast.error(getErrorDetail(err, "Kart eklenemedi")),
            })}
          />
        ) : (
          <CustomCardForm
            pending={createCustom.isPending}
            submitLabel="Görsel kartını ekle"
            onSubmit={(payload) => createCustom.mutate(payload, {
              onSuccess: () => { toast.success("Görsel kartı eklendi"); onCreated(); },
              onError: (err) => toast.error(getErrorDetail(err, "Kart eklenemedi")),
            })}
          />
        )}
      </div>
    </div>
  );
}

function EditableCard({ card, canManage, first, last, reordering, onMove, onDelete }: {
  card: StoreShowcaseCard;
  canManage: boolean;
  first: boolean;
  last: boolean;
  reordering: boolean;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<StoreShowcaseContentMode>(card.content_mode);
  const update = useUpdateStoreShowcaseCard();
  const updateCustom = useUpdateCustomStoreShowcaseCard();
  useEffect(() => setMode(card.content_mode), [card.content_mode]);

  const saveCustom = async (payload: StoreShowcaseCustomCardInput) => {
    try {
      await updateCustom.mutateAsync({ id: card.id, payload });
      toast.success("Vitrin kartı güncellendi");
      setEditing(false);
    } catch (err) {
      toast.error(getErrorDetail(err, "Kart güncellenemedi"));
    }
  };

  return (
    <article className="py-6 first:pt-1">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-panel-fg">{card.title}</p>
          <p className="text-xs text-panel-fg-muted">{card.content_mode === "CUSTOM" ? `${card.custom_tiles.length} özel görsel` : `${card.products.length} ürün`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={card.is_active ? "success" : "neutral"}>{card.is_active ? "Aktif" : "Pasif"}</Badge>
          {canManage && <Button size="sm" variant={editing ? "secondary" : "ghost"} onClick={() => setEditing((value) => !value)}>{editing ? "Kapat" : "Düzenle"}</Button>}
        </div>
      </div>

      {editing && (
        <div className="mt-4 border-t border-panel-border pt-4">
          <ModePicker value={mode} onChange={setMode} disabled={!canManage} />
          <div className="mt-5">
            {mode === "PRODUCTS" ? (
              <ProductCardForm
                card={card}
                pending={update.isPending}
                disabled={!canManage}
                submitLabel={card.content_mode === "PRODUCTS" ? "Kaydet" : "Ürün moduna geçir"}
                onSubmit={(payload) => update.mutate({ id: card.id, payload }, {
                  onSuccess: () => { toast.success("Vitrin kartı güncellendi"); setEditing(false); },
                  onError: (err) => toast.error(getErrorDetail(err, "Kart güncellenemedi")),
                })}
              />
            ) : (
              <CustomCardForm
                card={card}
                pending={updateCustom.isPending}
                disabled={!canManage}
                submitLabel={card.content_mode === "CUSTOM" ? "Kaydet" : "Özel görsel moduna geçir"}
                onSubmit={(payload) => void saveCustom(payload)}
              />
            )}
          </div>
        </div>
      )}

      {canManage && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-panel-border pt-3">
          <div className="flex gap-2">
            {!first && <Button size="sm" variant="secondary" isPending={reordering} onClick={() => onMove(-1)}>Yukarı</Button>}
            {!last && <Button size="sm" variant="secondary" isPending={reordering} onClick={() => onMove(1)}>Aşağı</Button>}
          </div>
          <Button size="sm" variant="ghost" onClick={onDelete}>Sil</Button>
        </div>
      )}
    </article>
  );
}

function ModePicker({ value, onChange, disabled = false }: {
  value: StoreShowcaseContentMode;
  onChange: (value: StoreShowcaseContentMode) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="inline-flex rounded-xl border border-panel-border bg-panel-card p-1">
      <legend className="sr-only">Kart içerik türü</legend>
      {(["CUSTOM", "PRODUCTS"] as const).map((mode) => (
        <Button
          key={mode}
          variant="ghost"
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${value === mode ? "bg-panel-fg text-panel-card" : "text-panel-fg-muted hover:text-panel-fg"}`}
        >
          {mode === "CUSTOM" ? "Kendi görsellerim" : "Mağaza ürünleri"}
        </Button>
      ))}
    </fieldset>
  );
}

function CustomCardForm({ card, pending, disabled = false, submitLabel, onSubmit }: {
  card?: StoreShowcaseCard;
  pending: boolean;
  disabled?: boolean;
  submitLabel: string;
  onSubmit: (payload: StoreShowcaseCustomCardInput) => void;
}) {
  const [active, setActive] = useState(card?.is_active ?? true);
  const [tiles, setTiles] = useState<TileDraft[]>(() => card?.custom_tiles.length
    ? card.custom_tiles.map((tile, index) => ({ existingIndex: index, imageUrl: tile.image_url, file: null, label: tile.label, altText: tile.alt_text, linkUrl: tile.link_url }))
    : [emptyTile()]);

  useEffect(() => {
    setActive(card?.is_active ?? true);
    setTiles(card?.custom_tiles.length
      ? card.custom_tiles.map((tile, index) => ({ existingIndex: index, imageUrl: tile.image_url, file: null, label: tile.label, altText: tile.alt_text, linkUrl: tile.link_url }))
      : [emptyTile()]);
  }, [card]);

  const updateTile = (index: number, changes: Partial<TileDraft>) => {
    setTiles((current) => current.map((tile, tileIndex) => tileIndex === index ? { ...tile, ...changes } : tile));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (tiles.some((tile) => !tile.file && tile.existingIndex === null)) {
      toast.error("Her kutu için bir görsel seçin");
      return;
    }
    const form = new FormData(event.currentTarget);
    onSubmit({
      title: String(form.get("title") ?? "").trim(),
      description: String(form.get("description") ?? "").trim(),
      link_url: String(form.get("link_url") ?? "").trim(),
      link_label: String(form.get("link_label") ?? "").trim(),
      is_active: active,
      sort_order: Number(form.get("sort_order") || 0),
      tiles: tiles.map((tile) => ({
        file: tile.file,
        existing_index: tile.existingIndex,
        label: tile.label.trim(),
        alt_text: tile.altText.trim(),
        link_url: tile.linkUrl.trim(),
      })),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <CardMetaFields card={card} disabled={disabled} />
      <fieldset disabled={disabled} className="space-y-3">
        <legend className="text-sm font-medium text-panel-fg">Görseller <span className="font-normal text-panel-fg-subtle">({tiles.length}/4)</span></legend>
        <div className="flex items-center justify-end gap-3">
          {tiles.length < 4 && <Button type="button" size="sm" variant="secondary" onClick={() => setTiles((current) => [...current, emptyTile()])}>Görsel ekle</Button>}
        </div>
        <p className="text-xs text-panel-fg-muted">Bağlantılar uygulama içi <code>/magaza</code> adresi veya tam <code>https://</code> adresi olabilir.</p>
        <div className="grid gap-3 lg:grid-cols-2">
          {tiles.map((tile, index) => (
            <div key={`${tile.imageUrl ?? "new"}-${index}`} className="rounded-xl border border-panel-border bg-panel-card p-3">
              <div className="flex gap-3">
                <TilePreview file={tile.file} imageUrl={tile.imageUrl} />
                <div className="min-w-0 flex-1 space-y-2">
                  <label className="block text-xs font-medium text-panel-fg">Görsel dosyası<input type="file" accept="image/jpeg,image/png,image/webp" required={!card && !tile.imageUrl} onChange={(event) => updateTile(index, { file: event.target.files?.[0] ?? null })} className="mt-1 block w-full text-xs text-panel-fg-muted file:mr-2 file:rounded-md file:border-0 file:bg-panel-muted file:px-2 file:py-1 file:text-panel-fg" /></label>
                  <label className="block text-xs font-medium text-panel-fg">Kısa etiket <span className="font-normal text-panel-fg-subtle">(isteğe bağlı)</span><input value={tile.label} maxLength={80} onChange={(event) => updateTile(index, { label: event.target.value })} className="input mt-1 w-full" placeholder="TYT kitapları" /></label>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="text-xs font-medium text-panel-fg">Yönlendirme<input required value={tile.linkUrl} onChange={(event) => updateTile(index, { linkUrl: event.target.value })} className="input mt-1 w-full" placeholder="/magaza?q=TYT" /></label>
                <label className="text-xs font-medium text-panel-fg">Görsel açıklaması<input required value={tile.altText} maxLength={180} onChange={(event) => updateTile(index, { altText: event.target.value })} className="input mt-1 w-full" placeholder="Görseli kısaca anlatın" /></label>
              </div>
              {tiles.length > 1 && <Button type="button" size="sm" variant="ghost" onClick={() => setTiles((current) => current.filter((_, tileIndex) => tileIndex !== index))} className="mt-2 text-rose-600 dark:text-rose-400">Kutuyu kaldır</Button>}
            </div>
          ))}
        </div>
        {card && <p className="text-xs text-panel-fg-muted">Mevcut görselleri tek tek koruyabilir, değiştirebilir, kaldırabilir veya yeni kutu ekleyebilirsiniz.</p>}
      </fieldset>
      <FormFooter active={active} setActive={setActive} card={card} disabled={disabled} pending={pending} submitLabel={submitLabel} />
    </form>
  );
}

function TilePreview({ file, imageUrl }: { file: File | null; imageUrl: string | null }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(imageUrl);
  useEffect(() => {
    if (!file) {
      setPreviewUrl(imageUrl);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, imageUrl]);

  return (
    <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-panel-muted">
      {previewUrl ? <img src={previewUrl} alt="" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center px-2 text-center text-xs text-panel-fg-subtle">Görsel seçilmedi</div>}
    </div>
  );
}

function ProductCardForm({ card, pending, disabled = false, submitLabel, onSubmit }: {
  card?: StoreShowcaseCard;
  pending: boolean;
  disabled?: boolean;
  submitLabel: string;
  onSubmit: (payload: StoreShowcaseCardInput) => void;
}) {
  const [selected, setSelected] = useState<SelectableProduct[]>(card?.products ?? []);
  const [active, setActive] = useState(card?.is_active ?? true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => { setSelected(card?.products ?? []); setActive(card?.is_active ?? true); }, [card]);
  const productQuery = useProducts({ q: debouncedSearch, limit: 10 }, !disabled && debouncedSearch.length > 0);
  const selectedIds = new Set(selected.map((product) => product.id));
  const candidates = (productQuery.data ?? []).filter((product) => !selectedIds.has(product.id));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selected.length < 1 || selected.length > 4) {
      toast.error("Kart için 1 ile 4 arasında ürün seçin");
      return;
    }
    const form = new FormData(event.currentTarget);
    onSubmit({
      title: String(form.get("title") ?? "").trim(),
      description: String(form.get("description") ?? "").trim(),
      link_url: String(form.get("link_url") ?? "").trim(),
      link_label: String(form.get("link_label") ?? "").trim(),
      product_ids: selected.map((product) => product.id),
      is_active: active,
      sort_order: Number(form.get("sort_order") || 0),
    });
  };

  const addProduct = (product: ProductSearchOut) => {
    if (selected.length >= 4) return toast.error("Bir kartta en fazla 4 ürün olabilir");
    setSelected((current) => [...current, product]);
    setSearch("");
    setDebouncedSearch("");
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <CardMetaFields card={card} disabled={disabled} />
      <fieldset disabled={disabled} className="space-y-2">
        <legend className="text-sm font-medium text-panel-fg">Ürünler <span className="font-normal text-panel-fg-subtle">({selected.length}/4)</span></legend>
        {!disabled && <label className="block"><span className="sr-only">Kart için ürün ara</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} className="input w-full" placeholder="Başlık, yazar, yayınevi, ISBN veya SKU ile ara" /></label>}
        {debouncedSearch && !disabled && (
          <div className="max-h-48 overflow-y-auto rounded-xl border border-panel-border bg-panel-card">
            {productQuery.isLoading ? <div className="h-20 animate-pulse bg-panel-muted" /> : productQuery.isError ? (
              <div className="flex items-center justify-between gap-3 p-3"><p className="text-sm text-rose-600 dark:text-rose-400">{getErrorDetail(productQuery.error, "Ürün araması yapılamadı.")}</p><Button type="button" size="sm" variant="secondary" onClick={() => void productQuery.refetch()}>Yeniden dene</Button></div>
            ) : candidates.length ? (
              <ul className="divide-y divide-panel-border">{candidates.map((product) => <li key={product.id}><Button variant="ghost" onClick={() => addProduct(product)} className="h-auto w-full justify-start rounded-none px-3 py-2 text-left">{product.cover_url ? <img src={product.cover_url} alt="" className="h-10 w-8 rounded bg-white object-contain dark:bg-slate-800" /> : <span className="h-10 w-8 rounded bg-panel-muted" />}<span className="min-w-0"><span className="line-clamp-2 text-sm text-panel-fg">{product.title}</span><span className="mt-0.5 block truncate text-xs text-panel-fg-subtle">{[product.author, product.publisher, product.isbn, product.sku].filter(Boolean).join(" · ")}</span></span></Button></li>)}</ul>
            ) : <p className="p-3 text-sm text-panel-fg-muted">Eşleşen aktif ürün bulunamadı.</p>}
          </div>
        )}
        <div className="grid gap-2 rounded-xl border border-panel-border p-2 sm:grid-cols-2">
          {selected.map((product) => <div key={product.id} className="flex items-center gap-2 rounded-lg bg-panel-muted p-2">{product.cover_url ? <img src={product.cover_url} alt="" className="h-10 w-8 rounded bg-white object-contain dark:bg-slate-800" /> : <span className="h-10 w-8 rounded bg-panel-card" />}<span className="min-w-0 flex-1 line-clamp-2 text-xs text-panel-fg">{product.title}</span>{!disabled && <Button type="button" size="sm" variant="ghost" onClick={() => setSelected((current) => current.filter((item) => item.id !== product.id))} className="shrink-0 text-xs text-rose-600 dark:text-rose-400">Kaldır</Button>}</div>)}
          {selected.length === 0 && <p className="p-2 text-sm text-panel-fg-muted sm:col-span-2">Henüz ürün seçilmedi.</p>}
        </div>
      </fieldset>
      <FormFooter active={active} setActive={setActive} card={card} disabled={disabled} pending={pending} submitLabel={submitLabel} />
    </form>
  );
}

function CardMetaFields({ card, disabled }: { card?: StoreShowcaseCard; disabled: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm font-medium text-panel-fg"><span>Başlık</span><input name="title" required maxLength={120} defaultValue={card?.title ?? ""} disabled={disabled} className="input w-full" /></label>
      <label className="space-y-1 text-sm font-medium text-panel-fg"><span>Kısa açıklama</span><input name="description" maxLength={180} defaultValue={card?.description ?? ""} disabled={disabled} className="input w-full" /></label>
      <label className="space-y-1 text-sm font-medium text-panel-fg"><span>Alt bağlantı metni</span><input name="link_label" required maxLength={60} defaultValue={card?.link_label ?? "Keşfet"} disabled={disabled} className="input w-full" placeholder="Tümünü gör" /></label>
      <label className="space-y-1 text-sm font-medium text-panel-fg"><span>Alt bağlantının gideceği adres</span><input name="link_url" required defaultValue={card?.link_url ?? "/magaza"} disabled={disabled} className="input w-full" placeholder="/magaza?q=TYT" /></label>
    </div>
  );
}

function FormFooter({ active, setActive, card, disabled, pending, submitLabel }: {
  active: boolean;
  setActive: (value: boolean) => void;
  card?: StoreShowcaseCard;
  disabled: boolean;
  pending: boolean;
  submitLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-panel-fg"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} disabled={disabled} /> Mağazada göster</label>
        <label className="flex items-center gap-2 text-sm text-panel-fg"><span>Sıra</span><input name="sort_order" type="number" min={0} defaultValue={card?.sort_order ?? 0} disabled={disabled} className="input w-20" /></label>
      </div>
      {!disabled && <Button type="submit" size="sm" isPending={pending}>{submitLabel}</Button>}
    </div>
  );
}
