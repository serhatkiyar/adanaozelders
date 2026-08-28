/**
 * Mağaza "Ürünler" sekmesi — **İP-B2'nin referans liste ekranı**.
 *
 * Panel KENDİ durumunu taşır (form/içe-aktarma görünürlüğü); diğer sekmelerle
 * paylaştığı hiçbir React durumu yoktur — ortak zemin URL (`useSearchParams`)
 * ve React Query önbelleğidir.
 *
 * ## İP-B2 · liste sayfası anatomisi (docs/tasarim-dili.md §5)
 *
 * Bu ekran, diğer 21 liste ekranının kopyalayacağı hâldir. Yukarıdan aşağı
 * sabit sıra:
 *
 *   1. **Üst başlık** — `<h1>` ve birincil aksiyon KABUKTAN gelir
 *      (`PanelBaslikAksiyonu`). "Yeni ürün" artık içeriğin içinde değil,
 *      panelin her ekranındaki aynı yerde.
 *   2. **Araç çubuğu** — arama · "Filtre ekle" · "Sırala". Bu ekran yalnız
 *      HANGİ filtreleri sunacağını söyler; düzeni, gecikmeyi, URL yazımını ve
 *      sayfa sıfırlamayı `ListeAracCubugu` yapar.
 *   3. **Uygulanan filtre çipleri** — araç çubuğundan gelir, tek tek
 *      kaldırılabilir.
 *   4. **Tablo** — `DataTable` (sunucu taraflı sıralama korunur).
 *   5. **Sayfalama** — `DataTable`ın altbilgisi.
 *
 * ### Ne KAYBOLDU ve neden
 *
 * Dört `<select>`li filtre şeridi kalktı. Ölçülen sorun: dört açılır liste
 * yan yana, 380 px'te alt alta dört satıra kırılıyordu ve hiçbiri
 * "uygulanmış mı" bilgisini taşımıyordu (varsayılan "Tümü" ile seçili değer
 * aynı görünüyordu). Menü + çip deseni ikisini birden çözer: uygulanmamış
 * filtre yer kaplamaz, uygulanmış filtre bir çip olarak GÖRÜNÜR ve tek
 * dokunuşla kalkar.
 *
 * ### Satır aksiyonları — Ç-2 · D
 *
 * Açıkta iki düğme: **Düzenle** ve **Yayınla/Gizle**. Menüde: kapak yükleme
 * ve **Sil** (yıkıcı, onay adımlı). Kural `SatirAksiyonlari`nde zorlanır —
 * üçüncü bir açık düğme ya da açıkta bir yıkıcı aksiyon yazılırsa
 * geliştirmede GÜRÜLTÜLÜ patlar.
 *
 * ### Mobil
 *
 * `renderMobileRow` İLK KEZ bağlandı (İP-B1 envanteri T1: "bugün
 * kullanılmıyor — B2'de bağlanır"). 380 px'te tablo gizlenir, yerine kart
 * gelir: kimlik satırı + en fazla üç meta satırı + aksiyonlar. Yatay kaydırma
 * çözüm değildir.
 *
 * ### Tedarikçi (D-6/D-8) — B2 anatomisine UYARLANDI
 *
 * Tedarikçi entegrasyonu bu ekrana eski dört `<select>`li şerit üzerinden
 * girmişti. Şerit kalkınca süzgeç kaybolabilirdi; kaybolsa hiçbir test
 * kırılmazdı (birleşme anında tedarikçi yüzeyinin tek bir testi yoktu).
 * Bugünkü hâl: süzgeç `filtreler` dizisinin bir üyesi, "Maliyet / Marj"
 * kolonu ise `kolonlar` dizisine sonradan eklenen bir kolon — ikisi de
 * `suppliers.view` duvarının arkasında. Mobil kart da tedarikçi stoğunu ve
 * maliyeti gösterir; nöbetçisi `urunListesiAnatomisi.acceptance` · F.
 *
 * ## Sıralama deseni (İP-A6 · Görev 2'den DEĞİŞMEDİ)
 *
 * Sıralama SUNUCUDA yapılır (`DataTable` `manualSorting`), seçim URL'de yaşar
 * (`sirala`/`yon`; `lib/storeProductQuery`) ve gösterge hem görsel hem
 * `aria-sort` ile duyurulur. Araç çubuğundaki "Sırala" düğmesi ile tablo
 * başlığındaki gösterge AYNI URL durumunu okur — çelişemezler.
 */
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";

