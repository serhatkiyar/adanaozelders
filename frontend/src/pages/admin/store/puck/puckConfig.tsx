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
import { BlogBodyEditor } from "@/components/admin/content/BlogBodyEditor";
import {
  ZENGIN_METIN_SINIFI,
  bannerBoySinifi,
  bolumSinifi,
  hizaSinifi,
  kolonSinifi,
  type BlokGorunumu,
} from "@/components/store/gorunumSiniflari";
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

/**
 * Küratörlü "Görünüm" alan grubu — backend allowlist'iyle sözleşme
 * (services/store_merchandising_puck.py::GORUNUM_SECENEKLERI). Serbest
 * renk/px bilinçli YOK; preset'ler `gorunumSiniflari.ts` haritasından çizilir.
 */
function gorunumAlanlari(opts: { hiza?: boolean; kolon?: boolean; boy?: boolean } = {}) {
  const alanlar: Record<string, unknown> = {};
  if (opts.hiza !== false) {
    alanlar.hiza = {
      type: "radio",
      label: "Başlık hizası",
      options: [
        { label: "Sol", value: "sol" },
        { label: "Orta", value: "orta" },
      ],
    };
  }
  alanlar.zemin = {
    type: "radio",
    label: "Zemin",
    options: [
      { label: "Beyaz", value: "beyaz" },
      { label: "Yumuşak", value: "yumusak" },
      { label: "Vurgu", value: "vurgu" },
    ],
  };
  alanlar.bosluk = {
    type: "radio",
    label: "Ek dikey boşluk",
    options: [
      { label: "Yok", value: "dar" },
      { label: "Orta", value: "normal" },
      { label: "Geniş", value: "genis" },
    ],
  };
  if (opts.kolon) {
    alanlar.kolon = {
      type: "select",
      label: "Kolon sayısı",
      options: [
        { label: "2", value: "2" },
        { label: "3", value: "3" },
        { label: "4", value: "4" },
      ],
    };
  }
  if (opts.boy) {
    alanlar.boy = {
      type: "radio",
      label: "Yükseklik",
      options: [
        { label: "Normal", value: "normal" },
        { label: "İnce", value: "ince" },
      ],
    };
  }
  return {
    gorunum: { type: "object" as const, label: "Görünüm", objectFields: alanlar },
  };
}

const GORUNUM_VARSAYILAN: { gorunum: BlokGorunumu } = {
  gorunum: { hiza: "sol", zemin: "beyaz", bosluk: "dar" },
};

/** Canvas sarmalayıcısı: public ile AYNI preset haritası — canlı önizleme. */
function GorunumSarici({ g, children }: { g: BlokGorunumu | undefined; children: React.ReactNode }) {
  const sinif = bolumSinifi(g ?? {});
  return sinif ? <div className={sinif}>{children}</div> : <>{children}</>;
}

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

