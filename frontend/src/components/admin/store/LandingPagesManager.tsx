import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";

import { previewLandingPage } from "@/api/storeMerchandising";
import { Button } from "@/components/admin/ui";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/yuzeyDurumu";
import { Modal } from "@/components/ui/Modal";
import { PlainButton } from "@/components/ui/PlainButton";
import { useCategories } from "@/hooks/useStore";
import {
  useLandingPageRevisions,
  useLandingPagePublications,
  useLandingPages,
  useMerchandisingMutations,
  useProductSets,
  useStoreMedia,
  useStorePageMetrics,
} from "@/hooks/useStoreMerchandising";
import { getErrorDetail } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import type {
  LandingPage,
  LandingPageBlockInput,
  LandingPageBlockType,
  LandingPageRevisionInput,
  ProductCategory,
  ProductSet,
  StoreMediaAsset,
} from "@/types";

const BLOCK_NAMES: Record<LandingPageBlockType, string> = {
  HERO_CAROUSEL: "Dönen büyük görseller",
  IMAGE_CARD_GRID: "Resimli kart grubu",
  CATEGORY_GRID: "Kategori bağlantıları",
  PRODUCT_RAIL: "Ürün vitrini",
  BANNER: "Tek geniş görsel",
  RICH_TEXT: "Metin alanı",
  RECENTLY_VIEWED: "Son görüntülenenler",
};

const BLOCK_DESCRIPTIONS: Record<LandingPageBlockType, string> = {
  HERO_CAROUSEL: "Sayfanın üstünde sırayla değişen kampanya görselleri.",
  IMAGE_CARD_GRID: "Birbiriyle ilgili 2–4 görsel bağlantıyı yan yana gösterir.",
  CATEGORY_GRID: "Seçtiğiniz mağaza kategorilerine kısa yollar ekler.",
  PRODUCT_RAIL: "Bir ürün grubunu yatay vitrin olarak gösterir.",
  BANNER: "Tek bir yatay kampanya görseli gösterir.",
  RICH_TEXT: "Başlık, açıklama veya bilgilendirme metni ekler.",
  RECENTLY_VIEWED: "Ziyaretçinin daha önce baktığı ürünleri gösterir.",
};

const localDateTime = () => {
  const now = new Date(Date.now() + 60_000);
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
};

const freshBlockKey = () => crypto.randomUUID();

/**
 * Sunucunun blok başına ürettiği uyarıları blok anahtarına eşler.
 *
 * Uyarılar TASLAKTA yaşamaz (taslak kurulurken ayıklanır, çünkü kaydedilen
 * yükün parçası değildir); kaynakları her zaman sunucudan gelen önizleme
 * revizyonudur.
 */
export function warningsByBlockKey(
  blocks: { block_key?: string | null; warnings?: string[] }[] | undefined,
): Record<string, string[]> {
  const harita: Record<string, string[]> = {};
  for (const block of blocks ?? []) {
    if (!block.block_key) continue;
    if (block.warnings?.length) harita[block.block_key] = block.warnings;
  }
  return harita;
}

/** Blok uyarılarını yöneticiye gösterir. Uyarı yoksa hiçbir şey basmaz. */
export function BlockWarnings({ warnings = [] }: { warnings?: string[] }) {
  // Varsayılan ŞART: çalışma zamanı kapısı dışa aktarılan her bileşeni
  // PROPSUZ render eder; `warnings.length` orada çöküyordu (ölçüldü).
  if (!warnings.length) return null;
  return (
    <ul
      role="alert"
      className="space-y-1 border-l-2 border-amber-400 bg-amber-50/60 py-2 pl-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
    >
      {warnings.map((uyari) => (
        <li key={uyari}>{uyari}</li>
      ))}
    </ul>
  );
}

export function duplicateLandingBlock(
  block: LandingPageBlockInput,
  index: number,
): LandingPageBlockInput {
  return {
    ...block,
    block_key: freshBlockKey(),
    title: block.title ? `${block.title} (kopya)` : block.title,
    config: structuredClone(block.config),
    sort_order: index * 10,
  };
}

export function appendMediaToLandingBlock(
  block: LandingPageBlockInput,
  asset: StoreMediaAsset,
): LandingPageBlockInput {
  if (block.block_type === "BANNER") {
    return {
      ...block,
      config: {
        ...block.config,
        image_url: asset.image_url,
        alt_text: asset.alt_text,
        decorative: !asset.alt_text,
        fit: "cover",
      },
    };
  }
  if (!["HERO_CAROUSEL", "IMAGE_CARD_GRID"].includes(block.block_type)) {
    return block;
  }
  const itemsKey = block.block_type === "HERO_CAROUSEL" ? "slides" : "cards";
  const items =
    (block.config[itemsKey] as Array<Record<string, unknown>> | undefined) ?? [];
  if (items.some((item) => item.image_url === asset.image_url)) return block;
  return {
    ...block,
    config: {
      ...block.config,
      [itemsKey]: [
        ...items,
        {
          image_url: asset.image_url,
          alt_text: asset.alt_text,
          decorative: !asset.alt_text,
          fit: block.block_type === "HERO_CAROUSEL" ? "cover" : "contain",
          label: "",
          link_url: "",
        },
      ],
    },
  };
}

