/**
 * İP-A7d4 · göç dalgası 4 · ekran (1): `AdminAccessPage`.
 *
 * Haritadaki yeri: göçün **son canlı SK-4 sınıfı kusuru**. Ekran kendi
 * `Dialog`ını kuruyor, içinde rol kodu + rol adı + 500 karakterlik açıklama +
 * izin kutuları taşıyor, kirli form bekçisini HİÇ çağırmıyordu — ×/ESC/dış
 * tıklama bir YETKİ tanımının ortasında yazılanı sormadan siliyordu.
 *
 * **Kusuru bu kez elle arama değil, bu pakette yazılan nöbetçi buldu**
 * (`__guards__/korumasizPencere.test.ts`). SK-4 ve SK-7 ikisi de elle
 * bulunmuştu; bu üçüncüsü CI'da göründü.
 *
 * Ekranın hiç kabul testi YOKTU. Dosyanın ilk bölümü göçün KIRMAMASI gereken
 * mevcut davranışı sabitler.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import AdminAccessPage from "@/pages/admin/AdminAccessPage";
import { useAuthStore } from "@/store/authStore";
import { useToastStore } from "@/store/toastStore";
import { adsizKontroller } from "@/test-utils/alanAdlari";

import type { AxiosRequestConfig } from "axios";

interface Istek {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}
type Yanit = { status?: number; data: unknown };

let rotalar: { esles: (i: Istek) => boolean; yanit: Yanit }[] = [];
let istekler: Istek[] = [];
let eskiAdapter: unknown;

function sunucu(desen: string | RegExp, yanit: Yanit, method?: string) {
  rotalar.unshift({
    esles: (i) => {
      const yol = i.url.split("?")[0];
      return (
        (method ? i.method === method.toLowerCase() : true) &&
        (typeof desen === "string" ? yol.includes(desen) : desen.test(yol))
      );
    },
    yanit,
  });
}

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  rotalar = [];
  istekler = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const istek: Istek = {
      method: (config.method ?? "get").toLowerCase(),
      url: String(config.url),
      body: config.data && typeof config.data === "string" ? JSON.parse(config.data) : null,
    };
    istekler.push(istek);
    const rota = rotalar.find((r) => r.esles(istek));
    const ham = rota ? rota.yanit : { data: [] };
    const status = ham.status ?? 200;
    if (status >= 400) {
      const hata = new Error("istek basarisiz") as Error & {
        isAxiosError: boolean;
        response: unknown;
        config: unknown;
      };
      hata.isAxiosError = true;
      hata.response = { status, data: ham.data, headers: {}, config };
      hata.config = config;
      throw hata;
    }
    return { data: ham.data, status, statusText: "OK", headers: {}, config } as never;
  };
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
  useToastStore.setState({ toasts: [] });
});

function izinVer(...izinler: string[]) {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: izinler } as never,
  });
}

const IZINLER = [
  { id: 1, code: "orders.view", name: "Siparişleri görüntüle", group: "Sipariş" },
  { id: 2, code: "orders.manage", name: "Siparişleri yönet", group: "Sipariş" },
  { id: 3, code: "settings.manage", name: "Ayarları yönet", group: "Platform" },
];

const ROL = (over: Record<string, unknown> = {}) => ({
  id: 7,
  code: "ICERIK_EDITORU",
  name: "İçerik editörü",
  description: "Kataloğu düzenler.",
  is_system: false,
  permission_codes: ["orders.view"],
  assignment_count: 2,
  ...over,
});

const ATAMA = {
  admin_id: 3,
  admin_name: "Ayşe Yönetici",
  admin_email: "ayse@example.com",
  role_id: 7,
};

function temelUclar(roller = [ROL()]) {
  sunucu("/admin/access/permissions", { data: IZINLER }, "get");
  sunucu("/admin/access/roles", { data: roller }, "get");
  sunucu("/admin/access/assignments", { data: [ATAMA] }, "get");
}

function sar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AdminAccessPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function pencere(): HTMLElement {
  const p = document.querySelector('[role="dialog"]');
  if (!p) throw new Error("pencere yok");
  return p as HTMLElement;
}

async function yeniRolAc() {
  izinVer("admin_roles.view", "admin_roles.manage");
  temelUclar();
  sar();
  fireEvent.click(await screen.findByRole("button", { name: "Yeni rol" }));
  await screen.findByRole("dialog");
}

async function rolDuzenleAc() {
  izinVer("admin_roles.view", "admin_roles.manage");
  temelUclar();
  sar();
  fireEvent.click(await screen.findByRole("button", { name: "Düzenle" }));
  await screen.findByRole("dialog");
}

/* ═════════ Y-1 · mevcut davranış korunur ═════════ */

