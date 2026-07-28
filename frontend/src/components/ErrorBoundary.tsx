import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/lib/monitoring";

interface Props {
  children: ReactNode;
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

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center dark:bg-slate-900">
        <div className="text-5xl">😕</div>
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">
          Bir şeyler ters gitti
        </h1>
        <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
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
