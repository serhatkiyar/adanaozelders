import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { isAxiosError } from "axios";

import { JsonLd } from "@/components/JsonLd";
import { PublicShell } from "@/components/PublicShell";
import { Seo } from "@/components/Seo";
import { useBlogPost } from "@/hooks/useBlog";
import { absoluteUrl } from "@/lib/seo";
import { ROUTES } from "@/lib/routes";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Slug değişmiş yazının eski linki: backend 404 detayında yeni slug'ı verir. */
function redirectSlugOf(error: unknown): string | null {
  if (!isAxiosError(error)) return null;
  const detail = (error.response?.data as { detail?: { redirect_slug?: string } } | undefined)
    ?.detail;
  return typeof detail === "object" && detail?.redirect_slug ? detail.redirect_slug : null;
}

/**
 * Gövde sunucuda sanitize edilmiş HTML'dir (`services/blog_service.py`
 * allowlist'i) — dangerouslySetInnerHTML yalnız o kolonla kullanılır.
 * Tipografi: typography eklentisi yok; kapsamlı arbitrary-variant sınıfları.
 */
const BODY_CLASS = [
  "mt-8 text-[15px] leading-relaxed text-slate-700 ",
  "[&_p]:mt-4",
  "[&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-slate-900 ",
  "[&_h3]:mt-8 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-slate-900 ",
  "[&_h4]:mt-6 [&_h4]:font-semibold [&_h4]:text-slate-900 ",
  "[&_a]:font-medium [&_a]:text-slate-900 [&_a]:underline [&_a]:underline-offset-2 ",
  "[&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mt-1",
  "[&_blockquote]:mt-6 [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-4 [&_blockquote]:italic ",
  "[&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px] ",
  "[&_pre]:mt-6 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-slate-900 [&_pre]:p-4 [&_pre]:text-slate-100 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_img]:mt-6 [&_img]:rounded-xl",
  "[&_hr]:my-10 [&_hr]:border-slate-200 ",
  "[&_table]:mt-6 [&_table]:w-full [&_table]:text-sm [&_th]:border-b [&_th]:border-slate-200 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_td]:border-b [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-2 ",
].join(" ");

export default function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: post, isLoading, error } = useBlogPost(slug);

  const redirectSlug = redirectSlugOf(error);
  useEffect(() => {
    if (redirectSlug) navigate(ROUTES.blogPost(redirectSlug), { replace: true });
  }, [redirectSlug, navigate]);

  return (
    <PublicShell>
      {post && (
        <Seo
          title={post.seo_title || post.title}
          description={post.seo_description || post.excerpt}
          canonicalPath={ROUTES.blogPost(post.slug)}
          image={post.cover_image_url ?? undefined}
          type="article"
        >
          <JsonLd
            data={{
              "@context": "https://schema.org",
              "@type": "BlogPosting",
              headline: post.title,
              description: post.seo_description || post.excerpt,
              datePublished: post.published_at,
              ...(post.updated_at ? { dateModified: post.updated_at } : {}),
              ...(post.cover_image_url ? { image: absoluteUrl(post.cover_image_url) } : {}),
              mainEntityOfPage: absoluteUrl(ROUTES.blogPost(post.slug)),
            }}
          />
        </Seo>
      )}

      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <Link
          to={ROUTES.blog}
          className="text-sm text-slate-500 transition hover:text-slate-900 "
        >
          ← Blog
        </Link>

        {isLoading ? (
          <div className="mt-8 space-y-4" aria-hidden>
            <div className="h-8 w-3/4 animate-pulse rounded bg-slate-100 " />
            <div className="h-4 w-1/3 animate-pulse rounded bg-slate-100 " />
            <div className="mt-8 h-64 animate-pulse rounded-2xl bg-slate-100 " />
          </div>
        ) : !post ? (
          !redirectSlug && (
            <div className="mt-12">
              {/* Yumuşak 404'ü (200 + "bulunamadı") dizinden uzak tut: meta
                  vermezsek sayfa ana sayfanın jenerik başlığıyla indekslenir. */}
              <Seo title="Yazı bulunamadı" noindex />
              <h1 className="text-xl font-semibold text-slate-900 ">
                Yazı bulunamadı
              </h1>
              <p className="mt-2 text-sm text-slate-500 ">
                Aradığınız yazı kaldırılmış ya da hiç yayımlanmamış olabilir.
              </p>
            </div>
          )
        ) : (
          <article className="mt-6">
            <header>
              <time
                className="text-sm text-slate-400 "
                dateTime={post.published_at}
              >
                {formatDate(post.published_at)}
              </time>
              <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight text-slate-900 ">
                {post.title}
              </h1>
              {post.excerpt && (
                <p className="mt-4 text-base leading-relaxed text-slate-500 ">
                  {post.excerpt}
                </p>
              )}
            </header>

            {post.cover_image_url && (
              <div className="mt-8 overflow-hidden rounded-2xl bg-slate-100 ">
                <img src={post.cover_image_url} alt="" className="w-full object-cover" />
              </div>
            )}

            <div className={BODY_CLASS} dangerouslySetInnerHTML={{ __html: post.body_html }} />

            {post.tags.length > 0 && (
              <footer className="mt-12 flex flex-wrap gap-2 border-t border-slate-200 pt-6 ">
                {post.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-500 "
                  >
                    {tag}
                  </span>
                ))}
              </footer>
            )}
          </article>
        )}
      </div>
    </PublicShell>
  );
}