import { AccessDenied, ReadOnlyNotice, useAdminAreaAccess } from "@/components/admin/AccessState";
import { Badge, Button, ErrorState } from "@/components/admin/ui";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/yuzeyDurumu";
import {
  KayitYokDurumu,
  ListeAracCubugu,
  SatirAksiyonlari,
  SonucYokDurumu,
  useListeTemizleme,
  type FiltreTanimi,
  type SatirAksiyonu,
} from "@/components/admin/ui2/liste";
import { PanelBaslikAksiyonu } from "@/components/admin/layout/baslikAksiyonu";
import { DataTable } from "@/components/admin/data-table";
import { StockBadge } from "@/components/admin/StockBadge";
import { deleteProduct, updateProduct, uploadProductCover } from "@/api/store";
import {
  useAdminProducts,
  useBookFacets,
  useInvalidateAdminStore,
  useStoreConfig,
} from "@/hooks/useStore";
import { setQueryValue } from "@/lib/adminUserQuery";
import { getErrorDetail } from "@/lib/errors";
import { formatTL } from "@/lib/money";
import {
  filtreVarMi,
  parseUrunSorgusu,
  urunSorgusundanIstek,
} from "@/lib/storeProductQuery";
import { toast } from "@/store/toastStore";
import type { ProductSearchOut } from "@/types";

import { BulkImportPanel } from "./BulkImportPanel";
import { EditProductModal } from "./EditProductModal";
import { ProductForm } from "./ProductForm";

/** Sıralama seçenekleri — `URUN_SIRALARI` ile aynı küme, insan adlarıyla. */
const SIRALAMA_SECENEKLERI = [
  { deger: "created_at", etiket: "Eklenme" },
  { deger: "title", etiket: "Başlık" },
  { deger: "price", etiket: "Fiyat" },
  { deger: "stock", etiket: "Stok" },
];

const STOK_SECENEKLERI = [
  { deger: "tukendi", etiket: "Tükendi" },
  { deger: "azalan", etiket: "Azalan" },
  { deger: "kritik", etiket: "Tükendi + azalan" },
  { deger: "var", etiket: "Stokta" },
];

/**
 * Tedarikçi kovaları (D-6) — `TEDARIKCI_FILTRELERI` ile aynı küme.
 *
 * `below_cost` bir süzgeç değil ALARM listesidir; menüde de öyle adlandırılır
 * ("Zararına satılan"), çünkü çipe düştüğünde tek başına okunacak.
 */
const TEDARIKCI_SECENEKLERI = [
  { deger: "linked", etiket: "Bağlı" },
  { deger: "backed", etiket: "Tedarikçiden temin" },
  { deger: "below_cost", etiket: "Zararına satılan" },
];

