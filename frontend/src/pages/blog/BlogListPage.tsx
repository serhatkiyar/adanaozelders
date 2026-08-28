import { useState } from "react";
import { Link } from "react-router-dom";

import { PublicShell } from "@/components/PublicShell";
import { Seo } from "@/components/Seo";
import { useBlogPosts } from "@/hooks/useBlog";
import { ROUTES } from "@/lib/routes";
import type { BlogPostSummary } from "@/types";

const PAGE_SIZE = 12;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function PostCard({ post }: { post: BlogPostSummary }) {
  return (
    <Link
      to={ROUTES.blogPost(post.slug)}
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
    >
      {post.cover_image_url ? (
        <div className="aspect-[16/9] overflow-hidden bg-slate-100 dark:bg-slate-800">
          <img
            src={post.cover_image_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
          />
        </div>
      ) : (
        <div className="aspect-[16/9] bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900" />
      )}
      <div className="flex flex-1 flex-col p-5">
        <time className="text-xs text-slate-400 dark:text-slate-500" dateTime={post.published_at}>
          {formatDate(post.published_at)}
        </time>
        <h2 className="mt-2 text-base font-semibold leading-snug text-slate-900 group-hover:underline dark:text-white">
          {post.title}
        </h2>
        {post.excerpt && (
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            {post.excerpt}
          </p>
        )}
        {post.tags.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

export default function BlogListPage() {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const { data, isLoading, isError } = useBlogPosts({ limit: visible, offset: 0 });

  return (
    <PublicShell>
      <Seo
        title="Blog"
        description="Ders çalışma teknikleri, sınav hazırlığı ve eğitim üzerine rehberler."
        canonicalPath={ROUTES.blog}
      />

      <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
        <header className="max-w-2xl">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
            Blog
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Ders çalışma teknikleri, sınav hazırlığı ve eğitim üzerine rehberler.
          </p>
        </header>

        {isLoading ? (
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-72 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
            ))}
          </div>
        ) : isError ? (
          <p className="mt-10 text-sm text-slate-500 dark:text-slate-400">
            Yazılar yüklenemedi. Lütfen daha sonra tekrar deneyin.
          </p>
        ) : !data || data.items.length === 0 ? (
          <p className="mt-10 text-sm text-slate-500 dark:text-slate-400">
            Henüz yayımlanmış yazı yok.
          </p>
        ) : (
          <>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {data.items.map((post) => (
                <PostCard key={post.slug} post={post} />
              ))}
            </div>
            {data.total > data.items.length && (
              <div className="mt-10 text-center">
                <button
                  type="button"
                  onClick={() => setVisible((v) => v + PAGE_SIZE)}
                  className="rounded-full border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Daha fazla göster
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </PublicShell>
  );
}
