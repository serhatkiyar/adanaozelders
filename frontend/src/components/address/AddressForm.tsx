import { FormEvent, useState } from "react";
import { toast } from "@/store/toastStore";
import { LocationPreview } from "@/components/LocationPreview";
import { AddressMapModal } from "@/components/address/AddressMapModal";
import type { SavedAddress, SavedAddressCreate } from "@/types";

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition duration-150 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500 dark:focus:border-indigo-500 dark:focus:ring-indigo-900/30";

const fieldLabelCls =
  "mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400";

const saveBtn =
  "rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50";

const cancelBtn =
  "rounded-xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700";

// Yapısal il/ilçe: Cıncık Teslimat bölge kontrolünün fallback'i (harita pin'i
// otorite). Merkez ilçeler önde; datalist serbest yazıma da izin verir.
const ADANA_DISTRICTS = [
  "Seyhan",
  "Yüreğir",
  "Çukurova",
  "Sarıçam",
  "Ceyhan",
  "Kozan",
  "İmamoğlu",
  "Karaisalı",
  "Karataş",
  "Pozantı",
  "Saimbeyli",
  "Tufanbeyli",
  "Yumurtalık",
  "Aladağ",
  "Feke",
];

interface AddressFormProps {
  initial?: Partial<SavedAddress> | null;
  pending: boolean;
  submitLabel?: string;
  /** true ise konum (lat/lng) seçilmeden kaydedilemez. */
  requireLocation?: boolean;
  /** Varsayılan adres kutusunu gösterme (örn. ilk adres zaten varsayılan olacaksa). */
  hideDefaultToggle?: boolean;
  onSubmit: (payload: SavedAddressCreate) => void;
  onCancel: () => void;
}

/**
 * Adres ekle/düzenle formu — rezervasyon ekranı ve ayarlar tek tasarımı paylaşsın
 * diye ortak. Başlık, haritadan konum + önizleme, adres satırı, kapı/daire,
 * tarif/not ve varsayılan adres alanlarını içerir.
 */
export function AddressForm({
  initial,
  pending,
  submitLabel = "Kaydet",
  requireLocation = false,
  hideDefaultToggle = false,
  onSubmit,
  onCancel,
}: AddressFormProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [addressLine, setAddressLine] = useState(initial?.address_line ?? "");
  const [city, setCity] = useState(initial?.city ?? "Adana");
  const [district, setDistrict] = useState(initial?.district ?? "");
  const [doorNo, setDoorNo] = useState(initial?.door_no ?? "");
  const [aptNo, setAptNo] = useState(initial?.apt_no ?? "");
  const [directions, setDirections] = useState(initial?.directions ?? "");
  const [lat, setLat] = useState<number | null>(initial?.location_lat ?? null);
  const [lng, setLng] = useState<number | null>(initial?.location_lng ?? null);
  const [isDefault, setIsDefault] = useState(initial?.is_default ?? false);
  const [showMap, setShowMap] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Adres başlığı boş olamaz.");
      return;
    }
    if (!addressLine.trim()) {
      toast.error("Adres satırı boş olamaz.");
      return;
    }
    if (requireLocation && lat == null) {
      toast.error("Lütfen haritadan konum seçin.");
      return;
    }
    onSubmit({
      title: title.trim(),
      address_line: addressLine.trim(),
      city: city.trim() || null,
      district: district.trim() || null,
      door_no: doorNo.trim() || null,
      apt_no: aptNo.trim() || null,
      directions: directions.trim() || null,
      location_lat: lat,
      location_lng: lng,
      is_default: isDefault,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-700/40">
      <div>
        <label className={fieldLabelCls}>Adres Başlığı *</label>
        <input
          type="text"
          required
          maxLength={80}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputCls}
          placeholder="Örn. Ev, Kütüphane, İş"
          autoFocus
        />
      </div>

      {/* Konum seçimi + önizleme */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-600 dark:bg-slate-800">
        <div className="flex items-center justify-between">
          <span className={`flex items-center gap-1.5 text-xs font-medium ${lat != null ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400 dark:text-slate-500"}`}>
            {lat != null ? (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Konum işaretlendi
              </>
            ) : requireLocation ? (
              "Konum işaretlenmedi"
            ) : (
              "Konum işaretlenmedi (opsiyonel)"
            )}
          </span>
          <button
            type="button"
            onClick={() => setShowMap(true)}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
          >
            {lat != null ? "Değiştir" : "Haritadan Seç"}
          </button>
        </div>
        {lat != null && lng != null && (
          <div className="mt-3">
            <LocationPreview lat={lat} lng={lng} height={140} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={fieldLabelCls}>İl</label>
          <input
            type="text"
            maxLength={100}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className={inputCls}
            placeholder="Adana"
          />
        </div>
        <div>
          <label className={fieldLabelCls}>İlçe</label>
          <input
            type="text"
            maxLength={100}
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            className={inputCls}
            placeholder="Örn. Seyhan"
            list="address-district-options"
          />
          {city.trim().toLocaleLowerCase("tr") === "adana" && (
            <datalist id="address-district-options">
              {ADANA_DISTRICTS.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          )}
        </div>
      </div>

      <div>
        <label className={fieldLabelCls}>Adres (Mahalle, Sokak, Cadde) *</label>
        <textarea
          rows={2}
          maxLength={2000}
          value={addressLine}
          onChange={(e) => setAddressLine(e.target.value)}
          className={inputCls}
          placeholder="Mahalle, Sokak, Cadde…"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={fieldLabelCls}>Dış Kapı No</label>
          <input
            type="text"
            maxLength={20}
            value={doorNo}
            onChange={(e) => setDoorNo(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className={fieldLabelCls}>Daire No</label>
          <input
            type="text"
            maxLength={20}
            value={aptNo}
            onChange={(e) => setAptNo(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className={fieldLabelCls}>Tarif / Not (opsiyonel)</label>
        <textarea
          rows={2}
          maxLength={2000}
          value={directions}
          onChange={(e) => setDirections(e.target.value)}
          className={inputCls}
          placeholder="Örn. Apartman girişi arka tarafta, zili çalışmıyor…"
        />
      </div>

      {!hideDefaultToggle && (
        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400 dark:border-slate-600 dark:bg-slate-800"
          />
          Varsayılan adresim yap
        </label>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={cancelBtn}>
          İptal
        </button>
        <button type="submit" disabled={pending} className={saveBtn}>
          {pending ? "Kaydediliyor…" : submitLabel}
        </button>
      </div>

      {showMap && (
        <AddressMapModal
          initialLat={lat}
          initialLng={lng}
          onCancel={() => setShowMap(false)}
          onConfirm={(la, ln, addr) => {
            setLat(la);
            setLng(ln);
            if (addr && !addressLine.trim()) setAddressLine(addr);
            setShowMap(false);
          }}
        />
      )}
    </form>
  );
}
