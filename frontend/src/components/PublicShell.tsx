import { type ReactNode } from "react";
import { PublicNavbar } from "@/components/PublicNavbar";
import { AuthModal } from "@/components/AuthModal";

// Not: sayfa başlığı/meta artık merkezî `<Seo />` (react-helmet-async) ile
// yönetilir; shell document.title'a dokunmaz (çift yönetim/flicker önlenir).
export function PublicShell({
  children,
  center,
  bottom,
}: {
  children: ReactNode;
  /** Navbar ortasına yerleşen içerik (ör. arama pill'i). */
  center?: ReactNode;
  /** Navbar'ın alt satırına yerleşen içerik (ör. filtre çubuğu). */
  bottom?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <PublicNavbar center={center} bottom={bottom} expanded />
      <main className="p-4 sm:p-6">{children}</main>
      <AuthModal />
    </div>
  );
}
