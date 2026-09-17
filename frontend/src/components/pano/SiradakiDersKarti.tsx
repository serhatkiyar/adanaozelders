import { Link } from "react-router-dom";
import { Avatar } from "@/components/Avatar";
import { formatRange } from "@/lib/datetime";
import { mapsUrl } from "@/lib/lesson";
import { kalanSure, katilDurumu } from "@/lib/pano";
import { ROUTES } from "@/lib/routes";
import type { BookingOut } from "@/types";

/**
 * Panonun odağı: bitmemiş en yakın kabul edilmiş ders. Online derste
 * "Derse katıl" 15 dk kala birincil düğmeye döner; yüz yüze derste adres ve
 * harita bağlantısı gösterilir. Ders yoksa boş durum metni çizilir.
 */
export function SiradakiDersKarti({
  lesson,
  bosMetin,
  onJoinMeeting,
}: {
  lesson: BookingOut | null;
  bosMetin: string;
  onJoinMeeting: (booking: BookingOut) => void;
}) {
  if (!lesson) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center">
        <p className="text-sm font-semibold text-slate-800">Sıradaki dersin yok</p>
        <p className="mt-1 text-xs text-slate-500">{bosMetin}</p>
      </section>
    );
  }

  const ogrenci = lesson.client_name ?? `Öğrenci #${lesson.client_id}`;
  const yuzYuze = lesson.mode === "IN_PERSON";
  const durum = katilDurumu(lesson.start_at, lesson.end_at);
  const katilabilir = !yuzYuze && Boolean(lesson.meeting_room) && durum !== "kapali";

  return (
    <section
      aria-label="Sıradaki ders"
      className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Sıradaki ders
        </p>
        <span className="rounded-full bg-marka-soft px-2.5 py-0.5 text-xs font-semibold text-marka-soft-fg">
          {kalanSure(lesson.start_at)}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Avatar name={ogrenci} avatar_url={lesson.client_avatar_url} size="md" />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-slate-900">{ogrenci}</p>
          <p className="mt-0.5 text-sm text-slate-500">
            {formatRange(lesson.start_at, lesson.end_at)}
          </p>
        </div>
      </div>

      <p className="mt-3 text-sm text-slate-600">
        {yuzYuze ? (
          lesson.location ? (
            <>
              Yüz yüze ·{" "}
              <a
                href={mapsUrl(lesson.location, lesson.location_lat, lesson.location_lng)}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-marka-metin underline-offset-2 hover:underline"
              >
                {lesson.location}
              </a>
            </>
          ) : (
            "Yüz yüze · Konum henüz belirlenmedi"
          )
        ) : (
          "Online ders"
        )}
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {katilabilir && (
          <button
            type="button"
            disabled={durum !== "birincil"}
            onClick={() => onJoinMeeting(lesson)}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition sm:flex-1 ${
              durum === "birincil"
                ? "bg-marka text-marka-fg shadow-sm hover:bg-marka-hover"
                : "cursor-not-allowed border border-slate-200 bg-white text-slate-400"
            }`}
          >
            {durum === "birincil" ? "Derse katıl" : "Derse 15 dk kala açılır"}
          </button>
        )}
        <Link
          to={ROUTES.lesson(lesson.id)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-center text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:flex-1"
        >
          Ders detayı
        </Link>
      </div>
    </section>
  );
}
