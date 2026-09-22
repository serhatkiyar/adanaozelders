import { Link } from "react-router-dom";

import type { DersSayfasiVerisi, SeoBaglanti } from "@/api/seo";
import { JsonLd } from "@/components/JsonLd";
import { PublicShell } from "@/components/PublicShell";
import { Seo } from "@/components/Seo";
import { TutorCard } from "@/components/TutorCard";
import {
  ACIKLAMA,
  BOLUM_BASLIGI,
  DUGME_IKINCIL,
  KUCUK_ACIKLAMA,
  SAYFA_BASLIGI,
} from "@/components/pano/stil";
import { formatTRY } from "@/lib/money";

/**
 * Ders ve ilçe+ders sayfası (Modül 6) — `/matematik-ozel-ders`,
 * `/seyhan/matematik-ozel-ders`.
 *
 * Bütün metin (başlık, özet, SSS) ve sayılar sunucudan gelir; ön-çizilmiş
 * HTML de aynı yanıttan üretilir (`backend/services/on_cizim.py`), yani
 * sayfa açıldığında kullanıcının gördüğü içerik ile arama motorunun okuduğu
 * içerik aynıdır. Sayfa yalnız en az bir yayındaki öğretmen varsa açılır;
 * boş sayfa hiç çizilmez (sunucu 404 verir).
 *
 * Kartlar mevcut `TutorCard`: başlığı eğitmenin İLAN BAŞLIĞIDIR ve ilan
 * adresine gider (Superprof modeli).
 */
export function DersSayfasi({ veri }: { veri: DersSayfasiVerisi }) {
  const ist = veri.istatistik;
  const olculer: string[] = [`${ist.egitmen_sayisi} öğretmen`];
  if (ist.ortalama_ucret != null) {
    olculer.push(`Ortalama saatlik ${formatTRY(ist.ortalama_ucret)}`);
  }
  if (ist.yuz_yuze_sayisi) olculer.push(`${ist.yuz_yuze_sayisi} yüz yüze`);
  if (ist.online_sayisi) olculer.push(`${ist.online_sayisi} online`);
  if (ist.ortalama_puan != null && ist.yorum_sayisi) {
    olculer.push(`${ist.ortalama_puan.toFixed(1)} puan · ${ist.yorum_sayisi} yorum`);
  }

  return (
    <PublicShell>
      <Seo title={veri.baslik} tamBaslik description={veri.aciklama} canonicalPath={veri.yol}>
        <JsonLd data={veri.json_ld} />
      </Seo>

      <div className="mx-auto max-w-[76rem] px-4 pb-16 pt-6 sm:pt-8">
        <nav aria-label="Sayfa konumu" className={KUCUK_ACIKLAMA}>
          <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {veri.kirintilar.map((k, i) => {
              const son = i === veri.kirintilar.length - 1;
              return (
                <li key={k.yol} className="flex items-center gap-1.5">
                  {son ? (
                    <span aria-current="page" className="text-slate-900">
                      {k.ad}
                    </span>
                  ) : (
                    <>
                      <Link to={k.yol} className="hover:text-slate-900 hover:underline">
                        {k.ad}
                      </Link>
                      <span aria-hidden className="text-slate-400">
                        /
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <header className="mt-4 max-w-3xl">
          <h1 className={SAYFA_BASLIGI}>{veri.h1}</h1>
          <p className={`mt-3 ${ACIKLAMA}`}>{veri.ozet}</p>
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Özet sayılar">
            {olculer.map((o) => (
              <li
                key={o}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-700"
              >
                {o}
              </li>
            ))}
          </ul>
        </header>

        <section className="mt-8" aria-labelledby="ders-ogretmenleri">
          <h2 id="ders-ogretmenleri" className={BOLUM_BASLIGI}>
            {veri.ders_adi} öğretmenleri
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4">
            {veri.egitmenler.map((t) => (
              <TutorCard key={t.id} tutor={t} />
            ))}
          </div>
          <div className="mt-6">
            <Link to={veri.arama_yolu} className={DUGME_IKINCIL}>
              Tüm öğretmenleri gör
            </Link>
          </div>
        </section>

        <Baglantilar baslik="İlçelere göre" liste={veri.ilceler} />
        <Baglantilar baslik="İlgili dersler" liste={veri.ilgili_dersler} />

        {veri.sss.length > 0 && (
          <section className="mt-10 max-w-3xl" aria-labelledby="ders-sss">
            <h2 id="ders-sss" className={BOLUM_BASLIGI}>
              Sık sorulan sorular
            </h2>
            <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
              {veri.sss.map((s) => (
                <details key={s.soru} className="group py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium text-slate-800">
                    {s.soru}
                    <span
                      aria-hidden
                      className="shrink-0 text-slate-400 transition-transform group-open:rotate-180"
                    >
                      ▾
                    </span>
                  </summary>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.cevap}</p>
                </details>
              ))}
            </div>
          </section>
        )}
      </div>
    </PublicShell>
  );
}

function Baglantilar({ baslik, liste }: { baslik: string; liste: SeoBaglanti[] }) {
  if (!liste.length) return null;
  return (
    <section className="mt-10">
      <h2 className={BOLUM_BASLIGI}>{baslik}</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {liste.map((b) => (
          <li key={b.yol}>
            <Link
              to={b.yol}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 transition hover:border-slate-900 md:min-h-0 md:py-2"
            >
              {b.ad}
              {b.egitmen_sayisi != null && (
                <span className="text-slate-500">({b.egitmen_sayisi})</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
