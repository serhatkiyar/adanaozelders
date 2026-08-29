import { useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { PublicShell } from "@/components/PublicShell";
import { Seo } from "@/components/Seo";
import { submitTutorPreApplication } from "@/api/tutorPreApplications";
import { uniqueSubjects } from "@/lib/examTree";
import {
  SEARCH_MORE_DISTRICTS,
  SEARCH_PRIMARY_DISTRICTS,
} from "@/lib/districts";
import { normalizePhoneTR } from "@/lib/phone";
import { ROUTES } from "@/lib/routes";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";

/**
 * Eğitmen ön başvurusu — Facebook gruplarında paylaşılan hesapsız lead sayfası.
 *
 * Tek işi var: meraklı bir eğitmeni 1 dakikada telefon bırakmaya ikna etmek.
 * Trafik neredeyse tamamen mobil uygulama-içi tarayıcıdan gelir; bu yüzden
 * tek kolon, kısa form, hesap/şifre/e-posta doğrulama YOK. Tam kayıt /kayit'ta
 * kalır — buradan gelen kişiyi telefonla arayıp oraya biz taşıyoruz.
 */

const DISTRICTS = [
  ...SEARCH_PRIMARY_DISTRICTS.filter((d) => d !== "Merkez"),
  ...SEARCH_MORE_DISTRICTS,
];

const EXPERIENCE_OPTIONS = [
  { value: "universite-ogrencisi", label: "Üniversite öğrencisiyim" },
  { value: "0-2", label: "0–2 yıl" },
  { value: "3-5", label: "3–5 yıl" },
  { value: "5+", label: "5+ yıl" },
] as const;

const MAX_SUBJECTS = 10;

// Belge ekleri — backend sınırlarının aynası (MAX_DOCUMENTS / 10 MB).
const MAX_DOCS = 3;
const MAX_DOC_BYTES = 10 * 1024 * 1024;
const DOC_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf";

const STEPS = [
  {
    title: "Formu doldur",
    text: "Ad, telefon ve verdiğin dersler yeterli, 1 dakika sürer.",
  },
  {
    title: "Telefonla tanışalım",
    text: "En geç 24 saat içinde seni arıyoruz; soruların varsa bu aramada cevaplıyoruz.",
  },
  {
    title: "İlanın yayına çıksın",
    text: "Uygunsa profilini birlikte açıyoruz; Adana'daki öğrenciler sana ulaşmaya başlıyor.",
  },
];

const FAQ = [
  {
    q: "Başvuru için ücret ödeyecek miyim?",
    a: "Hayır. Ön başvuru da, platformda ilan açmak da ücretsizdir.",
  },
  {
    q: "Kimler başvurabilir?",
    a: "Öğretmenler, alanında deneyimli eğitmenler ve ders vermek isteyen üniversite öğrencileri. Uygunluğu telefon görüşmesinde birlikte netleştiriyoruz.",
  },
  {
    q: "Bilgilerim ne olacak?",
    a: "Ad, telefon ve eklediğin belgeler yalnız başvurunu değerlendirmek için kullanılır; üçüncü kişilerle paylaşılmaz.",
  },
];

interface FormErrors {
  name?: string;
  phone?: string;
  email?: string;
  subjects?: string;
  kvkk?: string;
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className={className}>
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function TutorPreApply() {
  const subjectOptions = useMemo(() => uniqueSubjects(), []);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [subjects, setSubjects] = useState<string[]>([]);
  const [docs, setDocs] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [district, setDistrict] = useState("");
  const [experience, setExperience] = useState("");
  const [note, setNote] = useState("");
  const [kvkk, setKvkk] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [sent, setSent] = useState(false);

  const errors: FormErrors = {};
  if (name.trim().length < 2) errors.name = "Adını ve soyadını yaz.";
  if (!normalizePhoneTR(phone))
    errors.phone = "Geçerli bir cep numarası gir (05XX XXX XX XX).";
  if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim()))
    errors.email = "E-posta adresi geçersiz görünüyor.";
  if (subjects.length === 0) errors.subjects = "En az bir ders seç.";
  if (!kvkk) errors.kvkk = "Başvuru için aydınlatma metnini onaylaman gerekiyor.";
  const hasErrors = Object.keys(errors).length > 0;

  const toggleSubject = (label: string) => {
    setSubjects((prev) => {
      if (prev.includes(label)) return prev.filter((s) => s !== label);
      if (prev.length >= MAX_SUBJECTS) {
        toast.error(`En fazla ${MAX_SUBJECTS} ders seçebilirsin.`);
        return prev;
      }
      return [...prev, label];
    });
  };

  const addDocs = (incoming: FileList | null) => {
    if (!incoming) return;
    const next = [...docs];
    for (const file of Array.from(incoming)) {
      if (next.length >= MAX_DOCS) {
        toast.error(`En fazla ${MAX_DOCS} belge ekleyebilirsin.`);
        break;
      }
      if (file.size > MAX_DOC_BYTES) {
        toast.error(`"${file.name}" 10 MB sınırını aşıyor.`);
        continue;
      }
      if (!next.some((f) => f.name === file.name && f.size === file.size)) {
        next.push(file);
      }
    }
    setDocs(next);
    // Aynı dosya tekrar seçilebilsin diye input sıfırlanır.
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const mutation = useMutation({
    mutationFn: () =>
      submitTutorPreApplication({
        full_name: name.trim(),
        phone: normalizePhoneTR(phone) ?? phone,
        email: email.trim() || null,
        subjects,
        district: district || null,
        experience: experience || null,
        note: note.trim() || null,
        kvkk_accepted: kvkk,
        documents: docs,
      }),
    onSuccess: () => setSent(true),
    onError: (err) =>
      toast.error(getErrorMessage(err, "Başvuru gönderilemedi. Tekrar dene.")),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (hasErrors || mutation.isPending) return;
    mutation.mutate();
  };

  // Hata metni girdiye programatik bağlanır: `role="alert"` gönderim anında
  // ekran okuyucuya duyurur, `aria-describedby` alanla ilişkilendirir.
  const fieldError = (key: keyof FormErrors) =>
    attempted && errors[key] ? (
      <p id={`hata-${key}`} role="alert" className="mt-1 text-xs text-red-600">
        {errors[key]}
      </p>
    ) : null;

  const invalid = (key: keyof FormErrors) =>
    attempted && errors[key]
      ? { "aria-invalid": true as const, "aria-describedby": `hata-${key}` }
      : {};

  return (
    <PublicShell>
      <Seo
        title="Eğitmen Ol, Ön Başvuru"
        description="Adana'da özel ders vermek isteyen öğretmen ve eğitmenler için 1 dakikalık ön başvuru. Hesap açmadan başvur, 24 saat içinde seni arayalım."
        canonicalPath={ROUTES.tutorPreApply}
      />

      <div className="mx-auto max-w-6xl px-4 py-10 sm:py-16">
        <div className="grid gap-10 lg:grid-cols-[1fr_26rem] lg:gap-16">
          {/* ── Sol: vaat + nasıl işliyor + SSS ── */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">
              Adana Özel Ders · Eğitmen ağı
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Adana'da özel ders ver,
              <br className="hidden sm:block" /> öğrenciyi biz bulalım.
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600">
              Bu bir ön başvuru: hesap açmadan, yalnız adın ve telefonunla{" "}
              <strong className="font-semibold text-slate-800">
                1 dakikada
              </strong>{" "}
              tamamlarsın. En geç 24 saat içinde seni arayıp tanışıyoruz.
            </p>

            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
              {["Başvuru ücretsiz", "Bağlayıcı değil", "24 saat içinde dönüş"].map(
                (t) => (
                  <li key={t} className="flex items-center gap-2">
                    <CheckIcon className="h-4 w-4 text-emerald-600" />
                    {t}
                  </li>
                )
              )}
            </ul>

            {/* Mobilde form aşağıda kalır; ilk ekrandan tek dokunuşla in. */}
            <a
              href="#basvuru"
              className="mt-8 inline-flex rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 lg:hidden"
            >
              Ön başvuruyu doldur
            </a>

            <section className="mt-12" aria-label="Nasıl işliyor">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Nasıl işliyor
              </h2>
              <ol className="mt-4 divide-y divide-slate-100">
                {STEPS.map((step, i) => (
                  <li key={step.title} className="flex gap-4 py-4">
                    <span
                      aria-hidden
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 text-xs font-semibold text-slate-500"
                    >
                      {i + 1}
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        {step.title}
                      </h3>
                      <p className="mt-0.5 text-sm leading-relaxed text-slate-600">
                        {step.text}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section className="mt-10" aria-label="Platformda seni ne bekliyor">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Platformda seni ne bekliyor
              </h2>
              <ul className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600">
                <li>
                  İlanın Adana'daki öğrencilere görünür; ders talepleri doğrudan
                  sana gelir.
                </li>
                <li>
                  Ders ücretin platform üzerinden güvenli tahsil edilir, ders
                  tamamlanınca bakiyene geçer.
                </li>
                <li>
                  Takvim, mesajlaşma ve ilan yönetimi tek panelde, WhatsApp
                  karmaşası yok.
                </li>
              </ul>
            </section>

            <section className="mt-10" aria-label="Sık sorulanlar">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Sık sorulanlar
              </h2>
              <div className="mt-2 divide-y divide-slate-100">
                {FAQ.map((item) => (
                  <details key={item.q} className="group py-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-slate-800 [&::-webkit-details-marker]:hidden">
                      {item.q}
                      <span
                        aria-hidden
                        className="ml-4 text-slate-400 transition group-open:rotate-45"
                      >
                        +
                      </span>
                    </summary>
                    <p className="mt-2 pr-8 text-sm leading-relaxed text-slate-600">
                      {item.a}
                    </p>
                  </details>
                ))}
              </div>
            </section>
          </div>

          {/* ── Sağ: başvuru formu ── */}
          {/* scroll-mt sticky navbar'ı hesaba katar: mobil CTA'dan gelen kayışta
              form başlığı çubuğun arkasında kalmasın. */}
          <div id="basvuru" className="scroll-mt-24 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
              {sent ? (
                <div className="py-6 text-center">
                  <span
                    aria-hidden
                    className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"
                  >
                    <CheckIcon className="h-6 w-6" />
                  </span>
                  <h2 className="mt-4 text-lg font-semibold text-slate-900">
                    Başvurun alındı
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    En geç 24 saat içinde{" "}
                    <strong className="font-semibold text-slate-800">
                      {normalizePhoneTR(phone) ?? phone}
                    </strong>{" "}
                    numarasından seni arayacağız. Görüşmede süreci anlatıp
                    soruların varsa cevaplayacağız.
                    {docs.length > 0 &&
                      ` Eklediğin ${docs.length} belge de bize ulaştı.`}
                  </p>
                  <Link
                    to={ROUTES.tutors}
                    className="mt-6 inline-block text-sm font-medium text-indigo-600 underline-offset-2 hover:underline"
                  >
                    Bu arada mevcut eğitmen ilanlarına göz at
                  </Link>
                </div>
              ) : (
                <form onSubmit={submit} noValidate className="space-y-5">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">
                      Ön başvuru
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      1 dakika sürer; hesap açılmaz.
                    </p>
                  </div>

                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">
                      Ad Soyad <span className="text-red-500">*</span>
                    </span>
                    <input
                      required
                      maxLength={100}
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      {...invalid("name")}
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                    {fieldError("name")}
                  </label>

                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">
                      Cep telefonu <span className="text-red-500">*</span>
                    </span>
                    <input
                      required
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="05XX XXX XX XX"
                      maxLength={20}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      {...invalid("phone")}
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                    <span className="mt-1 block text-xs text-slate-400">
                      Sadece aramak için kullanılır; ilanında görünmez.
                    </span>
                    {fieldError("phone")}
                  </label>

                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">
                      E-posta{" "}
                      <span className="font-normal text-slate-400">
                        (isteğe bağlı)
                      </span>
                    </span>
                    <input
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      maxLength={255}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      {...invalid("email")}
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                    <span className="mt-1 block text-xs text-slate-400">
                      Site açıldığında kayıt davetini buraya gönderelim.
                    </span>
                    {fieldError("email")}
                  </label>

                  <fieldset>
                    <legend className="text-sm font-medium text-slate-700">
                      Hangi dersleri veriyorsun?{" "}
                      <span className="text-red-500">*</span>
                      <span className="ml-1 font-normal text-slate-400">
                        ({subjects.length}/{MAX_SUBJECTS})
                      </span>
                    </legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {subjectOptions.map((s) => {
                        const active = subjects.includes(s.label);
                        return (
                          <button
                            key={s.q}
                            type="button"
                            aria-pressed={active}
                            onClick={() => toggleSubject(s.label)}
                            className={`rounded-full px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
                              active
                                ? "bg-indigo-600 text-white"
                                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:text-slate-900 hover:ring-slate-300"
                            }`}
                          >
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                    {fieldError("subjects")}
                  </fieldset>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-sm font-medium text-slate-700">
                        İlçe{" "}
                        <span className="font-normal text-slate-400">
                          (isteğe bağlı)
                        </span>
                      </span>
                      <select
                        value={district}
                        onChange={(e) => setDistrict(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                      >
                        <option value="">Seçmedim</option>
                        {DISTRICTS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="text-sm font-medium text-slate-700">
                        Deneyim{" "}
                        <span className="font-normal text-slate-400">
                          (isteğe bağlı)
                        </span>
                      </span>
                      <select
                        value={experience}
                        onChange={(e) => setExperience(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                      >
                        <option value="">Seçmedim</option>
                        {EXPERIENCE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">
                      Eklemek istediğin bir şey{" "}
                      <span className="font-normal text-slate-400">
                        (isteğe bağlı)
                      </span>
                    </span>
                    <textarea
                      rows={2}
                      maxLength={2000}
                      placeholder="Örn. hafta içi akşamları müsaitim, online ders de veririm…"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                  </label>

                  <div>
                    <span className="text-sm font-medium text-slate-700">
                      Diploma / belge{" "}
                      <span className="font-normal text-slate-400">
                        (isteğe bağlı)
                      </span>
                    </span>
                    <p className="mt-1 text-xs text-slate-400">
                      Diploman, öğrenci belgen veya sertifikan hazırsa şimdiden
                      ekle, görüşme ve onay hızlanır. Fotoğrafını çekmen
                      yeterli; sonra da gönderebilirsin.
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={DOC_ACCEPT}
                      multiple
                      className="sr-only"
                      onChange={(e) => addDocs(e.target.files)}
                    />
                    {docs.length < MAX_DOCS && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-3 text-sm font-medium text-slate-600 transition hover:border-indigo-400 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                      >
                        <span aria-hidden>＋</span> Belge ekle
                        <span className="font-normal text-slate-400">
                          (PDF veya fotoğraf, en çok {MAX_DOCS})
                        </span>
                      </button>
                    )}
                    {docs.length > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {docs.map((f) => (
                          <li
                            key={`${f.name}-${f.size}`}
                            className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700"
                          >
                            <span className="min-w-0 truncate">{f.name}</span>
                            <button
                              type="button"
                              aria-label={`${f.name} dosyasını kaldır`}
                              onClick={() =>
                                setDocs((prev) => prev.filter((d) => d !== f))
                              }
                              className="shrink-0 rounded-full p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                            >
                              <span aria-hidden>✕</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <label className="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={kvkk}
                        onChange={(e) => setKvkk(e.target.checked)}
                        {...invalid("kvkk")}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-xs leading-relaxed text-slate-500">
                        <Link
                          to={ROUTES.kvkk}
                          target="_blank"
                          className="font-medium text-indigo-600 underline-offset-2 hover:underline"
                        >
                          KVKK aydınlatma metnini
                        </Link>{" "}
                        okudum; bilgilerimin başvurumun değerlendirilmesi için
                        işlenmesini kabul ediyorum.
                      </span>
                    </label>
                    {fieldError("kvkk")}
                  </div>

                  <button
                    type="submit"
                    disabled={mutation.isPending}
                    className="w-full rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {mutation.isPending ? "Gönderiliyor…" : "Ön başvuruyu gönder"}
                  </button>
                  <p className="text-center text-xs text-slate-400">
                    Gönderince yalnız ön başvurun iletilir; hesap açılmaz,
                    taahhüt doğmaz.
                  </p>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
