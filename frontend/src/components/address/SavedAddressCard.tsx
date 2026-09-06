import { useState } from "react";
import type { SavedAddress } from "@/types";

interface SavedAddressCardProps {
  addr: SavedAddress;
  /** Seçili görünüm (rezervasyonda buluşma adresi olarak seçildiğinde). */
  selected?: boolean;
  /** Verilirse kart gövdesi tıklanabilir olur (seçim). */
  onSelect?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /** Verilirse ve adres varsayılan değilse "Varsayılan yap" ikonu görünür. */
  onMakeDefault?: () => void;
  deleting?: boolean;
}

function summaryLine(a: SavedAddress): string {
  const parts = [a.address_line];
  if (a.door_no) parts.push(`No: ${a.door_no}`);
  if (a.apt_no) parts.push(`Daire: ${a.apt_no}`);
  return parts.join(", ");
}

const PinIcon = (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0Z" />
  </svg>
);

const iconBtn =
  "shrink-0 rounded-lg p-1.5 text-slate-300 transition ";

/**
 * Kayıtlı adres kartı — hem rezervasyon ekranındaki seçim listesinde hem de
 * ayarlardaki yönetim listesinde aynı tasarımı kullanır. Aksiyonlar (seç,
 * düzenle, sil, varsayılan yap) prop verildikçe görünür.
 */
export function SavedAddressCard({
  addr,
  selected = false,
  onSelect,
  onEdit,
  onDelete,
  onMakeDefault,
  deleting = false,
}: SavedAddressCardProps) {
  const [confirming, setConfirming] = useState(false);

  const cardCls = `group flex items-start gap-3 rounded-xl border p-3 transition ${
    selected
      ? "border-marka-mid bg-marka-soft/80 shadow-sm "
      : "border-slate-200 bg-white hover:border-marka-mid hover:bg-marka-soft/40 "
  }`;

  if (confirming) {
    return (
      <div className={cardCls}>
        <div className="flex flex-1 items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-600 ">
            "{addr.title}" silinsin mi?
          </span>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              disabled={deleting}
              onClick={onDelete}
              className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50 "
            >
              {deleting ? "Siliniyor…" : "Sil"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg px-2 py-1 text-xs font-medium text-slate-400 transition hover:bg-slate-100 "
            >
              Vazgeç
            </button>
          </div>
        </div>
      </div>
    );
  }

  const body = (
    <>
      <span className="mt-0.5 shrink-0 rounded-lg bg-marka-line p-2 text-marka-soft-fg ">
        {PinIcon}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800 ">
            {addr.title}
          </span>
          {addr.is_default && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700 ">
              Varsayılan
            </span>
          )}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500 ">
          {summaryLine(addr)}
        </span>
      </span>
    </>
  );

  return (
    <div className={cardCls}>
      {onSelect ? (
        <button type="button" onClick={onSelect} className="flex flex-1 items-start gap-3 text-left">
          {body}
        </button>
      ) : (
        <div className="flex flex-1 items-start gap-3">{body}</div>
      )}

      <div className="flex shrink-0 items-center gap-1">
        {onMakeDefault && !addr.is_default && (
          <button
            type="button"
            onClick={onMakeDefault}
            title="Varsayılan yap"
            className={`${iconBtn} hover:bg-emerald-50 hover:text-emerald-500 `}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            title="Adresi düzenle"
            className={`${iconBtn} hover:bg-amber-50 hover:text-amber-500 `}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.89 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.89l12.683-12.683z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 7.125L22.125 9.75M16.5 4.5l2.625 2.625" />
            </svg>
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            title="Adresi sil"
            className={`${iconBtn} hover:bg-red-50 hover:text-red-500 `}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
