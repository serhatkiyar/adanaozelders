import { Link } from "react-router-dom";

import { usePopulerDersler } from "@/hooks/useSeo";

/**
 * En çok öğretmeni olan derslerin sayfalarına iç bağlantı (Modül 6).
 *
 * Amaç arama motorunun ders sayfalarını BULMASI: sitemap tek başına yetmez,
 * Google iç bağlantısı olan sayfaya daha çok güvenir. Liste sunucuda
 * hesaplanır (yalnız en az bir yayındaki öğretmeni olan dersler); veri
 * yoksa ya da istek düşerse hiçbir şey çizilmez — sabit/uydurma liste yok.
 * Footer'daki sütun aynı sorguyu (`usePopulerDersler`) kendi içinde çizer.
 */
export function PopulerDersler({ limit = 8 }: { limit?: number }) {
  const { data } = usePopulerDersler(limit);
  if (!data?.length) return null;

  return (
    <section aria-labelledby="populer-dersler" className="-mx-4 sm:-mx-6">
      <div className="mx-auto w-full max-w-screen-2xl px-4 md:px-8">
        <h2
          id="populer-dersler"
          className="text-xl font-bold tracking-tight text-slate-900"
        >
          Popüler dersler
        </h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {data.map((d) => (
            <li key={d.yol}>
              <Link
                to={d.yol}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 transition hover:border-slate-900 md:min-h-0 md:py-2"
              >
                {d.ad} özel ders
                <span className="text-slate-500">({d.egitmen_sayisi})</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
