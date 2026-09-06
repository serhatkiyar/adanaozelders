import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PublicShell } from "@/components/PublicShell";
import { Seo } from "@/components/Seo";
import { submitContact } from "@/api/support";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { OPERATOR } from "@/lib/legalContent";
import { ROUTES } from "@/lib/routes";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";

/**
 * İletişim sayfası. Mesafeli satışta tüketicinin satıcıya kolayca ulaşabileceği
 * bir kanal bulundurmak zorunludur; önceden yalnız yasal metin içinde bir
 * e-posta adresi geçiyordu, arkasında hiçbir yüzey yoktu.
 *
 * Mesaj sunucuda outbox'a yazılır: SMTP anlık erişilemezse kaybolmaz.
 */
export default function ContactPage() {
  const { data: user } = useCurrentUser();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  // Oturumlu kullanıcıda alanları bir kez doldur (yeniden yazdırmayalım).
  const [prefilled, setPrefilled] = useState(false);
  if (user && !prefilled) {
    setPrefilled(true);
    setName(user.full_name ?? "");
    setEmail(user.email ?? "");
  }

  const mutation = useMutation({
    mutationFn: () =>
      submitContact({
        name: name.trim(),
        email: email.trim(),
        subject: subject.trim(),
        message: message.trim(),
      }),
    onSuccess: (res) => {
      setSent(true);
      toast.success(res.detail);
    },
    onError: (err) => toast.error(getErrorMessage(err, "Mesaj gönderilemedi.")),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  return (
    <PublicShell>
      <Seo
        title="İletişim"
        description="Adana Özel Ders ile iletişime geç: sipariş, iade, ders ve hesap konularında bize yazabilirsin."
        canonicalPath={ROUTES.contact}
      />

      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            İletişim
          </h1>
          <p className="mt-2 text-sm text-slate-500 ">
            Sorunun cevabı{" "}
            <Link
              to={ROUTES.faq}
              className="font-medium text-marka underline-offset-2 hover:underline "
            >
              sıkça sorulan sorularda
            </Link>{" "}
            olabilir, oradan daha hızlı sonuç alırsın.
          </p>
        </header>

        <div className="mt-8 grid gap-8 sm:grid-cols-[1fr_auto]">
          {sent ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 ">
              <h2 className="text-base font-semibold text-emerald-800 ">
                Mesajın bize ulaştı
              </h2>
              <p className="mt-1 text-sm text-emerald-700 ">
                En kısa sürede <strong>{email}</strong> adresine dönüş yapacağız.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSent(false);
                  setSubject("");
                  setMessage("");
                }}
                className="mt-4 text-sm font-medium text-emerald-800 underline-offset-2 hover:underline "
              >
                Yeni mesaj yaz
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700 ">
                    Adın <span className="text-red-500">*</span>
                  </span>
                  <input
                    required
                    minLength={2}
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700 ">
                    E-postan <span className="text-red-500">*</span>
                  </span>
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-sm font-medium text-slate-700 ">
                  Konu <span className="text-red-500">*</span>
                </span>
                <input
                  required
                  minLength={3}
                  maxLength={150}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Örn. 1024 numaralı siparişim hakkında"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700 ">
                  Mesajın <span className="text-red-500">*</span>
                </span>
                <textarea
                  required
                  minLength={10}
                  maxLength={4000}
                  rows={6}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
                />
                <span className="mt-1 block text-xs text-slate-400 ">
                  {message.length}/4000
                </span>
              </label>

              <button
                type="submit"
                disabled={mutation.isPending}
                className="rounded-xl bg-marka px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-marka-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {mutation.isPending ? "Gönderiliyor…" : "Mesajı gönder"}
              </button>
            </form>
          )}

          <aside className="sm:w-56">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 ">
              Bilgilerimiz
            </h2>
            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="text-slate-500 ">İşletme</dt>
                <dd className="text-slate-800 ">{OPERATOR.entity}</dd>
              </div>
              <div>
                <dt className="text-slate-500 ">Adres</dt>
                <dd className="text-slate-800 ">{OPERATOR.address}</dd>
              </div>
              <div>
                <dt className="text-slate-500 ">E-posta</dt>
                <dd>
                  <a
                    href={`mailto:${OPERATOR.email}`}
                    className="text-marka underline-offset-2 hover:underline "
                  >
                    {OPERATOR.email}
                  </a>
                </dd>
              </div>
              {/* Mesafeli satışta erişilebilir telefon zorunludur. */}
              <div>
                <dt className="text-slate-500 ">Telefon</dt>
                <dd>
                  <a
                    href={`tel:${OPERATOR.phoneHref}`}
                    className="text-marka underline-offset-2 hover:underline "
                  >
                    {OPERATOR.phone}
                  </a>
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      </div>
    </PublicShell>
  );
}
