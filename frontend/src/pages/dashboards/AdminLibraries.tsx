import { useState } from "react";
import { MapPicker } from "@/components/MapPicker";
import { LibraryMediaManager } from "@/components/LibraryMediaManager";
import { ExamSessionsManager } from "@/components/ExamSessionsManager";
import {
  useAdminLibraries,
  useCreateLibrary,
  useDeleteLibrary,
  useUpdateLibrary,
} from "@/hooks/useLibraries";
import {
  useCreateOperator,
  useDeleteOperator,
  useOperators,
} from "@/hooks/useLibraryExams";
import { fetchLibraryAdmin } from "@/api/libraries";
import { AMENITY_OPTIONS, amenityIcon, amenityLabel } from "@/lib/amenities";
import {
  WEEKDAY_LABELS,
  hhmmToMinute,
  minuteToHHMM,
  normalizeWeek,
} from "@/lib/libraryHours";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { LibraryHours, LibrarySearchOut, LibraryWrite } from "@/types";

interface EditorState extends LibraryWrite {
  id?: number;
}

const EMPTY_HOURS: LibraryHours[] = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  is_closed: true,
  open_minute: null,
  close_minute: null,
}));

function emptyEditor(): EditorState {
  return {
    name: "",
    description: "",
    phone: "",
    email: "",
    website: "",
    cover_url: "",
    location_text: "",
    location_lat: null,
    location_lng: null,
    capacity: null,
    study_hourly_price: null,
    status: "ACTIVE",
    amenities: [],
    hours: EMPTY_HOURS,
  };
}

