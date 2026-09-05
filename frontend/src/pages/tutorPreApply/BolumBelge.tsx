import { useRef } from "react";

import { PlainButton } from "@/components/ui/PlainButton";
import { toast } from "@/store/toastStore";

import { CokSatir, Metin } from "@/components/form/alanlar";
import {
  BELGE_KABUL,
  MAX_BELGE,
  MAX_BELGE_BAYT,
  type FormDurumu,
} from "./tipler";

/**
 * 4. bölüm — eğitim ve belgeler.
 *
 * Belge en sona bırakıldı: dosya seçmek mobilde en yüksek sürtünmeli iştir,
 * formun başında istemek doldurmayı baştan kestirir.
 */
export function BolumBelge({
  degerler,
  guncelle,
}: {
  degerler: FormDurumu;
  guncelle: (yama: Partial<FormDurumu>) => void;
}) {
  const dosyaRef = useRef<HTMLInputElement>(null);

  const dosyalarSecildi = (e: React.ChangeEvent<HTMLInputElement>) => {
    const secilen = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!secilen.length) return;

    const kabul = [...degerler.belgeler];
    for (const dosya of secilen) {
      if (kabul.length >= MAX_BELGE) {
        toast.error(`En fazla ${MAX_BELGE} belge ekleyebilirsin.`);
        break;
      }
      if (dosya.size > MAX_BELGE_BAYT) {
        toast.error(`${dosya.name} çok büyük (en fazla 10 MB).`);
        continue;
      }
      const ayni = kabul.some((v) => v.name === dosya.name && v.size === dosya.size);
      if (ayni) continue;
      kabul.push(dosya);
    }
    guncelle({ belgeler: kabul });
  };

  return (
    <div className="space-y-5">
      <Metin
        ad="egitim"
        etiket="Eğitimin"
        ipucu="Okul ve bölüm. Örnek: Çukurova Üniversitesi, Matematik Öğretmenliği"
        deger={degerler.egitim}
        onChange={(v) => guncelle({ egitim: v })}
        maxLength={300}
      />

      <div>
        <p className="text-sm font-medium text-slate-700">
          Diploma veya sertifika{" "}
          <span className="font-normal text-slate-400">
            ({degerler.belgeler.length}/{MAX_BELGE})
          </span>
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Belgesi olan başvurular daha hızlı ilerliyor. PDF veya fotoğraf, dosya
          başına en fazla 10 MB.
        </p>

        {degerler.belgeler.length > 0 && (
          <ul className="mt-3 space-y-2">
            {degerler.belgeler.map((dosya, i) => (
              <li
                key={`${dosya.name}-${dosya.size}`}
                className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                  {dosya.name}
                </span>
                <PlainButton
                  onClick={() =>
                    guncelle({
                      belgeler: degerler.belgeler.filter((_, j) => j !== i),
                    })
                  }
                  aria-label={`${dosya.name} dosyasını kaldır`}
                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path d="M6.3 6.3a1 1 0 0 1 1.4 0L10 8.6l2.3-2.3a1 1 0 1 1 1.4 1.4L11.4 10l2.3 2.3a1 1 0 0 1-1.4 1.4L10 11.4l-2.3 2.3a1 1 0 0 1-1.4-1.4L8.6 10 6.3 7.7a1 1 0 0 1 0-1.4Z" />
                  </svg>
                </PlainButton>
              </li>
            ))}
          </ul>
        )}

        {degerler.belgeler.length < MAX_BELGE && (
          <PlainButton
            onClick={() => dosyaRef.current?.click()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-3.5 text-sm font-medium text-slate-600 transition hover:border-indigo-400 hover:text-indigo-700"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M10 4a1 1 0 0 1 1 1v4h4a1 1 0 1 1 0 2h-4v4a1 1 0 1 1-2 0v-4H5a1 1 0 1 1 0-2h4V5a1 1 0 0 1 1-1Z" />
            </svg>
            Belge ekle
          </PlainButton>
        )}
        <input
          ref={dosyaRef}
          type="file"
          multiple
          accept={BELGE_KABUL}
          className="sr-only"
          onChange={dosyalarSecildi}
          aria-label="Diploma veya sertifika ekle"
        />
      </div>

      <div>
        <CokSatir
          ad="not"
          etiket="Eklemek istediğin bir şey"
          deger={degerler.not}
          onChange={(v) => guncelle({ not: v })}
          satir={3}
          maxLength={2000}
        />
      </div>
    </div>
  );
}
