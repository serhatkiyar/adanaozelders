import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Seo } from "@/components/Seo";
import { StoreLandingBlocks } from "@/components/store/StoreLandingBlocks";
import { useLandingPage } from "@/hooks/useStoreMerchandising";
import { StoreLayout } from "@/pages/store/StoreLayout";

export default function StoreLandingPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const { data: page, isLoading, isError } = useLandingPage(slug);
  useEffect(() => {
    if (page && page.slug !== slug) navigate(`/magaza/${page.slug}`, { replace: true });
  }, [navigate, page, slug]);
  return (
    <StoreLayout title={page?.revision.title ?? "Mağaza"}>
      {page && (
        <Seo
          title={page.revision.seo_title}
          description={page.revision.seo_description}
          canonicalPath={`/magaza/${page.slug}`}
          image={page.revision.og_image_url ?? undefined}
        />
      )}
      {isLoading && (
        <div className="mx-auto max-w-[1464px] space-y-6 px-4 py-10 md:px-8">
          <div className="h-96 animate-pulse rounded-2xl bg-slate-100 " />
          <div className="h-48 animate-pulse rounded-2xl bg-slate-100 " />
        </div>
      )}
      {isError && (
        <div className="mx-auto max-w-2xl px-4 py-24 text-center">
          <h1 className="text-2xl font-semibold text-slate-950 ">
            Bu vitrin şu anda yayında değil
          </h1>
          <p className="mt-2 text-slate-500 ">
            Kampanya sona ermiş, arşivlenmiş veya henüz başlamamış olabilir.
          </p>
        </div>
      )}
      {page && <StoreLandingBlocks page={page} />}
    </StoreLayout>
  );
}
