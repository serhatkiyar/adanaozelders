import { Icon } from "@/components/AppIcon";
import type { Education } from "@/types";

/**
 * Öğretmen profilinde "Özgeçmiş" — Preply deseni (kullanıcı kararı, 23 Eyl
 * 2026). Bugün yalnız eğitim bilgisi tutulduğu için tek sekme ("Eğitim") var;
 * deneyim/sertifika verisi eklenirse sekmeleri buraya gelir.
 *
 * Diploma DOSYASI burada yok (public yanıtta da yok); yalnız doğrulama durumu.
 *
 * ŞU AN KULLANILMIYOR (kullanıcı kararı, 23 Eyl 2026: "şimdilik koymayalım,
 * sonra tekrar düşünürüm"). Profile geri eklemek için değerlendirmelerin
 * altına `<OzgecmisBolumu educations={tutor.educations} />` yeterli.
 */

const BELGE_ETIKETI: Record<string, string> = {
  DIPLOMA: "Diploma doğrulandı",
  DENKLIK: "Denklik belgesi doğrulandı",
  OGRENCI_BELGESI: "Öğrenci belgesi doğrulandı",
};

export function yilAraligi(bas?: number | null, bit?: number | null): string {
  if (bas && bit) return `${bas} — ${bit}`;
  return String(bas ?? bit ?? "");
}

export function OzgecmisBolumu({ educations }: { educations: Education[] | undefined }) {
  if (!educations || educations.length === 0) return null;
  // En yeni önce; yılı olmayan en sona.
  const sirali = [...educations].sort(
    (a, b) => (b.end_year ?? b.start_year ?? -1) - (a.end_year ?? a.start_year ?? -1)
  );

  return (
    <section aria-labelledby="ozgecmis-baslik">
      <h2 id="ozgecmis-baslik" className="text-xl font-bold text-slate-900">
        Özgeçmiş
      </h2>
      <div className="mt-3 border-b border-slate-200">
        <span className="inline-block border-b-2 border-marka px-3 pb-2.5 text-sm font-semibold text-slate-900">
          Eğitim
        </span>
      </div>
      <ul className="mt-2">
        {sirali.map((e) => {
          const alt = [e.degree, e.field_of_study].filter(Boolean).join(" · ");
          return (
            <li key={e.id} className="grid grid-cols-[6.5rem_1fr] gap-4 py-4 sm:grid-cols-[8rem_1fr]">
              <p className="text-sm tabular-nums text-slate-600">
                {yilAraligi(e.start_year, e.end_year)}
              </p>
              <div className="min-w-0">
                <p className="text-base text-slate-900">{e.school_name}</p>
                {alt && <p className="mt-1 text-sm text-slate-500">{alt}</p>}
                {e.verification_status === "VERIFIED" && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
                    <Icon name="checkmarkCircleFilled" className="h-4 w-4" />
                    {BELGE_ETIKETI[e.document_type ?? "DIPLOMA"] ?? BELGE_ETIKETI.DIPLOMA}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
