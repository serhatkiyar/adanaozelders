import { useState } from "react";
import { MapPicker } from "@/components/MapPicker";
import { LibraryMediaManager } from "@/components/LibraryMediaManager";
import { useCreateLibrary, useUpdateLibrary } from "@/hooks/useLibraries";
import { AMENITY_OPTIONS, amenityTiClass, amenityLabel } from "@/lib/amenities";
import {
  WEEKDAY_LABELS,
  hhmmToMinute,
  minuteToHHMM,
  normalizeWeek,
} from "@/lib/libraryHours";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { LibraryDetailOut, LibraryHours, LibraryWrite } from "@/types";

export interface EditorState extends LibraryWrite {
  id?: number;
}

export const EMPTY_HOURS: LibraryHours[] = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  is_closed: true,
  open_minute: null,
  close_minute: null,
}));

export function emptyEditor(): EditorState {
  return {
    name: "",
    description: "",
    phone: "",
    email: "",
    website: "",
    cover_url: "",
    location_lat: null,
    location_lng: null,
    city: "",
    district: "",
    neighborhood: "",
    street: "",
    building_no: "",
    capacity: null,
    study_hourly_price: null,
    status: "ACTIVE",
    amenities: [],
    hours: EMPTY_HOURS,
  };
}

/** Tam detay kaydını editör formuna dönüştürür (admin "Düzenle" + operatör profili). */
export function toEditorState(full: LibraryDetailOut): EditorState {
  return {
    id: full.id,
    name: full.name,
    description: full.description ?? "",
    phone: full.phone ?? "",
    email: full.email ?? "",
    website: full.website ?? "",
    cover_url: full.cover_url ?? "",
    location_lat: full.location_lat ?? null,
    location_lng: full.location_lng ?? null,
    city: full.city ?? "",
    district: full.district ?? "",
    neighborhood: full.neighborhood ?? "",
    street: full.street ?? "",
    building_no: full.building_no ?? "",
    capacity: full.capacity ?? null,
    study_hourly_price:
      full.study_hourly_price != null ? Number(full.study_hourly_price) : null,
    status: full.status,
    amenities: full.amenities,
    hours: normalizeWeek(full.hours),
  };
}

interface LibraryEditorModalProps {
  state: EditorState;
  onClose: () => void;
  /** false → operatör: ad salt-okunur + görünürlük (status) gizli (admin'de kalır). */
  canEditIdentity?: boolean;
}

export function LibraryEditorModal({
  state,
  onClose,
  canEditIdentity = true,
}: LibraryEditorModalProps) {
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
    if (canEditIdentity && (!form.name.trim() || form.name.trim().length < 2)) {
      toast.error("Kütüphane adı gerekli.");
      return;
    }
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

    // logo/kapak/galeri YALNIZ LibraryMediaManager'dan yönetilir → cover_url GÖNDERİLMEZ.
    // Ad ve status admin'e özel; operatör gönderse de backend yok sayar (allow_identity).
    const payload: LibraryWrite = {
      name: form.name.trim(),
      description: form.description?.trim() || null,
      phone: form.phone?.trim() || null,
      email: form.email?.trim() || null,
      website: form.website?.trim() || null,
      // Yapısal adres elle girilir; tam adres (location_text) backend'de derlenir.
      city: form.city?.trim() || null,
      district: form.district?.trim() || null,
      neighborhood: form.neighborhood?.trim() || null,
      street: form.street?.trim() || null,
      building_no: form.building_no?.trim() || null,
      location_lat: form.location_lat ?? null,
      location_lng: form.location_lng ?? null,
      capacity: form.capacity ?? null,
      study_hourly_price: form.study_hourly_price ?? null,
      status: form.status ?? "ACTIVE",
      amenities: form.amenities ?? [],
      hours: form.hours ?? [],
    };

    const onError = (e: unknown) => toast.error(getErrorMessage(e, "Kaydedilemedi."));

    if (isEdit) {
      update.mutate(
        { id: form.id!, payload },
        {
          onSuccess: () => {
            toast.success(canEditIdentity ? "Kütüphane güncellendi." : "Profilin güncellendi.");
            onClose();
          },
          onError,
        }
      );
    } else {
      // Oluşturunca KAPATMA: dönen id ile edit moduna geç → görsel yöneticisi açılsın.
      create.mutate(payload, {
        onSuccess: (created) => {
          toast.success("Kütüphane eklendi. Artık logo ve galeri ekleyebilirsin.");
          setForm((f) => ({ ...f, id: created.id }));
        },
        onError,
      });
    }
  };

  const title = canEditIdentity
    ? isEdit
      ? "Kütüphaneyi Düzenle"
      : "Yeni Kütüphane"
    : "Kütüphane Profilim";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-800">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-700">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          {/* Temel bilgi */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={canEditIdentity ? "Kütüphane Adı *" : "Kütüphane Adı (admin belirler)"}>
              <input
                value={form.name}
                onChange={(e) => canEditIdentity && set("name", e.target.value)}
                disabled={!canEditIdentity}
                className={`input ${!canEditIdentity ? "cursor-not-allowed opacity-60" : ""}`}
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

          <Field label="Çalışma alanı saatlik ücreti (TL — boş ise rezervasyon kapalı)">
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

          <Field label="Açıklama (biyografi)">
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

          {/* Durum — yalnız admin */}
          {canEditIdentity && (
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
          )}

          {/* Adres (elle) */}
          <Field label="Adres">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} className="input" placeholder="İl (ör. Adana)" />
              <input value={form.district ?? ""} onChange={(e) => set("district", e.target.value)} className="input" placeholder="İlçe (ör. Çukurova)" />
              <input value={form.neighborhood ?? ""} onChange={(e) => set("neighborhood", e.target.value)} className="input" placeholder="Mahalle" />
              <div className="grid grid-cols-[1fr_90px] gap-2">
                <input value={form.street ?? ""} onChange={(e) => set("street", e.target.value)} className="input" placeholder="Sokak / Cadde" />
                <input value={form.building_no ?? ""} onChange={(e) => set("building_no", e.target.value)} className="input" placeholder="No" />
              </div>
            </div>
          </Field>

          {/* Konum — yalnız harita işareti (adres OTOMATİK dolmaz) */}
          <Field label="Harita Konumu (yol tarifi için)">
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
              Adresi yukarıdan yaz; aşağıdan da kütüphanenin tam noktasını işaretle.
              Harita yalnız konumu (koordinat) belirler, adresi değiştirmez.
            </p>
            <div className="h-72 overflow-hidden rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 [&_.map-picker-root]:h-full">
              <MapPicker
                initialLat={form.location_lat}
                initialLng={form.location_lng}
                onLocationSelect={(lat, lng) => {
                  set("location_lat", lat);
                  set("location_lng", lng);
                }}
              />
            </div>
            {form.location_lat != null && form.location_lng != null && (
              <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
                ✓ Konum işaretlendi ({form.location_lat.toFixed(5)}, {form.location_lng.toFixed(5)})
              </p>
            )}
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
                    <span><i className={amenityTiClass(a)}></i></span>
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
