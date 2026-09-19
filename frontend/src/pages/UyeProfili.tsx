import { useNavigate, useParams } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { TUTOR_NAV } from "@/lib/nav";
import { Avatar } from "@/components/Avatar";
import { EducationSection } from "@/components/EducationSection";
import { DUGME_SATIR_BIRINCIL, KART, KUCUK_ACIKLAMA } from "@/components/pano/stil";
import { FullScreenSpinner } from "@/components/Spinner";
import { useClientDetail } from "@/hooks/useClientProfile";
import { useBookings } from "@/hooks/useBookings";
import { formatLastSeen } from "@/lib/datetime";
import { ageFromBirthDate, gorunurCinsiyet } from "@/lib/demographics";
import { BookingStatus } from "@/types";
import { ROUTES } from "@/lib/routes";

export default function UyeProfili() {
  const { id } = useParams();
  const clientId = Number(id);
  const navigate = useNavigate();

  const { data: student, isLoading, isError } = useClientDetail(clientId);
  const { data: myBookings } = useBookings({ limit: 100 });
  const hasActiveBooking = (myBookings ?? []).some(
    (b) =>
      b.client_id === clientId &&
      (b.status === BookingStatus.PENDING ||
        b.status === BookingStatus.ACCEPTED)
  );

  if (isLoading) return <FullScreenSpinner />;

  if (isError || !student) {
    return (
      <DashboardShell title="Üye" navItems={TUTOR_NAV}>
        <div className="mx-auto max-w-2xl">
          <button
            onClick={() => navigate(-1)}
            className="text-sm font-medium text-marka-metin hover:text-marka-metin-hover "
          >
            ← Geri dön
          </button>
          <div className="mt-6 flex flex-col items-center rounded-lg border border-dashed border-slate-300 py-16 text-center ">
            <p className={KUCUK_ACIKLAMA}>Üye bulunamadı.</p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const isOnline =
    !!student.last_seen_at &&
    Date.now() - new Date(student.last_seen_at).getTime() < 120_000;
  // Backend eğitmene tam doğum tarihi döndürmez (KVKK); sunucu hesaplı yaş gelir.
  const age = student.age ?? ageFromBirthDate(student.birth_date);
  const genderLabel = gorunurCinsiyet(student.gender);

  return (
    <DashboardShell title="Üye Profili" navItems={TUTOR_NAV}>
      <div className="mx-auto max-w-2xl space-y-5 pb-12">
        <button
          onClick={() => navigate(-1)}
          className="text-sm font-medium text-marka-metin hover:text-marka-metin-hover "
        >
          ← Geri dön
        </button>

        {/* ── Header ── */}
        <section className={KART}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Avatar name={student.full_name} avatar_url={student.avatar_url} size="lg" />
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold text-slate-900 ">
                {student.full_name}
              </h1>
              {(age !== null || genderLabel) && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {age !== null && (
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 ">
                      {age} yaş
                    </span>
                  )}
                  {genderLabel && (
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 ">
                      {genderLabel}
                    </span>
                  )}
                </div>
              )}
              <p className={`mt-2 flex items-center gap-1.5 ${KUCUK_ACIKLAMA}`}>
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    isOnline ? "bg-emerald-400" : "bg-slate-300 "
                  }`}
                />
                {isOnline ? "Çevrimiçi" : formatLastSeen(student.last_seen_at)}
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 ">
                <span className="text-2xl">🎓</span>
                <div>
                  <p className="text-lg font-bold leading-none text-slate-900 ">
                    {student.completed_lessons}
                  </p>
                  <p className={`mt-0.5 ${KUCUK_ACIKLAMA}`}>
                    tamamlanan ders
                  </p>
                </div>
              </div>
              {hasActiveBooking && (
                <button
                  type="button"
                  onClick={() =>
                    navigate(ROUTES.messageWith(student.id, student.full_name))
                  }
                  className={DUGME_SATIR_BIRINCIL}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                  </svg>
                  Mesaj Gönder
                </button>
              )}
            </div>
          </div>
        </section>

        {/* ── Hakkında ── */}
        {student.about && (
          <section className={KART}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 ">
              Hakkında
            </h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600 ">
              {student.about}
            </p>
          </section>
        )}

        {/* ── Eğitim (salt-okunur; boşsa gizli) ── */}
        <EducationSection educations={student.educations} />
      </div>
    </DashboardShell>
  );
}

