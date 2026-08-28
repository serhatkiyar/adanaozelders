/**
 * ── Puck konfigürasyonu: vitrin CMS'inin KALICI editörü (Faz 2) ──
 *
 * Yedi DB blok tipinin tamamı Puck bileşeni olarak eşlenir; prop şekilleri
 * backend köprüsüyle (services/store_merchandising_puck.py) sözleşmedir —
 * orada `PUCK_TO_BLOCK_TYPE` ile bire bir.
 *
 * Editör render'ları public görünümün hafif kopyasıdır; gerçek görünüm
 * (compact-image-row gruplaması dahil) mevcut Önizleme rotasında doğrulanır.
 * Görsel alanları MEDYA KÜTÜPHANESİNDEN seçilir (MedyaAlani) — çıplak URL yok.
 */
import type { Config } from "@measured/puck";
import { FieldLabel } from "@measured/puck";

import { fetchProductSets } from "@/api/storeMerchandising";
import { useCategories } from "@/hooks/useStore";

import { medyaAlani, medyaUrlAlani } from "./MedyaAlani";
import type { KoleksiyonSecimi, PuckMedya } from "./puckTipleri";

/* ── Ortak alanlar ── */

const ORTAK_ALANLAR = {
  title: { type: "text" as const, label: "Başlık" },
  description: { type: "textarea" as const, label: "Açıklama" },
  link_label: { type: "text" as const, label: "Bağlantı etiketi" },
  link_url: { type: "text" as const, label: "Bağlantı adresi (/ ile site içi)" },
};

const ORTAK_VARSAYILAN = { title: "", description: "", link_label: "", link_url: "" };

function bosMedya(): PuckMedya {
  return { image_url: "", alt_text: "", decorative: true };
}

/* ── Editör içi yardımcı görünümler ── */

function MedyaOnizleme({ medya, oran = "aspect-[2280/720]" }: { medya: PuckMedya; oran?: string }) {
  if (!medya.image_url) {
    return (
      <div className={`flex ${oran} items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-400`}>
        Görsel seçin
      </div>
    );
  }
  return (
    <div className={`${oran} overflow-hidden rounded-2xl bg-slate-100`}>
      <img
        src={medya.image_url}
        alt={medya.decorative ? "" : (medya.alt_text ?? "")}
        className={`h-full w-full ${medya.fit === "contain" ? "object-contain" : "object-cover"}`}
      />
    </div>
  );
}

function BolumBasligi({ title, link_label }: { title?: string; link_label?: string }) {
  if (!title && !link_label) return null;
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {link_label && <span className="text-sm font-medium text-slate-500">{link_label} →</span>}
    </div>
  );
}

/** Kategori çoklu seçimi — gerçek kategori listesinden onay kutuları. */
function KategoriSecici({
  value,
  onChange,
}: {
  value: number[] | undefined;
  onChange: (ids: number[]) => void;
}) {
  const { data: kategoriler = [] } = useCategories();
  const secili = new Set(value ?? []);
  return (
    <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
      {kategoriler.length === 0 && (
        <p className="text-xs text-slate-400">Kategori bulunamadı.</p>
      )}
      {kategoriler.map((k) => (
        <label key={k.id} className="flex items-center gap-2 text-[13px] text-slate-700">
          <input
            type="checkbox"
            checked={secili.has(k.id)}
            onChange={(e) => {
              const sonraki = new Set(secili);
              if (e.target.checked) sonraki.add(k.id);
              else sonraki.delete(k.id);
              onChange([...sonraki]);
            }}
          />
          {k.name}
        </label>
      ))}
    </div>
  );
}

/* ── Config ── */

