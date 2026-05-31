import { useEffect, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { DashboardHeader } from "@/components/DashboardHeader";
import { useAuthStore } from "@/store/authStore";
import { resendEmailVerification } from "@/api/auth";
import { toast } from "@/store/toastStore";
import type { NavItem } from "@/lib/nav";

interface DashboardShellProps {
  title: string;
  navItems?: NavItem[];
  children?: ReactNode;
}

export function DashboardShell({
  title,
  navItems,
  children,
}: DashboardShellProps) {
  const user = useAuthStore((s) => s.user);

  const [verifyDismissed, setVerifyDismissed] = useState(false);
  const resendVerify = useMutation({
    mutationFn: resendEmailVerification,
    onSuccess: (res) =>
      toast.success(res.detail ?? "Doğrulama bağlantısı e-postana gönderildi."),
    onError: () =>
      toast.error("Bağlantı gönderilemedi. Lütfen biraz sonra tekrar dene."),
  });
  const showVerifyBanner =
    !!user && user.email_verified === false && !verifyDismissed;

  useEffect(() => {
    document.title = `Adana Özel Ders · ${title}`;
  }, [title]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <DashboardHeader navItems={navItems} transparent />

      {showVerifyBanner && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/20 dark:bg-amber-500/10 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
              />
            </svg>
            <p className="flex-1 text-sm text-amber-800 dark:text-amber-200">
              <span className="font-semibold">E-postanı doğrula.</span>{" "}
              <span className="text-amber-700 dark:text-amber-300/90">
                {user?.email} adresine gönderdiğimiz bağlantıya tıkla.
              </span>
            </p>
            <button
              type="button"
              onClick={() => resendVerify.mutate()}
              disabled={resendVerify.isPending}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {resendVerify.isPending ? "Gönderiliyor..." : "Yeniden gönder"}
            </button>
            <button
              type="button"
              aria-label="Kapat"
              onClick={() => setVerifyDismissed(true)}
              className="rounded-lg p-1.5 text-amber-600 transition hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-500/20"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                className="h-4 w-4"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18 18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      <main className="p-4 sm:p-6">{children}</main>
    </div>
  );
}
