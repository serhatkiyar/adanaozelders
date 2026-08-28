import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { uploadStoreMedia } from "@/api/storeMerchandising";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { BlogBodyEditor } from "@/components/admin/content/BlogBodyEditor";
import { Badge, Button, ConfirmDialog, ErrorState, PageSkeleton } from "@/components/admin/ui";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { GezinmeBaglantisi } from "@/components/admin/ui2/gezinmeBekcisi";
import {
  useAdminBlogPosts,
  useCreateBlogPost,
  useDeleteBlogPost,
  usePublishBlogPost,
  useUnpublishBlogPost,
  useUpdateBlogPost,
} from "@/hooks/useBlog";
import { getErrorDetail } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import type { BlogPostAdmin, BlogPostInput } from "@/types";

interface FormDurumu {
  title: string;
  slug: string;
  excerpt: string;
  body_html: string;
  cover_image_url: string | null;
  seo_title: string;
  seo_description: string;
  tags: string;
}

const BOS: FormDurumu = {
  title: "",
  slug: "",
  excerpt: "",
  body_html: "",
  cover_image_url: null,
  seo_title: "",
  seo_description: "",
  tags: "",
};

function fromPost(post: BlogPostAdmin): FormDurumu {
  return {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    body_html: post.body_html,
    cover_image_url: post.cover_image_url,
    seo_title: post.seo_title,
    seo_description: post.seo_description,
    tags: post.tags.join(", "),
  };
}

function toPayload(form: FormDurumu): BlogPostInput {
  return {
    title: form.title.trim(),
    slug: form.slug.trim() || null,
    excerpt: form.excerpt.trim(),
    body_html: form.body_html,
    cover_image_url: form.cover_image_url,
    seo_title: form.seo_title.trim(),
    seo_description: form.seo_description.trim(),
    tags: form.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 10),
  };
}

const ALAN =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:border-slate-500";
const ETIKET = "block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";

