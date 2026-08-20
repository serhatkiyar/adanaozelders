// Kütüphane editörü — panelin en çok bölümlü formu.
//
// ## İP-A7d1 · göç dalgası 1, ekran (a)
//
// Bu form `Form.*` sözleşmesini bugüne dek sınanmamış bir genişlikte zorlar:
// yirmi küsur alan, ÜÇ bağımsız koşullu dal (admin/operatör kimlik yetkisi ·
// yeni/düzenleme · günün açık/kapalı olması) ve ÇAPRAZ ALAN doğrulaması
// (kapanış açılıştan sonra olmalı). A6 pilotu (`DamageDialog`) beş alanlıydı.
//
// Göçte değişenler ve gerekçeleri:
//
//   1. **Doğrulama toast'tan ALANA indi.** Eskiden `submit()` içinde elle
//      kontrol ediliyor ve ilk hata `toast.error` ile ekranın köşesine
//      atılıyordu: kullanıcı hangi alanı düzelteceğini metinden çıkarmak
//      zorundaydı ("Salı: kapanış açılıştan sonra olmalı" — yedi günlük
//      tablonun neresi?). Artık hata alanın altında, `aria-invalid` +
//      `role="alert"` ile ve ODAK ilk hatalı alana taşınıyor.
//   2. **Gönder düğmesi geçerlilikle KAPANMAZ** (kilitli karar): basılır,
//      geçersizse gönderim yapılmaz, hatalar belirir.
//   3. **Sunucu 422'si alanlara dağıtılır** (`sunucuHatasiniUygula`).
//      Eskiden her sunucu hatası tek bir toast'tı.
//   4. **Pencere ortak yüzeyden gelir.** Eski hâlde `fixed inset-0` katmanı
//      elle kuruluyordu: `role="dialog"` YOK, `aria-modal` YOK, odak tuzağı
//      YOK, ESC YOK (etiketsiz overlay sayacının kalemlerinden biriydi).
//      Artık `DuzenlemePenceresi` + kirli form bekçisi.
//   5. **Pencere durumu ekranda yaşamıyor**: `state` prop'u yerine yüzey.
//
// Değişmeyen: gövde alanları, `cover_url`ün gönderilmemesi (görseller yalnız
// `LibraryMediaManager`dan yönetilir), oluşturunca kapatmayıp düzenleme
// moduna geçme, operatörde adın salt-okunur olması.
//
// ## Kapsam dışı bırakılan doğrulama (bilinçli)
//
// E-posta/web adresi biçimi ve telefon maskesi EKLENMEDİ: bu göç paketinin
// kuralı "davranışı taşımak", yeni iş kuralı getirmek değil. Sunucu bu
// alanları zaten doğruluyorsa 422 artık alanın altına düşer.
import { useEffect, useMemo, useRef } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { MapPicker } from "@/components/MapPicker";
import { LibraryMediaManager } from "@/components/LibraryMediaManager";
import { Button } from "@/components/admin/ui";
import {
  DuzenlemePenceresi,
  useYuzeyKirliFormBekcisi,
  type DuzenlemeYuzeyiDurumu,
} from "@/components/admin/ui2/duzenlemeYuzeyi";
import { Form, sunucuHatasiniUygula } from "@/components/admin/ui2/form";
import { useCreateLibrary, useUpdateLibrary } from "@/hooks/useLibraries";
import { AMENITY_OPTIONS, amenityLabel } from "@/lib/amenities";
import { amenityIcon } from "@/lib/amenityIcons";
import {
  WEEKDAY_LABELS,
  hhmmToMinute,
  minuteToHHMM,
  normalizeWeek,
} from "@/lib/libraryHours";
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

/* ═══════════════════════ form değerleri ve şema ═══════════════════════ */

interface SaatDegeri {
  weekday: number;
  is_closed: boolean;
  /** "HH:MM" — `<input type="time">`in kendi biçimi; gövdede dakikaya çevrilir. */
  open: string;
  close: string;
}

