/**
 * Kaydırma kilidi SAYACA bağlıdır (TB-71).
 *
 * ## Neyi kanıtlıyor
 *
 * `useModalA11y` her açık pencerede `document.body.style.overflow`u tek
 * başına yönetiyordu: açılışta önceki değeri saklıyor, kapanışta geri
 * yazıyordu. İki pencere aynı anda açıkken ikincinin sakladığı "önceki"
 * değer BİRİNCİNİN yazdığı `hidden`dır. Kapanma sırası LIFO değilse — iki
 * `AuthModal` örneği ayrı commit'lerde monte olduğu için gerçek hatada tam
 * olarak bu oluyordu — son temizleyici `hidden`i geri yazıyor ve sayfa
 * YENİLENENE KADAR kaydırma kilitli kalıyordu.
 *
 * TB-71'de gerçek Chrome'da ölçüldü (`/magaza`, oturum kapalı, "Giriş yap"):
 * pencere kapandıktan sonra `body.style.overflow="hidden"`, kaydırma çubuğu
 * 15px → 0px iken `scrollHeight(2110) > innerHeight(788)`. 3/3 turda.
 *
 * ## Testin gücü
 *
 * Gerçek DOM: iddia doğrudan `document.body.style.overflow` üzerinde. Kaynak
 * taraması değil — sayacı sökmek (her örneğin kendi değerini saklayıp geri
 * yazması) bu dosyayı KIRAR (ters prova raporda).
 *
 * Anahtar senaryo LIFO DIŞI kapanmadır: LIFO sırada bozuk kod da temiz
 * çıkıyordu, yani yalnız LIFO test eden bir nöbetçi yalancı yeşil olurdu.
 */
import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useModalA11y } from "./useModalA11y";

function Pencere({
  ad,
  acik = true,
  lockScroll = true,
}: {
  ad: string;
  acik?: boolean;
  lockScroll?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalA11y({ open: acik, onClose: () => {}, panelRef, lockScroll });
  if (!acik) return null;
  return (
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label={ad}>
      <button type="button">{ad} düğmesi</button>
    </div>
  );
}

/** İki pencereyi ayrı ayrı açıp kapatabilen kap. */
function Sahne({ a, b }: { a: boolean; b: boolean }) {
  return (
    <>
      <Pencere ad="A" acik={a} />
      <Pencere ad="B" acik={b} />
    </>
  );
}

afterEach(() => {
  document.body.style.overflow = "";
});

describe("TB-71 · kaydırma kilidi sayacı", () => {
  it("tek pencere: açılışta kilitler, kapanışta açar", () => {
    const { rerender } = render(<Sahne a={false} b={false} />);
    expect(document.body.style.overflow).toBe("");

    rerender(<Sahne a b={false} />);
    expect(document.body.style.overflow).toBe("hidden");

    rerender(<Sahne a={false} b={false} />);
    expect(document.body.style.overflow).toBe("");
  });

  it("LIFO DIŞI kapanmada kilit kalkar (TB-71'in ta kendisi)", () => {
    const { rerender } = render(<Sahne a={false} b={false} />);

    // İki pencere üst üste açılır (A önce, B sonra).
    rerender(<Sahne a b={false} />);
    rerender(<Sahne a b />);
    expect(document.body.style.overflow).toBe("hidden");

    // ÖNCE A kapanır (LIFO değil) — arkada B duruyor, kilit sürmeli.
    rerender(<Sahne a={false} b />);
    expect(
      document.body.style.overflow,
      "açık pencere varken kilit erken açıldı"
    ).toBe("hidden");

    // Son pencere de kapanınca kilit KALKMALI.
    rerender(<Sahne a={false} b={false} />);
    expect(
      document.body.style.overflow,
      "son pencere kapandı ama arka plan kilitli kaldı"
    ).toBe("");
  });

  it("LIFO kapanmada da temiz kalkar", () => {
    const { rerender } = render(<Sahne a={false} b={false} />);
    rerender(<Sahne a b={false} />);
    rerender(<Sahne a b />);
    rerender(<Sahne a b={false} />);
    expect(document.body.style.overflow).toBe("hidden");
    rerender(<Sahne a={false} b={false} />);
    expect(document.body.style.overflow).toBe("");
  });

  it("ikisi AYNI commit'te açılıp AYNI commit'te kapanır", () => {
    // İki `AuthModal` örneği aynı URL parametresini okuduğu için gerçek
    // hatada tam olarak böyle davranıyordu.
    const { rerender } = render(<Sahne a={false} b={false} />);
    rerender(<Sahne a b />);
    expect(document.body.style.overflow).toBe("hidden");
    rerender(<Sahne a={false} b={false} />);
    expect(document.body.style.overflow).toBe("");
  });

  it("sayfanın KENDİ overflow değeri geri verilir", () => {
    // Kilit "boşalt" değil "geri ver" olmalı: kilitten önce sayfanın kendi
    // değeri neyse ona dönülür.
    document.body.style.overflow = "auto";
    const { rerender } = render(<Sahne a={false} b={false} />);
    rerender(<Sahne a b />);
    expect(document.body.style.overflow).toBe("hidden");
    rerender(<Sahne a={false} b={false} />);
    expect(document.body.style.overflow).toBe("auto");
  });

  it("`lockScroll: false` pencere kilide KATILMAZ", () => {
    const { rerender } = render(
      <>
        <Pencere ad="A" acik={false} />
        <Pencere ad="B" acik={false} lockScroll={false} />
      </>
    );
    // Yalnız kilitsiz pencere açık: kilit yok.
    rerender(
      <>
        <Pencere ad="A" acik={false} />
        <Pencere ad="B" acik lockScroll={false} />
      </>
    );
    expect(document.body.style.overflow).toBe("");

    // Kilitli pencere de açılır → kilit var.
    rerender(
      <>
        <Pencere ad="A" acik />
        <Pencere ad="B" acik lockScroll={false} />
      </>
    );
    expect(document.body.style.overflow).toBe("hidden");

    // Kilitli olan kapanınca kilitsiz pencere kilidi TUTMAZ.
    rerender(
      <>
        <Pencere ad="A" acik={false} />
        <Pencere ad="B" acik lockScroll={false} />
      </>
    );
    expect(document.body.style.overflow).toBe("");
  });
});