export function ProductsPanel() {
  const { canView, canManage } = useAdminAreaAccess("products");
  // Tedarikçi maliyeti AYRI bir izin alanıdır (sözleşme §3/D-6).
  const tedarikciGorebilir = useAdminAreaAccess("suppliers").canView;
  const [params, setParams] = useSearchParams();
  const durum = parseUrunSorgusu(params);
  const { data, isLoading, isError, error, refetch } = useAdminProducts(
    urunSorgusundanIstek(durum)
  );
  const config = useStoreConfig();
  const invalidate = useInvalidateAdminStore();
  const facets = useBookFacets();
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // Sıralama ve sayfa boyu KORUNUR: "filtreleri temizle" diyen kullanıcı
  // listeyi genişletmek ister, sıralamasını kaybetmek değil.
  const temizle = useListeTemizleme(["sirala", "yon", "limit"]);

  function guncelle(degisiklikler: Record<string, string | number | undefined>) {
    setParams((onceki) => {
      const sonraki = setQueryValue(new URLSearchParams(onceki), degisiklikler);
      // Sayfa numarası filtre/sıralama değişiminde sıfırlanır (kendisi
      // değiştirilmiyorsa).
      if (!("sayfa" in degisiklikler)) sonraki.delete("sayfa");
      return sonraki;
    });
  }

  if (!canView) return <AccessDenied area="Ürünler" />;
  if (isError) {
    return (
      <ErrorState
        description={getErrorDetail(error, "Ürünler yüklenemedi.")}
        onRetry={() => void refetch()}
      />
    );
  }

  const urunler = data?.items ?? [];
  const toplam = data?.total ?? -1;
  const filtreli = filtreVarMi(durum);
  const esik = config.data?.low_stock_threshold;

  const filtreler: FiltreTanimi[] = [
    { anahtar: "stok", etiket: "Stok durumu", secenekler: STOK_SECENEKLERI },
    // Tedarikçi süzgeci maliyet kolonuyla AYNI izin duvarının arkasında
    // (D-6): `suppliers.view`i olmayan yönetici için sunucu `supplier`
    // bloğunu doldurmaz — filtre ona boş liste döndürürdü.
    ...(tedarikciGorebilir
      ? [{ anahtar: "tedarikci", etiket: "Tedarikçi", secenekler: TEDARIKCI_SECENEKLERI }]
      : []),
    {
      anahtar: "yayinevi",
      etiket: "Yayınevi",
      yukleniyor: facets.isLoading,
      secenekler: (facets.data?.publisher ?? []).map((f) => ({
        deger: f.value,
        etiket: f.value,
        sayi: f.count,
      })),
    },
    {
      anahtar: "yazar",
      etiket: "Yazar",
      yukleniyor: facets.isLoading,
      secenekler: (facets.data?.author ?? []).map((f) => ({
        deger: f.value,
        etiket: f.value,
        sayi: f.count,
      })),
    },
  ];

  const kolonlar: ColumnDef<ProductSearchOut, unknown>[] = [
    // `accessorFn` sıralama İÇİN gerekli: TanStack, veri erişimi olmayan
    // (yalnız `cell` taşıyan) kolonları "display" sayar ve `getCanSort()`
    // false döndürür — başlık düğmeye dönüşmez. Sıralamanın kendisi sunucuda
    // yapılır (`manualSorting`), erişim yalnız kolonu sıralanabilir kılar.
    {
      id: "title",
      accessorFn: (p) => p.title,
      header: "Başlık",
      enableSorting: true,
      cell: ({ row }) => <UrunHucresi product={row.original} />,
    },
    {
      id: "stock",
      accessorFn: (p) => p.stock ?? -1,
      header: "Stok",
      enableSorting: true,
      // Eşik bilinmiyorsa rozet "azalan" ayrımını yapmaz ama "Tükendi"yi
      // yine gösterir (bkz. StockBadge).
      cell: ({ row }) => <StokHucresi product={row.original} esik={esik} />,
    },
    {
      id: "price",
      accessorFn: (p) => p.price,
      header: "Fiyat",
      enableSorting: true,
      cell: ({ row }) => (
        <span className="whitespace-nowrap tabular-nums">{formatTL(row.original.price)}</span>
      ),
    },
    {
      id: "status",
      header: "Durum",
      cell: ({ row }) => <UrunDurumRozeti status={row.original.status} />,
    },
    {
      id: "created_at",
      accessorFn: (p) => p.id,
      header: "Eklenme",
      enableSorting: true,
      // Değer gösterilmez, kolon yalnız "Eklenme sırasına göre sırala"
      // düğmesini taşır: tarihin kendisi listede bir karar girdisi değil,
      // sırası öyle.
      cell: () => null,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <UrunAksiyonlari
          product={row.original}
          canManage={canManage}
          onChange={invalidate}
        />
      ),
    },
  ];

  // ── Maliyet/marj kolonu izin duvarının ARKASINDA (D-6) ──
  //
  // Blok yalnız admin yanıtında dolar, ama `suppliers.view`i olmayan bir
  // yönetici için sunucu onu da doldurmaz: kolon baştan sona "—" olurdu.
  // Görev ayrılığı ekranda da görünsün: kolon o role hiç basılmaz.
  if (tedarikciGorebilir) {
    kolonlar.splice(3, 0, {
      id: "maliyet",
      header: "Maliyet / Marj",
      cell: ({ row }) => <MaliyetHucresi product={row.original} />,
    });
  }

  return (
    <div className="space-y-4">
      {/* Birincil aksiyon KABUĞUN başlık şeridine portallanır (tasarım dili
          §4.2). Kabuk yoksa (kabul testi, çalışma zamanı kapısı) satır içinde
          çizilir — gerekçe `baslikAksiyonu.tsx`te. */}
      {canManage ? (
        <PanelBaslikAksiyonu>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              aria-expanded={showImport}
              onClick={() => setShowImport((v) => !v)}
            >
              {showImport ? "Kapat" : "Toplu içe aktar"}
            </Button>
            <Button size="sm" aria-expanded={showForm} onClick={() => setShowForm((v) => !v)}>
              {showForm ? "Kapat" : "Yeni ürün"}
            </Button>
          </div>
        </PanelBaslikAksiyonu>
      ) : (
        <ReadOnlyNotice />
      )}

      {canManage && showImport && <BulkImportPanel onDone={invalidate} />}
      {showForm && (
        <div className="rounded-2xl border border-panel-border p-4">
          <ProductForm
            mode="create"
            onDone={() => {
              setShowForm(false);
              invalidate();
            }}
          />
        </div>
      )}

      <ListeAracCubugu
        arama={{
          etiket: "Ürün ara",
          ipucu: "Başlık, yazar, yayınevi, ISBN veya SKU",
        }}
        filtreler={filtreler}
        siralama={{
          anahtar: "sirala",
          yonAnahtari: "yon",
          varsayilan: "created_at",
          varsayilanYon: "desc",
          secenekler: SIRALAMA_SECENEKLERI,
        }}
      />

      <DataTable
        columns={kolonlar}
        data={urunler}
        getRowId={(p) => String(p.id)}
        isLoading={isLoading}
        sorting={[{ id: durum.sort, desc: durum.order === "desc" }]}
        onSortingChange={(guncelleyici) => {
          const sonraki =
            typeof guncelleyici === "function"
              ? guncelleyici([{ id: durum.sort, desc: durum.order === "desc" }])
              : guncelleyici;
          const ilk = sonraki[0];
          if (!ilk) return;
          guncelle({ sirala: ilk.id, yon: ilk.desc ? "desc" : "asc" });
        }}
        page={durum.page}
        pageSize={durum.pageSize}
        total={toplam < 0 ? urunler.length : toplam}
        onPageChange={(sayfa) => guncelle({ sayfa })}
        onPageSizeChange={(boyut) => guncelle({ limit: boyut, sayfa: 1 })}
        renderMobileRow={(p) => (
          <UrunKarti
            product={p}
            esik={esik}
            canManage={canManage}
            onChange={invalidate}
            tedarikciGorebilir={tedarikciGorebilir}
          />
        )}
        bos={{
          filtreli,
          kayitYok: (
            <KayitYokDurumu
              baslik="Henüz ürün eklenmemiş"
              aciklama="İlk ürünü ekleyerek kataloğu oluşturmaya başlayın."
              aksiyon={
                canManage ? (
                  <Button size="sm" onClick={() => setShowForm(true)}>
                    Yeni ürün
                  </Button>
                ) : undefined
              }
            />
          ),
          sonucYok: (
            <SonucYokDurumu
              // Metin `adminStorePanel.acceptance` (E-2) sözleşmesiyle
              // hizalıdır: "kayıt yok" ile "sonuç yok" AYNI cümle olamaz ve
              // ikincisi eşleşmeden söz etmelidir.
              baslik="Eşleşen ürün yok"
              aciklama="Arama ve filtreleri gevşetmeyi deneyin; katalogda ürün var."
              onTemizle={temizle}
            />
          ),
        }}
      />
    </div>
  );
}

