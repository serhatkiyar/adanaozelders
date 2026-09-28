import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { PlainButton } from "@/components/ui/PlainButton";
import { reklamEtiketleriniBaslat, trackPageview } from "@/lib/analytics";
import {
  cerezBandiAcilinca,
  cerezTercihi,
  cerezTercihiKaydet,
  type CerezTercihi,
} from "@/lib/cerezOnayi";
import { ROUTES } from "@/lib/routes";

/**
 * Çerez bandı (27 Eyl 2026 yeniden tasarım, kurucu: "en çok kabul edilecek").
 *
 * Araştırma özeti (Bielova vd. USENIX 2024; Nouwens vd. 2020; Utz vd. 2019):
 * kısa, tarafsız, fayda odaklı TEK cümle; ikon/emoji yok (kararı olumsuz
 * etkileyebiliyor); ilk ekranda iki seçenek; küçük, altta, içeriği örtmeyen
 * kart. "Kabul et" birincil (turuncu dolgu, koyu yazı), "Reddet" aynı bantta
 * ve görünür ama ikincil — reddi ikinci katmana saklamak kabulü artırır ama
 * düzenleyicilerin ceza yazdığı kalıptır, bilerek yapılmadı.
 *
 * Masaüstünde alt ortada tek satır (en fazla 560px); telefonda alt sekme
 * çubuğunun (`--alt-serit`) ya da sayfanın sabit CTA şeridinin (`--sabit-serit`,
 * örn. eğitmen profilindeki "Ders talep et") üstünde; metin üstte, düğmeler altta.
 */
export function CerezBandi() {
  const [acik, setAcik] = useState(() => cerezTercihi() === null);
  const [gorunur, setGorunur] = useState(false);

  useEffect(() => cerezBandiAcilinca(() => setAcik(true)), []);

  // Sayfa çizildikten sonra aşağıdan hafif kayarak gelsin.
  useEffect(() => {
    if (!acik) return;
    const id = window.setTimeout(() => setGorunur(true), 400);
    return () => window.clearTimeout(id);
  }, [acik]);

  if (!acik) return null;

  const sec = (t: CerezTercihi) => {
    cerezTercihiKaydet(t);
    if (t === "kabul") {
      reklamEtiketleriniBaslat();
      // Onay sayfa açıkken verildi: bulunulan sayfa da sayılsın.
      trackPageview(window.location.pathname);
    }
    setAcik(false);
    setGorunur(false);
  };

  return (
    <div
      role="region"
      aria-label="Çerez tercihi"
      className={`fixed inset-x-3 z-[60] mx-auto max-w-[560px] rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.12)] transition-all duration-200 ease-out motion-reduce:transition-opacity sm:flex sm:items-center sm:gap-4 ${
        gorunur ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0 motion-reduce:translate-y-0"
      }`}
      style={{ bottom: "calc(var(--alt-serit, 0px) + var(--sabit-serit, 0px) + 12px)" }}
    >
      <p className="text-sm leading-5 text-slate-800 sm:flex-1">
        Deneyimini iyileştirmek için{" "}
        <Link to={ROUTES.cookiePolicy} className="underline decoration-slate-300 underline-offset-2 hover:decoration-slate-600">
          çerez
        </Link>{" "}
        kullanıyoruz.
      </p>
      <div className="mt-3 flex shrink-0 items-center gap-2 sm:mt-0">
        <PlainButton
          onClick={() => sec("red")}
          className="min-h-[40px] flex-1 rounded-xl px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 sm:flex-none"
        >
          Reddet
        </PlainButton>
        <PlainButton
          onClick={() => sec("kabul")}
          className="min-h-[40px] flex-[2] rounded-xl bg-marka px-5 text-sm font-semibold text-marka-fg transition-colors hover:bg-marka-hover sm:flex-none"
        >
          Kabul et
        </PlainButton>
      </div>
    </div>
  );
}
