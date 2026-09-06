import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import { alisverisYapabilir } from "@/lib/roles";
import type { Collection, ProductSearchOut } from "@/types";
import { toast } from "@/store/toastStore";

const CONTAINER = "mx-auto max-w-[76rem] px-4 md:px-8";
/** Sağ panel ızgarası (kenar çubuğu genişlik aldığı için 4 sütun). */
const GRID = "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4";

const tr = (s: string) => s.toLocaleLowerCase("tr");

/** Kenar çubuğu seçimi: en üstte varsayılan "Favori Listem", altında koleksiyonlar. */
type Selection = { kind: "favorites" } | { kind: "collection"; id: number };

export default function FavoritesPage() {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const alisverisAcik = !!token && alisverisYapabilir(user?.role_id);

  const favCount = useFavoritesStore((s) => s.items.length);
  const { data: collections } = useCollections(alisverisAcik);
  const createCol = useCreateCollection();
  const renameCol = useRenameCollection();
  const deleteCol = useDeleteCollection();

  const [sel, setSel] = useState<Selection>({ kind: "favorites" });
  const [nameModal, setNameModal] = useState<{ mode: "create" | "rename"; col?: Collection } | null>(null);
  const [addProductsTo, setAddProductsTo] = useState<Collection | null>(null);

  // Seçili koleksiyon silinmiş/bulunamıyorsa varsayılana (Favori Listem) düş.
  const selectedCol =
    sel.kind === "collection" ? ((collections ?? []).find((c) => c.id === sel.id) ?? null) : null;
  const showFavorites = selectedCol === null;

  const rowClass = (active: boolean) =>
    `flex w-full items-baseline justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
      active
        ? "bg-slate-100 font-semibold text-slate-900 "
        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 "
    }`;

  return (
    <StoreLayout title="Listelerim">
      <Seo title="Listelerim, Adana Özel Ders" description="Beğendiğin ürünler ve listelerin." />

      <div className={`${CONTAINER} py-8`}>
        <div className="grid gap-8 md:grid-cols-[15rem_minmax(0,1fr)]">
          {/* Sol: Favori Listem + koleksiyonlar alt alta */}
          <aside className="md:border-r md:border-slate-100 md:pr-6 ">
            <button
              type="button"
              onClick={() =>
                alisverisAcik ? setNameModal({ mode: "create" }) : navigate("?modal=login")
              }
              className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-marka transition-colors hover:text-marka-hover "
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Liste oluştur
            </button>

            <nav className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => setSel({ kind: "favorites" })}
                className={rowClass(showFavorites)}
              >
                <span className="truncate">Favori Listem</span>
                <span className="shrink-0 text-xs font-normal text-slate-400 ">
                  {favCount}
                </span>
              </button>
              {(collections ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSel({ kind: "collection", id: c.id })}
                  className={rowClass(selectedCol?.id === c.id)}
                >
                  <span className="truncate">{c.name}</span>
                  <span className="shrink-0 text-xs font-normal text-slate-400 ">
                    {c.product_ids.length}
                  </span>
                </button>
              ))}
            </nav>

            {!alisverisAcik && (
              <p className="mt-4 border-t border-slate-100 pt-4 text-xs leading-relaxed text-slate-400 ">
                Kendi listelerini oluşturmak için{" "}
                <Link to="?modal=login" className="font-semibold text-marka hover:underline ">
                  giriş yap
                </Link>
                .
              </p>
            )}
          </aside>

          {/* Sağ: seçili listenin içeriği */}
          <section className="min-w-0">
            {showFavorites ? (
              <FavoritesPane alisverisAcik={alisverisAcik} />
            ) : (
              <CollectionPane
                key={selectedCol.id}
                collection={selectedCol}
                onAddProducts={() => setAddProductsTo(selectedCol)}
                onRename={() => setNameModal({ mode: "rename", col: selectedCol })}
                onDelete={() => {
                  if (confirm(`"${selectedCol.name}" listesini silmek istediğine emin misin?`)) {
                    deleteCol.mutate(selectedCol.id, {
                      onSuccess: () => {
                        setSel({ kind: "favorites" });
                        toast.success("Liste silindi");
                      },
                    });
                  }
                }}
              />
            )}
          </section>
        </div>
      </div>

      {nameModal && (
        <CollectionNameModal
          mode={nameModal.mode}
          initial={nameModal.col?.name}
          onClose={() => setNameModal(null)}
          onSubmit={(name) => {
            if (nameModal.mode === "create") {
              createCol.mutate(name, {
                onSuccess: (col) => {
                  toast.success("Liste oluşturuldu");
                  setSel({ kind: "collection", id: col.id });
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
    </StoreLayout>
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
        className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm outline-none transition-colors focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
      />
    </div>
  );
}

function EmptyBox({ title, desc, cta }: { title: string; desc: string; cta?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white py-20 text-center ">
      <h3 className="mb-1 text-lg font-semibold text-slate-900 ">{title}</h3>
      <p className="text-slate-500 ">{desc}</p>
      {cta}
    </div>
  );
}

/* ── Sağ panel: Favori Listem (kalp favorileri, localStorage) ── */
function FavoritesPane({ alisverisAcik }: { alisverisAcik: boolean }) {
  const navigate = useNavigate();
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
      <h2 className="text-xl font-semibold text-slate-900 ">
        Favori Listem
        {items.length > 0 && (
          <span className="ml-2 text-base font-normal text-slate-400 ">({items.length})</span>
        )}
      </h2>

      {items.length > 0 && (
        <div className="mt-4">
          <SearchBox value={q} onChange={setQ} placeholder="Favori Listem'de ara" />
        </div>
      )}

      <div className="mt-5">
        {items.length === 0 ? (
          <EmptyBox
            title="Henüz favorin yok"
            desc="Beğendiğin ürünleri kalbe dokunarak buraya ekleyebilirsin."
            cta={
              <Link to={ROUTES.store} className="mt-6 inline-block rounded-full bg-marka px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-marka-hover">
                Mağazaya dön
              </Link>
            }
          />
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500 ">"{q}" için sonuç yok.</p>
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
                        label: "Listelerime ekle",
                        // Koleksiyonlar oturum ister — anonim tıklamada giriş modalı.
                        onClick: () => (alisverisAcik ? setAddTarget(p) : navigate("?modal=login")),
                      },
                      { label: "Sil", danger: true, onClick: () => removeFav(p.id) },
                    ]}
                  />
                }
              />
            ))}
          </div>
        )}
      </div>

      {addTarget && <AddToCollectionModal product={addTarget} onClose={() => setAddTarget(null)} />}
    </>
  );
}

