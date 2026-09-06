import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PlainButton } from "@/components/ui/PlainButton";
import { ROUTES } from "@/lib/routes";
import { StarRating } from "@/components/StarRating";
import { formatTL } from "@/lib/money";
import { useCartStore } from "@/store/cartStore";
import { useFavoritesStore } from "@/store/favoritesStore";
import { toast } from "@/store/toastStore";
import type { ProductSearchOut } from "@/types";

export function ProductCard({
  product,
  menu,
  showPurchaseAction = true,
}: {
  product: ProductSearchOut;
  /** Verilirse sağ-üstte kalp yerine bu render edilir (ör. favoriler/koleksiyon 3-nokta menüsü). */
  menu?: ReactNode;
  /** Ana sayfa vitrin şeritlerinde kartın tamamı ürün detayına yönlendirir; satın alma aksiyonu gösterilmez. */
  showPurchaseAction?: boolean;
}) {
  const add = useCartStore((s) => s.add);
  const toggleFav = useFavoritesStore((s) => s.toggle);
  const isFav = useFavoritesStore((s) => s.items.some((i) => i.id === product.id));

  const soldOut = !product.in_stock;
  const hasDiscount =
    !!product.compare_at_price &&
    Number(product.compare_at_price) > Number(product.price);
  const hasRating = product.rating_count > 0 && product.rating_average != null;
  // Grup kartı (Faz 3b): kart tek bir ürünü değil varyant grubunu temsil
  // eder — fiyat "X TL'den başlayan", aksiyon sepete ekleme değil seçime
  // (detaydaki varyant seçicisine) yönlendirme. Temsilci ürünü körlemesine
  // sepete eklemek, müşterinin seçmediği bir rengi satın aldırırdı.
  const grupKarti = (product.variant_count ?? 1) > 1;

  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition-colors hover:border-slate-300 ">
      {/* Görsel */}
      <div className="relative flex aspect-square shrink-0 items-center justify-center bg-white p-4 ">
        <Link to={ROUTES.storeProduct(product.slug)} className="absolute inset-0 z-0" aria-label={product.title} />

        {product.cover_url ? (
          <img
            src={product.cover_url}
            alt={product.title}
            loading="lazy"
            className="pointer-events-none z-0 max-h-full max-w-full object-contain mix-blend-multiply"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-200 ">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 5h11a2 2 0 0 1 2 2v12l-3-2-3 2-3-2-3 2V7a2 2 0 0 1 2-2Z" />
            </svg>
          </div>
        )}

        {/* Sağ üst: menü verilmişse onu, yoksa favori kalbini göster */}
        {menu ? (
          <div className="absolute right-3 top-3 z-10">{menu}</div>
        ) : (
          <PlainButton
            type="button"
            aria-label={isFav ? "Favorilerden çıkar" : "Favorilere ekle"}
            aria-pressed={isFav}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleFav(product);
            }}
            className={`absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200 transition-colors ${
              isFav ? "text-marka " : "text-slate-400 hover:text-marka "
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill={isFav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </PlainButton>
        )}
      </div>

      {/* İçerik */}
      <div className="flex flex-1 flex-col p-3 pt-3.5">
        {/* Satıcı / marka — sade, küçük, nötr */}
        {product.tutor_name && (
          <span className="mb-0.5 truncate text-xs text-slate-400 ">
            {product.tutor_name}
          </span>
        )}

        {/* Başlık */}
        <Link
          to={ROUTES.storeProduct(product.slug)}
          className="line-clamp-2 text-sm leading-snug text-slate-800 transition-colors hover:text-marka "
          title={product.title}
        >
          {product.title}
        </Link>

        {/* Yazar — başlığın hemen altında, sade */}
        {product.author && (
          <span className="mt-0.5 truncate text-xs text-slate-500 ">
            {product.author}
          </span>
        )}

        {/* Değerlendirme — yalnız gerçek veride; 5 yıldız (dolu/yarım/boş) */}
        {hasRating && (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
            <span className="font-medium text-slate-700 ">{product.rating_average!.toFixed(1)}</span>
            <StarRating value={product.rating_average} size={13} />
            <span className="text-slate-400">({product.rating_count})</span>
          </div>
        )}

        {/* Fiyat + sepete ekle */}
        <div className="mt-auto pt-3">
          <div className={`flex items-baseline gap-2 ${showPurchaseAction ? "mb-3" : ""}`}>
            {grupKarti ? (
              <span className="text-lg font-semibold text-slate-900 ">
                {formatTL(product.group_min_price ?? product.price)}
                <span className="ml-1 text-xs font-normal text-slate-500 ">
                  &apos;den başlayan
                </span>
              </span>
            ) : (
              <>
                <span className="text-lg font-semibold text-slate-900 ">
                  {formatTL(product.price)}
                </span>
                {hasDiscount && (
                  <span className="text-xs text-slate-400 line-through">
                    {formatTL(product.compare_at_price!)}
                  </span>
                )}
              </>
            )}
          </div>

          {showPurchaseAction && (grupKarti ? (
            <Link
              to={ROUTES.storeProduct(product.slug)}
              className="block w-full rounded-full border border-marka py-2 text-center text-sm font-semibold text-marka transition-colors hover:bg-marka-soft "
            >
              {soldOut ? "Tükendi" : `Seçenekleri Gör (${product.variant_count})`}
            </Link>
          ) : (
            <PlainButton
              type="button"
              disabled={soldOut}
              onClick={(e) => {
                e.preventDefault();
                add(product);
                toast.success("Sepete eklendi");
              }}
              className="w-full rounded-full bg-marka py-2 text-sm font-semibold text-white transition-colors hover:bg-marka-hover active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 "
            >
              {soldOut ? "Tükendi" : "Sepete Ekle"}
            </PlainButton>
          ))}
        </div>
      </div>
    </div>
  );
}
