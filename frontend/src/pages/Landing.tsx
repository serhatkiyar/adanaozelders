import { Seo } from "@/components/Seo";
import { JsonLd } from "@/components/JsonLd";
import { SITE_NAME, siteUrl, absoluteUrl } from "@/lib/seo";
import { FeaturedTutorRow, TutorRow } from "@/components/VitrinSeridi";

/* ────────────────────────────────────────────────────────────────────────────
   ANA SAYFA — artık yalnız GÖVDE.

   Üst bar, kategori şeridi, arama hapı, tam ekran arama yüzeyi, footer ve alt
   sekme çubuğu `components/kesif/KesifKabugu.tsx`e taşındı (10 Eyl 2026).
   Sebep kullanıcı şikâyetiydi: *"kütüphaneler butonuna bastığımızda sayfa
   tamamen değişiyor; Airbnb'de kategori değişince sayfa yenilenmiyor."* Bu
   dosya kendi navbar kopyasını basarken `/` ile `/kutuphaneler` arasındaki her
   geçiş üst barı söküp yeniden kuruyordu — gerçek Chrome'la ölçüldü.

   `<Seo>` ve `JsonLd` BURADA KALIR, kabuğa taşınmaz: `Organization` ve
   `WebSite` düğümleri sitenin KÖK beyanıdır; kabuk onları basarsa
   `/kutuphaneler`de ikinci bir `WebSite` düğümü doğar. `aramaUrlTekKapi`
   nöbetçisi de bu dosyayı `SearchAction` şablonu için istisna listesinde
   tutuyor.
   ──────────────────────────────────────────────────────────────────────── */
export default function Landing() {
  return (
    <>
      <Seo
        canonicalPath="/"
        description="Adana'da TYT, AYT, LGS, KPSS ve daha fazlası için alanında uzman, onaylı öğretmenlerle online veya yüz yüze özel ders. Kütüphaneler ve denemeler tek yerde."
      >
        <JsonLd
          data={[
            {
              "@context": "https://schema.org",
              "@type": "Organization",
              name: SITE_NAME,
              url: siteUrl(),
              logo: absoluteUrl("/logo.png"),
            },
            {
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: SITE_NAME,
              url: siteUrl(),
              potentialAction: {
                "@type": "SearchAction",
                target: `${siteUrl()}/egitmenler?q={search_term_string}`,
                "query-input": "required name=search_term_string",
              },
            },
          ]}
        />
      </Seo>
    {/* Üst boşluk BURADA DEĞİL, kabukta (`icerikSiki`): `/kutuphaneler` ile
        aynı ritmi paylaşabilmek için tek yerden yönetiliyor. */}
    {/* Satır arası boşluk `/kutuphaneler` ile AYNI (`space-y-8`; 16 Eyl 2026: vitrinler çok yakındı): şeritler
        kendi dikey padding'ini zaten taşıyor, kap üstüne 32px daha eklerse
        iki yüzey ayrışır. Bugün burada tek şerit görünüyor (öne çıkarma
        paketi yoksa `FeaturedTutorRow` kendini gizler), yani fark gözle
        görünmüyordu — ama kural ayrışmıştı. */}
    <main className="space-y-8 pb-8 md:pb-24">
      {/* ── ÖĞRETMENLER: TEK kuşak ──────────────────────────────────────────
          Burada eskiden "TYT'ye hazırlık" / "YKS Hazırlık" / "AYT'ye
          hazırlık" / "Ortaokul Matematik" / "LGS Matematik" diye SABİT
          yazılmış kuşaklar vardı. İkisi gerçek bir daraltma yapıyordu
          (`subject` sert filtredir), üçü YAPMIYORDU: `exam` backend'de sert
          filtre değil, yalnız SIRALAMA BOOST'udur, üç kuşak da aynı öğretmen
          listesini gösteriyordu (ölçüm: 7 öğretmenin üçünde de aynısı).
          Kategori vaat edip kategori uygulamayan başlık, kullanıcıya "sahte
          veri" gibi görünür; şikâyetin sebebi buydu.

          Sadeleştirme: tek dürüst başlık. Kuşak boşsa `TutorRow` zaten
          kendini gizler. Kategori kırılımı, arz gerçekten kategori başına
          anlamlı sayıya ulaştığında ve VERİDEN türetilebildiğinde geri
          gelmelidir, sabit liste olarak değil.
          Nöbetçi: `__guards__/egitmenKusaklari.test.tsx`. */}
      {/* Ücretli öne çıkarma şeridi — öğretmen kuşağının ÜSTÜNDE ve ondan
          bağımsız bir uçtan gelir. Organik kuşağın sırasını değiştirmez;
          "Reklam" ibaresi yönetmelik gereği zorunludur ve blok yalnız
          yürürlükte bir paket varsa çizilir. Ana sayfa filtresiz olduğu için
          burada eşleşme daraltması yoktur, arama sayfasındaki blok ise
          aramanın filtrelerine tabidir. */}
      {/* TEK VİTRİN (9 Eyl 2026). Ana sayfa artık kategori sekmesine göre
          içerik değiştirmiyor: sekmeler gerçek gezinme oldu, kütüphane
          şeritleri `/kutuphaneler` sayfasına taşındı. Bayrak kontrolleri de
          onlarla birlikte gitti — `/kutuphaneler` rotası zaten bayrakla
          kapılı, ikinci kontrol ölü koddu. */}
      <FeaturedTutorRow />
      <TutorRow heading="Öğretmenler" params={{ limit: 12, offset: 0 }} />
    </main>
    </>
  );
}

/**
 * Vitrin kartının genişliği — konteynere BAĞLI, sabit piksel DEĞİL.
 *
 * Kartlar `w-[210px]` sabitken satırın sağ kenarı konteynerle hizalanmıyordu:
 * içerik genişliği 1216-48 = 1168px, beş kart ise 5x210 + 4x20 = 1130px
 * tutuyordu ve kalan 38px son kartı sağ kenardan içeride bırakıyordu. Kaydırma
 * okları konteynerin sağ ucunda durduğu için fark gözle görülür haldeydi.
 *
 * Konteyner ölçüsünü (`max-w-[1216px]`) küçültmek çözüm DEĞİL: aynı ölçü
 * `SiteFooter`da da kullanılıyor, yani hizasızlık sayfanın başka yerine kayardı.
 * Bunun yerine kart genişliği kalan alandan hesaplanıyor; boşluk `gap-5` (20px)
 * olduğundan çıkarılan değer (kart sayısı - 1) x 20.
 *
 * Kart sayısı ekran genişliğiyle artar ve her eşikte kart ~220px civarında
 * kalır; sabit piksel kullanılsaydı ya dar ekranda taşar ya geniş ekranda
 * boşluk bırakırdı.
 */

