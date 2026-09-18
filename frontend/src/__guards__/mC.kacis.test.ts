// @vitest-environment node
/**
 * ── M-C · Prop olarak inen pencere durumu (İP-A6b · Görev 1 · BULGU-3) ──
 *
 * İP-A5 bağ çözümünü dosya ölçekli ad eşleşmesinden sözlüksel kapsama çevirdi.
 * Düzeltme DOĞRUYDU (aynı dosyadaki üç ayrı `deleting` bağı tek sayılıyordu),
 * ama yeni bir kör nokta açtı: durum ebeveynde yaşayıp aynı dosyadaki çocuk
 * bileşene **prop olarak** inerse artık hiç sayılmıyor. Ekranda yaşayan
 * pencere durumu metriği tam olarak bunu ölçmek için var.
 *
 * Denetimde ölçüldü: `modalDurumu` **29'da kaldı**, 39/39 yeşil.
 *
 * > Tetikleyici bilinçli olarak `<span>`: `<button>` yazılırsa ham buton eşiği
 * > kırılır ve düşen test yanlış nedene bağlanır (denetimde bir tur böyle
 * > kaybedildi). Aşağıdaki ilk iddia bunu kalıcı olarak sabitler.
 */
import { describe, expect, it } from "vitest";

import { dosyaOlcumu } from "../../scripts/ui-baseline-sayim.mjs";

const MC = `
  function DenetimCocuk({ acik }: { acik: boolean }) {
    return <ConfirmDialog open={acik} title="x" description="y"
                          onClose={() => {}} onConfirm={() => {}} />;
  }

  export function DenetimUst() {
    const [acik, setAcik] = useState(false);
    return (
      <div>
        <span onClick={() => setAcik(true)}>ac</span>
        <DenetimCocuk acik={acik} />
      </div>
    );
  }
`;

const MC_EKSI = `
  function DenetimRozet({ aktif }: { aktif: boolean }) {
    return <span>{aktif ? "açık" : "kapalı"}</span>;
  }

  export function DenetimUst() {
    const [aktif, setAktif] = useState(false);
    return (
      <div>
        <span onClick={() => setAktif(true)}>ac</span>
        <DenetimRozet aktif={aktif} />
      </div>
    );
  }
`;

describe("M-C · prop olarak inen pencere durumu (BULGU-3)", () => {
  it("mutasyon ham buton eşiğine DOKUNMAZ (düşüş yanlış nedene bağlanmasın)", () => {
    expect(dosyaOlcumu(MC, "mc.tsx").rawButton).toBe(0);
  });

  it("çocuğa prop olarak inip pencereye verilen durum SAYILIR", () => {
    expect(dosyaOlcumu(MC, "mc.tsx").modalDurumAdlari).toEqual(["acik"]);
  });

  it("bağ başına bir kez: aynı durum iki çocuğa da inse TEK sayılır", () => {
    // İP-A5'in sözleşmesi korunuyor mu? Onarım "her prop kullanımını say"
    // olsaydı bu 2 dönerdi ve metrik yeniden anlamını kaybederdi.
    const kaynak = `
      function A({ acik }: { acik: boolean }) { return <ADialog open={acik} />; }
      function B({ acik }: { acik: boolean }) { return <BDialog open={acik} />; }
      export function Ust() {
        const [acik, setAcik] = useState(false);
        return (<div><A acik={acik} /><B acik={acik} /></div>);
      }
    `;
    expect(dosyaOlcumu(kaynak, "mc2.tsx").modalDurumAdlari).toEqual(["acik"]);
  });

  it("iki sıçramalı zincir de çözülür (çocuk → torun → pencere)", () => {
    const kaynak = `
      function Torun({ gorunur }: { gorunur: boolean }) { return <XDialog open={gorunur} />; }
      function Cocuk({ acik }: { acik: boolean }) { return <Torun gorunur={acik} />; }
      export function Ust() {
        const [acik, setAcik] = useState(false);
        return (<div><span onClick={() => setAcik(true)}>ac</span><Cocuk acik={acik} /></div>);
      }
    `;
    expect(dosyaOlcumu(kaynak, "mc3.tsx").modalDurumAdlari).toEqual(["acik"]);
  });
});

describe("M-C⁻ · negatif kontrol: her prop değil, PENCEREYE VERİLEN durum", () => {
  it("pencereye verilmeyen boolean prop sayılmaz", () => {
    expect(dosyaOlcumu(MC_EKSI, "mc-eksi.tsx").modalDurumAdlari).toEqual([]);
  });

  it("pencere OLMAYAN bileşene inen durum da sayılmaz", () => {
    const kaynak = `
      function Cocuk({ acik }: { acik: boolean }) { return <Accordion open={acik} />; }
      export function Ust() {
        const [acik, setAcik] = useState(false);
        return <Cocuk acik={acik} />;
      }
    `;
    expect(dosyaOlcumu(kaynak, "mc-eksi2.tsx").modalDurumAdlari).toEqual([]);
  });
});
