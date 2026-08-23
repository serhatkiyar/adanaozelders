/**
 * Ürün formunun saf kuralları (İP-A6 · Görev 4a).
 *
 * ## Neden ekrandan çıktı
 *
 * Kurallar İP-A5'e kadar `ProductForm`un `mutationFn`i içinde, `throw new
 * Error(...)` zinciri olarak yaşıyordu. Üç zararı vardı:
 *
 *   1. Hata TEK bir toast'a iniyordu — kullanıcı hangi ALANI düzelteceğini
 *      metinden çıkarmak zorundaydı.
 *   2. Gönder düğmesi ayrıca `!title || !price || !taxPercent` ile kapalıydı;
 *      yani kapı ile hata mesajları İKİ AYRI doğruluk kaynağıydı ve saparlardı
 *      (İP-A3c'nin pilotta ölçtüğü kusurun aynısı).
 *   3. Kural yalnız gönderim anında çalıştığı için form yazılırken hiçbir
 *      geri bildirim yoktu.
 *
 * Artık tek kaynak buradadır: aynı şema hem alan hatasını hem gövdeyi üretir.
 *
 * ## Değerler METİNDİR
 *
 * Sayısal `<input>`ün boş hâli `""`dir ve `Number("")` sıfırdır. Fiyatı boş
 * bırakılmış bir ürünü sessizce "0 TL" yapmamak için çevirim TEK yerde,
 * `urunGovdesi`de olur.
 *
 * ## Bağlama bağlı kurallar
 *
 * Stok gerekçesi yalnız DÜZENLEMEDE ve FİZİKSEL üründe, üstelik değer
 * DEĞİŞTİYSE zorunludur; barkod yalnız varyant grubundaki üründe zorunludur.
 * Bunlar alanın kendi kuralı değil, formun durumunun kuralıdır — bu yüzden
 * şema bir FABRİKADIR ve bağlamı dışarıdan alır.
 */
import { z } from "zod";

import {
  ADMIN_REASON_OPTIONS,
  requiresNote,
  validateStockEdit,
  type AdminReasonCode,
} from "./stockMovements";
import { yuzdedenOran } from "./tax";

import type { ProductCreate, ProductUpdate } from "@/types";

export interface UrunFormDegerleri {
  baslik: string;
  tur: "PHYSICAL" | "DIGITAL";
  durum: "ACTIVE" | "HIDDEN" | "DRAFT";
  kategoriId: string;
  fiyat: string;
  eskiFiyat: string;
  kdvYuzde: string;
  stok: string;
  stokGerekce: string;
  stokNot: string;
  aciklama: string;
  yazar: string;
  yayinevi: string;
  isbn: string;
  sayfaSayisi: string;
  ebat: string;
  basimYili: string;
  baski: string;
  dil: string;
  kapakTipi: string;
  varyantGrubuId: number | null;
  eksen1: string;
  eksen2: string;
  varyantSira: string;
  barkod: string;
  /** "Kendi stoğum bitince tedarikçi stoğu vitrinde sayılsın" (yalnız PHYSICAL). */
  tedarikciTemin: boolean;
}

export interface UrunFormBaglami {
  /** Düzenleme mi (stok gerekçesi kuralı buna bağlı). */
  duzenleme: boolean;
  /** Düzenlemede ürünün SUNUCUDAKİ stoğu; delta buradan okunur. */
  mevcutStok: number;
  /** Seçili kategori kitap kökü altında mı (varyant kapısı). */
  kitapKategorisi: boolean;
}

/** Boş bırakılabilen sayısal alan: boşsa geçerli, doluysa pozitif tam sayı. */
const opsiyonelTamsayi = (etiket: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) > 0), {
      message: `${etiket} boş bırakılabilir; yazılacaksa sıfırdan büyük bir tam sayı olmalı.`,
    });

const opsiyonelMetin = z.string();

