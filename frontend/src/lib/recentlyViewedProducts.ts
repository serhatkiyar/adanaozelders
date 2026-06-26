import type { ProductSearchOut } from "@/types";

// "Son görüntülenen ürünler" — kullanıcının baktığı ürünleri tarayıcıda
// (localStorage) tutar. Sunucu kaydı gerektirmez; anonim/giriş'li fark etmez.
// Eğitmen tarafındaki recentlyViewed.ts deseninin ürün karşılığı.

const KEY = "recently_viewed_products";
const MAX = 12;

// Karta render için yeterli minimal alt küme — localStorage'ı şişirmeyiz.
function trim(p: ProductSearchOut): ProductSearchOut {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    kind: p.kind,
    seller_type: p.seller_type,
    tutor_id: p.tutor_id ?? null,
    tutor_name: p.tutor_name ?? null,
    price: p.price,
    compare_at_price: p.compare_at_price ?? null,
    currency: p.currency,
    cover_url: p.cover_url ?? null,
    in_stock: p.in_stock,
    category_id: p.category_id ?? null,
    rating_count: p.rating_count ?? 0,
    rating_average: p.rating_average ?? null,
  } as ProductSearchOut;
}

export function getRecentlyViewedProducts(): ProductSearchOut[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as ProductSearchOut[]) : [];
  } catch {
    return [];
  }
}

export function recordViewedProduct(p: ProductSearchOut): void {
  if (!p || typeof p.id !== "number") return;
  try {
    // En son bakılan başa gelir; tekrar bakılan yukarı taşınır (dedup).
    const list = getRecentlyViewedProducts().filter((x) => x.id !== p.id);
    list.unshift(trim(p));
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // storage dolu/erişilemez — sessizce yok say.
  }
}

export function clearRecentlyViewedProducts(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // erişilemez — yok say.
  }
}
