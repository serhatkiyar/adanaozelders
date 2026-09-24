import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@/components/AppIcon";
import { useDownloadWalletCsv, useRequestWithdrawal, useWallet } from "@/hooks/useWallet";
import { getErrorMessage } from "@/lib/errors";
import { parseMoney } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";

/**
 * Öğretmen cüzdanı — Preply deseni (kullanıcı kararı, 23 Eyl 2026).
 *
 * Ayrı bir kazançlar ekranı YOK: üst barda cüzdan ikonu + bakiye, tıklayınca
 * bu kutu açılır. Para öğretmen "Para çek" diyene kadar gönderilmez; talep
 * ödenebilir bakiyenin TAMAMI içindir ve tutar sunucuda hesaplanır.
 */

/** Cüzdan tutarı — sembol sayının SAĞINDA: "2.790 ₺" (kullanıcı kararı, 23 Eyl 2026). */
export const cuzdanTutari = (value: string | null | undefined) =>
  `${(parseMoney(value) ?? 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} ₺`;

/** Kutunun içeriği — masaüstü açılır kutu ve mobil pencere ortak kullanır. */
export function CuzdanIcerik() {
  const { data: cuzdan, isLoading, isError } = useWallet();
  const paraCek = useRequestWithdrawal();
  const indir = useDownloadWalletCsv();

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="mx-auto h-8 w-28 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-11 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-11 animate-pulse rounded-lg bg-slate-100" />
      </div>
    );
  }
  if (isError || !cuzdan) {
    return <p className="text-center text-sm text-slate-500">Cüzdan bilgisi yüklenemedi.</p>;
  }

  const engel = cuzdan.withdraw_block_reason;
  const ibanEksik = cuzdan.payout_status !== "ACTIVE" && !cuzdan.open_request;

  return (
    <div>
      <div className="text-center">
        <p className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
          {cuzdanTutari(cuzdan.balance)}
        </p>
        {/* Yalnız tamamlanmış derslerin parası. Emanetteki (dersi henüz
            yapılmamış, iptal olabilecek) tutar kutuda HİÇ gösterilmez
            (kullanıcı kararı, 23 Eyl 2026). */}
        <p className="mt-0.5 text-sm text-slate-500">Mevcut bakiye</p>
      </div>

      {cuzdan.open_request && (
        <p className="mt-4 rounded-lg bg-marka-soft px-3 py-2 text-center text-sm text-slate-800">
          {cuzdanTutari(cuzdan.open_request.amount)} çekim talebin işleniyor.
        </p>
      )}

      <button
        type="button"
        disabled={engel !== null || paraCek.isPending}
        onClick={() =>
          paraCek.mutate(undefined, {
            onSuccess: () => toast.success("Para çekme talebin alındı."),
            onError: (e) => toast.error(getErrorMessage(e, "Para çekme talebi açılamadı.")),
          })
        }
        className="mt-4 flex h-11 w-full items-center justify-center rounded-lg bg-marka text-sm font-semibold text-marka-fg transition hover:bg-marka-hover disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
      >
        {paraCek.isPending ? "Gönderiliyor..." : "Para çek"}
      </button>
      {engel && !cuzdan.open_request && (
        <p className="mt-2 text-center text-xs text-slate-500">
          {engel}{" "}
          {ibanEksik && (
            <Link
              to={`${ROUTES.settings}?bolum=odeme`}
              className="font-semibold text-marka-metin underline underline-offset-2"
            >
              Ödeme bilgilerini ekle
            </Link>
          )}
        </p>
      )}

      <button
        type="button"
        disabled={indir.isPending}
        onClick={() =>
          indir.mutate(undefined, {
            onError: (e) => toast.error(getErrorMessage(e, "Geçmiş indirilemedi.")),
          })
        }
        className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-900 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 disabled:opacity-60"
      >
        <Icon name="arrowDownload" className="h-5 w-5" />
        {indir.isPending ? "Hazırlanıyor..." : "Geçmişi dosya olarak ver"}
      </button>
    </div>
  );
}

/** Üst bar tetikleyicisi + açılır kutu (yalnız masaüstü, TUTOR). */
export function CuzdanPaneli() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: cuzdan } = useWallet();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Cüzdan"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex h-10 items-center gap-1.5 rounded-lg px-1 text-slate-900 transition hover:text-marka-metin"
      >
        <Icon name="wallet" className="h-6 w-6" />
        <span className="text-sm font-semibold tabular-nums">
          {cuzdanTutari(cuzdan?.balance)}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-80 origin-top-right rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-100 animate-in zoom-in-95 duration-150">
          <CuzdanIcerik />
        </div>
      )}
    </div>
  );
}

/** Mobil çekmecedeki "Cüzdan" satırı; içerik üst barın açtığı pencerede. */
export function CuzdanMenuSatiri({
  className,
  onAc,
}: {
  className: string;
  onAc: () => void;
}) {
  const { data: cuzdan } = useWallet();
  return (
    <button type="button" onClick={onAc} className={`${className} w-full`}>
      <Icon name="wallet" className="h-5 w-5" />
      <span className="flex-1 text-left">Cüzdan</span>
      <span className="font-semibold tabular-nums">{cuzdanTutari(cuzdan?.balance)}</span>
    </button>
  );
}
