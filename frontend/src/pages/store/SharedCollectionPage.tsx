import { Link, useParams } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { Seo } from "@/components/Seo";
import { StoreLayout } from "@/pages/store/StoreLayout";
import { ProductCard } from "@/components/store/ProductCard";
import { FullScreenSpinner } from "@/components/Spinner";
import { useSharedCollection } from "@/hooks/useStore";

const GRID = "grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5";

export default function SharedCollectionPage() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, isError } = useSharedCollection(token);

  if (isLoading) return <FullScreenSpinner />;

  if (isError || !data) {
    return (
      <StoreLayout title="Liste" showCategoryBar={false}>
        <Seo title="Liste, Mağaza" noindex />
        <div className="mx-auto max-w-md py-24 text-center">
          <p className="text-slate-600 ">Liste bulunamadı.</p>
          <Link to={ROUTES.store} className="mt-4 inline-block text-sm font-medium underline">
            Mağazaya dön
          </Link>
        </div>
      </StoreLayout>
    );
  }

  return (
    <StoreLayout title={data.name} showCategoryBar={false}>
      <Seo title={`${data.name}, Liste`} noindex />
      <div className="mx-auto max-w-[76rem] px-4 py-8 md:px-8">
        <p className="text-sm text-slate-400 ">Paylaşılan liste</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900 ">
          {data.name}
          <span className="ml-2 text-base font-normal text-slate-400 ">
            ({data.items.length})
          </span>
        </h1>

        {data.items.length > 0 ? (
          <div className={`${GRID} mt-6`}>
            {data.items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          <div className="mt-8 rounded-2xl border border-slate-200 py-20 text-center ">
            <p className="text-slate-500 ">Bu listede henüz ürün yok.</p>
          </div>
        )}
      </div>
    </StoreLayout>
  );
}
