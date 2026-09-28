import { create } from "zustand";

export type ToastType = "success" | "error" | "warning" | "info";

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (type: ToastType, message: string) => void;
  dismiss: (id: number) => void;
}

let counter = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (type, message) => {
    const id = ++counter;
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }));
    setTimeout(() => get().dismiss(id), 4500);
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/**
 * Ekranların gösterdiği (başarı dışı) bildirim sayacı. Global mutation hata
 * yakalayıcısı (`lib/queryClient.ts`) bunu okuyarak ekran hatayı zaten
 * bildirdiyse ikinci bir toast basmaz. Global yakalayıcı kendi bildirimini
 * `push` ile doğrudan verdiği için sayaca girmez.
 */
let ekranBildirimSayisi = 0;

export function ekranBildirimSayaci(): number {
  return ekranBildirimSayisi;
}

function ekranBildirimi(type: Exclude<ToastType, "success">, m: string) {
  ekranBildirimSayisi += 1;
  useToastStore.getState().push(type, m);
}

export const toast = {
  success: (m: string) => useToastStore.getState().push("success", m),
  error: (m: string) => ekranBildirimi("error", m),
  warning: (m: string) => ekranBildirimi("warning", m),
  info: (m: string) => ekranBildirimi("info", m),
};
