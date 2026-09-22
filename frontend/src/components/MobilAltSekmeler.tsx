import { Link, NavLink } from "react-router-dom";

import { Icon, type IconName } from "@/components/AppIcon";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useGirisAdresi } from "@/hooks/useGirisKapisi";
import { useMessagesUnreadCount } from "@/hooks/useMessages";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { ROLE_IDS } from "@/types";

/**
 * Telefonda ekranın altına sabitlenen sekme çubuğu (kullanıcı kararı, 9 Eyl 2026).
 *
 * ## Neden var
 *
 * Mobilde gezinmenin tamamı üst bardaydı: logo + "Ders Ver" + "Giriş Yap"
 * 390px'e sığmıyordu (ölçüldü: logo sağ kenarı 245px, "Ders Ver" sol kenarı
 * 203px → 42px çakışma) ve üst bar ekranın %27'sini yiyordu. Referans olarak
 * Airbnb'nin mobil webi alındı: orada üst barda ne logo ne giriş vardır —
 * yalnız arama; kimlik ve kişisel yüzeyler alt çubuktadır.
 *
 * ## Panel rolleri de görür (kullanıcı kararı, 9 Eyl 2026)
 *
 * İlk sürümde ADMIN / LIBRARY_OPERATOR / COURIER için çubuk HİÇ çizilmiyordu;
 * gerekçe `docs/tasarim-dili.md` §4.3'ün alt çubuk yasağıydı. İKİ HATA vardı:
 *
 *   1. O yasak YÜZEYE göre yazılmış (yönetim kabuğu), ben ROLE göre
 *      uygulamıştım. Admin ana sayfayı gezerken de çubuğu kaybediyordu — orası
 *      panel değil, herkesin gezdiği public yüzey.
 *   2. Sonuç ÇIKMAZ SOKAKtı ve üretimde yaşandı: ana sayfada `mobilSade` üst
 *      bardan logoyu ve giriş/hesap düğmelerini kaldırır, çubuk da çizilmezse
 *      telefonda HİÇBİR gezinme kalmaz. Kullanıcı bunu canlıda buldu.
 *
 * Kullanıcı kararı: çubuk her rolde ve her yerde görünür. Panel rolleri için
 * sekmeler kendi işlerine göre daraltılır (favori/mesaj onlarda yok; sunucu
 * zaten 403 döner).
 *
 * ## Neden `DashboardHeader`ın içinde değil
 *
 * `__guards__/ustBarSadeligi.test.tsx` üst barın hesap menüsünün bir kopyası
 * olmamasını, orada EN FAZLA TEK kısayol bulunmasını sabitler. Çubuk üst barın
 * içine konsaydı o iddia sessizce çürürdü. Ayrı bir bileşen olması bilinçlidir.
 *
 * ## "Giriş" sekmesi neden doğrudan giriş ekranını açıyor
 *
 * Ara bir adım denendi ve KALDIRILDI: sekme önce üç seçenekli küçük bir hesap
 * penceresi açıyordu (giriş / kayıt / ders ver), ondan sonra asıl giriş
 * ekranı geliyordu. Telefonda bu, üst üste iki pencere demekti ve kullanıcı
 * itiraz etti. Artık sekme doğrudan `?modal=login`i açar; giriş ekranı zaten
 * "Kayıt ol" ve "Ders vermek istiyorum" kapılarını kendi üzerinde taşır
 * (`AuthModal`). Pencere URL'de yaşadığı için GERİ tuşu da onu kapatır.
 *
 * Nöbetçi: `__guards__/mobilAltSekmeler.test.tsx`.
 */

type Sekme = {
  key: string;
  to: string;
  label: string;
  icon: IconName;
  /** `NavLink` yalnız kendi `to`suna bakar; kök sekme tam eşleşme ister. */
  end?: boolean;
  /** Okunmamış mesaj rozeti taşıyan sekme. */
  rozet?: boolean;
};

const KESFET: Sekme = {
  key: "kesfet",
  to: ROUTES.home,
  label: "Keşfet",
  icon: "search",
  end: true,
};
const FAVORILER: Sekme = {
  key: "favoriler",
  to: ROUTES.favorites,
  label: "Favoriler",
  icon: "favorites",
};
const MESAJLAR: Sekme = {
  key: "mesajlar",
  to: ROUTES.messages,
  label: "Mesajlar",
  icon: "messages",
  rozet: true,
};
const HESABIM: Sekme = {
  key: "hesabim",
  to: ROUTES.profile,
  label: "Hesabım",
  icon: "profile",
};

