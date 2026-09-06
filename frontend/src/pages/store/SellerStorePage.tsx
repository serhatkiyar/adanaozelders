import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { Seo } from "@/components/Seo";
import { StoreLayout } from "@/pages/store/StoreLayout";
import { ProductCard } from "@/components/store/ProductCard";
import { FullScreenSpinner } from "@/components/Spinner";
import { useProducts } from "@/hooks/useStore";

const GRID = "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

// Satıcı (eğitmen) mağaza vitrini — bir eğitmenin yayındaki tüm dijital ürünleri.
export default function SellerStorePage() {
  const { tutorId } = useParams<{ tutorId: string }>();
  const id = tutorId ? Number(tutorId) : undefined;
  const { data: products, isLoading } = useProducts({
    tutor_id: id ?? -1,
    limit: 48,
  });
  const sellerName = useMemo(
    () => products?.find((p) => p.tutor_name)?.tutor_name ?? "Satıcı",
    [products]
  );

  if (isLoading) return <FullScreenSpinner />;

  return (
    <StoreLayout title={sellerName} showCategoryBar={false}>
      <Seo title={`${sellerName}, Mağaza`} noindex />
      <div className="mx-auto max-w-[1464px] px-4 py-8 md:px-8">
        <nav className="flex items-center gap-1.5 text-sm text-slate-500 ">
          <Link to={ROUTES.store} className="hover:text-marka ">
            Mağaza
          </Link>
          <span className="text-slate-300 ">/</span>
          <span className="text-slate-700 ">{sellerName}</span>
        </nav>

        <div className="mt-4 flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-marka-soft text-lg font-semibold text-marka-hover ">
            {sellerName.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 ">{sellerName}</h1>
            <p className="text-sm text-slate-400">{products?.length ?? 0} ürün</p>
          </div>
        </div>

        {products && products.length > 0 ? (
          <div className={`mt-8 ${GRID}`}>
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          <p className="mt-16 text-center text-sm text-slate-500">
            Bu satıcının yayında ürünü yok.
          </p>
        )}
      </div>
    </StoreLayout>
  );
}
