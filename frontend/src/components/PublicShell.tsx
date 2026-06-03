import { ReactNode } from "react";
import { PublicNavbar } from "@/components/PublicNavbar";
import { AuthModal } from "@/components/AuthModal";

// Not: sayfa başlığı/meta artık merkezî `<Seo />` (react-helmet-async) ile
// yönetilir; shell document.title'a dokunmaz (çift yönetim/flicker önlenir).
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <PublicNavbar />
      <main className="p-4 sm:p-6">{children}</main>
      <AuthModal />
    </div>
  );
}
