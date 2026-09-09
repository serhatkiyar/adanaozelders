import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useMutation } from "@tanstack/react-query";
import { DashboardHeader } from "@/components/DashboardHeader";
import { PanelSekmeleri } from "@/components/PanelSekmeleri";
import { MobilAltSekmeler } from "@/components/MobilAltSekmeler";
import { useAuthStore } from "@/store/authStore";
import { resendEmailVerification } from "@/api/auth";
import { toast } from "@/store/toastStore";
import { navForRole, panoSekmeleriForRole, type NavItem } from "@/lib/nav";

interface DashboardShellProps {
  title: string;
  navItems?: NavItem[];
  children?: ReactNode;
  /**
   * Kenardan-kenara (tam-viewport) yerleşim. true iken sayfa kaydırması kapanır,
   * içerik üst bar altındaki tüm alanı padding'siz doldurur (ör. mesajlaşma).
   */
  flush?: boolean;
  /** Navbar ortasına yerleşen içerik (ör. arama pill'i). */
  center?: ReactNode;
  /** Navbar'ın alt satırına yerleşen içerik (ör. filtre çubuğu). */
  bottom?: ReactNode;
  /**
   * PANEL ŞERİDİ (üst barın altındaki kalıcı sekme satırı).
   *
   * `undefined` (varsayılan): kabuk şeridi role göre KENDİSİ türetir. Böylece
   * ~40 panel sayfasının hiçbirine dokunmadan şerit her yerde görünür — aksi
   * hâlde aynı prop kırk yerde tek tek geçilir ve bir tanesi mutlaka unutulur.
   *
   * `null`: şerit kapatılır. Mağaza yüzeyleri bunu geçer — eğitmen orada
   * ALICI rolündedir ve mağazanın kendi gezinmesi (`StoreLayout`) vardır.
   */
  sekmeler?: NavItem[] | null;
  /**
   * İÇERİK GENİŞLİĞİ — adlandırılmış sınıf (kullanıcı kararı, 8 Eyl 2026).
   *
   * Ölçüm: panel şeridinin altı sekmesinde BEŞ farklı genişlik vardı
   * (768 · 1536 · 672 · 768 · 1024 · 672) ve hiçbiri bir kurala bağlı değildi.
   * Kullanıcı: *"ilanım, ders rezervasyonları falan gibi yerlerde sayfa
   * genişliğinde bir standart yok gibi görünüyor."*
   *
   * Kusur farklı genişlik DEĞİL — taranan altı tasarım sisteminin hiçbiri tek
   * sabit genişlik dayatmıyor (Atlassian 3 grid: 1296/864/fluid, GitLab
   * 990/1280/full, Wix "layout intents", Polaris `narrowWidth`/`fullWidth`).
   * Kusur, farkın KURALSIZ olmasıydı: 672 ile 768 arasındaki seçim tesadüftü.
   *
   *  • `dar`  (768) — form ve uzun metin. Satır uzunluğunu 50–75 karakterde
   *    tutar (Baymard 50–60, GOV.UK ≤75, WCAG 1.4.8 ≤80). İlanım, Öne çıkar.
   *  • `orta` (1152) — pano, liste, detay, ayarlar. Atlassian "fixed-wide",
   *    GitLab 1280 sınıfının karşılığı.
   *  • Tam genişlik ayrı bir eksen: `flush` (mesajlaşma).
   *
   * Geçilmezse kabuk sarmalayıcı KOYMAZ — kırk panel sayfasının mevcut
   * yerleşimi bozulmasın diye. Şeridin sayfaları açıkça geçmek ZORUNDA;
   * nöbetçisi `__guards__/panelGenisligi.test.ts`.
   */
  genislik?: PanelGenisligi;
}

export type PanelGenisligi = "dar" | "orta";

/** Adlandırılmış genişlik sınıfları — tek kaynak. */
export const PANEL_GENISLIKLERI: Record<PanelGenisligi, string> = {
  dar: "mx-auto w-full max-w-3xl",
  orta: "mx-auto w-full max-w-6xl",
};

