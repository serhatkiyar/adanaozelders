import { PlainButton } from "@/components/ui/PlainButton";
import { TeachingMode } from "@/types";

import { ADIMLAR, eksikler } from "../sozlesme";
import type { AdimProps } from "./ortak";

const SEKIL_ADI: Record<TeachingMode, string> = {
  [TeachingMode.ONLINE]: "Uzaktan",
  [TeachingMode.IN_PERSON]: "Yüz yüze",
  [TeachingMode.BOTH]: "Uzaktan ve yüz yüze",
};

function Satir({
  etiket,
  deger,
  adim,
  gitAdim,
}: {
  etiket: string;
  deger: string;
  adim: number;
  gitAdim: (n: number) => void;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-slate-100 py-3.5">
      <div className="min-w-0">
        <span className="block text-[13px] text-slate-400">{etiket}</span>
        <span className="mt-0.5 block truncate text-[15px] text-slate-800">
          {deger || "—"}
        </span>
      </div>
      <PlainButton
        onClick={() => gitAdim(adim)}
        className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg px-2 text-[13px] font-medium text-indigo-600 underline underline-offset-4 transition hover:text-indigo-700"
      >
        Düzenle
      </PlainButton>
    </div>
  );
}

/**
 * Adım 10 — son gözden geçirme.
 *
 * Eksik kalan zorunlu maddeler, sunucuya gitmeden ÖNCE burada listelenir ve
 * her biri kendi adımına bağlanır. Sunucu yine tek otorite; bu ekran yalnız
 * "hangi adıma dönmem gerekiyor" sorusunu yanıtlıyor — eskiden bu cevap 422
 * gövdesinden okunmak zorundaydı.
 */
export function AdimOzet({ d, dis, gitAdim }: AdimProps) {
  const eksik = eksikler(d, dis);

  return (
    <div className="space-y-8">
      {eksik.length > 0 && (
        <div className="rounded-2xl bg-amber-50 p-5">
          <p className="text-[14px] font-medium text-amber-900">
            Yayına göndermeden önce tamamlanması gerekenler
          </p>
          <ul className="mt-3 space-y-2">
            {eksik.map((e) => (
              <li key={e.adim} className="flex items-start justify-between gap-4">
                {/*
                  Adım ADI mesajın üstünde durur. İki farklı adım aynı kuralı
                  paylaşabiliyor ("en az 25 sözcük") ve mesajlar birebir aynı
                  çıkıyordu; kullanıcı hangisinin eksik olduğunu ayırt
                  edemiyordu.
                */}
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold uppercase tracking-wide text-amber-700">
                    {ADIMLAR[e.adim].kisaAd}
                  </span>
                  <span className="mt-0.5 block text-[14px] leading-relaxed text-amber-800">
                    {e.mesaj}
                  </span>
                </span>
                <PlainButton
                  onClick={() => gitAdim(e.adim)}
                  className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg px-2 text-[13px] font-medium text-amber-900 underline underline-offset-4"
                >
                  {ADIMLAR[e.adim].anahtar === "belgeler" ? "Belge ekle" : "Düzelt"}
                </PlainButton>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <Satir
          etiket="Dersler"
          deger={d.subjects.join(", ")}
          adim={0}
          gitAdim={gitAdim}
        />
        <Satir etiket="Başlık" deger={d.headline} adim={1} gitAdim={gitAdim} />
        <Satir
          etiket="Ders şekli"
          deger={
            d.teachingMode
              ? [SEKIL_ADI[d.teachingMode], d.district].filter(Boolean).join(" · ")
              : ""
          }
          adim={4}
          gitAdim={gitAdim}
        />
        <Satir
          etiket="Saatlik ücret"
          deger={
            d.hourlyRate
              ? `${d.hourlyRate} ₺${d.firstLessonFree ? " · ilk ders ücretsiz" : ""}`
              : ""
          }
          adim={5}
          gitAdim={gitAdim}
        />
        <Satir
          etiket="Müsaitlik"
          deger={
            d.availability.length
              ? `${d.availability.length} zaman aralığı`
              : "Belirtilmedi"
          }
          adim={6}
          gitAdim={gitAdim}
        />
        <Satir
          etiket="Fotoğraf"
          deger={dis.avatarUrl ? "Eklendi" : "Eklenmedi"}
          adim={7}
          gitAdim={gitAdim}
        />
        <Satir
          etiket="Telefon"
          deger={dis.telefonDogrulandi ? "Doğrulandı" : "Doğrulanmadı"}
          adim={9}
          gitAdim={gitAdim}
        />
      </div>

      <p className="text-[13px] leading-relaxed text-slate-500">
        Yayına gönderdiğinde ilanın yönetici incelemesine düşer. İnceleme
        sürerken ilanı düzenleyemezsin; onaylandığında haber vereceğiz.
      </p>
    </div>
  );
}
