import { useEffect, useState } from "react";

import { useAdminProducts } from "@/hooks/useStore";
import type { ProductSearchOut } from "@/types";

/**
 * Ürün seçici — ham ID yazmanın yerine geçer.
 *
 * ## Neden
 *
 * Sayım oturumu açarken yönetici "Ürün numaraları" kutusuna `12, 34, 56`
 * yazıyordu; hasar kaydında `type="number"` bir kutuya ham ürün ID'si
 * giriliyordu. İkisi de ürün numarasını BAŞKA bir ekrandan not etmeyi
 * gerektiriyor ve yanlış numara sessizce yanlış ürünü sayıma alıyor (hasarda
 * ise geri alınamaz bir defter satırı üretiyor). `CountSessionDetailPage`'in
 * kendi yorumu bunu zaten kayda geçirmişti.
 *
 * A5'in araması olmadan bu bileşen yazılamazdı: seçici o aramanın üstüne
 * oturur ve aynı uca gider (`/store/admin/products?q=`), yani başlık, yazar,
 * yayınevi, ISBN ve SKU ile aranabilir. Barkod okutmak da çalışır.
 *
 * ## Tasarım kararları
 *
 * - Aday listesi yalnız **aranınca** görünür: boş sorguda tüm katalogu
 *   dökmek seçiciyi bir listeye çevirir ve seçimi zorlaştırır.
 * - Seçilenler ayrı bir bölümde durur ve tek tek kaldırılabilir; ekrandan
 *   silmek gövdeden de düşürür (ikisi aynı state'ten okunur).
 * - Zaten seçilmiş ürün aday listesinde gösterilmez — aynı ürünü iki kez
 *   eklemek sayım satırını tekrarlardı.
 */
export function ProductPicker({
  selected,
  onChange,
  label = "Ürün ara",
  multiple = true,
}: {
  selected: ProductSearchOut[];
  onChange: (secilenler: ProductSearchOut[]) => void;
  label?: string;
  multiple?: boolean;
}) {
  const [terim, setTerim] = useState("");
  const [gecikmeli, setGecikmeli] = useState("");

  // Her tuş vuruşunda istek atmamak için gecikme; A5 araması sunucuda
  // çalıştığı için ağ turu gerçek.
  useEffect(() => {
    const zamanlayici = setTimeout(() => setGecikmeli(terim.trim()), 250);
    return () => clearTimeout(zamanlayici);
  }, [terim]);

  const sorgu = useAdminProducts(
    gecikmeli ? { q: gecikmeli, limit: 10 } : { limit: 10 }
  );
  const secilenIdler = new Set(selected.map((p) => p.id));
  const adaylar = gecikmeli
    ? (sorgu.data?.items ?? []).filter((p) => !secilenIdler.has(p.id))
    : [];

  function ekle(p: ProductSearchOut) {
    onChange(multiple ? [...selected, p] : [p]);
    setTerim("");
    setGecikmeli("");
  }

  function cikar(id: number) {
    onChange(selected.filter((p) => p.id !== id));
  }

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
          {label}
        </span>
        <input
          className="input"
          type="search"
          value={terim}
          onChange={(e) => setTerim(e.target.value)}
          placeholder="Başlık, yazar, yayınevi, ISBN veya SKU"
        />
      </label>

      {gecikmeli && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700">
          {sorgu.isLoading ? (
            <p className="px-3 py-2 text-xs text-slate-500">Aranıyor…</p>
          ) : adaylar.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-500">
              Eşleşen ürün bulunamadı.
            </p>
          ) : (
            <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
              {adaylar.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => ekle(p)}
                    className="block w-full px-3 py-2 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-800/60"
                  >
                    <span className="block text-sm text-slate-800 dark:text-slate-200">
                      {p.title}
                    </span>
                    {/* SKU ve künye teyit içindir: aynı adlı iki baskı
                        birbirinden ancak bunlarla ayrılır. */}
                    <span className="block text-xs text-slate-500">
                      {[p.sku, p.author, p.publisher, p.isbn]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {selected.length > 0 && (
        <ul
          aria-label="Seçilen ürünler"
          className="space-y-1 rounded-xl border border-slate-200 p-2 dark:border-slate-700"
        >
          {selected.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-800/60"
            >
              <span className="min-w-0 flex-1 truncate text-xs text-slate-700 dark:text-slate-200">
                {p.title}
                {p.sku && <span className="text-slate-400"> · {p.sku}</span>}
              </span>
              <button
                type="button"
                onClick={() => cikar(p.id)}
                className="shrink-0 text-xs font-medium text-rose-500 hover:underline"
              >
                Kaldır
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
