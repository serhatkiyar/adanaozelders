import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { PublicShell } from "@/components/PublicShell";
import { Seo } from "@/components/Seo";
import { FAQ, allFaqItems } from "@/lib/faqContent";
import { ROUTES } from "@/lib/routes";

/**
 * Sıkça Sorulan Sorular. İçerik lib/faqContent.ts'te saf veri olarak durur
 * (yasal sayfalarla aynı desen) — metin değişikliği bileşene dokunmadan yapılır.
 *
 * Sayfa aynı zamanda destek yükünü azaltma aracıdır: cevapların çoğu ilgili
 * ekrana yönlendirir, böylece kullanıcı e-posta yazmadan işini halleder.
 */
export default function FaqPage() {
  const { hash } = useLocation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (hash) {
      const id = hash.slice(1);
      setOpen(id);
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    } else {
      window.scrollTo(0, 0);
    }
  }, [hash]);

  const q = query.trim().toLocaleLowerCase("tr");
  const categories = q
    ? FAQ.map((c) => ({
        ...c,
        items: c.items.filter(
          (i) =>
            i.question.toLocaleLowerCase("tr").includes(q) ||
            i.answer.some((a) => a.toLocaleLowerCase("tr").includes(q))
        ),
      })).filter((c) => c.items.length > 0)
    : FAQ;

  const total = allFaqItems().length;

  return (
    <PublicShell>
      <Seo
        title="Sıkça Sorulan Sorular"
        description="Teslimat, iade, ders rezervasyonu ve hesap işlemleri hakkında sık sorulan soruların yanıtları."
        canonicalPath={ROUTES.faq}
      />

      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Sıkça sorulan sorular
          </h1>
          <p className="mt-2 text-sm text-slate-500 ">
            Aradığını bulamazsan{" "}
            <Link
              to={ROUTES.contact}
              className="font-medium text-indigo-600 underline-offset-2 hover:underline "
            >
              bize yazabilirsin
            </Link>
            .
          </p>
        </header>

        <label className="mt-6 block">
          <span className="sr-only">Sorularda ara</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`${total} soru içinde ara…`}
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 "
          />
        </label>

        {categories.length === 0 && (
          <p className="mt-10 text-center text-sm text-slate-500 ">
            “{query}” için sonuç bulunamadı.{" "}
            <Link
              to={ROUTES.contact}
              className="font-medium text-indigo-600 hover:underline "
            >
              Sorunu bize yaz
            </Link>
            .
          </p>
        )}

        {categories.map((cat) => (
          <section key={cat.id} className="mt-10">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 ">
              {cat.title}
            </h2>
            <div className="mt-3 divide-y divide-slate-100 border-y border-slate-100 ">
              {cat.items.map((item) => {
                const isOpen = open === item.id;
                return (
                  <div key={item.id} id={item.id} className="scroll-mt-24">
                    <h3>
                      <button
                        type="button"
                        onClick={() => setOpen(isOpen ? null : item.id)}
                        aria-expanded={isOpen}
                        aria-controls={`faq-panel-${item.id}`}
                        className="flex w-full items-center justify-between gap-4 py-4 text-left"
                      >
                        <span className="text-[15px] font-medium text-slate-800 ">
                          {item.question}
                        </span>
                        <span
                          aria-hidden
                          className={`shrink-0 text-slate-400 transition-transform ${
                            isOpen ? "rotate-45" : ""
                          }`}
                        >
                          +
                        </span>
                      </button>
                    </h3>
                    {isOpen && (
                      <div id={`faq-panel-${item.id}`} className="pb-5">
                        {item.answer.map((p, i) => (
                          <p
                            key={i}
                            className="mt-2 text-sm leading-relaxed text-slate-600 first:mt-0 "
                          >
                            {p}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </PublicShell>
  );
}
