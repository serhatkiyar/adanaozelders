import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ROUTES } from "@/lib/routes";
import { magazaAramaAdresi } from "@/lib/aramaUrl";
import { searchProducts } from "@/api/store";
import { useCategories } from "@/hooks/useStore";
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
  // Amazon deseni: soldaki seçici aramayı bir kategoriye daraltır ("" = tümü).
  // URL'deki kategori BİLEREK miras alınmaz (1 Eyl): kategori sayfasında
  // gezinirken navbar'dan arama yapan kullanıcı TÜM mağazada aradığını sanır;
  // sessizce daraltmak "kitap → 0 sonuç" tuzağı üretiyordu. Daraltma yalnız
  // kullanıcının BURADAN açıkça seçtiği kategoriyle olur.
  const [catId, setCatId] = useState("");
  const { data: categories } = useCategories();
  const anaKategoriler = useMemo(
    () => (categories ?? []).filter((c) => !c.parent_id),
    [categories]
  );
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
    if (t) setHistory(addSearchHistory(t));
    go(magazaAramaAdresi({ q: t, kategori: catId ? Number(catId) : undefined }));
  };
  // Geçmişten bir terime tıklama: kutuya yaz, başa taşı, aramayı çalıştır.
  const runHistory = (t: string) => {
    setQ(t);
    setHistory(addSearchHistory(t));
    go(magazaAramaAdresi({ q: t }));
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
      {/* Amazon anatomisi (kategori seçici + kutu + buton) ama hap biçimde:
          köşe yok, tek yuvarlak gövde; odak halkası gövdenin tamamında. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          searchAll();
        }}
        className="flex items-stretch overflow-hidden rounded-full border border-slate-200 bg-slate-50 transition focus-within:border-marka-mid focus-within:bg-white focus-within:ring-2 focus-within:ring-marka/20"
      >
        <select
          value={catId}
          onChange={(e) => setCatId(e.target.value)}
          aria-label="Aranacak kategori"
          className="w-[5.5rem] shrink-0 cursor-pointer appearance-none border-r border-slate-200 bg-slate-100 bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%226%22%20viewBox%3D%220%200%2010%206%22%3E%3Cpath%20d%3D%22M1%201l4%204%204-4%22%20fill%3D%22none%22%20stroke%3D%22%2364748b%22%20stroke-width%3D%221.5%22%20stroke-linecap%3D%22round%22%2F%3E%3C%2Fsvg%3E')] bg-[length:10px_6px] bg-[position:right_0.9rem_center] bg-no-repeat py-2.5 pl-4 pr-8 text-sm text-slate-600 outline-none transition-colors hover:bg-slate-200/70"
        >
          <option value="">Tümü</option>
          {anaKategoriler.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.name}
            </option>
          ))}
        </select>
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
          className="min-w-0 flex-1 bg-transparent py-2.5 pl-4 pr-3 text-sm text-slate-900 outline-none"
        />
        <button
          type="submit"
          aria-label="Ara"
          className="flex w-12 shrink-0 items-center justify-center bg-marka text-marka-fg transition-colors hover:bg-marka-hover"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
      </form>

      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-xl border border-slate-100 bg-white shadow-xl ">
          {suggestions.length > 0 ? (
            <>
              {suggestions.map((p, i) => (
                <Link
                  key={p.id}
                  to={ROUTES.storeProduct(p.slug)}
                  onClick={() => setOpen(false)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex items-center gap-3 px-3 py-2 transition-colors ${
                    i === active ? "bg-slate-50 " : ""
                  }`}
                >
                  <div className="flex h-12 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-100 ">
                    {p.cover_url && <img src={p.cover_url} alt="" className="h-full w-full object-contain" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-800 ">{p.title}</p>
                    {p.tutor_name && (
                      <p className="truncate text-xs text-slate-400">{p.tutor_name}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-slate-900 ">
                    {formatTL(p.price)}
                  </span>
                </Link>
              ))}
              <button
                type="button"
                onClick={searchAll}
                className="w-full border-t border-slate-100 px-3 py-2.5 text-left text-sm font-medium text-marka-metin transition-colors hover:bg-slate-50 "
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
        <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-xl border border-slate-100 bg-white shadow-xl ">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-medium text-slate-400 ">
              Son aramalar
            </span>
            <button
              type="button"
              onClick={() => setHistory(clearSearchHistory())}
              className="text-xs font-medium text-slate-400 transition-colors hover:text-slate-600 "
            >
              Tümünü temizle
            </button>
          </div>
          {history.map((h) => (
            <div
              key={h}
              className="group flex items-center transition-colors hover:bg-slate-50 "
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
                <span className="truncate text-sm text-slate-700 ">{h}</span>
              </button>
              <button
                type="button"
                aria-label={`"${h}" aramasını kaldır`}
                onClick={() => setHistory(removeSearchHistory(h))}
                className="flex shrink-0 items-center justify-center px-3 py-2 text-slate-400 transition-colors hover:text-slate-700 "
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
