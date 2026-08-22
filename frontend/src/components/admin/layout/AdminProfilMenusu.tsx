import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/admin/ui";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { useLogout } from "@/hooks/useLogout";
import { useThemeStore, type ThemePreference } from "@/store/themeStore";

/**
 * ── Profil menüsü: kabuğun ALT bölgesi (İP-B1 · docs/tasarim-dili.md §4.1) ──
 *
 * Medusa'nın çubuğunda profil ve tema anahtarı en alttadır; bizde bugüne dek
 * ikisi de panelin ÜSTÜNDEKİ genel site navbar'ındaydı (`DashboardHeader`).
 * Kabuk kendi çerçevesini kurunca o navbar panelden kalktı ve buradaki menü
 * onun panele ait parçalarını devraldı: hesap, tema, çıkış, siteye dönüş.
 *
 * **Tema üç seçenektir** (Açık / Koyu / Sistem) ve bir düğme değil bir
 * `radiogroup`tur. Gerekçe: iki durumlu bir anahtar "sistem"i ifade edemez ve
 * `themeStore` zaten üç değerli bir tercih tutuyor (`ThemePreference`) —
 * arayüz onu iki duruma indirirse kullanıcı "sistemi izle"ye geri dönemez.
 * Bugün panelde bunu yapan bir yüzey yoktu; tercih yalnız `toggle()` ile
 * değişiyordu ve `system` bir kez terk edilince seçilemiyordu.
 */

const TEMA_SECENEKLERI: { deger: ThemePreference; etiket: string }[] = [
  { deger: "light", etiket: "Açık" },
  { deger: "dark", etiket: "Koyu" },
  { deger: "system", etiket: "Sistem" },
];

export interface AdminProfilMenusuProps {
  katli?: boolean;
  onNavigate?: () => void;
}

export function AdminProfilMenusu({ katli = false, onNavigate }: AdminProfilMenusuProps) {
  const [acik, setAcik] = useState(false);
  const kutuRef = useRef<HTMLDivElement>(null);
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  useEffect(() => {
    if (!acik) return;
    const disariTik = (e: MouseEvent) => {
      if (kutuRef.current && !kutuRef.current.contains(e.target as Node)) setAcik(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAcik(false);
    };
    document.addEventListener("mousedown", disariTik);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", disariTik);
      document.removeEventListener("keydown", esc);
    };
  }, [acik]);

  const ad = user?.full_name || user?.email || "Yönetici";
  const bashaHarf = ad.trim().charAt(0).toLocaleUpperCase("tr");

  return (
    <div ref={kutuRef} className="relative">
      <Button
        variant="ghost"
        size="md"
        aria-haspopup="menu"
        aria-expanded={acik}
        onClick={() => setAcik((o) => !o)}
        className={`w-full ${katli ? "!px-2" : "justify-start"}`}
      >
        <span className="sr-only">Hesap menüsü</span>
        <span
          aria-hidden="true"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-panel-surface-hover text-xs font-semibold text-panel-fg"
        >
          {bashaHarf}
        </span>
        {!katli && (
          <span aria-hidden="true" className="min-w-0 flex-1 truncate text-left text-sm font-medium text-panel-fg">
            {ad}
          </span>
        )}
      </Button>

      {acik && (
        <div
          role="menu"
          aria-label="Hesap"
          className="absolute bottom-full left-0 z-50 mb-2 w-64 overflow-hidden rounded-2xl border border-panel-border bg-panel-surface p-2 shadow-lg"
        >
          <div className="px-2 py-2">
            <p className="truncate text-sm font-semibold text-panel-fg">{ad}</p>
            {user?.email && <p className="truncate text-xs text-panel-fg-muted">{user.email}</p>}
          </div>

          <fieldset className="mt-1 rounded-xl bg-panel-surface-subtle p-2">
            <legend className="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-panel-fg-subtle">
              Tema
            </legend>
            <div className="mt-1 grid grid-cols-3 gap-1">
              {TEMA_SECENEKLERI.map((s) => (
                <label
                  key={s.deger}
                  className={`flex cursor-pointer items-center justify-center rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                    preference === s.deger
                      ? "bg-panel-accent text-panel-accent-fg"
                      : "text-panel-fg-muted hover:bg-panel-surface-hover"
                  }`}
                >
                  <input
                    type="radio"
                    name="panel-tema"
                    value={s.deger}
                    checked={preference === s.deger}
                    onChange={() => setPreference(s.deger)}
                    className="sr-only"
                  />
                  {s.etiket}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-1 space-y-0.5">
            <Link
              role="menuitem"
              to={ROUTES.profile}
              onClick={() => {
                setAcik(false);
                onNavigate?.();
              }}
              className="flex min-h-9 items-center rounded-lg px-3 text-sm text-panel-fg-muted transition hover:bg-panel-surface-hover hover:text-panel-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-focus"
            >
              Profilim
            </Link>
            <Link
              role="menuitem"
              to={ROUTES.home}
              onClick={() => {
                setAcik(false);
                onNavigate?.();
              }}
              className="flex min-h-9 items-center rounded-lg px-3 text-sm text-panel-fg-muted transition hover:bg-panel-surface-hover hover:text-panel-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-focus"
            >
              Siteye dön
            </Link>
            <Button
              role="menuitem"
              variant="ghost"
              size="sm"
              onClick={() => {
                setAcik(false);
                logout();
              }}
              className="w-full justify-start"
            >
              Çıkış yap
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
