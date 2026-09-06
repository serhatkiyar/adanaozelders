import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { reportError } from "@/lib/monitoring";

interface Props {
  children: ReactNode;
  /** Verilirse varsayılan tam ekran görünüm yerine bu çizilir. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Render sırasında oluşan beklenmeyen hataları yakalar; tüm uygulamanın beyaz
 * ekrana düşmesini engelleyip kullanıcıya kurtarma seçeneği sunar.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Geliştirme/üretimde teşhis için konsola yaz (sessizce yutma).
    console.error("Yakalanmamış UI hatası:", error, info);
    // Canlıda konsol kimsenin görmediği yerdir: hatayı izleme servisine de
    // gönder (DSN yoksa no-op).
    reportError(error, { componentStack: info.componentStack });
  }

  private handleReload = () => {
    this.setState({ hasError: false });
    window.location.assign("/");
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center ">
        <div className="text-5xl">😕</div>
        <h1 className="text-xl font-semibold text-slate-800 ">
          Bir şeyler ters gitti
        </h1>
        <p className="max-w-md text-sm text-slate-500 ">
          Beklenmeyen bir hata oluştu. Sayfayı yenilemeyi deneyebilir veya ana
          sayfaya dönebilirsin.
        </p>
        <button
          onClick={this.handleReload}
          className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95"
        >
          Ana sayfaya dön
        </button>
      </div>
    );
  }
}

/**
 * Router İÇİNDEKİ hata sınırı.
 *
 * Dıştaki `ErrorBoundary` tek başınayken bir sayfa çöktüğünde router da
 * ağaçtan düşüyordu: kullanıcıya kalan tek çare tam sayfa yenilemeydi ve
 * uygulama durumu (oturum önbelleği, açık ders penceresi) sıfırlanıyordu.
 * Bu sınır rota değişiminde kendini sıfırlar — kullanıcı gezinerek toparlanır,
 * sayfa yeniden yüklenmez.
 */
function RouteErrorFallback() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-4xl">😕</div>
      <h2 className="text-lg font-semibold text-slate-800 ">
        Bu sayfa yüklenemedi
      </h2>
      <p className="max-w-md text-sm text-slate-500 ">
        Beklenmeyen bir hata oluştu. Başka bir sayfaya geçebilir ya da tekrar
        deneyebilirsin.
      </p>
      <button
        onClick={() => navigate(-1)}
        className="rounded-xl bg-marka px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-marka-hover active:scale-95"
      >
        Geri dön
      </button>
    </div>
  );
}

export function RouteErrorBoundary({ children }: Props) {
  // `key` rota değişince sınırı sıfırlar: hata veren sayfadan çıkınca
  // uygulama kendiliğinden toparlanır.
  const location = useLocation();
  return (
    <ErrorBoundary key={location.pathname} fallback={<RouteErrorFallback />}>
      {children}
    </ErrorBoundary>
  );
}
