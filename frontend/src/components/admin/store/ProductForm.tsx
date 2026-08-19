/**
 * Mağaza ürün formu ve varyant bölümü — İP-A5'te `AdminStore.tsx`ten AYNEN taşındı.
 *
 * Taşıma MEKANİKTİR: tek bir JSX düğümü, sınıf adı ya da etiket değişmedi.
 * Medusa `Form.*` göçü İP-A6'nın işidir; bu dosya ona zemin hazırlar.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/admin/ui";
import { createProduct, updateProduct } from "@/api/store";
import {
  useCategories,
  useCreateVariantGroup,
  useDeriveVariant,
  useVariantConfig,
  useVariantGroup,
  useVariantGroups,
} from "@/hooks/useStore";
import { usePaymentAvailability } from "@/hooks/useFeatureFlags";
import { digitalProductsOpen } from "@/lib/paymentAvailability";
import { getErrorDetail } from "@/lib/errors";
import { formatTL } from "@/lib/money";
import {
  ADMIN_REASON_OPTIONS,
  requiresNote,
  validateStockEdit,
  type AdminReasonCode,
} from "@/lib/stockMovements";
import { orandanYuzde, yuzdedenOran } from "@/lib/tax";
import { isBookCategory, suggestedVariantTitle } from "@/lib/variants";
import { toast } from "@/store/toastStore";
import type { ProductDetailOut, ProductKind } from "@/types";

/** Form alanı üstündeki küçük başlık (select'lerde placeholder yoktur). */
const ALAN_BASLIGI = "text-[11px] font-medium text-slate-500 dark:text-slate-400";