export const puckConfig: Config = {
  categories: {
    vitrin: {
      title: "Vitrin blokları",
      components: [
        "HeroCarousel",
        "Banner",
        "ImageCardGrid",
        "ProductRail",
        "CategoryGrid",
        "RichText",
        "RecentlyViewed",
      ],
    },
  },
  components: {
    HeroCarousel: {
      label: "Hero (kaydırmalı görsel)",
      fields: {
        slides: {
          type: "array",
          label: "Slaytlar (1-8)",
          getItemSummary: (item: PuckMedya, i) => item.alt_text || `Slayt ${(i ?? 0) + 1}`,
          arrayFields: {
            image_url: medyaUrlAlani("Görsel"),
            alt_text: { type: "text", label: "Alternatif metin" },
            link_url: { type: "text", label: "Bağlantı" },
          },
          defaultItemProps: bosMedya() as unknown as Record<string, unknown>,
          max: 8,
          min: 1,
        },
        autoplay_ms: { type: "number", label: "Otomatik geçiş (ms)", min: 0 },
      },
      defaultProps: { slides: [bosMedya()], autoplay_ms: 6500 },
      render: ({ slides }) => (
        <div className="mx-auto max-w-6xl px-4 py-3">
          <div className="flex snap-x gap-4 overflow-x-auto pb-2">
            {(slides as PuckMedya[]).map((s, i) => (
              <div key={i} className="w-full flex-none snap-start">
                <MedyaOnizleme medya={s} />
              </div>
            ))}
          </div>
        </div>
      ),
    },

    Banner: {
      label: "Banner",
      fields: { ...ORTAK_ALANLAR, image: medyaAlani("Banner görseli") },
      defaultProps: { ...ORTAK_VARSAYILAN, image: null },
      render: ({ image }) => (
        <div className="mx-auto max-w-6xl px-4 py-3">
          <MedyaOnizleme medya={(image as PuckMedya | null) ?? bosMedya()} oran="aspect-[2280/520]" />
        </div>
      ),
    },

    ImageCardGrid: {
      label: "Resimli kartlar",
      fields: {
        ...ORTAK_ALANLAR,
        cards: {
          type: "array",
          label: "Kartlar (1-8)",
          getItemSummary: (item: PuckMedya, i) =>
            item.label || item.alt_text || `Kart ${(i ?? 0) + 1}`,
          arrayFields: {
            image_url: medyaUrlAlani("Görsel"),
            alt_text: { type: "text", label: "Alternatif metin" },
            label: { type: "text", label: "Kart etiketi" },
            link_url: { type: "text", label: "Bağlantı" },
          },
          defaultItemProps: bosMedya() as unknown as Record<string, unknown>,
          max: 8,
          min: 1,
        },
        overlay: {
          type: "radio",
          label: "Hero üzerine bindir",
          options: [
            { label: "Hayır", value: false },
            { label: "Evet", value: true },
          ],
        },
      },
      defaultProps: { ...ORTAK_VARSAYILAN, cards: [bosMedya()], overlay: false },
      render: ({ title, link_label, cards }) => (
        <section className="mx-auto max-w-6xl px-4 py-3">
          <BolumBasligi title={title as string} link_label={link_label as string} />
          <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
            {(cards as PuckMedya[]).map((c, i) => (
              <div key={i}>
                <MedyaOnizleme medya={c} oran="aspect-square" />
                {c.label && <p className="mt-1.5 text-sm font-medium text-slate-700">{c.label}</p>}
              </div>
            ))}
          </div>
        </section>
      ),
    },

    ProductRail: {
      label: "Ürün rayı (koleksiyon)",
      fields: {
        ...ORTAK_ALANLAR,
        product_set: {
          type: "external",
          label: "Koleksiyon",
          placeholder: "Koleksiyon seç…",
          fetchList: async () => {
            const sets = await fetchProductSets();
            return sets.map((s) => ({ id: s.id, title: s.name || `#${s.id}` }));
          },
          getItemSummary: (item: KoleksiyonSecimi) => item.title,
        },
      },
      defaultProps: { ...ORTAK_VARSAYILAN, title: "Öne çıkanlar", product_set: null },
      render: ({ title, link_label, product_set }) => (
        <section className="mx-auto max-w-6xl px-4 py-3">
          <BolumBasligi title={title as string} link_label={link_label as string} />
          <p className="mt-1 text-xs text-slate-400">
            {product_set
              ? `Koleksiyon: ${(product_set as KoleksiyonSecimi).title} — ürün kartları yayında gerçek veriden çizilir.`
              : "Koleksiyon seçilmedi."}
          </p>
          <div className="mt-3 flex gap-4 overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="w-40 flex-none">
                <div className="aspect-[3/4] rounded-xl bg-slate-100" />
                <div className="mt-2 h-3 w-3/4 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        </section>
      ),
    },

    CategoryGrid: {
      label: "Kategori ızgarası",
      fields: {
        ...ORTAK_ALANLAR,
        category_ids: {
          type: "custom",
          label: "Kategoriler",
          render: ({ value, onChange }) => (
            <FieldLabel label="Kategoriler (en az 1)">
              <KategoriSecici value={value as number[] | undefined} onChange={onChange} />
            </FieldLabel>
          ),
        },
      },
      defaultProps: { ...ORTAK_VARSAYILAN, title: "Kategoriler", category_ids: [] },
      render: ({ title, category_ids }) => (
        <section className="mx-auto max-w-6xl px-4 py-3">
          <BolumBasligi title={title as string} />
          <p className="mt-1 text-xs text-slate-400">
            {(category_ids as number[])?.length
              ? `${(category_ids as number[]).length} kategori seçili — kart görselleri yayında gerçek veriden gelir.`
              : "Henüz kategori seçilmedi."}
          </p>
          <div className="mt-3 grid grid-cols-3 gap-3 md:grid-cols-6">
            {Array.from({ length: Math.max(1, (category_ids as number[])?.length || 6) }).map((_, i) => (
              <div key={i} className="aspect-square rounded-xl bg-slate-100" />
            ))}
          </div>
        </section>
      ),
    },

    RichText: {
      label: "Metin bloğu",
      fields: {
        title: ORTAK_ALANLAR.title,
        content: { type: "textarea", label: "İçerik (düz metin — HTML kullanılamaz)" },
      },
      defaultProps: { title: "", content: "" },
      render: ({ title, content }) => (
        <section className="mx-auto max-w-3xl px-4 py-3">
          {(title as string) && <h2 className="text-lg font-semibold text-slate-900">{title as string}</h2>}
          <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-slate-600">
            {(content as string) || "Metin girin…"}
          </p>
        </section>
      ),
    },

    RecentlyViewed: {
      label: "Son görüntülenenler",
      fields: {
        title: ORTAK_ALANLAR.title,
        description: ORTAK_ALANLAR.description,
      },
      defaultProps: { title: "Son görüntülenenler", description: "" },
      render: ({ title }) => (
        <section className="mx-auto max-w-6xl px-4 py-3">
          <BolumBasligi title={(title as string) || "Son görüntülenenler"} />
          <p className="mt-1 text-xs text-slate-400">
            Ziyaretçiye kendi gezdiği ürünler gösterilir; sayfada en fazla bir tane olabilir.
          </p>
        </section>
      ),
    },
  },
};
