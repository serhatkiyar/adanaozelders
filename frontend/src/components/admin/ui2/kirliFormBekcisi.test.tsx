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
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { HATA_TAKIBI_YOK, useKirliFormBekcisi } from "./kirliFormBekcisi";

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
  return acik ? (
    <>
      <Form onKapandi={() => setAcik(false)} {...props} />
      {/* Ebeveynin KENDİ kapatması: bekçiden geçmeyen yol (bilinen sınır). */}
      <button type="button" onClick={() => setAcik(false)}>
        Ebeveyn kapat
      </button>
    </>
  ) : (
    <p>Kapandı</p>
  );
}


/**
 * Onay penceresi Radix portalıyla `document.body`'ye açılır ve RTL'in kendi
 * temizliği onu SÖKMEZ. Açık kalan bir pencere sonraki teste sızar ve
 * "Found multiple elements" ile yalancı kırmızı üretir (bu gerçekten yaşandı).
 * Bu yüzden her testten sonra açık pencere gerçek yolundan kapatılır.
 *
 * ## İP-A3c · P2-7: temizlik metne bağlanamaz
 *
 * Eski sürüm iptal düğmesini `"Vazgeç"` METNİYLE arıyor ve bulamazsa
 * SESSİZCE hiçbir şey yapmadan dönüyordu. O metin `promptTr.cancelText`'ten
 * gelen bir YAPILANDIRMA değeridir: biri onu "İptal" yaparsa temizlik iki
 * dosyada birden sessizce ölür ve sızıntı — bu kez yalancı yeşil üretebilecek
 * bir DOM artığı olarak — geri döner.
 *
 * Artık temizlik (a) role bağlıdır, (b) pencerenin GERÇEKTEN kapandığını iddia
 * eder. Kapanmazsa test kırılır; "bulamadım, geçiyorum" demez.
 */
async function acikOnayiKapat() {
  const pencere = document.querySelector('[role="alertdialog"]');
  if (!pencere) return;
  // Medusa `Prompt.Cancel`ı `Prompt.Action`tan ÖNCE render eder; metnine değil
  // sırasına güveniyoruz. Yanlış düğmeye basılsa bile aşağıdaki iddia tutar:
  // her iki düğme de pencereyi kapatır, kapanmıyorsa temizlik bozuktur.
  const dugmeler = within(pencere as HTMLElement).getAllByRole("button");
  expect(dugmeler.length).toBeGreaterThan(0);
  fireEvent.click(dugmeler[0]);
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

/* ═══════════════════════════════════════════════════════════════════════════
 * İP-A3c · denetimin bekçide bulduğu üç açık.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("İP-A3c · bekçinin açıkları", () => {
  afterEach(acikOnayiKapat);

  it("M8 — onay penceresi açıkken bileşen giderse ÖKSÜZ kök kalmaz", async () => {
    // Denetim P2-1 (kanıt B2: unmount sonrası alertdialog sayısı = 1).
    // Üretim yolu var: ebeveyn `kind`'ı null yapar, WS push'u gelir, query
    // invalidate olur, rota değişir. Radix modal arkadaki sayfayı
    // `pointer-events` ile kilitlediği için ekran KULLANILAMAZ hâle gelir.
    const { unmount } = render(<Kabuk />);
    yaz("Ayşe");
    fireEvent.click(screen.getByText("Kapat"));
    await screen.findByText(ONAY_BASLIK);

    unmount();

    await waitFor(() =>
      expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    );
    // Radix'in kilidi de geri verilmiş olmalı; aksi hâlde sayfa tıklanamaz.
    expect(document.body.style.pointerEvents).not.toBe("none");
  });

  it("M9 — başarılı gönderimden SONRA yeniden yazılan veri yine korunur", async () => {
    // Denetim P2-2 (kanıt B4b). `isSubmitSuccessful` bir sonraki
    // handleSubmit/reset'e kadar true kalır; "kaydet ve açık kal" formlarında
    // kullanıcının sonradan yazdığı her şey korumasızdı.
    const gonderildi = vi.fn();
    render(<Kabuk onGonderildi={gonderildi} />);
    yaz("Ayşe");

    fireEvent.click(screen.getByText("Kaydet"));
    await waitFor(() => expect(gonderildi).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId("korumali").textContent).toBe("false")
    );

    // Pencere kapanmadı, kullanıcı yazmaya devam etti.
    yaz("Ayşe Yılmaz");

    await waitFor(() =>
      expect(screen.getByTestId("korumali").textContent).toBe("true")
    );
    fireEvent.click(screen.getByText("Kapat"));
    expect(await screen.findByText(ONAY_BASLIK)).toBeTruthy();
  });

  it("M9b — TERS PROVA: gönderimden sonra veri DEĞİŞMEDİYSE koruma geri gelmez", async () => {
    // M9 tek başına, bekçi "gönderimden sonra hep koru" dese de geçerdi —
    // yani M5'i (kaydettikten sonra sormaz) sessizce iptal eden bir uygulama
    // da M9'u geçerdi. Bu test o yalancı yeşili kapatır.
    const gonderildi = vi.fn();
    render(<Kabuk onGonderildi={gonderildi} />);
    yaz("Ayşe");
    fireEvent.click(screen.getByText("Kaydet"));
    await waitFor(() => expect(gonderildi).toHaveBeenCalled());

    // Aynı değeri tekrar yazmak veriyi DEĞİŞTİRMEZ.
    yaz("Ayşe");

    await waitFor(() =>
      expect(screen.getByTestId("korumali").textContent).toBe("false")
    );
  });

  it("M10 — HATA_TAKIBI_YOK, 'hata var' sayılmaz (susturucu değil, niyet beyanı)", () => {
    // Sabit truthy bir dizedir; naif bir uygulama onu sunucu hatası sanar ve
    // form ASLA kaydedilmiş sayılmaz (M5 bozulur).
    function TakipsizForm() {
      const form = useForm<{ ad: string }>({ defaultValues: { ad: "" } });
      const bekci = useKirliFormBekcisi({
        form,
        sunucuHatasi: HATA_TAKIBI_YOK,
      });
      return <span data-testid="korumali">{String(bekci.korumali)}</span>;
    }
    render(<TakipsizForm />);
    expect(screen.getByTestId("korumali").textContent).toBe("false");
  });

  it("BİLİNEN SINIR — ebeveyn kendi kapatırsa onay SORULMAZ", async () => {
    // Denetim P2-9. Bu bir hata değil, BELGELENMİŞ sınırdır: bir hook
    // ebeveynin setState'ini engelleyemez. Test o sınırı sabitler — sessizce
    // kapanıp "bekçi her yolu tutuyor" izlenimi vermesin diye.
    // Gerekçe ve ne yapılması gerektiği: kirliFormBekcisi.tsx başlığı.
    render(<Kabuk />);
    yaz("Ayşe");

    fireEvent.click(screen.getByText("Ebeveyn kapat"));

    await screen.findByText("Kapandı");
    expect(screen.queryByText(ONAY_BASLIK)).toBeNull();
  });
});
