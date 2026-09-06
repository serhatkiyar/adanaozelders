import { useState } from "react";
import { Button } from "@/components/admin/ui";
import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { OPERATOR_NAV } from "@/lib/nav";
import { LibraryMediaManager } from "@/components/LibraryMediaManager";
import { MapPicker } from "@/components/MapPicker";
import { LibrariesMap } from "@/components/LibrariesMap";
import { StarRating } from "@/components/StarRating";
import { AmenityTagGrid } from "@/components/AmenityTagGrid";
import { PinIcon } from "@/components/PinIcon";
import {
  EMPTY_HOURS,
  toEditorState,
  type EditorState,
} from "@/components/LibraryEditorModal";
import { useOperatorMe } from "@/hooks/useLibraryExams";
import { useLibraryAdminDetail, useUpdateLibrary } from "@/hooks/useLibraries";
import { AMENITY_OPTIONS, amenityLabel } from "@/lib/amenities";
import { amenityIcon } from "@/lib/amenityIcons";
import {
  WEEKDAY_LABELS,
  formatHoursLine,
  hhmmToMinute,
  jsDayToWeekday,
  minuteToHHMM,
  normalizeWeek,
} from "@/lib/libraryHours";
import { regionLabel } from "@/lib/region";
import { formatTRY } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { LibraryDetailOut, LibraryHours, LibraryWrite } from "@/types";

const cardCls =
  "rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 ";

const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: "Yayında", cls: "bg-emerald-100 text-emerald-700 " },
  PENDING: { label: "İncelemede", cls: "bg-amber-100 text-amber-700 " },
  REJECTED: { label: "Reddedildi", cls: "bg-rose-100 text-rose-700 " },
  HIDDEN: { label: "Gizli", cls: "bg-slate-200 text-slate-600 " },
};

/** EditorState → API yükü. LibraryEditorModal.submit ile aynı kurallar:
 * logo/kapak galeri yöneticisinden gider (cover_url/logo_url GÖNDERİLMEZ); ad ve
 * status admin'e özel (operatör gönderse de backend yok sayar). */
