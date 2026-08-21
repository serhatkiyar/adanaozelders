// Sayım oturumları listesi — durum filtresi + zorunlu sayfalama.
//
// Renk tek başına durum anlatmaz: her satırda rozetin METNİ de vardır.
//
// Satır sayısı ve "yeniden sayım gerekiyor" işareti SUNUCUDAN gelir
// (`line_count` / `has_stale`, sayfa başına tek toplu sorgu). İstemci bu
// sayıları hesaplamaz: oturum oturum detay çekmek N+1 istek, tahmin yürütmek
// ise yalan olurdu. Alanlar gelmezse sayı uydurulmaz, "bilinmiyor" denir.
//
// ── İP-A7d3 · göç dalgası 3 ──
//
// Ekran dört ayrı borç taşıyordu:
//   1. `yeniAcik` — ekranda yaşayan pencere durumu;
//   2. SK-4 sınıfı: pencerede üç alanlı bir form vardı ve kirli form bekçisi
//      HİÇ çağrılmıyordu — seçilen ürünler + kategori + not, ×/ESC/dış
//      tıklamada sormadan gidiyordu;
//   3. `disabled={!gecerli}` — kilitli kararın açık ihlali: kullanıcı düğmeye
//      basamadığında hangi alanın eksik olduğunu göremiyordu;
//   4. elle `<ul>` listesi + elle sayfalama düğmeleri + elle `useSearchParams`.
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";

import { Badge, Button, ErrorState, PageSkeleton } from "@/components/admin/ui";
import { DataTable } from "@/components/admin/data-table";
import {
  DuzenlemePenceresi,
  useDuzenlemeYuzeyi,
  useYuzeyKirliFormBekcisi,
  type DuzenlemeYuzeyiDurumu,
} from "@/components/admin/ui2/duzenlemeYuzeyi";
import { Form, sunucuHatasiniUygula } from "@/components/admin/ui2/form";
import { ProductPicker } from "@/components/admin/ProductPicker";
import { useUrlDurumu } from "@/hooks/useUrlDurumu";
import { useCountSessions, useCreateCountSession } from "@/hooks/useInventory";
import { useInventoryAccess } from "@/hooks/useInventoryAccess";
import {
  inventoryErrorMessage,
  lineCountLabel,
  needsRecount,
  sessionStatusBadge,
  type CountScope,
  type CountSessionStatus,
} from "@/lib/inventory";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";

import type { CountSessionOut } from "@/api/inventory";
import type { ProductSearchOut } from "@/types";

const PAGE_SIZE = 25;

const TARIH = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const DURUMLAR: { value: "" | CountSessionStatus; label: string }[] = [
  { value: "", label: "Tüm durumlar" },
  { value: "DRAFT", label: "Taslak" },
  { value: "IN_PROGRESS", label: "Sayım sürüyor" },
  { value: "REVIEW", label: "İncelemede" },
  { value: "APPLIED", label: "Uygulandı" },
  { value: "CANCELLED", label: "İptal edildi" },
];

/**
 * Adresten gelen durum için BEYAZ LİSTE.
 *
 * `useUrlDurumu` tipi ve varsayılanı yönetir ama `?durum=drop_table` gibi bir
 * değeri eleyemez (`PackagesPage`te verilen kararın aynısı).
 */
const GECERLI_DURUMLAR = new Set<string>(
  DURUMLAR.map((d) => d.value).filter(Boolean) as string[]
);

const KAPSAM: Record<CountScope, string> = {
  ALL: "Tüm ürünler",
  CATEGORY: "Kategori",
  MANUAL: "Seçili ürünler",
};

/* ══════════════ Yeni oturum yüzeyi ══════════════ */

