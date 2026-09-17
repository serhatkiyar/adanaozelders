interface AvatarProps {
  name: string;
  avatar_url?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  shape?: "circle" | "square" | "kare";
}

// İsme göre deterministik renk paleti (rastgele/sahte değil).
const PALETTE = [
  "bg-marka-line text-marka-metin-hover",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
  "bg-teal-100 text-teal-700",
  "bg-fuchsia-100 text-fuchsia-700",
];

const SIZES = {
  // Üst bar (Preply ölçüsü): 32px.
  xs: "h-8 w-8 text-xs",
  sm: "h-9 w-9 text-xs",
  md: "h-11 w-11 text-sm",
  lg: "h-16 w-16 text-xl",
  xl: "h-32 w-32 text-4xl",
};

/**
 * Baş harfler — fotoğrafsız kullanıcının görsel kimliği.
 *
 * Dışa aktarılıyor çünkü eğitmen profilinin mobil hero'su fotoğrafsız dalda
 * AYNI harfleri ve AYNI rengi basmak zorunda: orada avatar 32px değil tam
 * genişlik bir alan, yani `Avatar` bileşeni doğrudan kullanılamıyor. İkinci bir
 * üretim yazılsaydı aynı kişi iki ekranda iki farklı renkte görünürdü.
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** İsme göre deterministik palet seçimi — bkz. `initials`. */
export function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

export function Avatar({ name, avatar_url, size = "md", shape = "circle" }: AvatarProps) {
  const roundedClass =
    shape === "square" ? "rounded-3xl" : shape === "kare" ? "rounded" : "rounded-full";

  if (avatar_url) {
    return (
      <img
        src={avatar_url}
        alt={name}
        className={`object-cover shrink-0 ${roundedClass} ${SIZES[size]}`}
      />
    );
  }

  return (
    <div
      aria-hidden
      className={`flex shrink-0 select-none items-center justify-center font-semibold ${roundedClass} ${colorFor(
        name
      )} ${SIZES[size]}`}
    >
      {initials(name)}
    </div>
  );
}
