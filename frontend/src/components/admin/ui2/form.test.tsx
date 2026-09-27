/**
 * İP-A2 · `Form.*` sözleşmesi — gerçek DOM davranış testleri.
 *
 * Bu dosya implementasyondan ÖNCE yazıldı ve kırmızı olduğu gösterildi
 * (`docs/arsiv/ip-a/ip-a2-rapor.md` → Görev 3). Her test, katmanın bir SÖZLEŞME maddesini
 * kullanıcının gördüğü sonuçtan doğrular: etiket bağı, `aria-invalid`,
 * `aria-describedby`, `role="alert"`, tek slot ve `id` çakışmazlığı.
 *
 * Kaynak taraması YOK: hepsi `@testing-library` ile render edilip DOM'dan
 * okunur (kök CLAUDE.md §B).
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { Form } from "./form";

const sema = z.object({
  ad: z.string().min(1, "Ad zorunlu."),
  not: z.string().optional(),
});

type Degerler = z.infer<typeof sema>;

function TekAlanliForm({
  hint = "Kimliğinizdeki ad.",
  onGonder,
}: {
  hint?: string | null;
  onGonder?: (d: Degerler) => void;
}) {
  const form = useForm<Degerler>({
    resolver: zodResolver(sema),
    defaultValues: { ad: "", not: "" },
    mode: "onChange",
  });
  return (
    <form onSubmit={form.handleSubmit((d) => onGonder?.(d))}>
      <Form.Field
        control={form.control}
        name="ad"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Ad</Form.Label>
            <Form.Control>
              <input {...field} />
            </Form.Control>
            {hint === null ? null : <Form.Hint>{hint}</Form.Hint>}
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
      <button type="submit">Kaydet</button>
    </form>
  );
}

function IkiAlanliForm() {
  const form = useForm<Degerler>({
    resolver: zodResolver(sema),
    defaultValues: { ad: "", not: "" },
  });
  return (
    <form>
      <Form.Field
        control={form.control}
        name="ad"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Ad</Form.Label>
            <Form.Control>
              <input {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
      <Form.Field
        control={form.control}
        name="not"
        render={({ field }) => (
          <Form.Item>
            <Form.Label optional>Not</Form.Label>
            <Form.Control>
              <input {...field} value={field.value ?? ""} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
    </form>
  );
}

describe("İP-A2 · Form sözleşmesi", () => {
  it("M1 — Label/kontrol bağı otomatik kurulur: getByLabelText kontrole ulaşır", () => {
    render(<TekAlanliForm />);
    const kontrol = screen.getByLabelText("Ad");
    expect(kontrol.tagName).toBe("INPUT");

    // Bağ gerçekten htmlFor/id üzerinden: elle yazılmış bir id YOK.
    const etiket = screen.getByText("Ad").closest("label")!;
    expect(etiket.getAttribute("for")).toBe(kontrol.getAttribute("id"));
    expect(kontrol.getAttribute("id")).toBeTruthy();
  });

  it("M2 — alan geçersizken kontrolde aria-invalid=true var", async () => {
    render(<TekAlanliForm />);
    const kontrol = screen.getByLabelText("Ad");
    // Geçerli başlangıç: bayrak asılı DEĞİL.
    expect(kontrol.getAttribute("aria-invalid")).not.toBe("true");

    fireEvent.change(kontrol, { target: { value: "x" } });
    fireEvent.change(kontrol, { target: { value: "" } });

    await waitFor(() =>
      expect(screen.getByLabelText("Ad").getAttribute("aria-invalid")).toBe(
        "true"
      )
    );
  });

  it("M3 — aria-describedby hata varken hatayı, yokken hint'i gösterir", async () => {
    render(<TekAlanliForm />);
    const kontrol = screen.getByLabelText("Ad");

    const hintId = kontrol.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId!)?.textContent).toContain(
      "Kimliğinizdeki ad."
    );

    fireEvent.change(kontrol, { target: { value: "x" } });
    fireEvent.change(kontrol, { target: { value: "" } });

    await waitFor(() => {
      const hataId = screen
        .getByLabelText("Ad")
        .getAttribute("aria-describedby");
      expect(hataId).toBeTruthy();
      expect(hataId).not.toBe(hintId);
      expect(document.getElementById(hataId!)?.textContent).toContain(
        "Ad zorunlu."
      );
    });
  });

  it("M4 — hata mesajında role=alert var", async () => {
    render(<TekAlanliForm />);
    const kontrol = screen.getByLabelText("Ad");
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.change(kontrol, { target: { value: "x" } });
    fireEvent.change(kontrol, { target: { value: "" } });

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Ad zorunlu.")
    );
  });

  it("M5 — tek slot: hint→hata geçişinde kabın kutusu değişmez", async () => {
    // jsdom düzen hesaplamaz; bu yüzden test YÜKSEKLİĞİ değil, yüksekliği
    // belirleyen MEKANİZMAYI doğrular: slot her iki durumda da AYNI DOM
    // düğümüdür (mount/unmount yok), sınıf listesi birebir aynıdır ve içinde
    // her an en fazla bir mesaj vardır. Gerçek piksel ölçümü tarayıcıda
    // yapıldı — `docs/arsiv/ip-a/ip-a2-rapor.md` → Görev 4 "slot piksel ölçümü".
    const { container } = render(<TekAlanliForm />);
    const slotOnce = container.querySelector("[data-form-slot]")!;
    expect(slotOnce).toBeTruthy();
    const sinifOnce = slotOnce.className;
    expect(slotOnce.children).toHaveLength(1);

    const kontrol = screen.getByLabelText("Ad");
    fireEvent.change(kontrol, { target: { value: "x" } });
    fireEvent.change(kontrol, { target: { value: "" } });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    const slotSonra = container.querySelector("[data-form-slot]")!;
    // AYNI düğüm: React bu kabı yeniden oluşturmadı, yalnız içeriğini değişti.
    expect(slotSonra).toBe(slotOnce);
    expect(slotSonra.className).toBe(sinifOnce);
    expect(slotSonra.children).toHaveLength(1);
    // Slot yükseklik rezervi sınıfla verilir; kaldırılırsa boş alan çöker.
    expect(sinifOnce).toMatch(/min-h-/);
  });

  it("M5b — hint hiç yokken bile slot durur (hatanın doğuşu yerleşimi itmez)", async () => {
    const { container } = render(<TekAlanliForm hint={null} />);
    const slot = container.querySelector("[data-form-slot]");
    expect(slot).toBeTruthy();
    expect(slot!.className).toMatch(/min-h-/);
  });

  it("M6 — aynı formdaki iki alanın id'leri çakışmaz", () => {
    render(<IkiAlanliForm />);
    const ad = screen.getByLabelText("Ad");
    const not = screen.getByLabelText(/^Not/);
    expect(ad.id).toBeTruthy();
    expect(not.id).toBeTruthy();
    expect(ad.id).not.toBe(not.id);
  });

  it("zorunluluk tersten işaretlenir: yıldız yok, isteğe bağlıya '(opsiyonel)'", () => {
    render(<IkiAlanliForm />);
    expect(screen.getByText(/opsiyonel/i)).toBeTruthy();
    expect(document.body.textContent).not.toContain("*");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * İP-A3c · sözleşmenin YANLIŞ kullanımı görünür mü?
 *
 * Neden burada: nöbetçi sayacı bir kontrolü, JSX atalarında `Form.Control`
 * varsa "adlandırılmış" sayar. Bu bir VEKİLDİR ve bugüne kadar **hiç
 * doğrulanmamıştı** — bağımsız denetim (P1-1) vekilin en az üç yazımda yanlış
 * olduğunu çalışma zamanında kanıtladı. Aşağıdaki ilk test vekilin kendisini
 * doğrular; kalan üçü, vekili yanlışlayan yazımların artık SESSİZ olmadığını
 * doğrular. İkisi birlikte olmadan sayacın "Form.Control içindeyse affet"
 * kuralı kanıtsızdır.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Konsola düşen `console.error` çağrılarını yakalar (ve gürültüyü susturur). */
