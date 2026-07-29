import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";

import { getErrorMessage } from "@/lib/errors";
import { reportError } from "@/lib/monitoring";
import { toast } from "@/store/toastStore";

/**
 * Sorgu hataları SESSİZ KALMAMALI.
 *
 * Bileşenlerde `isLoading` 76 dosyada kullanılırken `isError` yalnız 37'sinde
 * ele alınıyordu: backend 500 dönen bir uçta ~39 bileşen hiçbir şey söylemeden
 * boş kalıyordu. Kullanıcı "veri yok" sanıyor, biz de hatayı hiç görmüyorduk.
 *
 * Global yakalayıcı iki iş yapar: kullanıcıya tek bir bildirim gösterir ve
 * hatayı izleme servisine (Sentry; DSN yoksa no-op) iletir. Bileşenler kendi
 * `isError` görünümlerini göstermeye devam edebilir — bu yalnızca tabandır.
 */
const IGNORED_STATUSES = new Set([
  401, // Oturum düşmesi: axios interceptor sessiz yenileme/çıkış yapar.
  403, // Yetkisiz yüzeyler kendi mesajını gösterir.
  404, // "Bulunamadı" çoğu ekranda geçerli bir durumdur (boş görünüm).
]);

function shouldNotify(error: unknown): boolean {
  if (!isAxiosError(error)) return true;
  // Kullanıcı sayfadan ayrılırken iptal edilen istekler hata değildir.
  if (error.code === "ERR_CANCELED") return false;
  const status = error.response?.status;
  return status === undefined || !IGNORED_STATUSES.has(status);
}

/** Aynı hata birkaç sorgudan aynı anda gelirse tek bildirim göster. */
let lastMessage = "";
let lastAt = 0;

function notifyOnce(error: unknown, fallback: string) {
  const message = getErrorMessage(error, fallback);
  const now = Date.now();
  if (message === lastMessage && now - lastAt < 4000) return;
  lastMessage = message;
  lastAt = now;
  toast.error(message);
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // Bileşen kendi hata görünümünü çiziyorsa `meta: { silentError: true }`
      // ile bildirimi kapatabilir.
      if (query.meta?.silentError) return;
      if (!shouldNotify(error)) return;
      notifyOnce(error, "Veriler yüklenemedi.");
      reportError(error, { queryKey: JSON.stringify(query.queryKey) });
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      // Mutasyonların çoğu kendi `onError`'unda toast gösterir; çifte bildirim
      // olmaması için yalnız hiç ele alınmayanlar buraya düşer.
      if (mutation.options.onError) return;
      if (!shouldNotify(error)) return;
      notifyOnce(error, "İşlem tamamlanamadı.");
      reportError(error);
    },
  }),
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});
