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
import { useAuthStore } from "@/store/authStore";
import { resendEmailVerification } from "@/api/auth";
import { toast } from "@/store/toastStore";
import type { NavItem } from "@/lib/nav";

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
}

export function DashboardShell({
  title,
  navItems,
  children,
  flush = false,
  center,
  bottom,
}: DashboardShellProps) {
  const user = useAuthStore((s) => s.user);

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
        <DashboardHeader navItems={navItems} transparent center={center} bottom={bottom} expanded />

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
        {children}
      </main>
    </div>
  );
}
