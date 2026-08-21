/**
 * Mağaza ürün formu ve varyant bölümü.
 *
 * ## İP-A6 · Görev 4a — göç
 *
 * Bu ekranın adsız kontrol borcunun tamamı (17 kalem, tabanın %30'u)
 * buradaydı ve hepsi aynı desendeydi: `placeholder` etiket yerine
 * kullanılıyordu. `placeholder` erişilebilir ad DEĞİLDİR — alan doldurulunca
 * kaybolur, ekran okuyucu alanı adsız okur, etikete tıklamak odaklamaz.
 *
 * Değişen:
 *
 *   - Her alan `Form.Item` + `Form.Label` + `Form.Control` içinde. Placeholder
 *     yalnız EK BİLGİ taşıdığı yerde kaldı (ör. "ör. 20 x 27 cm · A4");
 *     etiketi tekrar eden placeholder'lar silindi.
 *   - 24 ayrı `useState` → tek `react-hook-form` + zod şeması
 *     (`lib/storeProductForm`). Kural artık TEK kaynakta: aynı şema hem alan
 *     hatasını hem sunucu gövdesini üretiyor.
 *   - **Gönder düğmesi geçerlilik yüzünden KAPANMIYOR** (kalıcı kural).
 *     Eskiden `!title || !price || !taxPercent` ile kapalıydı ve neyin eksik
 *     olduğunu söylemiyordu. Şimdi basılınca geçersizse istek gitmez, hatalar
 *     alanların altında belirir ve **odak ilk hatalı alana taşınır** — hata
 *     katlanmış bir bölümdeyse bölüm önce AÇILIR.
 *   - Doğrulama hataları toast yerine alanlarda; sunucunun 422'si `loc`
 *     üzerinden alanlara dağıtılır, alana düşmeyen kısım şeritte kalır.
 *
 * Değişmeyen (hepsi kabul testleriyle sabit): kategori → KDV ön-doldurma ve
 * kullanıcının elle yazdığını EZMEME kuralı · kitap kategorisinde künyenin
 * kendiliğinden açılması ve elle kapatılınca inatlaşmaması · dijital ürün
 * kapısının fail-closed davranışı · kitap kategorisinde varyantın kapalı
 * olması · stok gerekçesi kuralları · sunucu gövdesinin alanları.
 */
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch, type FieldErrors, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/admin/ui";
import { Form, sunucuHatasiniUygula } from "@/components/admin/ui2/form";
import { useYuzeyKirliFormBekcisi } from "@/components/admin/ui2/duzenlemeYuzeyi";
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
  type AdminReasonCode,
} from "@/lib/stockMovements";
import {
  urunFormSemasi,
  urunGuncelleGovdesi,
  urunOlusturGovdesi,
  type UrunFormBaglami,
  type UrunFormDegerleri,
} from "@/lib/storeProductForm";
import { orandanYuzde } from "@/lib/tax";
import { isBookCategory, suggestedVariantTitle } from "@/lib/variants";
import { toast } from "@/store/toastStore";
import type { ProductDetailOut, ProductKind } from "@/types";

/** `sunucuHatasiniUygula` için BEYAZ LİSTE — formda karşılığı olan alanlar. */
const ALANLAR = [
  "baslik", "tur", "durum", "kategoriId", "fiyat", "eskiFiyat", "kdvYuzde",
  "stok", "stokGerekce", "stokNot", "aciklama", "yazar", "yayinevi", "isbn",
  "sayfaSayisi", "ebat", "basimYili", "baski", "dil", "kapakTipi",
  "varyantGrubuId", "eksen1", "eksen2", "varyantSira", "barkod",
] as const;

