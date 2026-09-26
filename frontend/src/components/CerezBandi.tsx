import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { PlainButton } from "@/components/ui/PlainButton";
import { reklamEtiketleriniBaslat } from "@/lib/analytics";
import {
  cerezBandiAcilinca,
  cerezTercihi,
  cerezTercihiKaydet,
  type CerezTercihi,
} from "@/lib/cerezOnayi";
import { ROUTES } from "@/lib/routes";

/**
 * Alt bant: Kabul et / Reddet. Kabulde analitik ve reklam etiketleri
 * (GA4, Meta Pixel, Clarity) o an yüklenir; retle hiçbiri yüklenmez.
 * Telefonda alt sekme çubuğunun ÜSTÜNDE durur (`--alt-serit`).
 */
export function CerezBandi() {
  const [acik, setAcik] = useState(() => cerezTercihi() === null);

  useEffect(() => cerezBandiAcilinca(() => setAcik(true)), []);

  if (!acik) return null;

  const sec = (t: CerezTercihi) => {
    cerezTercihiKaydet(t);
    if (t === "kabul") reklamEtiketleriniBaslat();
    setAcik(false);
  };

  return (
    <div
      role="region"
      aria-label="Çerez tercihi"
      className="fixed inset-x-3 z-[60] mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-4 shadow-lg sm:flex sm:items-center sm:gap-4"
      style={{ bottom: "calc(var(--alt-serit, 0px) + 12px)" }}
    >
      <p className="text-sm text-slate-700">
        Siteyi geliştirmek ve reklamlarımızı ölçmek için çerez kullanıyoruz.{" "}
        <Link to={ROUTES.cookiePolicy} className="font-medium text-marka-metin underline">
          Çerez politikası
        </Link>
      </p>
      <div className="mt-3 flex shrink-0 gap-2 sm:mt-0">
        <PlainButton
          onClick={() => sec("red")}
          className="min-h-[44px] flex-1 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-slate-900"
        >
          Reddet
        </PlainButton>
        <PlainButton
          onClick={() => sec("kabul")}
          className="min-h-[44px] flex-1 rounded-xl bg-marka px-4 text-sm font-semibold text-marka-fg hover:bg-marka-hover"
        >
          Kabul et
        </PlainButton>
      </div>
    </div>
  );
}
