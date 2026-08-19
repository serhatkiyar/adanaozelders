/**
 * ── Kapının ÖLÇÜM BİRİMİ (İP-A6b · Görev 2 · BULGU-1) ──
 *
 * "Erişilebilir adı olmayan form kontrolü" eşiğinin doğruluk kaynağı artık
 * kaynak sayacı DEĞİL, **render edilen DOM**dur.
 *
 * Sebep denetimde rakamla ölçüldü: `scripts/ui-baseline-sayim.mjs` kaynakta
 * YAZILANI sayar, kullanıcı ise RENDER EDİLENİ görür. On iki çağrılı, tek
 * yazımlık bir alan fabrikası (bugün üretimde olan desen — `ProductForm` →
 * `KunyeAlani` tek yazım, dokuz çağrı) sayaca **bir** kontrol gibi görünür.
 * Kaydı `mA.kacis.test.tsx`te kalıcı olarak duruyor: mutasyon gerçek borcu
 * +11 artırdı, sayaç +0 dedi.
 *
 * Bu dosya o birimi tek bir yerde tanımlar; hem mutasyon testi (M-A) hem
 * çalışma zamanı kapısı (`calismaZamaniKapisi.test.tsx`) aynı birimi kullanır
 * — ikisi ayrı ayrı ölçseydi kapı ile mutasyon farklı şeyleri iddia edebilirdi.
 *
 * Ad çözümü `test-utils/alanAdlari`dedir (HTML adlandırma kuralları:
 * `aria-label`, `aria-labelledby`, `htmlFor`↔`id`, sarmalayan `<label>`);
 * `placeholder`/`title` gibi ZAYIF kaynaklar bilinçle ad sayılmaz.
 *
 * Ölçüm `baseElement` (yani `document.body`) üzerinden yapılır, `container`
 * üzerinden değil: pencereler `createPortal` ile gövdenin altına çıkar ve
 * container'a bakan bir ölçüm tam da penceredeki alanları kaçırırdı.
 */
import { render } from "@testing-library/react";

import { adsizKontroller, formKontrolleri } from "@/test-utils/alanAdlari";

import type { ReactElement } from "react";

export interface KontrolSayisi {
  /** Adlandırılması BEKLENEN, render edilmiş form kontrolü sayısı. */
  toplam: number;
  /** Bunlardan erişilebilir adı olmayanların sayısı. */
  adsiz: number;
  /** Adsız kontrollerin kısaltılmış HTML'i — "30 borç var" demek yetmez. */
  adsizHtml: string[];
}

/** Bir React ağacını render eder, kontrolleri sayar ve DOM'u geri temizler. */
export function kontrolOlcumu(ui: ReactElement): KontrolSayisi {
  const { baseElement, unmount } = render(ui);
  try {
    const adsiz = adsizKontroller(baseElement as HTMLElement);
    return {
      toplam: formKontrolleri(baseElement as HTMLElement).length,
      adsiz: adsiz.length,
      adsizHtml: adsiz.map((a) => a.html),
    };
  } finally {
    unmount();
  }
}
