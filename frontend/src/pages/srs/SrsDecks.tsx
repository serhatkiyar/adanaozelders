import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/admin/ui/PageState";
import { UYE_NAV, TUTOR_NAV } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  useCopySrsDeck,
  useCreateSrsDeck,
  useSrsDecks,
  useSrsPlatformDecks,
} from "@/hooks/useSrs";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { ROLE_IDS } from "@/types";
import type { SrsDeck } from "@/types/srs";
import { ROUTES } from "@/lib/routes";

const LABEL_CLS = "mb-1.5 block text-xs font-medium text-slate-500 ";

function CountChips({ deck }: { deck: SrsDeck }) {
  const c = deck.counts;
  if (!c) return null;
  const total = c.new + c.learning + c.review;
  if (total === 0) {
    return (
      <span className="text-xs text-slate-400 ">
        Bugünlük bitti
      </span>
    );
  }
  // Üç rakamın anlamı yalnız renkle ve `title` ile veriliyordu: `title` klavye
  // ve ekran okuyucu kullanıcısına ulaşmaz, dokunmatikte hiç görünmez. Grup
  // tek bir adlandırılmış öğe (`role="img"`) olarak sunulur; içindeki rakamlar
  // dekoratif sayılır, böylece "12 8 30" diye okunmaz.
  const label = `${c.new} yeni, ${c.learning} öğrenme, ${c.review} tekrar`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="flex items-center gap-2 text-xs tabular-nums"
    >
      <span aria-hidden className="font-semibold text-sky-600 ">
        {c.new}
      </span>
      <span aria-hidden className="font-semibold text-amber-600 ">
        {c.learning}
      </span>
      <span aria-hidden className="font-semibold text-emerald-600 ">
        {c.review}
      </span>
    </span>
  );
}

