import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { PublicShell } from "@/components/PublicShell";
import { Seo } from "@/components/Seo";
import { LEGAL_ROUTES } from "@/lib/routes";
import {
  LEGAL_DOCS,
  OPERATOR,
  getLegalDoc,
  type LegalBlock,
  type LegalDocId,
} from "@/lib/legalContent";

function Block({ block }: { block: LegalBlock }) {
  if (block.type === "list") {
    return (
      <ul className="mt-3 space-y-2">
        {block.items.map((item, i) => (
          <li key={i} className="flex gap-3 text-sm leading-relaxed text-slate-600 ">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-marka-mid " />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <p className="mt-3 text-sm leading-relaxed text-slate-600 ">
      {block.text}
    </p>
  );
}

const DATE_FMT = new Intl.DateTimeFormat("tr-TR", { dateStyle: "long" });

// Tüm yasal belgeler için ortak sayfa: sol tarafta belgeler arası gezinme,
// sağda anchor'lı bölümler. İçerik lib/legalContent.ts'ten gelir (saf veri).
export default function LegalPage({ doc: docId }: { doc: LegalDocId }) {
  const doc = getLegalDoc(docId);
  const { hash } = useLocation();

  // Belge değişince başa dön; hash varsa ilgili bölüme kaydır.
  useEffect(() => {
    if (hash) {
      document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
    } else {
      window.scrollTo(0, 0);
    }
  }, [docId, hash]);

  return (
    <PublicShell>
      <Seo title={doc.title} description={doc.description} canonicalPath={LEGAL_ROUTES[doc.id]} />

      <div className="mx-auto max-w-6xl px-2 py-6 sm:py-10">
        <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
          {/* ── Sol: belgeler arası gezinme ── */}
          <aside className="lg:w-64 lg:shrink-0">
            <p className="px-1 text-xs font-semibold uppercase tracking-widest text-slate-400 ">
              Yasal
            </p>
            <nav className="mt-3 flex flex-row flex-wrap gap-1.5 lg:sticky lg:top-6 lg:flex-col">
              {LEGAL_DOCS.map((d) => (
                <Link
                  key={d.id}
                  to={LEGAL_ROUTES[d.id]}
                  className={`rounded-xl px-3.5 py-2 text-sm font-medium transition ${
                    d.id === doc.id
                      ? "bg-marka text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-100 "
                  }`}
                >
                  {d.title}
                </Link>
              ))}
            </nav>
          </aside>

          {/* ── Sağ: belge içeriği ── */}
          <article className="min-w-0 flex-1">
            <header className="border-b border-slate-200 pb-6 ">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                {doc.title}
              </h1>
              <p className="mt-2 text-xs text-slate-400 ">
                Son güncelleme: {DATE_FMT.format(new Date(`${doc.updatedAt}T00:00:00`))}
              </p>
            </header>

            {/* Bölüm içindekiler (anchor) */}
            <nav className="mt-6 rounded-2xl bg-slate-100/70 p-4 ">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 ">
                İçindekiler
              </p>
              <ol className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {doc.sections.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="text-sm text-marka transition hover:text-marka-hover "
                    >
                      {s.heading}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="mt-2 divide-y divide-slate-100 ">
              {doc.sections.map((s) => (
                <section key={s.id} id={s.id} className="scroll-mt-24 py-6">
                  <h2 className="text-base font-bold text-slate-900 ">
                    {s.heading}
                  </h2>
                  {s.blocks.map((b, i) => (
                    <Block key={i} block={b} />
                  ))}
                </section>
              ))}
            </div>

            <footer className="mt-4 rounded-2xl bg-marka-soft/60 p-5 text-sm text-slate-600 ring-1 ring-marka/20 ">
              Sorularınız için bize{" "}
              <a
                href={`mailto:${OPERATOR.email}`}
                className="font-semibold text-marka hover:text-marka-hover "
              >
                {OPERATOR.email}
              </a>{" "}
              adresinden ulaşabilirsiniz.
            </footer>
          </article>
        </div>
      </div>
    </PublicShell>
  );
}
