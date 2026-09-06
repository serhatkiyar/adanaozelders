/**
 * Mağaza "Tedarikçi" sekmesi — Yıldırım B2B senkronunun yönetim yüzeyi.
 *
 * Sözleşme: `docs/tedarikci-senkron-sozlesme.md`. Bu ekranın taşıdığı üç
 * kural koddan okunmalı, yorumdan değil:
 *
 * 1. **Token kutusu ASLA ön-doldurulmaz** (D-5). Sır ekranda görünmez; panel
 *    yalnız token'ın VAR olduğunu ve vadesini bilir. Boş kutu da gövdeye
 *    konmaz (`api/suppliers.ts`) — yoksa yalnız aralığı değiştiren yönetici
 *    token'ı sessizce siler ve senkron durur.
 * 2. **Son hata GÖRÜNÜR.** Bu paketin en pahalı sessiz hatası, senkronun
 *    günlerce durup kimsenin fark etmemesidir: vitrindeki "stokta" bilgisi
 *    bayatlar ve satılamayan mal satılır. Hata metni birebir, devre kesici
 *    ayrı bir satır olarak gösterilir.
 * 3. **`suppliers.manage` yoksa yazma yüzeyi HİÇ basılmaz** ve bunun sebebi
 *    yazılır. Düğmeyi gösterip 403 aldırmak, kullanıcıya panelin bozuk
 *    olduğunu düşündürür (`lib/queryClient` 403'ü bildirimden muaf tutuyor,
 *    yani hata çoğu zaman GÖRÜNMEZ bile).
 *
 * Yetki `suppliers` alanındadır; `products.manage` bilinçli olarak yeniden
 * kullanılmadı (sözleşme §3: token bir sırdır, görev ayrılığı).
 */
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";

import {
  AccessDenied,
  ReadOnlyNotice,
  useAdminAreaAccess,
} from "@/components/admin/AccessState";
import { Badge, Button, EmptyState, ErrorState, PageSkeleton, ReasonDialog } from "@/components/admin/ui";
import { DataTable } from "@/components/admin/data-table";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/yuzeyDurumu";
import { useYuzeyKirliFormBekcisi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { Form, sunucuHatasiniUygula } from "@/components/admin/ui2/form";
import {
  useSuppliers,
  useSupplierProducts,
  useSyncSupplier,
  useUnlinkSupplierProduct,
  useUpdateSupplier,
} from "@/hooks/useSuppliers";
import { formatDateTime } from "@/lib/datetime";
import { getErrorDetail } from "@/lib/errors";
import { formatTL } from "@/lib/money";
import { toast } from "@/store/toastStore";
import { karantinaEtiketi, type SupplierOut, type SupplierProductOut } from "@/types/supplier";

import { SupplierLinkDialog } from "./SupplierLinkDialog";

/* ═════════════════════════ saf yardımcılar ═════════════════════════ */

const DAKIKA = 60_000;
const GUN = 86_400_000;

/** Gelecekteki bir damgaya kalan DAKİKA; geçmişse/boşsa `null`. */
function kalanDakika(iso?: string | null): number | null {
  if (!iso) return null;
  const fark = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(fark) || fark <= 0) return null;
  return Math.ceil(fark / DAKIKA);
}

/**
 * Vadeye kalan HAM SÜRE (ms). Negatifse token ölmüştür.
 *
 * Gün sayısı DEĞİL ham fark döner ve bu bilinçlidir: "doldu mu" kararı
 * yuvarlanmış bir sayının İŞARETİNE bakarak verilemez. `Math.round(-0.5)`
 * **`-0`**dır ve `-0 < 0` JavaScript'te **false** — bir saat önce ölmüş bir
 * token "0 gün sonra dolar" diyordu, yani panelin varlık sebebi olan uyarı
 * tam da uyarması gereken anda tersine dönüyordu.
 */
function kalanSure(iso?: string | null): number | null {
  if (!iso) return null;
  const fark = new Date(iso).getTime() - Date.now();
  return Number.isFinite(fark) ? fark : null;
}

/**
 * "Ne zaman" sorusunun insan cevabı.
 *
 * Yakın geçmiş GÖRELİ ("4 dk önce") çünkü asıl soru "senkron TAZE mi";
 * bir günden eskisi MUTLAK çünkü orada soru "tam olarak ne zaman durdu"ya
 * dönüşür ve "37 saat önce" o soruyu cevaplamaz.
 */
function goreliZaman(iso?: string | null): string {
  if (!iso) return "Henüz yapılmadı";
  const damga = new Date(iso).getTime();
  if (!Number.isFinite(damga)) return "—";
  const fark = Date.now() - damga;
  if (fark < 0) return formatDateTime(iso);
  if (fark < DAKIKA) return "az önce";
  if (fark < 60 * DAKIKA) return `${Math.floor(fark / DAKIKA)} dk önce`;
  if (fark < 24 * 60 * DAKIKA) return `${Math.floor(fark / (60 * DAKIKA))} saat önce`;
  return formatDateTime(iso);
}

