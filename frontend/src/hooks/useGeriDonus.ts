import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * "Geri" — geçmiş yoksa bir YEDEĞE düşen dönüş.
 *
 * ## Neden `navigate(-1)` yetmiyor
 *
 * Mobil detay ekranında (eğitmen profili) üst bar da alt sekme çubuğu da
 * çizilmiyor; sayfanın TEK çıkışı geri düğmesi. Ama profil bağlantısı
 * paylaşılabilir ve arama motorundan da girilir. Öyle bir girişte geçmişte bu
 * uygulamaya ait kayıt yoktur: `navigate(-1)` ya hiçbir şey yapmaz ya da
 * kullanıcıyı siteden tamamen çıkarır. İkisi de çıkmaz sokak.
 *
 * ## Neden tek başına `location.key` yetmiyor (ölçüldü, 10 Eyl 2026)
 *
 * React Router ilk girişi `key === "default"` ile işaretler ve bu, doğru
 * sinyal gibi görünür. Değildir: `useCanonicalTutorSlug` adresi `replace` ile
 * düzeltiyor (`/egitmenler/ali-42` → `/egitmenler/42`) ve React Router bu
 * sırada YENİ bir `key` üretiyor. Yani tam da en kritik senaryoda —
 * paylaşılan bağlantıyla gelen ziyaretçide — işaret siliniyor ve düğme sessizce
 * ölü bir `navigate(-1)`e düşüyordu. Nöbetçi bunu yakaladı:
 * `__guards__/egitmenProfiliMobil.test.tsx`.
 *
 * Bu yüzden iki sinyal var:
 *   1. `window.history.state.idx` — React Router'ın kendi geçmiş sayacı.
 *      `replace` bunu KORUR, `0` "geride uygulamaya ait kayıt yok" demektir.
 *      Gerçek tarayıcıda birincil kaynak budur.
 *   2. `location.key === "default"` — ilk render'da yakalanır (sonradan
 *      okunursa yukarıdaki `replace` onu bozar). `MemoryRouter` altında
 *      `history.state` yoktur; testlerde ölçülen dal budur.
 *
 * Bu kanca SAYFA seviyesinde çağrılmalıdır: veri beklerken sayfa hemen mount
 * olur, kanonik düzeltme ise ancak veri gelince çalışır. Geç mount olan bir alt
 * bileşende çağrılsaydı 2. sinyal yine bozuk okunurdu.
 */
export function useGeriDonus(yedekYol: string): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  const [ilkGiris] = useState(() => location.key === "default");

  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    const geriGidilebilir = typeof idx === "number" ? idx > 0 : !ilkGiris;
    if (geriGidilebilir) navigate(-1);
    else navigate(yedekYol);
  }, [ilkGiris, navigate, yedekYol]);
}
