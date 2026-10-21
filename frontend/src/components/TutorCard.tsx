import { Link } from "react-router-dom";
import type { TutorSearchOut } from "@/types";
import { BookmarkButton } from "@/components/BookmarkButton";
import { StarRating } from "@/components/StarRating";
import { parseMoney, formatRateSymbol } from "@/lib/money";
import { ilanYolu } from "@/lib/routes";

interface TutorCardProps {
  tutor: TutorSearchOut;
  showBookmark?: boolean;
  /**
   * Ücretli öne çıkarma kartı. Etiket zorunludur ve metni "Reklam"dır —
   * Ticari Reklam ve Haksız Ticari Uygulamalar Yönetmeliği ücretli
   * yerleşimin ayırt edilebilir olmasını şart koşar. "Sponsorlu" ya da
   * "Öne çıkan" bu yükümlülüğü tek başına karşılamaz.
   */
  featured?: boolean;
}

export function TutorCard({
  tutor,
  showBookmark = true,
  featured = false,
}: TutorCardProps) {
  const hasRatings = tutor.rating_count > 0;
  const rate = parseMoney(tutor.hourly_rate);
  
  // NASIL + NEREDE tekrar TEK satırda, fotoğrafın üstünde (kullanıcı kararı,
  // 20 Eyl 2026 — 11 Eyl 2026'daki ayrımı BİLEREK geri alıyor). 11 Eylül'de
  // ikisi birleşince 157px'lik telefon kartında kesildiği ÖLÇÜLMÜŞTÜ; o risk
  // hâlâ geçerli ama `truncate` (aşağıda) satırı tek satırda tutup taşanı
  // "…" ile kesiyor — kart genişliği zaten büyümüştü, ölçüm o zamanki dar
  // karta aitti. İlçe yoksa yalnız ders şekli yazılır, parantez açılmaz.
  //
  // Cinsiyet listede YAZILMAZ (kullanıcı kararı, 7 Eyl 2026). Bir süre bu
  // satırın parçasıydı; kartta demografik bir öznitelik taşımanın karşılığı
  // yok. Arama tarafı DEĞİŞMEDİ: cinsiyet filtresi ve faset sayıları yerinde,
  // değer eğitmen profilinde (`PublicTutorProfile`) görünmeye devam ediyor.
  const sekilMetni =
    tutor.teaching_mode === "ONLINE"
      ? "Uzaktan"
      : tutor.teaching_mode === "IN_PERSON"
        ? "Yüz yüze"
        : "Yüz yüze & Uzaktan";
  // İlçeyle birleşince parantez içinde küçük harfle yazılır ("Çukurova
  // (yüz yüze & uzaktan)"); ilçe yoksa tek başına eski (büyük harfli) hali
  // görünür — `tutorCardCinsiyet.test.tsx` tam bu metni (`"Uzaktan"`) çıpalıyor.
  // "Yüz yüze" iki kelime: arama seçicileriyle (`AramaSecicileri.tsx`) aynı yazım.
  const sekilMetniKucuk =
    tutor.teaching_mode === "ONLINE"
      ? "uzaktan"
      : tutor.teaching_mode === "IN_PERSON"
        ? "yüz yüze"
        : "yüz yüze & uzaktan";
  const konumSatiri = tutor.district
    ? `${tutor.district} (${sekilMetniKucuk})`
    : sekilMetni;

  // Mesafe artık fiyat satırının sonunda, ayrı bir madde olarak gösteriliyor
  // (kullanıcı kararı, 20 Eyl 2026) — ilçe adı yukarıda, fotoğraf üstünde
  // ders şekliyle birlikte olduğu için burada yalnız "yakınımda" bilgisi var.
  const mesafeMetni =
    tutor.distance_km != null ? `~${tutor.distance_km} km` : "";

  const mainSubject = tutor.subjects?.[0] || "Özel Ders";
  // Ad SUNUCUDAN kesilmiş geliyor (ÜK-9). Burada `split(" ")[0]` yapılıyordu ve
  // o kozmetikti: soyad ağ yanıtında, `alt` metninde ve avatar URL'inde
  // duruyordu — aşağıdaki iki satır tam olarak bu yüzden değişti.
  const gorunenAd = tutor.display_name;

  return (
    <Link
      to={ilanYolu(tutor)}
      // Genişlik ızgaranındır: kart hücresini doldurur (`KART_IZGARASI`,
      // kullanıcı kararı 24 Eyl 2026). Eski `mx-auto max-w-[310px]` geniş
      // hücrede kartı ortada yüzdürüp sayaç/başlıkla hizasız bırakıyordu.
      className="group flex h-full w-full flex-col transition duration-300 outline-none"
    >
      {/* ── Picture Area ── */}
      {/* Odak halkası fotoğrafın yuvarlak kutusunda: bütün Link'e çizilse
          altındaki metni de 24px köşeyle sarıp kartı kutuya çevirirdi. Halka
          İÇE çizilir: vitrin şeridinin (`HScroll`) yatay taşma kırpması dışa
          taşan halkanın ilk kartta sol ve üst kenarını kesiyordu. Halka ayrı
          bir `after:` katmanında (z-20), çünkü kutunun kendi outline'ı/içe
          ring'i konumlu scrim'in ALTINDA boyanıp alt kenarda kararıyordu. */}
      <div className="relative aspect-square w-full overflow-hidden rounded-3xl bg-slate-100 after:pointer-events-none after:absolute after:inset-0 after:z-20 after:rounded-3xl group-focus-visible:after:ring-[3px] group-focus-visible:after:ring-inset group-focus-visible:after:ring-marka-focus">
        {/* Avatarı olmayan öğretmenin adı ARTIK DIŞARI GİTMİYOR. Burada
            ui-avatars.com'a `name=<Ad Soyad>` query parametresiyle istek
            atılıyordu; yani her kart render'ında tam ad üçüncü tarafa
            veriliyordu. Ortak `Avatar` bileşeni baş harfi YERELDE üretiyor. */}
        {/* `alt` boş: ad hemen altında metin olarak yazılı; dolu `alt` link
            adını ekran okuyucuda "Berivan Berivan …" diye ikiletiyordu. */}
        {tutor.avatar_url ? (
          <img
            src={tutor.avatar_url}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div aria-hidden="true" className="flex h-full w-full items-center justify-center bg-marka-soft text-4xl font-semibold text-marka-metin">
            {gorunenAd.charAt(0).toLocaleUpperCase("tr")}
          </div>
        )}
        
        {/* Reklam etiketi — yasal zorunluluk, karttan ayrılamaz */}
        {featured && (
          <span className="absolute left-4 top-4 z-10 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-slate-700 shadow-sm">
            Reklam
          </span>
        )}

        {/* Bookmark top right */}
        {/* `md:` öncesi 8px içeri: düğmenin dokunma alanı telefonda `p-2` ile
            büyüdü, ikon görsel olarak aynı yerde kalsın. */}
        {showBookmark && (
          <div className="absolute right-1 top-1 z-10 md:right-3 md:top-3">
            <BookmarkButton tutorId={tutor.id} size="md" />
          </div>
        )}

        {/* Gradient Mask at bottom */}
        <div className="absolute inset-x-0 bottom-0 h-[65%] bg-gradient-to-t from-black/85 via-black/35 to-transparent opacity-90 transition-opacity duration-300 group-hover:opacity-100" />
        
        {/* Text Container over image */}
        <div className="absolute bottom-4 left-4 right-4 flex flex-col">
          {/* base boyut: uzun ön adlar (Abdurrezzak vb.) xl'de kartı kaplıyordu;
              kütüphane kartıyla da aynı boyut. */}
          <p className="line-clamp-1 text-base font-bold leading-snug text-white drop-shadow-md">
            {gorunenAd}
          </p>
          <div className="mt-0.5 flex items-center text-xs font-semibold text-white/90 drop-shadow-md">
            <span className="truncate">{konumSatiri}</span>
          </div>
        </div>
      </div>

      {/* ── Bottom Part ── */}
      <div className="flex flex-1 flex-col pt-3 pb-1 px-1">
        {/* Badges: Rating & Status */}
        <ul className="flex items-center gap-2 text-xs font-medium text-slate-700 ">
          <li className="flex shrink-0 items-center gap-1">
            {/* Puansız öğretmende yıldız yalnız süs; "0 / 5" okunmasın — anlamı
                yanındaki "Yeni" metni taşıyor. */}
            <span className="flex" aria-hidden={hasRatings ? undefined : true}>
              <StarRating value={tutor.rating_average ?? 0} single={true} />
            </span>
            <span className="font-semibold text-slate-900 text-xs">
              {hasRatings ? (tutor.rating_average ?? 0).toFixed(1) : "Yeni"}
            </span>
            {hasRatings && (
              <span className="text-slate-500 ">
                ({tutor.rating_count} yorum)
              </span>
            )}
          </li>
        </ul>
        
        {/* İlan başlığı 14px'ten 13px'e indi (kullanıcı kararı, 11 Eyl 2026):
            iki satırlık blok kartın alt yarısını tek başına dolduruyordu.
            `min-h` de birlikte iner — iki satırın yeri boş kalsa bile ayrılır,
            yoksa başlığı kısa olan kartın fiyat satırı yukarı kayıp ızgarayı
            tırtıklı gösterir. */}
        <h3 className="mt-1 line-clamp-2 min-h-[36px] text-[13px] leading-snug text-slate-800 ">
          {tutor.headline || tutor.bio || `${mainSubject} alanında uzman öğretmen ile derslere hemen başlayın.`}
        </h3>

        {/* Pricing */}
        {/* `flex-wrap`: 165px'lik mobil kartta dört haneli ücret ile "İlk ders
            ücretsiz" rozeti yan yana sığmıyor, sarmadan taşıyordu. */}
        {/* `mt-auto` YOK (kullanıcı, 16 Eyl 2026: "ücret çok aşağıda kalmış"):
            kart komşularıyla aynı boya uzayınca ücret dibe iniyor, başlıkla
            arasında boşluk açılıyordu. Ücret başlığın hemen altında durur;
            hizayı başlığın `min-h`i zaten sağlıyor. Aralık `mt-2`den `mt-0`a
            indi (kullanıcı kararı, 20 Eyl 2026 — "bitişik" istendi). */}
        {/* Ayırıcı her maddenin BAŞINDA ve 16px'lik sabit kutuda; iç satır
            `-ml-4` ile sola kayar, dış kap `overflow-hidden` ile keser. Madde
            alt satıra sarınca ayırıcısı satır başına düşer ve kırpılır —
            157px'lik 2 sütunlu telefon kartında (ders sayfası) "·" eskiden
            ilk satırın sonunda yetim kalıyordu. */}
        <div className="mt-0 overflow-hidden text-slate-800">
        <div className="-ml-4 flex flex-wrap items-center gap-y-0.5">
          {/* "/saat" eki GERİ EKLENDİ (kullanıcı kararı, 20 Eyl 2026 — 16 Eyl
              2026'daki sadelik kararını BİLEREK geri alıyor). Tutar ve "/saat"
              AYRI `<span>` ama TEK sarmalayıcı içinde: dış konteynerin
              boşluğu araya girip "600 TL   /saat" gibi kopuk bir boşluk
              bırakıyordu (kullanıcı: "düzgün kontrol et"), ikisi birbirine
              bitişik tek birim olarak akmalı. */}
          <span className="flex items-baseline pl-4">
            {/* Kart ₺rakam biçimini kullanır (kullanıcı kararı, 21 Eyl 2026);
                aynı biçim öğretmen profili kartında da geçerli —
                `formatRate` yalnız yönetim listesinde "TL" sonekiyle kalır. */}
            <span className="text-sm font-bold">
              {rate !== null ? formatRateSymbol(rate) : "Ücret belirtilmemiş"}
            </span>
            {rate !== null && (
              <span className="text-[11px] font-normal">/saat</span>
            )}
          </span>
          {/* İlk ders ücretsiz etiketi — yalnız öğretmen sunuyorsa */}
          {false && (
            <span className="flex items-center whitespace-nowrap">
              <span aria-hidden="true" className="w-4 text-center text-base leading-none text-emerald-600">·</span>
              <span className="text-xs font-semibold text-emerald-600">
                İlk ders ücretsiz
              </span>
            </span>
          )}
          {/* Mesafe — yalnız "yakınımda" aramasında dolu gelir. */}
          {mesafeMetni && (
            <span className="flex items-center whitespace-nowrap">
              <span aria-hidden="true" className="w-4 text-center text-base leading-none text-slate-300">·</span>
              <span className="text-xs font-medium text-slate-500">
                {mesafeMetni}
              </span>
            </span>
          )}
        </div>
        </div>
      </div>
    </Link>
  );
}

