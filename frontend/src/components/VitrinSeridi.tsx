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

/**
 * KART SAYISI — BİRER BİRER ARTAR (kullanıcı kararı, 16 Eyl 2026, Airbnb
 * deseni): 744 altında 2 kart + üçüncünün 24px ucu; sonra her eşikte bir
 * kart daha: 744→3, 950→4, 1130→5, 1440→6, 1640→7. Aralıkta kart rayı
 * doldurur; eşik geçilince sayı artar, kartlar küçülüp yeniden büyür.
 * Formüldeki sabitler (n−1)×boşluk; boşluk 744 altında 12px, üstünde 20px.
 *
 * HİZA: kap üst barla AYNI kaptır (`max-w-screen-2xl px-4 md:px-8`,
 * `PublicNavbar`/`DashboardHeader`). Kartların sol kenarı logonun, sağ kenarı
 * "Giriş Yap"ın hizasında biter — Airbnb'de de ray sayfa oluğuyla hizalı.
 * Önceki 1760px'lik kap barla hizasızdı (kullanıcı itirazı).
 */
const VITRIN_KART =
  "shrink-0 snap-start w-[calc((100%-48px)/2)] min-[744px]:w-[calc((100%-40px)/3)] min-[950px]:w-[calc((100%-60px)/4)] min-[1130px]:w-[calc((100%-80px)/5)] min-[1440px]:w-[calc((100%-100px)/6)] min-[1640px]:w-[calc((100%-120px)/7)]";
/**
 * Rayın kabı = üst barın kabı (hiza). Üst bar `max-w-screen-2xl px-4 md:px-8`
 * (1536px, oluk 16/32). Vitrin ise sayfa gövdesinin İÇİNDE ve gövdenin kendi
 * oluğu var (`main`: px-4, sm:px-6). O oluk telafi edilir:
 *   < 640   gövde 16 + kap 0  = 16 (üst bar 16)
 *   640–767 gövde 24, üst bar 16 → kap 8px dışarı taşar (-mx-2)
 *   ≥ 768   gövde 24 + kap 8  = 32 (üst bar 32); azami genişlik 1536−48
 * Ölçüldü (16 Eyl 2026): önceki kap barla 24px hizasızdı (kullanıcı itirazı).
 */
const VITRIN_KAP =
  "mx-auto w-full max-w-[1488px] px-0 sm:-mx-2 sm:w-[calc(100%+16px)] md:mx-auto md:w-full md:px-2";
/** Rayın boşluk/snap sınıfları — kart formülüyle AYNI sayılar. */
const VITRIN_RAY = "snap-x snap-mandatory gap-3 pb-2 min-[744px]:snap-none min-[744px]:gap-5";

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

/**
 * Şeridin SON kartı: üst üste binmiş bir kart destesi + altında ortalanmış
 * "Tümünü Görüntüle" (kullanıcı kararı, 11 Eyl 2026).
 *
 * Şeridin sonuna kadar kaydıran kullanıcı zaten "devamı var mı" diye
 * bakıyordu; oysa tamamına giden tek kapı başlığın yanındaki küçük ok
 * düğmesiydi — yani kaydırmayı bitiren kişi en uzak noktadaydı. Deste
 * gerçek eğitmen fotoğraflarından kurulur: arkada daha çok kişi olduğunu
 * boş bir kutu değil, yüzler söyler.
 */
