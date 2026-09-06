/**
 * Eksen bazlı varyant seçici.
 *
 * ## NEDEN DEĞİŞTİ
 *
 * Önceki seçici DÜZ BİR LİSTEYDİ: iki eksenli üründe kartezyen çarpımın
 * tamamı ("Kırmızı / S", "Kırmızı / M", "Mavi / S"…) tek satırda diziliyordu.
 * Ebadı sabit olan müşteri her rengi tek tek denemek zorundaydı.
 *
 * ## NEDEN BUTON DEĞİL BAĞLANTI
 *
 * Bu mimaride her varyant KENDİ SAYFASIDIR (kendi slug'ı, kendi barkodu, kendi
 * fiyat geçmişi, kendi kanonik URL'i). Seçim bir gezinmedir; `<Link>` bunun
 * doğru semantiğidir ve orta tık / yeni sekmede aç / bağlantıyı kopyala
 * bedava gelir. Seçili olan `aria-current` taşır.
 *
 * Gezinme gecikmesini gizlemek için üzerine gelindiğinde/odaklanıldığında
 * hedef sayfa ÖN ÇEKİLİR (`prefetchQuery`) — tıklama anlık hissettirir.
 *
 * ## DURUMLAR (mantık `lib/variantAxes.ts`'te, testli)
 *
 *   - `secili`      — mevcut sayfa.
 *   - `secilebilir` — kombinasyon var ve stokta.
 *   - `tukendi`     — kombinasyon var, stok yok. Üstü çizili; TIKLANABİLİR,
 *                     çünkü o sayfada "gelince haber ver" formu var.
 *   - `yok`         — kombinasyon hiç üretilmemiş. Soluk ve üstü ÇİZGİSİZ
 *                     (tükenmişle karışmasın); yine tıklanabilir ki "Mavi"
 *                     ulaşılmaz olmasın, ama diğer eksen değişeceği için
 *                     bağlantı kaybı ipucunu taşır.
 *
 * Hiçbir değer GİZLENMEZ ve durum bilgisi renkle DEĞİL, erişilebilir adla ve
 * ayrı bir görsel işaretle taşınır.
 */
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import * as storeApi from "@/api/store";
import { ROUTES } from "@/lib/routes";
import type { Eksen, EksenDegeri } from "@/lib/variantAxes";

const DURUM_ETIKETI: Record<EksenDegeri["durum"], string> = {
  secili: "seçili",
  secilebilir: "",
  tukendi: "tükendi",
  yok: "bu seçimde yok",
};

export function VariantSelector({ axes }: { axes: Eksen[] }) {
  const qc = useQueryClient();

  /** Hedef sayfayı önceden çeker; tıklama anlık hissettirsin. */
  const onCek = (slug: string) =>
    qc.prefetchQuery({
      queryKey: ["store", "product", slug],
      queryFn: () => storeApi.fetchProduct(slug),
    });

  return (
    <div className="mt-6 space-y-4">
      {axes.map((eksen) => (
        <div key={eksen.name} role="group" aria-labelledby={`eksen-${eksen.name}`}>
          {/* Seçili değerin ADI her zaman görünür: 40 değerin altına 40 etiket
              sığmaz, tek satır hem seçiliyi hem keşfi taşır. */}
          <p
            id={`eksen-${eksen.name}`}
            className="text-sm text-slate-500"
          >
            {eksen.name}:{" "}
            <span className="font-medium text-slate-900">
              {eksen.secili ?? "—"}
            </span>
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {eksen.values.map((deger) => (
              <li key={deger.value}>
                <DegerBaglantisi
                  eksenAdi={eksen.name}
                  deger={deger}
                  onPrefetch={onCek}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function DegerBaglantisi({
  eksenAdi,
  deger,
  onPrefetch,
}: {
  eksenAdi: string;
  deger: EksenDegeri;
  onPrefetch: (slug: string) => void;
}) {
  const durumEki = DURUM_ETIKETI[deger.durum];
  // Erişilebilir ad durumu METİN olarak taşır: renk/çizgi tek başına bilgi
  // taşıyamaz (WCAG 1.4.1) ve ekran okuyucu "soluk"u görmez.
  const erisilebilirAd = durumEki
    ? `${eksenAdi} ${deger.value}, ${durumEki}`
    : `${eksenAdi} ${deger.value}`;

  // Dokunma hedefi en az 44px: `min-h-11` (2.75rem) + yatay dolgu.
  const taban =
    "inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm transition-colors";
  const gorunum =
    deger.durum === "secili"
      ? "border-marka bg-marka-soft font-medium text-marka-soft-fg ring-1 ring-marka-focus"
      : deger.durum === "tukendi"
        ? "border-slate-200 text-slate-400 line-through hover:border-slate-300"
        : deger.durum === "yok"
          ? "border-dashed border-slate-200 text-slate-400 hover:border-slate-300"
          : "border-slate-200 text-slate-700 hover:border-slate-400";

  if (!deger.hedef) {
    // Veri tutarsız (o değere sahip hiç kardeş yok): bağlantı yerine ölü
    // metin. Tıklanacak bir hedef olmadığı için link semantiği yanlış olurdu.
    return (
      <span className={`${taban} ${gorunum}`} aria-label={erisilebilirAd}>
        <Ornek deger={deger} />
        {deger.value}
      </span>
    );
  }

  const hedefYol = ROUTES.storeProduct(deger.hedef.slug);
  const ipucu = deger.kayipIpucu
    ? `?istenen=${encodeURIComponent(deger.kayipIpucu)}`
    : "";

  return (
    <Link
      to={`${hedefYol}${ipucu}`}
      aria-label={erisilebilirAd}
      aria-current={deger.durum === "secili" ? "page" : undefined}
      onMouseEnter={() => onPrefetch(deger.hedef!.slug)}
      onFocus={() => onPrefetch(deger.hedef!.slug)}
      className={`${taban} ${gorunum}`}
    >
      <Ornek deger={deger} />
      <span aria-hidden="true">{deger.value}</span>
      {deger.durum === "secili" && (
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      )}
    </Link>
  );
}

/** Renk örneği — sözlükte tanımlıysa. Yoksa hiçbir şey çizilmez ve değer
 *  metin olarak okunur (eşleşme olmadan da seçici çalışır). */
function Ornek({ deger }: { deger: EksenDegeri }) {
  if (deger.swatchImageUrl) {
    return (
      <img
        src={deger.swatchImageUrl}
        alt=""
        width={18}
        height={18}
        loading="lazy"
        className="h-[18px] w-[18px] shrink-0 rounded-full object-cover ring-1 ring-slate-300"
      />
    );
  }
  if (deger.swatchHex) {
    return (
      <span
        aria-hidden="true"
        style={{ backgroundColor: deger.swatchHex }}
        // Beyaz/açık renklerin kenarı görünsün diye HER örnek halka taşır.
        className="h-[18px] w-[18px] shrink-0 rounded-full ring-1 ring-slate-300"
      />
    );
  }
  return null;
}
