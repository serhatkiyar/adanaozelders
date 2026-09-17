import { Link } from "react-router-dom";
import { Avatar } from "@/components/Avatar";
import {
  ACIKLAMA,
  DUGME_BIRINCIL,
  DUGME_IKINCIL,
  ETIKET,
  KART,
  KUCUK_ACIKLAMA,
} from "@/components/pano/stil";
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
      <section className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
        <p className={ETIKET}>Sıradaki dersin yok</p>
        <p className={`mt-1 ${ACIKLAMA}`}>{bosMetin}</p>
      </section>
    );
  }

  const ogrenci = lesson.client_name ?? `Öğrenci #${lesson.client_id}`;
  const yuzYuze = lesson.mode === "IN_PERSON";
  const durum = katilDurumu(lesson.start_at, lesson.end_at);
  const katilabilir = !yuzYuze && Boolean(lesson.meeting_room) && durum !== "kapali";

  return (
    <section aria-label="Sıradaki ders" className={KART}>
      <div className="flex items-center justify-between gap-3">
        <p className={KUCUK_ACIKLAMA}>Sıradaki ders</p>
        <span className="rounded-full bg-marka-soft px-3 py-1 text-sm font-semibold text-marka-soft-fg">
          {kalanSure(lesson.start_at)}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <Avatar name={ogrenci} avatar_url={lesson.client_avatar_url} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-xl font-semibold leading-6 text-slate-900">{ogrenci}</p>
          <p className={`mt-1 ${ACIKLAMA}`}>{formatRange(lesson.start_at, lesson.end_at)}</p>
        </div>
      </div>

      <p className={`mt-4 ${ACIKLAMA}`}>
        {yuzYuze ? (
          lesson.location ? (
            <>
              Yüz yüze ·{" "}
              <a
                href={mapsUrl(lesson.location, lesson.location_lat, lesson.location_lng)}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-slate-900 underline decoration-slate-300 underline-offset-4 hover:decoration-slate-900"
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

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        {katilabilir && (
          <button
            type="button"
            disabled={durum !== "birincil"}
            onClick={() => onJoinMeeting(lesson)}
            className={`sm:flex-1 ${durum === "birincil" ? DUGME_BIRINCIL : DUGME_IKINCIL}`}
          >
            {durum === "birincil" ? "Derse katıl" : "Derse 15 dk kala açılır"}
          </button>
        )}
        <Link to={ROUTES.lesson(lesson.id)} className={`sm:flex-1 ${DUGME_IKINCIL}`}>
          Ders detayı
        </Link>
      </div>
    </section>
  );
}