function konsolYakala() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("İP-A3c · Form.Control sessiz başarısız olamaz", () => {
  afterEach(() => vi.restoreAllMocks());

  it("K1 — VEKİLİN KANITI: Form.Control içindeki kontrol getByLabelText ile bulunur", () => {
    // Sayacın tüm `Form.Control` dalı bu tek cümleye yaslanıyor. Cümle bugüne
    // kadar hiçbir testte söylenmemişti.
    render(<TekAlanliForm />);

    const kontrol = screen.getByLabelText("Ad") as HTMLInputElement;
    expect(kontrol.tagName).toBe("INPUT");
    // `id` gerçekten DOM'a indi: belgeden aynı düğüm çözülüyor.
    expect(document.getElementById(kontrol.id)).toBe(kontrol);
    // Etiket ↔ kontrol bağı tarayıcının kendi çözümüyle de kurulu.
    const etiket = screen.getByText("Ad").closest("label") as HTMLLabelElement;
    expect(etiket.control).toBe(kontrol);
    expect(kontrol.labels?.length).toBe(1);
  });

  it("K2 — kör nokta 1: Form.Item YOKKEN kullanım geliştirmede patlar", () => {
    konsolYakala(); // React, atılan hatayı ayrıca konsola basar.
    expect(() =>
      render(
        <Form.Control>
          <input />
        </Form.Control>
      )
    ).toThrow(/Form\.Item dışında/);
  });

  it("K2b — Form.Label da Form.Item olmadan patlar", () => {
    konsolYakala();
    expect(() => render(<Form.Label>Ad</Form.Label>)).toThrow(
      /Form\.Item dışında/
    );
  });

  it("K3 — kör nokta 2: Form.Control çocuğu FRAGMENT ise geliştirmede patlar", () => {
    // Denetimin en olası bulduğu yazım: "input + birim eki" (₺, adet, %).
    konsolYakala();
    expect(() =>
      render(
        <Form.Item>
          <Form.Control>
            <>
              <input />
              <span>TL</span>
            </>
          </Form.Control>
        </Form.Item>
      )
    ).toThrow(/Fragment olamaz/);
  });

  it("K4 — kör nokta 3: prop iletmeyen bileşen ÇALIŞMA ZAMANINDA yakalanır", () => {
    // Bu yazım statik olarak anlaşılamaz: `Form.Control` doğru, çocuk tek,
    // `Form.Item` var — ama `id` DOM'a inmiyor. Ölçüm mount sonrası yapılır.
    const IletmeyenGirdi = () => <input className="input" />;
    const hata = konsolYakala();

    render(
      <Form.Item>
        <Form.Label>Ad</Form.Label>
        <Form.Control>
          <IletmeyenGirdi />
        </Form.Control>
      </Form.Item>
    );

    // Kontrol GERÇEKTEN adsız: vekilin yanlış olduğu bu satırla sabitlenir.
    expect(screen.queryByLabelText("Ad")).toBeNull();
    // Ve artık sessiz değil: bileşen adı ve alan bilgisi konsola yazıldı.
    const mesajlar = hata.mock.calls.map((c) => String(c[0])).join(" | ");
    expect(mesajlar).toMatch(/IletmeyenGirdi/);
    expect(mesajlar).toMatch(/id'yi DOM'a indirmedi/);
  });

  it("K5 — çocuğun kendi aria-describedby'si EZİLMEZ, birleşir", () => {
    // Denetim P2-3: karakter sayacı / para birimi açıklaması gibi harici
    // yardım düğümüne bağlı kontroller göçte bağlarını kaybediyordu.
    render(
      <Form.Item>
        <Form.Label>Tutar</Form.Label>
        <Form.Control>
          <input aria-describedby="para-birimi" />
        </Form.Control>
        <Form.Hint>Yardım.</Form.Hint>
      </Form.Item>
    );

    const kontrol = screen.getByLabelText("Tutar");
    const tanim = kontrol.getAttribute("aria-describedby") ?? "";
    expect(tanim.split(" ")).toContain("para-birimi");
    // Slotun kendi düğümü de duruyor (ikisi birden).
    expect(tanim.split(" ").length).toBe(2);
  });

  it("K5b — çocuğun kendi id'si sessizce ezilmez, bildirilir", () => {
    const hata = konsolYakala();
    render(
      <Form.Item>
        <Form.Label>Ad</Form.Label>
        <Form.Control>
          <input id="benim-id" />
        </Form.Control>
      </Form.Item>
    );
    const mesajlar = hata.mock.calls.map((c) => String(c[0])).join(" | ");
    expect(mesajlar).toMatch(/benim-id/);
  });

  it("K6 — Fragment İÇİNDEKİ Hint slota girer ve aria-describedby kurulur", () => {
    // Denetim P2-4/D2b: Fragment içindeki Hint üst bölüme düşüyor, slot boş
    // kalıyor ve `hintVar` false olduğu için bağ HİÇ kurulmuyordu.
    const { container } = render(
      <Form.Item>
        <Form.Label>Ad</Form.Label>
        <Form.Control>
          <input />
        </Form.Control>
        <>
          <Form.Hint>Sarmalanmış ipucu.</Form.Hint>
        </>
      </Form.Item>
    );

    const slot = container.querySelector("[data-form-slot]")!;
    expect(slot.textContent).toContain("Sarmalanmış ipucu.");
    const tanim = screen.getByLabelText("Ad").getAttribute("aria-describedby");
    expect(tanim).toBeTruthy();
    expect(document.getElementById(tanim!)?.textContent).toContain(
      "Sarmalanmış ipucu."
    );
  });

  it("K7 — <div> içine gömülü Hint sessizce kaybolmaz: geliştirmede patlar", () => {
    // Fragment'tan farklı: bir <div>ün DOM karşılığı VAR, çocuğu slota taşımak
    // kullanıcının yazdığı düzeni sessizce bozardı. Doğru davranış, taşımak
    // değil, geliştiriciye söylemektir.
    konsolYakala();
    expect(() =>
      render(
        <Form.Item>
          <Form.Control>
            <input />
          </Form.Control>
          <div>
            <Form.Hint>Gömülü ipucu.</Form.Hint>
          </div>
        </Form.Item>
      )
    ).toThrow(/gömülmüş/);
  });
});
