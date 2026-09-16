import { SegmentedControl } from "@/components/SegmentedControl";
import { MESAFE_SECENEKLERI } from "@/lib/aramaBasligi";
import { VARSAYILAN_YARICAP_KM } from "@/lib/aramaUrl";
import { useKonumStore } from "@/store/konumStore";

/**
 * MESAFE bölümü — eğitmen ve kütüphane filtre pencereleri ile şeritteki
 * "Uzaklık ⌄" açılırının ORTAK gövdesi (kullanıcı kararı, 16 Eyl 2026).
 * Yatay sabit seçenekler: Farketmez | 1 | 3 | 5 | 10 | 15 | 25 km.
 *
 * Adres şeması sayfaya göre değişir (kütüphanede `sirala` da düşer), o yüzden
 * adrese yazan iki geri çağrı dışarıdan gelir; konum isteği ve durum notu
 * burada tektir. İzin verilmezse `kaldir` çağrılır — adreste hiçbir şey
 * yapmayan bir filtre asılı kalmaz.
 */
export function MesafeSecici({
  yaricap,
  sec,
  kaldir,
}: {
  yaricap: number | undefined;
  /** Yarıçap seçildi: adrese `yakinimda=1&yaricap=km` yaz. */
  sec: (km: number) => void;
  /** "Farketmez" ya da izin reddi: niyeti adresten düşür. */
  kaldir: () => void;
}) {
  const { konum, yukleniyor, iste, unut } = useKonumStore();
  return (
    <div>
      <SegmentedControl<string>
        options={MESAFE_SECENEKLERI}
        value={String(yaricap ?? VARSAYILAN_YARICAP_KM)}
        onChange={(val) => {
          if (!val) {
            unut();
            kaldir();
            return;
          }
          sec(Number(val));
          if (!konum) iste(kaldir);
        }}
      />
      {yukleniyor && (
        <p className="mt-2 animate-pulse text-xs font-medium text-marka-metin">Konum alınıyor…</p>
      )}
      {konum && !yukleniyor && (
        <p className="mt-2 text-xs font-medium text-emerald-600">✓ Konumunuz kullanılıyor</p>
      )}
    </div>
  );
}