/**
 * Stok hücresi: KENDİ rafımız + (varsa) tedarikçi stoğu.
 *
 * `StockBadge`in yazılı önermesi ("stok 0 ise ürün satılamıyordur") tedarikçi
 * desteğiyle ARTIK YANLIŞ: vitrin satmaya devam ederken yönetici satırda
 * kırmızı "Tükendi" görüyordu. Kırmızı bu panelde "engellenmiş/kritik"
 * demektir ve satın alma kararını yanlış yönlendirir.
 *
 * O yüzden tedarikçi karşılıyorsa rozet NÖTR olur ve ne söylediğini kendisi
 * yazar ("Kendi stoğu 0"). Rozet metni tek başına anlaşılır: kritik bilgiyi
 * yalnız `title` tooltip'ine koymak dokunmatikte görünmez.
 */
function StokHucresi({
  product,
  esik,
}: {
  product: ProductSearchOut;
  esik?: number | null;
}) {
  const tedarikci = product.supplier;
  const tedarikciKarsiliyor =
    !!product.supplier_backed && !!tedarikci && Number(tedarikci.stock_qty) >= 1;
  const kendiBos = (product.stock ?? 0) <= 0;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tedarikciKarsiliyor && kendiBos ? (
        <Badge>Kendi stoğu 0</Badge>
      ) : (
        <StockBadge stock={product.stock} threshold={esik ?? undefined} />
      )}
      {/* Kendi rafımız ile tedarikçi stoğu AYRI iki sayıdır (D-1: Yıldırım
          stoğu `products.stock`a ASLA yazılmaz). */}
      {product.supplier_backed && tedarikci && (
        <Badge>
          Tedarikçide {tedarikciStogu(tedarikci.stock_qty)}
          {tedarikci.unit_name ? ` ${tedarikci.unit_name}` : ""}
        </Badge>
      )}
    </div>
  );
}

