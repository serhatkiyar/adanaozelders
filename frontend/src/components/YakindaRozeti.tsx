/**
 * Donmuş bölümlerin menü rozeti — TEK KAYNAK.
 *
 * Üç ayrı yüzeyde (kategori çubuğu, rol menüsü, Öğren hub'ı kartı) aynı
 * rozetin üç kopyası olsaydı, bayrak açıldığında birini kaldırmayı unutmak
 * serbest kalırdı. Metin de burada sabitlenir: nöbetçi testler tam olarak
 * "Yakında" arıyor.
 */
export const YAKINDA_METNI = "Yakında";

export function YakindaRozeti({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 ${className}`}
    >
      {YAKINDA_METNI}
    </span>
  );
}
