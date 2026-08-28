/**
 * ── MAĞAZA VİTRİNİ — KODDA YAŞAR (kullanıcı kararı, 28 Ağu 2026) ──
 *
 * CMS/Puck/panel yönetimi SÖKÜLDÜ: vitrin artık bu dosyadır. Değişiklik
 * akışı: kullanıcı tarif eder → bu bileşen düzenlenir → anında yayında.
 * Taslak/yayınla/sürüm kavramı yok; API isteği yok (sıfır istekle çizilir);
 * görseller `public/vitrin/` altında depoyla birlikte yaşar.
 *
 * Desen: Amazon ana sayfa anatomisi —
 *   • tam genişlik HERO, alta doğru sayfa zeminine (slate-50) gradient fade,
 *   • üzerine binen (overlap) KENARLIKSIZ beyaz kartlar: 21px kalın başlık
 *     (#0F1111), görsel(ler), en altta #007185 → hover #C7511F CTA linki.
 */
import { Link } from "react-router-dom";

import { ROUTES } from "@/lib/routes";

const KART_GORSEL_SINIFI = "h-full w-full object-cover";

interface VitrinKarti {
  baslik: string;
  gorsel: string;
  alt: string;
  link: string;
  cta: string;
}

/** Kart içerikleri — düzenlenecek yer burası. Linkler gerçek kategori/rota. */
const KARTLAR: VitrinKarti[] = [
  {
    baslik: "Okula dönüş sezonu",
    gorsel: "/vitrin/kart-cantalar.webp",
    alt: "Okula dönüş ürünleri",
    link: "/magaza/okula-donus",
    cta: "Kampanyayı keşfet",
  },
  {
    baslik: "YKS hazırlık kaynakları",
    gorsel: "/vitrin/kart-suluk.webp",
    alt: "YKS hazırlık kitapları",
    link: `${ROUTES.store}?category=57`,
    cta: "YKS kitaplarına git",
  },
  {
    baslik: "LGS kitapları",
    gorsel: "/vitrin/kart-beslenme.webp",
    alt: "LGS hazırlık kitapları",
    link: `${ROUTES.store}?category=58`,
    cta: "LGS kitaplarına git",
  },
  {
    baslik: "Defter ve ajandalar",
    gorsel: "/vitrin/kart-resim-malzemeleri.webp",
    alt: "Defter ve ajandalar",
    link: `${ROUTES.store}?category=67`,
    cta: "Defterlere göz at",
  },
];

function AmazonKart({ kart }: { kart: VitrinKarti }) {
  return (
    <div className="flex flex-col bg-white p-5 pb-4 shadow-[0_2px_5px_rgba(15,17,17,0.08)]">
      <h2 className="text-[21px] font-bold leading-[27px] text-[#0F1111]">{kart.baslik}</h2>
      <Link to={kart.link} className="mt-3 block flex-1">
        <div className="aspect-[1/1.05] overflow-hidden bg-white">
          <img src={kart.gorsel} alt={kart.alt} loading="lazy" className={KART_GORSEL_SINIFI} />
        </div>
      </Link>
      <Link
        to={kart.link}
        className="mt-4 block text-[13px] leading-[19px] text-[#007185] hover:text-[#C7511F] hover:underline"
      >
        {kart.cta}
      </Link>
    </div>
  );
}

export function AnaVitrin() {
  return (
    <div>
      {/* ── Hero: tam genişlik + alta gradient fade ── */}
      <section aria-label="Okula dönüş kampanyası" className="relative overflow-hidden">
        <Link to="/magaza/okula-donus" className="block">
          <img
            src="/vitrin/hero-okula-donus.webp"
            alt="Okula dönüş kampanyası"
            {...{ fetchpriority: "high" }}
            className="h-auto w-full object-cover"
          />
        </Link>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-b from-transparent to-slate-50"
        />
      </section>

      {/* ── Hero üzerine binen Amazon kartları ── */}
      <section
        aria-label="Öne çıkan bölümler"
        className="relative z-30 mx-auto -mt-16 w-full max-w-[1464px] px-4 sm:-mt-24 md:-mt-40 md:px-8"
      >
        <div className="grid items-stretch gap-5 sm:grid-cols-2 md:grid-cols-4">
          {KARTLAR.map((kart) => (
            <AmazonKart key={kart.baslik} kart={kart} />
          ))}
        </div>
      </section>
    </div>
  );
}
