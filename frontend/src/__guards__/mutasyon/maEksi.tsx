/**
 * M-A⁻ · **negatif kontrol** (İP-A6b · Görev 1).
 *
 * `maOnce.tsx` + AYNI on iki çağrılı fabrika — ama fabrikanın ürettiği kontrol
 * **adlandırılmıştır**. Mevcut borç (Barkod) bilinçli olarak açık bırakılır:
 * negatif kontrolün iddiası "adsız sayısı ARTMAMALI"dır, "azalmalı" değil.
 *
 * Neden var: pozitif kontrol tek başına "sayaç artık render edileni sayıyor"
 * ile "sayaç artık her fabrikada patlıyor" arasını ayırt edemez. Cezalandırılan
 * şey fabrika deseni değil, **adsızlıktır**.
 */
function MaAlan({ deger }: { deger: string }) {
  return <input className="input" aria-label={deger} defaultValue={deger} />;
}

export function MaEkran() {
  return (
    <form>
      <label htmlFor="ma-ad">Ad</label>
      <input id="ma-ad" className="input" />
      <input className="input" placeholder="Barkod" />
      <select aria-label="Durum" defaultValue="">
        <option value="">Seçin…</option>
      </select>
      {["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"].map((x) => (
        <MaAlan key={x} deger={x} />
      ))}
    </form>
  );
}
