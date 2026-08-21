/**
 * TB-72 · Kirli form bekçisinde **"Çık" pencereyi gerçekten kapatır**.
 *
 * ## Ne kaçmıştı
 *
 * `duzenlemeYuzeyi.test.tsx` dört kapatma yolunun da ONAY SORDUĞUNU
 * kanıtlıyordu; onaydan SONRA ne olduğunu soran tek bir düğüm yoktu. Gerçek
 * Chrome'da (`/yonetim/envanter/hasar` → "Hasara ayır" → miktar=3 → kapat →
 * "Çık") istem kapanıyor ama düzenleme penceresi AÇIK kalıyor, girilen değer
 * duruyor ve kaydırma kilidi kalkmıyordu. Üç kapatma yolunda da.
 *
 * ## Kök: tek yönlü mandal
 *
 * Bekçi, onay çözüldüğünde bileşenin hâlâ ayakta olduğunu `sokulduRef` ile
 * denetler (bayat closure koruması). Mandal SÖKÜLÜNCE `true` yapılıyor ama
 * yeniden monte edilince `false`a DÖNDÜRÜLMÜYORDU. React 18 `StrictMode`
 * geliştirmede her efekti mount → cleanup → mount sırasıyla iki kez koşturur:
 * ilk cleanup mandalı kaldırıyor, ikinci mount onu indirmiyordu. Sonuç:
 * `kapat()` dalı ilk andan itibaren ÖLÜ.
 *
 * ## Testin gücü — ve neden `StrictMode` ŞART
 *
 * Bu dosyanın atası olan testler `render()`i çıplak kullanıyordu ve kusuru
 * GÖREMİYORLARDI: React tek mount yapınca mandal hiç kalkmıyor. Uygulama ise
 * `main.tsx`te `<StrictMode>` içinde koşuyor. Yani kusur "tarayıcıya özgü"
 * değil, **test kabının gerçek uygulamaya benzememesinden** görünmezdi.
 *
 * Aşağıdaki her senaryo `<StrictMode>` içinde koşar ve iddia gözlemlenebilir
 * davranıştır: `role="dialog"` DOM'dan gitmeli ve yüzeyin durumu "kapalı"
 * olmalı. Yeniden monte olmayı ayrıca AÇIKÇA sınayan bir senaryo da var —
 * `StrictMode` kaldırılırsa (ya da React davranışı değişirse) o senaryo
 * nöbeti sürdürür.
 *
 * Ters prova (rapor): `sokulduRef.current = false` satırı mount efektinden
 * çıkarılınca bu dosyadaki dört senaryo da kırılır.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/admin/ui";

import { DuzenlemeYuzeyi, useDuzenlemeYuzeyi } from "./duzenlemeYuzeyi";

interface Kayit {
  id: number;
}

function Ekran() {
  const yuzey = useDuzenlemeYuzeyi<Kayit, "yeni">();
  const form = useForm<{ ad: string }>({ defaultValues: { ad: "" } });

  return (
    <div>
      <span data-testid="durum">{yuzey.acik ? "açık" : "kapalı"}</span>
      <Button onClick={() => yuzey.yeniAc("yeni")}>Yeni</Button>
      <DuzenlemeYuzeyi
        yuzey={yuzey}
        baslik="Kayıt düzenle"
        form={form}
        sunucuHatasi={null}
        aksiyonlar={<Button>Kaydet</Button>}
      >
        <label>
          Ad
          <input {...form.register("ad")} />
        </label>
      </DuzenlemeYuzeyi>
    </div>
  );
}

/** Ekranı bir kez SÖKÜP yeniden monte edebilen kap (mandalın ikinci sınavı). */
function YenidenMonte() {
  const [anahtar, setAnahtar] = useState(0);
  const [varMi, setVarMi] = useState(true);
  return (
    <div>
      <Button
        onClick={() => {
          setVarMi(false);
          setTimeout(() => {
            setAnahtar((a) => a + 1);
            setVarMi(true);
          }, 0);
        }}
      >
        Söküp yeniden kur
      </Button>
      {varMi && <Ekran key={anahtar} />}
    </div>
  );
}

