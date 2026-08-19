/**
 * M-A mutasyonunun **SONRA** hâli (İP-A6b · Görev 1 · BULGU-1).
 *
 * `maOnce.tsx`e göre İKİ hareket birden yapılır — mutasyonun kapsamı
 * bölünemez, çünkü denetimde ölçülen kusur tam olarak ikisinin birbirini
 * gizlemesiydi ("12 borç doğdu, 1 borç kapandı, sayaç 30'da kaldı"):
 *
 *   1. **On iki çağrılı, tek yazımlık, adsız alan fabrikası eklenir.**
 *      Kaynakta bir `<input>` yazılıdır; çalışma zamanında on iki tanedir.
 *   2. **Mevcut bir borç `aria-label` ile kapatılır** (Barkod alanı).
 *
 * Beklenen fark: adsız kontrol **+11**, toplam kontrol **+12**.
 * Kaynak sayacı ikisini de göremez (+0 / +1) — BULGU-1 budur.
 */
function MaAlan({ deger }: { deger: string }) {
  return <input className="input" defaultValue={deger} />;
}

export function MaEkran() {
  return (
    <form>
      <label htmlFor="ma-ad">Ad</label>
      <input id="ma-ad" className="input" />
      {/* Borç kapatıldı: artık adı var. */}
      <input className="input" aria-label="Barkod" placeholder="Barkod" />
      <select aria-label="Durum" defaultValue="">
        <option value="">Seçin…</option>
      </select>
      {["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"].map((x) => (
        <MaAlan key={x} deger={x} />
      ))}
    </form>
  );
}
