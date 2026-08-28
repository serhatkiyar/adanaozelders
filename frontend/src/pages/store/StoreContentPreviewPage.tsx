import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import { previewLatestLandingPage } from "@/api/storeMerchandising";
import { Seo } from "@/components/Seo";
import { StoreLandingBlocks } from "@/components/store/StoreLandingBlocks";
import { StoreLayout } from "@/pages/store/StoreLayout";

export default function StoreContentPreviewPage() {
  const pageId = Number(useParams().pageId);
  const { data: page, isLoading, isError } = useQuery({
    queryKey: ["admin", "store", "page-preview", pageId, "latest"],
    queryFn: () => previewLatestLandingPage(pageId),
    enabled: Number.isFinite(pageId) && pageId > 0,
  });

  return (
    <StoreLayout title={page ? `${page.revision.title} — Önizleme` : "Mağaza önizleme"}>
      <Seo title="Mağaza önizleme" noindex />
      <div className="sticky top-[76px] z-30 border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm font-semibold text-amber-950 ">
        Taslak önizlemesi — ziyaretçiler bu sürümü henüz görmez
      </div>
      {isLoading && <div className="mx-auto my-12 h-96 max-w-[1464px] animate-pulse rounded-2xl bg-slate-100 " />}
      {isError && <p className="mx-auto max-w-2xl px-4 py-24 text-center text-slate-600 ">Önizleme hazırlanamadı.</p>}
      {page && <StoreLandingBlocks page={page} trackEvents={false} />}
    </StoreLayout>
  );
}
