import { useState } from "react";

import { Liste, Metin, SegmentSecim } from "@/components/form/alanlar";
import { PlainButton } from "@/components/ui/PlainButton";
import { MapPicker } from "@/components/MapPicker";
import { ADANA_DISTRICTS } from "@/lib/districts";
import { TeachingMode } from "@/types";

import { SECILI_SEGMENT } from "../tema";

import type { AdimProps } from "./ortak";

const SEKILLER = [
  { deger: TeachingMode.ONLINE, etiket: "Uzaktan" },
  { deger: TeachingMode.IN_PERSON, etiket: "Yüz yüze" },
  { deger: TeachingMode.BOTH, etiket: "İkisi de" },
] as const;

/**
 * Adım 4 — ders şekli, ilçe ve (isteğe bağlı) harita işareti.
 *
 * Harita varsayılan olarak KAPALI geliyor. Leaflet ağır bir yük ve eğitmenlerin
 * çoğu ilçe seçmekle yetiniyor; haritayı isteyene açtırmak adımı hafifletiyor.
 */
export function AdimYer({ d, guncelle }: AdimProps) {
  const [haritaAcik, setHaritaAcik] = useState(d.locationLat != null);
  const uzaktanSadece = d.teachingMode === TeachingMode.ONLINE;

  return (
    <div className="space-y-7">
      <div data-alan="dersSekli">
        <SegmentSecim
        aktifSinif={SECILI_SEGMENT}
          etiket="Ders şekli"
          deger={d.teachingMode}
          onChange={(v) => guncelle({ teachingMode: v as TeachingMode | "" })}
          secenekler={SEKILLER}
        />
      </div>

      {!uzaktanSadece && (
        <>
          <Liste
            dolgu
            ad="ilce"
            etiket="İlçen"
            ipucu="Öğrenciler aramada ilçeye göre eğitmen süzüyor."
            deger={d.district}
            onChange={(v) => guncelle({ district: v })}
            secenekler={ADANA_DISTRICTS.map((i) => ({ deger: i, etiket: i }))}
            bosEtiket="İlçe seç"
          />

          <Metin
            dolgu
            ad="konum"
            etiket="Semt veya mahalle"
            ipucu="İsteğe bağlı. Açık adres yazma — bu satır ilanında görünür."
            deger={d.locationText}
            onChange={(v) => guncelle({ locationText: v })}
            maxLength={255}
            placeholder="Örnek: Çukurova, Toros Mahallesi"
          />

          <div>
            {haritaAcik ? (
              <>
                <MapPicker
                  initialLat={d.locationLat}
                  initialLng={d.locationLng}
                  onLocationSelect={(lat, lng) =>
                    guncelle({ locationLat: lat, locationLng: lng })
                  }
                />
                <p className="mt-2 text-[13px] text-slate-500">
                  {d.locationLat != null
                    ? "İşaret kaydedildi. Yakınındaki öğrenciler seni bulabilir; işaretin ilanında görünmez."
                    : "Haritaya dokunarak yaklaşık konumunu işaretle."}
                </p>
              </>
            ) : (
              <PlainButton
                onClick={() => setHaritaAcik(true)}
                className="text-[14px] font-medium text-indigo-600 underline underline-offset-4 transition hover:text-indigo-700"
              >
                Haritada işaretle (isteğe bağlı)
              </PlainButton>
            )}
          </div>
        </>
      )}
    </div>
  );
}