export function DashboardShell({
  title,
  navItems,
  children,
  flush = false,
  center,
  bottom,
  sekmeler,
  genislik,
}: DashboardShellProps) {
  const user = useAuthStore((s) => s.user);
  const panelSekmeleri =
    sekmeler === undefined ? panoSekmeleriForRole(user?.role_id) : sekmeler;
  /*
   * `navItems` geçilmediğinde ROLDEN türetilir.
   *
   * Eskiden geçilmeyen yerde menü boş kalıyordu ve bu sessizdi: sayfa açılır,
   * hiçbir test kırılmaz, yalnız üst bardaki favori kısayolu ve açılır
   * menüdeki rol satırları o ekranda YOK olur. Yeni yazılan üç eğitmen
   * yüzeyinde (Değerlendirmeler, İlan Ayarları, Öne çıkar) tam da bu oldu —
   * kusur gerçek tarayıcı turunda görüldü. Şerit zaten rolden türüyordu;
   * iki türevin ayrı kurallarla çalışması kusurun kendisiydi.
   *
   * Açıkça geçilen değer her zaman kazanır (ör. `TutorProfile` oturum
   * sahibinin rolüne göre geçer, `Demands` ekranına göre).
   */
  const menuOgeleri = navItems ?? navForRole(user?.role_id);

  const [verifyDismissed, setVerifyDismissed] = useState(false);
  const resendVerify = useMutation({
    mutationFn: resendEmailVerification,
    onSuccess: (res) =>
      toast.success(res.detail ?? "Doğrulama bağlantısı e-postana gönderildi."),
    onError: () =>
      toast.error("Bağlantı gönderilemedi. Lütfen biraz sonra tekrar dene."),
  });
  const showVerifyBanner =
    !!user && user.email_verified === false && !verifyDismissed;

  useEffect(() => {
    document.title = `Adana Özel Ders · ${title}`;
  }, [title]);

  /* ── YAPIŞKAN ÜST BOŞLUK — tek kaynak (kullanıcı kararı, 7 Eyl 2026) ──
   *
   * Kusur: başlık zaten yapışkandı ama doğrulama şeridi AKIŞTAYDI. Sayfa
   * kaydırılınca şerit gidiyor, yanındaki yapışkan kart da 60 piksel peşinden
   * sürükleniyor ve ancak ondan sonra sabitleniyordu. Kullanıcı: *"henüz
   * sayfanın en üstündeyken kaydırmaya başlayınca kart hareket ediyor, ilk
   * kısımda hareket etmesi çok saçma."*
   *
   * Çözüm: başlık ve şerit TEK yapışkan yığın oldu, yüksekliği ölçülüp
   * `--yapiskan-ust` olarak yayınlanıyor. Yapışkan yan kartlar üst boşluklarını
   * sabit bir sayı yerine bu değişkenden alır; şerit açılıp kapansa da hizalar
   * kendiliğinden doğru kalır ve kart HİÇ hareket etmez.
   *
   * Ölçüm ResizeObserver'la yapılır: şerit iki satıra sarabiliyor, arama
   * çubuğu genişleyip daralıyor — sabit bir sayı yazmak yanlış olurdu.
   */
  const yiginRef = useRef<HTMLDivElement>(null);
  const [yapiskanUst, setYapiskanUst] = useState(0);
  useLayoutEffect(() => {
    const el = yiginRef.current;
    if (!el) return;
    const olc = () => setYapiskanUst(Math.round(el.getBoundingClientRect().height));
    olc();
    const gozlemci = new ResizeObserver(olc);
    gozlemci.observe(el);
    window.addEventListener("resize", olc);
    return () => {
      gozlemci.disconnect();
      window.removeEventListener("resize", olc);
    };
  }, [showVerifyBanner]);

  return (
    <div
      className={
        flush
          ? "flex h-screen flex-col overflow-hidden bg-slate-50 "
          : "min-h-screen bg-slate-50 "
      }
      style={{ "--yapiskan-ust": `${yapiskanUst}px` } as CSSProperties}
    >
      {/* Başlık + şerit TEK yapışkan yığın: şerit akışta kalsaydı kaydırınca
          gider, yanındaki yapışkan kartı da peşinden sürüklerdi. */}
      <div ref={yiginRef} className="sticky top-0 z-40">
        <DashboardHeader navItems={menuOgeleri} transparent center={center} bottom={bottom} expanded />

        {/* Şerit yapışkan yığının İÇİNDE: akışta kalsaydı kaydırınca gider,
            sayfa değiştikçe sekmeler kaybolurdu. Yığının yüksekliği zaten
            ResizeObserver ile ölçülüp `--yapiskan-ust` olarak yayınlanıyor,
            yani şerit eklenince yapışkan kartların hizası kendiliğinden
            düzeltiliyor — hiçbir yere sabit piksel yazılmıyor. */}
        {panelSekmeleri && panelSekmeleri.length > 0 && (
          <PanelSekmeleri items={panelSekmeleri} />
        )}

        {showVerifyBanner && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              className="h-5 w-5 shrink-0 text-amber-600 "
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
              />
            </svg>
            <p className="flex-1 text-sm text-amber-800 ">
              <span className="font-semibold">E-postanı doğrula.</span>{" "}
              <span className="text-amber-700 ">
                {user?.email} adresine gönderdiğimiz bağlantıya tıkla.
              </span>
            </p>
            <button
              type="button"
              onClick={() => resendVerify.mutate()}
              disabled={resendVerify.isPending}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {resendVerify.isPending ? "Gönderiliyor..." : "Yeniden gönder"}
            </button>
            <button
              type="button"
              aria-label="Kapat"
              onClick={() => setVerifyDismissed(true)}
              className="rounded-lg p-1.5 text-amber-600 transition hover:bg-amber-100 "
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                className="h-4 w-4"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18 18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          </div>
        )}
      </div>

      <main className={flush ? "min-h-0 flex-1 overflow-hidden" : "p-4 sm:p-6"}>
        {genislik ? (
          <div className={PANEL_GENISLIKLERI[genislik]}>{children}</div>
        ) : (
          children
        )}
      </main>
      {/* Yalnız CLIENT ve TUTOR'da çizilir; panel rolleri (ADMIN, operatör,
          kurye) bileşenin kendi içinde elenir — bkz. tasarım dili §4.3. */}
      <MobilAltSekmeler />
    </div>
  );
}
