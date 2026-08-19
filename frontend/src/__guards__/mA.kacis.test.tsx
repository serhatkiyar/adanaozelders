/**
 * ── M-A · Fabrika körlüğü (İP-A6b · Görev 1 · BULGU-1) ──
 *
 * Denetim #2'nin ölçtüğü kaçış: ölçülen bir dosyaya **on iki çağrılı, tek
 * yazımlık, adsız** bir alan fabrikası eklendi ve aynı dosyada mevcut bir borç
 * `aria-label` ile kapatıldı. Gerçek borç net **+11** arttı, çalışma zamanında
 * **12 adsız kontrol** doğdu — ve nöbetçi sayacı `adsizKontrol` **30'da
 * kaldı**, `src/__guards__` 39/39 yeşil geçti.
 *
 * Sebebi tek cümleyle: **sayaç kaynakta YAZILANI sayar, kullanıcı RENDER
 * EDİLENİ görür.** Bu bir kenar durum değil, bugün üretimde olan bir desen
 * (`ProductForm.tsx` → `KunyeAlani` tek yazım, dokuz çağrı yeri).
 *
 * ## Bu dosyanın iddiası "sayı arttı" DEĞİLDİR
 *
 * İki **tam sayısal eşitlik**, ayrı ayrı:
 *
 *   1. `adsizSonra − adsizOnce === 11`   (12 yeni adsız − 1 kapatılan borç)
 *   2. `toplamSonra − toplamOnce === 12` (12 yeni kontrol; kapatma toplamı
 *      değiştirmez)
 *
 * "Arttı" / "≥ 1" biçiminde bir eşik kabul edilmez: 1 de 40 da o eşiği geçer,
 * yani sayacın fabrikanın kaç çağrısını gördüğünü ayırt etmez. İkisi AYRI
 * doğrulandığı için, sayacın yalnız birini görüp diğerini kaçırdığı bir
 * yarı-onarım da yakalanır.
 */
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { kontrolOlcumu } from "./kapiOlcumu";
import { MaEkran as MaOnce } from "./mutasyon/maOnce";
import { MaEkran as MaSonra } from "./mutasyon/maSonra";
import { MaEkran as MaEksi } from "./mutasyon/maEksi";
import { adsizKontroller, formKontrolleri } from "@/test-utils/alanAdlari";

import { dosyaOlcumu } from "../../scripts/ui-baseline-sayim.mjs";
import { readFileSync } from "node:fs";

const oku = (f: string) => readFileSync(f, "utf8");
const ONCE = "src/__guards__/mutasyon/maOnce.tsx";
const SONRA = "src/__guards__/mutasyon/maSonra.tsx";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("M-A · fabrika körlüğü (BULGU-1)", () => {
  it("BULGU-1 KAYDI: KAYNAK sayacı fabrikayı göremez — kapı ona bağlanamaz", () => {
    // Bu test onarımdan sonra da YEŞİL kalır ve kalmalıdır: kaynak sayacı
    // teşhis aleti olarak duruyor, yalanı burada rakamla yazılı. Kapının
    // neden çalışma zamanına devredildiğinin kalıcı kanıtı budur.
    const once = dosyaOlcumu(oku(ONCE), ONCE);
    const sonra = dosyaOlcumu(oku(SONRA), SONRA);

    // Gerçek: adsız +11, toplam +12. Kaynak sayacının gördüğü:
    expect(sonra.adsizKontrol - once.adsizKontrol).toBe(0);
    expect(sonra.kontrolToplam - once.kontrolToplam).toBe(1);
  });

  it("KAPI ÖLÇÜMÜ: adsız kontrol TAM OLARAK 11 artar", () => {
    const once = kontrolOlcumu(<MaOnce />);
    const sonra = kontrolOlcumu(<MaSonra />);
    expect(sonra.adsiz - once.adsiz).toBe(11);
  });

  it("KAPI ÖLÇÜMÜ: toplam kontrol sayısı TAM OLARAK 12 artar", () => {
    // Ayrı doğrulanır: +11'in gerçekten 12 YENİ kontrolden geldiğini, mevcut
    // adlı kontrollerin adsıza düşmesinden gelmediğini bu eşitlik kanıtlar.
    const once = kontrolOlcumu(<MaOnce />);
    const sonra = kontrolOlcumu(<MaSonra />);
    expect(sonra.toplam - once.toplam).toBe(12);
  });

  it("mutasyonun İKİ hareketi de gerçekten uygulanmış (fixture nöbetçisi)", () => {
    // Yalancı yeşil kapısı: yukarıdaki farklar, fixture'lar boşalsa ya da
    // mutasyonun bir hareketi düşse de "0 − 0" ile sessizce geçebilirdi.
    // Burada iki hareket DOM üzerinde ayrı ayrı gözlenir.
    const { unmount } = render(<MaOnce />);
    expect(formKontrolleri(document.body)).toHaveLength(3);
    expect(adsizKontroller(document.body)).toHaveLength(1); // Barkod borcu açık
    unmount();
    document.body.innerHTML = "";

    render(<MaSonra />);
    expect(formKontrolleri(document.body)).toHaveLength(15); // 3 + 12 çağrı
    // Barkod borcu kapandı: kalan 12 adsızın hepsi fabrikadan gelir.
    const adsiz = adsizKontroller(document.body);
    expect(adsiz).toHaveLength(12);
    expect(adsiz.every((a) => a.etiket === "input")).toBe(true);
  });
});

describe("M-A⁻ · negatif kontrol: cezalandırılan fabrika değil, ADSIZLIK", () => {
  it("adlandırılmış on iki çağrılı fabrika adsız sayısını ARTIRMAZ", () => {
    const once = kontrolOlcumu(<MaOnce />);
    const eksi = kontrolOlcumu(<MaEksi />);
    expect(eksi.adsiz - once.adsiz).toBe(0);
  });

  it("negatif kontrolün fabrikası GERÇEKTEN render ediliyor (boş geçmiyor)", () => {
    // Kapı ölçümünden BAĞIMSIZ prova: 12 kontrol DOM'da var ama hepsi adlı.
    // Bu olmadan "0 fark" iddiası, fabrikanın hiç render edilmemesiyle de
    // sağlanabilirdi — negatif kontrolün klasik yalancı yeşili.
    render(<MaEksi />);
    expect(formKontrolleri(document.body)).toHaveLength(15);
    expect(adsizKontroller(document.body)).toHaveLength(1); // yalnız Barkod
  });
});