export function composeLandingDraftPreview(
  page: LandingPage,
  draft: LandingPageRevisionInput,
  productSets: ProductSet[],
  categories: ProductCategory[],
): LandingPage {
  const existing = new Map(
    page.revision.blocks.map((block) => [block.block_key, block]),
  );
  return {
    ...page,
    state: "DRAFT",
    revision: {
      ...page.revision,
      title: draft.title,
      seo_title: draft.seo_title,
      seo_description: draft.seo_description,
      og_image_url: draft.og_image_url,
      blocks: draft.blocks
        .filter((block) => block.is_active)
        .map((block, index) => {
          const blockKey = block.block_key || `preview-${index}`;
          const previous = existing.get(blockKey);
          const productSet = productSets.find(
            (set) =>
              set.id === block.product_set_id ||
              set.revision.id === block.product_set_revision_id,
          );
          const categoryIds =
            (block.config.category_ids as number[] | undefined) ?? [];
          return {
            ...block,
            id: previous?.id ?? -(index + 1),
            block_key: blockKey,
            sort_order: index * 10,
            products:
              block.block_type === "PRODUCT_RAIL"
                ? (productSet?.preview_products ?? [])
                : (previous?.products ?? []),
            categories:
              block.block_type === "CATEGORY_GRID"
                ? categoryIds
                    .map((id) => categories.find((category) => category.id === id))
                    .filter((category): category is ProductCategory => Boolean(category))
                : (previous?.categories ?? []),
            warnings: productSet?.warnings ?? previous?.warnings ?? [],
          };
        }),
    },
  };
}

