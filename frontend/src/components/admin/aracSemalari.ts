// Araçlar (filo) ve başlangıç noktası (BASE) formlarının ORTAK zod sözleşmeleri ve form ↔ payload
// dönüşümleri — eski `DeliveryVehiclesPage` ve yeni panel `AracPencereleri` aynı nesneleri kullanır; iki
// ekran arasında doğrulama/payload sapması olamaz. Backend `schemas/delivery.py` (VehicleCreate/Update,
// PickupPointCreate/Update) tek doğruluk kaynağıdır; keyfî yeni kural eklenmez.
import { z } from "zod";
import type { PickupPoint, Vehicle } from "@/types";

/** "HH:MM:SS" (backend time) → time input değeri "HH:MM". */
export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

/** Vardiya özeti — ikisi de boşsa null, aksi hâlde "HH:MM–HH:MM" (eksik uç "…"). */
export function shiftText(v: Vehicle): string | null {
  if (!v.shift_start && !v.shift_end) return null;
  return `${hhmm(v.shift_start) || "…"}–${hhmm(v.shift_end) || "…"}`;
}

/** Boş bırakılabilen, en az `enAz` olan sayı alanı. */
function sayiAlani(etiket: string, enAz: number) {
  return z
    .string()
    .refine((v) => v.trim() === "" || Number.isFinite(Number(v)), `${etiket} bir sayı olmalı.`)
    .refine((v) => v.trim() === "" || Number(v) >= enAz, `${etiket} en az ${enAz} olmalı.`);
}

/**
 * Araç formu şeması. `kodlu` ayrımı bir DAL değil bir SÖZLEŞME farkıdır: kod yalnız oluşturmada girilir,
 * düzenlemede alan hiç render edilmez (değişmez).
 */
export function aracSemasi(kodlu: boolean) {
  return z.object({
    label: z.string().trim().min(1, "Araç adı (etiket) gerekli."),
    code: kodlu
      ? z.string().trim().regex(/^[A-Z0-9_-]+$/, "Kod yalnız BÜYÜK harf, rakam, _ ve - içerebilir (örn. DOBLO).")
      : z.string(),
    plate: z.string(),
    maxStops: sayiAlani("Durak tavanı", 1),
    shiftStart: z.string(),
    shiftEnd: z.string(),
    fixedCost: sayiAlani("Sabit maliyet", 0),
    sortOrder: z.string().refine((v) => v.trim() === "" || Number.isFinite(Number(v)), "Sıra bir sayı olmalı."),
  });
}
export type VehicleFormState = z.infer<ReturnType<typeof aracSemasi>>;

export const ARAC_SIRA = ["label", "code", "plate", "maxStops", "shiftStart", "shiftEnd", "fixedCost", "sortOrder"] as const;

/** Araç → form değerleri (boş araç = oluşturma varsayılanları). */
export function formFrom(v?: Vehicle): VehicleFormState {
  return {
    label: v?.label ?? "",
    code: v?.code ?? "",
    plate: v?.plate ?? "",
    maxStops: v?.max_stops != null ? String(v.max_stops) : "",
    shiftStart: hhmm(v?.shift_start),
    shiftEnd: hhmm(v?.shift_end),
    fixedCost: v != null ? String(v.fixed_cost) : "0",
    sortOrder: v != null ? String(v.sort_order) : "0",
  };
}

/** Formdan PATCH/POST gövdesine (code hariç — o yalnız oluşturmada). */
export function payloadFrom(f: VehicleFormState) {
  return {
    label: f.label.trim(),
    plate: f.plate.trim() || null,
    max_stops: f.maxStops.trim() === "" ? null : Number(f.maxStops),
    shift_start: f.shiftStart || null,
    shift_end: f.shiftEnd || null,
    fixed_cost: f.fixedCost.trim() === "" ? 0 : Number(f.fixedCost),
    sort_order: f.sortOrder.trim() === "" ? 0 : Number(f.sortOrder),
  };
}

/* ── Başlangıç noktası (BASE) ── */

/** Koordinat kuralı ALANIN kendi şemasında; mesaj o alanın altında çıkar. */
const koordinat = (etiket: string, sinir: number) =>
  z
    .string()
    .refine((v) => v.trim() !== "", `${etiket} gerekli.`)
    .refine((v) => v.trim() === "" || Number.isFinite(Number(v)), `${etiket} sayı olmalı (örn. 36.98550).`)
    .refine((v) => v.trim() === "" || Math.abs(Number(v)) <= sinir, `${etiket} ±${sinir} aralığında olmalı.`);

export const noktaSemasi = z.object({
  name: z.string().trim().min(1, "Nokta adı gerekli."),
  address: z.string(),
  lat: koordinat("Enlem", 90),
  lng: koordinat("Boylam", 180),
  sortOrder: z.string().refine((v) => v.trim() === "" || Number.isFinite(Number(v)), "Sıra bir sayı olmalı."),
});
export type NoktaFormDegerleri = z.infer<typeof noktaSemasi>;

export const NOKTA_SIRA = ["name", "address", "lat", "lng", "sortOrder"] as const;

export function noktaDegerleri(p?: PickupPoint): NoktaFormDegerleri {
  return {
    name: p?.name ?? "",
    address: p?.address ?? "",
    lat: p != null ? String(p.lat) : "",
    lng: p != null ? String(p.lng) : "",
    sortOrder: p != null ? String(p.sort_order) : "0",
  };
}

/** Nokta formu → PATCH/POST gövdesi (sayısal alanlar number; `kind` yalnız oluşturmada eklenir). */
export function noktaGovdesi(d: NoktaFormDegerleri) {
  return {
    name: d.name.trim(),
    address: d.address.trim() || null,
    lat: Number(d.lat),
    lng: Number(d.lng),
    sort_order: d.sortOrder.trim() === "" ? 0 : Number(d.sortOrder),
  };
}