/** Fare üstünde gösterilen TAM zaman; ham ISO dizgisi kullanıcıya yazılmaz. */
function tamZaman(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const damga = new Date(iso).getTime();
  return Number.isFinite(damga) ? formatDateTime(iso) : undefined;
}

/** Kesirli stok: `"12.500"` → `"12,5"`. Sayı değilse ham dizgi korunur. */
function stokBicimle(deger?: string | null): string {
  if (deger == null || deger === "") return "—";
  const sayi = Number(deger);
  if (!Number.isFinite(sayi)) return deger;
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(sayi);
}

/* ═════════════════════════ panel ═════════════════════════ */

type Gorunum = "eslesmemis" | "bagli";

export function SupplierPanel() {
  const { canView, canManage } = useAdminAreaAccess("suppliers");
  const { data, isLoading, isError, error, refetch } = useSuppliers();
  const [params, setParams] = useSearchParams();

  if (!canView) return <AccessDenied area="Tedarikçi" />;
  if (isError) {
    return (
      <ErrorState
        description={getErrorDetail(error, "Tedarikçi bilgisi yüklenemedi.")}
        onRetry={() => void refetch()}
      />
    );
  }
  if (isLoading) return <PageSkeleton rows={4} />;

  const tedarikciler = data ?? [];
  if (tedarikciler.length === 0) {
    return (
      <EmptyState
        title="Tanımlı tedarikçi yok"
        description="Yıldırım B2B bağlantısı sunucuda kurulduğunda burada görünür."
      />
    );
  }

  // Sağlayıcı başına tek aktif satır var (`uq_suppliers_provider_active`);
  // yine de seçim URL'de yaşar ki ileride ikinci sağlayıcı eklendiğinde
  // deep-link çalışsın.
  // Parametre adı `saglayici`: `tedarikci` ürün listesinde BAŞKA bir anlam
  // taşıyor (`linked|backed|below_cost` süzgeci, `lib/storeProductQuery`) ve
  // aynı sekme ailesinde aynı adın iki anlamı sessiz karışıklık üretir.
  const seciliId = Number(params.get("saglayici"));
  const tedarikci =
    tedarikciler.find((t) => t.id === seciliId) ?? tedarikciler[0];

  const gorunum: Gorunum = params.get("gorunum") === "bagli" ? "bagli" : "eslesmemis";

  function gorunumeGec(hedef: Gorunum) {
    setParams((onceki) => {
      const sonraki = new URLSearchParams(onceki);
      sonraki.set("gorunum", hedef);
      // Görünüm değişince eski sayfa numarası ve arama anlamsızdır: 3. sayfada
      // "defter" arayıp bağlı listeye geçmek, boş bir sonuç ekranını "kayıt
      // yok" sanısına çevirir.
      sonraki.delete("sayfa");
      sonraki.delete("ara");
      return sonraki;
    });
  }

  return (
    <div className="space-y-8">
      {tedarikciler.length > 1 && (
        <label className="block text-xs font-medium text-slate-500 ">
          Tedarikçi
          <select
            value={tedarikci.id}
            onChange={(e) =>
              setParams((onceki) => {
                const sonraki = new URLSearchParams(onceki);
                sonraki.set("saglayici", e.target.value);
                sonraki.delete("sayfa");
                return sonraki;
              })
            }
            className="input mt-1 max-w-64"
          >
            {tedarikciler.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <DurumSeridi tedarikci={tedarikci} canManage={canManage} />

      {canManage ? (
        <AyarlarFormu tedarikci={tedarikci} />
      ) : (
        <div data-testid="salt-okunur">
          <ReadOnlyNotice />
        </div>
      )}

      <section aria-label="Tedarikçi ürünleri">
        <div
          role="group"
          aria-label="Ürün görünümü"
          className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3 "
        >
          {(
            [
              ["eslesmemis", `Eşleşmemiş favoriler (${tedarikci.unmatched_count})`],
              ["bagli", `Bağlı ürünler (${tedarikci.linked_count})`],
            ] as [Gorunum, string][]
          ).map(([deger, etiket]) => (
            // Ham `<button>` DEĞİL, ortak `Button`: seçim durumu `aria-pressed`
            // ile duyurulur (renk tek başına ekran okuyucuya bir şey söylemez).
            // Görünüm URL'de yaşar (`?gorunum=`), yani sekme deep-link'lenebilir.
            //
            // Marka rengi (`primary`) KULLANILMAZ: bu bir aksiyon değil bir
            // SEÇİM DURUMU. Dolgulu indigo, saç-teli çizginin üstünde başıboş
            // bir CTA gibi durur ve aynı ekranın üst sekme şeridiyle
            // (`AdminStore`) üçüncü bir sekme dili üretirdi. Nötr çip o
            // şeritle birebir aynı.
            <Button
              key={deger}
              size="sm"
              variant="ghost"
              aria-pressed={gorunum === deger}
              onClick={() => gorunumeGec(deger)}
              className={
                gorunum === deger
                  ? "bg-slate-900 text-white hover:bg-slate-800 "
                  : ""
              }
            >
              {etiket}
            </Button>
          ))}
        </div>

        <TedarikciUrunleri
          tedarikci={tedarikci}
          gorunum={gorunum}
          canManage={canManage}
        />
      </section>
    </div>
  );
}

/* ═════════════════════════ 1. durum şeridi ═════════════════════════ */

function DurumSeridi({
  tedarikci,
  canManage,
}: {
  tedarikci: SupplierOut;
  canManage: boolean;
}) {
  const senkron = useSyncSupplier(tedarikci.id);
  const bekleyenDakika = kalanDakika(tedarikci.cooldown_until);
  const bekleyenBaslik = `Devre kesici açık — ${bekleyenDakika} dk beklemede`;

  function calistir(scope: "stock" | "price") {
    senkron.mutate(scope, {
      onSuccess: (rapor) =>
        toast.success(
          scope === "stock"
            ? `Stok senkronu bitti — ${rapor.updated} satır güncellendi`
            : `Fiyat senkronu bitti — ${rapor.priced} satır fiyatlandı`,
        ),
      onError: (hata: unknown) =>
        toast.error(getErrorDetail(hata, "Senkron başlatılamadı")),
    });
  }

  return (
    <section data-testid="tedarikci-durum">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold text-slate-900 ">
            {tedarikci.name}
          </h2>
          <Badge tone={tedarikci.is_enabled ? "success" : "neutral"}>
            {tedarikci.is_enabled ? "Açık" : "Kapalı"}
          </Badge>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {/* Devre kesici açıkken düğme KAPALI: sunucu zaten reddedecek
                (cooldown) ve kullanıcıyı bilinen bir hataya tıklatmak, "panel
                bozuk" izlenimi bırakır. Sebep GÖRÜNÜR — hem `title`da hem
                aşağıdaki amber şeritte yazıyor (kilitli kararın istediği:
                düğme kapalıysa sebebi ekranda okunur). */}
            <Button
              size="sm"
              variant="secondary"
              disabled={bekleyenDakika !== null}
              title={bekleyenDakika !== null ? bekleyenBaslik : undefined}
              isPending={senkron.isPending && senkron.variables === "stock"}
              onClick={() => calistir("stock")}
            >
              Stoğu senkronla
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={bekleyenDakika !== null}
              title={bekleyenDakika !== null ? bekleyenBaslik : undefined}
              isPending={senkron.isPending && senkron.variables === "price"}
              onClick={() => calistir("price")}
            >
              Fiyatı senkronla
            </Button>
          </div>
        )}
      </div>

      <p className="mt-1 text-xs text-slate-500 ">
        {tedarikci.base_url}
      </p>

      {/* Kutu değil, satır ritmi: saç-teli çizgi + boşluk (kart enflasyonu yok). */}
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-slate-200 py-4 text-sm sm:grid-cols-4 ">
        <div data-testid="son-stok-senkronu">
          <dt className="text-xs text-slate-500 ">Son stok senkronu</dt>
          <dd
            title={tamZaman(tedarikci.last_stock_sync_ok_at)}
            className="mt-0.5 font-medium text-slate-800 "
          >
            {goreliZaman(tedarikci.last_stock_sync_ok_at)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 ">Son fiyat senkronu</dt>
          <dd
            title={tamZaman(tedarikci.last_price_sync_ok_at)}
            className="mt-0.5 font-medium text-slate-800 "
          >
            {goreliZaman(tedarikci.last_price_sync_ok_at)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 ">Bağlı ürün</dt>
          <dd className="mt-0.5 font-medium text-slate-800 ">
            {tedarikci.linked_count}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 ">Eşleşmemiş</dt>
          <dd className="mt-0.5 font-medium text-slate-800 ">
            {tedarikci.unmatched_count}
          </dd>
        </div>
      </dl>

      <div className="mt-4 space-y-2">
        <TokenDurumu tedarikci={tedarikci} />

        {/* Hata metni BİREBİR: özetlemek ("bir sorun oluştu") yöneticinin
            Cloudflare challenge'ı ile 502'yi ayırt etmesini engellerdi. */}
        {tedarikci.last_error && (
          <p
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 "
          >
            <span className="font-semibold">Son hata:</span> {tedarikci.last_error}
            {tedarikci.last_error_at && (
              <span className="text-rose-700 ">
                {" "}
                · {goreliZaman(tedarikci.last_error_at)}
              </span>
            )}
          </p>
        )}

        {bekleyenDakika !== null && (
          <p
            data-testid="devre-kesici"
            className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 "
          >
            <span className="font-semibold">Devre kesici açık</span> — {bekleyenDakika} dk
            beklemede ({tedarikci.consecutive_failures} ardışık hata). Bu süre
            dolmadan yeni istek gönderilmez.
          </p>
        )}
      </div>
    </section>
  );
}

/** Token satırı: değeri DEĞİL, varlığı ve vadesi. */
function TokenDurumu({ tedarikci }: { tedarikci: SupplierOut }) {
  const kalan = kalanSure(tedarikci.token_expires_at);
  // Gün sayısı yalnız GÖSTERİM içindir; "doldu mu" ve "bugün mü" kararları
  // ham farktan verilir (yukarıdaki nota bak).
  const gun = kalan === null ? null : Math.round(kalan / GUN);

  let metin: string;
  let uyari = false;
  if (!tedarikci.has_token) {
    metin = "API token girilmemiş — senkron çalışamaz.";
    uyari = true;
  } else if (kalan === null || gun === null) {
    metin = "API token girili; vade bilgisi yok.";
  } else if (kalan <= 0) {
    metin = "API token süresi doldu — yenisini yapıştırın.";
    uyari = true;
  } else if (kalan < GUN) {
    // 20 saat kalan token "1 gün sonra dolar" DEMEZ: iyimser yuvarlama
    // "yarın hallederim" dedirtir ve senkron gece ölür.
    metin = "API token BUGÜN doluyor — yenisini yapıştırın.";
    uyari = true;
  } else if (gun < 7) {
    // 7 gün eşiği sözleşmeden gelir (§5: vade < 7 gün → yenileme döngüsü).
    metin = `API token ${gun} gün sonra dolar.`;
    uyari = true;
  } else {
    metin = `API token ${gun} gün sonra dolar.`;
  }

  return (
    <p
      data-testid="token-durumu"
      className={
        uyari
          ? "rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 "
          : "px-1 text-xs text-slate-500 "
      }
    >
      {metin}
    </p>
  );
}

/* ═════════════════════════ 2. ayarlar formu ═════════════════════════ */

/** Sunucudaki alt sınırlar (`models/supplier.py`). */
const ENAZ_STOK_SANIYE = 30;
const ENAZ_FIYAT_SAAT = 1;
const TOKEN_ENUZUN = 4000;
const GEREKCE_ENUZUN = 500;

const ayarSemasi = z.object({
  aktif: z.boolean(),
  stokSaniye: z
    .string()
    .refine((v) => /^\d+$/.test(v.trim()), "Saniye cinsinden bir tam sayı yazın.")
    .refine(
      (v) => Number(v) >= ENAZ_STOK_SANIYE,
      `Stok aralığı en az ${ENAZ_STOK_SANIYE} saniye olabilir.`,
    )
    .refine((v) => Number(v) <= 86_400, "Stok aralığı en fazla 24 saat olabilir."),
  fiyatSaat: z
    .string()
    .refine((v) => v.trim() !== "" && Number.isFinite(Number(v)), "Saat cinsinden bir sayı yazın.")
    .refine(
      (v) => Number(v) >= ENAZ_FIYAT_SAAT,
      `Fiyat aralığı en az ${ENAZ_FIYAT_SAAT} saat olabilir.`,
    )
    .refine((v) => Number(v) <= 168, "Fiyat aralığı en fazla 7 gün olabilir."),
  token: z
    .string()
    .refine((v) => v.length <= TOKEN_ENUZUN, "Token çok uzun."),
  gerekce: z
    .string()
    .refine((v) => v.trim().length >= 3, "Gerekçe en az 3 karakter olmalı.")
    .refine(
      (v) => v.length <= GEREKCE_ENUZUN,
      `En fazla ${GEREKCE_ENUZUN} karakter yazılabilir.`,
    ),
});

type AyarDegerleri = z.infer<typeof ayarSemasi>;

const AYAR_ALANLARI = ["aktif", "stokSaniye", "fiyatSaat", "token", "gerekce"] as const;
const SUNUCU_ALAN_ESLEMESI: Record<string, string> = {
  is_enabled: "aktif",
  stock_interval_seconds: "stokSaniye",
  price_interval_seconds: "fiyatSaat",
  api_token: "token",
  reason: "gerekce",
};

function baslangicDegerleri(t: SupplierOut): AyarDegerleri {
  return {
    aktif: t.is_enabled,
    stokSaniye: String(t.stock_interval_seconds),
    // Fiyat döngüsü SAATLİK ölçekte yaşar (varsayılan 6 saat). Kutuya 21600
    // yazdırmak, yöneticiyi her seferinde bölme yapmaya zorlar ve bir sıfır
    // fazlası fark edilmeden geçer.
    fiyatSaat: String(t.price_interval_seconds / 3600),
    // ── D-5: token ÖN-DOLDURULMAZ ──
    // Kutu her açılışta boştur; boş kutu gövdeye de konmaz
    // (`api/suppliers.ts::ayarGovdesi`), yani mevcut token korunur.
    token: "",
    // Gerekçe her kayıtta YENİDEN yazılır: bir öncekini taşımak, denetim
    // kaydını "kopyala-yapıştır aynı cümle" hâline getirirdi.
    gerekce: "",
  };
}

function AyarlarFormu({ tedarikci }: { tedarikci: SupplierOut }) {
  const guncelle = useUpdateSupplier(tedarikci.id);

  const form = useForm<AyarDegerleri>({
    resolver: zodResolver(ayarSemasi),
    defaultValues: baslangicDegerleri(tedarikci),
    mode: "onChange",
    shouldFocusError: false,
  });

  // Sunucudaki değer değişince (senkron sonrası tazeleme, başka bir sekmeden
  // kaydetme) form KİRLİ DEĞİLSE yeni değerlere hizalanır. Kirliyken ezmek,
  // kullanıcının yazdığını sessizce silmek olurdu.
  const kirli = form.formState.isDirty;
  useEffect(() => {
    if (kirli) return;
    form.reset(baslangicDegerleri(tedarikci));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tedarikci.is_enabled, tedarikci.stock_interval_seconds, tedarikci.price_interval_seconds]);

  useYuzeyKirliFormBekcisi({
    form,
    sunucuHatasi: guncelle.error,
    pencereSiz: true,
  });

  const gonder = form.handleSubmit(
    (deger) => {
      // ── Kısmi PATCH: yalnız DOKUNULAN alanlar ──
      //
      // `dirtyFields` "kullanıcı bu alanı değiştirdi mi" sorusunun tek
      // cevabıdır. Hepsini göndermek, sunucudaki `exclude_unset`i anlamsız
      // kılar ve iki sekmede aynı anda çalışan iki yöneticinin birbirinin
      // ayarını ezmesine yol açar.
      const dokunulan = form.formState.dirtyFields;
      const govde: Parameters<typeof guncelle.mutate>[0] = {
        reason: deger.gerekce.trim(),
      };
      if (dokunulan.aktif) govde.is_enabled = deger.aktif;
      if (dokunulan.stokSaniye) govde.stock_interval_seconds = Number(deger.stokSaniye);
      if (dokunulan.fiyatSaat) {
        govde.price_interval_seconds = Math.round(Number(deger.fiyatSaat) * 3600);
      }
      // Token kutusu boşsa alan HİÇ gönderilmez (D-5) — kırpma ve eleme
      // `api/suppliers.ts`te tek yerde yapılır.
      if (deger.token.trim()) govde.api_token = deger.token;

      guncelle.mutate(govde, {
        onSuccess: (yeni) => {
          toast.success("Tedarikçi ayarları güncellendi");
          // Token ve gerekçe SIFIRLANIR: ikisi de tek seferliktir.
          form.reset(baslangicDegerleri(yeni));
        },
        onError: (hata: unknown) => {
          const kalan = sunucuHatasiniUygula(
            hata,
            form,
            [...AYAR_ALANLARI],
            SUNUCU_ALAN_ESLEMESI,
            (h) => getErrorDetail(h, "Ayarlar kaydedilemedi"),
          );
          form.setError("root.sunucu", { type: "server", message: kalan ?? undefined });
        },
      });
    },
    (hatalar) => {
      const ilk = AYAR_ALANLARI.find((a) => hatalar[a]);
      if (ilk) form.setFocus(ilk);
    },
  );

  const genelHata = form.formState.errors.root?.sunucu?.message;

  return (
    <section>
      <h3 className="text-sm font-semibold text-slate-900 ">Ayarlar</h3>
      <p className="mt-1 text-xs text-slate-500 ">
        Sıklıklar veritabanında yaşar; değişiklik yeniden başlatma istemez ve
        gerekçesiyle birlikte denetim kaydına yazılır.
      </p>

      {genelHata && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 "
        >
          {genelHata}
        </p>
      )}

      <div className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <Form.Field
          control={form.control}
          name="aktif"
          render={({ field }) => (
            <Form.Item className="block sm:col-span-2">
              <div className="flex items-center gap-2">
                <Form.Control>
                  <input
                    type="checkbox"
                    checked={field.value}
                    onBlur={field.onBlur}
                    onChange={(e) => field.onChange(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-panel-accent-text focus:ring-panel-focus accent-marka"
                  />
                </Form.Control>
                <Form.Label className="text-sm font-semibold text-slate-700 ">
                  Senkron açık
                </Form.Label>
              </div>
              <Form.Hint>
                Kapatıldığında döngü durur; tedarikçi stoğu vitrinde sayılmaz.
              </Form.Hint>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={form.control}
          name="stokSaniye"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Stok senkron aralığı (saniye)</Form.Label>
              <Form.Control>
                <input className="input" type="number" min={ENAZ_STOK_SANIYE} {...field} />
              </Form.Control>
              <Form.Hint>En az {ENAZ_STOK_SANIYE} saniye. Varsayılan 60.</Form.Hint>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={form.control}
          name="fiyatSaat"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Fiyat senkron aralığı (saat)</Form.Label>
              <Form.Control>
                <input className="input" type="number" min={ENAZ_FIYAT_SAAT} step="0.5" {...field} />
              </Form.Control>
              <Form.Hint>En az {ENAZ_FIYAT_SAAT} saat. Varsayılan 6.</Form.Hint>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={form.control}
          name="token"
          render={({ field }) => (
            <Form.Item className="block sm:col-span-2">
              <Form.Label optional>API token</Form.Label>
              <Form.Control>
                <textarea
                  rows={3}
                  maxLength={TOKEN_ENUZUN}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="Yalnız değiştirecekseniz yapıştırın"
                  className="input min-h-20 resize-y font-mono text-xs"
                  {...field}
                />
              </Form.Control>
              <Form.Hint>
                Mevcut token güvenlik gereği burada gösterilmez. Boş bırakırsanız
                değişmez; yeni bir token yapıştırdığınızda eskisinin yerini alır.
              </Form.Hint>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={form.control}
          name="gerekce"
          render={({ field }) => (
            <Form.Item className="block sm:col-span-2">
              <Form.Label>Gerekçe</Form.Label>
              <Form.Control>
                <input
                  className="input"
                  maxLength={GEREKCE_ENUZUN}
                  placeholder="Ör. origin 502 veriyordu, aralık gevşetildi"
                  {...field}
                />
              </Form.Control>
              <Form.Hint>Denetim kaydına yazılır; en az 3 karakter.</Form.Hint>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
      </div>

      <div className="mt-2 flex justify-end">
        {/* Düğme geçerlilikle KAPANMAZ: geçersizse istek gitmez, hata alanda
            çıkar ve odak ilk hatalı alana taşınır. */}
        <Button isPending={guncelle.isPending} onClick={gonder}>
          Kaydet
        </Button>
      </div>
    </section>
  );
}

/* ═════════════════════════ 3–4. tedarikçi ürünleri ═════════════════════════ */

/** `DataTable` altbilgisindeki seçicinin sunduğu boyutlar. */
const SAYFA_BOYUTLARI = [10, 25, 50];
const VARSAYILAN_BOYUT = 25;

function TedarikciUrunleri({
  tedarikci,
  gorunum,
  canManage,
}: {
  tedarikci: SupplierOut;
  gorunum: Gorunum;
  canManage: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const sayfa = Math.max(1, Number(params.get("sayfa")) || 1);
  // Sayfa boyutu da URL'de yaşar. Sabit tutup `onPageSizeChange`i boş
  // bırakmak, `DataTable`ın HER ZAMAN bastığı seçiciyi ÖLÜ bir kontrole
  // çevirirdi: kullanıcı 50'yi seçiyor, kutu 25'e geri sıçrıyor ve neden
  // olduğunu göremiyordu.
  const hamBoyut = Number(params.get("limit"));
  const sayfaBoyutu = SAYFA_BOYUTLARI.includes(hamBoyut) ? hamBoyut : VARSAYILAN_BOYUT;
  const aramaUrl = (params.get("ara") ?? "").slice(0, 200);

  // Arama kutusu yerel state tutar ve gecikmeli olarak URL'e yazar: her tuş
  // vuruşunda URL'i (ve isteği) tazelemek geri tuşunu kullanılamaz kılar.
  const [taslak, setTaslak] = useState(aramaUrl);
  useEffect(() => setTaslak(aramaUrl), [aramaUrl]);
  useEffect(() => {
    if (taslak === aramaUrl) return;
    const zamanlayici = setTimeout(() => {
      setParams(
        (onceki) => {
          const sonraki = new URLSearchParams(onceki);
          if (taslak) sonraki.set("ara", taslak);
          else sonraki.delete("ara");
          sonraki.delete("sayfa");
          return sonraki;
        },
        { replace: true },
      );
    }, 300);
    return () => clearTimeout(zamanlayici);
  }, [taslak, aramaUrl, setParams]);

  const sorgu = useSupplierProducts(tedarikci.id, {
    linked: gorunum === "bagli",
    ...(aramaUrl ? { q: aramaUrl } : {}),
    limit: sayfaBoyutu,
    offset: (sayfa - 1) * sayfaBoyutu,
  });

  const baglamaYuzeyi = useDuzenlemeYuzeyi<SupplierProductOut, void>();
  const cozmeYuzeyi = useDuzenlemeYuzeyi<SupplierProductOut, void>();
  const coz = useUnlinkSupplierProduct(tedarikci.id);

  function sayfaDegis(hedef: number) {
    setParams((onceki) => {
      const sonraki = new URLSearchParams(onceki);
      sonraki.set("sayfa", String(hedef));
      return sonraki;
    });
  }

  const satirlar = sorgu.data?.items ?? [];
  const toplam = sorgu.data?.total ?? -1;

  const kolonlar: ColumnDef<SupplierProductOut, unknown>[] =
    gorunum === "eslesmemis"
      ? eslesmemisKolonlari(canManage, (satir) => baglamaYuzeyi.ac(satir))
      : bagliKolonlari(canManage, (satir) => cozmeYuzeyi.ac(satir));

  return (
    <div className="mt-4">
      <label className="block max-w-sm text-xs font-medium text-slate-500 ">
        Tedarikçi kataloğunda ara
        <input
          type="search"
          value={taslak}
          onChange={(e) => setTaslak(e.target.value)}
          placeholder="Ad, kod veya barkod"
          className="input mt-1 w-full"
        />
      </label>

      {/* Hata şeridi arama kutusunun ALTINDA: erken dönüşle ekranı komple
          değiştirmek, kötü bir sorgu yazan kullanıcıya yalnız "Yeniden dene"
          bırakıyordu — sorguyu düzeltmesi imkânsızdı. */}
      <div className="mt-4">
        {sorgu.isError ? (
          <ErrorState
            description={getErrorDetail(sorgu.error, "Tedarikçi ürünleri yüklenemedi.")}
            onRetry={() => void sorgu.refetch()}
          />
        ) : (
        <DataTable
          columns={kolonlar}
          data={satirlar}
          getRowId={(s) => String(s.id)}
          isLoading={sorgu.isLoading}
          page={sayfa}
          pageSize={sayfaBoyutu}
          total={toplam < 0 ? satirlar.length : toplam}
          onPageChange={sayfaDegis}
          onPageSizeChange={(boyut) =>
            setParams((onceki) => {
              const sonraki = new URLSearchParams(onceki);
              sonraki.set("limit", String(boyut));
              sonraki.delete("sayfa");
              return sonraki;
            })
          }
          emptyTitle={
            aramaUrl
              ? "Sonuç bulunamadı"
              : gorunum === "eslesmemis"
                ? "Eşleşmemiş favori yok"
                : "Bağlı ürün yok"
          }
          emptyDescription={
            aramaUrl
              ? "Arama metnini değiştirmeyi deneyin."
              : gorunum === "eslesmemis"
                ? "Tedarikçideki bütün favori satırlar bir ürüne bağlı."
                : "Barkodu geçerli favoriler senkronda kendiliğinden bağlanır."
          }
        />
        )}
      </div>

      {canManage && (
        <>
          <SupplierLinkDialog yuzey={baglamaYuzeyi} supplierId={tedarikci.id} />
          <ReasonDialog
            open={cozmeYuzeyi.acik}
            title="Bağı çöz"
            description={
              cozmeYuzeyi.kayit
                ? `${cozmeYuzeyi.kayit.product?.title ?? cozmeYuzeyi.kayit.name} ile tedarikçi satırı arasındaki bağ kaldırılacak. Ürünün kendi stoğu etkilenmez.`
                : ""
            }
            label="Çözme gerekçesi"
            placeholder="Ör. yanlış barkod eşleşmesi"
            required
            minLength={3}
            maxLength={GEREKCE_ENUZUN}
            confirmLabel="Bağı çöz"
            danger
            isPending={coz.isPending}
            onClose={cozmeYuzeyi.kapat}
            onConfirm={(gerekce) => {
              const satir = cozmeYuzeyi.kayit;
              if (!satir) return;
              coz.mutate(
                { spId: satir.id, reason: gerekce },
                {
                  onSuccess: () => {
                    toast.success("Bağ çözüldü");
                    cozmeYuzeyi.kapat();
                  },
                  onError: (hata: unknown) =>
                    toast.error(getErrorDetail(hata, "Bağ çözülemedi")),
                },
              );
            }}
          />
        </>
      )}
    </div>
  );
}

/*
 * ── AÇIK BORÇ: mobil kart düzeni YOK ──
 *
 * Masaüstü tablosu sekiz kolon ve `DataTable` `min-w-[720px]` ile yatay
 * kaydırmaya düşüyor; `OrdersPanel` aynı sorunu `renderMobileRow` ile
 * çözmüştü. Burada ÇÖZÜLEMEDİ ve sebebi yazılı olsun: `DataTable` mobil
 * kartı ile masaüstü satırını AYNI ANDA basar (biri `md:hidden`, diğeri
 * `hidden md:block`), yani ürün adı DOM'da iki kez bulunur. Bu paketin
 * sözleşme testi (`SupplierPanel.test.tsx`) satırı düz `getByText` ile
 * arıyor ve çift düğüm testi kırıyor.
 *
 * Doğru çözüm ortak katmandadır (mobil kartı yalnız dar ekranda MOUNT etmek
 * ya da testin `within(tablo)` kullanması) ve bu paketin kapsamı dışında;
 * aynı borç `ProductsPanel`de zaten var. Şimdilik tablo yatay kaydırılıyor.
 */

/** Karantina bayrakları — bilinmeyen kod HAM basılır (sessizce gizlenmez). */
function Bayraklar({ kodlar }: { kodlar?: string[] | null }) {
  if (!kodlar || kodlar.length === 0) {
    return <span className="text-slate-400 ">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {kodlar.map((kod) => (
        <Badge key={kod} tone="warning">
          {karantinaEtiketi(kod)}
        </Badge>
      ))}
    </div>
  );
}

function eslesmemisKolonlari(
  canManage: boolean,
  onBagla: (satir: SupplierProductOut) => void,
): ColumnDef<SupplierProductOut, unknown>[] {
  const kolonlar: ColumnDef<SupplierProductOut, unknown>[] = [
    {
      id: "kod",
      header: "Kod",
      cell: ({ row }) => (
        <span className="whitespace-nowrap font-mono text-xs text-slate-500 ">
          {row.original.external_code}
        </span>
      ),
    },
    {
      id: "ad",
      header: "Ad",
      cell: ({ row }) => (
        <span className="font-medium text-slate-800 ">
          {row.original.name}
        </span>
      ),
    },
    {
      id: "marka",
      header: "Marka",
      cell: ({ row }) => row.original.brand || <span className="text-slate-400 ">—</span>,
    },
    {
      id: "barkod",
      header: "Barkod",
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          <span className="font-mono text-xs">{row.original.barcode || "—"}</span>
          {row.original.barcode && !row.original.barcode_valid && (
            <Badge tone="warning" className="ml-2">
              Geçersiz
            </Badge>
          )}
        </span>
      ),
    },
    {
      id: "birim",
      header: "Birim",
      cell: ({ row }) => row.original.unit_name || <span className="text-slate-400 ">—</span>,
    },
    {
      id: "stok",
      header: "Stok",
      cell: ({ row }) => (
        <span className="whitespace-nowrap tabular-nums">
          {stokBicimle(row.original.stock_qty)}
        </span>
      ),
    },
    {
      id: "maliyet",
      header: "Maliyet (KDV dahil)",
      cell: ({ row }) =>
        row.original.cost_gross ? (
          <span className="whitespace-nowrap tabular-nums">
            {formatTL(row.original.cost_gross)}
          </span>
        ) : (
          <span className="text-slate-400 ">—</span>
        ),
    },
    {
      id: "bayraklar",
      header: "Uyarılar",
      cell: ({ row }) => <Bayraklar kodlar={row.original.quarantine_flags} />,
    },
  ];

  if (canManage) {
    kolonlar.push({
      id: "aksiyon",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end">
          {/* Satır aksiyonu AÇIK DÜĞME (kalıcı kural: üç nokta menü yok). */}
          <Button size="sm" variant="ghost" onClick={() => onBagla(row.original)}>
            Bağla
          </Button>
        </div>
      ),
    });
  }
  return kolonlar;
}

function bagliKolonlari(
  canManage: boolean,
  onCoz: (satir: SupplierProductOut) => void,
): ColumnDef<SupplierProductOut, unknown>[] {
  const kolonlar: ColumnDef<SupplierProductOut, unknown>[] = [
    {
      id: "urun",
      header: "Ürün",
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800 ">
            {row.original.product?.title ?? row.original.name}
          </p>
          <p className="truncate text-xs text-slate-500 ">
            {[row.original.product?.sku, row.original.external_code]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      ),
    },
    {
      id: "kaynak",
      header: "Kaynak",
      cell: ({ row }) =>
        row.original.link_source ? (
          // Nötr rozet: "AUTO" bir uyarı değil, bir köken bilgisi.
          <Badge>{row.original.link_source === "AUTO" ? "Otomatik" : "Elle"}</Badge>
        ) : (
          <span className="text-slate-400 ">—</span>
        ),
    },
    {
      id: "tedarikciStogu",
      header: "Tedarikçi stoğu",
      cell: ({ row }) => (
        <span className="whitespace-nowrap tabular-nums">
          {stokBicimle(row.original.stock_qty)}
          {row.original.unit_name && (
            <span className="ml-1 text-xs text-slate-500 ">
              {row.original.unit_name}
            </span>
          )}
        </span>
      ),
    },
    {
      id: "maliyet",
      header: "Maliyet (KDV dahil)",
      cell: ({ row }) =>
        row.original.cost_gross ? (
          <span className="whitespace-nowrap tabular-nums">
            {formatTL(row.original.cost_gross)}
          </span>
        ) : (
          <span className="text-slate-400 ">—</span>
        ),
    },
    {
      id: "bayraklar",
      header: "Uyarılar",
      cell: ({ row }) => <Bayraklar kodlar={row.original.quarantine_flags} />,
    },
  ];

  if (canManage) {
    kolonlar.push({
      id: "aksiyon",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => onCoz(row.original)}>
            Çöz
          </Button>
        </div>
      ),
    });
  }
  return kolonlar;
}