export function urunFormSemasi(baglam: UrunFormBaglami) {
  return z
    .object({
      baslik: z.string().trim().min(1, "Ürün adı zorunlu."),
      tur: z.enum(["PHYSICAL", "DIGITAL"]),
      durum: z.enum(["ACTIVE", "HIDDEN", "DRAFT"]),
      kategoriId: opsiyonelMetin,
      fiyat: z
        .string()
        .trim()
        .min(1, "Fiyat zorunlu.")
        .refine((v) => Number.isFinite(Number(v.replace(",", "."))), "Fiyat sayı olmalı.")
        .refine((v) => Number(v.replace(",", ".")) >= 0, "Fiyat negatif olamaz."),
      eskiFiyat: z
        .string()
        .trim()
        .refine(
          (v) => v === "" || (Number.isFinite(Number(v.replace(",", "."))) && Number(v.replace(",", ".")) >= 0),
          "Eski fiyat boş bırakılabilir; yazılacaksa negatif olmayan bir sayı olmalı."
        ),
      // KDV kuralının TEK kaynağı `lib/tax`tır: mesaj da oradan gelir, burada
      // ikinci kez yazılmaz (iki metin zamanla sapar).
      kdvYuzde: z.string().superRefine((v, ctx) => {
        const oran = yuzdedenOran(v);
        if (!oran.ok) {
          ctx.addIssue({ code: "custom", message: oran.hata ?? "KDV oranı geçersiz" });
        }
      }),
      stok: opsiyonelMetin,
      stokGerekce: opsiyonelMetin,
      stokNot: opsiyonelMetin,
      aciklama: opsiyonelMetin,
      yazar: opsiyonelMetin,
      yayinevi: opsiyonelMetin,
      isbn: opsiyonelMetin,
      sayfaSayisi: opsiyonelTamsayi("Sayfa sayısı"),
      ebat: opsiyonelMetin,
      basimYili: opsiyonelTamsayi("Basım yılı"),
      baski: opsiyonelMetin,
      dil: opsiyonelMetin,
      kapakTipi: opsiyonelMetin,
      varyantGrubuId: z.number().nullable(),
      eksen1: opsiyonelMetin,
      eksen2: opsiyonelMetin,
      varyantSira: opsiyonelMetin,
      barkod: opsiyonelMetin,
      tedarikciTemin: z.boolean(),
    })
    .superRefine((d, ctx) => {
      if (d.durum === "ACTIVE" && !d.kategoriId) {
        ctx.addIssue({
          code: "custom",
          path: ["kategoriId"],
          message: "Aktif ürün için kategori zorunlu.",
        });
      }
      // ── Varyant üyeliği ──
      if (d.varyantGrubuId != null) {
        if (!d.barkod.trim()) {
          ctx.addIssue({
            code: "custom",
            path: ["barkod"],
            message: "Varyant grubundaki ürün için barkod zorunlu",
          });
        }
        if (!d.eksen1.trim()) {
          ctx.addIssue({
            code: "custom",
            path: ["eksen1"],
            message: "1. eksen değeri zorunlu",
          });
        }
        if (baglam.kitapKategorisi) {
          // Bu hatanın ALANI yoktur: kitap kategorisi seçilince varyant bölümü
          // hiç render edilmez, yani alanın altına yazılan mesaj görünmezdi.
          // Formun geneline (kök yola) düşer ve şeritte gösterilir.
          ctx.addIssue({
            code: "custom",
            message: "Kitap kategorisindeki üründe varyant açılamaz",
          });
        }
      }

      // ── Stok düzenlemesi ──
      //
      // Kural `lib/stockMovements`ta; burada yalnız hangi ALANA yazılacağı
      // kararlaştırılır.
      if (!baglam.duzenleme || d.tur !== "PHYSICAL") return;
      const sonuc = validateStockEdit({
        current: baglam.mevcutStok,
        next: Number(d.stok || 0),
        reason: (d.stokGerekce || null) as AdminReasonCode | null,
        note: d.stokNot || null,
      });
      if (sonuc.ok) return;
      const mesaj = sonuc.error ?? "Stok düzenlemesi geçersiz";
      const gerekce = (d.stokGerekce || null) as AdminReasonCode | null;
      const yol =
        !gerekce || !ADMIN_REASON_OPTIONS.some((o) => o.value === gerekce)
          ? "stokGerekce"
          : requiresNote(gerekce)
            ? "stokNot"
            : "stok";
      ctx.addIssue({ code: "custom", path: [yol], message: mesaj });
    });
}