export function LandingPagesManager({
  pageType = "CAMPAIGN",
}: {
  pageType?: "HOME" | "CAMPAIGN";
}) {
  const { data: rawPages, isLoading } = useLandingPages();
  const { data: rawProductSets } = useProductSets();
  const { data: rawCategories } = useCategories();
  const { data: rawMedia } = useStoreMedia();
  const { data: rawMetrics } = useStorePageMetrics();
  const pages = Array.isArray(rawPages)
    ? rawPages.filter((page) =>
        pageType === "HOME" ? page.page_type === "HOME" : page.page_type !== "HOME",
      )
    : [];
  const productSets = Array.isArray(rawProductSets) ? rawProductSets : [];
  const categories = Array.isArray(rawCategories) ? rawCategories : [];
  const media = Array.isArray(rawMedia) ? rawMedia : [];
  const metrics = Array.isArray(rawMetrics) ? rawMetrics : [];
  const mutations = useMerchandisingMutations();
  const [selectedPageId, setSelectedPageId] = useState<number | null>(null);
  const selected = pages.find((page) => page.id === selectedPageId) ?? pages[0];
  const { data: rawRevisions } = useLandingPageRevisions(selected?.id);
  const { data: publications = [] } = useLandingPagePublications(selected?.id);
  const revisions = Array.isArray(rawRevisions) ? rawRevisions : [];
  const [revisionId, setRevisionId] = useState<number | null>(null);
  useEffect(() => {
    if (selected) setRevisionId(selected.latest_revision_id);
  }, [selected?.id, selected?.latest_revision_id]);
  const preview = useQuery({
    queryKey: ["admin", "store", "page-preview", selected?.id, revisionId],
    queryFn: () => previewLandingPage(selected!.id, revisionId!),
    enabled: Boolean(selected && revisionId),
  });
  const [draft, setDraft] = useState<LandingPageRevisionInput | null>(null);
  const savedSnapshot = useRef("");
  const autosaveTimer = useRef<number | null>(null);
  const [autosaveState, setAutosaveState] = useState<"saved" | "saving" | "error">("saved");
  useEffect(() => {
    if (!preview.data) return;
    const nextDraft: LandingPageRevisionInput = {
      title: preview.data.revision.title,
      seo_title: preview.data.revision.seo_title,
      seo_description: preview.data.revision.seo_description,
      og_image_url: preview.data.revision.og_image_url,
      blocks: preview.data.revision.blocks.map(
        ({
          id: _id,
          products: _products,
          categories: _categories,
          warnings: _warnings,
          ...block
        }) => block,
      ),
    };
    savedSnapshot.current = JSON.stringify(nextDraft);
    setDraft(nextDraft);
    setAutosaveState("saved");
  }, [preview.data?.revision.id]);
  const [startsAt, setStartsAt] = useState(localDateTime);
  const [endsAt, setEndsAt] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showDuplicate, setShowDuplicate] = useState(false);
  const [selectedBlockKey, setSelectedBlockKey] = useState<string | null>(null);

  useEffect(() => {
    if (!draft?.blocks.length) {
      setSelectedBlockKey(null);
      return;
    }
    if (!draft.blocks.some((block) => block.block_key === selectedBlockKey)) {
      setSelectedBlockKey(draft.blocks[0].block_key ?? null);
    }
  }, [draft, selectedBlockKey]);

  const persistDraft = async (announce: boolean) => {
    if (!selected || !draft) return null;
    if (autosaveTimer.current !== null) {
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    try {
      const revision = await mutations.saveDraft.mutateAsync({
        pageId: selected.id,
        payload: draft,
      });
      setRevisionId(revision.id);
      if (announce) toast.success(`Taslak v${revision.version} kaydedildi`);
      return revision;
    } catch (error) {
      toast.error(getErrorDetail(
        error,
        "Taslak kaydedilemedi. Eksik görsel, bağlantı veya blok ayarını kontrol edin.",
      ));
      return null;
    }
  };
  useEffect(() => {
    if (!selected || !draft) return;
    const snapshot = JSON.stringify(draft);
    if (snapshot === savedSnapshot.current) return;
    setAutosaveState("saving");
    autosaveTimer.current = window.setTimeout(async () => {
      autosaveTimer.current = null;
      try {
        const revision = await mutations.saveDraft.mutateAsync({
          pageId: selected.id,
          payload: draft,
        });
        savedSnapshot.current = snapshot;
        setRevisionId(revision.id);
        setAutosaveState("saved");
      } catch {
        setAutosaveState("error");
      }
    }, 900);
    return () => {
      if (autosaveTimer.current !== null) {
        window.clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
      }
    };
  }, [draft, selected?.id]);
  const publish = async (
    publishStartsAt: string,
    publishEndsAt: string | null,
    successMessage: string,
  ) => {
    if (!selected || !draft) return;
    const revision = await persistDraft(false);
    if (!revision) return;
    try {
      await mutations.publishPage.mutateAsync({
        pageId: selected.id,
        startsAt: publishStartsAt,
        endsAt: publishEndsAt,
      });
      toast.success(successMessage);
    } catch (error) {
      toast.error(getErrorDetail(error, "Yayınlanamadı. Lütfen tekrar deneyin."));
    }
  };
  const publishNow = async () => {
    await publish(new Date().toISOString(), null, "Değişiklikler yayınlandı");
  };
  const schedulePublication = async () => {
    const start = new Date(startsAt);
    const end = endsAt ? new Date(endsAt) : null;
    if (Number.isNaN(start.getTime())) {
      toast.error("Geçerli bir başlangıç zamanı seçin.");
      return;
    }
    if (end && (Number.isNaN(end.getTime()) || end <= start)) {
      toast.error("Bitiş zamanı başlangıçtan sonra olmalı.");
      return;
    }
    await publish(
      start.toISOString(),
      end?.toISOString() ?? null,
      "Yayın planlandı",
    );
  };
  const metric = metrics.find(
    (item) =>
      item.page_id === selected?.id && item.page_revision_id === revisionId,
  );
  const selectedBlockIndex =
    draft?.blocks.findIndex((block) => block.block_key === selectedBlockKey) ??
    -1;
  const selectedBlock =
    selectedBlockIndex >= 0 ? draft?.blocks[selectedBlockIndex] : undefined;
  // Uyarılar sunucudan gelir (taslakta taşınmaz); kaynak önizleme revizyonu.
  const blockWarnings = warningsByBlockKey(preview.data?.revision.blocks);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-panel-fg">
            {pageType === "HOME" ? "Ana sayfa" : "Kampanyalar"}
          </h2>
          <p className="mt-1 text-sm text-panel-fg-muted">
            {pageType === "HOME"
              ? "Mağazanın /magaza adresindeki akışını bölüm bölüm düzenleyin."
              : "Sezon, sınav ve kampanya sayfalarını hazırlayın ve zamanlayın."}
          </p>
        </div>
        {pageType !== "HOME" && (
          <div className="flex gap-2">
            {selected && <Button variant="secondary" onClick={() => setShowDuplicate(true)}>Kampanyayı kopyala</Button>}
            <Button onClick={() => setShowCreate(true)}>Yeni kampanya</Button>
          </div>
        )}
      </header>
      {showCreate && <CreatePageForm onClose={() => setShowCreate(false)} />}
      {showDuplicate && selected && (
        <DuplicatePageForm pageId={selected.id} sourceName={selected.internal_name} onClose={() => setShowDuplicate(false)} />
      )}
      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-2">
          {isLoading ? (
            <div className="h-40 animate-pulse rounded-xl bg-panel-muted" />
          ) : (
            pages.map((page) => (
              <Button
                key={page.id}
                variant="ghost"
                onClick={() => setSelectedPageId(page.id)}
                className={`w-full rounded-xl border p-3 text-left transition ${selected?.id === page.id ? "border-panel-accent bg-panel-accent/10" : "border-panel-border bg-panel-card hover:bg-panel-muted"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-panel-fg">
                    {page.internal_name}
                  </span>
                  <State state={page.state} />
                </div>
                <p className="mt-1 text-xs text-panel-fg-subtle">
                  /magaza/{page.slug} · v{page.latest_version}
                </p>
              </Button>
            ))
          )}
          {draft && (
            <div className="pt-5">
              <div className="mb-2 flex items-center justify-between px-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-panel-fg-subtle">
                  Sayfadaki bölümler
                </h3>
                <span className="text-xs text-panel-fg-subtle">
                  {draft.blocks.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {draft.blocks.map((block, index) => (
                  <PlainButton
                    key={block.block_key}
                    type="button"
                    onClick={() => setSelectedBlockKey(block.block_key ?? null)}
                    className={`w-full border-l-2 px-3 py-2 text-left transition ${selectedBlockKey === block.block_key ? "border-panel-accent bg-panel-accent/10" : "border-transparent hover:bg-panel-muted"}`}
                  >
                    <span className="block text-xs text-panel-fg-subtle">
                      {index + 1}. {BLOCK_NAMES[block.block_type]}
                    </span>
                    <span className="mt-0.5 block truncate text-sm font-medium text-panel-fg">
                      {block.title || "Başlıksız bölüm"}
                    </span>
                    {blockWarnings[block.block_key ?? ""]?.length ? (
                      <span className="mt-0.5 block text-xs text-amber-700 dark:text-amber-300">
                        {blockWarnings[block.block_key ?? ""].length} uyarı
                      </span>
                    ) : null}
                  </PlainButton>
                ))}
              </div>
            </div>
          )}
        </aside>
        {selected && draft ? (
          <main className="min-w-0 space-y-5">
            <div className="flex flex-wrap items-center gap-2 border-b border-panel-border pb-4">
              <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-panel-fg-subtle">
                Sürümler
              </span>
              {revisions.map((revision) => (
                <Button
                  key={revision.id}
                  size="sm"
                  variant="ghost"
                  onClick={() => setRevisionId(revision.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${revision.id === revisionId ? "bg-panel-accent text-panel-accent-fg" : "bg-panel-muted text-panel-fg-muted"}`}
                >
                  v{revision.version} ·{" "}
                  {revision.status === "PUBLISHED" ? "yayınlanmış" : "taslak"}
                </Button>
              ))}
            </div>
            <div className="grid gap-4 border-b border-panel-border pb-5 md:grid-cols-3">
              <Stat label="Görüntüleme" value={metric?.page_views ?? 0} />
              <Stat
                label="Ürün tıklaması"
                value={metric?.product_clicks ?? 0}
              />
              <Stat
                label="Katkılı ciro"
                value={`${metric?.attributed_revenue ?? "0.00"} ₺`}
              />
            </div>
            <details className="border-b border-panel-border pb-5">
              <summary className="cursor-pointer py-2 text-sm font-semibold text-panel-fg">
                Sayfa bilgileri ve SEO
              </summary>
              <div className="grid gap-3 pt-4 md:grid-cols-2">
                <Field label="Sayfa başlığı">
                  <input
                    className="input w-full"
                    value={draft.title}
                    onChange={(event) =>
                      setDraft({ ...draft, title: event.target.value })
                    }
                  />
                </Field>
                <Field label="SEO başlığı">
                  <input
                    className="input w-full"
                    value={draft.seo_title}
                    onChange={(event) =>
                      setDraft({ ...draft, seo_title: event.target.value })
                    }
                  />
                </Field>
                <Field label="SEO açıklaması">
                  <input
                    className="input w-full"
                    value={draft.seo_description}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        seo_description: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="OG görseli">
                  <select
                    className="input w-full"
                    value={draft.og_image_url ?? ""}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        og_image_url: event.target.value || null,
                      })
                    }
                  >
                    <option value="">Seçilmedi</option>
                    {media.map((asset) => (
                      <option key={asset.id} value={asset.image_url}>
                        {asset.alt_text || `Görsel #${asset.id}`}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </details>
            {publications.length > 0 && (
              <section className="border-t border-panel-border pt-5">
                <h3 className="text-sm font-semibold text-panel-fg">Yayın takvimi</h3>
                <div className="mt-3 divide-y divide-panel-border border-y border-panel-border">
                  {publications.map((publication) => (
                    <div key={publication.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                      <div>
                        <p className="font-medium text-panel-fg">{new Date(publication.starts_at).toLocaleString("tr-TR")}</p>
                        <p className="text-xs text-panel-fg-muted">{publication.ends_at ? `${new Date(publication.ends_at).toLocaleString("tr-TR")} tarihinde biter` : "Süresiz"} · {publication.state === "LIVE" ? "Yayında" : publication.state === "UPCOMING" ? "Planlı" : "Sona erdi"}</p>
                      </div>
                      {publication.state !== "ENDED" && (
                        <Button
                          size="sm"
                          variant="danger"
                          isPending={mutations.cancelPublication.isPending}
                          onClick={async () => {
                            try {
                              await mutations.cancelPublication.mutateAsync({ pageId: selected.id, publicationId: publication.id });
                              toast.success("Yayın kaldırıldı");
                            } catch (error) {
                              toast.error(getErrorDetail(error, "Yayın kaldırılamadı."));
                            }
                          }}
                        >
                          Yayını kaldır
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
            <div>
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-panel-fg">
                      {selectedBlock
                        ? BLOCK_NAMES[selectedBlock.block_type]
                        : "Sayfa bölümleri"}
                    </h3>
                    <p className="mt-0.5 text-xs text-panel-fg-muted">
                      Soldan bir bölüm seçin; yalnız onun ayarları burada açılır.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`self-center text-xs ${autosaveState === "error" ? "text-rose-600" : "text-panel-fg-subtle"}`}>
                      {autosaveState === "saving" ? "Kaydediliyor…" : autosaveState === "error" ? "Kaydedilemedi" : "Tüm değişiklikler kaydedildi"}
                    </span>
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        const revision = await persistDraft(false);
                        if (revision) window.open(ROUTES.adminStorePreview(selected.id), "_blank", "noopener,noreferrer");
                      }}
                    >
                      Gerçek sayfada önizle
                    </Button>
                    <Button
                      variant="success"
                      onClick={publishNow}
                      isPending={
                        mutations.saveDraft.isPending ||
                        mutations.publishPage.isPending
                      }
                    >
                      Şimdi yayınla
                    </Button>
                  </div>
                </div>
                {selectedBlock ? (
                  <BlockWarnings
                    warnings={blockWarnings[selectedBlock.block_key ?? ""] ?? []}
                  />
                ) : null}
                {selectedBlock && selectedBlockIndex >= 0 ? (
                  <BlockEditor
                    key={selectedBlock.block_key}
                    block={selectedBlock}
                    index={selectedBlockIndex}
                    media={media}
                    productSets={productSets}
                    categories={categories}
                    onChange={(next) =>
                      setDraft({
                        ...draft,
                        blocks: draft.blocks.map((item, itemIndex) =>
                          itemIndex === selectedBlockIndex ? next : item,
                        ),
                      })
                    }
                    onMove={(direction) => {
                      const target = selectedBlockIndex + direction;
                      if (target < 0 || target >= draft.blocks.length) return;
                      const blocks = [...draft.blocks];
                      [blocks[selectedBlockIndex], blocks[target]] = [
                        blocks[target],
                        blocks[selectedBlockIndex],
                      ];
                      setDraft({ ...draft, blocks });
                    }}
                    onDuplicate={() => {
                      const copy = duplicateLandingBlock(
                        selectedBlock,
                        selectedBlockIndex + 1,
                      );
                      const blocks = [...draft.blocks];
                      blocks.splice(selectedBlockIndex + 1, 0, copy);
                      setDraft({ ...draft, blocks });
                      setSelectedBlockKey(copy.block_key ?? null);
                    }}
                    onDelete={() =>
                      setDraft({
                        ...draft,
                        blocks: draft.blocks.filter(
                          (_, itemIndex) => itemIndex !== selectedBlockIndex,
                        ),
                      })
                    }
                  />
                ) : (
                  <div className="rounded-xl border border-dashed border-panel-border p-8 text-center text-sm text-panel-fg-muted">
                    Henüz bölüm yok. Aşağıdan ilk bölümü ekleyin.
                  </div>
                )}
                <details className="border-t border-panel-border pt-3">
                  <summary className="cursor-pointer py-2 text-sm font-semibold text-panel-fg">
                    + Yeni bölüm ekle
                  </summary>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {(Object.keys(BLOCK_NAMES) as LandingPageBlockType[]).map(
                      (type) => (
                        <PlainButton
                          key={type}
                          type="button"
                          onClick={() => {
                            const block = newBlock(
                              type,
                              draft.blocks.length,
                              productSets[0]?.id,
                            );
                            setDraft({
                              ...draft,
                              blocks: [...draft.blocks, block],
                            });
                            setSelectedBlockKey(block.block_key ?? null);
                          }}
                          className="border-l border-panel-border px-3 py-2 text-left transition hover:bg-panel-muted"
                        >
                          <span className="block text-sm font-semibold text-panel-fg">
                            {BLOCK_NAMES[type]}
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-panel-fg-muted">
                            {BLOCK_DESCRIPTIONS[type]}
                          </span>
                        </PlainButton>
                      ),
                    )}
                  </div>
                </details>
              </section>
            </div>
            <details className="border-t border-panel-border pt-3">
              <summary className="cursor-pointer py-2 text-sm font-semibold text-panel-fg">
                İleri tarihe planla
              </summary>
              <div className="flex flex-wrap items-end gap-3 pt-4">
                <Field label="Başlangıç">
                  <input
                    type="datetime-local"
                    className="input"
                    value={startsAt}
                    onChange={(event) => setStartsAt(event.target.value)}
                  />
                </Field>
                <Field label="Bitiş (isteğe bağlı)">
                  <input
                    type="datetime-local"
                    className="input"
                    value={endsAt}
                    onChange={(event) => setEndsAt(event.target.value)}
                  />
                </Field>
                <Button
                  variant="success"
                  onClick={schedulePublication}
                  isPending={
                    mutations.saveDraft.isPending ||
                    mutations.publishPage.isPending
                  }
                >
                  Planla
                </Button>
              </div>
            </details>
          </main>
        ) : (
          <div className="rounded-xl border border-dashed border-panel-border p-12 text-center text-panel-fg-muted">
            Düzenlemek için bir sayfa seçin.
          </div>
        )}
      </div>
    </div>
  );
}

function MediaUpload({
  onUploaded,
}: {
  onUploaded: (asset: StoreMediaAsset) => void;
}) {
  const { uploadMedia } = useMerchandisingMutations();
  const [file, setFile] = useState<File | null>(null);
  const [altText, setAltText] = useState("");
  return (
    <form
      className="grid gap-3 rounded-xl border border-panel-border bg-panel-muted/40 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!file) {
          toast.error("Yüklenecek görseli seçin");
          return;
        }
        try {
          const asset = await uploadMedia.mutateAsync({ image: file, altText });
          setFile(null);
          setAltText("");
          onUploaded(asset);
          toast.success("Görsel yüklendi ve bölüme eklendi");
        } catch (error) {
          toast.error(
            getErrorDetail(
              error,
              "Görsel yüklenemedi. JPEG, PNG veya WebP ve en fazla 12 MB olmalı.",
            ),
          );
        }
      }}
    >
      <Field label="Bilgisayarınızdan görsel">
        <input
          key={file ? `${file.name}-${file.lastModified}` : "empty"}
          required
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="block text-sm text-panel-fg-muted"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </Field>
      <Field label="Görsel açıklaması (önerilir)">
        <input
          className="input w-full"
          value={altText}
          onChange={(event) => setAltText(event.target.value)}
          placeholder="Ekran okuyucu açıklaması"
        />
      </Field>
      <Button
        type="submit"
        variant="secondary"
        isPending={uploadMedia.isPending}
      >
        Yükle ve kullan
      </Button>
    </form>
  );
}

function DuplicatePageForm({ pageId, sourceName, onClose }: { pageId: number; sourceName: string; onClose: () => void }) {
  const { duplicatePage } = useMerchandisingMutations();
  const [name, setName] = useState(`${sourceName} kopyası`);
  const [slug, setSlug] = useState("");
  return (
    <form
      className="grid gap-3 rounded-xl border border-panel-border bg-panel-card p-4 md:grid-cols-[1fr_1fr_auto]"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await duplicatePage.mutateAsync({ pageId, internalName: name, slug });
          toast.success("Kampanya taslağı kopyalandı");
          onClose();
        } catch (error) {
          toast.error(getErrorDetail(error, "Kampanya kopyalanamadı."));
        }
      }}
    >
      <Field label="Yeni yönetim adı"><input required className="input w-full" value={name} onChange={(event) => setName(event.target.value)} /></Field>
      <Field label="Yeni URL adı"><input required className="input w-full" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="okula-donus-2027" /></Field>
      <div className="flex items-end gap-2"><Button type="submit" isPending={duplicatePage.isPending}>Kopyala</Button><Button variant="ghost" onClick={onClose}>Vazgeç</Button></div>
    </form>
  );
}

