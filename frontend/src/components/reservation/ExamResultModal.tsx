// Deneme sınavı sonucu (net · sıra · karne · cevap anahtarı).
//
// `pages/Tickets.tsx`'ten DEĞİŞMEDEN taşındı: bilet estetiği kalktı ama
// sonuç penceresi zaten sakin bir modaldı ve ürün kararından etkilenmiyor.
import type { RegistrationOut } from "@/types";

export function ExamResultModal({ reg, onClose }: { reg: RegistrationOut; onClose: () => void }) {
  const answerKey = reg.session?.answer_key_url;
  const karne = reg.result_document_url;
  const hasSummary = reg.result_net != null || reg.result_rank != null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl "
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 "
          aria-label="Kapat"
        >
          ✕
        </button>

        <h3 className="pr-8 text-lg font-bold text-slate-900 ">Sınav Sonucun</h3>
        {reg.session?.title && (
          <p className="mt-0.5 text-sm text-slate-500 ">{reg.session.title}</p>
        )}

        {hasSummary && (
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-marka-soft p-4 text-center ">
              <div className="text-2xl font-extrabold text-marka ">
                {reg.result_net ?? "—"}
              </div>
              <div className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500 ">
                Net
              </div>
            </div>
            <div className="rounded-2xl bg-marka-soft p-4 text-center ">
              <div className="text-2xl font-extrabold text-marka ">
                {reg.result_rank ?? "—"}
              </div>
              <div className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500 ">
                Sıra
              </div>
            </div>
          </div>
        )}

        <div className="mt-5 space-y-2">
          {karne ? (
            <a
              href={karne}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-marka px-4 py-3 text-sm font-semibold text-white transition hover:bg-marka-hover"
            >
              📄 Karneyi aç
            </a>
          ) : (
            <div className="rounded-xl bg-slate-50 px-4 py-3 text-center text-sm font-medium text-slate-500 ">
              Karne henüz yüklenmedi
            </div>
          )}
          {answerKey && (
            <a
              href={answerKey}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 "
            >
              🔑 Cevap anahtarı
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
