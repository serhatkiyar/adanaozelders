import { Link } from "react-router-dom";

import { useGirisAdresi } from "@/hooks/useGirisKapisi";

import { PublicShell } from "@/components/PublicShell";
import { Seo } from "@/components/Seo";

/**
 * `/favoriler` — oturumsuz hâl (kullanıcı kararı, 9 Eyl 2026).
 *
 * ## Neden yönlendirme değil, sayfa
 *
 * Alt sekme çubuğundaki "Favoriler" anonim kullanıcıya da görünür ve
 * görünmeye devam etmeli: favori düğmesi zaten oturumsuz ziyaretçiye
 * gösteriliyor (`__guards__/favoriRolKapisi.test.tsx`), yani "burada senin
 * için bir yer var" sözü sitenin geri kalanında zaten verilmiş durumda.
 *
 * Ama sekmeye dokunan anonim kullanıcı `ProtectedRoute` yüzünden doğrudan
 * `/giris` ekranına atılıyordu: dokunduğu sekme kayboluyor, nerede olduğunu
 * anlatan hiçbir şey kalmıyordu. Referans (Airbnb) bunu sayfanın KENDİSİNDE
 * çözer — başlık yerinde durur, altında neden boş olduğu ve tek bir giriş
 * eylemi bulunur.
 *
 * ROL KAPISI KALKMADI: `ProtectedRoute` hâlâ `ALISVERIS_ROLLERI`ni bekler,
 * yalnız TOKENSIZ durumda yönlendirmek yerine bu sayfayı çizer. Yani admin,
 * operatör ve kurye eskisi gibi kendi ana sayfasına yönlendirilir.
 */
export default function FavorilerGirisDaveti() {
  // Tek kapı (bkz. `lib/girisAdresi`): elle yazılan `?modal=login` mevcut
  // sorguyu değiştirirdi.
  const girisAdresiDegeri = useGirisAdresi();
  return (
    // `mobilSade`: telefonda üst bar boşalır ve gezinme alt sekme çubuğuna
    // kalır (referans ekranın kendisi de böyle). Aynı zamanda 390px'te logo
    // ile "Ders Ver" düğmesi arasındaki 42px'lik çakışmayı bu sayfada da
    // kapatır.
    // `altBilgiGizli`: kısa bir boş durumun hemen dibinde footer, sayfanın tek
    // mesajıyla (oturum aç) yarışıyor ve referans ekranda da yok. Yasal
    // bağlantılar kaybolmaz — giriş sonrası her sayfada footer duruyor.
    <PublicShell mobilSade altBilgiGizli>
      <Seo
        canonicalPath="/favoriler"
        title="Favoriler"
        description="Beğendiğin eğitmenleri ve kütüphaneleri favorilerine ekle, tek yerden takip et."
      />
      {/* Kart YOK (tasarım dili §3.2): boş bir durumu kutuya almak, olmayan
          bir içeriğe çerçeve çizmektir. Boşluk ve tipografi yeterli. */}
      <div className="mx-auto w-full max-w-[560px] px-1 pb-10 pt-8 sm:pt-14">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
          Favoriler
        </h1>
        <h2 className="mt-8 text-xl font-bold leading-snug text-slate-900 sm:mt-10 sm:text-2xl">
          Favori listelerinizi görmek için oturum açın
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-slate-500">
          Oturum açtıktan sonra beğendiğiniz eğitmenleri ve kütüphaneleri
          favorilerinize ekleyebilir, listelerinizi buradan görüntüleyebilirsiniz.
        </p>
        <Link
          to={girisAdresiDegeri}
          className="mt-7 inline-flex min-h-[48px] items-center justify-center rounded-xl bg-gradient-to-r from-marka to-marka-hover px-7 text-[15px] font-semibold text-marka-fg transition hover:from-marka-hover hover:to-marka-hover active:scale-95"
        >
          Giriş Yap
        </Link>
      </div>
    </PublicShell>
  );
}
