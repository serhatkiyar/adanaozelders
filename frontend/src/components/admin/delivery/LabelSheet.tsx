// Paket etiketi yazdırma sayfası — portal body'ye açılır (#root dışına),
// @media print'te yalnız bu kalır. Etikete müşteri teslimat talimatı da
// basılır: kurye kâğıt etiketten "kapıya bırak"ı görebilmeli.
import {
  MISSING_ITEMS_TEXT,
  formatItemLine,
  hasItemDetail,
  totalQuantity,
} from "@/lib/orderItems";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";

import { useModalA11y } from "@/hooks/useModalA11y";

import type { DeliveryRun } from "@/types";

const PREF_PRINT: Record<string, string> = {
  KAPIYA_BIRAK: "KAPIYA BIRAK",
  KOMSUYA_BIRAK: "KOMŞUYA BIRAK",
  BENI_ARA: "TESLİMDE ARA",
};

export function LabelSheet({ run, onClose }: { run: DeliveryRun; onClose: () => void }) {
  const stops = [...run.stops].sort((a, b) => a.sequence - b.sequence);
  // Tam ekran katman bir penceredir: ESC kapatır, Tab arkadaki panele kaçmaz,
  // kapanınca odak açan düğmeye döner. Kaydırma kilidi BİLEREK kapalı: katman
  // opak ve kendi içinde kayar; `body` taşmasına dokunmak baskı akışını
  // (tüm etiketlerin sayfalara dökülmesi) riske atardı.
  const panelRef = useRef<HTMLDivElement>(null);
  useModalA11y({ open: true, onClose, panelRef, lockScroll: false });
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Tur #${run.id} etiketleri`}
      className="delivery-label-sheet fixed inset-0 z-[100] overflow-auto bg-slate-100 text-slate-900"
    >
      {/* index.css'teki fatura print kuralı `body * { visibility: hidden }` ile
          HER ŞEYİ gizliyor ve yalnız #order-invoice'i geri açıyor. Etiket
          sayfası portal ile body'ye basıldığı için o kuralın kapsamına giriyor;
          görünürlüğü AÇIKÇA geri vermezsek baskı bomboş çıkar (gerçek Chrome
          yazdırma önizlemesinde doğrulandı: 1 KB'lık boş PDF). */}
      <style>{`@media print { body > #root { display: none !important; } .delivery-label-sheet, .delivery-label-sheet * { visibility: visible !important; } .delivery-label-sheet { position: static !important; inset: auto !important; background: white !important; } .delivery-label-noprint { display: none !important; } .delivery-label-paper { box-shadow: none !important; margin: 0 !important; } }`}</style>
      <div className="delivery-label-noprint sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <p className="text-sm font-semibold">
          Tur #{run.id}: {stops.length} etiket
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="rounded-lg bg-panel-accent px-4 py-1.5 text-sm font-semibold text-panel-accent-fg hover:bg-panel-accent/90"
          >
            Yazdır
          </button>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            Kapat
          </button>
        </div>
      </div>
      <div className="delivery-label-paper mx-auto my-6 grid max-w-3xl grid-cols-2 gap-4 rounded-xl bg-white p-8 shadow-sm">
        {stops.map((s) => (
          <div
            key={s.id}
            className="flex gap-3 break-inside-avoid rounded-lg border border-slate-300 p-3"
          >
            {/* shrink-0 ZORUNLU: SVG bir flex öğesidir ve varsayılan
                `flex-shrink:1` ile uzun metin kardeşi onu YATAY olarak ezer
                (gerçek Chrome ölçümü: 96px → 36px, yükseklik 96 kalıyor) —
                yani karekod okunamaz hâle gelir. */}
            <QRCodeSVG value={s.qr_payload} size={96} className="shrink-0" />
            <div className="min-w-0 text-xs leading-5">
              <p className="text-sm font-bold">
                #{s.sequence} · Sipariş {s.order_id}
              </p>
              <p className="truncate font-semibold">{s.recipient ?? "-"}</p>
              <p className="line-clamp-3 whitespace-pre-line">{s.address ?? "-"}</p>
              <p>{s.phone ?? ""}</p>
              {/* Kutunun üstünde NE olduğu yazmak zorunda: "N parça" tek başına
                  paketi doğrulamaya yetmez. Baskıda kırpma YOK — satırlar
                  sarmalı ki uzun başlık kesilmesin. */}
              <p className="text-slate-500">{totalQuantity(s.items)} parça</p>
              {hasItemDetail(s.items) ? (
                <ul className="mt-0.5 font-medium">
                  {s.items.map((it, i) => (
                    <li key={`${it.title}-${i}`} className="break-words">
                      • {formatItemLine(it)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-0.5 font-semibold">{MISSING_ITEMS_TEXT}</p>
              )}
              {s.delivery_pref && PREF_PRINT[s.delivery_pref] && (
                <p className="mt-0.5 font-bold">⚑ {PREF_PRINT[s.delivery_pref]}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body
  );
}