export interface KutuphaneFormDegerleri {
  name: string;
  description: string;
  phone: string;
  email: string;
  website: string;
  city: string;
  district: string;
  neighborhood: string;
  street: string;
  building_no: string;
  /** Sayısal alanlar METİN tutulur: boş kutu ile 0 ayrı şeylerdir. */
  capacity: string;
  study_hourly_price: string;
  status: string;
  location_lat: number | null;
  location_lng: number | null;
  amenities: string[];
  hours: SaatDegeri[];
}

/** Boş ya da negatif olmayan sayı. */
function sayiAlani(etiket: string) {
  return z.string().refine(
    (v) => v.trim() === "" || (Number.isFinite(Number(v)) && Number(v) >= 0),
    `${etiket} negatif olamaz.`
  );
}

/**
 * Şema kimlik yetkisine BAĞLIDIR: operatörde ad alanı salt-okunurdur ve
 * doldurmak operatörün elinde değildir — zorunlu kılmak onu kilitlerdi.
 */
export function kutuphaneSemasi(kimlikYetkisi: boolean) {
  return z.object({
    name: kimlikYetkisi
      ? z.string().trim().min(2, "Kütüphane adı en az 2 karakter olmalı.")
      : z.string(),
    description: z.string(),
    phone: z.string(),
    email: z.string(),
    website: z.string(),
    city: z.string(),
    district: z.string(),
    neighborhood: z.string(),
    street: z.string(),
    building_no: z.string(),
    capacity: sayiAlani("Kapasite"),
    study_hourly_price: sayiAlani("Saatlik ücret"),
    status: z.string(),
    location_lat: z.number().nullable(),
    location_lng: z.number().nullable(),
    amenities: z.array(z.string()),
    hours: z
      .array(
        z.object({
          weekday: z.number(),
          is_closed: z.boolean(),
          open: z.string(),
          close: z.string(),
        })
      )
      // ÇAPRAZ ALAN doğrulaması: hata GÜNÜN kendi alanına yazılır, forma
      // genel bir mesaj olarak değil. Eski hâlde bu bir toast'tı ve yedi
      // günlük tabloda hangi satırın kastedildiği belirsizdi.
      .superRefine((liste, ctx) => {
        liste.forEach((g, i) => {
          if (g.is_closed) return;
          const acilis = hhmmToMinute(g.open);
          const kapanis = hhmmToMinute(g.close);
          if (acilis == null) {
            ctx.addIssue({
              code: "custom",
              path: [i, "open"],
              message: "Açılış saatini girin.",
            });
          }
          if (kapanis == null) {
            ctx.addIssue({
              code: "custom",
              path: [i, "close"],
              message: "Kapanış saatini girin.",
            });
            return;
          }
          if (acilis != null && kapanis <= acilis) {
            ctx.addIssue({
              code: "custom",
              path: [i, "close"],
              message: "Kapanış açılıştan sonra olmalı.",
            });
          }
        });
      }),
  });
}

/** `sunucuHatasiniUygula` için BEYAZ LİSTE — sunucu adları formunkilerle aynı. */
const ALANLAR = [
  "name",
  "description",
  "phone",
  "email",
  "website",
  "city",
  "district",
  "neighborhood",
  "street",
  "building_no",
  "capacity",
  "study_hourly_price",
  "status",
] as const;

/** Alanların GÖRSEL sırası; "ilk hatalı alan" bu sıradan okunur. */
const GORSEL_SIRA = [
  "name",
  "capacity",
  "study_hourly_price",
  "description",
  "phone",
  "email",
  "website",
  "city",
  "district",
  "neighborhood",
  "street",
  "building_no",
] as const;

function editorDegerleri(kayit: EditorState): KutuphaneFormDegerleri {
  const hafta = normalizeWeek(kayit.hours ?? EMPTY_HOURS);
  return {
    name: kayit.name ?? "",
    description: kayit.description ?? "",
    phone: kayit.phone ?? "",
    email: kayit.email ?? "",
    website: kayit.website ?? "",
    city: kayit.city ?? "",
    district: kayit.district ?? "",
    neighborhood: kayit.neighborhood ?? "",
    street: kayit.street ?? "",
    building_no: kayit.building_no ?? "",
    capacity: kayit.capacity != null ? String(kayit.capacity) : "",
    study_hourly_price:
      kayit.study_hourly_price != null ? String(kayit.study_hourly_price) : "",
    status: kayit.status ?? "ACTIVE",
    location_lat: kayit.location_lat ?? null,
    location_lng: kayit.location_lng ?? null,
    amenities: kayit.amenities ?? [],
    hours: hafta.map((h) => ({
      weekday: h.weekday,
      is_closed: h.is_closed,
      open: minuteToHHMM(h.open_minute),
      close: minuteToHHMM(h.close_minute),
    })),
  };
}

