/**
 * M-A mutasyonunun **ÖNCE** hâli (İP-A6b · Görev 1 · BULGU-1).
 *
 * Ölçülen bir panel ekranının küçültülmüş kopyası: üç form kontrolü, biri
 * `htmlFor`↔`id` ile, biri `aria-label` ile adlandırılmış, **biri adsız**
 * (bugün panelde yaygın olan `placeholder`-etiket-yerine deseni).
 *
 * Mutasyonun ölçüsü bu dosyayla `maSonra.tsx` arasındaki FARKTIR; bu yüzden
 * ikisi bilinçli olarak ayrı dosyada durur (kaynak sayacı dosya başına ölçer).
 * İkisi arasındaki tek fark mutasyonun kendisidir — başka hiçbir şey.
 */
export function MaEkran() {
  return (
    <form>
      <label htmlFor="ma-ad">Ad</label>
      <input id="ma-ad" className="input" />
      {/* Mevcut borç: adı yok. `maSonra.tsx`te `aria-label` ile kapatılır. */}
      <input className="input" placeholder="Barkod" />
      <select aria-label="Durum" defaultValue="">
        <option value="">Seçin…</option>
      </select>
    </form>
  );
}