/** Sunucu alan adı → form alan adı (422 `loc` eşlemesi). */
const SUNUCU_ALAN_ESLEMESI: Record<string, string> = {
  title: "baslik",
  kind: "tur",
  status: "durum",
  category_id: "kategoriId",
  price: "fiyat",
  compare_at_price: "eskiFiyat",
  tax_rate: "kdvYuzde",
  stock: "stok",
  stock_reason_code: "stokGerekce",
  stock_note: "stokNot",
  description: "aciklama",
  author: "yazar",
  publisher: "yayinevi",
  isbn: "isbn",
  page_count: "sayfaSayisi",
  dimensions: "ebat",
  publication_year: "basimYili",
  edition: "baski",
  language: "dil",
  cover_type: "kapakTipi",
  variant_group_id: "varyantGrubuId",
  option1_value: "eksen1",
  option2_value: "eksen2",
  variant_sort: "varyantSira",
  barcode: "barkod",
};

/** Alanların GÖRSEL sırası; "ilk hatalı alan" bu sıradan okunur. */
const GORSEL_SIRA = [
  "baslik", "durum", "tur", "kategoriId", "fiyat", "eskiFiyat", "kdvYuzde",
  "stok", "stokGerekce", "stokNot", "aciklama",
  "yazar", "yayinevi", "isbn", "sayfaSayisi", "ebat", "basimYili", "baski",
  "dil", "kapakTipi",
  "varyantGrubuId", "barkod", "eksen1", "eksen2", "varyantSira",
] as const;

/** Katlanır künye bölümündeki alanlar — hata oradaysa bölüm AÇILMALI. */
const KUNYE_ALANLARI = new Set<string>([
  "yazar", "yayinevi", "isbn", "sayfaSayisi", "ebat", "basimYili", "baski",
  "dil", "kapakTipi",
]);

/** Katlanır varyant bölümündeki alanlar. */
const VARYANT_ALANLARI = new Set<string>([
  "varyantGrubuId", "eksen1", "eksen2", "varyantSira", "barkod",
]);

