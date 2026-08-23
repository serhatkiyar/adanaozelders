import { useLocation } from "react-router-dom";

import { AccessDenied } from "@/components/admin/AccessState";
import { CategoriesPanel } from "@/components/admin/store/CategoriesPanel";
import { CouponsPanel } from "@/components/admin/store/CouponsPanel";
import { LandingPagesManager } from "@/components/admin/store/LandingPagesManager";
import { OrdersPanel } from "@/components/admin/store/OrdersPanel";
import { ProductSetsManager } from "@/components/admin/store/ProductSetsManager";
import { ProductsPanel } from "@/components/admin/store/ProductsPanel";
import { ReturnsPanel } from "@/components/admin/store/ReturnsPanel";
import { StoreAttributesManager } from "@/components/admin/store/StoreAttributesManager";
import { SupplierPanel } from "@/components/admin/store/SupplierPanel";
import { GezinmeBaglantisi } from "@/components/admin/ui2/gezinmeBekcisi";
import { adminAreaAccess } from "@/lib/adminAccess";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";

type SubTab = "home" | "campaigns" | "collections" | "products" | "categories" | "supplier" | "orders" | "returns" | "coupons";

const STORE_ROUTES: Record<SubTab, string> = {
  home: ROUTES.adminStoreHome,
  campaigns: ROUTES.adminStorePages,
  collections: ROUTES.adminStoreProductSets,
  products: ROUTES.adminStoreProducts,
  categories: ROUTES.adminStoreCategories,
  supplier: ROUTES.adminStoreSupplier,
  orders: ROUTES.adminStoreOrders,
  returns: ROUTES.adminStoreReturns,
  coupons: ROUTES.adminStoreCoupons,
};

const TAB_AREA: Record<SubTab, string> = {
  home: "products",
  campaigns: "products",
  collections: "products",
  products: "products",
  categories: "products",
  supplier: "suppliers",
  orders: "orders",
  returns: "returns",
  coupons: "coupons",
};

const GROUPS: { label: string; items: [SubTab, string][] }[] = [
  { label: "İçerik", items: [["home", "Ana sayfa"], ["campaigns", "Kampanyalar"], ["collections", "Koleksiyonlar"]] },
  { label: "Katalog", items: [["products", "Ürünler"], ["categories", "Kategoriler ve özellikler"], ["supplier", "Tedarikçi"]] },
  { label: "Satış", items: [["orders", "Siparişler"], ["returns", "İadeler"], ["coupons", "Kuponlar"]] },
];

export default function AdminStore() {
  const { pathname } = useLocation();
  const permissions = useAuthStore((state) => state.user?.admin_permissions);
  const sub = (Object.entries(STORE_ROUTES).find(([, route]) => pathname === route)?.[0] as SubTab | undefined) ?? "home";

  if (!adminAreaAccess(permissions, ...Object.values(TAB_AREA)).canView) return <AccessDenied area="Mağaza" />;

  return (
    <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-6 lg:self-start" aria-label="Mağaza bölümleri">
        <div className="border-b border-slate-200 pb-4 dark:border-slate-800 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-5">
          {GROUPS.map((group, groupIndex) => (
            <section key={group.label} className={groupIndex ? "mt-5 border-t border-slate-200 pt-5 dark:border-slate-800" : ""}>
              <h2 className="mb-2 px-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">{group.label}</h2>
              <div className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
                {group.items.filter(([value]) => adminAreaAccess(permissions, TAB_AREA[value]).canView).map(([value, label]) => (
                  <GezinmeBaglantisi
                    key={value}
                    to={STORE_ROUTES[value]}
                    aria-current={sub === value ? "page" : undefined}
                    className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${sub === value ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"}`}
                  >
                    {label}
                  </GezinmeBaglantisi>
                ))}
              </div>
            </section>
          ))}
        </div>
      </aside>

      <main className="min-w-0">
        {sub === "home" ? <LandingPagesManager pageType="HOME" />
          : sub === "campaigns" ? <LandingPagesManager pageType="CAMPAIGN" />
          : sub === "collections" ? <ProductSetsManager />
          : sub === "products" ? <ProductsPanel />
          : sub === "categories" ? <div className="space-y-10"><CategoriesPanel /><StoreAttributesManager /></div>
          : sub === "supplier" ? <SupplierPanel />
          : sub === "orders" ? <OrdersPanel />
          : sub === "returns" ? <ReturnsPanel />
          : <CouponsPanel />}
      </main>
    </div>
  );
}
