import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PublicShell } from "@/components/PublicShell";
import { MapPicker } from "@/components/MapPicker";
import { Seo } from "@/components/Seo";
import { registerLibrary } from "@/api/libraries";
import { fetchMe } from "@/api/auth";
import { useAuthStore } from "@/store/authStore";
import { roleHome } from "@/lib/roles";
import { ROUTES } from "@/lib/routes";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";

/**
 * Self-servis "Kütüphaneni listele" kaydı. Operatör hesabı + temel kütüphane bilgisi
 * gönderilir → kütüphane PENDING (onay bekler) oluşur ve oturum açılır (auto-login).
 * Profilin gerisi (saat/foto/olanak/konum) onay sürecinde operatör panelinden tamamlanır.
 */
export default function LibraryRegister() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);

  const [form, setForm] = useState({
    name: "",
    phone: "",
    city: "",
    district: "",
    description: "",
    first_name: "",
    last_name: "",
    email: "",
    password: "",
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  // Konum ayrı tutulur (sayısal + MapPicker callback'i ile set edilir).
  const [loc, setLoc] = useState<{ lat: number | null; lng: number | null; text: string }>({
    lat: null,
    lng: null,
    text: "",
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const token = await registerLibrary({
        email: form.email.trim(),
        password: form.password,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        city: form.city.trim() || null,
        district: form.district.trim() || null,
        description: form.description.trim() || null,
        location_lat: loc.lat,
        location_lng: loc.lng,
        location_text: loc.text.trim() || null,
      });
      setTokens(token.access_token, token.refresh_token ?? null);
      const user = await fetchMe();
      setUser(user);
      queryClient.setQueryData(["me"], user);
      return user;
    },
    onSuccess: (user) => {
      toast.success("Başvurun alındı! Onay sürecinde profilini tamamlayabilirsin.");
      navigate(roleHome(user.role_id), { replace: true });
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (form.password.length < 8) {
      toast.error("Şifre en az 8 karakter olmalı.");
      return;
    }
    mutation.mutate();
  };

  return (
    <PublicShell>
      <Seo
        title="Kütüphaneni Listele"
        description="Çalışma kütüphaneni / etüt merkezini platforma ekle: öğrencilere görün, deneme oturumları ve çalışma alanı rezervasyonu sun."
      />
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
            Kütüphaneni listele
          </h1>
          <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500 dark:text-slate-400">
            Çalışma mekânını platforma ekle; bölgendeki öğrencilere görün, deneme
            oturumları ve çalışma alanı rezervasyonu sun. Başvurun{" "}
            <strong>admin onayından</strong> sonra yayına girer.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="mt-8 space-y-6 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700 sm:p-8"
        >
          {/* Mekân bilgisi */}
          <fieldset className="space-y-4">
            <legend className="text-sm font-bold uppercase tracking-wide text-slate-400">
              Mekân Bilgisi
            </legend>
            <Field label="Kütüphane / etüt merkezi adı" required>
              <input className="input" value={form.name} onChange={set("name")} required minLength={2} maxLength={200} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="İl">
                <input className="input" value={form.city} onChange={set("city")} maxLength={100} placeholder="Adana" />
              </Field>
              <Field label="İlçe">
                <input className="input" value={form.district} onChange={set("district")} maxLength={100} placeholder="Seyhan" />
              </Field>
            </div>
            <Field label="Telefon" hint="Öğrencilerin ulaşması için (opsiyonel).">
              <input className="input" value={form.phone} onChange={set("phone")} maxLength={30} placeholder="05xx xxx xx xx" />
            </Field>
            <Field label="Kısa tanıtım" hint="Konseptin, öne çıkan özelliklerin (opsiyonel).">
              <textarea className="input" rows={3} value={form.description} onChange={set("description")} maxLength={5000} />
            </Field>

            <Field
              label="Konum"
              hint="Haritada arayıp tam noktanı işaretle — haritada bulunman ve yol tarifi için önemli."
            >
              <div className="h-64 overflow-hidden rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 [&_.map-picker-root]:h-full">
                <MapPicker
                  initialLat={loc.lat}
                  initialLng={loc.lng}
                  onLocationSelect={(lat, lng, address) =>
                    setLoc((p) => ({ lat, lng, text: address ?? p.text }))
                  }
                />
              </div>
              {loc.lat != null && loc.lng != null && (
                <p className="mt-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  ✓ Konum işaretlendi{loc.text ? ` · ${loc.text}` : ""}
                </p>
              )}
            </Field>
          </fieldset>

          {/* Operatör hesabı */}
          <fieldset className="space-y-4 border-t border-slate-100 pt-6 dark:border-slate-700">
            <legend className="text-sm font-bold uppercase tracking-wide text-slate-400">
              Yönetici Hesabın
            </legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Ad" required>
                <input className="input" value={form.first_name} onChange={set("first_name")} required maxLength={75} />
              </Field>
              <Field label="Soyad" required>
                <input className="input" value={form.last_name} onChange={set("last_name")} required maxLength={75} />
              </Field>
            </div>
            <Field label="E-posta" required>
              <input className="input" type="email" value={form.email} onChange={set("email")} required maxLength={255} autoComplete="email" />
            </Field>
            <Field label="Şifre" required hint="En az 8 karakter.">
              <input className="input" type="password" value={form.password} onChange={set("password")} required minLength={8} maxLength={128} autoComplete="new-password" />
            </Field>
          </fieldset>

          {mutation.isError && (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
              {getErrorMessage(mutation.error, "Kayıt başarısız.")}
            </p>
          )}

          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? "Gönderiliyor…" : "Başvuruyu gönder"}
          </button>

          <p className="text-center text-xs text-slate-400 dark:text-slate-500">
            Zaten hesabın var mı?{" "}
            <Link to={ROUTES.login} className="font-semibold text-indigo-600 hover:underline dark:text-indigo-300">
              Giriş yap
            </Link>
          </p>
        </form>
      </div>
    </PublicShell>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-200">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">{hint}</span>}
    </label>
  );
}
