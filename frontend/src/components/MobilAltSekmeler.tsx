import { Link, NavLink, useSearchParams } from "react-router-dom";

import { Icon, type IconName } from "@/components/AppIcon";
import { Modal } from "@/components/ui/Modal";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useKayitAcik } from "@/hooks/useKayitAcik";
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
 * ## Bu bir "panel alt çubuğu" DEĞİLDİR
 *
 * `docs/tasarim-dili.md` §4.3 alt gezinme çubuğunu açıkça YASAKLAR — ama o
 * yasak yönetim kabuğu içindir ve gerekçesi sayısaldır: yönetim gezinmesi beş
 * grupta 20 öğedir, bir alt çubuk en fazla 5 yuva taşır. Burası public keşif
 * yüzeyidir ve en fazla 5 öğesi vardır; aynı doküman alt çubuğu "3-5 öğeli rol
 * panellerinin deseni olarak doğrudur" diye kaydeder. Bu yüzden ADMIN,
 * LIBRARY_OPERATOR ve COURIER için çubuk HİÇ çizilmez — onlar `DashboardShell`
 * kabuğunu kullanır ve yasağın kapsamındadır.
 *
 * ## Neden `DashboardHeader`ın içinde değil
 *
 * `__guards__/ustBarSadeligi.test.tsx` üst barın hesap menüsünün bir kopyası
 * olmamasını, orada EN FAZLA TEK kısayol bulunmasını sabitler. Çubuk üst barın
 * içine konsaydı o iddia sessizce çürürdü. Ayrı bir bileşen olması bilinçlidir.
 *
 * ## Hesap sayfası neden `useState` ile açılmıyor
 *
 * İlk yazımda anonim kullanıcının "Giriş" sekmesi bir `<button>` + `useState`
 * ikilisiydi. `__guards__/uiBaseline.test.ts` bunu iki ayrı düğümden yakaladı:
 * ham düğme sayısı tavanı aştı ve "ekranda yaşayan pencere durumu SIFIR"
 * tabanı kırıldı (bileşen `DashboardShell`ten import edildiği için ölçüm
 * ağacındadır). Doğrusu sitenin zaten kullandığı sözleşmeydi: pencere URL'de
 * yaşar (`?modal=hesap`, bkz. `AuthModal`ın `?modal=login`i). Kazanç yalnız
 * nöbetçiyi memnun etmek değil — telefonda GERİ tuşu artık sayfayı değil
 * pencereyi kapatıyor.
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

const UYE_SEKMELERI: Sekme[] = [
  KESFET,
  FAVORILER,
  MESAJLAR,
  { key: "rezervasyonlar", to: ROUTES.bookings, label: "Rezervasyon", icon: "bookings", end: true },
  HESABIM,
];

const EGITMEN_SEKMELERI: Sekme[] = [
  KESFET,
  FAVORILER,
  MESAJLAR,
  { key: "pano", to: ROUTES.bookings, label: "Pano", icon: "dashboard", end: true },
  HESABIM,
];

/** Anonim kullanıcıda son yuva bir bağlantı değil, hesap sayfasını açan düğmedir. */
const ANONIM_SEKMELERI: Sekme[] = [KESFET, FAVORILER];

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
  const { data: user } = useCurrentUser();
  const girisli = !!token && !!user;

  // ADMIN / LIBRARY_OPERATOR / COURIER: panel kabuğu, alt çubuk yok (§4.3).
  if (
    girisli &&
    user.role_id !== ROLE_IDS.CLIENT &&
    user.role_id !== ROLE_IDS.TUTOR
  ) {
    return null;
  }

  const sekmeler = !girisli
    ? ANONIM_SEKMELERI
    : user.role_id === ROLE_IDS.TUTOR
      ? EGITMEN_SEKMELERI
      : UYE_SEKMELERI;

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
                to="?modal=hesap"
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
      {!girisli && <HesapSayfasi />}
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

/**
 * Anonim kullanıcının "Giriş" sekmesi.
 *
 * "Ders Ver" burada yaşar (kullanıcı kararı): üst bardan çıkarıldı ama SİTEDE
 * eğitmen kaydının tek kapısıdır — kaybolursa eğitmen hiç kaydolamaz.
 */
function HesapSayfasi() {
  const kayitAcik = useKayitAcik();
  const [searchParams, setSearchParams] = useSearchParams();
  const open = searchParams.get("modal") === "hesap";

  const onClose = () => {
    searchParams.delete("modal");
    setSearchParams(searchParams, { replace: true });
  };

  const satir =
    "flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left text-[15px] font-semibold text-slate-800 transition hover:bg-slate-50 active:scale-[0.99]";

  return (
    <Modal open={open} onClose={onClose} title="Hesap">
      <div className="mt-4 flex flex-col gap-1">
        <Link to="?modal=login" onClick={onClose} className={satir}>
          Giriş yap
        </Link>
        {kayitAcik && (
          <>
            <Link to="?modal=register" onClick={onClose} className={satir}>
              Kayıt ol
            </Link>
            {/* Kutu değil saç-teli çizgi (tasarım dili §3.2): "hesabım" ile
                "ders vermek" ayrı cümlelerdir, ayrı kartlar değil. */}
            <div className="my-2 h-px bg-slate-100" />
            <Link
              to="?modal=register&role=tutor"
              onClick={onClose}
              className={satir}
            >
              Ders vermek istiyorum
            </Link>
          </>
        )}
      </div>
    </Modal>
  );
}
