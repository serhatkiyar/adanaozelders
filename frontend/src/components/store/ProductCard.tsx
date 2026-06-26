import { Link } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { formatTRY } from "@/lib/money";
import { useCartStore } from "@/store/cartStore";
import { useFavoritesStore } from "@/store/favoritesStore";
import { toast } from "@/store/toastStore";
import type { ProductSearchOut } from "@/types";

export function ProductCard({ product }: { product: ProductSearchOut }) {
  const add = useCartStore((s) => s.add);
  const toggleFav = useFavoritesStore((s) => s.toggle);
  const isFav = useFavoritesStore((s) => s.items.some((i) => i.id === product.id));

  const soldOut = !product.in_stock;
  const hasDiscount =
    !!product.compare_at_price &&
    Number(product.compare_at_price) > Number(product.price);
  const hasRating = product.rating_count > 0 && product.rating_average != null;

  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700">
      {/* Görsel */}
      <div className="relative flex aspect-square shrink-0 items-center justify-center bg-white p-4 dark:bg-slate-900/50">
        <Link to={ROUTES.storeProduct(product.slug)} className="absolute inset-0 z-0" aria-label={product.title} />

        {product.cover_url ? (
          <img
            src={product.cover_url}
            alt={product.title}
            loading="lazy"
            className="pointer-events-none z-0 max-h-full max-w-full object-contain mix-blend-multiply transition-transform duration-500 group-hover:scale-[1.02] dark:mix-blend-normal"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-200 dark:text-slate-700">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 5h11a2 2 0 0 1 2 2v12l-3-2-3 2-3-2-3 2V7a2 2 0 0 1 2-2Z" />
            </svg>
          </div>
        )}

        {/* Favori */}
        <button
          type="button"
          aria-label={isFav ? "Favorilerden çıkar" : "Favorilere ekle"}
          aria-pressed={isFav}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleFav(product);
          }}
          className={`absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200 transition-colors dark:bg-slate-800 dark:ring-slate-700 ${
            isFav ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400"
          }`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill={isFav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>
      </div>

      {/* İçerik */}
      <div className="flex flex-1 flex-col p-3 pt-3.5">
        {/* Satıcı / marka — sade, küçük, nötr */}
        {product.tutor_name && (
          <span className="mb-0.5 truncate text-xs text-slate-400 dark:text-slate-500">
            {product.tutor_name}
          </span>
        )}

        {/* Başlık */}
        <Link
          to={ROUTES.storeProduct(product.slug)}
          className="line-clamp-2 text-sm leading-snug text-slate-800 transition-colors hover:text-indigo-600 dark:text-slate-200 dark:hover:text-indigo-400"
          title={product.title}
        >
          {product.title}
        </Link>

        {/* Değerlendirme — yalnız gerçek veride */}
        {hasRating && (
          <div className="mt-1.5 flex items-center gap-1 text-xs text-slate-500">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            <span className="font-medium text-slate-700 dark:text-slate-300">{product.rating_average!.toFixed(1)}</span>
            <span className="text-slate-400">({product.rating_count})</span>
          </div>
        )}

        {/* Fiyat + sepete ekle */}
        <div className="mt-auto pt-3">
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-lg font-semibold text-slate-900 dark:text-white">
              {formatTRY(product.price)}
            </span>
            {hasDiscount && (
              <span className="text-xs text-slate-400 line-through">
                {formatTRY(product.compare_at_price!)}
              </span>
            )}
          </div>

          <button
            type="button"
            disabled={soldOut}
            onClick={(e) => {
              e.preventDefault();
              add(product);
              toast.success("Sepete eklendi");
            }}
            className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
          >
            {soldOut ? "Tükendi" : "Sepete Ekle"}
          </button>
        </div>
      </div>
    </div>
  );
}
