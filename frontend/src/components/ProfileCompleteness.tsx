import { Link } from "react-router-dom";
import { useMyEducations } from "@/hooks/useEducations";
import { DUGME_SATIR_BIRINCIL, ETIKET, KART, KUCUK_ACIKLAMA } from "@/components/pano/stil";
import { parseMoney } from "@/lib/money";
import { ROUTES, profilimBolumu, type ProfilimBolumu } from "@/lib/routes";
import type { TutorOut } from "@/types";

/**
 * İlan tamamlanma göstergesi.
 *
 * DİPLOMA MADDESİ 5 Eyl 2026'da ZORUNLU OLMAKTAN ÇIKTI: yayın kapısı
 * kaldırıldı, belge artık "Diploması Doğrulandı" rozetinin koşulu. Listede
 * yine duruyor ama engel olarak değil kazanç olarak anlatılıyor.
 *
 * MÜSAİTLİK ve BELGE ARTIK BURADA SORULUYOR: ikisi de ilan sihirbazından
 * çıkarıldı (akış 9 adıma indi), dolayısıyla eğitmenin bunları göreceği tek
 * yer bu göstergedir. Bu yüzden panelde de (TutorDashboard) gösteriliyor,
 * yalnız /ilan-ayarlari'nda değil.
 */
export function ProfileCompleteness({
  tutor,
  showLink = true,
}: {
  tutor: TutorOut;
  showLink?: boolean;
}) {
  const { data: egitimler } = useMyEducations();
  const belgeVar = (egitimler ?? []).some(
    (e) => !!e.document_url || !!e.verification_code,
  );

  // Her madde Profilim'in hangi bölümünde dolduruluyorsa oraya bağlanır:
  // sayfa bölümlere ayrıldığından (24 Eyl 2026) eksik maddeyi aramak gerekmesin.
  const items: { label: string; done: boolean; bolum: ProfilimBolumu }[] = [
    { label: "Başlık", done: !!tutor.headline?.trim(), bolum: "aciklama" },
    { label: "Biyografi", done: !!tutor.bio?.trim(), bolum: "aciklama" },
    { label: "Ders Hakkında", done: !!tutor.lesson_info?.trim(), bolum: "aciklama" },
    { label: "Saatlik ücret", done: parseMoney(tutor.hourly_rate) !== null, bolum: "ucret" },
    { label: "Eğitim şekli", done: !!tutor.teaching_mode, bolum: "hakkinda" },
    { label: "Verdiğin dersler", done: (tutor.subjects?.length ?? 0) > 0, bolum: "dersler" },
    { label: "Müsaitlik", done: (tutor.availability?.length ?? 0) > 0, bolum: "musaitlik" },
    { label: "Diploma veya belge", done: belgeVar, bolum: "egitim" },
  ];
  const doneCount = items.filter((i) => i.done).length;
  const pct = Math.round((doneCount / items.length) * 100);
  if (pct === 100) return null;

  const missing = items.filter((i) => !i.done);
  const noSubjects = (tutor.subjects?.length ?? 0) === 0;

  return (
    <div className={`${KART} ring-1 ring-marka/20`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className={ETIKET}>
          Profilini tamamla
        </h3>
        <span className="text-sm font-bold text-marka-metin ">
          %{pct}
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100 ">
        <div
          className="h-full rounded-full bg-gradient-to-r from-marka to-marka-hover transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className={`mt-3 ${KUCUK_ACIKLAMA}`}>
        Eksik:{" "}
        {missing.map((m, i) => (
          <span key={m.label}>
            {i > 0 && ", "}
            <Link to={profilimBolumu(m.bolum)} className="font-medium text-slate-900 underline underline-offset-2 hover:text-marka-metin">
              {m.label}
            </Link>
          </span>
        ))}
        .
        {noSubjects && (
          <span className="font-medium text-amber-600 ">
            {" "}
            Branş seçmeden aramada görünmezsin.
          </span>
        )}
        {/* 5 Eyl 2026: belge artık yayın kapısı DEĞİL — belgesiz ilan da
            yayınlanıyor. Bu yüzden cümle "engel" değil "kazanç" anlatır ve
            rengi uyarı (amber) değil bilgi (slate) tonundadır. */}
        {!belgeVar && (
          <span className="font-medium text-slate-600 ">
            {" "}
            Belgeni doğrulatınca profilinde "Diploması Doğrulandı" rozeti çıkar.
          </span>
        )}
      </p>
      {showLink && (
        <Link
          to={ROUTES.tutorListing}
          className={`mt-3 ${DUGME_SATIR_BIRINCIL}`}
        >
          Profilime git
        </Link>
      )}
    </div>
  );
}