function CreatePageForm({ onClose }: { onClose: () => void }) {
  const { createPage } = useMerchandisingMutations();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [type, setType] = useState<
    "CAMPAIGN" | "SEASONAL" | "EXAM" | "BRAND" | "CURATED"
  >("CAMPAIGN");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await createPage.mutateAsync({
        internal_name: name,
        slug,
        page_type: type,
        revision: {
          title: name,
          seo_title: name,
          seo_description: "",
          blocks: [],
        },
      });
      toast.success("Sayfa taslağı oluşturuldu");
      onClose();
    } catch {
      toast.error(
        "Sayfa oluşturulamadı. Adres başka bir sayfa tarafından kullanılıyor olabilir.",
      );
    }
  };
  return (
    <form
      onSubmit={submit}
      className="grid gap-3 rounded-xl border border-panel-border bg-panel-card p-4 md:grid-cols-4"
    >
      <Field label="Yönetim adı">
        <input
          required
          className="input w-full"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field label="URL adı">
        <input
          required
          className="input w-full"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          placeholder="okula-donus"
        />
      </Field>
      <Field label="Sayfa türü">
        <select
          className="input w-full"
          value={type}
          onChange={(event) => setType(event.target.value as typeof type)}
        >
          <option value="CAMPAIGN">Kampanya</option>
          <option value="SEASONAL">Sezon</option>
          <option value="EXAM">Sınav</option>
          <option value="BRAND">Yayınevi/marka</option>
          <option value="CURATED">Kürasyon</option>
        </select>
      </Field>
      <div className="flex items-end gap-2">
        <Button type="submit" isPending={createPage.isPending}>
          Oluştur
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Vazgeç
        </Button>
      </div>
    </form>
  );
}