function TumunuGorKarti({
  href,
  gorseller,
  etiket,
}: {
  href: string;
  /** Destedeki kareler — üstteki üç kaydın görseli (yoksa baş harfi). */
  gorseller: { anahtar: string | number; src: string | null; harf: string }[];
  etiket: string;
}) {
  return (
    <Link
      to={href}
      aria-label={etiket}
      className="group mx-auto flex h-full w-full max-w-[310px] flex-col"
    >
      {/* Kare alan gerçek kartın fotoğraf alanıyla AYNI: deste ortada durur,
          satırın hizası bozulmaz. */}
      <div className="relative aspect-square w-full">
        {gorseller.map((g, i) => {
          /* Yelpaze: ortadaki düz ve ÜSTTE, yanlar dışa doğru dönük. Sıra
             ortadan başlamazsa üstteki kare kenardakinin altında kalıyor. */
          const orta = (gorseller.length - 1) / 2;
          const sapma = i - orta;
          return (
            <span
              key={g.anahtar}
              className="absolute left-1/2 top-1/2 grid h-[58%] w-[58%] place-items-center overflow-hidden rounded-2xl bg-marka-soft text-2xl font-semibold text-marka-metin shadow-md ring-2 ring-white transition-transform duration-300 group-hover:scale-[1.03]"
              style={{
                /* Kaydırma YÜZDE: `px` verilseydi yelpaze 157px'lik telefon
                   kartında geniş, 250px'lik masaüstü kartında dar görünürdü —
                   yüzde karenin kendi boyutuna göre ölçekleniyor. */
                transform: `translate(-50%, -50%) translateX(${sapma * 30}%) rotate(${sapma * 9}deg)`,
                zIndex: 10 - Math.abs(Math.round(sapma * 2)),
              }}
            >
              {g.src ? (
                <img
                  src={g.src}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                g.harf
              )}
            </span>
          );
        })}
      </div>
      <p className="mt-3 text-center text-sm font-semibold text-slate-900 underline-offset-4 group-hover:underline">
        Tümünü Görüntüle
      </p>
    </Link>
  );
}

function RowSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden min-[744px]:gap-5">
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          // Genişlik gerçek kartla AYNI kaynaktan: 175px sabitken yükleme
          // bitince satır 15px yana kayıyordu (CLS).
          className={`${VITRIN_KART} h-60 animate-pulse rounded-2xl bg-slate-100`}
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
    <section aria-label="Reklam" className={VITRIN_KAP}>
      <HScroll
        className={VITRIN_RAY}
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
    <section className={VITRIN_KAP}>
      {isLoading ? (
        <>
          <div className="mb-4">
            <RowHeader heading={heading} href={href} />
          </div>
          <RowSkeleton />
        </>
      ) : (
        <HScroll
          className={VITRIN_RAY}
          etiket={heading}
          baslik={<RowHeader heading={heading} href={href} />}
        >
          {data!.map((tutor: TutorSearchOut) => (
            <div key={tutor.id} className={VITRIN_KART}>
              <TutorCard tutor={tutor} />
            </div>
          ))}
          <div className={VITRIN_KART}>
            <TumunuGorKarti
              href={href}
              etiket={`${heading}, tümünü görüntüle`}
              gorseller={data!.slice(-3).map((t: TutorSearchOut) => ({
                anahtar: t.id,
                src: t.avatar_url ?? null,
                harf: t.display_name.charAt(0).toLocaleUpperCase("tr"),
              }))}
            />
          </div>
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
    <section className={VITRIN_KAP}>
      {isLoading ? (
        <>
          <div className="mb-4">
            <RowHeader heading={heading} href={href} />
          </div>
          <RowSkeleton />
        </>
      ) : (
        <HScroll
          className={VITRIN_RAY}
          etiket={heading}
          baslik={<RowHeader heading={heading} href={href} />}
        >
          {data!.map((lib) => (
            <div key={lib.id} className={VITRIN_KART}>
              <LibraryCard library={lib} />
            </div>
          ))}
          {/* Eğitmen şeridiyle AYNI kapanış: iki şerit tasarımı ayrışamaz
              (bkz. dosya başlığı). */}
          <div className={VITRIN_KART}>
            <TumunuGorKarti
              href={href}
              etiket={`${heading}, tümünü görüntüle`}
              gorseller={data!.slice(-3).map((lib) => ({
                anahtar: lib.id,
                src: lib.cover_url ?? null,
                harf: lib.name.charAt(0).toLocaleUpperCase("tr"),
              }))}
            />
          </div>
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
