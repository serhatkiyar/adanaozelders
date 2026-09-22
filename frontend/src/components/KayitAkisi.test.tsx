import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { KayitAkisi } from "./KayitAkisi";

/**
 * Kayıt akışı üç adımdır ve sıra ÜRÜN KARARIdır.
 *
 * Tek ekranda altı etkileşim vardı (ad, soyad, e-posta, parola, rol sekmesi,
 * onay kutusu) ve kullanıcı bunu "ben bile girmek istemiyorum" diye tarif etti.
 * İlk ekranın maliyeti düştükçe başlama oranı artar; bu testler ilk ekranın
 * yeniden şişmesini engeller.
 */

vi.mock("@/api/auth", async () => {
  const gercek = await vi.importActual<typeof import("@/api/auth")>("@/api/auth");
  return {
    ...gercek,
    register: vi.fn(),
    login: vi.fn(),
    fetchMe: vi.fn(),
    fetchOAuthProviders: vi.fn().mockResolvedValue({
      google: false,
      google_start_url: null,
    }),
  };
});

function kur(rol: "client" | "tutor" = "client") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <KayitAkisi baslangicRolu={rol} girisBaglantisi={<span>giris</span>} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("KayitAkisi — ilk ekran", () => {
  it("YALNIZ e-posta sorar; ad, soyad ve parola GÖRÜNMEZ", async () => {
    kur();
    expect(screen.getByLabelText(/E-posta/i)).toBeTruthy();
    // Asıl iddia bu: ilk ekranda başka alan YOK.
    expect(screen.queryByLabelText(/^Adınız/i)).toBeNull();
    expect(screen.queryByLabelText(/^Soyadınız/i)).toBeNull();
    expect(screen.queryByLabelText(/Parola/i)).toBeNull();
  });

  it("onay KUTUSU yok, cümle var", async () => {
    kur();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(/Kaydolarak/i)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /kullanım koşullarımızı/i })
    ).toBeTruthy();
  });

  it("rol SEKMESİ yok; rol geldiğin yoldan belli olur", async () => {
    // Sekme bir etkileşim daha demekti ve bilgi zaten bağlamda var: "Ders Ver"
    // düğmesi `?role=tutor` gönderiyor, diğer her yol üye kaydı.
    kur();
    expect(screen.queryByRole("button", { name: "Ders almak" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ders vermek" })).toBeNull();
  });

  it("başlık role göre değişir", async () => {
    kur();
    expect(screen.getByRole("heading", { name: "Üye kaydı" })).toBeTruthy();
  });

  it("öğretmen yolundan gelince başlık bunu söyler", async () => {
    kur("tutor");
    expect(screen.getByRole("heading", { name: "Öğretmen kaydı" })).toBeTruthy();
  });

  /* Rol, adres parametresinde yaşayan ve sonradan DEĞİŞTİRİLEMEYEN bir hesap
     özelliği. Başlık bir adımda rolü, sonraki adımlarda ilerlemeyi söylerken
     eğitmen adayı ikinci ekranda "Üyelik" görüyordu — yani başka bir rolün
     adını. Bu iki düğüm o bağlam kaybının geri gelmesini engeller. */
  it("ROL KAYBOLMAZ: sonraki adımlarda da başlık öğretmen kaydı der", async () => {
    const kullanici = userEvent.setup();
    kur("tutor");

    await kullanici.type(screen.getByLabelText(/E-posta/i), "ada@ornek.com");
    await kullanici.click(
      screen.getByRole("button", { name: "E-posta ile kaydol" })
    );

    expect(await screen.findByLabelText(/^Adınız/i)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Öğretmen kaydı" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Üye/ })).toBeNull();
  });

  it("üye kaydının ilk adımında altta 'Öğretmen misin?' satırı vardır", async () => {
    // Metin satırı ("Üye olarak kaydoluyorsun · Eğitmen olarak kaydol")
    // kalktı (16 Eyl 2026); eğitmen yolu giriş penceresiyle aynı satır.
    kur();
    expect(screen.queryByText(/olarak kaydoluyorsun/)).toBeNull();
    expect(screen.getByRole("button", { name: /Öğretmen misin\?/ })).toBeTruthy();
  });

  it("öğretmen kaydında 'Öğretmen misin?' satırı yoktur", async () => {
    kur("tutor");
    expect(screen.queryByRole("button", { name: /Öğretmen misin\?/ })).toBeNull();
  });

  it("ilk adımın düğmesi ne yapacağını söyler", async () => {
    // "Devam et" hangi yola girdiğini söylemiyordu; kullanıcı düğmeye basmadan
    // ne olacağını bilmeli.
    kur();
    expect(
      screen.getByRole("button", { name: "E-posta ile kaydol" })
    ).toBeTruthy();
  });

  it("ilk ekranda geri düğmesi YOKTUR", async () => {
    kur();
    expect(
      screen.queryByRole("button", { name: /Önceki adıma dön/i })
    ).toBeNull();
  });
});

describe("KayitAkisi — adımlar arası geçiş", () => {
  it("e-posta → ad/soyad → parola sırasıyla ilerler", async () => {
    const kullanici = userEvent.setup();
    kur();

    await kullanici.type(screen.getByLabelText(/E-posta/i), "ada@ornek.com");
    await kullanici.click(
      screen.getByRole("button", { name: "E-posta ile kaydol" })
    );

    // 2. adim
    expect(await screen.findByLabelText(/^Adınız/i)).toBeTruthy();
    expect(screen.getByLabelText(/^Soyadınız/i)).toBeTruthy();
    expect(screen.queryByLabelText(/E-posta/i)).toBeNull();

    await kullanici.type(screen.getByLabelText(/^Adınız/i), "Ada");
    await kullanici.type(screen.getByLabelText(/^Soyadınız/i), "Deneme");
    await kullanici.click(screen.getByRole("button", { name: "Devam et" }));

    // 3. adim
    expect(await screen.findByLabelText(/Parola/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kayıt Ol" })).toBeTruthy();
  });

  it("geri düğmesi önceki adıma döner ve GİRİLEN VERİYİ korur", async () => {
    const kullanici = userEvent.setup();
    kur();

    await kullanici.type(screen.getByLabelText(/E-posta/i), "ada@ornek.com");
    await kullanici.click(
      screen.getByRole("button", { name: "E-posta ile kaydol" })
    );
    await kullanici.click(
      await screen.findByRole("button", { name: /Önceki adıma dön/i })
    );

    // Veri kaybolursa kullanici e-postasini yeniden yazmak zorunda kalir ve
    // "geri" dugmesi bir kolaylik olmaktan cikip cezaya doner.
    const alan = (await screen.findByLabelText(/E-posta/i)) as HTMLInputElement;
    expect(alan.value).toBe("ada@ornek.com");
  });

  it("Google düğmesi YALNIZ ilk adımda görünür", async () => {
    // Sağlayıcı kapalı olduğu için düğme hiç çizilmez; burada ölçülen, ayırıcı
    // ve yasal cümlenin sonraki adımlarda ekranı kalabalıklaştırmaması.
    const kullanici = userEvent.setup();
    kur();
    expect(screen.getByText(/Kaydolarak/i)).toBeTruthy();

    await kullanici.type(screen.getByLabelText(/E-posta/i), "ada@ornek.com");
    await kullanici.click(
      screen.getByRole("button", { name: "E-posta ile kaydol" })
    );

    expect(await screen.findByLabelText(/^Adınız/i)).toBeTruthy();
    expect(screen.queryByText(/Kaydolarak/i)).toBeNull();
  });
});
