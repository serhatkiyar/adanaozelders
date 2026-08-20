/**
 * Mağaza yönetimi — SEKME DÜZENLEYİCİSİ.
 *
 * İP-A5'e kadar bu dosya 2216 satırdı ve altı sekmenin tamamını (ürünler,
 * kategoriler, siparişler, iadeler, kuponlar) içinde taşıyordu. Bölme
 * MEKANİKTİR: bölümler `components/admin/store/` altına AYNEN taşındı, tek bir
 * JSX düğümü değişmedi. Erişilebilirlik göçü İP-A6'nın işidir.
 *
 * Bölümler arasında PAYLAŞILAN REACT DURUMU YOKTUR; ortak zemin URL
 * (`useSearchParams`) ve React Query önbelleğidir. Bu yüzden bölme prop
 * geçirmeden ya da durum yukarı taşımadan yapılabildi.
 */
import { useLocation } from "react-router-dom";

import { AccessDenied } from "@/components/admin/AccessState";
import { GezinmeBaglantisi } from "@/components/admin/ui2/gezinmeBekcisi";
import { StockMovementsPanel } from "@/components/admin/StockMovementsPanel";
import { CategoriesPanel } from "@/components/admin/store/CategoriesPanel";
import { CouponsPanel } from "@/components/admin/store/CouponsPanel";
import { OrdersPanel } from "@/components/admin/store/OrdersPanel";
import { ProductsPanel } from "@/components/admin/store/ProductsPanel";
import { ReturnsPanel } from "@/components/admin/store/ReturnsPanel";
import { adminAreaAccess } from "@/lib/adminAccess";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";

type SubTab =
  | "products"
  | "categories"
  | "orders"
  | "returns"
  | "coupons"
  | "stock";

const STORE_ROUTES: Record<SubTab, string> = {
  products: ROUTES.adminStoreProducts,
  categories: ROUTES.adminStoreCategories,
  orders: ROUTES.adminStoreOrders,
  returns: ROUTES.adminStoreReturns,
  coupons: ROUTES.adminStoreCoupons,
  stock: ROUTES.adminStoreStock,
};

// Sekme → backend izin alanı (kategoriler backend'de products.manage kapsamında).
const TAB_AREA: Record<SubTab, string> = {
  products: "products",
  categories: "products",
  orders: "orders",
  returns: "returns",
  coupons: "coupons",
  // Defter salt-okunur bir teşhis yüzeyi; ürün görüntüleme izniyle açılır.
  stock: "products",
};

export default function AdminStore() {
  const { pathname } = useLocation();
  const permissions = useAuthStore((state) => state.user?.admin_permissions);
  const sub =
    (Object.entries(STORE_ROUTES).find(([, route]) => pathname === route)?.[0] as
      | SubTab
      | undefined) ?? "products";
  if (!adminAreaAccess(permissions, ...Object.values(TAB_AREA)).canView) {
    return <AccessDenied area="Mağaza" />;
  }
  return (
    <div>
      <div className="mb-4 flex gap-2">
        {(
          [
            ["products", "Ürünler"],
            ["categories", "Kategoriler"],
            ["orders", "Siparişler"],
            ["returns", "İadeler"],
            ["coupons", "Kuponlar"],
            ["stock", "Stok hareketleri"],
          ] as [SubTab, string][]
        ).filter(([v]) => adminAreaAccess(permissions, TAB_AREA[v]).canView).map(([v, label]) => (
          <GezinmeBaglantisi
            key={v}
            to={STORE_ROUTES[v]}
            aria-current={sub === v ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              sub === v
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            {label}
          </GezinmeBaglantisi>
        ))}
      </div>
      {sub === "products" ? (
        <ProductsPanel />
      ) : sub === "categories" ? (
        <CategoriesPanel />
      ) : sub === "orders" ? (
        <OrdersPanel />
      ) : sub === "returns" ? (
        <ReturnsPanel />
      ) : sub === "stock" ? (
        <StockMovementsPanel />
      ) : (
        <CouponsPanel />
      )}
    </div>
  );
}