describe("Y-1 · rol listesi ve yetki", () => {
  it("rol kartı adı, kodunu ve sayaçlarını gösterir", async () => {
    izinVer("admin_roles.view", "admin_roles.manage");
    temelUclar();
    sar();
    // Rol adı İKİ yerde geçiyor: kartın başlığı ve atama seçicisinin
    // seçeneği. Başlığı ROLÜYLE ara — `getByText` ikisini birden bulup
    // testi kırardı ve gevşetmek (`getAllByText`) hangisinin göründüğünü
    // söylemezdi.
    expect(await screen.findByRole("heading", { name: "İçerik editörü" })).toBeTruthy();
    expect(screen.getByText("ICERIK_EDITORU")).toBeTruthy();
    expect(screen.getByText("1 izin")).toBeTruthy();
    expect(screen.getByText("2 yönetici")).toBeTruthy();
  });

  it("yönetme izni YOKKEN 'Yeni rol' ve 'Düzenle' çıkmaz", async () => {
    izinVer("admin_roles.view");
    temelUclar();
    sar();
    await screen.findByRole("heading", { name: "İçerik editörü" });
    expect(screen.queryByRole("button", { name: "Yeni rol" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Düzenle" })).toBeNull();
  });

  it("SUPER_ADMIN rolü düzenlenemez (sistem rolü koruması)", async () => {
    izinVer("admin_roles.view", "admin_roles.manage");
    temelUclar([ROL({ id: 1, code: "SUPER_ADMIN", name: "Süper yönetici", is_system: true })]);
    sar();
    await screen.findByRole("heading", { name: "Süper yönetici" });
    expect(screen.queryByRole("button", { name: "Düzenle" })).toBeNull();
    expect(screen.getByText("Sistem")).toBeTruthy();
  });

  it("atama seçicisi yöneticinin ADIYLA adlandırılmıştır", async () => {
    izinVer("admin_roles.view", "admin_roles.manage");
    temelUclar();
    sar();
    expect(await screen.findByLabelText("Ayşe Yönetici için yönetici rolü")).toBeTruthy();
  });

  it("rol ataması GERÇEK PUT isteği üretir", async () => {
    izinVer("admin_roles.view", "admin_roles.manage");
    temelUclar([ROL(), ROL({ id: 9, code: "DESTEK", name: "Destek" })]);
    sunucu("/admin/access/admins/3/role", { data: { ...ATAMA, role_id: 9 } }, "put");
    sar();
    fireEvent.change(await screen.findByLabelText("Ayşe Yönetici için yönetici rolü"), {
      target: { value: "9" },
    });
    await waitFor(() => {
      const p = istekler.find((i) => i.method === "put" && i.url.includes("/admins/3/role"));
      expect(p, "atama isteği hiç gitmedi").toBeTruthy();
      expect(p!.body).toEqual({ role_id: 9 });
    });
  });

  it("yükleme hatası boş listeden AYRI gösterilir", async () => {
    izinVer("admin_roles.view");
    sunucu("/admin/access/permissions", { status: 500, data: { detail: "patladi" } }, "get");
    sar();
    expect(await screen.findByRole("button", { name: /Yeniden dene/i })).toBeTruthy();
  });
});

/* ═════════ Y-2 · pencere ortak yüzeyde + SK-9 (KIRMIZI) ═════════ */

describe("Y-2 · rol penceresi ortak düzenleme yüzeyinde", () => {
  it("pencere role=dialog + aria-modal taşır", async () => {
    await yeniRolAc();
    expect(pencere().getAttribute("aria-modal")).toBe("true");
  });

  it("TEMİZ formda ESC kapatır", async () => {
    await yeniRolAc();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("KİRLİ formda kapatma ÖNCE SORAR — SK-9 (yetki tanımı kaybolmamalı)", async () => {
    await yeniRolAc();
    fireEvent.change(within(pencere()).getByLabelText(/Rol adı/), {
      target: { value: "İçerik moderatörü" },
    });
    await act(async () => {});

    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("İZİN KUTUSU işaretlemek de formu KİRLETİR (yalnız metin alanları değil)", async () => {
    // Bir rolün asıl içeriği izin kümesidir; on kutu işaretleyip yanlışlıkla
    // ESC'ye basan yönetici hepsini kaybederdi.
    await yeniRolAc();
    fireEvent.click(within(pencere()).getByRole("checkbox", { name: /Siparişleri yönet/ }));
    await act(async () => {});

    fireEvent.keyDown(document, { key: "Escape" });
    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
  });
});

/* ═════════ Y-3 · tüm koşullu dallar + alan adları (KIRMIZI) ═════════ */

describe("Y-3 · pencerenin iki dalı ve alan adları", () => {
  it("YENİ dalında rol kodu alanı VAR ve adlandırılmıştır", async () => {
    await yeniRolAc();
    const p = pencere();
    expect(within(p).getByLabelText(/Rol kodu/)).toBeTruthy();
    expect(within(p).getByLabelText(/Rol adı/)).toBeTruthy();
    expect(within(p).getByLabelText(/Açıklama/)).toBeTruthy();
    expect(adsizKontroller(p), "pencerede adsız kontrol var").toEqual([]);
  });

  it("DÜZENLEME dalında rol kodu alanı YOKTUR (kod değiştirilemez) ve değerler dolar", async () => {
    await rolDuzenleAc();
    const p = pencere();
    expect(within(p).queryByLabelText(/Rol kodu/)).toBeNull();
    expect((within(p).getByLabelText(/Rol adı/) as HTMLInputElement).value).toBe("İçerik editörü");
    expect((within(p).getByLabelText(/Açıklama/) as HTMLTextAreaElement).value).toBe(
      "Kataloğu düzenler."
    );
    expect(adsizKontroller(p)).toEqual([]);
  });

  it("mevcut izinler İŞARETLİ gelir, diğerleri gelmez", async () => {
    await rolDuzenleAc();
    const p = pencere();
    expect((within(p).getByRole("checkbox", { name: /Siparişleri görüntüle/ }) as HTMLInputElement).checked).toBe(true);
    expect((within(p).getByRole("checkbox", { name: /Siparişleri yönet/ }) as HTMLInputElement).checked).toBe(false);
  });

  it("izin grupları başlıklarıyla ayrılır", async () => {
    await yeniRolAc();
    const p = pencere();
    expect(within(p).getByText("Sipariş")).toBeTruthy();
    expect(within(p).getByText("Platform")).toBeTruthy();
  });
});

/* ═════════ Y-4 · doğrulama alanda, düğme AÇIK (KIRMIZI) ═════════ */

describe("Y-4 · doğrulama alanda çıkar, gönder düğmesi geçerlilikle KAPANMAZ", () => {
  it("boş formda 'Kaydet' basılabilir ve istek GİTMEZ, hata ALANDA çıkar", async () => {
    await yeniRolAc();
    const kaydet = within(pencere()).getByRole("button", { name: "Kaydet" });
    expect((kaydet as HTMLButtonElement).disabled, "gönder düğmesi geçerlilikle kapanmış").toBe(false);

    fireEvent.click(kaydet);

    expect(await screen.findByText("Rol kodu en az 3 karakter olmalı.")).toBeTruthy();
    expect(screen.getByText("Rol adı en az 2 karakter olmalı.")).toBeTruthy();
    expect(istekler.filter((i) => i.method === "post")).toEqual([]);
    // Kullanıcı NEREYE bakacağını bilsin: odak ilk hatalı alanda.
    await waitFor(() =>
      expect(document.activeElement).toBe(within(pencere()).getByLabelText(/Rol kodu/))
    );
  });

  it("geçersiz rol kodu deseni alanda gerekçesiyle reddedilir", async () => {
    await yeniRolAc();
    const p = pencere();
    // Alan girdiyi zaten büyütüp temizliyor; şemanın kendisi de desen tutuyor.
    fireEvent.change(within(p).getByLabelText(/Rol kodu/), { target: { value: "9x" } });
    fireEvent.change(within(p).getByLabelText(/Rol adı/), { target: { value: "Destek" } });
    fireEvent.click(within(p).getByRole("button", { name: "Kaydet" }));
    expect(
      await screen.findByText(/Rol kodu büyük harfle başlamalı|Rol kodu en az 3 karakter/)
    ).toBeTruthy();
    expect(istekler.filter((i) => i.method === "post")).toEqual([]);
  });

  it("geçerli formda POST /admin/access/roles GERÇEKTEN gider (kod büyütülmüş)", async () => {
    await yeniRolAc();
    sunucu("/admin/access/roles", { data: ROL({ id: 11, code: "DESTEK" }) }, "post");
    const p = pencere();
    fireEvent.change(within(p).getByLabelText(/Rol kodu/), { target: { value: "destek_ekibi" } });
    fireEvent.change(within(p).getByLabelText(/Rol adı/), { target: { value: "Destek ekibi" } });
    fireEvent.click(within(p).getByRole("checkbox", { name: /Siparişleri görüntüle/ }));
    fireEvent.click(within(p).getByRole("button", { name: "Kaydet" }));

    await waitFor(() => {
      const post = istekler.find((i) => i.method === "post" && i.url.includes("/access/roles"));
      expect(post, "oluşturma isteği hiç gitmedi").toBeTruthy();
      expect(post!.body).toEqual({
        name: "Destek ekibi",
        description: null,
        permission_codes: ["orders.view"],
        code: "DESTEK_EKIBI",
      });
    });
  });

  it("DÜZENLEMEDE PUT gider ve gövdede kod YOKTUR", async () => {
    await rolDuzenleAc();
    sunucu("/admin/access/roles/7", { data: ROL() }, "put");
    fireEvent.change(within(pencere()).getByLabelText(/Rol adı/), {
      target: { value: "İçerik şefi" },
    });
    fireEvent.click(within(pencere()).getByRole("button", { name: "Kaydet" }));

    await waitFor(() => {
      const put = istekler.find((i) => i.method === "put" && i.url.includes("/access/roles/7"));
      expect(put, "güncelleme isteği hiç gitmedi").toBeTruthy();
      expect(put!.body).toEqual({
        name: "İçerik şefi",
        description: "Kataloğu düzenler.",
        permission_codes: ["orders.view"],
      });
    });
  });

  it("sunucu 422'si ALANIN altına iner (toast'a değil)", async () => {
    await yeniRolAc();
    sunucu(
      "/admin/access/roles",
      { status: 422, data: { detail: [{ loc: ["body", "code"], msg: "Bu kod zaten var." }] } },
      "post"
    );
    const p = pencere();
    fireEvent.change(within(p).getByLabelText(/Rol kodu/), { target: { value: "DESTEK" } });
    fireEvent.change(within(p).getByLabelText(/Rol adı/), { target: { value: "Destek" } });
    fireEvent.click(within(p).getByRole("button", { name: "Kaydet" }));

    expect(await screen.findByText("Bu kod zaten var.")).toBeTruthy();
    expect(document.querySelector('[role="dialog"]'), "pencere kapandı, hata görünmez oldu").not.toBeNull();
  });

  it("alana düşmeyen sunucu hatası pencere İÇİNDE şeride yazılır", async () => {
    await yeniRolAc();
    // 500'de sunucunun `detail`i kullanıcıya AKTARILMAZ (iç hata metni
    // sızmasın); genel mesaj kullanılır. Burada iddia edilen şey mesajın
    // metni değil, hatanın TOAST'a değil pencere içindeki şeride gitmesi.
    sunucu("/admin/access/roles", { status: 500, data: { detail: "traceback…" } }, "post");
    const p = pencere();
    fireEvent.change(within(p).getByLabelText(/Rol kodu/), { target: { value: "DESTEK" } });
    fireEvent.change(within(p).getByLabelText(/Rol adı/), { target: { value: "Destek" } });
    fireEvent.click(within(p).getByRole("button", { name: "Kaydet" }));

    const uyari = await screen.findByRole("alert");
    expect(uyari.textContent).toContain("Rol kaydedilemedi.");
    expect(uyari.textContent, "iç hata metni kullanıcıya sızdı").not.toContain("traceback");
    expect(pencere().contains(uyari), "hata şeridi pencerenin dışında").toBe(true);
  });

  it("kayıt BAŞARILI olunca pencere kapanır ve bekçi sormaz", async () => {
    await yeniRolAc();
    sunucu("/admin/access/roles", { data: ROL({ id: 11 }) }, "post");
    const p = pencere();
    fireEvent.change(within(p).getByLabelText(/Rol kodu/), { target: { value: "DESTEK" } });
    fireEvent.change(within(p).getByLabelText(/Rol adı/), { target: { value: "Destek" } });
    fireEvent.click(within(p).getByRole("button", { name: "Kaydet" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText("Kaydedilmemiş değişiklikler var")).toBeNull();
  });
});
