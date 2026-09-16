import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CategoryBar, type CategoryKey } from "@/components/CategoryBar";
import { BigSearch, CompactSearch } from "@/components/HeroSearch";
import { TRENDING_SEARCHES } from "@/lib/trendingSearches";
import { konumOzeti, type YerSecimi } from "@/lib/yerArama";
import { egitmenAramaAdresi, kutuphaneAramaAdresi } from "@/lib/aramaUrl";

/* ─── useNavSearch ────────────────────────────────────────────────────────
   Detay sayfalarının (eğitmen/kütüphane ilanı) navbar'ına Marketplace'teki
   arama hapını taşır. Marketplace'in aksine kendi sonuç listesi yoktur:
   submit edilince ilgili arama sayfasına (/egitmenler veya /kutuphaneler)
   query ile navigate eder. Shell'e geçilmek üzere `center` + `bottom` döner. */
export function useNavSearch(active: CategoryKey = "egitmenler") {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [district, setDistrict] = useState<string[]>([]);
  // Mahalle çapası — seçilirse arama sayfasına `?mahalle=` ile taşınır.
  const [yer, setYer] = useState<YerSecimi | null>(null);
  // Kompakt pill'e tıklayınca geniş navbar (kategoriler + büyük arama) açılır.
  const [open, setOpen] = useState(false);

  // Alan BAŞLIĞI ne arandığını söylüyor; placeholder yalnız örnek verir.
  const placeholder =
    active === "kutuphaneler" ? "Kütüphane adı giriniz" : "Ders ekleyin";
  const sagBaslik = active === "kutuphaneler" ? "Kütüphane" : "Ders";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    /*
     * Taban yol eskiden ham string'di (`"/egitmenler"`), yani `ROUTES`
     * sözleşmesinin dışındaydı; "yer yalnız yüz yüzede" kuralı da burada
     * YOKTU (Landing'de vardı). İkisi de `lib/aramaUrl` şemasından geliyor.
     */
    const konum = { yer, ilce: district };
    navigate(
      active === "kutuphaneler"
        ? kutuphaneAramaAdresi({ q, konum })
        : egitmenAramaAdresi({ q, konum })
    );
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
            parcalar={[konumOzeti({ yer, ilce: district }) ?? "", q]}
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
        yer={yer}
        setYer={setYer}
        solBaslik="Yer"
        sagBaslik={sagBaslik}
        trending={TRENDING_SEARCHES}
      />
    </div>
  ) : undefined;

  return { center, bottom, open, setOpen };
}
