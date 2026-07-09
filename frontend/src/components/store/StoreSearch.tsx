import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ROUTES } from "@/lib/routes";
import { searchProducts } from "@/api/store";
import { useDebounce } from "@/hooks/useDebounce";
import { formatTL } from "@/lib/money";
import {
  addSearchHistory,
  clearSearchHistory,
  getSearchHistory,
  removeSearchHistory,
} from "@/lib/storeSearchHistory";

/**
 * Mağaza arama çubuğu + canlı öneriler (typeahead). Mevcut `searchProducts`'ı
 * kullanır (backend değişmez); debounce'lu, küçük resimli, klavye-gezinmeli
 * (↑/↓/Enter/Esc), dışına tıkla kapanır. Enter → /magaza?q=, öneri → ürün sayfası.
 */
export function StoreSearch() {
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [history, setHistory] = useState<string[]>(() => getSearchHistory());
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const debounced = useDebounce(q);
  const term = debounced.trim();

  const { data: suggestions = [], isFetching } = useQuery({
    queryKey: ["store", "suggest", term],
    queryFn: () => searchProducts({ q: term, limit: 6 }),
    enabled: term.length >= 2,
    staleTime: 30_000,
  });

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const showDropdown = open && term.length >= 2;
  // Arama çubuğu boşken tekrar odaklanınca son aramalar gösterilir.
  const showHistory = open && q.trim().length === 0 && history.length > 0;

  const go = (to: string) => {
    setOpen(false);
    setActive(-1);
    navigate(to);
  };
  const searchAll = () => {
    const t = q.trim();
    if (t) {
      setHistory(addSearchHistory(t));
      go(`${ROUTES.store}?q=${encodeURIComponent(t)}`);
    } else {
      go(ROUTES.store);
    }
  };
  // Geçmişten bir terime tıklama: kutuya yaz, başa taşı, aramayı çalıştır.
  const runHistory = (t: string) => {
    setQ(t);
    setHistory(addSearchHistory(t));
    go(`${ROUTES.store}?q=${encodeURIComponent(t)}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === "Enter") {
      if (active >= 0 && suggestions[active]) {
        e.preventDefault();
        go(ROUTES.storeProduct(suggestions[active].slug));
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="relative mx-auto w-full max-w-2xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          searchAll();
        }}
        className="relative"
      >
        <input
          type="text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Ürün, kategori veya yazar ara..."
          aria-label="Mağazada ara"
          autoComplete="off"
          className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-4 pr-14 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-indigo-500 dark:focus:ring-indigo-500/20"
        />
        <button
          type="submit"
          aria-label="Ara"
          className="absolute inset-y-0 right-0 flex aspect-square items-center justify-center rounded-r-lg bg-slate-900 text-white transition-colors hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
      </form>

      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-xl border border-slate-100 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800">
          {suggestions.length > 0 ? (
            <>
              {suggestions.map((p, i) => (
                <Link
                  key={p.id}
                  to={ROUTES.storeProduct(p.slug)}
                  onClick={() => setOpen(false)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex items-center gap-3 px-3 py-2 transition-colors ${
                    i === active ? "bg-slate-50 dark:bg-slate-700/50" : ""
                  }`}
                >
                  <div className="flex h-12 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-100 dark:bg-slate-700">
                    {p.cover_url && <img src={p.cover_url} alt="" className="h-full w-full object-contain" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-800 dark:text-slate-200">{p.title}</p>
                    {p.tutor_name && (
                      <p className="truncate text-xs text-slate-400">{p.tutor_name}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-slate-900 dark:text-white">
                    {formatTL(p.price)}
                  </span>
                </Link>
              ))}
              <button
                type="button"
                onClick={searchAll}
                className="w-full border-t border-slate-100 px-3 py-2.5 text-left text-sm font-medium text-indigo-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-indigo-400 dark:hover:bg-slate-700/50"
              >
                "{q.trim()}" için tüm sonuçlar →
              </button>
            </>
          ) : (
            <p className="px-3 py-4 text-center text-sm text-slate-500">
              {isFetching ? "Aranıyor…" : "Sonuç bulunamadı"}
            </p>
          )}
        </div>
      )}

      {showHistory && (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-xl border border-slate-100 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
              Son aramalar
            </span>
            <button
              type="button"
              onClick={() => setHistory(clearSearchHistory())}
              className="text-xs font-medium text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-300"
            >
              Tümünü temizle
            </button>
          </div>
          {history.map((h) => (
            <div
              key={h}
              className="group flex items-center transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50"
            >
              <button
                type="button"
                onClick={() => runHistory(h)}
                className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
              >
                <svg
                  className="shrink-0 text-slate-400"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="truncate text-sm text-slate-700 dark:text-slate-200">{h}</span>
              </button>
              <button
                type="button"
                aria-label={`"${h}" aramasını kaldır`}
                onClick={() => setHistory(removeSearchHistory(h))}
                className="flex shrink-0 items-center justify-center px-3 py-2 text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
