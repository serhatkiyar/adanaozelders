/**
 * İP-B1 · Görev 4 — panel kabuğunun KIRMIZI MATRİSİ.
 *
 * Bu dosya kabuk kodundan ÖNCE yazıldı ve önce kırmızı gösterildi
 * (`docs/ip-b1-rapor.md` · Görev 4 · kırmızı matris tablosu). Amacı kabuğun
 * "render oluyor" olmasını değil, **davranışlarını** tutmaktır:
 *
 *   - gezinme gerçekten `<nav>` mü, etkin öğe `aria-current` taşıyor mu
 *   - katlama düğmesinin ADI var mı, katlama gerçekten oluyor mu, durum
 *     kalıcı mı (yeniden mount)
 *   - katlı hâlde erişilebilir AD kayboluyor mu (ikon-only tuzağı)
 *   - tema anahtarı üç seçenek mi, seçim gerçekten store'a yazılıyor mu
 *   - `Ctrl+K` gerçekten komut penceresini açıyor mu, pencere etiketli mi
 *   - `G` + harf gerçekten gezindiriyor mu — ve GİRDİ ODAKTAYKEN gezinmiyor mu
 *   - üst başlıkta TEK `<h1>` var mı ve doğru sayfayı mı adlandırıyor
 *   - mobil çekmece hâlâ `role="dialog"` + `aria-modal` mi
 *
 * Hiçbiri kaynak taraması değildir; hepsi gerçek DOM üzerinde ölçülür
 * (kök CLAUDE.md §B).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import AdminLayout from "./AdminLayout";
import { KABUK_DEPO_ANAHTARI, usePanelKabugu } from "./panelKabuguDurumu";
import { apiClient } from "@/api/axios";
import { useAuthStore } from "@/store/authStore";
import { useThemeStore } from "@/store/themeStore";
import { TAM_ADMIN_IZINLERI } from "@/test-utils/adminIzinleri";
import type { AxiosRequestConfig } from "axios";

function kabuk(yol = "/yonetim/magaza/urunler") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[yol]}>
        <Routes>
          <Route path="/yonetim" element={<AdminLayout />}>
            <Route index element={<p>genel bakış içeriği</p>} />
            <Route path="kullanicilar" element={<p>kullanıcı içeriği</p>} />
            <Route path="magaza/urunler" element={<p>ürün içeriği</p>} />
            <Route path="envanter" element={<p>envanter içeriği</p>} />
            <Route path="ayarlar" element={<p>ayar içeriği</p>} />
            <Route path="*" element={<Outlet />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) =>
    ({ data: [], status: 200, statusText: "OK", headers: {}, config }) as never;
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: {
      id: 1,
      role_id: 1,
      email: "yonetici@example.com",
      full_name: "Test Yönetici",
      admin_permissions: [...TAM_ADMIN_IZINLERI],
    } as never,
  });
  useThemeStore.setState({ preference: "light", theme: "light" });
  // ── Kalıcı store BELLEKTE de sıfırlanır (kök CLAUDE.md §G) ──
  //
  // `localStorage`ı silmek YETMEZ: `persist` yalnız modül ilk yüklendiğinde
  // hidrasyon yapar, sonrasında durum bellekte yaşar. Bu satır olmadan
  // "katlanınca daralır" testi katlı durumu SONRAKİ testlere bırakıyordu ve
  // karışık sırada (`--sequence.shuffle --sequence.seed=555`) "aria-current
  // taşır" testi kırılıyordu: rail katlıyken etiket metni DOM'da yok, yani
  // `textContent` boş. Kusur üretimde değil TESTTEYDİ — ve karışık koşum onu
  // yakaladı.
  usePanelKabugu.setState({ katli: false });
  window.localStorage.removeItem(KABUK_DEPO_ANAHTARI);
  document.documentElement.classList.remove("dark");
});

describe("İP-B1 · kabuk · gezinme", () => {
  it("gezinme bir <nav>tır ve adı vardır", () => {
    render(kabuk());
    expect(screen.getAllByRole("navigation", { name: /yönetim menüsü/i }).length).toBeGreaterThan(0);
  });

  it("bulunulan sayfa aria-current='page' taşır", () => {
    render(kabuk("/yonetim/magaza/urunler"));
    const etkin = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(etkin.map((a) => a.textContent?.trim())).toContain("Mağaza");
  });

  it("aynı anda YALNIZ BİR gezinme öğesi etkindir", () => {
    // Gerçek tarayıcı turunda yakalanan hata: `/yonetim/magaza/*` altındayken
    // hem "Mağaza" hem "Hakedişler" etkin görünüyordu, çünkü etkinlik ROTAYA
    // değil İKONA bakıyordu ve ikisi de `store` ikonunu taşıyor. `aria-current`
    // doğruydu (yalnız Mağaza'daydı) — yani hata SALT GÖRSELDİ ve mevcut
    // erişilebilirlik iddialarının hiçbiri onu göremezdi.
    render(kabuk("/yonetim/magaza/urunler"));
    const rail = screen.getByTestId("panel-rail");
    const etkinler = Array.from(rail.querySelectorAll('[data-etkin="true"]'));
    expect(etkinler).toHaveLength(1);
    expect(etkinler[0].closest("a")?.textContent).toContain("Mağaza");
  });

  it("gezinme üç bölgelidir: arama üstte, Ayarlar ve profil ALTTA", () => {
    render(kabuk());
    const rail = screen.getByTestId("panel-rail");
    const ust = within(rail).getByTestId("rail-ust");
    const alt = within(rail).getByTestId("rail-alt");
    // Arama tetikleyicisi üst bölgede.
    expect(within(ust).getByRole("button", { name: /ara/i })).toBeTruthy();
    // Ayarlar ve profil alt bölgede — gezinme gruplarının içinde DEĞİL.
    expect(within(alt).getByRole("link", { name: /ayarlar/i })).toBeTruthy();
    expect(within(alt).getByRole("button", { name: /hesap menüsü/i })).toBeTruthy();
    const orta = within(rail).getByTestId("rail-orta");
    expect(within(orta).queryByRole("link", { name: /^ayarlar$/i })).toBeNull();
  });
});

describe("İP-B1 · kabuk · katlama", () => {
  it("katlama düğmesinin erişilebilir adı vardır ve durumu bildirir", () => {
    render(kabuk());
    const dugme = screen.getByRole("button", { name: /menüyü katla/i });
    expect(dugme.getAttribute("aria-pressed")).toBe("false");
  });

  it("katlanınca rail daralır ve tercih DEPOYA yazılır", () => {
    render(kabuk());
    fireEvent.click(screen.getByRole("button", { name: /menüyü katla/i }));
    expect(screen.getByTestId("panel-rail").getAttribute("data-katli")).toBe("true");
    // Yazma tarafı: depodaki değer okunup DOĞRULANIR. Eskiden burada
    // `toContain("true")` vardı ve `{"state":{"katli":false},"version":0}`
    // gibi bir gövdeyle de geçebilirdi — anahtar adı "katli" ve değer ayrı
    // ayrı aranmalı.
    const kayit = JSON.parse(window.localStorage.getItem(KABUK_DEPO_ANAHTARI)!);
    expect(kayit.state.katli).toBe(true);
  });

  it("kaydedilen tercih yeniden yüklemede GERİ OKUNUR", async () => {
    // Okuma tarafı ayrı bir testtir ve `unmount()+render()` ile ölçülemez:
    // `persist` hidrasyonu modül ilk yüklendiğinde bir kez olur, bileşen
    // yeniden mount edilince tekrarlanmaz. Bu yüzden gerçek sayfa yenilemesi
    // `rehydrate()` ile simüle edilir — aksi hâlde test yalnız bellekteki
    // değeri okur ve KALICILIĞI hiç kanıtlamaz.
    // SIRA ÖNEMLİ: `setState` kalıcı store'da depoya YAZAR. Önce depoyu
    // doldurup sonra `setState` çağırmak, az önce yazılan kaydı `false` ile
    // ezerdi ve test kendi kurduğu fixture'ı ölçerdi (ölçüldü: RAW
    // `{"state":{"katli":false}}`). Önce belleği sıfırla, SONRA depoyu kur.
    usePanelKabugu.setState({ katli: false });
    window.localStorage.setItem(
      KABUK_DEPO_ANAHTARI,
      JSON.stringify({ state: { katli: true }, version: 0 })
    );
    await usePanelKabugu.persist.rehydrate();
    render(kabuk());
    expect(screen.getByTestId("panel-rail").getAttribute("data-katli")).toBe("true");
  });

  it("katlı hâlde gezinme öğelerinin erişilebilir ADI kaybolmaz", () => {
    usePanelKabugu.setState({ katli: true });
    render(kabuk());
    expect(screen.getByTestId("panel-rail").getAttribute("data-katli")).toBe("true");
    // İkon-only hâlde ad `aria-label`tan gelmeli.
    expect(screen.getByRole("link", { name: "Mağaza" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Envanter" })).toBeTruthy();
  });
});

describe("İP-B1 · kabuk · tema", () => {
  it("profil menüsü üç temalı seçenek sunar ve seçim store'a yazılır", () => {
    render(kabuk());
    fireEvent.click(screen.getByRole("button", { name: /hesap menüsü/i }));
    const grup = screen.getByRole("group", { name: /tema/i });
    const secenekler = within(grup)
      .getAllByRole("radio")
      .map((r) => r.getAttribute("value"));
    expect(secenekler).toEqual(["light", "dark", "system"]);

    fireEvent.click(within(grup).getByRole("radio", { name: /koyu/i }));
    expect(useThemeStore.getState().preference).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});

describe("İP-B1 · kabuk · komut penceresi", () => {
  it("Ctrl+K komut penceresini açar ve pencere ETİKETLİDİR", () => {
    render(kabuk());
    expect(screen.queryByRole("dialog", { name: /komut penceresi/i })).toBeNull();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const pencere = screen.getByRole("dialog", { name: /komut penceresi/i });
    expect(pencere.getAttribute("aria-modal")).toBe("true");
    expect(within(pencere).getByRole("combobox", { name: /ara/i })).toBeTruthy();
  });

  it("yazılan metin listeyi süzer ve Enter o alana gezindirir", () => {
    render(kabuk());
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const pencere = screen.getByRole("dialog", { name: /komut penceresi/i });
    const girdi = within(pencere).getByRole("combobox", { name: /ara/i });
    fireEvent.change(girdi, { target: { value: "kullanıc" } });
    const secenekler = within(pencere).getAllByRole("option");
    expect(secenekler).toHaveLength(1);
    expect(secenekler[0].textContent).toMatch(/kullanıcılar/i);

    fireEvent.keyDown(girdi, { key: "Enter" });
    expect(screen.getByText("kullanıcı içeriği")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /komut penceresi/i })).toBeNull();
  });

  it("Escape komut penceresini kapatır", () => {
    render(kabuk());
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const girdi = screen.getByRole("combobox", { name: /ara/i });
    fireEvent.keyDown(girdi, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /komut penceresi/i })).toBeNull();
  });
});

describe("İP-B1 · kabuk · klavye kısayolları", () => {
  it("G sonra K kullanıcılar alanına gider", () => {
    render(kabuk());
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "k" });
    expect(screen.getByText("kullanıcı içeriği")).toBeTruthy();
  });

  it("GİRDİ ODAKTAYKEN kısayol dizisi başlamaz", () => {
    render(kabuk());
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const girdi = screen.getByRole("combobox", { name: /ara/i });
    girdi.focus();
    fireEvent.keyDown(girdi, { key: "g" });
    fireEvent.keyDown(girdi, { key: "k" });
    // Hâlâ ürün ekranındayız; "g" ve "k" arama metnine yazılabilirdi ama
    // gezinmeyi TETİKLEMEMELİ.
    expect(screen.queryByText("kullanıcı içeriği")).toBeNull();
  });
});

describe("İP-B1 · kabuk · üst başlık", () => {
  it("sayfa başına TEK <h1> vardır ve bulunulan alanı adlandırır", () => {
    render(kabuk("/yonetim/envanter"));
    const basliklar = screen.getAllByRole("heading", { level: 1 });
    expect(basliklar).toHaveLength(1);
    expect(basliklar[0].textContent).toMatch(/envanter/i);
  });

  it("bildirim alanı gerçek bir denetimdir (yer tutucu değil)", () => {
    render(kabuk());
    expect(screen.getByRole("button", { name: /bildirim/i })).toBeTruthy();
  });
});

describe("İP-B1 · kabuk · mobil", () => {
  it("hamburger etiketli bir çekmece açar (role=dialog + aria-modal)", () => {
    render(kabuk());
    fireEvent.click(screen.getByRole("button", { name: /yönetim menüsünü aç/i }));
    const cekmece = screen.getByRole("dialog", { name: /yönetim menüsü/i });
    expect(cekmece.getAttribute("aria-modal")).toBe("true");
    // Çekmecenin içinde de gezinme ve arama var.
    expect(within(cekmece).getByRole("button", { name: /ara/i })).toBeTruthy();
  });
});