/**
 * Kapsam formunun şeması — üç koşullu dal, üçü de ayrı doğrulama ister.
 *
 * `superRefine` kullanılıyor çünkü hangi alanın zorunlu olduğu KAPSAMA bağlı:
 * `MANUAL`de ürün seçimi, `CATEGORY`de kategori numarası. Eskiden bu kural tek
 * bir `gecerli` boolean'ıydı ve düğmeyi kapatıyordu; artık hata İLGİLİ ALANIN
 * altında çıkar.
 */
const oturumSemasi = z
  .object({
    scope: z.enum(["MANUAL", "CATEGORY", "ALL"]),
    urunler: z.array(z.custom<ProductSearchOut>()),
    kategori: z.string(),
    not: z.string().max(500, "Not en fazla 500 karakter olabilir."),
  })
  .superRefine((deger, ctx) => {
    if (deger.scope === "MANUAL" && deger.urunler.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["urunler"],
        message: "En az bir ürün seçin.",
      });
    }
    if (deger.scope === "CATEGORY" && !(Number(deger.kategori) > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["kategori"],
        message: "Geçerli bir kategori numarası girin.",
      });
    }
  });

type OturumDegerleri = z.infer<typeof oturumSemasi>;

const OTURUM_SIRA = ["scope", "urunler", "kategori", "not"] as const;

function YeniSayimPenceresi({
  yuzey,
}: {
  yuzey: DuzenlemeYuzeyiDurumu<never, void>;
}) {
  return (
    <DuzenlemePenceresi
      yuzey={yuzey}
      baslik="Yeni sayım oturumu"
      aciklama="Kapsamı seçin. Oturum taslak olarak açılır; sayıma başlamadan ürün ekleyebilirsiniz."
    >
      <YeniSayimIcerik yuzey={yuzey} />
    </DuzenlemePenceresi>
  );
}

