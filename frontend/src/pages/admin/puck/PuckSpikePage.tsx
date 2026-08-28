/**
 * ── Puck SPIKE ekranı (feat/puck-spike) ──
 *
 * `/yonetim/puck-deneme` — gizli rota, nav'da yok. Amaç: Puck'ın editör
 * deneyimini GERÇEK vitrin verisiyle görmek ve "devam / geri çekil" kararını
 * vermek. Yayınlanmış mağaza ana sayfası (public /store/home) Puck verisine
 * dönüştürülür; "Yayınla" backend'e YAZMAZ, üretilen JSON'u gösterir
 * (gerçek entegrasyon Faz 2'nin işi: puck_data JSONB + tek yönlü dönüştürme).
 *
 * Spike bilinçli sadeleştirmeleri:
 *  - Nöbetçi kayıtları (uiBaseline/calismaZamani) YAPILMADI — dal lokal,
 *    CI'a gitmiyor; gerçek entegrasyonda yapılacak.
 *  - Desteklenmeyen blok tipleri (IMAGE_CARD_GRID, CATEGORY_GRID,
 *    RECENTLY_VIEWED) dönüştürücüde atlanır ve ekranda listelenir —
 *    Faz 2 kapsam ölçümünün girdisi.
 */
import { useMemo, useState } from "react";
import { Puck, type Data } from "@measured/puck";
import "@measured/puck/puck.css";

import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { PageSkeleton } from "@/components/admin/ui";
import { useStoreHomePage } from "@/hooks/useStoreMerchandising";
import { toast } from "@/store/toastStore";
import type { LandingPageBlock } from "@/types";

import { puckConfig, type HeroSlideProps } from "./puckConfig";

/** Mevcut blok şemasından Puck verisine TEK YÖNLÜ dönüştürme (spike ölçümü). */
function blokToPuck(blocks: LandingPageBlock[]): { data: Data; atlanan: string[] } {
  const content: Data["content"] = [];
  const atlanan: string[] = [];
  for (const b of blocks) {
    const id = `${b.block_type}-${b.block_key}`;
    if (b.block_type === "HERO_CAROUSEL") {
      const slides = ((b.config?.slides as HeroSlideProps[] | undefined) ?? []).map((s) => ({
        image_url: (s as { image_url?: string }).image_url ?? "",
        alt_text: (s as { alt_text?: string }).alt_text ?? "",
        link_url: (s as { link_url?: string }).link_url ?? "",
      }));
      content.push({ type: "HeroCarousel", props: { id, slides } });
    } else if (b.block_type === "RICH_TEXT") {
      content.push({
        type: "RichText",
        props: { id, title: b.title, content: String(b.config?.content ?? "") },
      });
    } else if (b.block_type === "BANNER") {
      content.push({
        type: "Banner",
        props: {
          id,
          title: b.title,
          description: b.description,
          image_url: String(b.config?.image_url ?? ""),
          link_label: b.link_label,
          link_url: b.link_url ?? "",
        },
      });
    } else if (b.block_type === "PRODUCT_RAIL") {
      content.push({
        type: "ProductRail",
        props: {
          id,
          title: b.title,
          product_set: b.product_set_id ? { id: b.product_set_id, title: b.title } : null,
        },
      });
    } else {
      atlanan.push(b.block_type);
    }
  }
  return { data: { root: { props: {} }, content, zones: {} }, atlanan };
}

export default function PuckSpikePage() {
  const { canManage } = useAdminAreaAccess("content");
  const { data: home, isLoading } = useStoreHomePage();
  const [cikti, setCikti] = useState<string | null>(null);

  const donusum = useMemo(
    () => (home ? blokToPuck(home.revision.blocks) : null),
    [home]
  );

  if (!canManage) return <AccessDenied area="Puck deneme" />;
  if (isLoading || !donusum) return <PageSkeleton />;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-sm">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-slate-900">Puck spike</span>
          <span className="text-slate-400">
            Kaynak: mağaza ana sayfası ({home!.revision.blocks.length} blok
            {donusum.atlanan.length > 0 &&
              ` · dönüştürülemeyen: ${donusum.atlanan.join(", ")}`}
            )
          </span>
        </div>
        <a href="/yonetim/magaza/ana-sayfa" className="text-slate-500 underline-offset-2 hover:underline">
          Panele dön
        </a>
      </div>
      <div className="min-h-0 flex-1">
        <Puck
          config={puckConfig}
          data={donusum.data}
          onPublish={(data) => {
            setCikti(JSON.stringify(data, null, 2));
            toast.success("Spike: veri backend'e YAZILMADI, JSON aşağıda.");
          }}
        />
      </div>
      {cikti && (
        <div className="max-h-56 overflow-auto border-t border-slate-200 bg-slate-50 p-3">
          <p className="mb-1 text-xs font-semibold text-slate-500">
            onPublish çıktısı (Faz 2'de puck_data kolonuna yazılacak şekil):
          </p>
          <pre className="text-[11px] leading-snug text-slate-700">{cikti}</pre>
        </div>
      )}
    </div>
  );
}
