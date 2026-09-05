import { FormEvent, ReactNode, useEffect, useState, useId } from "react";
import { useMutation } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { DashboardShell } from "@/components/DashboardShell";
import { AddressSection } from "@/components/AddressSection";
import { PayoutSection } from "@/components/PayoutSection";
import { LibraryPayoutForm } from "@/components/LibraryPayoutForm";
import { PersonalizePanel } from "@/components/PersonalizeModal";
import { KISISELLESTIRME_ACIK } from "@/lib/ozellikBayraklari";
import { navForRole } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  useChangePassword,
  useDeleteMyAccount,
  useDeletionEligibility,
  useDownloadMyData,
  useMyNameChangeRequests,
  useUpdateProfile,
} from "@/hooks/useProfile";
import { useOperatorMe } from "@/hooks/useLibraryExams";
import { resendEmailVerification } from "@/api/auth";
import { GENDER_LABEL } from "@/lib/demographics";
import { formatDate } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { alisverisYapabilir } from "@/lib/roles";
import { Gender, ROLE_IDS } from "@/types";

type CategoryKey = "personal" | "security" | "payments" | "appearance" | "addresses";

import { PhoneEditor } from "@/components/PhoneEditor";

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 ";

const fieldLabelCls =
  "mb-1.5 block text-xs font-medium text-slate-500 ";

const GENDERS = [
  { value: Gender.MALE, label: "Erkek" },
  { value: Gender.FEMALE, label: "Kadın" },
  { value: Gender.UNSPECIFIED, label: "Belirtmek istemiyorum" },
] as const;

// ── Kategori ikonları (Airbnb stroke ikon dili) ──
function PersonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="currentColor" aria-hidden>
      <path d="m16 5c3.866 0 7 3.134 7 7 0 2.329-1.137 4.392-2.886 5.664 4.86 1.62 8.445 6.034 8.848 11.336h-2.007c-.445-4.939-4.155-8.937-8.955-9.819v-2.598c1.766-.772 3-2.534 3-4.584 0-2.761-2.239-5-5-5s-5 2.239-5 5c0 2.05 1.234 3.813 3 4.584v2.597c-4.8.882-8.511 4.88-8.956 9.82h-2.007c.403-5.303 3.988-9.716 8.85-11.336-1.75-1.273-2.887-3.336-2.887-5.664 0-3.866 3.134-7 7-7z" />
    </svg>
  );
}
function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="currentColor" aria-hidden>
      <path d="m16 .8.56.37C20.4 3.73 24.2 5 28 5h1v12.5C29 25.57 23.21 31 16 31S3 25.57 3 17.5V5h1c3.8 0 7.6-1.27 11.45-3.83zm-1 3a22.2 22.2 0 0 1-9.65 3.15L5 6.97V17.5c0 6.56 4.35 11 10 11.46zm2 0v25.16c5.65-.47 10-4.9 10-11.46V6.97l-.35-.02A22.2 22.2 0 0 1 17 3.8z" />
    </svg>
  );
}
function PinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 3c-4.97 0-9 3.85-9 8.6 0 5.74 6.5 13.4 8.27 15.4a1 1 0 0 0 1.46 0C18.5 25 25 17.34 25 11.6 25 6.85 20.97 3 16 3Z" />
      <circle cx="16" cy="11.5" r="3" />
    </svg>
  );
}

function WalletIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 9a2 2 0 0 1 2-2h17a2 2 0 0 1 2 2v2M4 9v14a2 2 0 0 0 2 2h20a2 2 0 0 0 2-2v-4M4 9v2m24 8h-6a3 3 0 0 1 0-6h6a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1Z" />
    </svg>
  );
}
function SlidersIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9h12M24 9h2M6 16h2M14 16h12M6 23h8M20 23h6" />
      <circle cx="21" cy="9" r="2.4" />
      <circle cx="11" cy="16" r="2.4" />
      <circle cx="17" cy="23" r="2.4" />
    </svg>
  );
}

interface CategoryDef {
  key: CategoryKey;
  label: string;
  icon: (p: { className?: string }) => ReactNode;
}

