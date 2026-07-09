import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CategoryBar, type CategoryKey } from "@/components/CategoryBar";
import { BigSearch, CompactSearch } from "@/components/HeroSearch";
import { TRENDING_SEARCHES } from "@/lib/trendingSearches";

/* ─── useNavSearch ────────────────────────────────────────────────────────
   Detay sayfalarının (eğitmen/kütüphane ilanı) navbar'ına Marketplace'teki
   arama hapını taşır. Marketplace'in aksine kendi sonuç listesi yoktur:
   submit edilince ilgili arama sayfasına (/egitmenler veya /kutuphaneler)
   query ile navigate eder. Shell'e geçilmek üzere `center` + `bottom` döner. */
export function useNavSearch(active: CategoryKey = "egitmenler") {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [district, setDistrict] = useState<string[]>([]);
  // Kompakt pill'e tıklayınca geniş navbar (kategoriler + büyük arama) açılır.
  const [open, setOpen] = useState(false);

  const placeholder =
    active === "kutuphaneler"
      ? "Kütüphane ara…"
      : "Ders ara… (ör. Lise Matematik)";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim());
    district.forEach((d) => sp.append("district", d));
    const base = active === "kutuphaneler" ? "/kutuphaneler" : "/egitmenler";
    navigate(sp.toString() ? `${base}?${sp}` : base);
    setOpen(false);
  };

  /* ── Navbar ortası: kapalı → kompakt pill, açık → kategori çubuğu. ── */
  const center = (
    <div
      key={open ? "cats" : "compact"}
      className="w-full animate-in fade-in duration-300"
    >
      {open ? (
        <CategoryBar active={active} />
      ) : (
        <div className="flex w-full justify-center">
          <CompactSearch
            active={active}
            placeholder={placeholder}
            q={q}
            district={district}
            onOpen={() => setOpen(true)}
          />
        </div>
      )}
    </div>
  );

  /* ── Navbar altı: yalnız açıkken büyük arama hapı; kapalıyken satır yok. ── */
  const bottom = open ? (
    <div className="flex justify-center px-4 pb-3 pt-1 sm:px-6">
      <BigSearch
        q={q}
        setQ={setQ}
        district={district}
        setDistrict={setDistrict}
        onSubmit={submit}
        placeholder={placeholder}
        trending={TRENDING_SEARCHES}
      />
    </div>
  ) : undefined;

  return { center, bottom, open, setOpen };
}
