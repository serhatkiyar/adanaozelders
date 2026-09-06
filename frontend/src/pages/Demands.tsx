import { FormEvent, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Link, useNavigate } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { FullScreenSpinner } from "@/components/Spinner";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  useBrowseDemands,
  useCloseDemand,
  useCreateDemand,
  useDemandResponses,
  useMyDemands,
  useRespondDemand,
} from "@/hooks/useDemands";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { useSubjects } from "@/hooks/useSubjects";
import { formatTRY } from "@/lib/money";
import { formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import { ROLE_IDS, type DemandOut } from "@/types";
import { ADSIZ_UYE } from "@/lib/roles";

// Ders listesi artık koda gömülü DEĞİL, katalogdan gelir. Talep formu
// öğrenci yüzeyidir: vitrin kapsamı (arkasında eğitmen olan dersler).
const subjectLabel = (q: string) => q;

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-marka-mid focus:ring-2 focus:ring-marka/20 ";
const labelCls = "mb-1.5 block text-xs font-medium text-slate-500 ";

function budgetText(d: DemandOut): string | null {
  const min = d.budget_min != null ? formatTRY(d.budget_min) : null;
  const max = d.budget_max != null ? formatTRY(d.budget_max) : null;
  if (min && max) return `${min} – ${max}`;
  if (min) return `${min}+`;
  if (max) return `${max}'e kadar`;
  return null;
}

/** Rol göre talep yüzeyi: CLIENT talep açar, TUTOR gelen talepleri görüp yanıtlar. */
export default function Demands() {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading || !user) return <FullScreenSpinner />;
  if (user.role_id === ROLE_IDS.TUTOR) return <TutorDemands />;
  if (user.role_id === ROLE_IDS.CLIENT) return <StudentDemands />;
  return <DashboardShell title="Talepler"><div /></DashboardShell>;
}

/* ════════════════════ ÖĞRENCİ ════════════════════ */

function StudentDemands() {
  const { data: demands, isLoading } = useMyDemands();

  return (
    <DashboardShell title="Taleplerim" navItems={STUDENT_NAV}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 ">
            İlan / Taleplerim
          </h1>
          <p className="mt-1 text-sm text-slate-500 ">
            Bir alan seçip ne aradığını anlat; o alandaki eğitmenler talebini görür ve
            isterse sana yazar.
          </p>
        </div>

        <DemandForm />

        <div className="space-y-3">
          <h2 className="text-sm font-bold text-slate-900 ">
            Açtığın talepler
          </h2>
          {isLoading ? (
            <div className="h-24 animate-pulse rounded-2xl bg-slate-100 " />
          ) : !demands || demands.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-400 ">
              Henüz talep açmadın.
            </p>
          ) : (
            demands.map((d) => <MyDemandCard key={d.id} demand={d} />)
          )}
        </div>
      </div>
    </DashboardShell>
  );
}

