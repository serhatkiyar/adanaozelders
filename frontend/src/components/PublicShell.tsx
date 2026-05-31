import { ReactNode, useEffect } from "react";
import { PublicNavbar } from "@/components/PublicNavbar";
import { AuthModal } from "@/components/AuthModal";

export function PublicShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    document.title = `Adana Özel Ders · ${title}`;
  }, [title]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <PublicNavbar />
      <main className="p-4 sm:p-6">{children}</main>
      <AuthModal />
    </div>
  );
}
