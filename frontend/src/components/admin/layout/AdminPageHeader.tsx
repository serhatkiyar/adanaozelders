import { Link, useLocation } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { getAdminNavItem } from "./adminNavigation";

export function AdminPageHeader() {
  const { pathname } = useLocation();
  const current = getAdminNavItem(pathname);

  return (
    <header className="mb-6">
      <nav aria-label="Sayfa yolu" className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
        <Link className="transition hover:text-indigo-600 dark:hover:text-indigo-400" to={ROUTES.admin}>
          Yönetim
        </Link>
        {current.to !== ROUTES.admin && (
          <>
            <span aria-hidden="true">/</span>
            <span aria-current="page" className="text-slate-700 dark:text-slate-200">
              {current.shortLabel ?? current.label}
            </span>
          </>
        )}
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-3xl">
            {current.label}
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
            {current.description}
          </p>
        </div>
      </div>
    </header>
  );
}
