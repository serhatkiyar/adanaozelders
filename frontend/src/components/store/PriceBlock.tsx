/**
 * Fiyat + stok + kargo + teslimat — satın alma kararının tek bloğu.
 *
 * ## ÜSTÜ ÇİZİLİ FİYAT ARTIK SERBEST ALANDAN GELMİYOR
 *
 * `compare_at_price` yönetici tarafından SERBEST girilir ve bir indirim
 * iddiasının dayanağı olamaz. Ticari Reklam ve Haksız Ticari Uygulamalar
 * Yönetmeliği, indirimden önceki pencerede oluşan EN DÜŞÜK fiyatın esas
 * alınmasını ister. Sunucu bunu fiyat geçmişinden türetip
 * `legal_compare_price` olarak veriyor; vitrin yalnız onu gösterir.
 *
 * ## KARGO VE TESLİMAT NEDEN BURADA
 *
 * Ölçümlerde sitelerin %43'ü kargo ücretini ürün sayfasında hiç göstermiyor
 * ve %41'i "2-3 iş günü" gibi bir SÜRE yazıp tarih vermiyor. Kullanıcı süreyi
 * değil tarihi umursuyor; kargo maliyetinin ödeme adımında sürpriz olması ise
 * sepet terkinin başlıca sebeplerinden.
 *
 * ## CANLI BÖLGE
 *
 * Blok `aria-live="polite" aria-atomic="true"` içindedir: varyant değişince
 * fiyat, stok ve teslimat TEK CÜMLE olarak duyurulur. `assertive` kullanılmaz
 * — kullanıcıyı seçim yaparken kesmek doğru değil.
 *
 * ## SLOGAN YOK
 *
 * Blokta pazarlama cümlesi bulunmaz. Yazılan her satır ya sunucudan gelen bir
 * veriyi ya da yasal bir ibareyi taşır.
 */
import { formatTL } from "@/lib/money";
import {
  remainingForFreeShipping,
  shippingConfig,
  shippingFor,
} from "@/lib/shipping";
import type { ProductDetailOut } from "@/types";
import type { StoreConfig } from "@/api/store";

export function PriceBlock({
  product,
  config,
  lowStock,
  deliveryText,
}: {
  product: ProductDetailOut;
  config?: StoreConfig;
  /** Sunucu eşiğine göre "son N ürün" gösterilsin mi (uydurma aciliyet yok). */
  lowStock: boolean;
  /** Teslimat satırı; tedarikçi ürününde ve dijitalde çağıran null geçer. */
  deliveryText?: string | null;
}) {
  const fiyat = Number(product.price);
  const referans = product.legal_compare_price
    ? Number(product.legal_compare_price)
    : null;
  const indirimVar = referans !== null && referans > fiyat;
  const indirimYuzdesi = indirimVar
    ? Math.round(((referans - fiyat) / referans) * 100)
    : 0;

  const kargo = shippingConfig(config);
  const fizikselMi = product.kind === "PHYSICAL";
  const kargoUcreti = shippingFor(fiyat, kargo);
  const kalanTutar = remainingForFreeShipping(fiyat, kargo);
  const soldOut = !product.in_stock;

  return (
    <div aria-live="polite" aria-atomic="true">
      <div className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-3xl font-semibold text-slate-900">
          {formatTL(product.price)}
        </span>
        {indirimVar && (
          <>
            <span className="text-base text-slate-400 line-through">
              {formatTL(String(referans))}
            </span>
            {/* İndirim oranı metin olarak da yazılır: renk tek başına bilgi
                taşıyamaz (WCAG 1.4.1). */}
            <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-sm font-medium text-rose-700">
              %{indirimYuzdesi} indirim
            </span>
          </>
        )}
      </div>

      <p className="mt-1 text-xs text-slate-500">
        KDV dâhil
        {indirimVar && product.price_reference_days
          ? ` · üstü çizili fiyat son ${product.price_reference_days} günün en düşük fiyatıdır`
          : ""}
      </p>

      {fizikselMi && (soldOut || lowStock) && (
        <p className="mt-2 text-sm">
          {soldOut ? (
            <span className="text-slate-500">Stokta yok</span>
          ) : (
            <span className="font-medium text-amber-600">
              Son {product.stock} ürün
            </span>
          )}
        </p>
      )}

      {fizikselMi && (
        <p className="mt-2 text-sm text-slate-600">
          {kargoUcreti === 0 ? (
            <span className="font-medium text-emerald-700">Kargo ücretsiz</span>
          ) : (
            <>
              Kargo {formatTL(String(kargoUcreti))}
              <span className="text-slate-500">
                {" · "}ücretsiz kargo için {formatTL(String(kalanTutar))} daha ekleyin
              </span>
            </>
          )}
        </p>
      )}

      {deliveryText && (
        <p className="mt-1 text-sm text-slate-600">{deliveryText}</p>
      )}
    </div>
  );
}
