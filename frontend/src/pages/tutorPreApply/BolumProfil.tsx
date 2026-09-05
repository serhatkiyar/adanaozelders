import { useRef } from "react";

import { PlainButton } from "@/components/ui/PlainButton";
import { toast } from "@/store/toastStore";

import { CokSatir, Metin, SegmentSecim } from "@/components/form/alanlar";
import { DENEYIM_SECENEKLERI, MAX_FOTO_BAYT, type FormDurumu } from "./tipler";

/**
 * 2. bölüm — fotoğraf ve tanıtım.
 *
 * Fotoğraf ayrı bir istekle DEĞİL, formun kendisiyle birlikte gider: anonim
 * bir yükleme ucu, gönderilmeyen formlardan sahipsiz dosya biriktirirdi.
 * Kırpma penceresi ortak `ImageCropModal` — kabuk tarafından açılır.
 */
export function BolumProfil({
  degerler,
  guncelle,
  onFotoSec,
}: {
  degerler: FormDurumu;
  guncelle: (yama: Partial<FormDurumu>) => void;
  onFotoSec: (dosya: File) => void;
}) {
  const dosyaRef = useRef<HTMLInputElement>(null);

  const dosyaSecildi = (e: React.ChangeEvent<HTMLInputElement>) => {
    const dosya = e.target.files?.[0];
    e.target.value = ""; // aynı dosya tekrar seçilebilsin
    if (!dosya) return;
    if (!dosya.type.startsWith("image/")) {
      toast.error("Lütfen bir fotoğraf seç (JPG, PNG veya WEBP).");
      return;
    }
    if (dosya.size > MAX_FOTO_BAYT) {
      toast.error("Fotoğraf 5 MB'dan küçük olmalı.");
      return;
    }
    onFotoSec(dosya);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        {degerler.fotoOnizleme ? (
          <img
            src={degerler.fotoOnizleme}
            alt="Seçtiğin profil fotoğrafı"
            className="h-20 w-20 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-300"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-9 w-9">
              <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5Z" />
            </svg>
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-700">Profil fotoğrafı</p>
          <p className="mt-1 text-xs text-slate-500">
            Yüzün net göründüğü, tek kişilik bir fotoğraf işe yarar.
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <PlainButton
              onClick={() => dosyaRef.current?.click()}
              className="text-sm font-medium text-indigo-700 hover:text-indigo-900"
            >
              {degerler.fotoOnizleme ? "Değiştir" : "Fotoğraf ekle"}
            </PlainButton>
            {degerler.fotoOnizleme && (
              <PlainButton
                onClick={() => guncelle({ foto: null, fotoOnizleme: null })}
                className="text-sm text-slate-500 hover:text-slate-800"
              >
                Kaldır
              </PlainButton>
            )}
          </div>
        </div>
        <input
          ref={dosyaRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={dosyaSecildi}
          aria-label="Profil fotoğrafı seç"
        />
      </div>

      <div className="space-y-5">
        <Metin
          ad="baslik"
          etiket="Tek cümleyle kendini tanıt"
          ipucu="İlanının başlığı olur. Örnek: 10 yıllık matematik öğretmeni, TYT-AYT hazırlık"
          deger={degerler.baslik}
          onChange={(v) => guncelle({ baslik: v })}
          maxLength={255}
        />

        <CokSatir
          ad="tanitim"
          etiket="Kendini anlat"
          ipucu="Nasıl ders işlediğini, kimlerle çalıştığını yazabilirsin."
          deger={degerler.tanitim}
          onChange={(v) => guncelle({ tanitim: v })}
          satir={5}
          maxLength={2000}
        />

        <SegmentSecim
          etiket="Ders verme deneyimin"
          deger={degerler.deneyim}
          onChange={(v) => guncelle({ deneyim: v })}
          secenekler={DENEYIM_SECENEKLERI}
        />
      </div>
    </div>
  );
}
