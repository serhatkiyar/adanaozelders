import { CokSatir, Liste, Metin, SegmentSecim } from "@/components/form/alanlar";
import { dogrulaUcret, dogrulaVideo } from "./dogrula";
import { BICIM_SECENEKLERI, ILCELER, type FormDurumu } from "./tipler";

/**
 * 3. bölüm — dersin nasıl işlediği.
 *
 * Ücret ve ders biçimi ilanın en çok bakılan iki bilgisi; ikisi de isteğe
 * bağlıdır çünkü aday bu aşamada henüz fiyat kararını vermemiş olabilir ve
 * zorunlu tutmak formu terk ettirir.
 */
export function BolumDers({
  degerler,
  guncelle,
}: {
  degerler: FormDurumu;
  guncelle: (yama: Partial<FormDurumu>) => void;
}) {
  return (
    <div className="space-y-6">
      <SegmentSecim
        etiket="Dersi nasıl veriyorsun?"
        deger={degerler.bicim}
        onChange={(v) => guncelle({ bicim: v })}
        secenekler={BICIM_SECENEKLERI}
      />

      <div className="space-y-5">
        <Liste
          ad="ilce"
          etiket="Hangi ilçedesin?"
          deger={degerler.ilce}
          onChange={(v) => guncelle({ ilce: v })}
          secenekler={ILCELER}
          bosEtiket="Seçmedim"
        />

        <Metin
          ad="ucret"
          etiket="Saatlik ücretin (₺)"
          ipucu="Sonradan değiştirebilirsin."
          deger={degerler.ucret}
          onChange={(v) => guncelle({ ucret: v })}
          hata={dogrulaUcret(degerler.ucret)}
          inputMode="decimal"
          maxLength={10}
          placeholder="Örn. 500"
        />

        <CokSatir
          ad="musaitlik"
          etiket="Ne zaman müsaitsin?"
          ipucu="Serbest yaz. Örnek: Hafta içi 18:00 sonrası, cumartesi tam gün"
          deger={degerler.musaitlik}
          onChange={(v) => guncelle({ musaitlik: v })}
          satir={2}
          maxLength={300}
        />

        <Metin
          ad="video"
          etiket="Tanıtım videosu"
          ipucu="Varsa YouTube veya Vimeo bağlantısı."
          deger={degerler.video}
          onChange={(v) => guncelle({ video: v })}
          hata={dogrulaVideo(degerler.video)}
          tip="url"
          inputMode="url"
          maxLength={500}
          placeholder="https://youtu.be/..."
          duzeltmeKapali
        />
      </div>
    </div>
  );
}
