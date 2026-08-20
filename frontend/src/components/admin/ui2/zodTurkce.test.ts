/**
 * İP-A2 · M7 — zod hata mesajları Türkçeleşiyor mu?
 *
 * ## İP-A3c: test SIRAYA BAĞLIYDI ve iki yönden de yanlış olabiliyordu
 *
 * Türkçe harita global bir yan etkidir: `form.tsx` yüklenir yüklenmez
 * `z.config(z.locales.tr())` çalışır ve `zod` modül örneğinin durumunu
 * değiştirir. Vitest bir işçi süreçte birden çok test dosyası koşturur ve
 * `zod` bir `node_modules` bağımlılığı olduğu için modül örneği dosyalar
 * arasında PAYLAŞILIR. Bağımsız denetim `--sequence.shuffle` ile bunun iki
 * yönlü bozukluk ürettiğini gösterdi:
 *
 *   - **Yalancı kırmızı** (seed 3'te üretildi): başka bir dosya `form.tsx`'i
 *     önce yüklerse "katman yüklenmeden İngilizceydi" iddiası daha ilk
 *     satırda düşer. Meşru bir koşum sırası CI'yı kırar.
 *   - **Yalancı yeşil** (denetimin işaret ettiği, incelenmemiş yön): aynı
 *     sızıntı sayesinde "yüklendikten sonra Türkçe" iddiası, `form.tsx` o
 *     satırı HİÇ çalıştırmasa bile geçebilir — Türkçeyi kuran başka bir dosya
 *     olmuş olabilir.
 *
 * ### Neden `vi.resetModules()` TEK BAŞINA yetmiyor
 *
 * Denendi ve yetmedi: `resetModules` yalnız **inline edilmiş** (kaynak ağacı)
 * modülleri temizler. `zod` dışsallaştırılmış bir bağımlılıktır, Node'un ESM
 * önbelleğinde kalır ve önceki yapılandırması AYAKTA gelir. Yani taze bir
 * `import("zod")` çıplak zod vermez.
 *
 * ### Kurulan düzen
 *
 * Test artık "başlangıç durumu"nu VARSAYMIYOR, **kendisi kuruyor**: önce
 * açıkça İngilizce yerel yüklenir (ölçülebilir bir zemin), sonra
 * `resetModules` ile `form.tsx` yeniden değerlendirilmeye zorlanır ve mesajın
 * Türkçeye döndüğü gösterilir. Değişimi yapan şeyin `form.tsx` olduğu bu
 * sırayla kanıtlanır; dosya sırası sonucu değiştiremez.
 *
 * `afterEach` Türkçeyi geri kurar: bu dosya, koşum sonrası paylaşılan durumu
 * kendinden ÖNCEKİ hâline döndürmeden bırakırsa sızıntıyı ters yöne çevirmiş
 * olur (diğer dosyaların şemaları İngilizce mesaj verirdi).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mesaj = (r: z.ZodSafeParseResult<unknown>) =>
  r.success ? "" : r.error.issues[0].message;

/** `form.tsx`i TAZE değerlendirir; yan etkisi (Türkçe yerel) yeniden koşar. */
async function katmaniTazeYukle() {
  vi.resetModules();
  await import("./form");
}

afterEach(katmaniTazeYukle);

describe("İP-A2 · zod Türkçe hata haritası", () => {
  it("M7 — katmanın yan etkisi mesajları İngilizceden Türkçeye çevirir", async () => {
    // 1) Zemin TESTİN KENDİSİ tarafından kurulur — "herhalde çıplaktır"
    //    varsayımı yok.
    z.config(z.locales.en());
    const oncesi = mesaj(z.string().safeParse(42));
    expect(oncesi).toMatch(/expected string/i);
    expect(oncesi).not.toMatch(/beklenen|geçersiz/i);

    // 2) Katman yeniden yüklenir — Türkçe harita kurulumu bunun yan etkisidir.
    await katmaniTazeYukle();

    // 3) Aynı çağrı artık Türkçe.
    const sonrasi = mesaj(z.string().safeParse(42));
    // Not: yerel, tip ADINI ("string") çevirmez — çeviren cümledir:
    // "Geçersiz değer: beklenen string, alınan sayı".
    expect(sonrasi).toMatch(/geçersiz değer: beklenen/i);
    expect(sonrasi).not.toMatch(/expected|received|invalid/i);
  });

  it("M7b — sık kullanılan kısıtların mesajları da Türkçe", async () => {
    // TERS PROVA (İP-A3c): önce İngilizce olduğu GÖSTERİLİR. Eski hâlde bu
    // satırlar yoktu; iddia "Türkçe" idi ama Türkçeyi KİMİN kurduğunu
    // ayırt etmiyordu — başka bir dosya kurmuş olsa da geçerdi.
    z.config(z.locales.en());
    expect(mesaj(z.string().min(3).safeParse("a"))).toMatch(/too small|at least/i);
    expect(mesaj(z.number().int().safeParse(1.5))).toMatch(/expected|integer/i);

    await katmaniTazeYukle();

    expect(mesaj(z.string().min(3).safeParse("a"))).not.toMatch(
      /expected|at least|too small/i
    );
    expect(mesaj(z.number().int().safeParse(1.5))).not.toMatch(
      /expected|integer/i
    );
    expect(mesaj(z.string().email().safeParse("x"))).not.toMatch(
      /invalid|email/i
    );
  });
});