/** Tedarikçi stoğu kesirli olabilir (`"12.500"` → `"12,5"`). */
function tedarikciStogu(deger: string): string {
  const sayi = Number(deger);
  if (!Number.isFinite(sayi)) return deger;
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(sayi);
}

/**
 * Maliyet ve marj — **yalnız admin yanıtında dolu** (D-6).
 *
 * Tedarikçisi olmayan üründe "0" DEĞİL, "—" basılır: sıfır maliyet gerçek bir
 * değerdir ("bedava geldi") ve bilinmeyenle karıştırılamaz.
 *
 * `below_cost` tek KIRMIZI kalemdir: satış fiyatı maliyetin altına düşmüşse
 * her satış para kaybettirir ve bunun bir süzgeç arkasında beklemesi kabul
 * edilemez.
 */
function MaliyetHucresi({ product }: { product: ProductSearchOut }) {
  const tedarikci = product.supplier;
  if (!tedarikci || !tedarikci.cost_gross) {
    return <span className="text-slate-400">—</span>;
  }
  const marj = tedarikci.margin_percent;
  const marjSayi = marj == null ? null : Number(marj);
  return (
    <div className="whitespace-nowrap">
      <span className="tabular-nums text-slate-700 ">
        {formatTL(tedarikci.cost_gross)}
      </span>
      {marjSayi != null && Number.isFinite(marjSayi) && (
        <span className="ml-2 text-xs tabular-nums text-slate-500 ">
          %{new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(marjSayi)}
        </span>
      )}
      {tedarikci.below_cost && (
        <Badge tone="danger" className="ml-2">
          Zararına
        </Badge>
      )}
    </div>
  );
}

