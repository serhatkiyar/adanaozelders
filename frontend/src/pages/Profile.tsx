import { FormEvent, ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { EducationSection } from "@/components/EducationSection";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useMyStats, useUpdateProfile } from "@/hooks/useProfile";
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

const GENDERS = [
  { value: Gender.MALE, label: "Erkek" },
  { value: Gender.FEMALE, label: "Kadın" },
  { value: Gender.UNSPECIFIED, label: "Belirtmek istemiyorum" },
] as const;

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition duration-150 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500 dark:focus:border-indigo-500 dark:focus:ring-indigo-900/30";

const cancelBtn =
  "rounded-xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700";

const saveBtn =
  "rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50";

const labelCls =
  "text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500";

const fieldLabelCls =
  "mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400";

function SectionCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-white px-6 py-5 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-400 dark:text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800 dark:text-slate-100">
        {value}
      </dd>
    </div>
  );
}

export default function Profile() {
  const { data: user, isLoading } = useCurrentUser();
  const { data: stats } = useMyStats();
  const updateProfile = useUpdateProfile();
  const avatar = useAvatarUpload();

  const [isEditing, setIsEditing] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [about, setAbout] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState<Gender | "">("");

  const resetForm = () => {
    if (!user) return;
    setFirstName(user.first_name);
    setLastName(user.last_name);
    setUsername(user.username);
    setAbout(user.about ?? "");
    setBirthDate(user.birth_date ?? "");
    setGender(user.gender ?? "");
  };

  useEffect(() => {
    resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const roleNav =
    user?.role_id === ROLE_IDS.CLIENT
      ? STUDENT_NAV
      : user?.role_id === ROLE_IDS.TUTOR
        ? TUTOR_NAV
        : undefined;

  const todayStr = new Date().toISOString().slice(0, 10);

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !username.trim()) {
      toast.error("Ad, soyad ve kullanıcı adı boş olamaz.");
      return;
    }
    updateProfile.mutate(
      {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        username: username.trim(),
        about: about.trim() || null,
        birth_date: birthDate || null,
        gender: gender || null,
      },
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

  return (
    <>
    <DashboardShell title="Profil" navItems={roleNav}>
      <div className="mx-auto max-w-xl space-y-4 pb-12">
        {isLoading || !user ? (
          <>
            <div className="h-40 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
            <div className="h-28 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
          </>
        ) : (
          <>
            {/* ── Hero ── */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-700 p-7 text-white shadow-xl shadow-indigo-200/40 dark:shadow-indigo-900/40">
              <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/[0.06]" />
              <div className="pointer-events-none absolute -bottom-6 right-10 h-28 w-28 rounded-full bg-white/[0.04]" />
              <div className="relative flex items-center gap-5">
                {/* Avatara tıkla → kırp & yükle (hover'da kamera rozeti). */}
                <label
                  className="group relative h-16 w-16 shrink-0 cursor-pointer"
                  title="Profil fotoğrafını değiştir"
                >
                  {user.avatar_url ? (
                    <img
                      src={user.avatar_url}
                      alt={user.full_name}
                      className="h-16 w-16 rounded-2xl object-cover shadow-inner ring-1 ring-white/30"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 text-2xl font-bold shadow-inner backdrop-blur-sm ring-1 ring-white/30">
                      {user.first_name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 rounded-2xl bg-black/45 text-white opacity-0 backdrop-blur-[1px] transition group-hover:opacity-100">
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
                {user.avatar_url && (
                  <button
                    type="button"
                    onClick={() => avatar.deleteAvatar.mutate()}
                    disabled={avatar.deleteAvatar.isPending}
                    title="Profil fotoğrafını kaldır"
                    className="absolute left-[3.25rem] top-0 flex h-6 w-6 items-center justify-center rounded-full bg-white text-slate-500 shadow ring-1 ring-slate-200 transition hover:text-red-600 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h1 className="truncate text-xl font-bold leading-tight tracking-tight">
                      {user.full_name}
                    </h1>
                    {role && (
                      <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold backdrop-blur-sm ring-1 ring-white/20">
                        {role.label}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-sm text-indigo-200">
                    @{user.username}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-indigo-300/80">
                    {user.email}
                  </p>
                </div>
              </div>

              {/* Completed-lessons stat */}
              {user.role_id !== ROLE_IDS.ADMIN && (
                <div className="relative mt-5 flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3 ring-1 ring-white/15 backdrop-blur-sm">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 text-lg">
                    🎓
                  </span>
                  <div>
                    <p className="text-lg font-bold leading-none">
                      {stats?.completed_lessons ?? "—"}
                    </p>
                    <p className="mt-0.5 text-xs text-indigo-200">
                      {user.role_id === ROLE_IDS.TUTOR
                        ? "verdiğin tamamlanan ders"
                        : "tamamlanan dersin"}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* ── Profil Bilgileri (tek düzenle butonu) ── */}
            <SectionCard>
              <div className="flex items-center justify-between">
                <span className={labelCls}>Profil Bilgileri</span>
                {!isEditing && (
                  <button
                    type="button"
                    onClick={() => {
                      resetForm();
                      setIsEditing(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
                    </svg>
                    Profili Düzenle
                  </button>
                )}
              </div>

              <div className="mt-4">
                {isEditing ? (
                  <form onSubmit={handleSave} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={fieldLabelCls}>Ad</label>
                        <input
                          type="text"
                          required
                          maxLength={75}
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          className={inputCls}
                          autoFocus
                        />
                      </div>
                      <div>
                        <label className={fieldLabelCls}>Soyad</label>
                        <input
                          type="text"
                          required
                          maxLength={75}
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          className={inputCls}
                        />
                      </div>
                    </div>

                    <div>
                      <label className={fieldLabelCls}>Kullanıcı Adı</label>
                      <input
                        type="text"
                        required
                        minLength={3}
                        maxLength={50}
                        pattern="[a-zA-Z0-9_]+"
                        title="Yalnızca harf, rakam ve alt çizgi (_)"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className={inputCls}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={fieldLabelCls}>Doğum Tarihi</label>
                        <input
                          type="date"
                          max={todayStr}
                          value={birthDate}
                          onChange={(e) => setBirthDate(e.target.value)}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className={fieldLabelCls}>Cinsiyet</label>
                        <select
                          value={gender}
                          onChange={(e) => setGender(e.target.value as Gender | "")}
                          className={inputCls}
                        >
                          <option value="">Belirtilmemiş</option>
                          {GENDERS.map((g) => (
                            <option key={g.value} value={g.value}>
                              {g.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className={fieldLabelCls}>Hakkımda</label>
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
                    </div>

                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          resetForm();
                          setIsEditing(false);
                        }}
                        className={cancelBtn}
                      >
                        İptal
                      </button>
                      <button
                        type="submit"
                        disabled={updateProfile.isPending}
                        className={saveBtn}
                      >
                        {updateProfile.isPending ? "Kaydediliyor…" : "Kaydet"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-4">
                    <dl className="space-y-2.5 text-sm">
                      <Row label="Ad Soyad" value={user.full_name} />
                      <Row label="Kullanıcı Adı" value={`@${user.username}`} />
                      <Row
                        label="Yaş"
                        value={
                          age !== null ? (
                            `${age}`
                          ) : (
                            <span className="italic text-slate-400">Belirtilmemiş</span>
                          )
                        }
                      />
                      <Row
                        label="Cinsiyet"
                        value={
                          genderLabel ?? (
                            <span className="italic text-slate-400">Belirtilmemiş</span>
                          )
                        }
                      />
                    </dl>

                    <div className="border-t border-slate-100 pt-3 dark:border-slate-700">
                      <p className="mb-1 text-xs text-slate-400 dark:text-slate-500">
                        Hakkımda
                      </p>
                      {user.about ? (
                        <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                          {user.about}
                        </p>
                      ) : (
                        <p className="text-sm italic text-slate-400 dark:text-slate-500">
                          Henüz bir şey eklenmedi.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </SectionCard>

            {/* ── Eğitim (öğrenci & öğretmen; opsiyonel, LinkedIn tarzı) ── */}
            {user.role_id !== ROLE_IDS.ADMIN && (
              <EducationSection
                editable
                withDocument={user.role_id === ROLE_IDS.TUTOR}
              />
            )}

            {/* ── Güvenlik kısa yolu ── */}
            <div className="flex items-center justify-between rounded-2xl bg-white px-6 py-4 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
              <div>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  Şifre ve güvenlik
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Şifreni Hesap Ayarları'ndan değiştirebilirsin.
                </p>
              </div>
              <Link
                to={ROUTES.settings}
                className="shrink-0 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Hesap Ayarları
              </Link>
            </div>
          </>
        )}
      </div>
    </DashboardShell>

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