function toPayload(form: EditorState): LibraryWrite {
  return {
    name: form.name.trim(),
    description: form.description?.trim() || null,
    phone: form.phone?.trim() || null,
    email: form.email?.trim() || null,
    website: form.website?.trim() || null,
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
}

export default function OperatorLibrary() {
  const { data: op } = useOperatorMe();
  const { data: lib, isLoading } = useLibraryAdminDetail(op?.library_id);

  return (
    <DashboardShell title="Kütüphanem" navItems={OPERATOR_NAV}>
      <div className="mx-auto max-w-3xl space-y-5">
        {isLoading || !lib ? (
          <div className="space-y-5">
            <div className="h-44 animate-pulse rounded-3xl bg-slate-100 " />
            <div className="h-28 animate-pulse rounded-2xl bg-slate-100 " />
            <div className="h-28 animate-pulse rounded-2xl bg-slate-100 " />
          </div>
        ) : (
          <>
            <Hero lib={lib} />
            <MediaSection lib={lib} />
            <AboutSection lib={lib} />
            <ContactSection lib={lib} />
            <AddressSection lib={lib} />
            <HoursSection lib={lib} />
            <AmenitiesSection lib={lib} />
          </>
        )}
      </div>
    </DashboardShell>
  );
}

/* ── Hero: öğrencinin gördüğü kimlik + "sayfanı aç" ── */
function Hero({ lib }: { lib: LibraryDetailOut }) {
  const pill = STATUS_PILL[lib.status];
  const region = regionLabel(lib.city, lib.district, lib.location_text);
  const initial = (lib.name.trim()[0] ?? "K").toUpperCase();

  return (
    <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200 ">
      <div className="relative h-40 w-full bg-gradient-to-br from-indigo-100 to-violet-100 ">
        {lib.cover_url && (
          <img src={lib.cover_url} alt="" className="h-full w-full object-cover" />
        )}
        {pill && (
          <span className={`absolute right-4 top-4 rounded-full px-2.5 py-1 text-xs font-semibold ${pill.cls}`}>
            {pill.label}
          </span>
        )}
      </div>
      <div className="px-5 pb-5">
        <div className="-mt-10 flex items-end gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-marka text-2xl font-bold text-white shadow-md ring-4 ring-white ">
            {lib.logo_url ? (
              <img src={lib.logo_url} alt="" className="h-full w-full object-cover" />
            ) : (
              initial
            )}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <h1 className="truncate text-xl font-bold text-slate-900 ">{lib.name}</h1>
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500 ">
              {region && (
                <>
                  <PinIcon className="h-3.5 w-3.5 shrink-0" />
                  {region}
                </>
              )}
              {lib.rating_count > 0 && (
                <span className="ml-1 inline-flex items-center gap-1">
                  <StarRating value={lib.rating_average} />
                  {lib.rating_average?.toFixed(1)} ({lib.rating_count})
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="mt-4">
          {lib.status === "ACTIVE" ? (
            <Link
              to={ROUTES.library(lib.slug)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 "
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
              Öğrencinin gördüğü sayfayı aç
            </Link>
          ) : (
            <p className="text-xs text-slate-400 ">
              Kütüphanen onaylanınca öğrencilere görünür olur. Bu sırada profilini
              aşağıdan tamamlayabilirsin.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Bölüm kabuğu: başlık + Düzenle/Kapat ── */
function Section({
  title,
  hint,
  editing,
  onToggle,
  children,
}: {
  title: string;
  hint?: string;
  editing: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={cardCls}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 ">
            {title}
          </h2>
          {hint && !editing && (
            <p className="mt-0.5 text-xs text-slate-400 ">{hint}</p>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0 text-marka hover:bg-marka-soft "
          aria-expanded={editing}
          aria-label={`${title} — ${editing ? "düzenlemeyi kapat" : "düzenle"}`}
          onClick={onToggle}
        >
          {editing ? "Kapat" : "Düzenle"}
        </Button>
      </div>
      {children}
    </div>
  );
}

/** Boş alan için sakin "eklenmemiş" satırı. */
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-400 ">{children}</p>;
}

/* Kaydetme yardımcı kancası: ortak mutate + toast + kapat. */
function useSectionSave(lib: LibraryDetailOut, onDone: () => void) {
  const update = useUpdateLibrary();
  const save = (patch: Partial<EditorState>) => {
    const payload = toPayload({ ...toEditorState(lib), ...patch });
    update.mutate(
      { id: lib.id, payload },
      {
        onSuccess: () => {
          toast.success("Profilin güncellendi.");
          onDone();
        },
        onError: (e) => toast.error(getErrorMessage(e, "Kaydedilemedi.")),
      }
    );
  };
  return { save, busy: update.isPending };
}

/* ── Görseller ── */
function MediaSection({ lib }: { lib: LibraryDetailOut }) {
  return (
    <div className={cardCls}>
      <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400 ">
        Görseller
      </h2>
      <p className="mb-3 text-xs text-slate-400 ">
        Logo, kapak ve galeri fotoğrafları.
      </p>
      <LibraryMediaManager libraryId={lib.id} />
    </div>
  );
}

/* ── Hakkında (açıklama + kapasite + ücret) ── */
function AboutSection({ lib }: { lib: LibraryDetailOut }) {
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState(lib.description ?? "");
  const [capacity, setCapacity] = useState<number | null>(lib.capacity ?? null);
  const [price, setPrice] = useState<number | null>(
    lib.study_hourly_price != null ? Number(lib.study_hourly_price) : null
  );
  const { save, busy } = useSectionSave(lib, () => setEditing(false));

  const reset = () => {
    setDesc(lib.description ?? "");
    setCapacity(lib.capacity ?? null);
    setPrice(lib.study_hourly_price != null ? Number(lib.study_hourly_price) : null);
  };

  return (
    <Section
      title="Hakkında"
      editing={editing}
      onToggle={() => {
        if (!editing) reset();
        setEditing((v) => !v);
      }}
    >
      {!editing ? (
        <div className="space-y-3">
          {lib.description ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600 ">
              {lib.description}
            </p>
          ) : (
            <Empty>Henüz açıklama eklenmemiş.</Empty>
          )}
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-600 ">
              Kapasite: {lib.capacity != null ? `${lib.capacity} koltuk` : "—"}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-600 ">
              Çalışma ücreti:{" "}
              {lib.study_hourly_price != null
                ? `${formatTRY(lib.study_hourly_price)}/saat`
                : "kapalı"}
            </span>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700 ">Açıklama</span>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              className="input"
              placeholder="Sessiz çalışma ortamı, ücretsiz çay-kahve…"
            />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700 ">Kapasite (koltuk)</span>
              <input
                type="number"
                min={0}
                value={capacity ?? ""}
                onChange={(e) => setCapacity(e.target.value ? Number(e.target.value) : null)}
                className="input"
                placeholder="120"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700 ">
                Çalışma ücreti (TL/saat — boş ise kapalı)
              </span>
              <input
                type="number"
                min={0}
                step="0.5"
                value={price ?? ""}
                onChange={(e) => setPrice(e.target.value ? Number(e.target.value) : null)}
                className="input"
                placeholder="25"
              />
            </label>
          </div>
          <SaveRow
            busy={busy}
            onCancel={() => setEditing(false)}
            onSave={() => save({ description: desc, capacity, study_hourly_price: price })}
          />
        </div>
      )}
    </Section>
  );
}

/* ── İletişim ── */
function ContactSection({ lib }: { lib: LibraryDetailOut }) {
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState(lib.phone ?? "");
  const [email, setEmail] = useState(lib.email ?? "");
  const [website, setWebsite] = useState(lib.website ?? "");
  const { save, busy } = useSectionSave(lib, () => setEditing(false));

  const reset = () => {
    setPhone(lib.phone ?? "");
    setEmail(lib.email ?? "");
    setWebsite(lib.website ?? "");
  };
  const has = lib.phone || lib.email || lib.website;

  return (
    <Section
      title="İletişim"
      editing={editing}
      onToggle={() => {
        if (!editing) reset();
        setEditing((v) => !v);
      }}
    >
      {!editing ? (
        has ? (
          <ul className="space-y-1.5 text-sm text-slate-600 ">
            {lib.phone && (
              <li>
                <span className="text-slate-400 ">Telefon:</span> {lib.phone}
              </li>
            )}
            {lib.email && (
              <li>
                <span className="text-slate-400 ">E-posta:</span> {lib.email}
              </li>
            )}
            {lib.website && (
              <li className="truncate">
                <span className="text-slate-400 ">Web:</span> {lib.website}
              </li>
            )}
          </ul>
        ) : (
          <Empty>İletişim bilgisi eklenmemiş.</Empty>
        )
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700 ">Telefon</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" placeholder="0322 000 00 00" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700 ">E-posta</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="iletisim@..." />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700 ">Web sitesi</span>
            <input value={website} onChange={(e) => setWebsite(e.target.value)} className="input" placeholder="https://..." />
          </label>
          <SaveRow busy={busy} onCancel={() => setEditing(false)} onSave={() => save({ phone, email, website })} />
        </div>
      )}
    </Section>
  );
}

/* ── Adres & Konum ── */
function AddressSection({ lib }: { lib: LibraryDetailOut }) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({
    city: lib.city ?? "",
    district: lib.district ?? "",
    neighborhood: lib.neighborhood ?? "",
    street: lib.street ?? "",
    building_no: lib.building_no ?? "",
    location_lat: lib.location_lat ?? null,
    location_lng: lib.location_lng ?? null,
  });
  const { save, busy } = useSectionSave(lib, () => setEditing(false));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const reset = () =>
    setF({
      city: lib.city ?? "",
      district: lib.district ?? "",
      neighborhood: lib.neighborhood ?? "",
      street: lib.street ?? "",
      building_no: lib.building_no ?? "",
      location_lat: lib.location_lat ?? null,
      location_lng: lib.location_lng ?? null,
    });

  return (
    <Section
      title="Adres & Konum"
      editing={editing}
      onToggle={() => {
        if (!editing) reset();
        setEditing((v) => !v);
      }}
    >
      {!editing ? (
        <div className="space-y-3">
          {lib.location_text ? (
            <p className="flex items-start gap-2 text-sm text-slate-600 ">
              <PinIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              {lib.location_text}
            </p>
          ) : (
            <Empty>Adres eklenmemiş.</Empty>
          )}
          {lib.location_lat != null && lib.location_lng != null && (
            <div className="overflow-hidden rounded-xl ring-1 ring-slate-200 ">
              <LibrariesMap libraries={[lib]} height="180px" enablePanel={false} />
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* İP-A7d3: beş alanın beşi de `placeholder`ı ETİKET yerine
              kullanıyordu — tabanın en büyük adsız kontrol kalemi buydu.
              Etiketleme, dosyanın diğer altı bölümünde ZATEN kullanılan
              `<label>` + görünür başlık desenidir; tek bölümü `Form.*`a
              çevirmek aynı ekranda iki ayrı form yazımı üretirdi (gerekçe
              raporda). */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700 ">İl</span>
              <input value={f.city} onChange={(e) => set("city", e.target.value)} className="input" placeholder="ör. Adana" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700 ">İlçe</span>
              <input value={f.district} onChange={(e) => set("district", e.target.value)} className="input" placeholder="ör. Çukurova" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700 ">Mahalle</span>
              <input value={f.neighborhood} onChange={(e) => set("neighborhood", e.target.value)} className="input" placeholder="ör. Toros" />
            </label>
            <div className="grid grid-cols-[1fr_90px] gap-2">
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700 ">Sokak / Cadde</span>
                <input value={f.street} onChange={(e) => set("street", e.target.value)} className="input" />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700 ">No</span>
                <input value={f.building_no} onChange={(e) => set("building_no", e.target.value)} className="input" />
              </label>
            </div>
          </div>
          <p className="text-xs text-slate-500 ">
            Aşağıdan kütüphanenin tam noktasını işaretle (yalnız konum; adresi değiştirmez).
          </p>
          <div className="h-64 overflow-hidden rounded-xl ring-1 ring-slate-200 [&_.map-picker-root]:h-full">
            <MapPicker
              initialLat={f.location_lat}
              initialLng={f.location_lng}
              onLocationSelect={(lat, lng) => {
                set("location_lat", lat);
                set("location_lng", lng);
              }}
            />
          </div>
          {f.location_lat != null && f.location_lng != null && (
            <p className="text-xs text-emerald-600 ">
              ✓ Konum işaretlendi ({f.location_lat.toFixed(5)}, {f.location_lng.toFixed(5)})
            </p>
          )}
          <SaveRow busy={busy} onCancel={() => setEditing(false)} onSave={() => save(f)} />
        </div>
      )}
    </Section>
  );
}

/* ── Çalışma saatleri ── */
function HoursSection({ lib }: { lib: LibraryDetailOut }) {
  const [editing, setEditing] = useState(false);
  const [hours, setHours] = useState<LibraryHours[]>(normalizeWeek(lib.hours));
  const { save, busy } = useSectionSave(lib, () => setEditing(false));
  const todayWeekday = jsDayToWeekday(new Date().getDay());
  const week = normalizeWeek(lib.hours);

  const setHour = (weekday: number, patch: Partial<LibraryHours>) =>
    setHours((hs) => hs.map((h) => (h.weekday === weekday ? { ...h, ...patch } : h)));

  const onSave = () => {
    for (const h of hours) {
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
    save({ hours });
  };

  return (
    <Section
      title="Çalışma Saatleri"
      editing={editing}
      onToggle={() => {
        if (!editing) setHours(normalizeWeek(lib.hours));
        setEditing((v) => !v);
      }}
    >
      {!editing ? (
        <ul className="space-y-1">
          {week.map((h) => {
            const isToday = h.weekday === todayWeekday;
            const closed = h.is_closed || h.open_minute == null;
            return (
              <li
                key={h.weekday}
                className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm ${
                  isToday
                    ? "bg-marka-soft font-semibold text-marka-hover "
                    : "text-slate-600 "
                }`}
              >
                <span>
                  {WEEKDAY_LABELS[h.weekday]}
                  {isToday && " (bugün)"}
                </span>
                <span className={closed ? "font-medium text-rose-500" : ""}>{formatHoursLine(h)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            {(hours ?? EMPTY_HOURS).map((h) => (
              <div key={h.weekday} className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-sm text-slate-600 ">
                  {WEEKDAY_LABELS[h.weekday]}
                </span>
                <label className="flex items-center gap-1 text-xs text-slate-500 ">
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
                    {/* İP-A7d3: iki alan da ADSIZDI — ekran okuyucu yedi günün
                        on dört kutusunu birbirinden ayıramıyordu. `aria-label`
                        deseni `LibraryEditorModal`den (A7d1) alındı.

                        `` de burada EKSİKTİ: A6c'nin
                        SK-6 düzeltmesi ortak `.input` sınıfına yazılmıştı, bu
                        iki kutu kendi sınıfını kullanıyor — koyu panelin
                        üstüne beyaz saat ikonu çiziliyordu. */}
                    <input
                      type="time"
                      aria-label={`${WEEKDAY_LABELS[h.weekday]} açılış saati`}
                      value={minuteToHHMM(h.open_minute) || "09:00"}
                      onChange={(e) => setHour(h.weekday, { open_minute: hhmmToMinute(e.target.value) })}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm "
                    />
                    <span className="text-slate-400">–</span>
                    <input
                      type="time"
                      aria-label={`${WEEKDAY_LABELS[h.weekday]} kapanış saati`}
                      value={minuteToHHMM(h.close_minute) || "22:00"}
                      onChange={(e) => setHour(h.weekday, { close_minute: hhmmToMinute(e.target.value) })}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm "
                    />
                  </>
                ) : (
                  <span className="text-xs text-rose-500">Kapalı</span>
                )}
              </div>
            ))}
          </div>
          <SaveRow busy={busy} onCancel={() => setEditing(false)} onSave={onSave} />
        </div>
      )}
    </Section>
  );
}

/* ── Olanaklar ── */
function AmenitiesSection({ lib }: { lib: LibraryDetailOut }) {
  const [editing, setEditing] = useState(false);
  const [amenities, setAmenities] = useState<string[]>(lib.amenities ?? []);
  const { save, busy } = useSectionSave(lib, () => setEditing(false));

  const toggle = (a: string) =>
    setAmenities((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));

  return (
    <Section
      title="Olanaklar"
      editing={editing}
      onToggle={() => {
        if (!editing) setAmenities(lib.amenities ?? []);
        setEditing((v) => !v);
      }}
    >
      {!editing ? (
        lib.amenities.length > 0 ? (
          <AmenityTagGrid amenities={lib.amenities} />
        ) : (
          <Empty>Olanak eklenmemiş.</Empty>
        )
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {AMENITY_OPTIONS.map((a) => {
              const active = amenities.includes(a);
              return (
                <button
                  key={a}
                  type="button"
                  // BİLİNÇLİ ham <button>: bir aksiyon değil SEÇİM DURUMU.
                  // Ortak Button'ın dolgu/gölge varyantları bu yuvarlak çip
                  // dilini taşımıyor (AdminStore'un katlanır başlığı ve
                  // kütüphane editörünün olanak rozetleriyle aynı istisna).
                  // A7d3'te EKSİK olan aria-pressed eklendi: seçili çip ekran
                  // okuyucuda seçilmemişten ayırt edilemiyordu.
                  aria-pressed={active}
                  onClick={() => toggle(a)}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    active
                      ? "bg-marka text-white"
                      : "bg-slate-100 text-slate-600 "
                  }`}
                >
                  {(() => { const I = amenityIcon(a); return <I size={14} stroke={1.75} aria-hidden />; })()}
                  {amenityLabel(a)}
                </button>
              );
            })}
          </div>
          <SaveRow busy={busy} onCancel={() => setEditing(false)} onSave={() => save({ amenities })} />
        </div>
      )}
    </Section>
  );
}

/* ── Ortak kaydet/vazgeç satırı ── */
function SaveRow({
  busy,
  onSave,
  onCancel,
}: {
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex gap-2 pt-1">
      {/* Düğme geçerlilikle KAPANMAZ; yalnız gönderim sürerken kilitlenir. */}
      <Button className="rounded-xl" isPending={busy} onClick={onSave}>
        Kaydet
      </Button>
      <Button variant="secondary" className="rounded-xl" disabled={busy} onClick={onCancel}>
        Vazgeç
      </Button>
    </div>
  );
}