export default function Settings() {
  const { data: user, isLoading } = useCurrentUser();
  const [active, setActive] = useState<CategoryKey>("personal");

  const roleNav = navForRole(user?.role_id);

  const showPayments =
    user?.role_id === ROLE_IDS.TUTOR ||
    user?.role_id === ROLE_IDS.LIBRARY_OPERATOR;

  const categories: CategoryDef[] = [
    { key: "personal", label: "Kişisel bilgiler", icon: PersonIcon },
    { key: "security", label: "Oturum açma ve güvenlik", icon: ShieldIcon },
    ...(showPayments
      ? [{ key: "payments" as const, label: "Ödeme bilgileri", icon: WalletIcon }]
      : []),
    // Donduruldu (bkz. lib/ozellikBayraklari.ts). Bayrak `true` olunca sekme
    // ve altındaki panel olduğu gibi geri gelir.
    ...(KISISELLESTIRME_ACIK
      ? [
          {
            key: "appearance" as const,
            label: "Görünüm ve tercihler",
            icon: SlidersIcon,
          },
        ]
      : []),
    ...(alisverisYapabilir(user?.role_id)
      ? [{ key: "addresses" as const, label: "Adreslerim", icon: PinIcon }]
      : []),
  ];

  // Rol değişince geçersiz kategoride kalmayı önle
  useEffect(() => {
    if (!user) return;
    if (active === "addresses" && !alisverisYapabilir(user.role_id)) {
      setActive("personal");
    } else if (active === "payments" && !showPayments) {
      setActive("personal");
    }
  }, [active, user, showPayments]);

  return (
    <DashboardShell title="Hesap Ayarları" navItems={roleNav}>
      <div className="mx-auto max-w-5xl px-1 pb-16 pt-2 sm:px-2">
        <h1 className="mb-6 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Hesap ayarları
        </h1>

        {isLoading || !user ? (
          <div className="grid gap-8 md:grid-cols-[16rem_1fr]">
            <div className="h-72 animate-pulse rounded-2xl bg-slate-100 " />
            <div className="h-96 animate-pulse rounded-2xl bg-slate-100 " />
          </div>
        ) : (
          <div className="grid gap-8 md:grid-cols-[16rem_1fr]">
            {/* ── Sol kategori rayı ── */}
            <nav
              aria-label="Hesap ayarları kategorileri"
              className="flex gap-2 overflow-x-auto pb-1 md:sticky md:top-24 md:h-fit md:flex-col md:overflow-visible md:pb-0"
            >
              {categories.map((c) => {
                const isActive = c.key === active;
                return (
                  <button
                    key={c.key}
                    type="button"
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => setActive(c.key)}
                    className={`flex shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition md:w-full ${
                      isActive
                        ? "bg-slate-100 text-slate-900 "
                        : "text-slate-600 hover:bg-slate-50 "
                    }`}
                  >
                    <c.icon className="h-6 w-6 shrink-0" />
                    {c.label}
                  </button>
                );
              })}
            </nav>

            {/* ── Sağ içerik ── */}
            <div className="min-w-0">
              {active === "personal" && <PersonalSection />}
              {active === "security" && <SecuritySection />}
              {active === "payments" && showPayments && <PaymentsSection />}
              {active === "appearance" && KISISELLESTIRME_ACIK && (
                <section>
                  <h2 className="mb-1 text-xl font-bold text-slate-900 ">
                    Görünüm ve tercihler
                  </h2>
                  <p className="mb-5 text-sm text-slate-500 ">
                    Üst bar widget'ı, kısayol düzeni ve keşif tercihlerini buradan ayarla.
                  </p>
                  <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 sm:p-6">
                    <PersonalizePanel navItems={roleNav} roleId={user.role_id} />
                  </div>
                </section>
              )}
              {active === "addresses" && alisverisYapabilir(user.role_id) && (
                <section>
                  <h2 className="mb-1 text-xl font-bold text-slate-900 ">
                    Adreslerim
                  </h2>
                  <p className="mb-5 text-sm text-slate-500 ">
                    Yüz yüze derslerde kullanılmak üzere kayıtlı konumların.
                  </p>
                  <AddressSection />
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

// ── Ortak satır kabuğu (başlık + değer + Düzenle/Ekle, açılır editör) ──
function SettingRow({
  title,
  value,
  empty,
  actionLabel,
  editable = true,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  value?: ReactNode;
  empty?: boolean;
  actionLabel?: string;
  editable?: boolean;
  isOpen?: boolean;
  onToggle?: () => void;
  children?: ReactNode;
}) {
  const label = actionLabel ?? (isOpen ? "İptal" : empty ? "Ekle" : "Düzenle");
  return (
    <div className="border-b border-slate-100 py-5 last:border-b-0 ">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-medium text-slate-900 ">
            {title}
          </h3>
          {!isOpen && (
            <div
              className={`mt-1 text-sm ${
                empty
                  ? "text-slate-400 "
                  : "text-slate-600 "
              }`}
            >
              {value}
            </div>
          )}
        </div>
        {editable && (
          <button
            type="button"
            onClick={onToggle}
            className="shrink-0 rounded-lg text-sm font-semibold text-slate-900 underline decoration-1 underline-offset-2 transition hover:text-slate-600 "
          >
            {label}
          </button>
        )}
      </div>
      {isOpen && <div className="mt-4">{children}</div>}
    </div>
  );
}

function EditActions({
  saving,
  disabled,
  onCancel,
}: {
  saving: boolean;
  disabled?: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="mt-4 flex items-center gap-3">
      <button
        type="submit"
        disabled={saving || disabled}
        className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 "
      >
        {saving ? "Kaydediliyor…" : "Kaydet"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 underline underline-offset-2 transition hover:text-slate-700 "
      >
        İptal
      </button>
    </div>
  );
}

// Telefon ekle/doğrula — 2 adımlı (numara → SMS kodu). Geliştirmede kod backend
// loglarında görünür (SMS_PROVIDER=console).
// İkinci+ değişiklik kilidi / onay-bekliyor bilgilendirme kutuları.
function LockedChangeNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700 ">
      {children}
    </div>
  );
}

function PendingChangeNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 rounded-xl bg-indigo-50 px-3 py-2 text-xs leading-relaxed text-indigo-700 ">
      {children}
    </div>
  );
}

// ── Kişisel bilgiler ──
function PersonalSection() {
  const uid = useId();
  const { data: user } = useCurrentUser();
  const updateProfile = useUpdateProfile();
  const { data: nameRequests } = useMyNameChangeRequests();
  const [open, setOpen] = useState<string | null>(null);

  // Satır formları
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  // İkinci+ değişiklik için zorunlu gerekçe.
  const [nameReason, setNameReason] = useState("");

  // Bir sonraki değişimin onay gerektirip gerektirmediğini backend bildirir
  // (role/duruma göre: onaylı eğitmen + operatör her zaman onaya; diğerleri ilk
  // değişim serbest). Eski sayaç sezgisi yerine bu bayrağı kullanırız.
  const nameLocked = user?.name_change_locked ?? (user?.name_change_count ?? 0) >= 1;
  // "Ücretsiz hakkını kullandın" mesajı yalnız sayaç-tabanlı kilitte doğru; onaylı
  // eğitmen/operatör hiç serbest hak almadı, onlara farklı metin gösteririz.
  const nameLockByCount = (user?.name_change_count ?? 0) >= 1;
  const pendingName = nameRequests?.find(
    (r) => r.kind === "NAME" && r.status === "PENDING"
  );

  const resend = useMutation({
    mutationFn: resendEmailVerification,
    onSuccess: (res) =>
      toast.success(res.detail ?? "Doğrulama bağlantısı e-postana gönderildi."),
    onError: () => toast.error("Bağlantı gönderilemedi. Biraz sonra dene."),
  });

  if (!user) return null;

  const openRow = (key: string) => {
    setFirstName(user.first_name);
    setLastName(user.last_name);
    setBirthDate(user.birth_date ?? "");
    setGender(user.gender ?? "");
    setNameReason("");
    setOpen((o) => (o === key ? null : key));
  };

  const save = (payload: Parameters<typeof updateProfile.mutate>[0], onOk?: () => void) => {
    updateProfile.mutate(payload, {
      onSuccess: (updated) => {
        // Onaya gönderildiyse farklı mesaj göster (alan henüz değişmedi).
        if (updated.pending_name_change) {
          toast.success("Talebin admin onayına gönderildi.");
        } else {
          toast.success("Bilgilerin güncellendi.");
        }
        setOpen(null);
        onOk?.();
      },
      onError: (err) => toast.error(getErrorMessage(err, "Güncelleme başarısız.")),
    });
  };

  const todayStr = new Date().toISOString().slice(0, 10);
  const genderLabel =
    user.gender && user.gender !== Gender.UNSPECIFIED ? GENDER_LABEL[user.gender] : null;

  return (
    <section>
      <h2 className="mb-1 text-xl font-bold text-slate-900 ">
        Kişisel bilgiler
      </h2>
      <p className="mb-3 text-sm text-slate-500 ">
        Hesabına ait temel bilgiler. Profil fotoğrafı, hakkımda ve eğitim
        bilgilerini Profil sayfandan düzenleyebilirsin.
      </p>

      <div className="rounded-2xl bg-white px-5 shadow-sm ring-1 ring-slate-100 sm:px-6">
        {/* Ad Soyad */}
        <SettingRow
          title="Yasal ad"
          value={user.full_name}
          isOpen={open === "name"}
          onToggle={() => openRow("name")}
        >
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (!firstName.trim() || !lastName.trim()) {
                toast.error("Ad ve soyad boş olamaz.");
                return;
              }
              if (nameLocked && !nameReason.trim()) {
                toast.error("Lütfen değişiklik için bir gerekçe yaz.");
                return;
              }
              save({
                first_name: firstName.trim(),
                last_name: lastName.trim(),
                reason: nameLocked ? nameReason.trim() : undefined,
              });
            }}
          >
            {pendingName ? (
              <PendingChangeNote>
                Yeni adın ({pendingName.new_first_name} {pendingName.new_last_name})
                admin onayı bekliyor.
              </PendingChangeNote>
            ) : (
              nameLocked && (
                <LockedChangeNote>
                  {nameLockByCount
                    ? "Ücretsiz ad değişikliği hakkını kullandın. Bu değişiklik admin onayından sonra geçerli olacak; lütfen bir gerekçe yaz."
                    : "Hesabın doğrulanmış olduğundan ad-soyad değişikliği admin onayından sonra geçerli olur; lütfen bir gerekçe yaz."}
                </LockedChangeNote>
              )
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${uid}-ad`} className={fieldLabelCls}>Ad</label>
                <input id={`${uid}-ad`}
                  className={inputCls}
                  value={firstName}
                  maxLength={75}
                  autoFocus
                  disabled={!!pendingName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor={`${uid}-soyad`} className={fieldLabelCls}>Soyad</label>
                <input id={`${uid}-soyad`}
                  className={inputCls}
                  value={lastName}
                  maxLength={75}
                  disabled={!!pendingName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
            {nameLocked && !pendingName && (
              <div className="mt-3">
                <label htmlFor={`${uid}-degisiklik-gerekcesi`} className={fieldLabelCls}>Değişiklik gerekçesi</label>
                <textarea id={`${uid}-degisiklik-gerekcesi`}
                  className={inputCls}
                  rows={2}
                  maxLength={500}
                  value={nameReason}
                  placeholder="Örn. evlilik nedeniyle soyadı değişikliği, yazım hatası düzeltme…"
                  onChange={(e) => setNameReason(e.target.value)}
                />
              </div>
            )}
            {!pendingName && (
              <EditActions saving={updateProfile.isPending} onCancel={() => setOpen(null)} />
            )}
          </form>
        </SettingRow>


        {/* E-posta (salt-okunur + doğrulama) */}
        <SettingRow
          title="E-posta adresi"
          editable={false}
          value={
            <span className="flex flex-wrap items-center gap-2">
              {user.email}
              {user.email_verified ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ">
                  Doğrulandı
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => resend.mutate()}
                  disabled={resend.isPending}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-60 "
                >
                  {resend.isPending ? "Gönderiliyor…" : "Doğrulanmadı · yeniden gönder"}
                </button>
              )}
            </span>
          }
        />

        {/* Telefon (SMS doğrulama — kritik işlemler için zorunlu) */}
        <SettingRow
          title="Telefon"
          empty={!user.phone}
          actionLabel={
            open === "phone"
              ? "İptal"
              : user.phone_verified
                ? "Düzenle"
                : user.phone
                  ? "Doğrula"
                  : "Ekle"
          }
          isOpen={open === "phone"}
          onToggle={() => setOpen((o) => (o === "phone" ? null : "phone"))}
          value={
            user.phone ? (
              <span className="flex flex-wrap items-center gap-2">
                {user.phone}
                {user.phone_verified ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ">
                    Doğrulandı
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 ">
                    Doğrulanmadı
                  </span>
                )}
              </span>
            ) : (
              "Rezervasyon, ödeme ve mesajlaşma için gerekli"
            )
          }
        >
          <PhoneEditor
            initialPhone={user.phone ?? ""}
            onDone={() => setOpen(null)}
          />
        </SettingRow>

        {/* Doğum tarihi */}
        <SettingRow
          title="Doğum tarihi"
          value={user.birth_date ? formatDate(user.birth_date) : "Yok"}
          empty={!user.birth_date}
          isOpen={open === "birth"}
          onToggle={() => openRow("birth")}
        >
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              save({ birth_date: birthDate || null });
            }}
          >
            <label htmlFor={`${uid}-dogum-tarihi`} className={fieldLabelCls}>Doğum tarihi</label>
            <input id={`${uid}-dogum-tarihi`}
              type="date"
              max={todayStr}
              className={inputCls}
              value={birthDate}
              autoFocus
              onChange={(e) => setBirthDate(e.target.value)}
            />
            <EditActions saving={updateProfile.isPending} onCancel={() => setOpen(null)} />
          </form>
        </SettingRow>

        {/* Cinsiyet */}
        <SettingRow
          title="Cinsiyet"
          value={genderLabel ?? "Belirtilmemiş"}
          empty={!genderLabel}
          isOpen={open === "gender"}
          onToggle={() => openRow("gender")}
        >
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              save({ gender: gender || null });
            }}
          >
            <label htmlFor={`${uid}-cinsiyet`} className={fieldLabelCls}>Cinsiyet</label>
            <select id={`${uid}-cinsiyet`}
              className={inputCls}
              value={gender}
              autoFocus
              onChange={(e) => setGender(e.target.value as Gender | "")}
            >
              <option value="">Belirtilmemiş</option>
              {GENDERS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
            <EditActions saving={updateProfile.isPending} onCancel={() => setOpen(null)} />
          </form>
        </SettingRow>
      </div>
    </section>
  );
}

// ── Ödeme bilgileri ──
function PaymentsSection() {
  const { data: user } = useCurrentUser();
  if (!user) return null;
  return (
    <section>
      <h2 className="mb-1 text-xl font-bold text-slate-900 ">
        Ödeme bilgileri
      </h2>
      <p className="mb-5 text-sm text-slate-500 ">
        Kazançların iyzico üzerinden doğrudan IBAN'ına yatar; platformda para
        tutulmaz. Tutarlar ve işlem dökümü <strong>Bakiyem</strong> sayfasında.
      </p>
      {user.role_id === ROLE_IDS.TUTOR ? <PayoutSection /> : <OperatorPayout />}
    </section>
  );
}

function OperatorPayout() {
  const { data: op, isLoading } = useOperatorMe();
  if (isLoading) {
    return <div className="h-40 animate-pulse rounded-2xl bg-slate-100 " />;
  }
  if (!op?.library_id) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 ">
        Hesabına bağlı bir kütüphane bulunamadı.
      </div>
    );
  }
  return (
    <div className="rounded-2xl bg-white px-6 py-5 shadow-sm ring-1 ring-slate-100 ">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 ">
        Kütüphane ödeme hesabı
      </p>
      <LibraryPayoutForm libraryId={op.library_id} />
    </div>
  );
}

// ── Oturum açma ve güvenlik ──
function SecuritySection() {
  const uid = useId();
  const { data: user } = useCurrentUser();
  const changePassword = useChangePassword();
  const [open, setOpen] = useState<string | null>(null);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const resend = useMutation({
    mutationFn: resendEmailVerification,
    onSuccess: (res) =>
      toast.success(res.detail ?? "Doğrulama bağlantısı e-postana gönderildi."),
    onError: () => toast.error("Bağlantı gönderilemedi. Biraz sonra dene."),
  });

  if (!user) return null;

  const pwMismatch = next.length > 0 && confirm.length > 0 && next !== confirm;

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    if (next.length < 8) {
      toast.error("Yeni şifre en az 8 karakter olmalı.");
      return;
    }
    if (next !== confirm) {
      toast.error("Yeni şifreler eşleşmiyor.");
      return;
    }
    changePassword.mutate(
      { current_password: current, new_password: next },
      {
        onSuccess: () => {
          toast.success("Şifren değiştirildi.");
          setCurrent("");
          setNext("");
          setConfirm("");
          setOpen(null);
        },
        onError: (err) => {
          if (err instanceof AxiosError && err.response?.status === 400) {
            toast.error("Mevcut şifre hatalı.");
            return;
          }
          toast.error(getErrorMessage(err, "Şifre değiştirilemedi."));
        },
      }
    );
  };

  return (
    <section>
      <h2 className="mb-1 text-xl font-bold text-slate-900 ">
        Oturum açma ve güvenlik
      </h2>
      <p className="mb-3 text-sm text-slate-500 ">
        Şifreni güncelle ve hesabının güvenlik durumunu gör.
      </p>

      <div className="rounded-2xl bg-white px-5 shadow-sm ring-1 ring-slate-100 sm:px-6">
        {/* Şifre */}
        <SettingRow
          title="Şifre"
          value="Son güncellemeyi gizli tutuyoruz · ••••••••"
          actionLabel={open === "password" ? "İptal" : "Güncelle"}
          isOpen={open === "password"}
          onToggle={() => {
            setCurrent("");
            setNext("");
            setConfirm("");
            setOpen((o) => (o === "password" ? null : "password"));
          }}
        >
          <form onSubmit={submitPassword} className="max-w-md">
            <div className="space-y-3">
              <div>
                <label htmlFor={`${uid}-mevcut-sifre`} className={fieldLabelCls}>Mevcut şifre</label>
                <input id={`${uid}-mevcut-sifre`}
                  type="password"
                  required
                  autoComplete="current-password"
                  autoFocus
                  className={inputCls}
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor={`${uid}-yeni-sifre`} className={fieldLabelCls}>Yeni şifre</label>
                <input id={`${uid}-yeni-sifre`}
                  type="password"
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  placeholder="En az 8 karakter"
                  className={inputCls}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor={`${uid}-yeni-sifre-tekrar`} className={fieldLabelCls}>Yeni şifre (tekrar)</label>
                <input id={`${uid}-yeni-sifre-tekrar`}
                  type="password"
                  required
                  autoComplete="new-password"
                  className={`${inputCls} ${
                    pwMismatch ? "border-red-300 focus:border-red-400 focus:ring-red-100" : ""
                  }`}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
                {pwMismatch && (
                  <p className="mt-1 text-xs text-red-500">Şifreler eşleşmiyor.</p>
                )}
              </div>
            </div>
            <EditActions
              saving={changePassword.isPending}
              disabled={!current || !next || !confirm || pwMismatch}
              onCancel={() => setOpen(null)}
            />
          </form>
        </SettingRow>

        {/* E-posta doğrulama durumu */}
        <SettingRow
          title="E-posta doğrulaması"
          editable={!user.email_verified}
          actionLabel={resend.isPending ? "Gönderiliyor…" : "Yeniden gönder"}
          onToggle={() => resend.mutate()}
          value={
            user.email_verified ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-600 ">
                <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden>
                  <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zm3.16 4.87L6.67 9.36 4.42 7.1 3.29 8.23l3.38 3.38L12.29 6z" />
                </svg>
                E-postan doğrulandı.
              </span>
            ) : (
              `${user.email} adresi henüz doğrulanmadı.`
            )
          }
        />
      </div>

      <DataAndAccountSection />
    </section>
  );
}

/**
 * KVKK hakları: veri taşınabilirliği (m.20) ve silme (m.7/m.11).
 *
 * Yasal metinler kullanıcıya "hesabınızı sildiğinizde verileriniz silinir veya
 * anonim hâle getirilir" taahhüdü veriyordu ama karşılığı olan hiçbir yüzey
 * yoktu. Silme geri alınamaz olduğundan iki kapı var: parola doğrulaması ve
 * hesabın adını harfi harfine yazma.
 */
function DataAndAccountSection() {
  const uid = useId();
  const { data: user } = useCurrentUser();
  const download = useDownloadMyData();
  const { data: eligibility } = useDeletionEligibility();
  const deleteAccount = useDeleteMyAccount();

  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");

  if (!user) return null;

  const CONFIRM_WORD = "HESABIMI SİL";
  const canSubmit =
    password.length > 0 &&
    confirmText.trim() === CONFIRM_WORD &&
    eligibility?.can_delete !== false;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    deleteAccount.mutate(password, {
      onSuccess: () => toast.success("Hesabın kapatıldı. Seni özleyeceğiz."),
      onError: (err) => {
        if (err instanceof AxiosError && err.response?.status === 400) {
          toast.error("Parola hatalı.");
          return;
        }
        toast.error(getErrorMessage(err, "Hesap silinemedi."));
      },
    });
  };

  return (
    <>
      <h2 className="mb-1 mt-10 text-xl font-bold text-slate-900 ">
        Verilerim ve hesabım
      </h2>
      <p className="mb-3 text-sm text-slate-500 ">
        Kişisel verilerini indirebilir veya hesabını kapatabilirsin.
      </p>

      <div className="rounded-2xl bg-white px-5 shadow-sm ring-1 ring-slate-100 sm:px-6">
        <SettingRow
          title="Verilerimi indir"
          value="Hesabında tuttuğumuz kişisel verilerin makine-okunur (JSON) kopyası."
          actionLabel={download.isPending ? "Hazırlanıyor…" : "İndir"}
          onToggle={() =>
            download.mutate(undefined, {
              onError: () => toast.error("Dosya hazırlanamadı."),
            })
          }
        />

        <SettingRow
          title="Hesabımı sil"
          value={
            eligibility?.can_delete === false ? (
              <span className="text-amber-600 ">
                {eligibility.reason}
              </span>
            ) : (
              "Kimlik ve iletişim bilgilerin geri alınamaz biçimde silinir."
            )
          }
          editable={eligibility?.can_delete !== false}
          actionLabel={open ? "Vazgeç" : "Hesabımı sil"}
          isOpen={open}
          onToggle={() => {
            setPassword("");
            setConfirmText("");
            setOpen((o) => !o);
          }}
        >
          <form onSubmit={submit} className="max-w-md">
            <p className="mb-3 text-sm text-slate-600 ">
              Bu işlem <strong>geri alınamaz</strong>. Adın, e-postan, telefonun
              ve adreslerin silinir; hesabın kapanır.{" "}
              <span className="text-slate-500 ">
                Faturalı sipariş ve ödeme kayıtların, vergi mevzuatı gereği
                saklanmak zorunda olduğundan kimliğinden arındırılmış olarak
                kalır.
              </span>
            </p>
            <div className="space-y-3">
              <div>
                <label htmlFor={`${uid}-parolan`} className={fieldLabelCls}>Parolan</label>
                <input id={`${uid}-parolan`}
                  type="password"
                  required
                  autoComplete="current-password"
                  className={inputCls}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div>
                <label className={fieldLabelCls}>
                  Onaylamak için <code>{CONFIRM_WORD}</code> yaz
                </label>
                <input
                  type="text"
                  required
                  className={inputCls}
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 py-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 "
              >
                Vazgeç
              </button>
              <button
                type="submit"
                disabled={!canSubmit || deleteAccount.isPending}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleteAccount.isPending ? "Siliniyor…" : "Hesabımı kalıcı olarak sil"}
              </button>
            </div>
          </form>
        </SettingRow>
      </div>
    </>
  );
}
