import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { Seo } from "@/components/Seo";
import { StoreLayout } from "@/pages/store/StoreLayout";
import { ProductCard } from "@/components/store/ProductCard";
import { KebabMenu } from "@/components/store/KebabMenu";
import { ModalShell } from "@/components/store/ModalShell";
import { useFavoritesStore } from "@/store/favoritesStore";
import { useAuthStore } from "@/store/authStore";
import {
  useCollections,
  useCollection,
  useCreateCollection,
  useRenameCollection,
  useDeleteCollection,
  useAddToCollection,
  useRemoveFromCollection,
} from "@/hooks/useStore";
import { ROLE_IDS } from "@/types";
import type { Collection, ProductSearchOut } from "@/types";
import { toast } from "@/store/toastStore";

const CONTAINER = "mx-auto max-w-[76rem] px-4 md:px-8";
const GRID = "grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5";

const tr = (s: string) => s.toLocaleLowerCase("tr");

type Tab = "favorites" | "collections";

export default function FavoritesPage() {
  const [tab, setTab] = useState<Tab>("favorites");
  const [openCollectionId, setOpenCollectionId] = useState<number | null>(null);

  // Sekme değişince koleksiyon detayından çık.
  function switchTab(t: Tab) {
    setTab(t);
    setOpenCollectionId(null);
  }

  return (
    <StoreLayout title="Favori Listem">
      <Seo title="Favori Listem — Adana Özel Ders" description="Beğendiğin ürünler ve listelerin." />

      <div className={`${CONTAINER} py-8`}>
        {/* Sekmeler */}
        <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
          <TabButton active={tab === "favorites"} onClick={() => switchTab("favorites")} label="Favori Listem" />
          <TabButton active={tab === "collections"} onClick={() => switchTab("collections")} label="Listelerim" />
        </div>

        <div className="mt-6">
          {tab === "favorites" ? (
            <FavoritesTab />
          ) : (
            <CollectionsTab
              openCollectionId={openCollectionId}
              onOpen={setOpenCollectionId}
              onBack={() => setOpenCollectionId(null)}
            />
          )}
        </div>
      </div>
    </StoreLayout>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 pb-3 pt-1 text-sm font-semibold transition-colors ${
        active
          ? "border-indigo-600 text-slate-900 dark:border-indigo-400 dark:text-white"
          : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full sm:w-80">
      <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:ring-indigo-500/20"
      />
    </div>
  );
}

function EmptyBox({ title, desc, cta }: { title: string; desc: string; cta?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white py-20 text-center dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
      <p className="text-slate-500 dark:text-slate-400">{desc}</p>
      {cta}
    </div>
  );
}

/* ── Sekme 1: Favori Listem (localStorage) ── */
function FavoritesTab() {
  const items = useFavoritesStore((s) => s.items);
  const removeFav = useFavoritesStore((s) => s.remove);
  const [q, setQ] = useState("");
  const [addTarget, setAddTarget] = useState<ProductSearchOut | null>(null);

  const filtered = useMemo(
    () => (q.trim() ? items.filter((p) => tr(p.title).includes(tr(q))) : items),
    [items, q]
  );

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white">
          Favori Listem
          {items.length > 0 && (
            <span className="ml-2 text-base font-normal text-slate-400 dark:text-slate-500">({items.length})</span>
          )}
        </h1>
        {items.length > 0 && <SearchBox value={q} onChange={setQ} placeholder="Favori Listem'de ara" />}
      </div>

      {items.length === 0 ? (
        <EmptyBox
          title="Henüz favorin yok"
          desc="Beğendiğin ürünleri kalbe dokunarak buraya ekleyebilirsin."
          cta={
            <Link to={ROUTES.store} className="mt-6 inline-block rounded-full bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700">
              Mağazaya dön
            </Link>
          }
        />
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">"{q}" için sonuç yok.</p>
      ) : (
        <div className={GRID}>
          {filtered.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              menu={
                <KebabMenu
                  actions={[
                    { label: "Listelerime ekle", onClick: () => setAddTarget(p) },
                    { label: "Sil", danger: true, onClick: () => removeFav(p.id) },
                  ]}
                />
              }
            />
          ))}
        </div>
      )}

      {addTarget && <AddToCollectionModal product={addTarget} onClose={() => setAddTarget(null)} />}
    </>
  );
}

/* ── Sekme 2: Listelerim ── */
function CollectionsTab({
  openCollectionId,
  onOpen,
  onBack,
}: {
  openCollectionId: number | null;
  onOpen: (id: number) => void;
  onBack: () => void;
}) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const isClient = !!token && user?.role_id === ROLE_IDS.CLIENT;

  if (!isClient) {
    return (
      <EmptyBox
        title="Listelerin için giriş yap"
        desc="Kendi listelerini oluşturmak ve paylaşmak için öğrenci hesabınla giriş yapmalısın."
        cta={
          <Link to="?modal=login" className="mt-6 inline-block rounded-full bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700">
            Giriş yap
          </Link>
        }
      />
    );
  }

  if (openCollectionId != null) {
    return <CollectionDetail collectionId={openCollectionId} onBack={onBack} />;
  }
  return <CollectionList onOpen={onOpen} />;
}

