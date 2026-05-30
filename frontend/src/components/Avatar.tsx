interface AvatarProps {
  name: string;
  avatar_url?: string | null;
  size?: "sm" | "md" | "lg";
}

// İsme göre deterministik renk paleti (rastgele/sahte değil).
const PALETTE = [
  "bg-indigo-100 text-indigo-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
  "bg-teal-100 text-teal-700",
  "bg-fuchsia-100 text-fuchsia-700",
];

const SIZES = {
  sm: "h-9 w-9 text-xs",
  md: "h-11 w-11 text-sm",
  lg: "h-16 w-16 text-xl",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

export function Avatar({ name, avatar_url, size = "md" }: AvatarProps) {
  if (avatar_url) {
    return (
      <img
        src={avatar_url}
        alt={name}
        className={`object-cover shrink-0 rounded-full ${SIZES[size]}`}
      />
    );
  }

  return (
    <div
      aria-hidden
      className={`flex shrink-0 select-none items-center justify-center rounded-full font-semibold ${colorFor(
        name
      )} ${SIZES[size]}`}
    >
      {initials(name)}
    </div>
  );
}