/* `clipboard` (kullanıcı kararı, 16 Eyl 2026): `dashboard` bir ev çizimi ve
   "Pano" için yanlış metafordu; ikon 8 Eyl'de bu amaçla çizilmişti ama alt
   sekmeye bağlanmamıştı. */
const PANO: Sekme = {
  key: "pano",
  to: ROUTES.bookings,
  label: "Pano",
  icon: "clipboard",
  end: true,
};

/* Öğrencide "Rezervasyon" sekmesi Pano'ya döndü (Modül 4, 18 Eyl 2026):
   `/pano` artık öğrencinin panosu, liste şeridin "Rezervasyonlar" sekmesinde. */
const UYE_SEKMELERI: Sekme[] = [KESFET, FAVORILER, MESAJLAR, PANO, HESABIM];

/*
 * EĞİTMEN ÇUBUĞU ÜYEDEN AYRILDI (kullanıcı kararı, 19 Eyl 2026).
 *
 * Eskiden öğrenciyle birebir aynı beş sekmeyi taşıyordu (Keşfet · Favoriler ·
 * Mesajlar · Pano · Hesabım). Kullanıcı kararı: Keşfet ve Favoriler hamburger
 * menüsüne taşındı (`lib/nav.ts::TUTOR_NAV`), "Pano" "Ana sayfa" olarak
 * yeniden adlandırılıp ilk sıraya alındı, Takvim ve Analizler çubuğa girdi.
 * Yeni sıra masaüstü şeridiyle (`lib/nav.ts::TUTOR_PANO_SEKMELERI`) BİREBİR
 * aynı: Ana sayfa · Mesajlar · Takvim · Analizler. "Hesabım" çubuktan düştü;
 * hesap menüsünde zaten sabit bir satır olarak duruyor (`DashboardHeader`).
 *
 * `PANO`dan farklı ayrı bir sabit: `PANO` üye çubuğuyla PAYLAŞILIYOR, etiketi
 * değiştirmek üyeyi de etkilerdi.
 */
const ANA_SAYFA: Sekme = {
  key: "ana-sayfa",
  to: ROUTES.bookings,
  label: "Ana sayfa",
  icon: "dashboard",
  end: true,
};
const TAKVIM: Sekme = {
  key: "takvim",
  to: ROUTES.tutorCalendar,
  label: "Takvim",
  icon: "calendar",
};
const ANALIZLER: Sekme = {
  key: "analizler",
  to: ROUTES.tutorAnalytics,
  label: "Analizler",
  icon: "exams",
};

const EGITMEN_SEKMELERI: Sekme[] = [ANA_SAYFA, MESAJLAR, TAKVIM, ANALIZLER];

/** Anonim kullanıcıda son yuva bir bağlantı değil, giriş ekranını açar. */
const ANONIM_SEKMELERI: Sekme[] = [KESFET, FAVORILER];

/**
 * Panel rolleri (ADMIN · LIBRARY_OPERATOR · COURIER).
 *
 * Favoriler ve Mesajlar YOK: bu roller alıcı değildir, favori düğmesi onlara
 * gösterilmez ve sunucu 403 döner (ÜK-6 · `__guards__/favoriRolKapisi`).
 * Ölü bir sekme koymak, olmayan bir yüzey vaat etmek olurdu.
 */
const PANEL_SEKMELERI: Sekme[] = [
  KESFET,
  { key: "panel", to: ROUTES.adminNew, label: "Yönetim", icon: "dashboard" },
  { key: "ayarlar", to: ROUTES.settings, label: "Ayarlar", icon: "settings" },
];

const OPERATOR_KURYE_SEKMELERI: Sekme[] = [
  KESFET,
  // Operatör ve kuryenin paneli kökte (`/`) açılır — `roleHome` her rol için
  // `/` döndürür ve kabuk rolüne göre farklı ekran çizer. Bu yüzden ayrı bir
  // "panel" sekmesi Keşfet'in İKİZİ olurdu; onun yerine kendi işleri.
  { key: "mesajlar", to: ROUTES.messages, label: "Mesajlar", icon: "messages", rozet: true },
  { key: "ayarlar", to: ROUTES.settings, label: "Ayarlar", icon: "settings" },
];

/**
 * Çubuğun İÇERİK yüksekliği (sekmelerin `min-height`i).
 *
 * `ALT_SEKME_KAPLADIGI` bunun 1px `border-t` ile toplamıdır ve spacer O
 * DEĞERİ kullanır. İkisini eşit yazmak 1px'lik bir örtme üretiyordu: sayfanın
 * son satırı çubuğun altında kalıyordu ve bunu gözle görmek imkânsızdı —
 * `scripts/anasayfa_mobil_turu.mjs` yakaladı. Kenarlık kaldırılır ya da
 * kalınlaşırsa bu sabit de güncellenmelidir; kapı yine bağırır.
 */