function CollectionList({ onOpen }: { onOpen: (id: number) => void }) {
  const { data: collections, isLoading } = useCollections();
  const createCol = useCreateCollection();
  const renameCol = useRenameCollection();
  const deleteCol = useDeleteCollection();
  const [nameModal, setNameModal] = useState<{ mode: "create" | "rename"; col?: Collection } | null>(null);
  const [addProductsTo, setAddProductsTo] = useState<Collection | null>(null);

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white">
          Listelerim
          {collections && collections.length > 0 && (
            <span className="ml-2 text-base font-normal text-slate-400 dark:text-slate-500">({collections.length})</span>
          )}
        </h1>
        <button
          type="button"
          onClick={() => setNameModal({ mode: "create" })}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Liste oluştur
        </button>
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-slate-400">Yükleniyor…</p>
      ) : !collections || collections.length === 0 ? (
        <EmptyBox title="Henüz listen yok" desc="“Liste oluştur” ile ilk listeni yarat, favorilerinden ürün ekle." />
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {collections.map((c) => (
            <CollectionCard
              key={c.id}
              collection={c}
              onOpen={() => onOpen(c.id)}
              onAddProducts={() => setAddProductsTo(c)}
              onRename={() => setNameModal({ mode: "rename", col: c })}
              onDelete={() => {
                if (confirm(`"${c.name}" listesini silmek istediğine emin misin?`)) {
                  deleteCol.mutate(c.id, { onSuccess: () => toast.success("Liste silindi") });
                }
              }}
            />
          ))}
        </div>
      )}

      {nameModal && (
        <CollectionNameModal
          mode={nameModal.mode}
          initial={nameModal.col?.name}
          onClose={() => setNameModal(null)}
          onSubmit={(name) => {
            if (nameModal.mode === "create") {
              createCol.mutate(name, {
                onSuccess: () => {
                  toast.success("Liste oluşturuldu");
                  setNameModal(null);
                },
                onError: () => toast.error("Liste oluşturulamadı"),
              });
            } else if (nameModal.col) {
              renameCol.mutate(
                { id: nameModal.col.id, name },
                {
                  onSuccess: () => {
                    toast.success("Liste güncellendi");
                    setNameModal(null);
                  },
                }
              );
            }
          }}
        />
      )}

      {addProductsTo && (
        <AddProductsToCollectionModal collection={addProductsTo} onClose={() => setAddProductsTo(null)} />
      )}
    </>
  );
}

function CollectionCard({
  collection,
  onOpen,
  onAddProducts,
  onRename,
  onDelete,
}: {
  collection: Collection;
  onOpen: () => void;
  onAddProducts: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const count = collection.product_ids.length;
  const slots = Array.from({ length: 6 }, (_, i) => collection.preview[i] ?? null);

  function share() {
    const url = `${window.location.origin}${ROUTES.storeCollectionShared(collection.share_token)}`;
    if (navigator.share) {
      navigator.share({ title: collection.name, url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => toast.success("Bağlantı kopyalandı"));
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
      {/* Üst sıra: ad · paylaş + 3-nokta */}
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="truncate text-left text-base font-semibold text-slate-900 transition-colors hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400"
        >
          {collection.name}
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            aria-label="Paylaş"
            onClick={share}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 transition-colors hover:text-indigo-600 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:text-indigo-400"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          </button>
          <KebabMenu
            actions={[
              { label: "Yeni ürün ekle", onClick: onAddProducts },
              { label: "Liste ismini düzenle", onClick: onRename },
              { label: "Listeyi sil", danger: true, onClick: onDelete },
            ]}
          />
        </div>
      </div>

      {/* 6 slot önizleme (3×2) */}
      <button type="button" onClick={onOpen} className="mt-4 grid w-full grid-cols-3 gap-2">
        {slots.map((p, i) => (
          <div
            key={i}
            className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50"
          >
            {p?.cover_url ? (
              <img src={p.cover_url} alt="" className="h-full w-full object-contain mix-blend-multiply dark:mix-blend-normal" />
            ) : null}
          </div>
        ))}
      </button>

      {/* Ürün sayısı */}
      <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
        {count} ürün
      </p>
    </div>
  );
}

function CollectionDetail({ collectionId, onBack }: { collectionId: number; onBack: () => void }) {
  const { data, isLoading } = useCollection(collectionId);
  const removeItem = useRemoveFromCollection();
  const [q, setQ] = useState("");

  const items = data?.items ?? [];
  const filtered = useMemo(
    () => (q.trim() ? items.filter((p) => tr(p.title).includes(tr(q))) : items),
    [items, q]
  );

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Listelerime dön"
            onClick={onBack}
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">
            {data?.name ?? "Liste"}
            {items.length > 0 && (
              <span className="ml-2 text-base font-normal text-slate-400 dark:text-slate-500">({items.length})</span>
            )}
          </h1>
        </div>
        {items.length > 0 && <SearchBox value={q} onChange={setQ} placeholder="Listede ara" />}
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-slate-400">Yükleniyor…</p>
      ) : items.length === 0 ? (
        <EmptyBox title="Bu liste boş" desc="Favorilerinden bu listeye ürün ekleyebilirsin." />
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">"{q}" için sonuç yok.</p>
      ) : (
        <div className={GRID}>
          {filtered.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              menu={
                <KebabMenu
                  actions={[
                    {
                      label: "Listeden çıkar",
                      danger: true,
                      onClick: () =>
                        removeItem.mutate({ collectionId, productId: p.id }),
                    },
                  ]}
                />
              }
            />
          ))}
        </div>
      )}
    </>
  );
}

