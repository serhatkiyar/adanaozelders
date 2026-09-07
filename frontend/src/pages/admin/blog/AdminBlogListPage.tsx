import { useNavigate } from "react-router-dom";

import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { Badge, Button, EmptyState, ErrorState, PageSkeleton } from "@/components/admin/ui";
import { GezinmeBaglantisi } from "@/components/admin/ui2/gezinmeBekcisi";
import { useAdminBlogPosts } from "@/hooks/useBlog";
import { ROUTES } from "@/lib/routes";
import type { BlogPostAdmin } from "@/types";

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function SatirDurumu({ post }: { post: BlogPostAdmin }) {
  return post.status === "PUBLISHED" ? (
    <Badge tone="success">Yayında</Badge>
  ) : (
    <Badge tone="neutral">Taslak</Badge>
  );
}

export default function AdminBlogListPage() {
  const navigate = useNavigate();
  const { canView, canManage } = useAdminAreaAccess("content");
  const { data: posts, isLoading, isError, refetch } = useAdminBlogPosts();

  if (!canView) return <AccessDenied area="Blog" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 ">Blog yazıları</h2>
          <p className="mt-1 text-sm text-slate-500 ">
            Yayımlanan yazılar <span className="font-medium">/blog</span> altında herkese açık
            görünür ve sitemap'e girer.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => navigate(ROUTES.adminBlogNew)}>Yeni yazı</Button>
        )}
      </div>

      {isLoading ? (
        <PageSkeleton />
      ) : isError ? (
        <ErrorState
          description="Blog yazıları alınamadı. Bağlantınızı kontrol edip yeniden deneyin."
          onRetry={() => void refetch()}
        />
      ) : !posts || posts.length === 0 ? (
        <EmptyState
          title="Henüz yazı yok"
          description={
            canManage
              ? "İlk blog yazınızı oluşturun; taslak olarak kaydedilir, siz yayımlayana kadar görünmez."
              : "Henüz oluşturulmuş bir blog yazısı yok."
          }
          action={canManage ? <Button onClick={() => navigate(ROUTES.adminBlogNew)}>Yeni yazı</Button> : undefined}
        />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white ">
          {posts.map((post) => (
            <li key={post.id}>
              <GezinmeBaglantisi
                to={ROUTES.adminBlogEdit(post.id)}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 transition hover:bg-slate-50 "
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900 ">
                    {post.title}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-400 ">
                    /blog/{post.slug}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-4 text-sm">
                  <span className="hidden text-xs text-slate-400 sm:block ">
                    {post.status === "PUBLISHED"
                      ? `Yayın: ${formatDate(post.published_at)}`
                      : `Güncelleme: ${formatDate(post.updated_at)}`}
                  </span>
                  <SatirDurumu post={post} />
                </div>
              </GezinmeBaglantisi>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
