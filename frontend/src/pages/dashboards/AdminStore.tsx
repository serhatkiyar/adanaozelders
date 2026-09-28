import { Navigate, useLocation } from "react-router-dom";

import { AccessDenied } from "@/components/admin/AccessState";
import { CategoriesPanel } from "@/components/admin/store/CategoriesPanel";
import { CouponsPanel } from "@/components/admin/store/CouponsPanel";
import { OrdersPanel } from "@/components/admin/store/OrdersPanel";
import { ProductsPanel } from "@/components/admin/store/ProductsPanel";
import { ReturnsPanel } from "@/components/admin/store/ReturnsPanel";
import { StoreAttributesManager } from "@/components/admin/store/StoreAttributesManager";
import { SupplierPanel } from "@/components/admin/store/SupplierPanel";
import { GezinmeBaglantisi } from "@/components/admin/ui2/gezinmeBekcisi";
import { adminAreaAccess, MAGAZA_ALANLARI, type MagazaAlani } from "@/lib/adminAccess";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";

type SubTab = "products" | "categories" | "supplier" | "orders" | "returns" | "coupons";

const STORE_ROUTES: Record<SubTab, string> = {
  products: ROUTES.adminStoreProducts,
  categories: ROUTES.adminStoreCategories,
  supplier: ROUTES.adminStoreSupplier,
  orders: ROUTES.adminStoreOrders,
  returns: ROUTES.adminStoreReturns,
  coupons: ROUTES.adminStoreCoupons,
};

const TAB_AREA: Record<SubTab, MagazaAlani> = {
  products: "products",
  categories: "products",
  supplier: "suppliers",
  orders: "orders",
  returns: "returns",
  coupons: "coupons",
};

// İçerik grubu SÖKÜLDÜ (manuel vitrin kararı): vitrin kodda yaşar.
const GROUPS: { label: string; items: [SubTab, string][] }[] = [
  { label: "Katalog", items: [["products", "Ürünler"], ["categories", "Kategoriler"], ["supplier", "Tedarikçi"]] },
  { label: "Satış", items: [["orders", "Siparişler"], ["returns", "İadeler"], ["coupons", "Kuponlar"]] },
];

export default function AdminStore() {
  const { pathname } = useLocation();
  const permissions = useAuthStore((state) => state.user?.admin_permissions);
  const sub = (Object.entries(STORE_ROUTES).find(([, route]) => pathname === route)?.[0] as SubTab | undefined) ?? "products";

  // Kapı menüyle aynı kaynaktan (`MAGAZA_ALANLARI`) türer.
  if (!adminAreaAccess(permissions, ...MAGAZA_ALANLARI).canView) return <AccessDenied area="Mağaza" />;

  // `/yonetim/magaza` kökü (ve eski vitrin takma adları) sabit olarak
  // Ürünler'e gidiyordu; ürün yetkisi olmayan sipariş/iade sorumlusu, kendi
  // sekmeleri solda dururken ortada "Ürünler: erişim yok" görüyordu. Kök,
  // GROUPS sırasıyla izinli İLK sekmeye yönlenir (kapı en az birini garanti eder).
  if (pathname === ROUTES.adminStoreRoot) {
    const ilk = GROUPS.flatMap((group) => group.items.map(([value]) => value))
      .find((value) => adminAreaAccess(permissions, TAB_AREA[value]).canView);
    if (ilk) return <Navigate replace to={STORE_ROUTES[ilk]} />;
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-6 lg:self-start" aria-label="Mağaza bölümleri">
        <div className="border-b border-slate-200 pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-5">
          {GROUPS.map((group, groupIndex) => (
            <section key={group.label} className={groupIndex ? "mt-5 border-t border-slate-200 pt-5 " : ""}>
              <h2 className="mb-2 px-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">{group.label}</h2>
              <div className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
                {group.items.filter(([value]) => adminAreaAccess(permissions, TAB_AREA[value]).canView).map(([value, label]) => (
                  <GezinmeBaglantisi
                    key={value}
                    to={STORE_ROUTES[value]}
                    aria-current={sub === value ? "page" : undefined}
                    className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${sub === value ? "bg-slate-900 text-white " : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 "}`}
                  >
                    {label}
                  </GezinmeBaglantisi>
                ))}
              </div>
            </section>
          ))}
        </div>
      </aside>

      <section aria-label="Mağaza içeriği" className="min-w-0">
        {sub === "products" ? <ProductsPanel />
          : sub === "categories" ? <div className="space-y-10"><CategoriesPanel /><StoreAttributesManager /></div>
          : sub === "supplier" ? <SupplierPanel />
          : sub === "orders" ? <OrdersPanel />
          : sub === "returns" ? <ReturnsPanel />
          : <CouponsPanel />}
      </section>
    </div>
  );
}