// Ortak ürün formu — hem oluşturma hem düzenleme (künye dahil tüm alanlar).
export function ProductForm({
  mode,
  initial,
  onDone,
}: {
  mode: "create" | "edit";
  initial?: ProductDetailOut;
  onDone: () => void;
}) {
  const isEdit = mode === "edit";
  const { data: categories } = useCategories();
  // Dijital ürün kapısı (İSTEMCİ AYNASI — otorite sunucudadır). Bilgi
  // yüklenmediyse/uç patladıysa FAIL-CLOSED: bkz. lib/paymentAvailability.
  const { data: odemeUygunlugu } = usePaymentAvailability();
  const dijitalAcik = digitalProductsOpen(odemeUygunlugu);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [kind, setKind] = useState<ProductKind>((initial?.kind as ProductKind) ?? "PHYSICAL");
  const [price, setPrice] = useState(initial ? String(initial.price) : "");
  const [compareAt, setCompareAt] = useState(initial?.compare_at_price ? String(initial.compare_at_price) : "");
  // KDV: formda YUZDE tutulur, istekte ORAN gider (bkz. lib/tax.ts). Yeni
  // urunde bos baslar — varsayilan oran YOKTUR, karar veri olarak girilir.
  const [taxPercent, setTaxPercent] = useState(orandanYuzde(initial?.tax_rate));
  const [stock, setStock] = useState(initial?.stock != null ? String(initial.stock) : "");
  const [categoryId, setCategoryId] = useState(initial?.category_id != null ? String(initial.category_id) : "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [status, setStatus] = useState<"ACTIVE" | "HIDDEN" | "DRAFT">(
    initial?.status === "HIDDEN" || initial?.status === "DRAFT" ? initial.status : "ACTIVE"
  );
  // Kitap künyesi (opsiyonel, katlanır; künye doluysa düzenlemede açık başlar).
  const [author, setAuthor] = useState(initial?.author ?? "");
  const [publisher, setPublisher] = useState(initial?.publisher ?? "");
  const [isbn, setIsbn] = useState(initial?.isbn ?? "");
  const [pageCount, setPageCount] = useState(initial?.page_count != null ? String(initial.page_count) : "");
  const [dimensions, setDimensions] = useState(initial?.dimensions ?? "");
  const [pubYear, setPubYear] = useState(initial?.publication_year != null ? String(initial.publication_year) : "");
  const [edition, setEdition] = useState(initial?.edition ?? "");
  const [language, setLanguage] = useState(initial?.language ?? "");
  const [coverType, setCoverType] = useState(initial?.cover_type ?? "");
  // ── Kategori varsayılanından KDV ön-doldurma (Faz 4) ──
  // Yalnız form kolaylığı: sunucu kategori varsayılanından ASLA oran türetmez
  // (`tax_rate` üründe zorunlu veri). Kural: kullanıcının ELLE yazdığı değer
  // EZİLMEZ — alan boşken ya da hâlâ önceki OTOMATİK değerdeyken doldurulur.
  // Kategorilerin varsayılanı yoksa (bugünkü NULL dünyası) hiçbir şey yapmaz.
  const [autoTaxPercent, setAutoTaxPercent] = useState<string | null>(null);
  useEffect(() => {
    const secili = (categories ?? []).find((c) => c.id === Number(categoryId));
    const oneri = orandanYuzde(secili?.effective_tax_rate);
    if (!oneri) return;
    setTaxPercent((mevcut) => {
      if (mevcut !== "" && mevcut !== autoTaxPercent) return mevcut;
      setAutoTaxPercent(oneri);
      return oneri;
    });
    // autoTaxPercent bilinçli olarak bağımlılıkta DEĞİL: kendi güncellediği
    // değeri izleseydi döngü kurulurdu; karşılaştırma set callback'i içinde.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId, categories]);

  const hasKunye = !!(
    initial &&
    (initial.author || initial.publisher || initial.isbn || initial.page_count ||
      initial.dimensions || initial.publication_year || initial.edition ||
      initial.language || initial.cover_type)
  );
  const [showSpecs, setShowSpecs] = useState(hasKunye);
  // Varyant üyeliği (Faz 2). Sözlükler backend'den (variant-config) gelir.
  const [variantGroupId, setVariantGroupId] = useState<number | null>(
    initial?.variant_group_id ?? null
  );
  const [option1Value, setOption1Value] = useState(initial?.option1_value ?? "");
  const [option2Value, setOption2Value] = useState(initial?.option2_value ?? "");
  const [variantSort, setVariantSort] = useState(
    initial?.variant_sort != null ? String(initial.variant_sort) : "0"
  );
  const [barcode, setBarcode] = useState(initial?.barcode ?? "");
  const [showVariant, setShowVariant] = useState(initial?.variant_group_id != null);
  const { data: variantConfig } = useVariantConfig();
  // Kitap kategorisinde varyant kapalı (backend 409'unun aynası): bölüm
  // gizlenir, seçili grup varsa uyarıyla birlikte gösterilir (silinmez —
  // sessiz veri kaybı olmasın, admin kararı görerek versin).
  const kitapKategorisi = isBookCategory(
    categories ?? [],
    categoryId ? Number(categoryId) : null,
    variantConfig?.book_root_slugs ?? []
  );
  // Kitap kategorisi seçilince künye bölümü KENDİLİĞİNDEN açılır: kitapta
  // yazar/yayınevi/ISBN beklenen alanlardır, katlanmış bölüm onları görünmez
  // kılıyordu. Efekt yalnız AÇAR, asla kapatmaz ve `kitapKategorisi`
  // DEĞİŞTİĞİNDE çalışır — böylece kullanıcı bölümü elle kapattığında
  // (kategori aynı kaldığı sürece) onunla inatlaşmaz.
  useEffect(() => {
    if (kitapKategorisi) setShowSpecs(true);
  }, [kitapKategorisi]);
  // Stok gerekcesi: yalniz DUZENLEMEDE ve deger degistiginde zorunlu.
  // (Yeni urunde ilk stok `INITIAL` hareketidir; gerekcesi sabittir.)
  const [stockReason, setStockReason] = useState<AdminReasonCode | "">("");
  const [stockNote, setStockNote] = useState("");
  const stokDegisti =
    isEdit && kind === "PHYSICAL" && Number(stock || 0) !== Number(initial?.stock ?? 0);

  const mutation = useMutation({
    mutationFn: () => {
      // Oran once dogrulanir: gecersizse istek HIC gitmez. Sunucu da 422
      // doner (tek guvenlik siniri orasidir), ama kullanici hatayi formda
      // ve Turkce gormeli.
      const oran = yuzdedenOran(taxPercent);
      if (!oran.ok) throw new Error(oran.hata ?? "KDV oranı geçersiz");
      if (variantGroupId != null) {
        // Sunucu da 400/409 verir; ama admin hatayı formda Türkçe görmeli.
        if (!barcode.trim()) {
          throw new Error("Varyant grubundaki ürün için barkod zorunlu");
        }
        if (!option1Value.trim()) {
          throw new Error("1. eksen değeri zorunlu");
        }
        if (kitapKategorisi) {
          throw new Error("Kitap kategorisindeki üründe varyant açılamaz");
        }
      }
      const base = {
        title,
        price,
        tax_rate: oran.oran,
        compare_at_price: compareAt || null,
        stock: kind === "PHYSICAL" && stock ? Number(stock) : null,
        category_id: categoryId ? Number(categoryId) : null,
        description: description || null,
        author: author || null,
        publisher: publisher || null,
        isbn: isbn || null,
        page_count: pageCount ? Number(pageCount) : null,
        dimensions: dimensions || null,
        publication_year: pubYear ? Number(pubYear) : null,
        edition: edition || null,
        language: language || null,
        cover_type: coverType || null,
        // Varyant üyeliği: grup yoksa eksen değerleri de null gider (sunucu
        // gruptan çıkışta değerleri zaten temizler; form da tutarlı gönderir).
        variant_group_id: variantGroupId,
        option1_value: variantGroupId != null ? option1Value.trim() || null : null,
        option2_value: variantGroupId != null ? option2Value.trim() || null : null,
        variant_sort:
          variantGroupId != null ? parseInt(variantSort, 10) || 0 : 0,
        barcode: barcode.trim() || null,
      };
      if (isEdit) {
        // Delta SUNUCUDA, urun satiri kilitli iken hesaplanir; istemci yalniz
        // HEDEFI gonderir. Ayni hedefin tekrari sunucuda sifir delta uretir ve
        // hareket yazilmaz — bu yuzden gerekce de istenmez.
        const dogrulama = validateStockEdit({
          current: Number(initial?.stock ?? 0),
          next: Number(stock || 0),
          reason: (stockReason || null) as AdminReasonCode | null,
          note: stockNote || null,
        });
        if (kind === "PHYSICAL" && !dogrulama.ok) {
          throw new Error(dogrulama.error ?? "Stok düzenlemesi geçersiz");
        }
        return updateProduct(initial!.id, {
          ...base,
          status,
          ...(dogrulama.submitStock ? dogrulama.payload : { stock: undefined }),
        });
      }
      return createProduct({ ...base, kind, status });
    },
    onSuccess: () => {
      toast.success(isEdit ? "Ürün güncellendi" : "Ürün eklendi");
      onDone();
    },
    onError: (err: unknown) => {
      const metin =
        err instanceof Error && err.message ? err.message : null;
      toast.error(metin ?? (isEdit ? "Ürün güncellenemedi" : "Ürün eklenemedi"));
    },
  });

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ürün adı" className="input sm:col-span-2" />
      {/* Select'lerin placeholder'ı olmaz: ne sorulduğu GÖRÜNÜR bir başlıkla
          yazılır (metin alanlarında bu işi placeholder yapıyor). */}
      {isEdit ? (
        <label className="flex flex-col gap-1">
          <span className={ALAN_BASLIGI}>Durum</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as "ACTIVE" | "HIDDEN" | "DRAFT")} className="input">
            <option value="ACTIVE">Yayında</option>
            <option value="HIDDEN">Gizli</option>
            <option value="DRAFT">Taslak</option>
          </select>
        </label>
      ) : (
        // Açıklama `<label>` DIŞINDA: içeride kalsaydı select'in erişilebilir
        // adına eklenir ve alanın adı "Ürün türü Dijital ürün satışı kapalı…"
        // olurdu (ekran okuyucuda ve testte ölçüldü).
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1">
            <span className={ALAN_BASLIGI}>Ürün türü</span>
            {/* "Basılı" DEĞİL: mağaza kitap dışı ürün de satar (kalem, defter,
                fotokopi kâğıdı). Değerler (PHYSICAL/DIGITAL) değişmedi —
                `kind` DB trigger'ıyla değiştirilemez, etiket ise serbesttir. */}
            <select value={kind} onChange={(e) => setKind(e.target.value as ProductKind)} className="input">
              <option value="PHYSICAL">Fiziksel ürün</option>
              {/* Bayrak kapalıyken seçilemez: kaydedilen dijital ürün satılamaz
                  (checkout 503) ve `kind` sonradan DEĞİŞTİRİLEMEZ. Sunucu da
                  reddeder — burası kullanıcıyı 503'e kadar yürütmemek için. */}
              <option value="DIGITAL" disabled={!dijitalAcik}>
                Dijital ürün
              </option>
            </select>
          </label>
          {!dijitalAcik && (
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              Dijital ürün satışı kapalı olduğu için bu seçenek kullanılamıyor.
              Bayrak açılana dek yalnız fiziksel ürün eklenebilir.
            </span>
          )}
        </div>
      )}
      <label className="flex flex-col gap-1">
        <span className={ALAN_BASLIGI}>Kategori (opsiyonel)</span>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Kategori" className="input">
          <option value="">Kategori seçilmedi</option>
          {(categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Fiyat (TL)" inputMode="decimal" className="input" />
      <input value={compareAt} onChange={(e) => setCompareAt(e.target.value)} placeholder="Eski fiyat (opsiyonel)" inputMode="decimal" className="input" />
      <label className="flex flex-col gap-1">
        <input
          value={taxPercent}
          onChange={(e) => setTaxPercent(e.target.value)}
          placeholder="KDV oranı (%)"
          inputMode="decimal"
          aria-label="KDV oranı (%)"
          className="input"
        />
        <span className="text-[11px] text-slate-400 dark:text-slate-500">
          Yüzde olarak yazın (ör. 20). Fiyat KDV dahildir; oran faturadaki
          matrah ayrıştırması için kullanılır.
        </span>
      </label>
      {kind === "PHYSICAL" && (
        <input value={stock} onChange={(e) => setStock(e.target.value)} placeholder="Stok" inputMode="numeric" className="input" />
      )}
      {stokDegisti && (
        <div className="sm:col-span-2 space-y-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-xs text-amber-900 dark:text-amber-200">
            Stok {initial?.stock ?? 0} → {Number(stock || 0)} olarak
            değişecek. Bu hareket deftere gerekçesiyle yazılır.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={stockReason}
              onChange={(e) => setStockReason(e.target.value as AdminReasonCode | "")}
              className="input"
            >
              <option value="">Gerekçe seçin…</option>
              {ADMIN_REASON_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {requiresNote((stockReason || null) as AdminReasonCode | null) && (
              <input
                value={stockNote}
                onChange={(e) => setStockNote(e.target.value)}
                placeholder="Açıklama (zorunlu)"
                className="input"
              />
            )}
          </div>
        </div>
      )}
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Açıklama" rows={2} className="input sm:col-span-2" />

      {/* Kitap künyesi — opsiyonel, katlanır. Kitap kategorisi seçiliyse
          kendiliğinden açılır (yukarıdaki efekt); kitap dışı üründe kapalı
          kalır ve başlık ne yapılması gerektiğini söyler. */}
      <div className="sm:col-span-2">
        <button
          type="button"
          onClick={() => setShowSpecs((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`transition-transform ${showSpecs ? "rotate-90" : ""}`}>
            <path d="M9 18l6-6-6-6" />
          </svg>
          Kitap künyesi — kitap dışı ürünlerde boş bırakın
        </button>
        {showSpecs && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <p className="text-[11px] text-slate-400 sm:col-span-2 dark:text-slate-500">
              Ebat dışındaki alanlar yalnız kitapta anlamlıdır; kırtasiye
              ürününde ebadı yazıp diğerlerini boş bırakabilirsiniz.
            </p>
            <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Yazar" className="input" />
            <input value={publisher} onChange={(e) => setPublisher(e.target.value)} placeholder="Yayınevi" className="input" />
            <input value={isbn} onChange={(e) => setIsbn(e.target.value)} placeholder="ISBN / Barkod" className="input" />
            <input value={pageCount} onChange={(e) => setPageCount(e.target.value)} placeholder="Sayfa sayısı" inputMode="numeric" className="input" />
            <input value={dimensions} onChange={(e) => setDimensions(e.target.value)} placeholder="Ebat (ör. 20 x 27 cm · A4)" className="input" />
            <input value={pubYear} onChange={(e) => setPubYear(e.target.value)} placeholder="Basım yılı" inputMode="numeric" className="input" />
            <input value={edition} onChange={(e) => setEdition(e.target.value)} placeholder="Baskı (ör. 1. Basım)" className="input" />
            <input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="Dil (ör. Türkçe)" className="input" />
            <input value={coverType} onChange={(e) => setCoverType(e.target.value)} placeholder="Kapak tipi (ör. İnce Kapak)" className="input" />
          </div>
        )}
      </div>

      {/* Varyant üyeliği — kitap kategorisinde kapalı (backend 409'unun aynası) */}
      <div className="sm:col-span-2 border-t border-slate-200 pt-4 dark:border-slate-700">
        {kitapKategorisi ? (
          variantGroupId != null ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Bu ürün bir varyant grubunda ama seçilen kategori kitap
                kategorisi — kitapta varyant açılamaz. Kaydetmeden önce grubu
                kaldırın ya da kategoriyi değiştirin.
              </p>
              <button
                type="button"
                onClick={() => {
                  setVariantGroupId(null);
                  setOption1Value("");
                  setOption2Value("");
                }}
                className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Gruptan çıkar
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Kitap kategorisinde varyant açılamaz — farklı baskı/cilt ayrı
              ISBN'li ayrı bir üründür.
            </p>
          )
        ) : (
          <>
            <button
              type="button"
              onClick={() => setShowVariant((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`transition-transform ${showVariant ? "rotate-90" : ""}`}>
                <path d="M9 18l6-6-6-6" />
              </svg>
              Varyantlar (renk, ebat…)
              {variantGroupId != null && (
                <span className="text-xs font-normal text-slate-400">— grupta</span>
              )}
            </button>
            {showVariant && (
              <VariantMembershipFields
                groupId={variantGroupId}
                onGroupChange={(id) => {
                  setVariantGroupId(id);
                  if (id == null) {
                    setOption1Value("");
                    setOption2Value("");
                  }
                }}
                option1Value={option1Value}
                option2Value={option2Value}
                onOption1Change={setOption1Value}
                onOption2Change={setOption2Value}
                variantSort={variantSort}
                onVariantSortChange={setVariantSort}
                barcode={barcode}
                onBarcodeChange={setBarcode}
                currentProductId={initial?.id}
              />
            )}
          </>
        )}
      </div>

      <button
        type="button"
        disabled={mutation.isPending || !title || !price || !taxPercent}
        onClick={() => mutation.mutate()}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-slate-900 sm:col-span-2"
      >
        {isEdit ? "Kaydet" : "Ürünü ekle"}
      </button>
    </div>
  );
}

/** Ürün formunun varyant bölümü: grup seç/oluştur + eksen değerleri +
 *  kardeş listesi + (kayıtlı üründe) "varyant türet".
 *
 *  Eksen ADLARI yalnız sözlükten seçilir (backend `variant-config`); eksen
 *  DEĞERLERİ serbest metindir. Kardeşler saç-teli çizgili satır listesidir —
 *  kart değil (calm layout).
 */
function VariantMembershipFields({
  groupId,
  onGroupChange,
  option1Value,
  option2Value,
  onOption1Change,
  onOption2Change,
  variantSort,
  onVariantSortChange,
  barcode,
  onBarcodeChange,
  currentProductId,
}: {
  groupId: number | null;
  onGroupChange: (id: number | null) => void;
  option1Value: string;
  option2Value: string;
  onOption1Change: (v: string) => void;
  onOption2Change: (v: string) => void;
  variantSort: string;
  onVariantSortChange: (v: string) => void;
  barcode: string;
  onBarcodeChange: (v: string) => void;
  currentProductId?: number;
}) {
  const { data: config } = useVariantConfig();
  const { data: groups } = useVariantGroups();
  const { data: groupDetail } = useVariantGroup(groupId);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newAxis1, setNewAxis1] = useState("");
  const [newAxis2, setNewAxis2] = useState("");
  const createGroup = useCreateVariantGroup();

  const group = groups?.find((g) => g.id === groupId) ?? groupDetail ?? null;
  const axes = config?.axes ?? [];

  return (
    <div className="mt-3 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <select
          value={groupId != null ? String(groupId) : ""}
          onChange={(e) => {
            if (e.target.value === "__yeni__") {
              setCreating(true);
              return;
            }
            setCreating(false);
            onGroupChange(e.target.value ? Number(e.target.value) : null);
          }}
          aria-label="Varyant grubu"
          className="input"
        >
          <option value="">Varyant grubu yok</option>
          {(groups ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.title} ({g.option1_name}
              {g.option2_name ? ` × ${g.option2_name}` : ""}, {g.member_count} ürün)
            </option>
          ))}
          <option value="__yeni__">＋ Yeni grup oluştur…</option>
        </select>
        {group && (
          <input
            value={barcode}
            onChange={(e) => onBarcodeChange(e.target.value)}
            placeholder="Barkod (zorunlu — raftaki ayırt edici)"
            aria-label="Barkod"
            className="input"
          />
        )}
      </div>

      {creating && (
        <div className="grid gap-2 sm:grid-cols-4">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Grup adı (ör. Fosforlu Kalem)"
            className="input sm:col-span-2"
          />
          <select value={newAxis1} onChange={(e) => setNewAxis1(e.target.value)} aria-label="1. eksen" className="input">
            <option value="">1. eksen…</option>
            {axes.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <select value={newAxis2} onChange={(e) => setNewAxis2(e.target.value)} aria-label="2. eksen (opsiyonel)" className="input">
            <option value="">2. eksen yok</option>
            {axes
              .filter((a) => a !== newAxis1)
              .map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
          </select>
          <div className="sm:col-span-4 flex items-center gap-3">
            <Button
              size="sm"
              disabled={!newTitle.trim() || !newAxis1 || createGroup.isPending}
              onClick={() =>
                createGroup.mutate(
                  {
                    title: newTitle.trim(),
                    option1_name: newAxis1,
                    option2_name: newAxis2 || null,
                  },
                  {
                    onSuccess: (g) => {
                      toast.success("Varyant grubu oluşturuldu");
                      setCreating(false);
                      setNewTitle("");
                      onGroupChange(g.id);
                    },
                    onError: (err: unknown) =>
                      toast.error(getErrorDetail(err, "Grup oluşturulamadı")),
                  }
                )
              }
            >
              Grubu oluştur
            </Button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
            >
              Vazgeç
            </button>
          </div>
        </div>
      )}

      {group && (
        <div className="grid gap-3 sm:grid-cols-3">
          <input
            value={option1Value}
            onChange={(e) => onOption1Change(e.target.value)}
            placeholder={`${group.option1_name} (ör. Sarı)`}
            aria-label={group.option1_name}
            className="input"
          />
          {group.option2_name && (
            <input
              value={option2Value}
              onChange={(e) => onOption2Change(e.target.value)}
              placeholder={`${group.option2_name}`}
              aria-label={group.option2_name}
              className="input"
            />
          )}
          <input
            value={variantSort}
            onChange={(e) => onVariantSortChange(e.target.value)}
            placeholder="Sıra (0, 1, 2…)"
            aria-label="Varyant sırası"
            inputMode="numeric"
            className="input"
          />
        </div>
      )}

      {groupDetail && groupDetail.members.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            Gruptaki varyantlar
          </p>
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-700/60">
            {groupDetail.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate text-slate-700 dark:text-slate-300">
                  {[m.option1_value, m.option2_value].filter(Boolean).join(" / ")}
                  <span className="text-slate-400"> · {m.title}</span>
                  {m.id === currentProductId && (
                    <span className="ml-1.5 text-xs text-indigo-600 dark:text-indigo-400">(bu ürün)</span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-slate-400">
                  {formatTL(m.price)}
                  {m.stock != null && ` · stok ${m.stock}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {currentProductId != null &&
        groupId != null &&
        groupDetail?.members.some((m) => m.id === currentProductId) && (
          <DeriveVariantForm
            productId={currentProductId}
            group={groupDetail}
          />
        )}
    </div>
  );
}

/** "Bu üründen yeni varyant türet" — künye/fiyat/görsel kaynaktan kopyalanır. */
function DeriveVariantForm({
  productId,
  group,
}: {
  productId: number;
  group: NonNullable<ReturnType<typeof useVariantGroup>["data"]>;
}) {
  const [open, setOpen] = useState(false);
  const [value1, setValue1] = useState("");
  const [value2, setValue2] = useState("");
  const [newBarcode, setNewBarcode] = useState("");
  const derive = useDeriveVariant();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
      >
        ＋ Bu üründen yeni varyant türet
      </button>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Künye, fiyat ve görseller bu üründen kopyalanır; yeni varyant{" "}
        <b>taslak</b> olarak oluşur. Başlık önerisi:{" "}
        {value1 ? suggestedVariantTitle(group.title, value1, value2 || null) : "—"}
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <input
          value={value1}
          onChange={(e) => setValue1(e.target.value)}
          placeholder={group.option1_name}
          aria-label={`Yeni ${group.option1_name}`}
          className="input"
        />
        {group.option2_name && (
          <input
            value={value2}
            onChange={(e) => setValue2(e.target.value)}
            placeholder={group.option2_name}
            aria-label={`Yeni ${group.option2_name}`}
            className="input"
          />
        )}
        <input
          value={newBarcode}
          onChange={(e) => setNewBarcode(e.target.value)}
          placeholder="Yeni barkod (zorunlu)"
          aria-label="Yeni barkod"
          className="input"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={
            derive.isPending ||
            !value1.trim() ||
            !newBarcode.trim() ||
            (!!group.option2_name && !value2.trim())
          }
          onClick={() =>
            derive.mutate(
              {
                productId,
                payload: {
                  option1_value: value1.trim(),
                  option2_value: group.option2_name ? value2.trim() : null,
                  barcode: newBarcode.trim(),
                },
              },
              {
                onSuccess: (yeni) => {
                  toast.success(`Varyant türetildi: ${yeni.title} (taslak)`);
                  setOpen(false);
                  setValue1("");
                  setValue2("");
                  setNewBarcode("");
                },
                onError: (err: unknown) =>
                  toast.error(getErrorDetail(err, "Varyant türetilemedi")),
              }
            )
          }
        >
          Türet
        </Button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
        >
          Vazgeç
        </button>
      </div>
    </div>
  );
}