function govde(d: KutuphaneFormDegerleri): LibraryWrite {
  const metin = (v: string) => v.trim() || null;
  const sayi = (v: string) => (v.trim() === "" ? null : Number(v));
  return {
    name: d.name.trim(),
    description: metin(d.description),
    phone: metin(d.phone),
    email: metin(d.email),
    website: metin(d.website),
    // Yapısal adres elle girilir; tam adres (location_text) backend'de derlenir.
    city: metin(d.city),
    district: metin(d.district),
    neighborhood: metin(d.neighborhood),
    street: metin(d.street),
    building_no: metin(d.building_no),
    location_lat: d.location_lat,
    location_lng: d.location_lng,
    capacity: sayi(d.capacity),
    study_hourly_price: sayi(d.study_hourly_price),
    status: d.status || "ACTIVE",
    amenities: d.amenities,
    hours: d.hours.map((h) => ({
      weekday: h.weekday,
      is_closed: h.is_closed,
      open_minute: h.is_closed ? null : hhmmToMinute(h.open),
      close_minute: h.is_closed ? null : hhmmToMinute(h.close),
    })),
  };
}

/* ═══════════════════════════ bileşen ═══════════════════════════ */

interface LibraryEditorModalProps {
  /** Pencere durumunu TAŞIYAN yüzey (İP-A7d1). Ekran "modal açık mı" tutmaz. */
  yuzey: DuzenlemeYuzeyiDurumu<EditorState, void>;
  /** false → operatör: ad salt-okunur + görünürlük (status) gizli (admin'de kalır). */
  canEditIdentity?: boolean;
}

/**
 * Pencere DIŞ kabuk, form İÇ bileşendir — ve bu bir zorunluluktur.
 *
 * `useYuzeyKirliFormBekcisi` bekçiyi pencereye BAĞLAM üzerinden bildirir;
 * bağlamı `DuzenlemePenceresi` açar. Kancayı pencereyi RENDER EDEN bileşende
 * çağırmak (yani burada) bağlamın dışında kalmak demektir: kanca sessizce
 * `null` bildirim alır, pencere bekçiyi hiç tanımaz ve ×/ESC/dış tıklama
 * kirli formu SORMADAN kapatır — kullanıcının yazdığı veri gider.
 *
 * Bu tuzağa bu göçte düşüldü ve kabul testi yakaladı (rapor → sözleşme
 * kusurları · SK-3). Sözleşme artık `useYuzeyKirliFormBekcisi`nin kendi
 * içinde de geliştirmede uyarıyor.
 */
export function LibraryEditorModal({ yuzey, canEditIdentity = true }: LibraryEditorModalProps) {
  const kayit = yuzey.kayit;
  const isEdit = kayit?.id != null;
  const baslik = canEditIdentity
    ? isEdit
      ? "Kütüphaneyi Düzenle"
      : "Yeni Kütüphane"
    : "Kütüphane Profilim";

  return (
    <DuzenlemePenceresi yuzey={yuzey} baslik={baslik} genislik="genis">
      {kayit && (
        <EditorIcerik yuzey={yuzey} kayit={kayit} canEditIdentity={canEditIdentity} />
      )}
    </DuzenlemePenceresi>
  );
}