export const ALT_SEKME_YUKSEKLIGI = 60;
export const ALT_SEKME_KAPLADIGI = ALT_SEKME_YUKSEKLIGI + 1;

export function MobilAltSekmeler() {
  const token = useAuthStore((s) => s.token);
  // Adres ELLE kurulmaz: `?modal=login` literali React Router'da mevcut
  // sorguyu birleştirmez DEĞİŞTİRİR, yani arama sayfasından girişe basmak
  // filtreleri uçururdu. Tek kapı: `lib/girisAdresi`
  // (nöbetçi: `__guards__/korumaliEylemGezinmez.test.ts`).
  const girisAdresiDegeri = useGirisAdresi();
  const { data: user } = useCurrentUser();
  const girisli = !!token && !!user;

  const sekmeler = !girisli
    ? ANONIM_SEKMELERI
    : user.role_id === ROLE_IDS.TUTOR
      ? EGITMEN_SEKMELERI
      : user.role_id === ROLE_IDS.CLIENT
        ? UYE_SEKMELERI
        : user.role_id === ROLE_IDS.ADMIN
          ? PANEL_SEKMELERI
          : OPERATOR_KURYE_SEKMELERI;

  return (
    <>
      {/* Odaklanan öğe çubuğun altında kalmasın (WCAG 2.4.11) — `StickyBuyBar`
          ile aynı desen. `aria-hidden` çünkü taşıdığı tek şey boşluk. */}
      <div
        aria-hidden="true"
        className="md:hidden"
        style={{
          height: `calc(${ALT_SEKME_KAPLADIGI}px + env(safe-area-inset-bottom))`,
        }}
      />
      {/* Çubuğun kapladığı yüksekliği CSS'e YAYINLA.
          Tüketicisi `ui/Modal`: telefonda tam ekran açılan bir pencerenin
          çubuğu örtmemesi için o kadar boşluk bırakması gerekiyor ve sayıyı
          ikinci kez yazmak iki kaynağın sessizce ayrışması demekti.
          Değişken YALNIZ çubuk çizildiğinde tanımlanır; çubuğun olmadığı
          yüzeylerde tüketici `var(--alt-serit, 0px)` ile 0 görür. */}
      <style>{`:root { --alt-serit: 0px; } @media (max-width: 767.98px) { :root { --alt-serit: calc(${ALT_SEKME_KAPLADIGI}px + env(safe-area-inset-bottom)); } }`}</style>
      <nav
        aria-label="Alt gezinme"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="flex items-stretch">
          {sekmeler.map((s) => (
            <li key={s.key} className="flex-1">
              <SekmeBaglantisi sekme={s} />
            </li>
          ))}
          {!girisli && (
            <li className="flex-1">
              <Link
                to={girisAdresiDegeri}
                className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 py-2 text-slate-500 transition active:scale-95"
                style={{ minHeight: ALT_SEKME_YUKSEKLIGI }}
              >
                <Icon name="profile" className="h-6 w-6" />
                <span className="text-[11px] font-medium leading-none">Giriş</span>
              </Link>
            </li>
          )}
        </ul>
      </nav>
    </>
  );
}

function SekmeBaglantisi({ sekme }: { sekme: Sekme }) {
  const { data: okunmamis } = useMessagesUnreadCount();
  const sayi = sekme.rozet ? (okunmamis?.inbox ?? 0) : 0;

  return (
    <NavLink
      to={sekme.to}
      end={sekme.end}
      className={({ isActive }) =>
        `flex h-full w-full flex-col items-center justify-center gap-1 px-1 py-2 transition active:scale-95 ${
          isActive ? "text-marka-metin" : "text-slate-500"
        }`
      }
      style={{ minHeight: ALT_SEKME_YUKSEKLIGI }}
    >
      <span className="relative">
        <Icon name={sekme.icon} className="h-6 w-6" />
        {/* Rozet biçimi üst bardaki/menüdeki rozetle aynıdır: `bg-rose-500` +
            beyaz metin. Marka `dikkat` tokeni ile beyaz metin
            `__guards__/markaAksani.test.ts`te yasaktır (kontrast), rose
            bilinçli tercih. */}
        {sayi > 0 && (
          <span className="absolute -right-2 -top-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {sayi > 9 ? "9+" : sayi}
          </span>
        )}
      </span>
      <span className="text-[11px] font-medium leading-none">{sekme.label}</span>
    </NavLink>
  );
}