/* ── Modallar ── */

function AddToCollectionModal({ product, onClose }: { product: ProductSearchOut; onClose: () => void }) {
  const { data: collections } = useCollections();
  const addItem = useAddToCollection();
  const removeItem = useRemoveFromCollection();
  const createCol = useCreateCollection();
  const [newName, setNewName] = useState("");

  function toggle(c: Collection) {
    if (c.product_ids.includes(product.id)) {
      removeItem.mutate({ collectionId: c.id, productId: product.id });
    } else {
      addItem.mutate({ collectionId: c.id, productId: product.id });
    }
  }

  function createAndAdd() {
    const name = newName.trim();
    if (!name) return;
    createCol.mutate(name, {
      onSuccess: (col) => {
        addItem.mutate({ collectionId: col.id, productId: product.id });
        setNewName("");
        toast.success("Liste oluşturuldu ve ürün eklendi");
      },
    });
  }

  return (
    <ModalShell title="Listelerime ekle" onClose={onClose}>
      <p className="mb-3 line-clamp-1 text-sm text-slate-500 dark:text-slate-400">{product.title}</p>

      <div className="max-h-64 space-y-1 overflow-y-auto">
        {collections && collections.length > 0 ? (
          collections.map((c) => {
            const inList = c.product_ids.includes(product.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c)}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <span className="text-slate-800 dark:text-slate-200">{c.name}</span>
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded border ${
                    inList ? "border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500" : "border-slate-300 dark:border-slate-600"
                  }`}
                >
                  {inList && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
              </button>
            );
          })
        ) : (
          <p className="px-1 py-2 text-sm text-slate-400">Henüz listen yok. Aşağıdan oluştur.</p>
        )}
      </div>

      <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4 dark:border-slate-700">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createAndAdd()}
          placeholder="Yeni liste oluştur"
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        />
        <button
          type="button"
          disabled={!newName.trim() || createCol.isPending}
          onClick={createAndAdd}
          className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          Oluştur
        </button>
      </div>
    </ModalShell>
  );
}

function CollectionNameModal({
  mode,
  initial,
  onClose,
  onSubmit,
}: {
  mode: "create" | "rename";
  initial?: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial ?? "");
  return (
    <ModalShell title={mode === "create" ? "Yeni liste" : "Liste ismini düzenle"} onClose={onClose}>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && name.trim() && onSubmit(name.trim())}
        maxLength={120}
        placeholder="Liste adı (ör. Sınava Hazırlık)"
        className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:ring-indigo-500/20"
      />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
          Vazgeç
        </button>
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() => onSubmit(name.trim())}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          Kaydet
        </button>
      </div>
    </ModalShell>
  );
}

function AddProductsToCollectionModal({ collection, onClose }: { collection: Collection; onClose: () => void }) {
  const favorites = useFavoritesStore((s) => s.items);
  const addItem = useAddToCollection();
  const removeItem = useRemoveFromCollection();
  // Yerel üyelik durumu (anlık geri bildirim); kaynak product_ids'ten başlar.
  const [ids, setIds] = useState<number[]>(collection.product_ids);

  function toggle(p: ProductSearchOut) {
    if (ids.includes(p.id)) {
      setIds((s) => s.filter((x) => x !== p.id));
      removeItem.mutate({ collectionId: collection.id, productId: p.id });
    } else {
      setIds((s) => [...s, p.id]);
      addItem.mutate({ collectionId: collection.id, productId: p.id });
    }
  }

  return (
    <ModalShell title={`"${collection.name}" listesine ekle`} onClose={onClose}>
      {favorites.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
          Önce ürünleri favorine ekle; buradan listene aktarabilirsin.
        </p>
      ) : (
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {favorites.map((p) => {
            const inList = ids.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <div className="h-12 w-10 shrink-0 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                  {p.cover_url && <img src={p.cover_url} alt="" className="h-full w-full object-cover" />}
                </div>
                <span className="line-clamp-2 flex-1 text-sm text-slate-800 dark:text-slate-200">{p.title}</span>
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                    inList ? "border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500" : "border-slate-300 dark:border-slate-600"
                  }`}
                >
                  {inList && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700">
          Bitti
        </button>
      </div>
    </ModalShell>
  );
}