function DemandForm() {
  const create = useCreateDemand();
  const { data: katalog } = useSubjects();
  const [subject, setSubject] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState("");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!subject) return toast.error("Bir alan seç.");
    if (title.trim().length < 3) return toast.error("Başlık en az 3 karakter olmalı.");
    const min = budgetMin ? Number(budgetMin) : null;
    const max = budgetMax ? Number(budgetMax) : null;
    if (min != null && max != null && max < min)
      return toast.error("Üst bütçe, alt bütçeden küçük olamaz.");
    create.mutate(
      {
        subject,
        title: title.trim(),
        description: description.trim() || null,
        level: level.trim() || null,
        budget_min: min,
        budget_max: max,
      },
      {
        onSuccess: () => {
          toast.success("Talebin yayınlandı.");
          setSubject("");
          setTitle("");
          setDescription("");
          setLevel("");
          setBudgetMin("");
          setBudgetMax("");
        },
        onError: (err) => toast.error(getErrorMessage(err, "Talep oluşturulamadı.")),
      }
    );
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 "
    >
      <p className="text-sm font-bold text-slate-900 ">Yeni talep aç</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Alan" labelClassName={labelCls}>
          {(id) => (
              <select
                    id={id}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className={inputCls}
              >
                <option value="">Alan seç…</option>
                {(katalog ?? []).map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
          )}
        </Field>
        <Field label="Seviye (opsiyonel)" labelClassName={labelCls}>
          {(id) => (
              <input
                    id={id}
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                className={inputCls}
                placeholder="ör. 11. sınıf, TYT"
              />
          )}
        </Field>
      </div>
      <Field label="Başlık" labelClassName={labelCls}>
        {(id) => (
            <input
                    id={id}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputCls}
              placeholder="ör. TYT Matematik için haftada 2 ders arıyorum"
            />
        )}
      </Field>
      <Field label="Açıklama (opsiyonel)" labelClassName={labelCls}>
        {(id) => (
            <textarea
                    id={id}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={inputCls}
              placeholder="Hedefin, mevcut durumun, tercih ettiğin gün/saatler…"
            />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Bütçe alt (TL/saat)" labelClassName={labelCls}>
          {(id) => (
              <input
                    id={id}
                value={budgetMin}
                onChange={(e) => setBudgetMin(e.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
                className={inputCls}
                placeholder="ör. 200"
              />
          )}
        </Field>
        <Field label="Bütçe üst (TL/saat)" labelClassName={labelCls}>
          {(id) => (
              <input
                    id={id}
                value={budgetMax}
                onChange={(e) => setBudgetMax(e.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
                className={inputCls}
                placeholder="ör. 400"
              />
          )}
        </Field>
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-xl bg-marka px-5 py-2.5 text-sm font-semibold text-marka-fg shadow-sm transition hover:bg-marka-hover active:scale-95 disabled:opacity-50"
        >
          {create.isPending ? "Yayınlanıyor…" : "Talebi Yayınla"}
        </button>
      </div>
    </form>
  );
}

function MyDemandCard({ demand }: { demand: DemandOut }) {
  const [showResponses, setShowResponses] = useState(false);
  const close = useCloseDemand();
  const isOpen = demand.status === "OPEN";
  const budget = budgetText(demand);
  const count = demand.response_count ?? 0;

  const doClose = () => {
    if (!window.confirm("Bu talebi kapatmak istiyor musun?")) return;
    close.mutate(demand.id, {
      onSuccess: () => toast.success("Talep kapatıldı."),
      onError: (e) => toast.error(getErrorMessage(e, "Kapatılamadı.")),
    });
  };

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 ">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-marka-soft px-2.5 py-0.5 text-xs font-semibold text-marka-metin-hover ">
              {subjectLabel(demand.subject)}
            </span>
            {!isOpen && (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 ">
                Kapalı
              </span>
            )}
          </div>
          <h3 className="mt-2 truncate text-base font-bold text-slate-900 ">
            {demand.title}
          </h3>
          {demand.description && (
            <p className="mt-1 text-sm text-slate-500 ">
              {demand.description}
            </p>
          )}
          <p className="mt-2 text-xs text-slate-400 ">
            {demand.level ? `${demand.level} · ` : ""}
            {budget ? `${budget} · ` : ""}
            {formatDateTime(demand.created_at)}
          </p>
        </div>
        {isOpen && (
          <button
            onClick={doClose}
            disabled={close.isPending}
            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 disabled:opacity-50 "
          >
            Kapat
          </button>
        )}
      </div>

      <button
        onClick={() => setShowResponses((v) => !v)}
        className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-marka-metin hover:underline "
      >
        {count > 0 ? `${count} eğitmen yanıtladı` : "Henüz yanıt yok"}
        {count > 0 && (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.4}
            className={`h-4 w-4 transition-transform ${showResponses ? "rotate-180" : ""}`}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
          </svg>
        )}
      </button>

      {showResponses && count > 0 && <DemandResponders demandId={demand.id} />}
    </div>
  );
}

function DemandResponders({ demandId }: { demandId: number }) {
  const { data, isLoading } = useDemandResponses(demandId);

  if (isLoading) {
    return (
      <div className="mt-3 h-12 animate-pulse rounded-xl bg-slate-100 " />
    );
  }
  if (!data || data.length === 0) return null;

  return (
    <ul className="mt-3 divide-y divide-slate-100 ">
      {data.map((r) => (
        <li key={r.tutor_id} className="flex items-center justify-between gap-3 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            {r.tutor_avatar_url ? (
              <img
                src={r.tutor_avatar_url}
                alt=""
                className="h-9 w-9 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-marka-line text-sm font-bold text-marka-soft-fg ">
                {r.tutor_name.charAt(0)}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-800 ">
                {r.tutor_name}
              </p>
              {r.headline && (
                <p className="truncate text-xs text-slate-500 ">
                  {r.headline}
                </p>
              )}
            </div>
          </div>
          <Link
            to={ROUTES.messageWith(r.tutor_id, r.tutor_name)}
            className="shrink-0 rounded-lg bg-marka px-3 py-1.5 text-xs font-semibold text-marka-fg transition hover:bg-marka-hover"
          >
            Mesaj
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ════════════════════ EĞİTMEN ════════════════════ */

function TutorDemands() {
  const [mine, setMine] = useState(true);
  const { data: demands, isLoading } = useBrowseDemands(mine);

  return (
    <DashboardShell title="Gelen Talepler" navItems={TUTOR_NAV}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 ">
            Gelen Talepler
          </h1>
          <p className="mt-1 text-sm text-slate-500 ">
            Öğrencilerin açtığı ilanlar. Bir talebe yanıt verince öğrenciyle sohbet açılır.
          </p>
        </div>

        <div className="inline-flex rounded-xl bg-slate-100 p-1 ">
          {[
            { v: true, label: "Alanıma uygun" },
            { v: false, label: "Tümü" },
          ].map((t) => (
            <button
              key={String(t.v)}
              onClick={() => setMine(t.v)}
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
                mine === t.v
                  ? "bg-white text-marka-metin shadow-sm "
                  : "text-slate-500 "
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {isLoading ? (
            <div className="h-24 animate-pulse rounded-2xl bg-slate-100 " />
          ) : !demands || demands.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-400 ">
              {mine
                ? "Branşlarına uyan açık talep yok. Branşlarını İlan Ayarları'ndan güncelleyebilirsin."
                : "Şu an açık talep yok."}
            </p>
          ) : (
            demands.map((d) => <BrowseDemandCard key={d.id} demand={d} />)
          )}
        </div>
      </div>
    </DashboardShell>
  );
}

function BrowseDemandCard({ demand }: { demand: DemandOut }) {
  const [composing, setComposing] = useState(false);
  const [body, setBody] = useState("");
  const respond = useRespondDemand();
  const navigate = useNavigate();
  const budget = budgetText(demand);

  const send = () => {
    if (body.trim().length < 2) return toast.error("Kısa bir mesaj yaz.");
    respond.mutate(
      { demandId: demand.id, body: body.trim() },
      {
        onSuccess: (res) => {
          toast.success("Yanıtın gönderildi, sohbet açıldı.");
          navigate(ROUTES.messageWith(res.client_id, res.client_name));
        },
        onError: (e) => toast.error(getErrorMessage(e, "Yanıt gönderilemedi.")),
      }
    );
  };

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 ">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-marka-soft px-2.5 py-0.5 text-xs font-semibold text-marka-metin-hover ">
          {subjectLabel(demand.subject)}
        </span>
        {demand.level && (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 ">
            {demand.level}
          </span>
        )}
      </div>
      <h3 className="mt-2 text-base font-bold text-slate-900 ">
        {demand.title}
      </h3>
      {demand.description && (
        <p className="mt-1 text-sm text-slate-500 ">
          {demand.description}
        </p>
      )}
      <p className="mt-2 text-xs text-slate-400 ">
        {demand.client_name ? `${demand.client_name} · ` : ""}
        {budget ? `${budget} · ` : ""}
        {formatDateTime(demand.created_at)}
      </p>

      <div className="mt-3">
        {demand.responded ? (
          <Link
            to={ROUTES.messageWith(demand.client_id, demand.client_name ?? ADSIZ_UYE)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-marka-line px-4 py-2 text-sm font-semibold text-marka-soft-fg transition hover:bg-marka-soft "
          >
            Sohbete git →
          </Link>
        ) : composing ? (
          <div className="space-y-2">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              autoFocus
              className={inputCls}
              placeholder="Kısaca kendini tanıt ve nasıl yardımcı olabileceğini yaz…"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setComposing(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 "
              >
                Vazgeç
              </button>
              <button
                onClick={send}
                disabled={respond.isPending}
                className="rounded-lg bg-marka px-5 py-2 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover disabled:opacity-50"
              >
                {respond.isPending ? "Gönderiliyor…" : "Gönder"}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setComposing(true)}
            className="rounded-lg bg-marka px-4 py-2 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover"
          >
            Yanıtla
          </button>
        )}
      </div>
    </div>
  );
}
