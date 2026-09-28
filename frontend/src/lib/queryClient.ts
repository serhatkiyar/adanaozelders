import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";

import { getErrorMessage } from "@/lib/errors";
import { reportError } from "@/lib/monitoring";
import { ekranBildirimSayaci, useToastStore } from "@/store/toastStore";

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
  // `toast.error` değil: ekran bildirim sayacına girmemeli (aşağıya bakın).
  useToastStore.getState().push("error", message);
}

/**
 * Mutation hatasında ekranın kendi bildirimi var mı?
 *
 * Ekranlar `onError`'u çoğunlukla `mutate(vars, { onError })` ile verir.
 * TanStack v5 bu seçenekleri MutationObserver'ın özel alanında tutar;
 * `mutation.options`'a yazılmaz. Global yakalayıcı onları göremediği için
 * her hatada ekranın toast'ına ek olarak bir toast daha basıyordu.
 *
 * Çözüm: hata anında ekran bildirim sayacının anlık değeri saklanır. Mutation
 * "error" durumuna geçtiğinde (gözlemcilerin `onError`'u bu anda çalışır) bir
 * sonraki makro görevde sayaca bakılır: arada ekran bir bildirim verdiyse
 * global toast gösterilmez. `mutateAsync` + `try/catch` ile toast gösteren
 * ekranlar da mikro görevlerde çalıştığı için aynı pencereye düşer. Ekran
 * hatayı yalnız satır içinde gösteriyorsa (toast yoksa) global bildirim kalır.
 */
const bekleyenMutasyonHatalari = new WeakMap<object, number>();


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
      // Kanca düzeyinde `onError` tanımlıysa hata orada ele alınır.
      if (mutation.options.onError) return;
      if (!shouldNotify(error)) return;
      reportError(error);
      // Toast kararı mutation "error" durumuna geçince verilir (aşağıda).
      bekleyenMutasyonHatalari.set(mutation, ekranBildirimSayaci());
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

queryClient.getMutationCache().subscribe((event) => {
  if (event.type !== "updated" || event.action.type !== "error") return;
  const mutation = event.mutation;
  const oncekiSayi = bekleyenMutasyonHatalari.get(mutation);
  if (oncekiSayi === undefined) return;
  bekleyenMutasyonHatalari.delete(mutation);
  const error = event.action.error;
  setTimeout(() => {
    if (ekranBildirimSayaci() !== oncekiSayi) return;
    notifyOnce(error, "İşlem tamamlanamadı.");
  }, 0);
});