function EditorIcerik({
  yuzey,
  kayit,
  canEditIdentity,
}: {
  yuzey: DuzenlemeYuzeyiDurumu<EditorState, void>;
  kayit: EditorState;
  canEditIdentity: boolean;
}) {
  const create = useCreateLibrary();
  const update = useUpdateLibrary();
  const busy = create.isPending || update.isPending;
  const isEdit = kayit.id != null;

  const form = useForm<KutuphaneFormDegerleri>({
    resolver: zodResolver(kutuphaneSemasi(canEditIdentity)),
    defaultValues: editorDegerleri(kayit),
    mode: "onChange",
    // Odaklamayı KENDİMİZ yapıyoruz: `react-hook-form`un kendi odaklaması
    // `onInvalid`ten sonra çalışıp bizimkini ezer ve dizi alanlarında
    // (saatler) "ilk hatalı alan" yerine ilk ODAKLANABİLİR alana gider.
    shouldFocusError: false,
  });

  // Hedef değişince (oluşturma sonrası düzenleme moduna geçiş) form yeniden
  // kurulur. Pencere KAPANDIĞINDA içerik zaten sökülür — açılış sıfırlaması
  // için ayrı bir etkiye gerek yoktur.
  const hedefKimligi = kayit.id ?? "yeni";
  useEffect(() => {
    form.reset(editorDegerleri(kayit));
    // `form` kimliğini korur; bağımlılığa eklemek gereksiz sıfırlama üretir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hedefKimligi]);

  // Kirli form bekçisi: ×/ESC/dış tıklama yolları pencereden geçer.
  const sunucuHatasi = create.error ?? update.error ?? null;
  useYuzeyKirliFormBekcisi({ form, sunucuHatasi });

  const genelHataRef = useRef<string | null>(null);
  const degerler = form.watch();
  const hafta = degerler.hours ?? [];

  const ilkHatayaOdaklan = (hatalar: FieldErrors<KutuphaneFormDegerleri>) => {
    const alan = GORSEL_SIRA.find((a) => hatalar[a]);
    if (alan) {
      form.setFocus(alan);
      return;
    }
    const saatler = hatalar.hours as unknown as
      | ({ open?: unknown; close?: unknown } | undefined)[]
      | undefined;
    if (!Array.isArray(saatler)) return;
    for (let i = 0; i < saatler.length; i += 1) {
      if (saatler[i]?.open) return form.setFocus(`hours.${i}.open` as never);
      if (saatler[i]?.close) return form.setFocus(`hours.${i}.close` as never);
    }
  };

  const sunucuHatasiniDagit = (hata: unknown) => {
    const kalan = sunucuHatasiniUygula(hata, form, ALANLAR as unknown as string[]);
    genelHataRef.current = kalan;
    // Alanlara yazılmayan kısım şeritte gösterilir; şerit `formState`ten
    // türemediği için elle bir render tetiklenir.
    form.setError("root.sunucu", { type: "server", message: kalan ?? undefined });
  };

  const gonder = form.handleSubmit(
    (d) => {
      form.clearErrors("root.sunucu");
      genelHataRef.current = null;
      const payload = govde(d);
      if (isEdit) {
        update.mutate(
          { id: kayit.id!, payload },
          {
            onSuccess: () => {
              toast.success(
                canEditIdentity ? "Kütüphane güncellendi." : "Profilin güncellendi."
              );
              // KOŞULSUZ kapatma: veri kaydedildi, bekçiye soracak bir şey yok.
              yuzey.kapat();
            },
            onError: sunucuHatasiniDagit,
          }
        );
      } else {
        // Oluşturunca KAPATMA: dönen id ile düzenleme moduna geç →
        // görsel yöneticisi açılsın.
        create.mutate(payload, {
          onSuccess: (created) => {
            toast.success("Kütüphane eklendi. Artık logo ve galeri ekleyebilirsin.");
            yuzey.ac({ ...kayit, ...payload, id: created.id });
          },
          onError: sunucuHatasiniDagit,
        });
      }
    },
    (hatalar) => ilkHatayaOdaklan(hatalar)
  );

  const genelHata = form.formState.errors.root?.sunucu?.message;

  const gunuAc = (i: number, acik: boolean) => {
    form.setValue(`hours.${i}.is_closed`, !acik, { shouldDirty: true });
    if (acik && !form.getValues(`hours.${i}.open`)) {
      form.setValue(`hours.${i}.open`, "09:00", { shouldDirty: true });
      form.setValue(`hours.${i}.close`, "22:00", { shouldDirty: true });
    }
  };

  const olanakDegistir = (a: string) => {
    const cur = form.getValues("amenities") ?? [];
    form.setValue(
      "amenities",
      cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a],
      { shouldDirty: true }
    );
  };

  const alanlar = useMemo(
    () => ({
      adres: [
        { ad: "city" as const, etiket: "İl", ipucu: "Örn. Adana" },
        { ad: "district" as const, etiket: "İlçe", ipucu: "Örn. Çukurova" },
        { ad: "neighborhood" as const, etiket: "Mahalle", ipucu: "" },
        { ad: "street" as const, etiket: "Sokak / Cadde", ipucu: "" },
        { ad: "building_no" as const, etiket: "Bina no", ipucu: "" },
      ],
    }),
    []
  );

  return (
    <div className="space-y-5">
        {/* ── Temel bilgi ── */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Form.Field
            control={form.control}
            name="name"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>
                  {canEditIdentity ? "Kütüphane Adı" : "Kütüphane Adı (admin belirler)"}
                </Form.Label>
                <Form.Control>
                  <input
                    {...field}
                    disabled={!canEditIdentity}
                    className={`input ${!canEditIdentity ? "cursor-not-allowed opacity-60" : ""}`}
                  />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
          <Form.Field
            control={form.control}
            name="capacity"
            render={({ field }) => (
              <Form.Item>
                <Form.Label optional>Kapasite (koltuk sayısı)</Form.Label>
                <Form.Control>
                  <input type="number" min={0} className="input" {...field} />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </div>

        <Form.Field
          control={form.control}
          name="study_hourly_price"
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>Çalışma alanı saatlik ücreti (TL)</Form.Label>
              <Form.Control>
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  className="input"
                  {...field}
                />
              </Form.Control>
              <Form.Hint>Boş bırakılırsa çalışma alanı rezervasyonu kapalıdır.</Form.Hint>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={form.control}
          name="description"
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>Açıklama (biyografi)</Form.Label>
              <Form.Control>
                <textarea rows={3} className="input" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Form.Field
            control={form.control}
            name="phone"
            render={({ field }) => (
              <Form.Item>
                <Form.Label optional>Telefon</Form.Label>
                <Form.Control>
                  <input className="input" {...field} />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
          <Form.Field
            control={form.control}
            name="email"
            render={({ field }) => (
              <Form.Item>
                <Form.Label optional>E-posta</Form.Label>
                <Form.Control>
                  <input className="input" {...field} />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
          <Form.Field
            control={form.control}
            name="website"
            render={({ field }) => (
              <Form.Item>
                <Form.Label optional>Web sitesi</Form.Label>
                <Form.Control>
                  <input className="input" {...field} />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </div>

        {/* ── Görseller — yalnız kayıtlı kütüphanede (koşullu dal) ── */}
        <section>
          <p className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
            Görseller (logo · kapak · galeri)
          </p>
          {isEdit ? (
            <LibraryMediaManager libraryId={kayit.id!} />
          ) : (
            <p className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Logo, kapak ve galeri fotoğraflarını yüklemek için önce kütüphaneyi
              kaydedin, sonra “Düzenle” ile geri dönün.
            </p>
          )}
        </section>

        {/* ── Durum — yalnız admin (koşullu dal) ── */}
        {canEditIdentity && (
          <section>
            <p className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
              Durum
            </p>
            <div className="flex gap-2">
              {[
                { v: "ACTIVE", l: "Yayında" },
                { v: "HIDDEN", l: "Gizli" },
              ].map((o) => (
                <Button
                  key={o.v}
                  size="sm"
                  variant={degerler.status === o.v ? "primary" : "secondary"}
                  aria-pressed={degerler.status === o.v}
                  onClick={() => form.setValue("status", o.v, { shouldDirty: true })}
                >
                  {o.l}
                </Button>
              ))}
            </div>
          </section>
        )}

        {/* ── Adres ── */}
        <section>
          <p className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
            Adres
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {alanlar.adres.map((a) => (
              <Form.Field
                key={a.ad}
                control={form.control}
                name={a.ad}
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>{a.etiket}</Form.Label>
                    <Form.Control>
                      <input className="input" placeholder={a.ipucu} {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            ))}
          </div>
        </section>

        {/* ── Konum — yalnız harita işareti (adres OTOMATİK dolmaz) ── */}
        <section>
          <p className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
            Harita Konumu (yol tarifi için)
          </p>
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
            Adresi yukarıdan yaz; aşağıdan da kütüphanenin tam noktasını işaretle.
            Harita yalnız konumu (koordinat) belirler, adresi değiştirmez.
          </p>
          <div className="h-72 overflow-hidden rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 [&_.map-picker-root]:h-full">
            <MapPicker
              initialLat={degerler.location_lat}
              initialLng={degerler.location_lng}
              onLocationSelect={(lat, lng) => {
                form.setValue("location_lat", lat, { shouldDirty: true });
                form.setValue("location_lng", lng, { shouldDirty: true });
              }}
            />
          </div>
          {degerler.location_lat != null && degerler.location_lng != null && (
            <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
              ✓ Konum işaretlendi ({degerler.location_lat.toFixed(5)},{" "}
              {degerler.location_lng.toFixed(5)})
            </p>
          )}
        </section>

        {/* ── Olanaklar ── */}
        <section>
          <p className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
            Olanaklar
          </p>
          <div className="flex flex-wrap gap-2">
            {AMENITY_OPTIONS.map((a) => {
              const secili = (degerler.amenities ?? []).includes(a);
              const I = amenityIcon(a);
              return (
                <button
                  key={a}
                  type="button"
                  aria-pressed={secili}
                  onClick={() => olanakDegistir(a)}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    secili
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                  }`}
                >
                  <I size={14} stroke={1.75} aria-hidden />
                  {amenityLabel(a)}
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Çalışma saatleri (koşullu dal: açık gün ↔ kapalı gün) ── */}
        <section>
          <p className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
            Çalışma Saatleri
          </p>
          <div className="space-y-1.5">
            {hafta.map((g, i) => (
              <div key={g.weekday} className="flex items-start gap-2">
                <span className="mt-2 w-24 text-sm text-slate-600 dark:text-slate-300">
                  {WEEKDAY_LABELS[g.weekday]}
                </span>
                <label className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    aria-label={`${WEEKDAY_LABELS[g.weekday]} açık`}
                    checked={!g.is_closed}
                    onChange={(e) => gunuAc(i, e.target.checked)}
                  />
                  Açık
                </label>
                {!g.is_closed ? (
                  <>
                    {/* Etiket GÜN ADIYLA birlikte verilir: yedi satırlık
                        tabloda yalnız "Açılış" demek ekran okuyucuda yedi
                        özdeş alan üretirdi. */}
                    <Form.Field
                      control={form.control}
                      name={`hours.${i}.open`}
                      render={({ field }) => (
                        <Form.Item className="min-w-32">
                          <Form.Control>
                            <input
                              type="time"
                              aria-label={`${WEEKDAY_LABELS[g.weekday]} açılış saati`}
                              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:[color-scheme:dark]"
                              {...field}
                            />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                    <span className="mt-2 text-slate-400">–</span>
                    <Form.Field
                      control={form.control}
                      name={`hours.${i}.close`}
                      render={({ field }) => (
                        <Form.Item className="min-w-32">
                          <Form.Control>
                            <input
                              type="time"
                              aria-label={`${WEEKDAY_LABELS[g.weekday]} kapanış saati`}
                              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:[color-scheme:dark]"
                              {...field}
                            />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                  </>
                ) : (
                  <span className="mt-2 text-xs text-slate-500 dark:text-slate-400">Kapalı</span>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* YALNIZ genel/sunucu hatası. Alan hataları kendi alanlarının altında. */}
        {genelHata && (
          <p
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100"
          >
            {genelHata}
          </p>
        )}

        <div className="flex justify-end">
          {/* Geçerlilik kapısı YOK: düğme yalnız işlem sürerken kapanır. */}
          <Button isPending={busy} onClick={gonder}>
            {isEdit ? "Güncelle" : "Ekle"}
          </Button>
      </div>
    </div>
  );
}
