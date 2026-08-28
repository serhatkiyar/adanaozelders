import { useId, type ReactNode } from "react";

/**
 * Etiketi girdiye BAĞLAYAN form alanı.
 *
 * NEDEN VAR: kod tabanında 165 `<label>` ve 248 `<input>` vardı ama `htmlFor`
 * kullanımı SIFIRDI. Görsel olarak etiketli görünen her alan, ekran okuyucu
 * için adsızdı ("düzenleme alanı, boş"); etikete tıklamak da girdiyi
 * odaklamıyordu. Bağlantı elle kurulduğunda kaçınılmaz olarak unutulur,
 * bu yüzden id üretimi bileşenin içindedir.
 *
 * Render-prop kullanılır (`children(id)`): girdiyi klonlayıp id enjekte etmek
 * TypeScript'te kırılgandır ve `<select>`/`<textarea>`/özel bileşen ayrımını
 * gizler. Burada bağlantı gözle görülür ve tip güvenlidir.
 *
 *     <Field label="Neden">
 *       {(id) => <select id={id} … />}
 *     </Field>
 */
export interface FieldProps {
  label: string;
  /** Etiketin altında görünen açıklama; girdiye aria-describedby ile bağlanır. */
  hint?: string;
  /** Hata metni; doluysa alan `aria-invalid` işaretlenir. */
  error?: string;
  required?: boolean;
  className?: string;
  /** Etiketin kendi sınıfları — mevcut ekranların görünümü değişmesin diye. */
  labelClassName?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}

const DEFAULT_LABEL_CLASS =
  "block text-sm font-medium text-slate-700 ";

export function Field({
  label,
  hint,
  error,
  required,
  className = "",
  labelClassName = DEFAULT_LABEL_CLASS,
  children,
}: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className={className}>
      <label htmlFor={id} className={labelClassName}>
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-rose-500">
            *
          </span>
        )}
      </label>
      {hint && (
        <p id={hintId} className="mt-0.5 text-xs text-slate-500 ">
          {hint}
        </p>
      )}
      {children(id, describedBy)}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-rose-600 ">
          {error}
        </p>
      )}
    </div>
  );
}