export default function AdminLibraries() {
  const { data, isLoading, isError, error } = useAdminLibraries();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [managing, setManaging] = useState<LibrarySearchOut | null>(null);
  const del = useDeleteLibrary();

  const openCreate = () => setEditor(emptyEditor());

  const openEdit = async (lib: LibrarySearchOut) => {
    try {
      // Tam kayıt (saatler + iletişim) admin detay ucundan gelir (GİZLİ dahil).
      const full = await fetchLibraryAdmin(lib.id);
      setEditor({
        id: full.id,
        name: full.name,
        description: full.description ?? "",
        phone: full.phone ?? "",
        email: full.email ?? "",
        website: full.website ?? "",
        cover_url: full.cover_url ?? "",
        location_text: full.location_text ?? "",
        location_lat: full.location_lat ?? null,
        location_lng: full.location_lng ?? null,
        capacity: full.capacity ?? null,
        study_hourly_price:
          full.study_hourly_price != null ? Number(full.study_hourly_price) : null,
        status: full.status,
        amenities: full.amenities,
        hours: normalizeWeek(full.hours),
      });
    } catch (e) {
      toast.error(getErrorMessage(e, "Kütüphane yüklenemedi."));
    }
  };

  const onDelete = (lib: LibrarySearchOut) => {
    if (!window.confirm(`"${lib.name}" kütüphanesini silmek istiyor musun?`)) return;
    del.mutate(lib.id, {
      onSuccess: () => toast.success("Kütüphane silindi."),
      onError: (e) => toast.error(getErrorMessage(e, "Silme başarısız.")),
    });
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {data?.length ?? 0} kütüphane · sahada gezip kaydettiğin mekânları buradan yönet.
        </p>
        <button
          onClick={openCreate}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95"
        >
          + Kütüphane Ekle
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {getErrorMessage(error, "Kütüphaneler yüklenemedi.")}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 py-16 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Henüz kütüphane eklenmedi.
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((lib) => (
            <div
              key={lib.id}
              className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-xl dark:bg-slate-700">
                  {lib.cover_url ? (
                    <img src={lib.cover_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    "📚"
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                    {lib.name}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {lib.location_text || "Konum yok"} · ★{" "}
                    {lib.rating_average != null ? lib.rating_average.toFixed(1) : "—"}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  onClick={() => setManaging(lib)}
                  className="rounded-xl bg-indigo-50 px-3.5 py-1.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300"
                >
                  Oturumlar & Operatörler
                </button>
                <button
                  onClick={() => openEdit(lib)}
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                >
                  Düzenle
                </button>
                <button
                  onClick={() => onDelete(lib)}
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-red-600 shadow-sm transition hover:bg-red-50 dark:border-slate-600 dark:bg-slate-700"
                >
                  Sil
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editor && (
        <LibraryEditorModal
          state={editor}
          onClose={() => setEditor(null)}
        />
      )}

      {managing && (
        <ManageModal library={managing} onClose={() => setManaging(null)} />
      )}
    </section>
  );
}

/* ── Oturumlar & Operatörler modalı ── */

function ManageModal({
  library,
  onClose,
}: {
  library: LibrarySearchOut;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-800">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-700">
          <h2 className="truncate text-lg font-bold text-slate-900 dark:text-white">
            {library.name}
          </h2>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          <OperatorsManager libraryId={library.id} />
          <div className="border-t border-slate-100 pt-5 dark:border-slate-700">
            <ExamSessionsManager libraryId={library.id} />
          </div>
        </div>
      </div>
    </div>
  );
}

function OperatorsManager({ libraryId }: { libraryId: number }) {
  const { data: operators } = useOperators(libraryId);
  const create = useCreateOperator(libraryId);
  const del = useDeleteOperator(libraryId);
  const [form, setForm] = useState({
    email: "",
    password: "",
    first_name: "",
    last_name: "",
  });
  const [open, setOpen] = useState(false);

  const submit = () => {
    if (!form.email || form.password.length < 8 || !form.first_name || !form.last_name) {
      toast.error("Tüm alanları doldurun (şifre en az 8 karakter).");
      return;
    }
    create.mutate(form, {
      onSuccess: () => {
        toast.success("Operatör hesabı oluşturuldu.");
        setForm({ email: "", password: "", first_name: "", last_name: "" });
        setOpen(false);
      },
      onError: (e) => toast.error(getErrorMessage(e, "Oluşturulamadı.")),
    });
  };

  const onDelete = (id: number, name: string) => {
    if (!window.confirm(`${name} operatör hesabını sil?`)) return;
    del.mutate(id, {
      onSuccess: () => toast.success("Operatör silindi."),
      onError: (e) => toast.error(getErrorMessage(e, "Silme başarısız.")),
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Operatörler</h3>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200"
        >
          {open ? "Kapat" : "+ Operatör"}
        </button>
      </div>

      {open && (
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-900/40">
          <input className="input" placeholder="Ad" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          <input className="input" placeholder="Soyad" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          <input className="input col-span-2" placeholder="E-posta" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className="input col-span-2" type="password" placeholder="Şifre (min 8)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <button onClick={submit} disabled={create.isPending} className="col-span-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
            {create.isPending ? "Oluşturuluyor…" : "Operatör Hesabı Oluştur"}
          </button>
        </div>
      )}

      {operators && operators.length > 0 ? (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 dark:divide-slate-700 dark:border-slate-700">
          {operators.map((op) => (
            <li key={op.id} className="flex items-center justify-between px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{op.full_name}</p>
                <p className="truncate text-xs text-slate-400">{op.email}</p>
              </div>
              <button onClick={() => onDelete(op.id, op.full_name)} className="rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                Sil
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-400">Henüz operatör yok. Kütüphaneci için hesap oluşturun.</p>
      )}
    </div>
  );
}

/* ── Editor modal ── */

function LibraryEditorModal({
  state,
  onClose,
}: {
  state: EditorState;
  onClose: () => void;
}) {
  const [form, setForm] = useState<EditorState>(state);
  const create = useCreateLibrary();
  const update = useUpdateLibrary();
  const busy = create.isPending || update.isPending;
  const isEdit = form.id != null;

  const set = <K extends keyof EditorState>(key: K, value: EditorState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleAmenity = (a: string) =>
    setForm((f) => {
      const cur = f.amenities ?? [];
      return {
        ...f,
        amenities: cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a],
      };
    });

  const setHour = (weekday: number, patch: Partial<LibraryHours>) =>
    setForm((f) => ({
      ...f,
      hours: (f.hours ?? EMPTY_HOURS).map((h) =>
        h.weekday === weekday ? { ...h, ...patch } : h
      ),
    }));

  const submit = () => {
    if (!form.name.trim() || form.name.trim().length < 2) {
      toast.error("Kütüphane adı gerekli.");
      return;
    }
    // Açık günlerde saatleri doğrula.
    for (const h of form.hours ?? []) {
      if (!h.is_closed) {
        if (h.open_minute == null || h.close_minute == null) {
          toast.error(`${WEEKDAY_LABELS[h.weekday]} için açılış/kapanış saati girin.`);
          return;
        }
        if (h.close_minute <= h.open_minute) {
          toast.error(`${WEEKDAY_LABELS[h.weekday]}: kapanış açılıştan sonra olmalı.`);
          return;
        }
      }
    }

    const payload: LibraryWrite = {
      name: form.name.trim(),
      description: form.description?.trim() || null,
      phone: form.phone?.trim() || null,
      email: form.email?.trim() || null,
      website: form.website?.trim() || null,
      cover_url: form.cover_url?.trim() || null,
      location_text: form.location_text?.trim() || null,
      location_lat: form.location_lat ?? null,
      location_lng: form.location_lng ?? null,
      capacity: form.capacity ?? null,
      study_hourly_price: form.study_hourly_price ?? null,
      status: form.status ?? "ACTIVE",
      amenities: form.amenities ?? [],
      hours: form.hours ?? [],
    };

    const opts = {
      onSuccess: () => {
        toast.success(isEdit ? "Kütüphane güncellendi." : "Kütüphane eklendi.");
        onClose();
      },
      onError: (e: unknown) => toast.error(getErrorMessage(e, "Kaydedilemedi.")),
    };

    if (isEdit) {
      update.mutate({ id: form.id!, payload }, opts);
    } else {
      create.mutate(payload, opts);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-800">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-700">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            {isEdit ? "Kütüphaneyi Düzenle" : "Yeni Kütüphane"}
          </h2>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          {/* Temel bilgi */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Kütüphane Adı *">
              <input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                className="input"
                placeholder="Şehit Pilot Kütüphanesi"
              />
            </Field>
            <Field label="Kapasite (koltuk sayısı)">
              <input
                type="number"
                min={0}
                value={form.capacity ?? ""}
                onChange={(e) => set("capacity", e.target.value ? Number(e.target.value) : null)}
                className="input"
                placeholder="120"
              />
            </Field>
          </div>

          <Field label="Çalışma alanı saatlik ücreti (₺ — boş ise rezervasyon kapalı)">
            <input
              type="number"
              min={0}
              step="0.5"
              value={form.study_hourly_price ?? ""}
              onChange={(e) =>
                set("study_hourly_price", e.target.value ? Number(e.target.value) : null)
              }
              className="input"
              placeholder="25"
            />
          </Field>

          <Field label="Açıklama">
            <textarea
              value={form.description ?? ""}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
              className="input"
              placeholder="Sessiz çalışma ortamı, ücretsiz çay-kahve…"
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Telefon">
              <input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} className="input" placeholder="0322 000 00 00" />
            </Field>
            <Field label="E-posta">
              <input value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} className="input" placeholder="iletisim@..." />
            </Field>
            <Field label="Web sitesi">
              <input value={form.website ?? ""} onChange={(e) => set("website", e.target.value)} className="input" placeholder="https://..." />
            </Field>
            <Field label="Kapak görseli (URL — alternatif)">
              <input value={form.cover_url ?? ""} onChange={(e) => set("cover_url", e.target.value)} className="input" placeholder="https://...jpg" />
            </Field>
          </div>

          {/* Görseller (logo / banner / galeri) — yalnız kayıtlı kütüphanede */}
          <Field label="Görseller (logo · kapak · galeri)">
            {isEdit ? (
              <LibraryMediaManager libraryId={form.id!} />
            ) : (
              <p className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                📸 Logo, kapak ve galeri fotoğraflarını yüklemek için önce kütüphaneyi
                kaydedin, sonra “Düzenle” ile geri dönün.
              </p>
            )}
          </Field>

          {/* Durum */}
          <Field label="Durum">
            <div className="flex gap-2">
              {[
                { v: "ACTIVE", l: "Yayında" },
                { v: "HIDDEN", l: "Gizli" },
              ].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => set("status", o.v)}
                  className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                    form.status === o.v
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                  }`}
                >
                  {o.l}
                </button>
              ))}
            </div>
          </Field>

          {/* Konum */}
          <Field label="Konum (haritadan işaretle)">
            {form.location_text && (
              <p className="mb-2 text-xs text-emerald-600 dark:text-emerald-400">
                📍 {form.location_text}
              </p>
            )}
            <div className="h-72 overflow-hidden rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 [&_.map-picker-root]:h-full">
              <MapPicker
                initialLat={form.location_lat}
                initialLng={form.location_lng}
                onLocationSelect={(lat, lng, address) => {
                  set("location_lat", lat);
                  set("location_lng", lng);
                  if (address) set("location_text", address);
                }}
              />
            </div>
          </Field>

          {/* Olanaklar */}
          <Field label="Olanaklar">
            <div className="flex flex-wrap gap-2">
              {AMENITY_OPTIONS.map((a) => {
                const active = (form.amenities ?? []).includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    onClick={() => toggleAmenity(a)}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <span>{amenityIcon(a)}</span>
                    {amenityLabel(a)}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Çalışma saatleri */}
          <Field label="Çalışma Saatleri">
            <div className="space-y-1.5">
              {(form.hours ?? EMPTY_HOURS).map((h) => (
                <div key={h.weekday} className="flex items-center gap-2">
                  <span className="w-24 text-sm text-slate-600 dark:text-slate-300">
                    {WEEKDAY_LABELS[h.weekday]}
                  </span>
                  <label className="flex items-center gap-1 text-xs text-slate-500">
                    <input
                      type="checkbox"
                      checked={!h.is_closed}
                      onChange={(e) =>
                        setHour(h.weekday, {
                          is_closed: !e.target.checked,
                          ...(e.target.checked && h.open_minute == null
                            ? { open_minute: 540, close_minute: 1320 }
                            : {}),
                        })
                      }
                    />
                    Açık
                  </label>
                  {!h.is_closed ? (
                    <>
                      <input
                        type="time"
                        value={minuteToHHMM(h.open_minute) || "09:00"}
                        onChange={(e) =>
                          setHour(h.weekday, { open_minute: hhmmToMinute(e.target.value) })
                        }
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                      />
                      <span className="text-slate-400">–</span>
                      <input
                        type="time"
                        value={minuteToHHMM(h.close_minute) || "22:00"}
                        onChange={(e) =>
                          setHour(h.weekday, { close_minute: hhmmToMinute(e.target.value) })
                        }
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                      />
                    </>
                  ) : (
                    <span className="text-xs text-rose-500">Kapalı</span>
                  )}
                </div>
              ))}
            </div>
          </Field>
        </div>

        <div className="flex gap-3 border-t border-slate-100 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700"
          >
            Vazgeç
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="flex-[2] rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy ? "Kaydediliyor…" : isEdit ? "Güncelle" : "Ekle"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-200">
        {label}
      </span>
      {children}
    </label>
  );
}