const durum = () => screen.getByTestId("durum").textContent;
const kirlet = () =>
  fireEvent.change(screen.getByLabelText(/ad/i), { target: { value: "x" } });

/** İstemdeki onay düğmesi ("Çık"); istem `document.body`de ayrı bir köktedir. */
const cikDugmesi = () => {
  const hepsi = screen.getAllByRole("button", { name: "Çık" });
  return hepsi[hepsi.length - 1];
};

const YOLLAR: [string, () => void][] = [
  ["Vazgeç düğmesi", () => fireEvent.click(screen.getByRole("button", { name: /vazgeç/i }))],
  ["kapatma düğmesi", () => fireEvent.click(screen.getByText("Kapat"))],
  ["ESC", () => fireEvent.keyDown(document, { key: "Escape" })],
  ["dış tıklama", () => fireEvent.click(screen.getByLabelText("Pencereyi kapat"))],
];

describe("TB-72 · kirli formda 'Çık' pencereyi kapatır", () => {
  for (const [ad, kapat] of YOLLAR) {
    it(`${ad} → "Çık" → pencere KAPANIR (StrictMode)`, async () => {
      render(
        <StrictMode>
          <Ekran />
        </StrictMode>
      );
      fireEvent.click(screen.getByRole("button", { name: "Yeni" }));
      kirlet();

      kapat();
      expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
      // Onaydan ÖNCE pencere hâlâ açık olmalı — yoksa "Çık" hiçbir şey
      // kanıtlamazdı (pencere zaten kapanmış olurdu).
      expect(durum(), "onay sorulmadan kapandı").toBe("açık");

      fireEvent.click(cikDugmesi());

      await waitFor(() => expect(durum()).toBe("kapalı"));
      expect(
        screen.queryByRole("dialog", { name: /kayıt düzenle/i }),
        "düzenleme penceresi DOM'da kaldı"
      ).toBeNull();
      // Arka plan kilidi de kalkmalı: pencere kapanmadığı sürece kalkmıyordu.
      expect(document.body.style.overflow).toBe("");
    });
  }

  it('"Vazgeç" seçilince pencere AÇIK kalır (ters kutup)', async () => {
    // Yukarıdaki testler bekçi HER onayı kapatma sayıyor olsa da geçerdi.
    render(
      <StrictMode>
        <Ekran />
      </StrictMode>
    );
    fireEvent.click(screen.getByRole("button", { name: "Yeni" }));
    kirlet();
    fireEvent.click(screen.getByText("Kapat"));
    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();

    // İstemin KENDİ "Vazgeç"i (yüzeyinki değil) — sonuncusu istemdedir.
    const vazgecler = screen.getAllByRole("button", { name: /vazgeç/i });
    fireEvent.click(vazgecler[vazgecler.length - 1]);

    await waitFor(() =>
      expect(screen.queryByText("Kaydedilmemiş değişiklikler var")).toBeNull()
    );
    expect(durum(), "vazgeçildiği hâlde pencere kapandı").toBe("açık");
  });

  it("bileşen SÖKÜLÜP yeniden monte edilince de kapatabilir", async () => {
    // `StrictMode`tan bağımsız nöbet: mandal gerçek bir mount/unmount
    // döngüsünden sonra da inmiş olmalı.
    render(<YenidenMonte />);
    fireEvent.click(screen.getByRole("button", { name: "Söküp yeniden kur" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Yeni" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Yeni" }));
    kirlet();
    fireEvent.click(screen.getByText("Kapat"));
    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();

    fireEvent.click(cikDugmesi());
    await waitFor(() => expect(durum()).toBe("kapalı"));
  });
});
