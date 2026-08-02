// F30 paket etiketi — tek paketin basılabilir kâğıdı.
//
// Neden ayrı bir bileşen (LabelSheet varken): `LabelSheet` bir TURUN duraklarını
// basar ve durak QR'ını (`"{stopId}:{token}"`) taşır. Durak token'ı tur iptal
// edilince kayboluyordu (boşluk G3) — basılı etiket ikinci teslim denemesinde
// geçersizleşiyordu. Paket QR'ı (`PKG1:{id}:{token}`) pakete aittir ve paket
// yaşadığı sürece geçerlidir; bu yüzden kutunun üstüne BU basılır.
//
// ## Henüz hangi ekrandan açıldığı — BİLİNÇLİ BOŞLUK (commit 7)
//
// Bileşen commit 6'da yazıldı (baskı sözleşmesi testleriyle birlikte) ama
// hiçbir ekrandan çağrılmıyor. Sebebi veri, tembellik değil: etiket alıcı +
// adres + teslimat tercihi ister, bunlar **siparişte** yaşar ve `PackageOut`
// şemasında YOKTUR (yalnız kuyruk satırı taşır — `PackingQueueRowOut`). Paket
// `PACKED` olduğu anda kuyruktan düştüğü için, tam da basma anında o satır
// elde değildir.
//
// Eksik alanlarla bağlamak en kötü seçenekti: kâğıt "—" basar ve F26'daki
// "etiket bomboş çıktı, kimse fark etmedi" hatası birebir tekrarlanırdı. Doğru
// düzeltme `PackageOut`'a sevkiyat kimliğini eklemektir ve o, sözleşmenin
// commit 7 satırına (`docs/f30-paketleme-sozlesmesi.md:657` — "paket etiketi ve
// kurye zimmet ekranı") aittir. Bileşenin kendisi bugün doğrulanmış durumda:
// `PackageLabel.test.tsx` QR yükünü, `level="M"`, `shrink-0`, `@media print`
// görünürlük kuralını ve eksik kalem metnini gerçek DOM'da sınar.
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";

import {
  MISSING_ITEMS_TEXT,
  formatItemLine,
  hasItemDetail,
  totalQuantity,
} from "@/lib/orderItems";

/** Etikete basılan kalem. Alan adları `PackageItemOut` ile birebirdir. */
export interface PackageLabelItem {
  order_item_id: number;
  sku?: string | null;
  title: string;
  expected_qty: number;
}

/**
 * Etiketin ihtiyaç duyduğu ALANLAR — `Package` tipinin kendisi DEĞİL.
 *
 * Etiket iki farklı kaynaktan beslenir: paket detayı (`GET
 * /packing/packages/{id}`) ve kuyruk satırıyla birleştirilmiş görünüm (alıcı /
 * adres / teslimat tercihi paket kaydında değil, siparişte yaşar). Yapısal bir
 * arayüz ikisini de kabul eder; `Package`'ı doğrudan istemek, adres alanlarını
 * paket şemasına sızdırmayı gerektirirdi.
 */
export interface PackageLabelData {
  id: number;
  code: string;
  order_id: number;
  /** `PKG1:{id}:{token}` — QR'a basılan GERÇEK yük. */
  qr_payload: string;
  status?: string;
  recipient?: string | null;
  address?: string | null;
  phone?: string | null;
  delivery_pref?: string | null;
  items?: readonly PackageLabelItem[];
}

/** Kuryenin kâğıttan okuyabilmesi için tercihin baskı karşılığı. */
const PREF_PRINT: Record<string, string> = {
  KAPIYA_BIRAK: "KAPIYA BIRAK",
  KOMSUYA_BIRAK: "KOMŞUYA BIRAK",
  BENI_ARA: "TESLİMDE ARA",
};

/**
 * QR kenar uzunluğu (px).
 *
 * Paket yükü (`PKG1:{id}:{token}`) durak yükünden uzundur, yani QR matrisi daha
 * yoğundur; 96 px'te modül boyutu depo yazıcısının nokta çözünürlüğüne fazla
 * yaklaşıyor. 112 px hem `LabelSheet`'in ölçülmüş 96 px tabanının üstünde kalır
 * hem tek etiketlik kâğıtta yer sorunu çıkarmaz.
 */
const QR_SIZE = 112;

