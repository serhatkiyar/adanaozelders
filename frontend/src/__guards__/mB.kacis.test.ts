/**
 * ── M-B · Dizin kaçışı (İP-A6b · Görev 1 · BULGU-2) ──
 *
 * Denetim #2'nin ölçtüğü kaçış: ölçüm tabanı DİZİN yürüyüşüyle kuruluyordu
 * (`components/admin/**`, `pages/admin/**`, `dashboards/Admin*` + elle yazılmış
 * altı dosya). Ölçülen bir ekranın **doğrudan import ettiği** bir bileşen bu
 * ağacın dışındaysa borcu görünmüyordu; denetimde eklenen
 * `denetim2Kacak.tsx` (3 ham `<button>` · 3 adsız kontrol · 1 etiketsiz
 * overlay) nöbetçilerden 39/39 yeşil geçti.
 *
 * Bu sentetik bir risk değil: bugün ölçülen 82 dosyanın doğrudan import ettiği
 * dokuz yerel bileşen (`ExamSessionsManager`, `LibraryEditorModal`,
 * `MapPicker`, `QrScanner`…) ölçümün dışındaydı — göç edecek düzenleme
 * yüzeyinin çoğu görünmüyordu.
 *
 * **Kural (yazılı):** ölçüm tabanı, panel tabanından ulaşılan **JSX taşıyan
 * yerel modüllerin (`.tsx`) geçişli kapanışını** içermek zorundadır. Kapanış
 * `.ts` modüllerinde durur — dört metriğin dördü de JSX metriğidir. `.ts`
 * içindeki tek olası kaçak (`React.createElement("button")`) ayrı bir
 * bütün-ağaç nöbetçisiyle kapatılır (`hamButonKacaklari`).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  dosyaOlcumu,
  kesfedilenTaban,
  OLCUM_TABANI,
  tabanDurumu,
  ulasilanModuller,
} from "../../scripts/ui-baseline-sayim.mjs";

const EKRAN = "src/__guards__/mutasyon/mbEkran.tsx";
const KACAK = "src/__guards__/mutasyon/denetim2Kacak.tsx";

describe("M-B · dizin kaçışı (BULGU-2)", () => {
  it("fixture nöbetçisi: kaçak dosya gerçekten borç taşıyor", () => {
    // Bu olmadan aşağıdaki testler, kaçak dosya boşalsa da geçerdi.
    const o = dosyaOlcumu(readFileSync(KACAK, "utf8"), KACAK);
    expect(o.rawButton).toBe(3);
    expect(o.adsizKontrol).toBe(3);
    expect(o.overlays - Math.min(o.dialogRoles, o.ariaModals)).toBe(1);
  });

  it("BULGU-2 KAYDI: dizin yürüyüşü kaçağı görmez", () => {
    // Onarımdan sonra da YEŞİL kalır: yürüyüş hâlâ kaçağı bulmaz, onu bulan
    // şey import grafiğidir. Kaydın kendisi kalıcı olarak burada durur.
    expect(kesfedilenTaban()).not.toContain(KACAK);
  });

  it("ölçülen bir ekranın import ettiği YEREL .tsx grafikte görünür", () => {
    expect(ulasilanModuller([EKRAN])).toContain(KACAK);
  });

  it("grafikte görünen ama listede olmayan dosya `fazla`ya düşer (kapı kırılır)", () => {
    // Kapının kendisi: taban listesi ekranı içeriyor, kaçağı içermiyor.
    expect(tabanDurumu([EKRAN]).fazla).toContain(KACAK);
  });
});

describe("M-B⁻ · negatif kontrol: yakalama DİZİN ŞANSINA değil KURALA bağlı", () => {
  it("panel ağacındaki bir dosya listeden düşerse yine `fazla`ya düşer", () => {
    // Denetimdeki M-B⁻ "aynı dosyayı components/admin altına koy" idi ve zaten
    // yakalanıyordu. Aynı iddia, gerçek panel ağacındaki bir dosyayı listeden
    // düşürerek kurulur — üretim ağacına borç dosyası eklemeden.
    const kurban = "src/components/admin/ui/Dialog.tsx";
    expect(OLCUM_TABANI).toContain(kurban);
    expect(kesfedilenTaban()).toContain(kurban);

    const eksikListe = OLCUM_TABANI.filter((f: string) => f !== kurban);
    expect(tabanDurumu(eksikListe).fazla).toContain(kurban);
  });
});
