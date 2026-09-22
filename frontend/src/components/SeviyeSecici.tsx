import type { SeviyeMerdiveni } from "@/api/subjects";

const hap = (aktif: boolean) =>
  `inline-flex items-center rounded-full px-3 py-2 text-sm font-medium transition ${
    aktif
      ? "bg-marka text-marka-fg"
      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
  }`;

/**
 * SEVİYE bölümü — eğitmen filtre penceresinde "Fiyat Aralığı" ile "Eğitmen
 * cinsiyeti" arasına eklenen bölüm.
 *
 * Seçenekler SABİT DEĞİL: seçilen derse göre değişir (`Ders.scales`'ten,
 * `dersinSeviyeleri` ile — eğitmenin branş seçim ekranındaki `DersSecici` ile
 * AYNI yardımcı). OKUL merdiveni ~12 basamak olabildiğinden `SegmentedControl`
 * (eşit genişlikte bölme) yerine SARILAN hap listesi — `DersSecici`nin kendi
 * seviye hapı diliyle aynı, yalnız burada TEK seçim var (Cinsiyet'teki
 * "Tümü" gibi).
 */
export function SeviyeSecici({
  merdivenler,
  secili,
  sec,
}: {
  /** Seçili dersin geçerli merdiven(ler)i — çağıran taraf `dersinSeviyeleri` ile süzer. */
  merdivenler: SeviyeMerdiveni[];
  secili: number | undefined;
  /** `undefined` = Tümü. */
  sec: (id: number | undefined) => void;
}) {
  return (
    <div className="space-y-3">
      {merdivenler.map((merdiven, i) => (
        <div key={merdiven.code}>
          {merdivenler.length > 1 && (
            <span className="text-xs text-slate-500">{merdiven.name}</span>
          )}
          <div className={`flex flex-wrap gap-1.5 ${merdivenler.length > 1 ? "mt-1" : ""}`}>
            {i === 0 && (
              <button
                type="button"
                onClick={() => sec(undefined)}
                aria-pressed={secili === undefined}
                className={hap(secili === undefined)}
              >
                Tümü
              </button>
            )}
            {merdiven.levels.map((seviye) => (
              <button
                key={seviye.id}
                type="button"
                onClick={() => sec(seviye.id)}
                aria-pressed={secili === seviye.id}
                className={hap(secili === seviye.id)}
              >
                {seviye.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
