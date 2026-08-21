/**
 * İP-A4 · Görev 4 — **A7'nin kabul kriterinin provası.**
 *
 * > Form TÜM KOŞULLU DALLARIYLA render edilir ve her form alanının
 * > erişilebilir adı doğrulanır.
 *
 * ## Neden gerekli
 *
 * `Form.Control`un adsız alan koruması yalnız RENDER ANINDA ateşlenir
 * (İP-A3c). `DamageDialog`ın alanlarının bir kısmı koşulludur:
 *
 *   - `kova` (kaynak kova) → yalnız `SUPPLIER_RETURN`
 *   - `aciklama`          → yalnız `neden === "DIGER"`
 *   - imha onay kutusu    → yalnız `DISPOSAL`
 *
 * Bu dalların hiçbirine uğramayan bir test kümesi yeşil kalır ve adsız alan
 * üretime çıkar. Aşağıdaki test dalları TEK TEK açar ve kaptaki BÜTÜN form
 * kontrollerini sayarak adsız olan var mı diye bakar — yani yeni eklenen bir
 * alan da otomatik kapsanır (testin ayrıca güncellenmesi gerekmez).
 *
 * ## Maliyet (A7 değerlendirmesi)
 *
 * Ekran başına yazılan tek şey "dalları açan tıklamalar"dır; adlandırma
 * denetiminin kendisi `test-utils/alanAdlari.ts`'te ortaktır. Bu dosyanın
 * dal-açma kısmı ~30 satırdır. Dürüst değerlendirme raporda
 * (`docs/ip-a4-rapor.md` → Görev 4).
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProductSearchOut } from "@/types";

const URUNLER = [
  { id: 7, title: "Matematik Soru Bankası", sku: "MAT-7", author: null, publisher: null, isbn: null },
] as unknown as ProductSearchOut[];

vi.mock("@/hooks/useStore", () => ({
  useAdminProducts: () => ({ data: { items: URUNLER }, isLoading: false }),
}));

import { DamageDialog } from "./DamageDialog";
import { adsizKontroller, erisilebilirAd, formKontrolleri } from "@/test-utils/alanAdlari";

import type { DuzenlemeYuzeyiDurumu } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { DAMAGE_KINDS, type DamageKind } from "@/lib/inventory";

function yuzeyi(kind: DamageKind) {
  return {
    acik: true,
    yeni: true,
    kayit: null,
    baglam: kind,
    hedef: { tur: "yeni", baglam: kind },
    ac: () => {},
    yeniAc: () => {},
    kapat: () => {},
  } as unknown as DuzenlemeYuzeyiDurumu<never, DamageKind>;
}

function ac(kind: DamageKind) {
  render(
    <DamageDialog yuzey={yuzeyi(kind)} isPending={false} error={null} onSubmit={() => {}} />
  );
  return screen.getByRole("dialog");
}

afterEach(cleanup);

describe("İP-A4 · DamageDialog: her koşullu dalda her alanın adı var", () => {
  // Dört işlem × iki neden dalı (normal / DIGER) = sekiz kombinasyon.
  for (const { value: kind, label } of DAMAGE_KINDS) {
    for (const neden of ["KIRIK", "DIGER"] as const) {
      it(`${label} · neden=${neden} — adsız form kontrolü YOK`, () => {
        const dialog = ac(kind);

        // Neden alanı: "DIGER" `aciklama` dalını açar.
        fireEvent.change(within(dialog).getByLabelText(/neden/i), {
          target: { value: neden },
        });

        const adsiz = adsizKontroller(dialog);
        expect(
          adsiz,
          `adsız kontrol(ler): ${adsiz.map((a) => a.html).join(" | ")}`
        ).toEqual([]);

        // Yanlış-yeşil koruması: hiç kontrol bulunamazsa liste de boş olurdu.
        // Bu dalda EN AZ üç kontrol beklenir (ürün araması, miktar, neden).
        expect(formKontrolleri(dialog).length).toBeGreaterThanOrEqual(3);
      });
    }
  }

  it("koşullu alanlar gerçekten AÇILIYOR (dal provası)", () => {
    // Yukarıdaki döngü, dallar hiç açılmasa da geçerdi. Burada dalların
    // varlığı ADIYLA doğrulanır: dal açılmadan alan YOK, açılınca VAR.
    let dialog = ac("TRANSFER");
    expect(within(dialog).queryByLabelText(/kaynak kova/i)).toBeNull();
    expect(within(dialog).queryByLabelText(/açıklama/i)).toBeNull();
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    cleanup();

    dialog = ac("SUPPLIER_RETURN");
    expect(erisilebilirAd(within(dialog).getByLabelText(/kaynak kova/i))).toMatch(
      /kaynak kova/i
    );
    cleanup();

    dialog = ac("DISPOSAL");
    // İmha onay kutusu formun dışında yaşar (şemaya alan açmamak için) ama
    // adı olmak zorunda: sarmalayan `<label>` metniyle adlanır.
    expect(erisilebilirAd(within(dialog).getByRole("checkbox"))).toMatch(
      /geri alınamaz|onaylıyorum/i
    );
    cleanup();

    dialog = ac("TRANSFER");
    fireEvent.change(within(dialog).getByLabelText(/neden/i), {
      target: { value: "DIGER" },
    });
    expect(erisilebilirAd(within(dialog).getByLabelText(/açıklama/i))).toMatch(
      /açıklama/i
    );
  });

  it("aletin kendisi çalışıyor: adsız bir alan YAKALANIYOR", () => {
    // Ters prova — `adsizKontroller` her zaman boş dönüyor olsaydı yukarıdaki
    // sekiz test de geçerdi. Aynı fonksiyona bilerek adsız bir alan verilir.
    const kap = document.createElement("div");
    kap.innerHTML = `
      <label>Adı var<input /></label>
      <input class="adsiz" />
      <input type="hidden" />
      <input type="submit" value="Gönder" />
    `;
    document.body.appendChild(kap);
    const adsiz = adsizKontroller(kap);
    expect(adsiz).toHaveLength(1);
    expect(adsiz[0].html).toContain("adsiz");
    // `hidden` ve `submit` ölçüm dışı: sayaçla aynı kural.
    expect(formKontrolleri(kap)).toHaveLength(2);
    kap.remove();
  });
});