export function PackageLabel({
  // `package` strict mod'da (ES modülleri her zaman strict) ayrılmış bir
  // sözcüktür; prop adı sözleşme gereği `package` kalır, bağlanan ad değişir.
  package: paket,
  onClose,
}: {
  package: PackageLabelData;
  onClose: () => void;
}) {
  useEffect(() => {
    const kapat = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", kapat);
    return () => window.removeEventListener("keydown", kapat);
  }, [onClose]);

  const kalemler = paket.items ?? [];
  // Etikette BEKLENEN adet yazar, taranan değil: kâğıt kutunun ne İÇERMESİ
  // gerektiğini söyler ve paket kapandıktan sonra ikisi zaten eşittir. Taranan
  // adedi basmak, yarım paketin etiketi alınırsa eksik içeriği "doğru"muş gibi
  // gösterirdi.
  const gosterilecek = kalemler.map((k) => ({
    title: k.title,
    quantity: k.expected_qty,
  }));
  const tercih = paket.delivery_pref ? PREF_PRINT[paket.delivery_pref] : undefined;

  return createPortal(
    <div className="package-label-overlay fixed inset-0 z-[100] overflow-auto bg-slate-100 p-6 text-slate-900">
      {/* `index.css`'teki fatura kuralı `body * { visibility: hidden }` yapıp
          yalnız `#order-invoice`'i geri açıyor. Bu etiket portal ile `body`'ye
          basıldığı için o kuralın kapsamına giriyor; görünürlüğü AÇIKÇA geri
          vermezsek baskı bomboş çıkar (F26'da gerçek Chrome önizlemesinde
          yaşandı: 1 KB'lık boş PDF). */}
      <style>{`@media print { body > #root { display: none !important; } .package-label, .package-label * { visibility: visible !important; } .package-label-overlay { position: static !important; inset: auto !important; overflow: visible !important; background: white !important; padding: 0 !important; } .package-label-noprint { display: none !important; } .package-label { box-shadow: none !important; margin: 0 !important; border-width: 1px !important; } }`}</style>

      <div className="package-label-noprint mx-auto mb-4 flex max-w-md items-center justify-between">
        <p className="text-sm font-semibold">Paket etiketi — {paket.code}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            aria-label={`${paket.code} etiketini yazdır`}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Yazdır
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            Kapat
          </button>
        </div>
      </div>

      <section
        role="region"
        aria-label={`Paket etiketi ${paket.code}, sipariş ${paket.order_id}`}
        className="package-label mx-auto max-w-md break-inside-avoid rounded-lg border border-slate-300 bg-white p-4"
      >
        <div className="flex gap-4">
          {/* shrink-0 ZORUNLU: SVG bir flex öğesidir ve varsayılan
              `flex-shrink:1` ile uzun başlıklı kardeşi onu YATAY olarak ezer
              (F26'da gerçek Chrome ölçümü: 96 px → 36 px, yükseklik 96 kalıyor)
              — kare bozulunca karekod okunamaz. */}
          <div role="img" aria-label={`Paket karekodu ${paket.code}`}>
            <QRCodeSVG
              value={paket.qr_payload}
              // "M" (%15 tolerans): varsayılan "L" %7 verir, depo ortamında
              // etiket buruşur/lekelenir ve okutma başarısız olur.
              level="M"
              size={QR_SIZE}
              className="shrink-0"
            />
          </div>

          <div className="min-w-0 text-xs leading-5">
            {/* QR okunamazsa operasyon durmasın: insan okunur kod ve sipariş
                numarası kâğıtta AYRICA bulunur (sözleşme, F30 kural 2). */}
            <p className="text-base font-bold tracking-tight">{paket.code}</p>
            <p className="font-semibold">Sipariş #{paket.order_id}</p>
            <p className="truncate">{paket.recipient ?? "—"}</p>
            {/* Baskıda kırpma YOK — adres sarmalı ki uzun satır kesilmesin. */}
            <p className="whitespace-pre-line break-words">{paket.address ?? "—"}</p>
            {paket.phone ? <p>{paket.phone}</p> : null}
          </div>
        </div>

        <div className="mt-3 border-t border-slate-200 pt-2 text-xs leading-5">
          <p className="text-slate-500">{totalQuantity(gosterilecek)} parça</p>
          {hasItemDetail(gosterilecek) ? (
            <ul className="mt-0.5 font-medium">
              {kalemler.map((k, i) => (
                <li key={k.order_item_id ?? i} className="break-words">
                  <span className="font-mono text-[11px] text-slate-500">
                    {k.sku ?? "SKU yok"}
                  </span>{" "}
                  {formatItemLine(gosterilecek[i])}
                </li>
              ))}
            </ul>
          ) : (
            // Sessiz boşluk hatayı gizler: F26'da etiket bomboş basılmıştı ve
            // kimse fark etmedi. Eksik veri AÇIKÇA yazılır.
            <p className="mt-0.5 font-semibold">{MISSING_ITEMS_TEXT}</p>
          )}
        </div>

        {tercih ? (
          <p className="mt-2 border-t border-slate-200 pt-2 text-sm font-bold">
            ⚑ {tercih}
          </p>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