/** Birincil hücre: görsel + başlık + künye satırı (yazar · yayınevi · ISBN). */
function UrunHucresi({ product }: { product: ProductSearchOut }) {
  const kunye = [product.author, product.publisher, product.isbn].filter(Boolean);
  return (
    <div className="flex items-center gap-3">
      <div className="h-12 w-9 shrink-0 overflow-hidden rounded-md bg-panel-surface-hover">
        {product.cover_url && (
          <img src={product.cover_url} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-panel-fg">{product.title}</p>
        {kunye.length > 0 && (
          <p className="truncate text-xs text-panel-fg-subtle">{kunye.join(" · ")}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Mobil kart (tasarım dili §5.5).
 *
 * Anatomi sabit: kimlik satırı (başlık + durum rozeti) · EN FAZLA üç meta
 * satırı · aksiyonlar. Üçten fazla meta satırı kartı listeye çevirir ve
 * tarama avantajını yok eder — bu yüzden künye tek satırda birleştirilir.
 */
function UrunKarti({
  product,
  esik,
  canManage,
  onChange,
  tedarikciGorebilir,
}: {
  product: ProductSearchOut;
  esik?: number | null;
  canManage: boolean;
  onChange: () => void;
  tedarikciGorebilir: boolean;
}) {
  const kunye = [product.author, product.publisher].filter(Boolean).join(" · ");
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm font-medium text-panel-fg">{product.title}</p>
        <UrunDurumRozeti status={product.status} />
      </div>
      {kunye && <p className="text-xs text-panel-fg-subtle">{kunye}</p>}
      {/* Stok, masaüstü tablosundaki HÜCRENİN TA KENDİSİ ile çizilir: mobilde
          düz `StockBadge` kullanmak, tedarikçinin karşıladığı ürünü kırmızı
          "Tükendi" gösterip satın alma kararını yanlış yönlendirirdi (D-8) ve
          "Tedarikçide N" sayısını yalnız masaüstünde bırakırdı. */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-panel-fg-muted">
        <span className="font-semibold tabular-nums text-panel-fg">{formatTL(product.price)}</span>
        <StokHucresi product={product} esik={esik} />
      </div>
      {/* Üçüncü ve SON meta satırı (§5.5): maliyet/marj — masaüstündeki kolonla
          aynı izin duvarının arkasında. "Zararına" rozeti para kaybettiren
          satırı işaretler; mobilde gizlemek onu görünmez bir borç yapardı. */}
      {tedarikciGorebilir && product.supplier?.cost_gross && (
        <div className="text-xs text-panel-fg-muted">
          <MaliyetHucresi product={product} />
        </div>
      )}
      <UrunAksiyonlari product={product} canManage={canManage} onChange={onChange} yerlesim="kart" />
    </div>
  );
}

const URUN_DURUM_ETIKETI: Record<string, { label: string; tone: "success" | "neutral" | "warning" }> = {
  ACTIVE: { label: "Yayında", tone: "success" },
  HIDDEN: { label: "Gizli", tone: "neutral" },
  DRAFT: { label: "Taslak", tone: "warning" },
};

function UrunDurumRozeti({ status }: { status?: string | null }) {
  if (!status) return null;
  const esleme = URUN_DURUM_ETIKETI[status];
  // Bilinmeyen durum HAM basılır: sessizce gizlemek, yeni bir durum eklendiğinde
  // ekranın boş hücre göstermesine yol açardı.
  return <Badge tone={esleme?.tone ?? "neutral"}>{esleme?.label ?? status}</Badge>;
}

/**
 * Satır aksiyonları — Ç-2 · D deseninin referans uygulaması.
 *
 * Açıktaki iki aksiyonun seçimi bu EKRANIN kararıdır: "Düzenle" ve
 * "Yayınla/Gizle" günlük katalog işinin ikisi; kapak yükleme daha seyrek,
 * "Sil" ise yıkıcı ve zaten açıkta duramaz.
 *
 * Yıkıcı aksiyonun sözleşmesi DEĞİŞMEDİ: "Sil" tek başına DELETE göndermez,
 * önce onay penceresi açılır (P1-5). Değişen: onayı artık ekran değil ortak
 * bileşen zorunlu kılıyor — `yikici: true` yazan bir aksiyon `onay` metni
 * vermeden derlenmez.
 */
function UrunAksiyonlari({
  product,
  canManage,
  onChange,
  yerlesim = "satir",
}: {
  product: ProductSearchOut;
  canManage: boolean;
  onChange: () => void;
  yerlesim?: "satir" | "kart";
}) {
  const dosyaRef = useRef<HTMLInputElement>(null);
  const cover = useMutation({
    mutationFn: (file: File) => uploadProductCover(product.id, file),
    onSuccess: () => {
      toast.success("Kapak güncellendi");
      onChange();
    },
    onError: (err: unknown) => toast.error(getErrorDetail(err, "Kapak yüklenemedi")),
  });
  const toggle = useMutation({
    mutationFn: () =>
      updateProduct(product.id, {
        status: product.status === "ACTIVE" ? "HIDDEN" : "ACTIVE",
      }),
    onSuccess: onChange,
  });
  const remove = useMutation({
    mutationFn: () => deleteProduct(product.id),
    onSuccess: () => {
      toast.success("Ürün silindi");
      onChange();
    },
    // P1-5 sınıfı: sessiz başarısızlık yönetici için "silindi" ile aynı görünür.
    onError: (err: unknown) => toast.error(getErrorDetail(err, "Ürün silinemedi")),
  });
  // Pencere durumu EKRANDA yaşamaz (İP-A4 sözleşmesi).
  const duzenlemeYuzeyi = useDuzenlemeYuzeyi<number, void>();

  if (!canManage) return null;

  const aksiyonlar: SatirAksiyonu[] = [
    { etiket: "Düzenle", acik: true, onSec: () => duzenlemeYuzeyi.ac(product.id) },
    {
      etiket: product.status === "ACTIVE" ? "Gizle" : "Yayınla",
      acik: true,
      bekliyor: toggle.isPending,
      onSec: () => toggle.mutate(),
    },
    {
      etiket: "Kapak görseli yükle",
      ipucu: "PNG veya JPG",
      bekliyor: cover.isPending,
      onSec: () => dosyaRef.current?.click(),
    },
    {
      etiket: "Sil",
      yikici: true,
      bekliyor: remove.isPending,
      onay: {
        baslik: "Ürünü sil",
        aciklama: `"${product.title}" katalogdan kaldırılacak.`,
        onayEtiketi: "Ürünü sil",
      },
      // Pencere YALNIZ başarıda kapanır: istek uçarken açık kalması onay
      // düğmesini `isPending` ile devre dışı tutar (çift tıklama koruması),
      // hata hâlinde de kullanıcı gerekçeyi görüp yeniden deneyebilir.
      onSec: (kapat) => remove.mutate(undefined, { onSuccess: kapat }),
    },
  ];

  return (
    <>
      {/* Dosya seçici GÖRÜNMEZ ve `hidden` ÖZNİTELİĞİ taşır: sınıf adı
          (`className="hidden"`) dinamik olabilir, öznitelik erişilebilirlik
          ağacından GERÇEKTEN çıkarır. Menü öğesi bunu programlı tetikler. */}
      <input
        ref={dosyaRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => e.target.files?.[0] && cover.mutate(e.target.files[0])}
      />

      <SatirAksiyonlari
        aksiyonlar={aksiyonlar}
        yerlesim={yerlesim}
        menuEtiketi={`${product.title} — diğer işlemler`}
      />

      <EditProductModal
        yuzey={duzenlemeYuzeyi}
        onSaved={() => {
          duzenlemeYuzeyi.kapat();
          onChange();
        }}
      />
    </>
  );
}