/**
 * Sunucu gövdesinin ORTAK alanları. Metin → sayı/`null` çevrimi TEK yer.
 *
 * Oluşturma ve güncelleme AYRI fonksiyonlardır: `kind` yalnız oluşturmada
 * gider (`kind` DB trigger'ıyla değiştirilemez) ve stok yalnız güncellemede
 * defter kuralından geçer. Tek fonksiyon iki gövdeyi de üretseydi dönüş tipi
 * `ProductCreate | ProductUpdate` olur ve çağıran taraf `as` ile kendi
 * tipini uydururdu — tsc'nin yakalayacağı bir hatayı susturmak olurdu.
 */
function ortakAlanlar(d: UrunFormDegerleri) {
  const bosNull = (v: string) => (v.trim() === "" ? null : v);
  const sayiVeyaNull = (v: string) => (v.trim() === "" ? null : Number(v));
  return {
    title: d.baslik,
    price: d.fiyat,
    tax_rate: yuzdedenOran(d.kdvYuzde).oran,
    compare_at_price: bosNull(d.eskiFiyat),
    stock: d.tur === "PHYSICAL" && d.stok ? Number(d.stok) : null,
    category_id: d.kategoriId ? Number(d.kategoriId) : null,
    description: bosNull(d.aciklama),
    author: bosNull(d.yazar),
    publisher: bosNull(d.yayinevi),
    isbn: bosNull(d.isbn),
    page_count: sayiVeyaNull(d.sayfaSayisi),
    dimensions: bosNull(d.ebat),
    publication_year: sayiVeyaNull(d.basimYili),
    edition: bosNull(d.baski),
    language: bosNull(d.dil),
    cover_type: bosNull(d.kapakTipi),
    // Varyant üyeliği: grup yoksa eksen değerleri de null gider (sunucu
    // gruptan çıkışta değerleri zaten temizler; form da tutarlı gönderir).
    variant_group_id: d.varyantGrubuId,
    option1_value: d.varyantGrubuId != null ? d.eksen1.trim() || null : null,
    option2_value: d.varyantGrubuId != null ? d.eksen2.trim() || null : null,
    variant_sort: d.varyantGrubuId != null ? parseInt(d.varyantSira, 10) || 0 : 0,
    barcode: d.barkod.trim() || null,
  };
}

/**
 * Tedarikçi anahtarı YALNIZ fiziksel üründe gövdeye girer.
 *
 * Dijital ürün tükenmez; onun için "tedarikçiden temin" anlamsızdır ve alanı
 * göndermek, sunucuda anlamsız bir `true` bırakıp ürün türü ileride
 * sorgulandığında yanıltıcı bir sinyal üretirdi.
 */
function tedarikciAlani(d: UrunFormDegerleri): { supplier_backed?: boolean } {
  return d.tur === "PHYSICAL" ? { supplier_backed: d.tedarikciTemin } : {};
}

/** Yeni ürün gövdesi. */
export function urunOlusturGovdesi(d: UrunFormDegerleri): ProductCreate {
  return { ...ortakAlanlar(d), ...tedarikciAlani(d), kind: d.tur, status: d.durum };
}

/**
 * Ürün güncelleme gövdesi.
 *
 * Delta SUNUCUDA, ürün satırı kilitliyken hesaplanır; istemci yalnız HEDEFİ
 * gönderir. Aynı hedefin tekrarı sunucuda sıfır delta üretir ve hareket
 * yazılmaz — bu yüzden gerekçe de istenmez ve `stock` HİÇ gönderilmez.
 */
export function urunGuncelleGovdesi(
  d: UrunFormDegerleri,
  baglam: UrunFormBaglami
): ProductUpdate {
  const dogrulama = validateStockEdit({
    current: baglam.mevcutStok,
    next: Number(d.stok || 0),
    reason: (d.stokGerekce || null) as AdminReasonCode | null,
    note: d.stokNot || null,
  });
  return {
    ...ortakAlanlar(d),
    ...tedarikciAlani(d),
    status: d.durum,
    ...(dogrulama.submitStock ? dogrulama.payload : { stock: undefined }),
  };
}