/** Seçili listenin sağ paneli: başlık + aksiyonlar + ürün ızgarası. */
function CollectionPane({
  collection,
  onAddProducts,
  onRename,
  onDelete,
}: {
  collection: Collection;
  onAddProducts: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { data, isLoading } = useCollection(collection.id);
  const removeItem = useRemoveFromCollection();
  const [q, setQ] = useState("");

  const items = data?.items ?? [];
  const filtered = useMemo(
    () => (q.trim() ? items.filter((p) => tr(p.title).includes(tr(q))) : items),
    [items, q]
  );

  function share() {
    const url = `${window.location.origin}${ROUTES.storeCollectionShared(collection.share_token)}`;
    if (navigator.share) {
      navigator.share({ title: collection.name, url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => toast.success("Bağlantı kopyalandı"));
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="min-w-0 truncate text-xl font-semibold text-slate-900 ">
          {collection.name}
          {items.length > 0 && (
            <span className="ml-2 text-base font-normal text-slate-400 ">({items.length})</span>
          )}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onAddProducts}
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-marka-mid hover:text-marka "
          >
            Ürün ekle
          </button>
          <button
            type="button"
            aria-label="Paylaş"
            onClick={share}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition-colors hover:border-marka-mid hover:text-marka "
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
              { label: "Liste ismini düzenle", onClick: onRename },
              { label: "Listeyi sil", danger: true, onClick: onDelete },
            ]}
          />
        </div>
      </div>

      {items.length > 0 && (
        <div className="mt-4">
          <SearchBox value={q} onChange={setQ} placeholder="Bu listede ara" />
        </div>
      )}

      <div className="mt-5">
        {isLoading ? (
          <p className="py-12 text-center text-sm text-slate-400">Yükleniyor…</p>
        ) : items.length === 0 ? (
          <EmptyBox title="Bu liste boş" desc="“Ürün ekle” ile favorilerinden bu listeye ürün ekleyebilirsin." />
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500 ">"{q}" için sonuç yok.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
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
                          removeItem.mutate({ collectionId: collection.id, productId: p.id }),
                      },
                    ]}
                  />
                }
              />
            ))}
          </div>
        )}
      </div>
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
      <p className="mb-3 line-clamp-1 text-sm text-slate-500 ">{product.title}</p>

      <div className="max-h-64 space-y-1 overflow-y-auto">
        {collections && collections.length > 0 ? (
          collections.map((c) => {
            const inList = c.product_ids.includes(product.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c)}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-slate-50 "
              >
                <span className="text-slate-800 ">{c.name}</span>
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded border ${
                    inList ? "border-marka bg-marka text-white " : "border-slate-300 "
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

      <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4 ">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createAndAdd()}
          placeholder="Yeni liste oluştur"
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-marka-mid "
        />
        <button
          type="button"
          disabled={!newName.trim() || createCol.isPending}
          onClick={createAndAdd}
          className="shrink-0 rounded-lg bg-marka px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-marka-hover disabled:opacity-50"
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
        className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
      />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 ">
          Vazgeç
        </button>
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() => onSubmit(name.trim())}
          className="rounded-lg bg-marka px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-marka-hover disabled:opacity-50"
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
        <p className="py-6 text-center text-sm text-slate-500 ">
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
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-slate-50 "
              >
                <div className="h-12 w-10 shrink-0 overflow-hidden rounded bg-slate-100 ">
                  {p.cover_url && <img src={p.cover_url} alt="" className="h-full w-full object-cover" />}
                </div>
                <span className="line-clamp-2 flex-1 text-sm text-slate-800 ">{p.title}</span>
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                    inList ? "border-marka bg-marka text-white " : "border-slate-300 "
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
        <button type="button" onClick={onClose} className="rounded-lg bg-marka px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-marka-hover">
          Bitti
        </button>
      </div>
    </ModalShell>
  );
}