function baslangicDegerleri(initial?: ProductDetailOut): UrunFormDegerleri {
  return {
    baslik: initial?.title ?? "",
    tur: ((initial?.kind as ProductKind) ?? "PHYSICAL") as "PHYSICAL" | "DIGITAL",
    durum:
      initial?.status === "HIDDEN" || initial?.status === "DRAFT"
        ? initial.status
        : "ACTIVE",
    kategoriId: initial?.category_id != null ? String(initial.category_id) : "",
    fiyat: initial ? String(initial.price) : "",
    eskiFiyat: initial?.compare_at_price ? String(initial.compare_at_price) : "",
    // KDV: formda YÜZDE tutulur, istekte ORAN gider (bkz. lib/tax.ts). Yeni
    // üründe boş başlar — varsayılan oran YOKTUR, karar veri olarak girilir.
    kdvYuzde: orandanYuzde(initial?.tax_rate),
    stok: initial?.stock != null ? String(initial.stock) : "",
    stokGerekce: "",
    stokNot: "",
    aciklama: initial?.description ?? "",
    yazar: initial?.author ?? "",
    yayinevi: initial?.publisher ?? "",
    isbn: initial?.isbn ?? "",
    sayfaSayisi: initial?.page_count != null ? String(initial.page_count) : "",
    ebat: initial?.dimensions ?? "",
    basimYili:
      initial?.publication_year != null ? String(initial.publication_year) : "",
    baski: initial?.edition ?? "",
    dil: initial?.language ?? "",
    kapakTipi: initial?.cover_type ?? "",
    varyantGrubuId: initial?.variant_group_id ?? null,
    eksen1: initial?.option1_value ?? "",
    eksen2: initial?.option2_value ?? "",
    varyantSira: initial?.variant_sort != null ? String(initial.variant_sort) : "0",
    barkod: initial?.barcode ?? "",
  };
}

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
  const { data: variantConfig } = useVariantConfig();
  // Dijital ürün kapısı (İSTEMCİ AYNASI — otorite sunucudadır). Bilgi
  // yüklenmediyse/uç patladıysa FAIL-CLOSED: bkz. lib/paymentAvailability.
  const { data: odemeUygunlugu } = usePaymentAvailability();
  const dijitalAcik = digitalProductsOpen(odemeUygunlugu);

  const hasKunye = !!(
    initial &&
    (initial.author || initial.publisher || initial.isbn || initial.page_count ||
      initial.dimensions || initial.publication_year || initial.edition ||
      initial.language || initial.cover_type)
  );
  const [showSpecs, setShowSpecs] = useState(hasKunye);
  const [showVariant, setShowVariant] = useState(initial?.variant_group_id != null);

  // ── Bağlam: şema fabrikasının girdisi ──
  //
  // Şema `resolver`ın İÇİNDE, o anki DEĞERLERDEN kurulur. Kapalı bir şemayı
  // `useMemo` ile dışarıda kurmak, kategori değiştiğinde kuralın bir tık geç
  // güncellenmesine yol açardı: kullanıcı kitap kategorisi seçip hemen
  // gönderirse eski kural koşar.
  const form = useForm<UrunFormDegerleri>({
    defaultValues: baslangicDegerleri(initial),
    // Anlık doğrulama: kullanıcı yazarken hata belirir, gönder'e basmayı
    // beklemez (İP-A2 pilotundan devralınan davranış).
    mode: "onChange",
    // Odaklamayı KENDİMİZ yapıyoruz: katlanmış bölümdeki alan RHF'in
    // odaklamasıyla bulunamaz (DOM'da yok), üstelik RHF'inki `onInvalid`ten
    // SONRA çalışıp bizimkini ezer.
    shouldFocusError: false,
    resolver: (degerler, baglam, secenekler) =>
      zodResolver(
        urunFormSemasi({
          duzenleme: isEdit,
          mevcutStok: Number(initial?.stock ?? 0),
          kitapKategorisi: isBookCategory(
            categories ?? [],
            degerler.kategoriId ? Number(degerler.kategoriId) : null,
            variantConfig?.book_root_slugs ?? []
          ),
        })
      )(degerler, baglam, secenekler),
  });

  const izlenen = useWatch({ control: form.control });
  const seciliKategori = izlenen.kategoriId ?? "";
  const tur = izlenen.tur ?? "PHYSICAL";
  const stokDegeri = izlenen.stok ?? "";
  const varyantGrubuId = izlenen.varyantGrubuId ?? null;

  // Kitap kategorisinde varyant kapalı (backend 409'unun aynası): bölüm
  // gizlenir, seçili grup varsa uyarıyla birlikte gösterilir (silinmez —
  // sessiz veri kaybı olmasın, admin kararı görerek versin).
  const kitapKategorisi = isBookCategory(
    categories ?? [],
    seciliKategori ? Number(seciliKategori) : null,
    variantConfig?.book_root_slugs ?? []
  );

  const baglam: UrunFormBaglami = {
    duzenleme: isEdit,
    mevcutStok: Number(initial?.stock ?? 0),
    kitapKategorisi,
  };

  // ── Kategori varsayılanından KDV ön-doldurma (Faz 4) ──
  // Yalnız form kolaylığı: sunucu kategori varsayılanından ASLA oran türetmez
  // (`tax_rate` üründe zorunlu veri). Kural: kullanıcının ELLE yazdığı değer
  // EZİLMEZ — alan boşken ya da hâlâ önceki OTOMATİK değerdeyken doldurulur.
  // Kategorilerin varsayılanı yoksa (bugünkü NULL dünyası) hiçbir şey yapmaz.
  //
  // Otomatik değer artık `useState` yerine ref'te: eski kod `setTaxPercent`
  // callback'inin İÇİNDEN başka bir `setState` çağırıyordu (React'in
  // uyardığı desen) ve bağımlılık dizisini elle kısaltmak zorunda kalmıştı.
  const otomatikKdvRef = useRef<string | null>(null);
  useEffect(() => {
    const secili = (categories ?? []).find((c) => c.id === Number(seciliKategori));
    const oneri = orandanYuzde(secili?.effective_tax_rate);
    if (!oneri) return;
    const mevcut = form.getValues("kdvYuzde");
    if (mevcut !== "" && mevcut !== otomatikKdvRef.current) return;
    otomatikKdvRef.current = oneri;
    form.setValue("kdvYuzde", oneri);
    // `form` kimliğini korur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seciliKategori, categories]);

  // Kitap kategorisi seçilince künye bölümü KENDİLİĞİNDEN açılır: kitapta
  // yazar/yayınevi/ISBN beklenen alanlardır, katlanmış bölüm onları görünmez
  // kılıyordu. Efekt yalnız AÇAR, asla kapatmaz ve `kitapKategorisi`
  // DEĞİŞTİĞİNDE çalışır — böylece kullanıcı bölümü elle kapattığında
  // (kategori aynı kaldığı sürece) onunla inatlaşmaz.
  useEffect(() => {
    if (kitapKategorisi) setShowSpecs(true);
  }, [kitapKategorisi]);

  // Stok gerekçesi: yalnız DÜZENLEMEDE ve değer değiştiğinde zorunlu.
  // (Yeni üründe ilk stok `INITIAL` hareketidir; gerekçesi sabittir.)
  const stokDegisti =
    isEdit && tur === "PHYSICAL" && Number(stokDegeri || 0) !== Number(initial?.stock ?? 0);

  const mutation = useMutation({
    mutationFn: (degerler: UrunFormDegerleri) => {
      if (isEdit) {
        return updateProduct(initial!.id, urunGuncelleGovdesi(degerler, baglam));
      }
      return createProduct(urunOlusturGovdesi(degerler));
    },
    onSuccess: () => {
      toast.success(isEdit ? "Ürün güncellendi" : "Ürün eklendi");
      onDone();
    },
  });

  // ── Sunucu hatasının dağıtımı ──
  //
  // `loc`'u bir alana düşen 422 mesajı O ALANIN altına yazılır ve genel
  // şeride HİÇ gitmez. Alana düşmeyen kısım — 500, ağ hatası, formda
  // karşılığı olmayan alan — şeritte kalır; beyaz liste sayesinde sessizce
  // kaybolmaz.
  const [genelHata, setGenelHata] = useState<string | null>(null);
  useEffect(() => {
    if (!mutation.error) {
      setGenelHata(null);
      return;
    }
    setGenelHata(
      sunucuHatasiniUygula(mutation.error, form, ALANLAR, SUNUCU_ALAN_ESLEMESI, (h) =>
        getErrorDetail(h, isEdit ? "Ürün güncellenemedi" : "Ürün eklenemedi")
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutation.error]);

  // ── Kirli form bekçisi (İP-A7d2 · SK-4) ──
  //
  // BU ÇAĞRI YOKTU. `EditProductModal` İP-A6'da ortak `DuzenlemePenceresi`ye
  // geçirildi ve rapor "kirli formda kapatma onayı geldi" dedi; ama pencere
  // korumayı İÇERİKTEN öğrenir ve `ProductForm` bekçiyi hiç çağırmıyordu.
  // Sonuç: 25 alanlık ürün formunda ×/ESC/dış tıklama, yazılan her şeyi
  // SORMADAN siliyordu. A7d2'nin `pencereSiz` beyanı bu deliği KAPATMAZ —
  // hiç çağrılmayan bir kancanın beyanı da olmaz (rapor: SK-4).
  //
  // `pencereSiz` beyanı `mode`dan türer ve bu tesadüf değil: form iki yerde
  // yaşıyor — `ProductsPanel`de SATIR İÇİ (oluşturma, pencere yok) ve
  // `EditProductModal`de PENCERE İÇİNDE (düzenleme). Beyanın çağrı yerine
  // göre değişmesi gereken ilk gerçek örneği budur.
  useYuzeyKirliFormBekcisi({
    form,
    sunucuHatasi: mutation.error,
    pencereSiz: isEdit ? undefined : true,
  });

  // ── Odak kurtarması: katlanmış bölümdeki hataya erişim ──
  //
  // `setFocus` DOM'da olmayan alanı odaklayamaz. Bölüm önce açılır, alan
  // render edildikten SONRA odaklanır — bu yüzden hedef bir tur state'te
  // bekletilir.
  const [odakAlani, setOdakAlani] = useState<(typeof GORSEL_SIRA)[number] | null>(null);
  useEffect(() => {
    if (!odakAlani) return;
    form.setFocus(odakAlani);
    setOdakAlani(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [odakAlani]);

  const gonder = form.handleSubmit(
    (degerler) => mutation.mutate(degerler),
    (hatalar: FieldErrors<UrunFormDegerleri>) => {
      const ilk = GORSEL_SIRA.find((a) => hatalar[a]);
      if (!ilk) return;
      if (KUNYE_ALANLARI.has(ilk)) setShowSpecs(true);
      if (VARYANT_ALANLARI.has(ilk)) setShowVariant(true);
      setOdakAlani(ilk);
    }
  );

  // Formun geneline düşen şema hatası (alanı olmayan kural: kitap
  // kategorisinde varyant). RHF bunu kök yolda tutar.
  const formGenelHatasi = (form.formState.errors as { root?: { message?: string } })
    .root?.message;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Form.Field
        control={form.control}
        name="baslik"
        render={({ field }) => (
          <Form.Item className="block sm:col-span-2">
            <Form.Label>Ürün adı</Form.Label>
            <Form.Control>
              <input className="input" {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      {isEdit ? (
        <Form.Field
          control={form.control}
          name="durum"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Durum</Form.Label>
              <Form.Control>
                <select className="input" {...field}>
                  <option value="ACTIVE">Yayında</option>
                  <option value="HIDDEN">Gizli</option>
                  <option value="DRAFT">Taslak</option>
                </select>
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
      ) : (
        <Form.Field
          control={form.control}
          name="tur"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Ürün türü</Form.Label>
              <Form.Control>
                {/* "Basılı" DEĞİL: mağaza kitap dışı ürün de satar (kalem,
                    defter, fotokopi kâğıdı). Değerler (PHYSICAL/DIGITAL)
                    değişmedi — `kind` DB trigger'ıyla değiştirilemez,
                    etiket ise serbesttir. */}
                <select className="input" {...field}>
                  <option value="PHYSICAL">Fiziksel ürün</option>
                  {/* Bayrak kapalıyken seçilemez: kaydedilen dijital ürün
                      satılamaz (checkout 503) ve `kind` sonradan
                      DEĞİŞTİRİLEMEZ. Sunucu da reddeder — burası kullanıcıyı
                      503'e kadar yürütmemek için. */}
                  <option value="DIGITAL" disabled={!dijitalAcik}>
                    Dijital ürün
                  </option>
                </select>
              </Form.Control>
              {/* Açıklama etiketin DIŞINDA: `Form.Hint` slotta durur ve
                  `aria-describedby` ile bağlanır, alanın ADINA karışmaz.
                  (Eskiden `<label>` içindeydi ve alanın adı "Ürün türü
                  Dijital ürün satışı kapalı…" oluyordu.) */}
              {!dijitalAcik && (
                <Form.Hint>
                  Dijital ürün satışı kapalı olduğu için bu seçenek
                  kullanılamıyor. Bayrak açılana dek yalnız fiziksel ürün
                  eklenebilir.
                </Form.Hint>
              )}
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
      )}

      <Form.Field
        control={form.control}
        name="kategoriId"
        render={({ field }) => (
          <Form.Item>
            <Form.Label optional>Kategori</Form.Label>
            <Form.Control>
              <select className="input" {...field}>
                <option value="">Kategori seçilmedi</option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      <Form.Field
        control={form.control}
        name="fiyat"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Fiyat (TL)</Form.Label>
            <Form.Control>
              <input className="input" inputMode="decimal" {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      <Form.Field
        control={form.control}
        name="eskiFiyat"
        render={({ field }) => (
          <Form.Item>
            <Form.Label optional>Eski fiyat</Form.Label>
            <Form.Control>
              <input className="input" inputMode="decimal" {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      <Form.Field
        control={form.control}
        name="kdvYuzde"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>KDV oranı (%)</Form.Label>
            <Form.Control>
              <input className="input" inputMode="decimal" {...field} />
            </Form.Control>
            <Form.Hint>
              Yüzde olarak yazın (ör. 20). Fiyat KDV dahildir; oran faturadaki
              matrah ayrıştırması için kullanılır.
            </Form.Hint>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      {tur === "PHYSICAL" && (
        <Form.Field
          control={form.control}
          name="stok"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Stok</Form.Label>
              <Form.Control>
                <input className="input" inputMode="numeric" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
      )}

      {stokDegisti && (
        <div className="sm:col-span-2 space-y-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-xs text-amber-900 dark:text-amber-200">
            Stok {initial?.stock ?? 0} → {Number(stokDegeri || 0)} olarak
            değişecek. Bu hareket deftere gerekçesiyle yazılır.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Form.Field
              control={form.control}
              name="stokGerekce"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Gerekçe</Form.Label>
                  <Form.Control>
                    <select className="input" {...field}>
                      <option value="">Gerekçe seçin…</option>
                      {ADMIN_REASON_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            {/* Açıklama YALNIZ gerekli gerekçelerde ("Diğer") istenir —
                davranış İP-A5 öncesiyle aynı; koşul `lib/stockMovements`ın
                `requiresNote` kuralından okunur. */}
            {requiresNote((izlenen.stokGerekce || null) as AdminReasonCode | null) && (
              <Form.Field
                control={form.control}
                name="stokNot"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Stok değişikliği açıklaması</Form.Label>
                    <Form.Control>
                      <input className="input" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            )}
          </div>
        </div>
      )}

      <Form.Field
        control={form.control}
        name="aciklama"
        render={({ field }) => (
          <Form.Item className="block sm:col-span-2">
            <Form.Label optional>Açıklama</Form.Label>
            <Form.Control>
              <textarea className="input" rows={2} {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      {/* Kitap künyesi — opsiyonel, katlanır. Kitap kategorisi seçiliyse
          kendiliğinden açılır (yukarıdaki efekt); kitap dışı üründe kapalı
          kalır ve başlık ne yapılması gerektiğini söyler. */}
      <div className="sm:col-span-2">
        <KatlanirBaslik acik={showSpecs} onDegis={() => setShowSpecs((v) => !v)}>
          Kitap künyesi — kitap dışı ürünlerde boş bırakın
        </KatlanirBaslik>
        {showSpecs && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <p className="text-[11px] text-slate-400 sm:col-span-2 dark:text-slate-500">
              Ebat dışındaki alanlar yalnız kitapta anlamlıdır; kırtasiye
              ürününde ebadı yazıp diğerlerini boş bırakabilirsiniz.
            </p>
            <KunyeAlani form={form} ad="yazar" etiket="Yazar" />
            <KunyeAlani form={form} ad="yayinevi" etiket="Yayınevi" />
            <KunyeAlani form={form} ad="isbn" etiket="ISBN / Barkod" />
            <KunyeAlani form={form} ad="sayfaSayisi" etiket="Sayfa sayısı" mod="numeric" />
            <KunyeAlani form={form} ad="ebat" etiket="Ebat" ipucu="ör. 20 x 27 cm · A4" />
            <KunyeAlani form={form} ad="basimYili" etiket="Basım yılı" mod="numeric" />
            <KunyeAlani form={form} ad="baski" etiket="Baskı" ipucu="ör. 1. Basım" />
            <KunyeAlani form={form} ad="dil" etiket="Dil" ipucu="ör. Türkçe" />
            <KunyeAlani form={form} ad="kapakTipi" etiket="Kapak tipi" ipucu="ör. İnce Kapak" />
          </div>
        )}
      </div>

      {/* Varyant üyeliği — kitap kategorisinde kapalı (backend 409'unun aynası) */}
      <div className="sm:col-span-2 border-t border-slate-200 pt-4 dark:border-slate-700">
        {kitapKategorisi ? (
          varyantGrubuId != null ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Bu ürün bir varyant grubunda ama seçilen kategori kitap
                kategorisi — kitapta varyant açılamaz. Kaydetmeden önce grubu
                kaldırın ya da kategoriyi değiştirin.
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  form.setValue("varyantGrubuId", null, { shouldValidate: true });
                  form.setValue("eksen1", "");
                  form.setValue("eksen2", "");
                }}
              >
                Gruptan çıkar
              </Button>
            </div>
          ) : (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Kitap kategorisinde varyant açılamaz — farklı baskı/cilt ayrı
              ISBN'li ayrı bir üründür.
            </p>
          )
        ) : (
          <>
            <KatlanirBaslik acik={showVariant} onDegis={() => setShowVariant((v) => !v)}>
              Varyantlar (renk, ebat…)
              {varyantGrubuId != null && (
                <span className="text-xs font-normal text-slate-400">— grupta</span>
              )}
            </KatlanirBaslik>
            {showVariant && (
              <VariantMembershipFields form={form} currentProductId={initial?.id} />
            )}
          </>
        )}
      </div>

      {/* YALNIZ genel/sunucu hatası ve alanı olmayan form kuralı. Alan
          doğrulama hataları buraya asla düşmez — kendi alanlarının altında
          dururlar (İP-A2 sözleşmesi). */}
      {(genelHata || formGenelHatasi) && (
        <p
          role="alert"
          className="sm:col-span-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100"
        >
          {formGenelHatasi ?? genelHata}
        </p>
      )}

      {/* Geçerlilik kapısı YOK: `isPending` yalnız çift gönderimi engeller. */}
      <Button className="sm:col-span-2" isPending={mutation.isPending} onClick={gonder}>
        {isEdit ? "Kaydet" : "Ürünü ekle"}
      </Button>
    </div>
  );
}

/** Künye ızgarasındaki tek alan — dokuzu da aynı desende. */
function KunyeAlani({
  form,
  ad,
  etiket,
  ipucu,
  mod,
}: {
  form: UseFormReturn<UrunFormDegerleri>;
  ad: keyof UrunFormDegerleri;
  etiket: string;
  /** Placeholder yalnız EK BİLGİ taşıdığında verilir; etiketi tekrar etmez. */
  ipucu?: string;
  mod?: "numeric";
}) {
  return (
    <Form.Field
      control={form.control}
      name={ad}
      render={({ field }) => (
        <Form.Item>
          <Form.Label optional>{etiket}</Form.Label>
          <Form.Control>
            <input
              className="input"
              placeholder={ipucu}
              inputMode={mod}
              {...field}
              value={String(field.value ?? "")}
            />
          </Form.Control>
          <Form.ErrorMessage />
        </Form.Item>
      )}
    />
  );
}

/**
 * Katlanır bölüm başlığı — A5'in "yedi tekrar eden desen" listesinden biri.
 *
 * `Button` DEĞİL: bu bir aksiyon değil, bir açma/kapama denetimidir ve
 * `aria-expanded` taşır. Ortak `Button` görsel varyantlarıyla (dolgu, gölge)
 * gelir; burada istenen sade bir satır başlığıdır. Ham `<button>` kalması
 * bilinçlidir ve sayaçta borç olarak görünmeye devam eder.
 */
function KatlanirBaslik({
  acik,
  onDegis,
  children,
}: {
  acik: boolean;
  onDegis: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={acik}
      onClick={onDegis}
      className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        className={`transition-transform ${acik ? "rotate-90" : ""}`}
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
      {children}
    </button>
  );
}

/** Ürün formunun varyant bölümü: grup seç/oluştur + eksen değerleri +
 *  kardeş listesi + (kayıtlı üründe) "varyant türet".
 *
 *  Eksen ADLARI yalnız sözlükten seçilir (backend `variant-config`); eksen
 *  DEĞERLERİ serbest metindir. Kardeşler saç-teli çizgili satır listesidir —
 *  kart değil (calm layout).
 *
 *  İP-A6: alanlar artık ana formun KENDİ alanlarıdır (prop köprüsü kalktı),
 *  böylece barkod/eksen hataları formun geri kalanıyla aynı yoldan gelir.
 */
function VariantMembershipFields({
  form,
  currentProductId,
}: {
  form: UseFormReturn<UrunFormDegerleri>;
  currentProductId?: number;
}) {
  const { data: config } = useVariantConfig();
  const { data: groups } = useVariantGroups();
  const groupId = useWatch({ control: form.control, name: "varyantGrubuId" });
  const { data: groupDetail } = useVariantGroup(groupId ?? null);
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
        <Form.Field
          control={form.control}
          name="varyantGrubuId"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Varyant grubu</Form.Label>
              <Form.Control>
                <select
                  className="input"
                  value={field.value != null ? String(field.value) : ""}
                  onBlur={field.onBlur}
                  onChange={(e) => {
                    if (e.target.value === "__yeni__") {
                      setCreating(true);
                      return;
                    }
                    setCreating(false);
                    const id = e.target.value ? Number(e.target.value) : null;
                    field.onChange(id);
                    if (id == null) {
                      form.setValue("eksen1", "");
                      form.setValue("eksen2", "");
                    }
                  }}
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
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
        {group && (
          <Form.Field
            control={form.control}
            name="barkod"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Barkod</Form.Label>
                <Form.Control>
                  <input className="input" {...field} />
                </Form.Control>
                <Form.Hint>Zorunlu — raftaki ayırt edici.</Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        )}
      </div>

      {creating && (
        <div className="grid gap-2 sm:grid-cols-4">
          {/* Bu üç alan ANA FORMUN parçası değil: yeni bir varyant GRUBU
              yaratan ayrı bir mini formdur ve kendi ucuna gider. `Form.Field`
              yok, ama etiket/`id` bağı `Form.Item` üzerinden aynı. */}
          <Form.Item className="block sm:col-span-2">
            <Form.Label>Grup adı</Form.Label>
            <Form.Control>
              <input
                className="input"
                placeholder="ör. Fosforlu Kalem"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </Form.Control>
          </Form.Item>
          <Form.Item>
            <Form.Label>1. eksen</Form.Label>
            <Form.Control>
              <select
                className="input"
                value={newAxis1}
                onChange={(e) => setNewAxis1(e.target.value)}
              >
                <option value="">1. eksen…</option>
                {axes.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </Form.Control>
          </Form.Item>
          <Form.Item>
            <Form.Label optional>2. eksen</Form.Label>
            <Form.Control>
              <select
                className="input"
                value={newAxis2}
                onChange={(e) => setNewAxis2(e.target.value)}
              >
                <option value="">2. eksen yok</option>
                {axes
                  .filter((a) => a !== newAxis1)
                  .map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
              </select>
            </Form.Control>
          </Form.Item>
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
                      form.setValue("varyantGrubuId", g.id, { shouldValidate: true });
                    },
                    onError: (err: unknown) =>
                      toast.error(getErrorDetail(err, "Grup oluşturulamadı")),
                  }
                )
              }
            >
              Grubu oluştur
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
              Vazgeç
            </Button>
          </div>
        </div>
      )}

      {group && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Form.Field
            control={form.control}
            name="eksen1"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>{group.option1_name}</Form.Label>
                <Form.Control>
                  <input className="input" placeholder="ör. Sarı" {...field} />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
          {group.option2_name && (
            <Form.Field
              control={form.control}
              name="eksen2"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>{group.option2_name}</Form.Label>
                  <Form.Control>
                    <input className="input" {...field} />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
          )}
          <Form.Field
            control={form.control}
            name="varyantSira"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Varyant sırası</Form.Label>
                <Form.Control>
                  <input className="input" inputMode="numeric" placeholder="0, 1, 2…" {...field} />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
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
          <DeriveVariantForm productId={currentProductId} group={groupDetail} />
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
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        ＋ Bu üründen yeni varyant türet
      </Button>
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
        <Form.Item>
          <Form.Label>{`Yeni ${group.option1_name}`}</Form.Label>
          <Form.Control>
            <input
              className="input"
              value={value1}
              onChange={(e) => setValue1(e.target.value)}
            />
          </Form.Control>
        </Form.Item>
        {group.option2_name && (
          <Form.Item>
            <Form.Label>{`Yeni ${group.option2_name}`}</Form.Label>
            <Form.Control>
              <input
                className="input"
                value={value2}
                onChange={(e) => setValue2(e.target.value)}
              />
            </Form.Control>
          </Form.Item>
        )}
        <Form.Item>
          <Form.Label>Yeni barkod</Form.Label>
          <Form.Control>
            <input
              className="input"
              value={newBarcode}
              onChange={(e) => setNewBarcode(e.target.value)}
            />
          </Form.Control>
        </Form.Item>
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
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Vazgeç
        </Button>
      </div>
    </div>
  );
}
