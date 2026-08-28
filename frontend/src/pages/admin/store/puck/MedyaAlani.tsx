/**
 * Puck özel alanı: MEDYA SEÇİCİ.
 *
 * Kullanıcının spike şikayetinin çözümü ("resim yolu istedi, koyamadım"):
 * çıplak URL kutusu yerine mevcut mağaza medya kütüphanesinden seçim + yeni
 * yükleme. Seçilen URL medya kökünden geldiği için backend'in
 * `_validate_image_url` beyaz listesini otomatik geçer.
 *
 * Alan hem tekil görselde (Banner) hem hero/kart array'lerinin içinde
 * kullanılır; değer PuckMedya nesnesidir (alt_text yüklemedekiyle başlar,
 * yerinde düzenlenebilir).
 */
import { useRef, useState } from "react";

import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { FieldLabel, type CustomField } from "@measured/puck";

import { Button } from "@/components/admin/ui";
import { Modal } from "@/components/ui/Modal";
import { useStoreMedia, useUploadStoreMedia } from "@/hooks/useStoreMerchandising";
import { getErrorDetail } from "@/lib/errors";
import { toast } from "@/store/toastStore";

import type { PuckMedya } from "./puckTipleri";

const ALAN_SINIFI =
  "w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[13px] text-slate-900 outline-none focus:border-slate-500";

function MedyaSeciciPencere({
  acik,
  onKapat,
  onSec,
}: {
  acik: boolean;
  onKapat: () => void;
  onSec: (url: string, altText: string) => void;
}) {
  const { data: medyalar = [], isLoading } = useStoreMedia();
  const upload = useUploadStoreMedia();
  const dosyaRef = useRef<HTMLInputElement>(null);
  const [altYazi, setAltYazi] = useState("");

  const yukle = async (file: File) => {
    try {
      const asset = await upload.mutateAsync({ image: file, altText: altYazi.trim() });
      onSec(asset.image_url, asset.alt_text);
      onKapat();
    } catch (e) {
      toast.error(getErrorDetail(e, "Görsel yüklenemedi."));
    }
  };

  return (
    <Modal open={acik} onClose={onKapat} title="Görsel seç" maxWidth="max-w-3xl">
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 pb-4">
        <div className="min-w-48 flex-1">
          <label htmlFor="puck-medya-alt" className="block text-xs font-semibold text-slate-500">
            Yeni görselin açıklaması (alt metin)
          </label>
          <input
            id="puck-medya-alt"
            className={`${ALAN_SINIFI} mt-1`}
            value={altYazi}
            onChange={(e) => setAltYazi(e.target.value)}
            placeholder="Örn. TYT kitap kampanyası görseli"
            maxLength={180}
          />
        </div>
        <Button
          variant="secondary"
          isPending={upload.isPending}
          onClick={() => dosyaRef.current?.click()}
        >
          Yeni yükle
        </Button>
        <input
          ref={dosyaRef}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Görsel dosyası seç"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void yukle(f);
            e.target.value = "";
          }}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-3 py-4 sm:grid-cols-4" aria-hidden>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : medyalar.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">
          Kütüphane boş — yukarıdan ilk görseli yükleyin.
        </p>
      ) : (
        <div className="grid max-h-[50vh] grid-cols-3 gap-3 overflow-y-auto py-4 sm:grid-cols-4">
          {medyalar.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                onSec(m.image_url, m.alt_text);
                onKapat();
              }}
              className="group overflow-hidden rounded-xl border border-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              <img
                src={m.image_url}
                alt={m.alt_text || "Medya görseli"}
                loading="lazy"
                className="aspect-square w-full object-cover transition group-hover:scale-[1.03]"
              />
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function MedyaDegeri({
  value,
  onChange,
}: {
  value: PuckMedya | null | undefined;
  onChange: (value: PuckMedya) => void;
}) {
  // Pencere durumu ekranda YAŞAMAZ (İP-A4): seçici bir düzenleme yüzeyidir.
  const yuzey = useDuzenlemeYuzeyi<void, void>();
  const medya = value ?? { image_url: "", alt_text: "", decorative: false };

  return (
    <div className="space-y-2">
      {medya.image_url ? (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <img src={medya.image_url} alt={medya.alt_text || ""} className="aspect-[16/7] w-full object-cover" />
        </div>
      ) : (
        <div className="flex aspect-[16/7] items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">
          Görsel seçilmedi
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => yuzey.yeniAc()}>
          {medya.image_url ? "Görseli değiştir" : "Görsel seç"}
        </Button>
      </div>
      <label className="block text-[11px] font-medium text-slate-500">
        Alt metin
        <input
          className={`${ALAN_SINIFI} mt-1`}
          value={medya.alt_text ?? ""}
          onChange={(e) =>
            onChange({ ...medya, alt_text: e.target.value, decorative: !e.target.value.trim() })
          }
          placeholder="Boş bırakılırsa dekoratif sayılır"
          maxLength={180}
        />
      </label>
      <MedyaSeciciPencere
        acik={yuzey.acik}
        onKapat={yuzey.kapat}
        onSec={(url, altText) =>
          onChange({
            ...medya,
            image_url: url,
            alt_text: medya.alt_text || altText,
            decorative: !(medya.alt_text || altText),
          })
        }
      />
    </div>
  );
}

/** Slayt/kart dizileri için KOMPAKT seçici — değer yalnız görsel URL'idir. */
function MedyaUrlDegeri({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (url: string) => void;
}) {
  const yuzey = useDuzenlemeYuzeyi<void, void>();
  return (
    <div className="flex items-center gap-2">
      {value ? (
        <img src={value} alt="" className="h-10 w-16 rounded-md border border-slate-200 object-cover" />
      ) : (
        <span className="flex h-10 w-16 items-center justify-center rounded-md border border-dashed border-slate-300 text-[10px] text-slate-400">
          yok
        </span>
      )}
      <Button size="sm" variant="secondary" onClick={() => yuzey.yeniAc()}>
        {value ? "Değiştir" : "Görsel seç"}
      </Button>
      <MedyaSeciciPencere
        acik={yuzey.acik}
        onKapat={yuzey.kapat}
        onSec={(url) => onChange(url)}
      />
    </div>
  );
}

/** Array içi alan fabrikası: `arrayFields: { image_url: medyaUrlAlani("Görsel") }`. */
export function medyaUrlAlani(etiket: string): CustomField<string> {
  return {
    type: "custom",
    label: etiket,
    render: ({ value, onChange }) => (
      <FieldLabel label={etiket}>
        <MedyaUrlDegeri value={value} onChange={onChange} />
      </FieldLabel>
    ),
  };
}

/** Puck alan fabrikası: `fields: { image: medyaAlani("Görsel") }`. */
export function medyaAlani(etiket: string): CustomField<PuckMedya | null> {
  return {
    type: "custom",
    label: etiket,
    render: ({ value, onChange }) => (
      <FieldLabel label={etiket}>
        <MedyaDegeri value={value} onChange={onChange} />
      </FieldLabel>
    ),
  };
}
