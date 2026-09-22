import { useState } from "react";
import { StudySpaceSection } from "@/components/StudySpaceSection";
import { ExamSessionsSection } from "@/components/ExamSessionsSection";
import type { LibraryDetailOut } from "@/types";

type Choice = "study" | "exam";

/**
 * Kütüphane rezervasyon sihirbazı.
 * Adım 1: rezervasyon türü seçimi (Çalışma Alanı / Deneme Sınavı).
 * Adım 2: seçilen türe ait bilgi/ödeme akışı (mevcut bölüm bileşenleri yeniden kullanılır).
 *
 * Çalışma alanı yalnızca kütüphane sunuyorsa (saatlik ücret + kapasite) seçenek olarak çıkar.
 */
export function LibraryReservationModal({
  library,
  onClose,
}: {
  library: LibraryDetailOut;
  onClose: () => void;
}) {
  const offersStudy = library.study_hourly_price != null && !!library.capacity;

  // Sadece deneme sunuluyorsa seçim adımını atlayıp doğrudan deneme akışına gir.
  const [choice, setChoice] = useState<Choice | null>(offersStudy ? null : "exam");

  const handleBack = () => setChoice(offersStudy ? null : "exam");
  const showBack = offersStudy && choice !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-8 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-3xl bg-white shadow-2xl ring-1 ring-slate-100 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Başlık */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 ">
          {showBack ? (
            <button
              onClick={handleBack}
              className="-ml-2 rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 "
              aria-label="Geri"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          ) : (
            <div className="w-9" />
          )}
          <div className="text-center">
            <h2 className="text-lg font-bold text-slate-900 ">
              {choice === "study"
                ? "Çalışma Alanı Rezervasyonu"
                : choice === "exam"
                  ? "Deneme Sınavı Rezervasyonu"
                  : "Rezervasyon Yap"}
            </h2>
            <p className="text-xs text-slate-500 ">{library.name}</p>
          </div>
          <button
            onClick={onClose}
            className="-mr-2 rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 "
            aria-label="Kapat"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Gövde */}
        <div className="p-6">
          {choice === null ? (
            <div className="space-y-3 animate-in fade-in duration-200">
              <p className="mb-1 text-sm text-slate-500 ">
                Ne için rezervasyon yapmak istersin?
              </p>
              <ChoiceCard
                title="Çalışma Alanı Rezervasyonu"
                description="Saatlik koltuk, tarih ve saat seç, online öde, QR ile giriş yap."
                onClick={() => setChoice("study")}
                icon={
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21V9.349c0-.901.405-1.755 1.106-2.318l7.5-6.044a.75.75 0 01.788 0l7.5 6.044A2.964 2.964 0 0120.25 9.35V21" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M9 21v-5.25a1.5 1.5 0 011.5-1.5h3a1.5 1.5 0 011.5 1.5V21" />
                  </svg>
                }
              />
              <ChoiceCard
                title="Deneme Sınavı Rezervasyonu"
                description="Yaklaşan deneme oturumlarına kaydol, online öde, sınav günü QR ile katıl."
                onClick={() => setChoice("exam")}
                icon={
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 3.75h3M9 8.25h6M6.75 3.75h10.5A1.5 1.5 0 0118.75 5.25v13.5A1.5 1.5 0 0117.25 20.25H6.75A1.5 1.5 0 015.25 18.75V5.25A1.5 1.5 0 016.75 3.75z" />
                  </svg>
                }
              />
            </div>
          ) : choice === "study" ? (
            <div className="animate-in slide-in-from-right-4 duration-300">
              <StudySpaceSection library={library} />
            </div>
          ) : (
            <div className="animate-in slide-in-from-right-4 duration-300">
              <ExamSessionsSection libraryId={library.id} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Tür seçim kartı (büyük, ikon + başlık + açıklama + ok). */
function ChoiceCard({
  title,
  description,
  icon,
  onClick,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-4 rounded-2xl border-2 border-slate-200 bg-white p-4 text-left transition-all hover:border-marka-mid hover:bg-marka-soft/50 active:scale-[0.99] "
    >
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-marka-soft text-marka-soft-fg transition group-hover:bg-marka-line ">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-slate-900 ">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-slate-500 ">
          {description}
        </span>
      </span>
      <svg
        className="h-5 w-5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-marka-metin "
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}
