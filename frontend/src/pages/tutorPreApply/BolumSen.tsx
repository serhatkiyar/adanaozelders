import { CokSatir, Metin } from "./alanlar";
import type { Adim1Hatalar } from "./dogrula";
import type { FormDurumu } from "./tipler";

/**
 * 1. bölüm — başvurunun zorunlu çekirdeği.
 *
 * Formun geri kalanı isteğe bağlı olduğu için bu üç alan en üstte durur:
 * acelesi olan biri buraya kadar doldurup doğrudan gönderebilmeli.
 */
export function BolumSen({
  degerler,
  guncelle,
  hatalar,
}: {
  degerler: FormDurumu;
  guncelle: (yama: Partial<FormDurumu>) => void;
  hatalar: Adim1Hatalar;
}) {
  return (
    <div className="space-y-5">
      <Metin
        ad="ad"
        etiket="Ad Soyad"
        zorunlu
        deger={degerler.ad}
        onChange={(v) => guncelle({ ad: v })}
        hata={hatalar.ad}
        autoComplete="name"
        maxLength={100}
        duzeltmeKapali
      />

      <Metin
        ad="telefon"
        etiket="Cep telefonu"
        zorunlu
        ipucu="Yalnız aramak için kullanılır; ilanında görünmez."
        deger={degerler.telefon}
        onChange={(v) => guncelle({ telefon: v })}
        hata={hatalar.telefon}
        tip="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="05XX XXX XX XX"
        maxLength={20}
      />

      <CokSatir
        ad="dersler"
        etiket="Hangi dersleri veriyorsun?"
        zorunlu
        ipucu="Kendi cümlelerinle yaz, birden fazlaysa virgülle ayır. Örnek: Lise matematik, geometri, TYT hazırlık"
        deger={degerler.dersler}
        onChange={(v) => guncelle({ dersler: v })}
        hata={hatalar.dersler}
        satir={2}
        maxLength={600}
      />

      <Metin
        ad="eposta"
        etiket="E-posta"
        ipucu="Telefonla ulaşamazsak buradan yazarız."
        deger={degerler.eposta}
        onChange={(v) => guncelle({ eposta: v })}
        tip="email"
        inputMode="email"
        autoComplete="email"
        maxLength={255}
        duzeltmeKapali
      />
    </div>
  );
}
