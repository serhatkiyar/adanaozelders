/**
 * Vitrin şeritleri — yatay kart kuşağı (eğitmen ve kütüphane).
 *
 * Bu parçalar `Landing.tsx` içinde yaşıyordu. Ana sayfa 9 Eyl 2026'da tek
 * vitrine indi (sekmeler gerçek gezinmeye döndü) ve kütüphane şeritleri
 * `/kutuphaneler` sayfasına taşındı; kopyalamak yerine buraya çıkarıldı,
 * `TutorRow` da aynı yerden besleniyor — iki şerit tasarımı ayrışamaz.
 */
import { useState } from "react";
import { Link } from "react-router-dom";

import { HScroll } from "@/components/HScroll";
import { LibraryCard } from "@/components/LibraryCard";
import { TutorCard } from "@/components/TutorCard";
import { DaireBaglanti } from "@/components/ui/DaireDugme";
import { useLibrarySearch } from "@/hooks/useLibraries";
import { useFeaturedTutors, useTutorSearch } from "@/hooks/useTutorSearch";
import { egitmenAramaAdresi, kutuphaneAramaAdresi } from "@/lib/aramaUrl";
import { ROUTES } from "@/lib/routes";
import type { LibrarySearchParams } from "@/api/libraries";
import type { TutorSearchParams } from "@/api/tutors";
import type { TutorSearchOut } from "@/types";

const VITRIN_KART =
  "shrink-0 w-[190px] md:w-[calc((100%-40px)/3)] lg:w-[calc((100%-60px)/4)] xl:w-[calc((100%-80px)/5)]";

function RowHeader({ heading, href }: { heading: string; href: string }) {
  // Airbnb deseni (29 Ağu): sağdaki "Tümü →" metni yerine başlığın hemen
  // yanında gri dairesel ok butonu — tamamına o götürür.
  //
  // 7 Eyl 2026: bu blok artık `HScroll`un `baslik` yuvasına giriyor; kaydırma
  // okları aynı satırın SAĞ ucunda duruyor. Alt boşluk (`mb-4`) oraya taşındı.
  // Ok düğmesi de elle yazılmayı bıraktı: `ui/DaireDugme` ile kaydırma
  // oklarıyla AYNI kaynaktan geliyor (ölçü h-7 -> h-8 oldu, ikisi eşitlendi).
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <h2 className="truncate text-xl font-bold tracking-tight text-slate-900 ">
        {heading}
      </h2>
      <DaireBaglanti to={href} yon="ileri" aria-label={`${heading}, tümünü gör`} />
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="flex gap-5 overflow-hidden">
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          className="h-60 w-[175px] shrink-0 animate-pulse rounded-2xl bg-slate-100 "
        />
      ))}
    </div>
  );
}

export function FeaturedTutorRow() {
  const { data } = useFeaturedTutors({});
  const tutors = data ?? [];
  if (tutors.length === 0) return null;

  return (
    <section aria-label="Reklam" className="mx-auto max-w-[1216px] px-6">
      <HScroll
        className="gap-5 pb-2"
        etiket="Reklam"
        baslik={
          <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold tracking-wide text-slate-500">
              Reklam
            </h2>
            <Link
              to={ROUTES.rankingCriteria}
              className="shrink-0 text-xs text-slate-400 underline-offset-2 transition hover:text-slate-600 hover:underline"
            >
              Sıralama nasıl belirleniyor?
            </Link>
          </div>
        }
      >
        {tutors.map((tutor: TutorSearchOut) => (
          <div key={tutor.id} className={VITRIN_KART}>
            <TutorCard tutor={tutor} featured />
          </div>
        ))}
      </HScroll>
      <div className="mt-8 h-px w-full bg-slate-200" />
    </section>
  );
}

export function TutorRow({
  heading,
  params,
}: {
  heading: string;
  params: TutorSearchParams;
}) {
  const { data, isLoading } = useTutorSearch(params);

  // Boş satırı hiç gösterme (örn. o branşta eğitmen yoksa).
  if (!isLoading && (!data || data.length === 0)) return null;

  const href = egitmenAramaAdresi({
    ders: params.subject ?? [],
    sinav: params.exam ?? "",
  });

  return (
    <section className="mx-auto max-w-[1216px] px-6">
      {isLoading ? (
        <>
          <div className="mb-4">
            <RowHeader heading={heading} href={href} />
          </div>
          <RowSkeleton />
        </>
      ) : (
        <HScroll
          className="gap-5 pb-2"
          etiket={heading}
          baslik={<RowHeader heading={heading} href={href} />}
        >
          {data!.map((tutor: TutorSearchOut) => (
            <div key={tutor.id} className={VITRIN_KART}>
              <TutorCard tutor={tutor} />
            </div>
          ))}
        </HScroll>
      )}
    </section>
  );
}

export function LibraryRow({
  heading,
  params,
}: {
  heading: string;
  params: LibrarySearchParams;
}) {
  const { data, isLoading } = useLibrarySearch(params);

  if (!isLoading && (!data || data.length === 0)) return null;

  const href = kutuphaneAramaAdresi({
    konum: { yer: null, ilce: params.district ?? [] },
  });

  return (
    <section className="mx-auto max-w-[1216px] px-6">
      {isLoading ? (
        <>
          <div className="mb-4">
            <RowHeader heading={heading} href={href} />
          </div>
          <RowSkeleton />
        </>
      ) : (
        <HScroll
          className="gap-5 pb-2"
          etiket={heading}
          baslik={<RowHeader heading={heading} href={href} />}
        >
          {data!.map((lib) => (
            <div key={lib.id} className={VITRIN_KART}>
              <LibraryCard library={lib} />
            </div>
          ))}
        </HScroll>
      )}
    </section>
  );
}

/* ─── announcement banner (başka yerden de kullanılabilir) ── */

export function AnnouncementBanner() {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <div className="relative bg-marka px-4 py-2.5 text-center text-xs font-semibold text-marka-fg sm:text-sm">
      <span>
        🎓 YKS 2025 hazırlığına başla - uzman eğitmenlerle ilk dersin{" "}
        <Link to={ROUTES.tutors} className="underline underline-offset-2 hover:text-marka-fg">
          hemen randevu al →
        </Link>
      </span>
      <button
        onClick={() => setVisible(false)}
        aria-label="Kapat"
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-white/70 transition hover:text-white"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

/* Footer artık ortak `components/SiteFooter.tsx` — mağaza ve PublicShell ile
   aynı bileşen (linkler + iyzico ödeme rozeti tek yerden yönetilir). */
