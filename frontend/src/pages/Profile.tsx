import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { TutorAccountLayout } from "@/components/TutorAccountLayout";
import { EducationSection } from "@/components/EducationSection";
import { navForRole } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useMyStats, useUpdateProfile } from "@/hooks/useProfile";
import { useMyEducations } from "@/hooks/useEducations";
import { useAvatarUpload } from "@/hooks/useAvatarUpload";
import { ImageCropModal } from "@/components/ImageCropModal";
import { ageFromBirthDate, GENDER_LABEL } from "@/lib/demographics";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { Gender, ROLE_IDS } from "@/types";
import { ROUTES } from "@/lib/routes";

const ROLE_META: Record<number, { label: string }> = {
  [ROLE_IDS.ADMIN]: { label: "Yönetici" },
  [ROLE_IDS.TUTOR]: { label: "Eğitmen" },
  [ROLE_IDS.CLIENT]: { label: "Öğrenci" },
};

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 ";

export default function Profile() {
  const { data: user, isLoading } = useCurrentUser();
  const { data: stats } = useMyStats();
  const updateProfile = useUpdateProfile();
  const avatar = useAvatarUpload();

  const isTutor = user?.role_id === ROLE_IDS.TUTOR;
  const isAdmin = user?.role_id === ROLE_IDS.ADMIN;
  // Eğitim bilgisini her zaman çekeriz; görüntüleme modunda salt-okunur listeleriz.
  const educationsQuery = useMyEducations(!isAdmin);
  const educations = educationsQuery.data ?? [];

  const [isEditing, setIsEditing] = useState(false);
  const [about, setAbout] = useState("");

  const resetAbout = () => setAbout(user?.about ?? "");

  useEffect(() => {
    resetAbout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const roleNav = navForRole(user?.role_id);

  const handleSaveAbout = (e: FormEvent) => {
    e.preventDefault();
    updateProfile.mutate(
      { about: about.trim() || null },
      {
        onSuccess: () => {
          toast.success("Profilin güncellendi.");
          setIsEditing(false);
        },
        onError: (err) =>
          toast.error(getErrorMessage(err, "Güncelleme başarısız.")),
      }
    );
  };

  const role = user ? ROLE_META[user.role_id] : undefined;
  const age = user ? ageFromBirthDate(user.birth_date) : null;
  const genderLabel =
    user?.gender && user.gender !== Gender.UNSPECIFIED
      ? GENDER_LABEL[user.gender]
      : null;
  const metaLine = [age !== null ? `${age} yaşında` : null, genderLabel]
    .filter(Boolean)
    .join(" · ");

  const showEducationView = !isAdmin && !isEditing && educations.length > 0;
  const showEducationEdit = !isAdmin && isEditing;

  const body = (
    <>
      {/* ── Sayfa başlığı + tek düzenleme girişi ── */}
          <div className="mb-6 flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {isTutor ? "Hakkımda" : "Profil"}
            </h1>
            {user && !isAdmin && !isEditing && (
              <button
                type="button"
                onClick={() => {
                  resetAbout();
                  setIsEditing(true);
                }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-200 "
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
                </svg>
                Profili düzenle
              </button>
            )}
          </div>

          {isLoading || !user ? (
            <div className="h-96 animate-pulse rounded-2xl bg-slate-100 " />
          ) : (
            <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 ">
              {/* ── Kimlik başlığı (gradyan yok, sakin) ── */}
              <div className="flex items-center gap-5 px-6 py-6 sm:px-8">
                <div className="relative shrink-0">
                  {isEditing ? (
                    <label
                      className="group relative block h-20 w-20 cursor-pointer"
                      title="Profil fotoğrafını değiştir"
                    >
                      <AvatarImage user={user} />
                      <span className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 rounded-full bg-black/45 text-white opacity-0 transition group-hover:opacity-100">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
                        </svg>
                        <span className="text-[9px] font-bold uppercase tracking-wide">Değiştir</span>
                      </span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={avatar.onFileSelect}
                      />
                    </label>
                  ) : (
                    <AvatarImage user={user} />
                  )}
                  {isEditing && user.avatar_url && (
                    <button
                      type="button"
                      onClick={() => avatar.deleteAvatar.mutate()}
                      disabled={avatar.deleteAvatar.isPending}
                      title="Profil fotoğrafını kaldır"
                      className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white text-slate-500 shadow ring-1 ring-slate-200 transition hover:text-rose-600 disabled:opacity-50 "
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="truncate text-xl font-bold tracking-tight text-slate-900 ">
                      {user.full_name}
                    </h2>
                    {role && (
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 ">
                        {role.label}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-sm text-slate-500 ">
                    @{user.username} · {user.email}
                  </p>
                  {(metaLine || !isAdmin) && (
                    <p className="mt-1 text-sm text-slate-500 ">
                      {metaLine}
                      {metaLine && !isAdmin ? " · " : ""}
                      {!isAdmin && (
                        <span>
                          🎓 {stats?.completed_lessons ?? 0}{" "}
                          {isTutor ? "verdiğin tamamlanan ders" : "tamamlanan ders"}
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </div>

              <Divider />

              {/* ── Hakkımda ── */}
              <section className="px-6 py-6 sm:px-8">
                <h3 className="text-lg font-bold text-slate-900 ">
                  Hakkımda
                </h3>

                {isEditing ? (
                  <form onSubmit={handleSaveAbout} className="mt-4">
                    <textarea
                      rows={4}
                      maxLength={2000}
                      value={about}
                      onChange={(e) => setAbout(e.target.value)}
                      className={inputCls}
                      placeholder="Kendini kısaca tanıt…"
                    />
                    <p className="mt-1 text-right text-xs text-slate-400">
                      {about.length} / 2000
                    </p>
                  </form>
                ) : user.about ? (
                  <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600 ">
                    {user.about}
                  </p>
                ) : (
                  <p className="mt-3 text-sm italic text-slate-400 ">
                    Henüz bir şey eklenmedi.
                  </p>
                )}
              </section>

              {/* ── Eğitim ── */}
              {showEducationView && (
                <>
                  <Divider />
                  <section className="px-6 py-6 sm:px-8">
                    <EducationSection bare educations={educations} />
                  </section>
                </>
              )}
              {showEducationEdit && (
                <>
                  <Divider />
                  <section className="px-6 py-6 sm:px-8">
                    <EducationSection editable bare withDocument={isTutor} />
                  </section>
                </>
              )}

              <Divider />

              {isEditing ? (
                /* ── Düzenleme aksiyon çubuğu ── */
                <div className="flex flex-wrap items-center gap-3 px-6 py-5 sm:px-8">
                  <button
                    type="button"
                    onClick={handleSaveAbout}
                    disabled={updateProfile.isPending}
                    className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 "
                  >
                    {updateProfile.isPending ? "Kaydediliyor…" : "Kaydet"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetAbout();
                      setIsEditing(false);
                    }}
                    className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 underline underline-offset-2 transition hover:text-slate-700 "
                  >
                    Bitti
                  </button>
                </div>
              ) : (
                /* ── Hesap & güvenlik kısayolu (mütevazı satır) ── */
                <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-5 sm:px-8">
                  <p className="text-sm text-slate-500 ">
                    Ad, kullanıcı adı, doğum tarihi, cinsiyet, şifre ve ödeme bilgileri{" "}
                    <span className="font-medium text-slate-700 ">
                      Hesap Ayarları
                    </span>
                    'nda.
                  </p>
                  <Link
                    to={ROUTES.settings}
                    className="shrink-0 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 "
                  >
                    Hesap Ayarları
                  </Link>
                </div>
              )}
            </div>
          )}
    </>
  );

  return (
    <>
      {isTutor ? (
        <TutorAccountLayout active="about" title="Hesabım">
          <div className="max-w-2xl">{body}</div>
        </TutorAccountLayout>
      ) : (
        <DashboardShell title="Profil" navItems={roleNav}>
          <div className="mx-auto max-w-2xl px-1 pb-16 pt-2 sm:px-2">{body}</div>
        </DashboardShell>
      )}

      {avatar.cropImageSrc && (
        <ImageCropModal
          imageSrc={avatar.cropImageSrc}
          onCropComplete={avatar.onCropComplete}
          onClose={avatar.onCropClose}
          isUploading={avatar.isUploading}
        />
      )}
    </>
  );
}

function AvatarImage({
  user,
}: {
  user: { avatar_url?: string | null; full_name: string; first_name: string };
}) {
  if (user.avatar_url) {
    return (
      <img
        src={user.avatar_url}
        alt={user.full_name}
        className="h-20 w-20 rounded-full object-cover ring-1 ring-slate-200 "
      />
    );
  }
  return (
    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-100 text-2xl font-bold text-slate-500 ring-1 ring-slate-200 ">
      {user.first_name.charAt(0).toUpperCase()}
    </div>
  );
}

function Divider() {
  return <div className="border-t border-slate-100 " />;
}