function BlockEditor({
  block,
  index,
  media,
  productSets,
  categories,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
}: {
  block: LandingPageBlockInput;
  index: number;
  media: StoreMediaAsset[];
  productSets: ReturnType<typeof useProductSets>["data"] extends infer T
    ? NonNullable<T>
    : never;
  categories: ReturnType<typeof useCategories>["data"] extends infer T
    ? NonNullable<T>
    : never;
  onChange: (block: LandingPageBlockInput) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const itemsKey = block.block_type === "HERO_CAROUSEL" ? "slides" : "cards";
  const items =
    (block.config[itemsKey] as Array<Record<string, unknown>> | undefined) ??
    [];
  const selectedMediaUrls = new Set(
    block.block_type === "BANNER"
      ? [String(block.config.image_url ?? "")]
      : items.map((item) => String(item.image_url ?? "")),
  );
  const mediaPicker = useDuzenlemeYuzeyi();
  return (
    <article className="rounded-xl border border-panel-border bg-panel-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-panel-muted text-xs text-panel-fg-muted">
            {index + 1}
          </span>
          <h4 className="font-semibold text-panel-fg">
            {BLOCK_NAMES[block.block_type]}
          </h4>
          <label className="flex items-center gap-1.5 text-xs text-panel-fg-muted">
            <input
              type="checkbox"
              checked={block.is_active}
              onChange={(event) =>
                onChange({ ...block, is_active: event.target.checked })
              }
            />
            Göster
          </label>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => onMove(-1)}>
            Yukarı
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onMove(1)}>
            Aşağı
          </Button>
          {block.block_type !== "RECENTLY_VIEWED" && (
            <Button size="sm" variant="secondary" onClick={onDuplicate}>
              Kopyala
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={onDelete}>
            Kaldır
          </Button>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label="Başlık (isteğe bağlı)">
          <input
            className="input w-full"
            value={block.title}
            onChange={(event) =>
              onChange({ ...block, title: event.target.value })
            }
          />
        </Field>
        <Field label="Açıklama">
          <input
            className="input w-full"
            value={block.description}
            onChange={(event) =>
              onChange({ ...block, description: event.target.value })
            }
          />
        </Field>
        <Field label="Keşfet yazısı">
          <input
            className="input w-full"
            value={block.link_label}
            onChange={(event) =>
              onChange({ ...block, link_label: event.target.value })
            }
            placeholder="Keşfet"
          />
        </Field>
        <Field label="Yönlendirme">
          <input
            className="input w-full"
            value={block.link_url ?? ""}
            onChange={(event) =>
              onChange({ ...block, link_url: event.target.value || null })
            }
            placeholder="/magaza?..."
          />
        </Field>
      </div>
      {block.block_type === "PRODUCT_RAIL" && (
        <Field label="Koleksiyon">
          <select
            className="input mt-3 w-full"
            value={block.product_set_id ?? ""}
            onChange={(event) =>
              onChange({
                ...block,
                product_set_id: Number(event.target.value) || null,
                product_set_revision_id: null,
              })
            }
          >
            <option value="">Seçin</option>
            {(productSets ?? []).map((set) => (
              <option key={set.id} value={set.id}>
                {set.name} · {set.matched_count} ürün
              </option>
            ))}
          </select>
        </Field>
      )}
      {block.block_type === "CATEGORY_GRID" && (
        <fieldset className="mt-3">
          <legend className="text-sm font-medium text-panel-fg">
            Kategoriler
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(categories ?? [])
              .filter((category) => category.is_active !== false)
              .map((category) => {
                const ids =
                  (block.config.category_ids as number[] | undefined) ?? [];
                return (
                  <label
                    key={category.id}
                    className="rounded-full border border-panel-border px-2.5 py-1 text-xs text-panel-fg"
                  >
                    <input
                      type="checkbox"
                      className="mr-1.5"
                      checked={ids.includes(category.id)}
                      onChange={() =>
                        onChange({
                          ...block,
                          config: {
                            ...block.config,
                            category_ids: ids.includes(category.id)
                              ? ids.filter((id) => id !== category.id)
                              : [...ids, category.id],
                          },
                        })
                      }
                    />
                    {category.name}
                  </label>
                );
              })}
          </div>
        </fieldset>
      )}
      {block.block_type === "RICH_TEXT" && (
        <Field label="Metin">
          <textarea
            className="input mt-3 min-h-32 w-full"
            value={String(block.config.content ?? "")}
            onChange={(event) =>
              onChange({
                ...block,
                config: { ...block.config, content: event.target.value },
              })
            }
          />
        </Field>
      )}
      {["HERO_CAROUSEL", "IMAGE_CARD_GRID", "BANNER"].includes(
        block.block_type,
      ) && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3 border-t border-panel-border pt-4">
            <div>
              <p className="text-sm font-medium text-panel-fg">Görseller</p>
              <p className="mt-0.5 text-xs text-panel-fg-muted">
                Buradan yükleyin veya daha önce yüklediğiniz bir görseli seçin.
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => mediaPicker.yeniAc()}
            >
              {block.block_type === "BANNER" && block.config.image_url
                ? "Görseli değiştir"
                : "+ Görsel ekle"}
            </Button>
          </div>
          <Modal
            open={mediaPicker.acik}
            onClose={mediaPicker.kapat}
            title="Görsel seç veya yükle"
            description="Yeni bir görsel yüklediğinizde doğrudan bu bölüme eklenir."
            maxWidth="max-w-4xl"
          >
            <MediaUpload
              onUploaded={(asset) => {
                onChange(appendMediaToLandingBlock(block, asset));
                mediaPicker.kapat();
              }}
            />
            <div className="mt-5">
              <h4 className="text-sm font-semibold text-panel-fg">
                Daha önce yüklenenler
              </h4>
              {media.length ? (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {media.map((asset) => {
                    const selected = selectedMediaUrls.has(asset.image_url);
                    return (
                      <PlainButton
                        key={asset.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          onChange(appendMediaToLandingBlock(block, asset));
                          mediaPicker.kapat();
                        }}
                        className={`overflow-hidden rounded-xl border p-2 text-left transition hover:border-panel-accent ${selected ? "border-panel-accent bg-panel-accent/10" : "border-panel-border"}`}
                      >
                        <img
                          src={asset.image_url}
                          alt={asset.alt_text}
                          className="aspect-[4/3] w-full rounded-lg bg-panel-muted object-contain"
                        />
                        <span className="mt-2 block truncate text-xs font-medium text-panel-fg">
                          {asset.alt_text || `Görsel #${asset.id}`}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-panel-fg-subtle">
                          {selected
                            ? "Bu bölümde kullanılıyor"
                            : `${asset.width} × ${asset.height}`}
                        </span>
                      </PlainButton>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-3 rounded-lg border border-dashed border-panel-border p-6 text-center text-sm text-panel-fg-muted">
                  Henüz yüklenmiş görsel yok.
                </p>
              )}
            </div>
          </Modal>
          {block.block_type === "BANNER" &&
            Boolean(block.config.image_url) && (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-panel-border p-3">
              <img
                src={String(block.config.image_url)}
                alt=""
                className="h-20 w-28 rounded-lg bg-panel-muted object-contain"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-panel-fg">
                  {String(block.config.alt_text || "Seçili geniş görsel")}
                </p>
                <p className="mt-1 text-xs text-panel-fg-muted">
                  Değiştirmek için “Görseli değiştir” düğmesini kullanın.
                </p>
              </div>
              <Button
                size="sm"
                variant="danger"
                onClick={() =>
                  onChange({
                    ...block,
                    config: {
                      ...block.config,
                      image_url: "",
                      alt_text: "",
                    },
                  })
                }
              >
                Kaldır
              </Button>
            </div>
          )}
          {block.block_type !== "BANNER" &&
            items.map((item, itemIndex) => (
              <div
                key={itemIndex}
                className="mt-3 flex gap-3 rounded-xl border border-panel-border p-3"
              >
                <img
                  src={String(item.image_url ?? "")}
                  alt=""
                  className="aspect-square h-20 w-20 shrink-0 rounded-lg bg-panel-muted object-contain"
                />
                <div className="min-w-0 flex-1 space-y-3">
                  <p className="text-xs font-semibold text-panel-fg-subtle">
                    {itemIndex + 1}. görsel
                  </p>
                  <label className="block space-y-1 text-xs font-medium text-panel-fg-muted">
                    <span>Kartın altında görünecek yazı</span>
                    <input
                      aria-label={`${itemIndex + 1}. medya etiketi`}
                      className="input w-full"
                      value={String(item.label ?? "")}
                      onChange={(event) => {
                        const next = [...items];
                        next[itemIndex] = { ...item, label: event.target.value };
                        onChange({
                          ...block,
                          config: { ...block.config, [itemsKey]: next },
                        });
                      }}
                    />
                  </label>
                  <label className="block space-y-1 text-xs font-medium text-panel-fg-muted">
                    <span>Tıklanınca gidilecek adres</span>
                    <input
                      aria-label={`${itemIndex + 1}. medya yönlendirmesi`}
                      className="input w-full"
                      value={String(item.link_url ?? "")}
                      onChange={(event) => {
                        const next = [...items];
                        next[itemIndex] = {
                          ...item,
                          link_url: event.target.value,
                        };
                        onChange({
                          ...block,
                          config: { ...block.config, [itemsKey]: next },
                        });
                      }}
                    />
                  </label>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="min-w-40 flex-1 space-y-1 text-xs font-medium text-panel-fg-muted">
                      <span>Görsel yerleşimi</span>
                      <select
                        aria-label={`${itemIndex + 1}. medya yerleşimi`}
                        className="input w-full"
                        value={String(item.fit ?? "contain")}
                        onChange={(event) => {
                          const next = [...items];
                          next[itemIndex] = { ...item, fit: event.target.value };
                          onChange({
                            ...block,
                            config: { ...block.config, [itemsKey]: next },
                          });
                        }}
                      >
                        <option value="contain">Tamamını göster</option>
                        <option value="cover">Alanı doldur</option>
                      </select>
                    </label>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const next = [...items];
                        next.splice(itemIndex + 1, 0, structuredClone(item));
                        onChange({
                          ...block,
                          config: { ...block.config, [itemsKey]: next },
                        });
                      }}
                    >
                      Kopyala
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() =>
                        onChange({
                          ...block,
                          config: {
                            ...block.config,
                            [itemsKey]: items.filter(
                              (_, idx) => idx !== itemIndex,
                            ),
                          },
                        })
                      }
                    >
                      Sil
                    </Button>
                  </div>
                </div>
              </div>
            ))}
        </div>
      )}
    </article>
  );
}