function DeckRow({
  deck,
  depth,
  studyable,
}: {
  deck: SrsDeck;
  depth: number;
  studyable: boolean;
}) {
  const c = deck.counts;
  const due = c ? c.new + c.learning + c.review : 0;
  return (
    <div
      className="flex items-center gap-3 py-3"
      style={{ paddingLeft: depth * 20 }}
    >
      <Link
        to={ROUTES.srsDeck(deck.id)}
        className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 transition hover:text-marka-metin "
      >
        {deck.name}
      </Link>
      <CountChips deck={deck} />
      {studyable && (
        <Link
          to={ROUTES.srsStudy(deck.id)}
          className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
            due > 0
              ? "bg-marka text-marka-fg hover:bg-marka-hover"
              : "text-slate-500 hover:bg-slate-100 "
          }`}
        >
          Çalış
        </Link>
      )}
    </div>
  );
}

/** parent_id zincirinden ağaç kurup satırları girintiyle düzleştirir. */
function DeckTree({ decks }: { decks: SrsDeck[] }) {
  const byParent = useMemo(() => {
    const map = new Map<number | null, SrsDeck[]>();
    const ids = new Set(decks.map((d) => d.id));
    for (const d of decks) {
      // Üst deste bu listede yoksa (ör. filtre dışı) kök say.
      const key = d.parent_id != null && ids.has(d.parent_id) ? d.parent_id : null;
      const list = map.get(key) ?? [];
      list.push(d);
      map.set(key, list);
    }
    return map;
  }, [decks]);

  const rows: { deck: SrsDeck; depth: number }[] = [];
  const walk = (parent: number | null, depth: number) => {
    for (const d of byParent.get(parent) ?? []) {
      rows.push({ deck: d, depth });
      walk(d.id, depth + 1);
    }
  };
  walk(null, 0);

  return (
    <div className="divide-y divide-slate-100 ">
      {rows.map(({ deck, depth }) => (
        <DeckRow key={deck.id} deck={deck} depth={depth} studyable />
      ))}
    </div>
  );
}

function CreateDeckModal({
  ownDecks,
  onClose,
}: {
  ownDecks: SrsDeck[];
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const createDeck = useCreateSrsDeck();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Deste adı boş olamaz.");
      return;
    }
    createDeck.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        parent_id: parentId ? Number(parentId) : undefined,
      },
      {
        onSuccess: () => {
          toast.success("Deste oluşturuldu.");
          onClose();
        },
        onError: (err) => toast.error(getErrorMessage(err, "Oluşturulamadı.")),
      }
    );
  };

  // Portal ZORUNLU: panel başlığı `backdrop-blur` kullanır ve blur'lu bir ata
  // içindeki `position: fixed` öğeyi kendi kutusuna hapseder — elle yazılmış
  // `fixed inset-0` sarmalayıcı modalı ekranın ortasına değil header'ın içine
  // çizerdi. Ortak `Modal` ayrıca odak tuzağı, Esc ve `aria-modal` getirir.
  return (
    <Modal open onClose={onClose} title="Yeni Deste">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Deste adı *" required labelClassName={LABEL_CLS}>
          {(id) => (
            <input
              id={id}
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Örn. TYT Biyoloji"
              className="input"
            />
          )}
        </Field>
        <Field label="Açıklama (opsiyonel)" labelClassName={LABEL_CLS}>
          {(id) => (
            <textarea
              id={id}
              rows={2}
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input"
            />
          )}
        </Field>
        <Field label="Üst deste (opsiyonel)" labelClassName={LABEL_CLS}>
          {(id) => (
            <select
              id={id}
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="input"
            >
              <option value="">Yok (kök deste)</option>
              {ownDecks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 "
          >
            İptal
          </button>
          <button
            type="submit"
            disabled={createDeck.isPending}
            className="rounded-xl bg-marka px-5 py-2 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover disabled:opacity-60"
          >
            {createDeck.isPending ? "Oluşturuluyor…" : "Oluştur"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 ">
      {children}
    </h2>
  );
}

export default function SrsDecks() {
  const { data: user } = useCurrentUser();
  const navItems = user?.role_id === ROLE_IDS.TUTOR ? TUTOR_NAV : UYE_NAV;
  const navigate = useNavigate();
  const decksQuery = useSrsDecks();
  const platformQuery = useSrsPlatformDecks();
  const copyDeck = useCopySrsDeck();
  const [creating, setCreating] = useState(false);

  const own = decksQuery.data?.own ?? [];
  const assigned = decksQuery.data?.assigned ?? [];

  const copy = (deck: SrsDeck) =>
    copyDeck.mutate(deck.id, {
      onSuccess: (created) => {
        toast.success(`"${deck.name}" destene kopyalandı.`);
        navigate(ROUTES.srsDeck(created.id));
      },
      onError: (err) => toast.error(getErrorMessage(err, "Kopyalanamadı.")),
    });

  return (
    <DashboardShell title="Aralıklı Tekrar" navItems={navItems}>
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link
              to={ROUTES.learn}
              className="text-sm font-medium text-marka-metin hover:text-marka-metin-hover "
            >
              ← Öğren
            </Link>
            <h1 className="mt-1 text-2xl font-bold text-slate-900 ">
              Aralıklı Tekrar
            </h1>
            <p className="mt-1 text-sm text-slate-500 ">
              FSRS algoritması sıradaki tekrarını tam zamanında önüne getirir.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={ROUTES.srsBrowser}
              className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 "
            >
              Kart Tarayıcı
            </Link>
            <Link
              to={ROUTES.srsStats}
              className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 "
            >
              İstatistik
            </Link>
            <button
              onClick={() => setCreating(true)}
              className="rounded-xl bg-marka px-4 py-2 text-sm font-semibold text-marka-fg shadow-sm transition hover:bg-marka-hover active:scale-95"
            >
              Yeni Deste
            </button>
          </div>
        </div>

        {decksQuery.isLoading ? (
          <div className="mt-8">
            <PageSkeleton rows={3} />
          </div>
        ) : decksQuery.isError ? (
          <div className="mt-8">
            <ErrorState
              description={getErrorMessage(
                decksQuery.error,
                "Desteler yüklenemedi."
              )}
              onRetry={() => decksQuery.refetch()}
            />
          </div>
        ) : (
          <>
            {/* Destelerim */}
            <section className="mt-8">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2 ">
                <SectionTitle>Destelerim</SectionTitle>
                {own.length > 0 && (
                  <span className="text-[11px] text-slate-400 ">
                    yeni · öğrenme · tekrar
                  </span>
                )}
              </div>
              {own.length === 0 ? (
                <div className="mt-4">
                  <EmptyState
                    title="Henüz desten yok"
                    description="İlk desteni oluştur ya da platform destelerinden birini kopyala."
                    action={
                      <button
                        onClick={() => setCreating(true)}
                        className="rounded-xl bg-marka px-4 py-2 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover"
                      >
                        Deste Oluştur
                      </button>
                    }
                  />
                </div>
              ) : (
                <DeckTree decks={own} />
              )}
            </section>

            {/* Bana atananlar (öğrenci) */}
            {assigned.length > 0 && (
              <section className="mt-10">
                <div className="border-b border-slate-200 pb-2 ">
                  <SectionTitle>Bana Atananlar</SectionTitle>
                </div>
                <div className="divide-y divide-slate-100 ">
                  {assigned.map((deck) => (
                    <div key={deck.id} className="flex items-center gap-3 py-3">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 ">
                        {deck.name}
                      </span>
                      <CountChips deck={deck} />
                      <button
                        onClick={() => copy(deck)}
                        disabled={copyDeck.isPending}
                        className="rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 "
                      >
                        Kopyala
                      </button>
                      <Link
                        to={ROUTES.srsStudy(deck.id)}
                        className="rounded-xl bg-marka px-3 py-1.5 text-xs font-semibold text-marka-fg transition hover:bg-marka-hover"
                      >
                        Çalış
                      </Link>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Platform galerisi */}
            <section className="mt-10">
              <div className="border-b border-slate-200 pb-2 ">
                <SectionTitle>Platform Desteleri</SectionTitle>
              </div>
              {platformQuery.isLoading ? (
                <div className="mt-4">
                  <PageSkeleton rows={2} />
                </div>
              ) : platformQuery.isError ? (
                <div className="mt-4">
                  <ErrorState
                    description={getErrorMessage(
                      platformQuery.error,
                      "Platform desteleri yüklenemedi."
                    )}
                    onRetry={() => platformQuery.refetch()}
                  />
                </div>
              ) : (platformQuery.data ?? []).length === 0 ? (
                <div className="mt-4">
                  <EmptyState
                    title="Şimdilik platform destesi yok"
                    description="Yayınlanan hazır desteler burada görünecek."
                  />
                </div>
              ) : (
                <div className="divide-y divide-slate-100 ">
                  {(platformQuery.data ?? []).map((deck) => (
                    <div key={deck.id} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800 ">
                          {deck.name}
                        </p>
                        {deck.description && (
                          <p className="mt-0.5 truncate text-xs text-slate-500 ">
                            {deck.description}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => copy(deck)}
                        disabled={copyDeck.isPending}
                        className="rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 "
                      >
                        Kopyala
                      </button>
                      <Link
                        to={ROUTES.srsStudy(deck.id)}
                        className="rounded-xl px-3 py-1.5 text-xs font-semibold text-marka-soft-fg transition hover:bg-marka-soft "
                      >
                        Çalış
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </section>

          </>
        )}
      </div>

      {creating && (
        <CreateDeckModal ownDecks={own} onClose={() => setCreating(false)} />
      )}
    </DashboardShell>
  );
}
