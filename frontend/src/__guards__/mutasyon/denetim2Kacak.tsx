/**
 * M-B mutasyonunun kaçak dosyası (İP-A6b · Görev 1 · BULGU-2).
 *
 * Denetimde `src/lib/denetim2Kacak.tsx` olarak yazıldı ve nöbetçilerden
 * SESSİZCE geçti: ölçüm tabanı DİZİN yürüyüşüyle kuruluyordu
 * (`components/admin/**`, `pages/admin/**`, `dashboards/Admin*`), bu yüzden
 * ölçülen bir ekranın **doğrudan import ettiği** bir bileşen bile ölçüm
 * dışında kalabiliyordu.
 *
 * İçeriği denetimdekiyle aynı borç profilini taşır:
 * **3 ham `<button>` · 3 adsız kontrol · 1 etiketsiz `fixed inset-0` overlay**
 * (`role="dialog"`/`aria-modal` YOK).
 *
 * Kalıcı test dosyası olduğu için `src/__guards__/mutasyon/` altında durur:
 * gerçek `src/lib/` ağacına borç eklemek paketin kapsamını çiğnerdi.
 */
export function Denetim2Kacak({ acik }: { acik: boolean }) {
  return (
    <div>
      <button type="button">Bir</button>
      <button type="button">İki</button>
      <button type="button">Üç</button>
      <input className="input" placeholder="Ad" />
      <select defaultValue="">
        <option value="">Seçin…</option>
      </select>
      <textarea className="input" />
      {acik ? <div className="fixed inset-0 bg-black/40" /> : null}
    </div>
  );
}