function YeniSayimIcerik({ yuzey }: { yuzey: DuzenlemeYuzeyiDurumu<never, void> }) {
  const olustur = useCreateCountSession();

  const form = useForm<OturumDegerleri>({
    resolver: zodResolver(oturumSemasi),
    defaultValues: { scope: "MANUAL", urunler: [], kategori: "", not: "" },
    mode: "onChange",
    shouldFocusError: false,
  });

  useYuzeyKirliFormBekcisi({ form, sunucuHatasi: olustur.error });

  const scope = form.watch("scope");

  const gonder = form.handleSubmit(
    (deger) => {
      form.clearErrors("root.sunucu");
      const idler = deger.urunler.map((p) => p.id);
      olustur.mutate(
        {
          scope: deger.scope,
          product_ids: deger.scope === "MANUAL" ? idler : undefined,
          category_id: deger.scope === "CATEGORY" ? Number(deger.kategori) : undefined,
          note: deger.not.trim() || null,
        },
        {
          onSuccess: () => {
            toast.success("Sayım oturumu açıldı.");
            yuzey.kapat();
          },
          onError: (e) => {
            const kalan = sunucuHatasiniUygula(e, form, ["scope", "kategori", "not"], undefined, (h) =>
              inventoryErrorMessage(h, "Sayım oturumu açılamadı.")
            );
            form.setError("root.sunucu", { type: "server", message: kalan ?? undefined });
          },
        }
      );
    },
    (hatalar) => {
      const alan = OTURUM_SIRA.find((a) => hatalar[a]);
      // `urunler` bir dizi alanıdır ve odaklanacak bir denetimi yoktur;
      // `ProductPicker`ın arama kutusuna düşülür.
      if (alan && alan !== "urunler") form.setFocus(alan);
    }
  );

  const genelHata = form.formState.errors.root?.sunucu?.message;

  return (
    <div className="space-y-4">
      {genelHata && (
        <p
          role="alert"
          className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
        >
          {genelHata}
        </p>
      )}

      <Form.Field
        control={form.control}
        name="scope"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Kapsam</Form.Label>
            <Form.Control>
              <select className="input" {...field}>
                <option value="MANUAL">Seçili ürünler</option>
                <option value="CATEGORY">Kategori</option>
                <option value="ALL">Tüm ürünler</option>
              </select>
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      {scope === "MANUAL" && (
        <Form.Field
          control={form.control}
          name="urunler"
          render={({ field }) => (
            <Form.Item>
              <ProductPicker selected={field.value} onChange={field.onChange} />
              {field.value.length > 0 && (
                <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                  {field.value.length} ürün seçildi.
                </span>
              )}
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
      )}

      {scope === "CATEGORY" && (
        <Form.Field
          control={form.control}
          name="kategori"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Kategori numarası</Form.Label>
              <Form.Control>
                <input className="input" inputMode="numeric" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
      )}

      <Form.Field
        control={form.control}
        name="not"
        render={({ field }) => (
          <Form.Item>
            <Form.Label optional>Not</Form.Label>
            <Form.Control>
              <input className="input" maxLength={500} {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      <div className="flex justify-end">
        {/* Düğme geçerlilikle KAPANMAZ (kilitli karar). */}
        <Button isPending={olustur.isPending} onClick={gonder}>
          Oturumu aç
        </Button>
      </div>
    </div>
  );
}

/* ══════════════ Sayfa ══════════════ */

export default function CountSessionsPage() {
  const navigate = useNavigate();
  // Filtre ve sayfa ADRESTE yaşar; sayfa filtre değişince 1'e döner.
  const url = useUrlDurumu(
    { durum: "", sayfa: 1 },
    { sayfaAnahtari: "sayfa", filtreDisi: ["sayfa"], replace: true }
  );
  const hamDurum = String(url.degerler.durum);
  const durum = (GECERLI_DURUMLAR.has(hamDurum) ? hamDurum : "") as "" | CountSessionStatus;
  const sayfa = Math.max(1, Number(url.degerler.sayfa) || 1);
  const yeni = useDuzenlemeYuzeyi<never, void>();
  const { canCount } = useInventoryAccess();

  const sorgu = useCountSessions({
    status: durum,
    limit: PAGE_SIZE,
    offset: (sayfa - 1) * PAGE_SIZE,
  });

  const oturumlar = sorgu.data?.items ?? [];
  const toplam = sorgu.data?.total ?? 0;

  const yeniButon = (
    <Button size="sm" onClick={() => yeni.yeniAc()}>
      Yeni sayım
    </Button>
  );

  const kolonlar = useMemo<ColumnDef<CountSessionOut, unknown>[]>(
    () => [
      {
        id: "code",
        header: "Oturum",
        enableSorting: false,
        cell: ({ row }) => (
          <div>
            {/* Kod GERÇEK bir bağlantı kalır: satır tıklaması onu ikame etmez.
                Orta tuş / "yeni sekmede aç" yalnız `<a href>` ile çalışır ve
                `DataTable` etkileşimli kaynaktan gelen tıklamayı zaten
                yutmaz — ikisi çakışmaz. */}
            <Link
              to={ROUTES.adminInventoryCount(row.original.id)}
              className="font-semibold text-slate-900 hover:underline dark:text-white"
            >
              {row.original.code}
            </Link>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              <span data-testid="scope">
                {KAPSAM[row.original.scope] ?? row.original.scope}
              </span>
              {" · "}
              <span data-testid="created-by">Açan: #{row.original.created_by_admin_id}</span>
            </p>
          </div>
        ),
      },
      {
        id: "lines",
        header: "Satır",
        enableSorting: false,
        cell: ({ row }) => (
          <span data-testid="line-count" className="text-xs tabular-nums">
            {lineCountLabel(row.original)}
          </span>
        ),
      },
      {
        id: "stale",
        header: "Uyarı",
        enableSorting: false,
        cell: ({ row }) =>
          needsRecount(row.original) ? <StaleRozeti /> : <span className="text-xs">—</span>,
      },
      {
        id: "created_at",
        header: "Açılış",
        enableSorting: false,
        cell: ({ row }) => (
          <span data-testid="created-at" className="whitespace-nowrap text-xs tabular-nums">
            {TARIH.format(new Date(row.original.created_at))}
          </span>
        ),
      },
      {
        id: "status",
        header: "Durum",
        enableSorting: false,
        cell: ({ row }) => {
          const rozet = sessionStatusBadge(row.original.status);
          return <Badge tone={rozet.tone}>{rozet.label}</Badge>;
        },
      },
    ],
    []
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
        <div className="mr-auto">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Sayım oturumları</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Detay için satıra tıklayın. Fark yalnız inceleme sonrası uygulanır.
          </p>
        </div>
        <label className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Duruma göre
          </span>
          <select
            className="input w-auto"
            value={durum}
            onChange={(e) => url.ayarla({ durum: e.target.value })}
          >
            {DURUMLAR.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        {canCount && yeniButon}
      </div>

      {sorgu.isError ? (
        <div className="p-6">
          <ErrorState
            description={inventoryErrorMessage(sorgu.error, "Sayım oturumları yüklenemedi.")}
            onRetry={() => sorgu.refetch()}
          />
        </div>
      ) : sorgu.isLoading ? (
        <div className="p-6">
          <PageSkeleton rows={4} />
        </div>
      ) : (
        <div className="p-6 pt-0">
          <DataTable
            columns={kolonlar}
            data={oturumlar}
            getRowId={(o) => String(o.id)}
            emptyTitle={durum ? "Bu durumda oturum yok" : "Henüz sayım oturumu açılmadı"}
            emptyDescription={
              durum
                ? "Farklı bir durum seçin ya da filtreyi kaldırın."
                : "Sayım, rafta gerçekten ne olduğunu kayda geçirir. Kapsamı seçip bir oturum açın."
            }
            // Boş durum İKİYE ayrılır: süzgeç eşleşmediğinde çıkış yolu
            // verilir, hiç oturum yokken davet edilir.
            emptyAction={
              durum ? (
                <Button size="sm" variant="secondary" onClick={() => url.ayarla({ durum: "" })}>
                  Süzgeci temizle
                </Button>
              ) : canCount ? (
                yeniButon
              ) : undefined
            }
            onRowClick={(o) => navigate(ROUTES.adminInventoryCount(o.id))}
            satirAdi={(o) => `${o.code} — sayım oturumu`}
            renderMobileRow={(o) => {
              const rozet = sessionStatusBadge(o.status);
              return (
                <div data-testid={`session-row-${o.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        to={ROUTES.adminInventoryCount(o.id)}
                        className="font-semibold text-slate-900 hover:underline dark:text-white"
                      >
                        {o.code}
                      </Link>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        <span data-testid="scope">{KAPSAM[o.scope] ?? o.scope}</span>
                        {" · "}
                        <span data-testid="created-by">Açan: #{o.created_by_admin_id}</span>
                      </p>
                    </div>
                    <Badge tone={rozet.tone}>{rozet.label}</Badge>
                  </div>
                  <p className="mt-2 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                    <span data-testid="line-count">{lineCountLabel(o)}</span>
                    {" · "}
                    <span data-testid="created-at">{TARIH.format(new Date(o.created_at))}</span>
                  </p>
                  {needsRecount(o) && (
                    <div className="mt-2">
                      <StaleRozeti />
                    </div>
                  )}
                </div>
              );
            }}
            page={sayfa}
            pageSize={PAGE_SIZE}
            total={toplam}
            onPageChange={(p) => url.ayarla({ sayfa: p })}
            onPageSizeChange={() => {}}
          />
        </div>
      )}

      <YeniSayimPenceresi yuzey={yeni} />
    </section>
  );
}

/** İkon + METİN birlikte: renk tek başına durum anlatmaz. */
function StaleRozeti() {
  return (
    <span
      data-testid="stale-flag"
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      </svg>
      Yeniden sayım gerekiyor
    </span>
  );
}
