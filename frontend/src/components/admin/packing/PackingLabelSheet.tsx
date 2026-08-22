// F30 çoklu paket etiketi — bir vardiyanın kâğıtları TEK sayfada.
//
// ## Neden var
//
// Tek tek yazdırmak gerçekçi değil: bir vardiyada onlarca kutu kapanır ve her
// biri için ayrı bir yazdırma penceresi açmak, operatörü yazıcı başında
// tutardı. `components/admin/delivery/LabelSheet.tsx` (dağıtım turu etiketi)
// bunun ÖRNEĞİDİR ama kopyası değildir ve o dosyaya dokunulmaz: orada QR
// **durak** yükü taşır (`"{stopId}:{token}"`) ve tur iptalinde geçersizleşir
// (boşluk G3). Burada basılan QR pakete aittir ve paket yaşadıkça geçerlidir.
//
// ## Kâğıt sözleşmesi (somut)
//
// * **Kâğıt**: A4 dikey (210 × 297 mm), `@page` kenar boşluğu 10 mm.
// * **Sütun**: 2 — kullanılabilir 190 mm genişlik, etiket başına ~93 mm.
// * **Satır**: 4 — etiket başına en az 62 mm yükseklik, satır arası 4 mm
//   (4 × 62 + 3 × 4 = 260 mm ≤ 277 mm kullanılabilir yükseklik).
// * **Sayfa başına 8 etiket.** Sayı buradan çıkar, tahminden değil.
// * `break-inside: avoid` her etikete uygulanır (`LABEL_PRINT_CSS`): bir etiket
//   sayfa arasında ikiye bölünürse yarım kalan QR okunamaz ve kutu kör gider.
//
// ## Hata YUTULMAZ
//
// Etiketi getirilemeyen paket kâğıttan sessizce düşmez; ekranda hangi paketin
// basılamadığı yazılır. F26'nın dersi tam olarak budur: eksik çıktı, kimsenin
// fark etmediği hatadır.
import { useEffect } from "react";
import { createPortal } from "react-dom";

import { usePackageLabels } from "@/hooks/usePacking";
import { getErrorMessage } from "@/lib/errors";

import { LABEL_PRINT_CSS, PackageLabelCard, type PackageLabelData } from "./PackageLabel";

/** Sayfa başına etiket — sözleşmenin sayısal hâli (2 sütun × 4 satır). */
export const LABELS_PER_PAGE = 8;

/**
 * Baskı yerleşimi. `@page` ve `mm` birimleri bilinçli: `px` yazıcı
 * çözünürlüğüne göre kayar, kâğıt ölçüsü ise fiziksel bir gerçektir.
 */
const SHEET_PRINT_CSS =
  "@page { size: A4 portrait; margin: 10mm; }" +
  "@media print {" +
  " .package-label-sheet { position: static !important; inset: auto !important;" +
  " overflow: visible !important; background: white !important; padding: 0 !important; }" +
  " .package-label-sheet-paper { display: grid !important;" +
  " grid-template-columns: 1fr 1fr !important; gap: 4mm !important;" +
  " margin: 0 !important; padding: 0 !important; box-shadow: none !important;" +
  " max-width: none !important; background: white !important; }" +
  " .package-label-sheet .package-label { min-height: 62mm !important; }" +
  "}";

export function PackingLabelSheet({
  packageIds,
  onClose,
}: {
  packageIds: readonly number[];
  onClose: () => void;
}) {
  useEffect(() => {
    const kapat = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", kapat);
    return () => window.removeEventListener("keydown", kapat);
  }, [onClose]);

  const sorgular = usePackageLabels(packageIds);

  const yukleniyor = sorgular.some((s) => s.isLoading);
  const basilacaklar: PackageLabelData[] = [];
  const sorunlular: { packageId: number; sebep: string }[] = [];

  sorgular.forEach((sorgu, i) => {
    const packageId = packageIds[i];
    if (sorgu.isLoading) return;
    if (sorgu.isError) {
      sorunlular.push({
        packageId,
        sebep: getErrorMessage(sorgu.error, "Etiket verisi alınamadı."),
      });
      return;
    }
    const etiket = sorgu.data;
    if (!etiket) {
      sorunlular.push({ packageId, sebep: "Sunucudan etiket verisi gelmedi." });
      return;
    }
    if (!etiket.qr_payload) {
      // Karekodsuz etiket kâğıt israfından beteri: kutunun üstünde işe yaramaz
      // bir kare durur ve kurye paketi okutamaz.
      sorunlular.push({
        packageId,
        sebep: `${etiket.code} için karekod bilgisi gelmedi; bu etiket basılmadı.`,
      });
      return;
    }
    basilacaklar.push(etiket);
  });

  const sayfaSayisi = Math.max(1, Math.ceil(basilacaklar.length / LABELS_PER_PAGE));

  return createPortal(
    <div className="package-label-sheet fixed inset-0 z-[100] overflow-auto bg-slate-100 p-0 text-slate-900">
      <style>{LABEL_PRINT_CSS + SHEET_PRINT_CSS}</style>

      <div className="package-label-noprint sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3">
        <div>
          <p className="text-sm font-semibold">
            {basilacaklar.length} etiket · {sayfaSayisi} sayfa
          </p>
          <p className="text-xs text-slate-500">
            A4 dikey, sayfa başına {LABELS_PER_PAGE} etiket (2 sütun × 4 satır).
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            disabled={basilacaklar.length === 0}
            aria-label={`${basilacaklar.length} etiketi yazdır`}
            className="rounded-lg bg-panel-accent px-4 py-1.5 text-sm font-semibold text-panel-accent-fg hover:bg-panel-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
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

      {yukleniyor && (
        <p className="package-label-noprint px-6 py-3 text-sm text-slate-600">
          Etiketler hazırlanıyor…
        </p>
      )}

      {sorunlular.length > 0 && (
        <div
          role="alert"
          className="package-label-noprint mx-6 mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
        >
          <p className="font-bold">{sorunlular.length} paketin etiketi basılamadı</p>
          <ul className="mt-1 list-disc pl-5">
            {sorunlular.map((s) => (
              <li key={s.packageId}>
                Paket #{s.packageId} — {s.sebep}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!yukleniyor && basilacaklar.length === 0 && sorunlular.length === 0 && (
        <p className="package-label-noprint px-6 py-3 text-sm text-slate-600">
          Basılacak etiket seçilmedi.
        </p>
      )}

      <div className="package-label-sheet-paper mx-auto my-6 grid max-w-3xl grid-cols-1 gap-4 rounded-xl bg-white p-8 shadow-sm sm:grid-cols-2">
        {basilacaklar.map((etiket) => (
          <PackageLabelCard key={etiket.package_id} package={etiket} />
        ))}
      </div>
    </div>,
    document.body,
  );
}