function newBlock(
  type: LandingPageBlockType,
  index: number,
  productSetId?: number,
): LandingPageBlockInput {
  const config: Record<string, unknown> =
    type === "HERO_CAROUSEL"
      ? { slides: [], autoplay_ms: 6500 }
      : type === "IMAGE_CARD_GRID"
        ? { cards: [] }
        : type === "CATEGORY_GRID"
          ? { category_ids: [] }
          : type === "RICH_TEXT"
            ? { content: "" }
            : {};
  return {
    block_key: freshBlockKey(),
    block_type: type,
    title: type === "RECENTLY_VIEWED" ? "Son görüntülediklerin" : "",
    description: "",
    link_label: "Keşfet",
    link_url: null,
    config,
    product_set_id: type === "PRODUCT_RAIL" ? (productSetId ?? null) : null,
    product_set_revision_id: null,
    is_active: true,
    sort_order: index * 10,
  };
}
function State({ state }: { state: string }) {
  const label: Record<string, string> = {
    DRAFT: "Taslak",
    UPCOMING: "Planlı",
    LIVE: "Yayında",
    ENDED: "Sona erdi",
    ARCHIVED: "Arşiv",
  };
  return (
    <span className="rounded-full bg-panel-muted px-2 py-0.5 text-[10px] font-medium text-panel-fg-muted">
      {label[state] ?? state}
    </span>
  );
}
function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-panel-fg-subtle">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold text-panel-fg">{value}</p>
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1 text-sm font-medium text-panel-fg">
      <span>{label}</span>
      {children}
    </label>
  );
}
