/**
 * İP-A3a · Kirli form bekçisi — gerçek DOM davranış testleri.
 *
 * Bu dosya İMPLEMENTASYONDAN ÖNCE yazıldı ve kırmızı hâli
 * `docs/ip-a3a/kirmizi-matris.txt`'e kaydedildi.
 *
 * Kapsam bilinçli olarak MODAL KAPATMA + SEKME KAPATMA'dır. Uygulama içi rota
 * gezinmesi YOK: proje klasik `<BrowserRouter>` + `<Routes>` kullanıyor ve
 * `useBlocker` data router ister — bu mimaride hata fırlatır (İP-A0 ölçümü).
 * Router göçü ayrı ve ertelenmiş bir karardır.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { useKirliFormBekcisi } from "./kirliFormBekcisi";

/** Kirli formda gösterilen onay penceresinin metinleri (kullanıcıya çıkan hâl). */
const ONAY_BASLIK = "Kaydedilmemiş değişiklikler var";
const CIK = "Çık";
const VAZGEC = "Vazgeç";

function Form({
  onKapandi,
  sunucuHatasi = null,
  onGonderildi,
}: {
  onKapandi: () => void;
  sunucuHatasi?: string | null;
  onGonderildi?: () => void;
}) {
  const form = useForm<{ ad: string }>({ defaultValues: { ad: "" } });
  const bekci = useKirliFormBekcisi({ form, sunucuHatasi });

  return (
    <div>
      <input aria-label="Ad" {...form.register("ad")} />
      <button type="button" onClick={() => bekci.kapatmayiDene(onKapandi)}>
        Kapat
      </button>
      <button
        type="button"
        onClick={form.handleSubmit(() => {
          onGonderildi?.();
        })}
      >
        Kaydet
      </button>
      <button type="button" onClick={() => form.reset()}>
        Sıfırla
      </button>
      <span data-testid="korumali">{String(bekci.korumali)}</span>
    </div>
  );
}

/** Formu kapatılabilir kılan kabuk: kapanınca form gerçekten sökülür. */
function Kabuk(props: { sunucuHatasi?: string | null; onGonderildi?: () => void }) {
  const [acik, setAcik] = useState(true);
  return acik ? <Form onKapandi={() => setAcik(false)} {...props} /> : <p>Kapandı</p>;
}


/**
 * Onay penceresi Radix portalıyla `document.body`'ye açılır ve RTL'in kendi
 * temizliği onu SÖKMEZ. Açık kalan bir pencere sonraki teste sızar ve
 * "Found multiple elements" ile yalancı kırmızı üretir (bu gerçekten yaşandı).
 * Bu yüzden her testten sonra açık pencere gerçek yolundan kapatılır.
 */
async function acikOnayiKapat() {
  const iptal = screen
    .queryAllByText("Vazgeç")
    .find((n) => n.closest('[role="alertdialog"]'));
  if (!iptal) return;
  fireEvent.click(iptal);
  await waitFor(() =>
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  );
}

const yaz = (deger: string) =>
  fireEvent.change(screen.getByLabelText("Ad"), { target: { value: deger } });

describe("İP-A3a · kirli form bekçisi", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(acikOnayiKapat);

  it("M1 — kirli formda kapatma denenince onay sorulur", async () => {
    render(<Kabuk />);
    yaz("Ayşe");

    fireEvent.click(screen.getByText("Kapat"));

    expect(await screen.findByText(ONAY_BASLIK)).toBeTruthy();
    // Onay beklenirken form KAPANMAMIŞ olmalı.
    expect(screen.queryByText("Kapandı")).toBeNull();
  });

  it("M2 — temiz formda kapatma doğrudan geçer, onay sorulmaz", async () => {
    render(<Kabuk />);

    fireEvent.click(screen.getByText("Kapat"));

    await screen.findByText("Kapandı");
    expect(screen.queryByText(ONAY_BASLIK)).toBeNull();
  });

  it("M3 — 'vazgeç' seçilirse form AÇIK kalır ve veri durur", async () => {
    render(<Kabuk />);
    yaz("Ayşe");
    fireEvent.click(screen.getByText("Kapat"));

    fireEvent.click(await screen.findByText(VAZGEC));

    await waitFor(() => expect(screen.queryByText(ONAY_BASLIK)).toBeNull());
    expect(screen.queryByText("Kapandı")).toBeNull();
    // Veri duruyor: kullanıcı kaldığı yerden devam edebilmeli.
    expect((screen.getByLabelText("Ad") as HTMLInputElement).value).toBe("Ayşe");
  });

  it("M4 — 'çık' seçilirse form kapanır", async () => {
    render(<Kabuk />);
    yaz("Ayşe");
    fireEvent.click(screen.getByText("Kapat"));

    fireEvent.click(await screen.findByText(CIK));

    await screen.findByText("Kapandı");
  });

  it("M5 — başarılı gönderimden SONRA kapanışta onay sorulmaz", async () => {
    // Bu unutulursa hata üretmez; sadece kaydettikten sonra da soran sinir
    // bozucu bir davranış üretir. Kullanıcı "kaydettim" der, sistem "emin
    // misin?" diye sorar.
    const gonderildi = vi.fn();
    render(<Kabuk onGonderildi={gonderildi} />);
    yaz("Ayşe");

    fireEvent.click(screen.getByText("Kaydet"));
    await waitFor(() => expect(gonderildi).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId("korumali").textContent).toBe("false")
    );

    fireEvent.click(screen.getByText("Kapat"));

    await screen.findByText("Kapandı");
    expect(screen.queryByText(ONAY_BASLIK)).toBeNull();
  });

  it("M6 — beforeunload YALNIZ kirliyken kayıtlıdır", async () => {
    // Kalıcı bir `beforeunload` her yenilemede tarayıcı uyarısı üretir; temiz
    // formda kaydın kaldırılması sözleşmenin parçasıdır.
    const ekle = vi.spyOn(window, "addEventListener");
    const kaldir = vi.spyOn(window, "removeEventListener");

    render(<Kabuk />);
    expect(ekle.mock.calls.some(([t]) => t === "beforeunload")).toBe(false);

    yaz("Ayşe");
    await waitFor(() =>
      expect(ekle.mock.calls.some(([t]) => t === "beforeunload")).toBe(true)
    );

    fireEvent.click(screen.getByText("Sıfırla"));
    await waitFor(() =>
      expect(kaldir.mock.calls.some(([t]) => t === "beforeunload")).toBe(true)
    );
  });

  it("M7 — gönderim sunucuda başarısız olduysa form KİRLİ sayılmaya devam eder", async () => {
    // `react-hook-form`'un `isSubmitSuccessful`'ı yalnız "handler patlamadı"
    // demektir; mutasyon ağa çıkıp 500 dönerse de true olur. Tek başına
    // güvenilirse kullanıcı, kaydedilmemiş verisini uyarısız kaybeder.
    const gonderildi = vi.fn();
    const { rerender } = render(<Kabuk onGonderildi={gonderildi} />);
    yaz("Ayşe");

    fireEvent.click(screen.getByText("Kaydet"));
    await waitFor(() => expect(gonderildi).toHaveBeenCalled());

    rerender(<Kabuk sunucuHatasi="Sunucu hatası." onGonderildi={gonderildi} />);
    yaz("Ayşe Yılmaz");

    fireEvent.click(screen.getByText("Kapat"));

    expect(await screen.findByText(ONAY_BASLIK)).toBeTruthy();
  });
});