export default function AdminBlogEditorPage() {
  const { postId } = useParams<{ postId: string }>();
  const yeni = postId === undefined;
  const navigate = useNavigate();
  const { canView, canManage } = useAdminAreaAccess("content");

  // Tek yazı ucu yerine liste sorgusu paylaşılıyor: liste zaten önbellekte ve
  // kayıt sayısı düşük; ayrı bir GET /posts/:id sorgusu ekstra tur olurdu.
  const { data: posts, isLoading, isError, refetch } = useAdminBlogPosts();
  const post = useMemo(
    () => (yeni ? null : posts?.find((p) => String(p.id) === postId) ?? null),
    [posts, postId, yeni]
  );

  const [form, setForm] = useState<FormDurumu>(BOS);
  // Pencere durumu ekranda YAŞAMAZ (İP-A4 sözleşmesi): silinecek yazı yüzeyin hedefidir.
  const silmeYuzeyi = useDuzenlemeYuzeyi<BlogPostAdmin, void>();
  const yuklenenId = useRef<number | null>(null);

  useEffect(() => {
    if (post && yuklenenId.current !== post.id) {
      yuklenenId.current = post.id;
      setForm(fromPost(post));
    }
  }, [post]);

  const create = useCreateBlogPost();
  const update = useUpdateBlogPost();
  const publish = usePublishBlogPost();
  const unpublish = useUnpublishBlogPost();
  const remove = useDeleteBlogPost();
  const kaydediliyor = create.isPending || update.isPending;

  const alan = (k: keyof FormDurumu) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  if (!canView) return <AccessDenied area="Blog" />;

  if (!yeni && isLoading) return <PageSkeleton />;
  if (!yeni && isError)
    return (
      <ErrorState description="Yazı yüklenemedi." onRetry={() => void refetch()} />
    );
  if (!yeni && posts && !post)
    return <ErrorState title="Yazı bulunamadı" description="Bu yazı silinmiş olabilir." />;

  const kaydet = async (): Promise<BlogPostAdmin | null> => {
    if (!form.title.trim()) {
      toast.error("Başlık boş olamaz.");
      return null;
    }
    try {
      if (yeni) {
        const olusan = await create.mutateAsync(toPayload(form));
        toast.success("Taslak oluşturuldu.");
        navigate(ROUTES.adminBlogEdit(olusan.id), { replace: true });
        return olusan;
      }
      const guncel = await update.mutateAsync({ postId: post!.id, payload: toPayload(form) });
      toast.success("Kaydedildi.");
      return guncel;
    } catch (e) {
      toast.error(getErrorDetail(e, "Kaydedilemedi."));
      return null;
    }
  };

  const yayimla = async () => {
    // Yayın her zaman SON hali yayımlar: önce kaydet, sonra publish.
    const kayit = await kaydet();
    if (!kayit) return;
    try {
      await publish.mutateAsync(kayit.id);
      toast.success("Yazı yayımlandı.");
    } catch (e) {
      toast.error(getErrorDetail(e, "Yayımlanamadı."));
    }
  };

  const yayindanKaldir = async () => {
    if (!post) return;
    try {
      await unpublish.mutateAsync(post.id);
      toast.success("Yazı yayından kaldırıldı; taslak olarak duruyor.");
    } catch (e) {
      toast.error(getErrorDetail(e, "İşlem başarısız."));
    }
  };

  const sil = async () => {
    if (!post) return;
    try {
      await remove.mutateAsync(post.id);
      toast.success("Yazı silindi.");
      navigate(ROUTES.adminBlog, { replace: true });
    } catch (e) {
      toast.error(getErrorDetail(e, "Silinemedi."));
    }
  };

  const kapakYukle = async (file: File) => {
    try {
      const asset = await uploadStoreMedia(file, form.title || "Blog kapak görseli");
      setForm((f) => ({ ...f, cover_image_url: asset.image_url }));
    } catch (e) {
      toast.error(getErrorDetail(e, "Görsel yüklenemedi."));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <GezinmeBaglantisi
            to={ROUTES.adminBlog}
            className="text-sm text-slate-500 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          >
            ← Blog
          </GezinmeBaglantisi>
          {post &&
            (post.status === "PUBLISHED" ? (
              <Badge tone="success">Yayında</Badge>
            ) : (
              <Badge tone="neutral">Taslak</Badge>
            ))}
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            {post && (
              <Button variant="ghost" onClick={() => silmeYuzeyi.ac(post)}>
                Sil
              </Button>
            )}
            {post?.status === "PUBLISHED" && (
              <Button variant="secondary" isPending={unpublish.isPending} onClick={() => void yayindanKaldir()}>
                Yayından kaldır
              </Button>
            )}
            <Button variant="secondary" isPending={kaydediliyor} onClick={() => void kaydet()}>
              {yeni ? "Taslak oluştur" : "Kaydet"}
            </Button>
            <Button isPending={publish.isPending || kaydediliyor} onClick={() => void yayimla()}>
              {post?.status === "PUBLISHED" ? "Güncelle ve yayımla" : "Yayımla"}
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          <div>
            <label htmlFor="blog-baslik" className={ETIKET}>
              Başlık
            </label>
            <input
              id="blog-baslik"
              className={`${ALAN} mt-1.5 text-base font-medium`}
              value={form.title}
              onChange={alan("title")}
              placeholder="Örn. TYT matematikte netleri artırmanın 7 yolu"
              disabled={!canManage}
              maxLength={160}
            />
          </div>

          <div>
            <label htmlFor="blog-ozet" className={ETIKET}>
              Özet
            </label>
            <textarea
              id="blog-ozet"
              className={`${ALAN} mt-1.5`}
              rows={2}
              value={form.excerpt}
              onChange={alan("excerpt")}
              placeholder="Listede ve paylaşım önizlemesinde görünen 1-2 cümle."
              disabled={!canManage}
              maxLength={500}
            />
          </div>

          <div>
            <span className={ETIKET}>Gövde</span>
            <div className="mt-1.5">
              <BlogBodyEditor
                value={form.body_html}
                onChange={(html) => setForm((f) => ({ ...f, body_html: html }))}
                disabled={!canManage}
              />
            </div>
          </div>
        </div>

        <aside className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Kapak görseli</h3>
            {form.cover_image_url ? (
              <div className="mt-3 space-y-2">
                <img
                  src={form.cover_image_url}
                  alt=""
                  className="aspect-[16/9] w-full rounded-xl object-cover"
                />
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setForm((f) => ({ ...f, cover_image_url: null }))}
                  >
                    Görseli kaldır
                  </Button>
                )}
              </div>
            ) : canManage ? (
              <label className="mt-3 flex aspect-[16/9] cursor-pointer items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-500 transition hover:border-slate-400 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-500">
                Görsel seç (en fazla 12 MB)
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void kapakYukle(file);
                    e.target.value = "";
                  }}
                />
              </label>
            ) : (
              <p className="mt-3 text-sm text-slate-400 dark:text-slate-500">Görsel yok.</p>
            )}
          </div>

          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">SEO</h3>
            <div>
              <label htmlFor="blog-slug" className={ETIKET}>
                Adres (slug)
              </label>
              <input
                id="blog-slug"
                className={`${ALAN} mt-1.5 font-mono text-xs`}
                value={form.slug}
                onChange={alan("slug")}
                placeholder="bos-birakilirsa-basliktan-uretilir"
                disabled={!canManage}
                maxLength={140}
              />
              {post?.status === "PUBLISHED" && (
                <p className="mt-1 text-[11px] leading-snug text-slate-400 dark:text-slate-500">
                  Yayındaki yazının adresi değişirse eski link yeni adrese yönlenir.
                </p>
              )}
            </div>
            <div>
              <label htmlFor="blog-seo-baslik" className={ETIKET}>
                SEO başlığı
              </label>
              <input
                id="blog-seo-baslik"
                className={`${ALAN} mt-1.5`}
                value={form.seo_title}
                onChange={alan("seo_title")}
                placeholder="Boşsa yazı başlığı kullanılır"
                disabled={!canManage}
                maxLength={70}
              />
            </div>
            <div>
              <label htmlFor="blog-seo-aciklama" className={ETIKET}>
                SEO açıklaması
              </label>
              <textarea
                id="blog-seo-aciklama"
                className={`${ALAN} mt-1.5`}
                rows={3}
                value={form.seo_description}
                onChange={alan("seo_description")}
                placeholder="Arama sonucunda görünen açıklama (en fazla 200 karakter)."
                disabled={!canManage}
                maxLength={200}
              />
            </div>
            <div>
              <label htmlFor="blog-etiketler" className={ETIKET}>
                Etiketler
              </label>
              <input
                id="blog-etiketler"
                className={`${ALAN} mt-1.5`}
                value={form.tags}
                onChange={alan("tags")}
                placeholder="tyt, matematik, çalışma teknikleri"
                disabled={!canManage}
              />
              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                Virgülle ayırın; en fazla 10 etiket.
              </p>
            </div>
          </div>

          {post?.status === "PUBLISHED" && (
            <a
              href={ROUTES.blogPost(post.slug)}
              target="_blank"
              rel="noreferrer"
              className="block rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-700"
            >
              Yazıyı sitede görüntüle ↗
            </a>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={silmeYuzeyi.acik}
        title="Yazı silinsin mi?"
        description="Yazı yayından kalkar ve listeden kaldırılır. Bu işlem panelden geri alınamaz."
        confirmLabel="Sil"
        danger
        isPending={remove.isPending}
        onConfirm={() => void sil()}
        onClose={silmeYuzeyi.kapat}
      />
    </div>
  );
}
