import { Link } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { Seo } from "@/components/Seo";
import { StoreLayout } from "@/pages/store/StoreLayout";
import { ProductCard } from "@/components/store/ProductCard";
import { useFavoritesStore } from "@/store/favoritesStore";

const CONTAINER = "mx-auto max-w-screen-2xl px-4 md:px-8";
const GRID = "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

export default function FavoritesPage() {
  const items = useFavoritesStore((s) => s.items);

  return (
    <StoreLayout title="Favorilerim">
      <Seo title="Favorilerim — Adana Özel Ders" description="Beğendiğin ürünler." />

      <div className={`${CONTAINER} py-8`}>
        <h1 className="mb-6 text-xl font-semibold text-slate-900 dark:text-white">
          Favorilerim
          {items.length > 0 && (
            <span className="ml-2 text-base font-normal text-slate-400 dark:text-slate-500">
              ({items.length})
            </span>
          )}
        </h1>

        {items.length > 0 ? (
          <div className={GRID}>
            {items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-100 bg-white py-24 text-center dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 dark:bg-slate-800">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-400">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </div>
            <h3 className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">Henüz favorin yok</h3>
            <p className="text-slate-500 dark:text-slate-400">Beğendiğin ürünleri kalbe dokunarak buraya ekleyebilirsin.</p>
            <Link
              to={ROUTES.store}
              className="mt-6 inline-block rounded-full bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
            >
              Mağazaya dön
            </Link>
          </div>
        )}
      </div>
    </StoreLayout>
  );
}
