// Detay ekranının zaman bloğu — sayfanın en belirgin bilgisi.
//
// Randevu ekranında kullanıcının aradığı ilk şey "ne zaman"dır; NN/g'nin onay
// mesajı araştırmasında da "tam olarak ne rezerve edildi" bilgisi diğer her
// şeyden %58 daha sık isteniyor. Bu yüzden zaman burada iri punto durur.
//
// Mutlak birincil, göreli ikincil: "3 Eylül Perşembe · 14:00–15:00" altında
// küçük "yarın". Tersi olsaydı ekran görüntüsü paylaşıldığında hangi güne
// denk geldiği doğrulanamazdı.
import { goreliGun, mutlakZaman } from "@/lib/reservationTime";

export function ReservationTimeBlock({
  baslangic,
  bitis,
}: {
  baslangic: string | null;
  bitis: string | null;
}) {
  const mutlak = mutlakZaman(baslangic, bitis);
  if (!mutlak) return null;
  const goreli = goreliGun(baslangic);
  return (
    <div>
      <p className="text-lg font-semibold text-slate-900 sm:text-xl">{mutlak}</p>
      {goreli && <p className="mt-0.5 text-sm text-slate-500">{goreli}</p>}
    </div>
  );
}
