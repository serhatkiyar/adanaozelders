/**
 * ── Vitrin sayfaları YÖNETİCİSİ (CMS Faz 2'de sadeleşti) ──
 *
 * Bu ekran artık yalnız LİSTE + YAŞAM DÖNGÜSÜ yönetir: sayfa oluşturma,
 * kopyalama, yayın takvimi (iptal/yeniden zamanlama) ve metrik özeti.
 * BLOK DÜZENLEME tamamen Puck editörüne devredildi
 * (`/yonetim/magaza/sayfa/:pageId/duzenle` — PuckEditorPage): eski 1300+
 * satırlık form editörü, autosave ve medya ekleme yardımcıları kaldırıldı.
 * `puck_data` kanonik kaynak olduğundan buradan blok yazan HİÇBİR yol
 * kalmamalıdır — kalırsa çatallanma kuralı gereği Puck taslağını düşürür.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { Badge, Button, EmptyState, PageSkeleton } from "@/components/admin/ui";
import {
  useLandingPages,
  useMerchandisingMutations,
  useStorePageMetrics,
} from "@/hooks/useStoreMerchandising";
import { getErrorDetail } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import type { LandingPageSummary } from "@/types";

const DURUM_ETIKETI: Record<LandingPageSummary["state"], string> = {
  DRAFT: "Taslak",
  UPCOMING: "Yayın bekliyor",
  LIVE: "Yayında",
  ENDED: "Süresi doldu",
  ARCHIVED: "Arşiv",
};

function DurumRozeti({ state }: { state: LandingPageSummary["state"] }) {
  const ton =
    state === "LIVE" ? "success" : state === "UPCOMING" ? "info" : state === "ENDED" ? "warning" : "neutral";
  return <Badge tone={ton}>{DURUM_ETIKETI[state]}</Badge>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-panel-fg-muted">
      {label}
      <div className="mt-1 font-normal">{children}</div>
    </label>
  );
}

export function LandingPagesManager({
  pageType = "CAMPAIGN",
}: {
  pageType?: "HOME" | "CAMPAIGN";
}) {
  const navigate = useNavigate();
  const { data: rawPages, isLoading } = useLandingPages();
  const { data: rawMetrics } = useStorePageMetrics();

  const pages = Array.isArray(rawPages)
    ? rawPages.filter((page) =>
        pageType === "HOME" ? page.page_type === "HOME" : page.page_type !== "HOME",
      )
    : [];
  const metrics = Array.isArray(rawMetrics) ? rawMetrics : [];

  const [selectedPageId, setSelectedPageId] = useState<number | null>(null);
  const selected = pages.find((page) => page.id === selectedPageId) ?? pages[0];
  const [showCreate, setShowCreate] = useState(false);
  const [showDuplicate, setShowDuplicate] = useState(false);

  if (isLoading) return <PageSkeleton />;

  const sayfaMetrikleri = metrics.filter((m) => m.page_id === selected?.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-panel-fg">
            {pageType === "HOME" ? "Mağaza ana sayfası" : "Kampanya sayfaları"}
          </h2>
          <p className="mt-1 text-sm text-panel-fg-muted">
            İçerik blokları sürükle-bırak editörde düzenlenir; yayınlamak tek
            tıktır ve anında canlıya alır.
          </p>
        </div>
        {pageType !== "HOME" && (
          <Button onClick={() => setShowCreate((v) => !v)}>Yeni sayfa</Button>
        )}
      </div>

      {showCreate && <CreatePageForm onClose={() => setShowCreate(false)} />}

      {pages.length === 0 ? (
        <EmptyState
          title={pageType === "HOME" ? "Ana sayfa bulunamadı" : "Henüz kampanya sayfası yok"}
          description={
            pageType === "HOME"
              ? "Mağaza ana sayfası kurulumda oluşturulur; görünmüyorsa veri tabanını kontrol edin."
              : "İlk kampanya sayfanızı oluşturun; taslak olarak başlar, siz yayınlayana dek görünmez."
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          {pageType !== "HOME" && (
            <ul className="space-y-1 self-start rounded-2xl border border-panel-border bg-panel-surface p-2">
              {pages.map((page) => (
                <li key={page.id}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedPageId(page.id)}
                    aria-current={selected?.id === page.id ? "true" : undefined}
                    className={`w-full !justify-between gap-2 text-left ${
                      selected?.id === page.id ? "bg-panel-accent-soft text-panel-accent" : ""
                    }`}
                  >
                    <span className="min-w-0 truncate font-medium">{page.internal_name}</span>
                    <DurumRozeti state={page.state} />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {selected && (
            <div className="min-w-0 space-y-5">
              <div className="rounded-2xl border border-panel-border bg-panel-surface p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-panel-fg">
                        {selected.internal_name}
                      </h3>
                      <DurumRozeti state={selected.state} />
                    </div>
                    <p className="mt-1 text-xs text-panel-fg-muted">
                      /magaza/{selected.page_type === "HOME" ? "" : selected.slug}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        window.open(ROUTES.adminStorePreview(selected.id), "_blank", "noopener")
                      }
                    >
                      Önizle
                    </Button>
                    {selected.page_type !== "HOME" && (
                      <Button size="sm" variant="ghost" onClick={() => setShowDuplicate((v) => !v)}>
                        Kopyala
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => navigate(ROUTES.adminStorePageEdit(selected.id))}
                    >
                      İçeriği düzenle
                    </Button>
                  </div>
                </div>
              </div>

              {showDuplicate && selected.page_type !== "HOME" && (
                <DuplicatePageForm
                  pageId={selected.id}
                  sourceName={selected.internal_name}
                  onClose={() => setShowDuplicate(false)}
                />
              )}


              {sayfaMetrikleri.length > 0 && (
                <section className="rounded-2xl border border-panel-border bg-panel-surface p-5">
                  <h4 className="text-sm font-semibold text-panel-fg">Performans</h4>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {sayfaMetrikleri.slice(0, 1).map((m) => (
                      <FragmentMetrikler key={m.page_revision_id} m={m} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DuplicatePageForm({
  pageId,
  sourceName,
  onClose,
}: {
  pageId: number;
  sourceName: string;
  onClose: () => void;
}) {
  const { duplicatePage } = useMerchandisingMutations();
  const [name, setName] = useState(`${sourceName} kopyası`);
  const [slug, setSlug] = useState("");
  return (
    <form
      className="grid gap-3 rounded-xl border border-panel-border bg-panel-surface p-4 md:grid-cols-[1fr_1fr_auto]"
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
      <Field label="Yeni yönetim adı">
        <input required className="input w-full" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Yeni URL adı">
        <input
          required
          className="input w-full"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="okula-donus-2027"
        />
      </Field>
      <div className="flex items-end gap-2">
        <Button type="submit" isPending={duplicatePage.isPending}>
          Kopyala
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Vazgeç
        </Button>
      </div>
    </form>
  );
}

function CreatePageForm({ onClose }: { onClose: () => void }) {
  const { createPage } = useMerchandisingMutations();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [type, setType] = useState<"CAMPAIGN" | "SEASONAL" | "EXAM" | "BRAND" | "CURATED">(
    "CAMPAIGN",
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await createPage.mutateAsync({
        internal_name: name,
        slug,
        page_type: type,
        revision: { title: name, seo_title: name, seo_description: "", blocks: [] },
      });
      toast.success("Sayfa taslağı oluşturuldu");
      onClose();
    } catch {
      toast.error("Sayfa oluşturulamadı. Adres başka bir sayfa tarafından kullanılıyor olabilir.");
    }
  };
  return (
    <form
      onSubmit={submit}
      className="grid gap-3 rounded-xl border border-panel-border bg-panel-surface p-4 md:grid-cols-4"
    >
      <Field label="Yönetim adı">
        <input required className="input w-full" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="URL adı">
        <input
          required
          className="input w-full"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="okula-donus"
        />
      </Field>
      <Field label="Sayfa türü">
        <select className="input w-full" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
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

function FragmentMetrikler({ m }: { m: import("@/types").StorePageMetric }) {
  const kalemler: [string, React.ReactNode][] = [
    ["Görüntülenme", m.page_views],
    ["Blok tıklaması", m.block_clicks],
    ["Ürün tıklaması", m.product_clicks],
    ["Ödenen sipariş", m.paid_orders],
  ];
  return (
    <>
      {kalemler.map(([etiket, deger]) => (
        <div key={etiket} className="rounded-xl bg-panel-surface-subtle p-3">
          <p className="text-[11px] text-panel-fg-muted">{etiket}</p>
          <p className="mt-1 text-sm font-semibold text-panel-fg">{deger}</p>
        </div>
      ))}
    </>
  );
}