function BolumBasligi({
  title,
  link_label,
  g,
}: {
  title?: string;
  link_label?: string;
  g?: BlokGorunumu;
}) {
  if (!title && !link_label) return null;
  const orta = hizaSinifi(g ?? {});
  return (
    <div className={`flex items-baseline ${orta ? "justify-center text-center" : "justify-between"}`}>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {!orta && link_label && (
        <span className="text-sm font-medium text-slate-500">{link_label} →</span>
      )}
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
        ...gorunumAlanlari({ hiza: false }),
      },
      defaultProps: { slides: [bosMedya()], autoplay_ms: 6500, ...GORUNUM_VARSAYILAN },
      render: ({ slides, gorunum }) => (
        <GorunumSarici g={gorunum as BlokGorunumu}>
        <div className="mx-auto max-w-6xl px-4 py-3">
          <div className="flex snap-x gap-4 overflow-x-auto pb-2">
            {(slides as PuckMedya[]).map((s, i) => (
              <div key={i} className="w-full flex-none snap-start">
                <MedyaOnizleme medya={s} />
              </div>
            ))}
          </div>
        </div>
        </GorunumSarici>
      ),
    },

    Banner: {
      label: "Banner",
      fields: {
        ...ORTAK_ALANLAR,
        image: medyaAlani("Banner görseli"),
        ...gorunumAlanlari({ hiza: false, boy: true }),
      },
      defaultProps: { ...ORTAK_VARSAYILAN, image: null, ...GORUNUM_VARSAYILAN },
      render: ({ image, gorunum }) => (
        <GorunumSarici g={gorunum as BlokGorunumu}>
          <div className="mx-auto max-w-6xl px-4 py-3">
            <MedyaOnizleme
              medya={(image as PuckMedya | null) ?? bosMedya()}
              oran={
                bannerBoySinifi((gorunum as BlokGorunumu) ?? {}).includes("280")
                  ? "aspect-[2280/300]"
                  : "aspect-[2280/520]"
              }
            />
          </div>
        </GorunumSarici>
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
        ...gorunumAlanlari({ kolon: true }),
      },
      defaultProps: {
        ...ORTAK_VARSAYILAN,
        cards: [bosMedya()],
        overlay: false,
        gorunum: { ...GORUNUM_VARSAYILAN.gorunum, kolon: "4" },
      },
      render: ({ title, link_label, cards, gorunum }) => (
        <GorunumSarici g={gorunum as BlokGorunumu}>
        <section className="mx-auto max-w-6xl px-4 py-3">
          <BolumBasligi title={title as string} link_label={link_label as string} g={gorunum as BlokGorunumu} />
          <div className={`mt-3 grid gap-4 ${kolonSinifi((gorunum as BlokGorunumu) ?? {})}`}>
            {(cards as PuckMedya[]).map((c, i) => (
              <div key={i}>
                <MedyaOnizleme medya={c} oran="aspect-square" />
                {c.label && <p className="mt-1.5 text-sm font-medium text-slate-700">{c.label}</p>}
              </div>
            ))}
          </div>
        </section>
        </GorunumSarici>
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
        ...gorunumAlanlari(),
      },
      defaultProps: { ...ORTAK_VARSAYILAN, title: "Öne çıkanlar", product_set: null, ...GORUNUM_VARSAYILAN },
      render: ({ title, link_label, product_set, gorunum }) => (
        <GorunumSarici g={gorunum as BlokGorunumu}>
        <section className="mx-auto max-w-6xl px-4 py-3">
          <BolumBasligi title={title as string} link_label={link_label as string} g={gorunum as BlokGorunumu} />
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
        </GorunumSarici>
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
        ...gorunumAlanlari(),
      },
      defaultProps: { ...ORTAK_VARSAYILAN, title: "Kategoriler", category_ids: [], ...GORUNUM_VARSAYILAN },
      render: ({ title, category_ids, gorunum }) => (
        <GorunumSarici g={gorunum as BlokGorunumu}>
        <section className="mx-auto max-w-6xl px-4 py-3">
          <BolumBasligi title={title as string} g={gorunum as BlokGorunumu} />
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
        </GorunumSarici>
      ),
    },

    RichText: {
      label: "Metin bloğu",
      fields: {
        title: ORTAK_ALANLAR.title,
        content_html: {
          type: "custom",
          label: "İçerik",
          render: ({ value, onChange }) => (
            <FieldLabel label="İçerik">
              <BlogBodyEditor value={(value as string) ?? ""} onChange={onChange} />
            </FieldLabel>
          ),
        },
        ...gorunumAlanlari({ hiza: false }),
      },
      defaultProps: { title: "", content_html: "", ...GORUNUM_VARSAYILAN },
      render: ({ title, content_html, gorunum }) => (
        <GorunumSarici g={gorunum as BlokGorunumu}>
          <section className="mx-auto max-w-3xl px-4 py-3">
            {(title as string) && (
              <h2 className="text-lg font-semibold text-slate-900">{title as string}</h2>
            )}
            {(content_html as string) ? (
              // Editörün KENDİ girdisi (sunucu kaydetmeden temizler; public
              // yalnız sanitize edilmiş kolonu basar).
              <div
                className={ZENGIN_METIN_SINIFI}
                dangerouslySetInnerHTML={{ __html: content_html as string }}
              />
            ) : (
              <p className="mt-2 text-[15px] text-slate-400">Metin girin…</p>
            )}
          </section>
        </GorunumSarici>
      ),
    },

    RecentlyViewed: {
      label: "Son görüntülenenler",
      fields: {
        title: ORTAK_ALANLAR.title,
        description: ORTAK_ALANLAR.description,
        ...gorunumAlanlari(),
      },
      defaultProps: { title: "Son görüntülenenler", description: "", ...GORUNUM_VARSAYILAN },
      render: ({ title, gorunum }) => (
        <GorunumSarici g={gorunum as BlokGorunumu}>
        <section className="mx-auto max-w-6xl px-4 py-3">
          <BolumBasligi title={(title as string) || "Son görüntülenenler"} g={gorunum as BlokGorunumu} />
          <p className="mt-1 text-xs text-slate-400">
            Ziyaretçiye kendi gezdiği ürünler gösterilir; sayfada en fazla bir tane olabilir.
          </p>
        </section>
        </GorunumSarici>
      ),
    },
  },
};
