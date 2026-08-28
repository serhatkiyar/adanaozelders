// İP-16 B6 — kart durumu rozetleri (askıda / takıldın).
//
// Ayrı bileşen olmasının sebebi test edilebilirlik: `is_leech` yanıt şemasına
// yeni eklendi ve "UI'da görünüyor" iddiasının gerçek DOM kanıtı olmalı
// (kök CLAUDE.md §B). Kart tarayıcı sayfasının tamamını RTL ile ayağa
// kaldırmak yerine bu iki rozet ve askı özeti bağımsız sınanır.

export interface SrsCardFlagsProps {
  suspended: boolean;
  isLeech: boolean;
}

/** Askı ve leech rozetleri; ikisi de yoksa hiçbir şey basmaz. */
export function SrsCardFlags({ suspended, isLeech }: SrsCardFlagsProps) {
  return (
    <>
      {suspended && (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 ">
          askıda
        </span>
      )}
      {/* Leech, askının SEBEBİNİ söyler: kart 8 kez unutulduğu için otomatik
          askıya alındı. Rozet olmadan kullanıcı kartın neden kuyruktan
          düştüğünü göremiyordu. */}
      {isLeech && (
        <span
          className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 "
          title="Bu kartı 8 kez unuttun; otomatik askıya alındı. Kartı bölmek ya da ipucu eklemek işe yarar."
        >
          takıldın
        </span>
      )}
    </>
  );
}

export interface SrsSuspendedSummaryProps {
  suspendedTotal: number;
  leechTotal: number;
  /** "N tanesinde takıldın" bağlantısı askı filtresini açar. */
  onShowSuspended: () => void;
}

/**
 * "Askıda N kart" özeti. Sayaçlar uygulanan filtreden BAĞIMSIZ gelir
 * (`GET /srs/cards` → `suspended_total`/`leech_total`); "askıda olmayan"
 * filtresiyle bakan kullanıcı da kaç kartının kuyruk dışında beklediğini
 * görür — otomatik askı sessiz kalmasın.
 */
export function SrsSuspendedSummary({
  suspendedTotal,
  leechTotal,
  onShowSuspended,
}: SrsSuspendedSummaryProps) {
  if (suspendedTotal <= 0) return null;
  return (
    <p className="mt-2 text-sm text-slate-600 ">
      Askıda {suspendedTotal} kart
      {leechTotal > 0 && (
        <>
          {" · bunlardan "}
          <button
            type="button"
            onClick={onShowSuspended}
            className="font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-800 "
          >
            {leechTotal} tanesinde takıldın
          </button>
        </>
      )}
      . Askıdaki kartlar çalışma kuyruğuna girmez.
    </p>
  );
}
