import { useMemo } from "react";
import { Modal } from "@/components/ui/Modal";
import { useNavigate } from "react-router-dom";
import { Avatar } from "@/components/Avatar";
import { useBookings } from "@/hooks/useBookings";
import { useRecentlyViewed } from "@/hooks/useRecentlyViewed";
import { ROUTES } from "@/lib/routes";

// Takvimden "ders talebi oluştur" akışının ilk adımı: eğitmen seçimi.
// Öncelik: (1) ders alınan eğitmenler, (2) son görüntülenen ilan eğitmenleri,
// (3) hiçbiri istenmiyorsa arama ekranına yönlendirme.
interface NewLessonRequestModalProps {
  /** Seçilen eğitmenin id'si — ardından BookingModal o eğitmenle açılır. */
  onPick: (tutorId: number) => void;
  onClose: () => void;
  /** Bilgi amaçlı: hangi tarih için (başlıkta gösterilir). */
  dateLabel?: string | null;
}

function TutorRow({
  id,
  name,
  avatar,
  badge,
  onPick,
}: {
  id: number;
  name: string;
  avatar?: string | null;
  badge?: string;
  onPick: (id: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(id)}
      className="flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2.5 text-left transition hover:border-marka-line hover:bg-marka-soft/50 active:scale-[0.99] "
    >
      <Avatar name={name} avatar_url={avatar} size="sm" />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 ">
        {name}
      </span>
      {badge && (
        <span className="shrink-0 rounded-full bg-marka-soft px-2 py-0.5 text-[10px] font-bold text-marka-soft-fg ">
          {badge}
        </span>
      )}
      <svg
        className="h-4 w-4 shrink-0 text-slate-300 "
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

export function NewLessonRequestModal({
  onPick,
  onClose,
  dateLabel,
}: NewLessonRequestModalProps) {
  const navigate = useNavigate();
  const { data: bookings } = useBookings({ limit: 100 });
  const recent = useRecentlyViewed();

  // Ders alınan eğitmenler: rezervasyonlardan benzersiz, en yeni ilişki önde.
  const pastTutors = useMemo(() => {
    const map = new Map<
      number,
      { id: number; name: string; avatar?: string | null }
    >();
    const sorted = [...(bookings ?? [])].sort(
      (a, b) => +new Date(b.start_at) - +new Date(a.start_at)
    );
    for (const b of sorted) {
      if (!map.has(b.tutor_id)) {
        map.set(b.tutor_id, {
          id: b.tutor_id,
          name: b.tutor_name ?? "Eğitmen",
          avatar: b.tutor_avatar_url,
        });
      }
    }
    return [...map.values()];
  }, [bookings]);

  // Son görüntülenenler: ders alınanlarla çakışanları ele.
  const recentTutors = useMemo(
    () =>
      recent
        .filter((t) => !pastTutors.some((p) => p.id === t.id))
        .slice(0, 6),
    [recent, pastTutors]
  );

  const goSearch = () => {
    onClose();
    navigate(ROUTES.tutors);
  };

  const empty = pastTutors.length === 0 && recentTutors.length === 0;

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel="Yeni ders talebi"
      hideCloseButton
      panelClassName="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-100 animate-in zoom-in-95 duration-200"
    >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 ">
          <div>
            <h2 className="text-lg font-bold text-slate-900 ">
              Ders Talebi Oluştur
            </h2>
            {dateLabel && (
              <p className="text-xs text-slate-500 ">
                {dateLabel} için eğitmen seç
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 "
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

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          {pastTutors.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 ">
                Ders aldığın eğitmenler
              </p>
              {pastTutors.map((t) => (
                <TutorRow
                  key={t.id}
                  id={t.id}
                  name={t.name}
                  avatar={t.avatar}
                  onPick={onPick}
                />
              ))}
            </div>
          )}

          {recentTutors.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 ">
                Son görüntülediğin
              </p>
              {recentTutors.map((t) => (
                <TutorRow
                  key={t.id}
                  id={t.id}
                  name={t.display_name}
                  avatar={t.avatar_url}
                  onPick={onPick}
                />
              ))}
            </div>
          )}

          {empty && (
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center ">
              <p className="text-sm text-slate-500 ">
                Henüz ders aldığın ya da görüntülediğin bir eğitmen yok.
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 p-4 ">
          <button
            type="button"
            onClick={goSearch}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-marka px-4 py-3 text-sm font-bold text-marka-fg transition hover:bg-marka-hover active:scale-95"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0Z" />
            </svg>
            {empty ? "Eğitmen Ara" : "Başka bir eğitmen ara"}
          </button>
        </div>
    </Modal>
  );
}
