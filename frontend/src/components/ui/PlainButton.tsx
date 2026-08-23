import { forwardRef, type ButtonHTMLAttributes } from "react";

/** Stil dayatmayan ortak düğme primitive'i; tüm yüzeyler aynı güvenli varsayılanı paylaşır. */
export const PlainButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function PlainButton({ type = "button", ...props }, ref) {
    return <button ref={ref} type={type} {...props} />;
  },
);
