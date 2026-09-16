import { SegmentedControl } from "@/components/SegmentedControl";
import { MESAFE_SECENEKLERI } from "@/lib/aramaBasligi";
import { VARSAYILAN_YARICAP_KM } from "@/lib/aramaUrl";
import { useKonumStore } from "@/store/konumStore";

/**
 * MESAFE bölümü — eğitmen ve kütüphane filtre pencereleri ile şeritteki
 * "Uzaklık ⌄" açılırının ORTAK gövdesi (kullanıcı kararı, 16 Eyl 2026).
 * Yatay sabit seçenekler: Farketmez | 1 | 3 | 5 | 10 | 15 | 25 km.
 *
 * "Farketmez" YAKINIMDA MODUNDAN ÇIKARMAZ (kullanıcı kararı, 16 Eyl 2026):
 * kullanıcı çevresini aramaya geldi; Farketmez yalnız yarıçap sınırını
 * kaldırır (`YARICAP_FARKETMEZ`), seçili kalır ve tekrar 5 km seçilebilir.
 * Moddan çıkmak ayrı bir eylemdir (Temizle / hapta yer seçmek).
 *
 * Konum BİR KEZ alınır ve bellekte kalır; seçenek değiştirmek yeniden
 * istemez. "Konum alınıyor / kullanılıyor" notları kaldırıldı — kullanıcıya
 * bir şey söylemiyordu. İzin reddi zaten uyarı gösterir ve `kaldir` ile
 * niyeti düşürür.
 *
 * Adres şeması sayfaya göre değişir (kütüphanede `sirala` da düşer), o yüzden
 * adrese yazan geri çağrılar dışarıdan gelir.
 */
export function MesafeSecici({
  yaricap,
  sec,
  kaldir,
}: {
  yaricap: number | undefined;
  /** Yarıçap seçildi: adrese `yakinimda=1&yaricap=km` yaz (0 = Farketmez). */
  sec: (km: number) => void;
  /** Yalnız izin reddi: niyeti adresten düşür. */
  kaldir: () => void;
}) {
  const konum = useKonumStore((s) => s.konum);
  const iste = useKonumStore((s) => s.iste);
  return (
    <SegmentedControl<string>
      options={MESAFE_SECENEKLERI}
      value={String(yaricap ?? VARSAYILAN_YARICAP_KM)}
      onChange={(val) => {
        sec(Number(val));
        if (!konum) iste(kaldir);
      }}
    />
  );
}
