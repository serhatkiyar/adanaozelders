import { PhoneEditor } from "@/components/PhoneEditor";
import { useCurrentUser } from "@/hooks/useCurrentUser";

import type { AdimProps } from "./ortak";

/**
 * Adım 9 — telefon doğrulama.
 *
 * ATLANABİLİR. Superprof'ta bu adım zorunlu; bizde SMS doğrulaması eylem
 * kapılıdır (rezervasyon, ödeme, mesajlaşma), kayıt kapılı değil. Zorunlu
 * tutmak, ilanını yayına almak isteyen ama o an telefonu yanında olmayan
 * eğitmeni akışın sonunda tıkardı.
 */
export function AdimTelefon({ dis }: AdimProps) {
  const { data: kullanici } = useCurrentUser();

  if (dis.telefonDogrulandi) {
    return (
      <p className="flex items-start gap-2 text-[15px] leading-relaxed text-slate-600">
        <svg
          className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.7-9.7a1 1 0 00-1.4-1.4L9 10.2 7.7 8.9a1 1 0 10-1.4 1.4l2 2a1 1 0 001.4 0l4-4z"
            clipRule="evenodd"
          />
        </svg>
        Numaran doğrulandı. Ders talebi geldiğinde SMS ile haber vereceğiz.
      </p>
    );
  }

  return (
    <PhoneEditor
      initialPhone={kullanici?.phone ?? ""}
      onDone={() => {
        /* Doğrulama sonrası kullanıcı sorgusu tazelenir; adım kendini günceller. */
      }}
    />
  );
}
