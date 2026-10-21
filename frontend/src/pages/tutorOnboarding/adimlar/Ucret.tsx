import { Metin } from "@/components/form/alanlar";
import { useTutorPriceHistogram } from "@/hooks/useTutorSearch";

import { UCRET_EN_AZ, UCRET_EN_COK } from "../sozlesme";
import type { AdimProps } from "./ortak";

/** Medyan — ortalama yerine, birkaç uç fiyatın rakamı bozmaması için. */
function medyan(sayilar: number[]): number | null {
  if (!sayilar.length) return null;
  const s = [...sayilar].sort((a, b) => a - b);
  const orta = Math.floor(s.length / 2);
  return s.length % 2 ? s[orta] : Math.round((s[orta - 1] + s[orta]) / 2);
}

/**
 * Adım 5 — saatlik ücret ve ilk ders kararı.
 *
 * Aynı dersi veren eğitmenlerin fiyat medyanı gösterilir. Fiyat, yeni bir
 * eğitmenin en zorlandığı karar; hiçbir referans vermeden sormak ya çok düşük
 * (emeğini ucuzlatır) ya çok yüksek (hiç talep almaz) fiyata yol açıyor.
 *
 * Rakam ancak arkasında yeterli veri varsa gösterilir — iki eğitmenin
 * fiyatından "piyasa" üretmek yanıltıcı olurdu.
 */
const YETERLI_ORNEK = 4;

export function AdimUcret({ d, guncelle, odakla }: AdimProps) {
  const ders = d.subjects[0];
  const { data: fiyatlar } = useTutorPriceHistogram(
    { subject: ders ? [ders] : undefined },
    !!ders,
  );

  const ortanca =
    fiyatlar && fiyatlar.length >= YETERLI_ORNEK ? medyan(fiyatlar) : null;

  return (
    <div className="space-y-7">
      <Metin
        dolgu
        ad="ucret"
        etiket="Saatlik ücret (₺)"
        ipucu={
          ortanca != null
            ? `${ders} veren öğretmenlerin ortanca ücreti ${ortanca} ₺. ${UCRET_EN_AZ}–${UCRET_EN_COK} ₺ aralığında bir değer yaz.`
            : `${UCRET_EN_AZ}–${UCRET_EN_COK} ₺ aralığında bir değer yaz.`
        }
        tip="text"
        inputMode="decimal"
        deger={d.hourlyRate}
        onChange={(v) => guncelle({ hourlyRate: v.replace(/[^\d.,]/g, "") })}
        maxLength={7}
        odakla={odakla}
        placeholder="400"
        duzeltmeKapali
      />


    </div>
  );
}
