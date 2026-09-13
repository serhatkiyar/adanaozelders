/**
 * İP-A7d2 · Görev 3 — `CourierManager` göç matrisi.
 *
 * ## Bu ekran dalgaya neden alındı
 *
 * Nöbetçinin **en büyük adsız kontrol kalemi** burada: dokuz alan `placeholder`ı
 * etiket yerine kullanıyor ("Ad", "Soyad", "E-posta", "Şifre", "İsim",
 * "Telefon"…). `placeholder` yazınca kaybolur, ekran okuyucuda güvenilmez ve
 * kontrast kuralına uymaz — yani bu dokuz alanın ekran okuyucuda adı YOK.
 *
 * İkinci sebep: bu ekranın formlarının hiçbiri PENCERE içinde değil. Yani
 * A7d2'nin `pencereSiz` beyanının ilk gerçek çağrı yeri burasıdır (Görev 1).
 *
 * Üçüncüsü: satır aksiyonları `opacity-0 … group-hover:opacity-100` ile
 * yalnız FARE ÜZERİNDEYKEN görünüyordu. Dokunmatik ekranda hover yoktur;
 * yönetici tablette kuryeyi düzenleyemiyordu. Projenin yazılı kuralı
 * ("hover-only aksiyon YOK — dokunmatik birinci sınıf") bu ekranda çiğnenmiş.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { CourierManager } from "@/components/admin/CourierManager";
import { useAuthStore } from "@/store/authStore";
import { useToastStore } from "@/store/toastStore";
import { adsizKontroller, formKontrolleri } from "@/test-utils/alanAdlari";

import type { AxiosRequestConfig } from "axios";

/* ══════════════ Sahte sunucu ══════════════ */

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
    const ham = rota ? rota.yanit : { data: null };
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

function izinVer(...kodlar: string[]) {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: kodlar } as never,
  });
}

/* ══════════════ Fixture ══════════════ */

const KURYE = (over: Record<string, unknown> = {}) => ({
  id: 4,
  name: "Deniz Kurye",
  phone: "0532 000 00 00",
  photo_url: null,
  is_active: true,
  ...over,
});

const HESAP = {
  id: 91,
  courier_id: 4,
  email: "deniz@kurye.example.com",
  is_active: true,
};

let sonQc: QueryClient;
function sar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  sonQc = qc;
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CourierManager />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function adlarDogru(enAz: number) {
  const kontroller = formKontrolleri(document.body);
  expect(
    kontroller.length,
    `dal acilmamis olabilir: beklenen >=${enAz}, bulunan ${kontroller.length}`
  ).toBeGreaterThanOrEqual(enAz);
  expect(adsizKontroller(document.body).map((a) => a.html)).toEqual([]);
}

async function listeyiAc(kuryeler = [KURYE()]) {
  izinVer("delivery.view", "delivery.manage");
  sunucu("/delivery/couriers", { data: kuryeler }, "get");
  sar();
  if (kuryeler.length) await screen.findByText("Deniz Kurye");
  else await screen.findByRole("button", { name: "Kurye ekle" });
}

/* ══════════════ 1 · Mevcut davranış korunur ══════════════ */

describe("KY-1 · liste ve yetki", () => {
  it("kurye listesini isim ve telefonla gösterir", async () => {
    await listeyiAc();
    expect(screen.getByText("0532 000 00 00")).toBeTruthy();
  });

  it("liste boşken davet metni çıkar", async () => {
    izinVer("delivery.view", "delivery.manage");
    sunucu("/delivery/couriers", { data: [] }, "get");
    sar();
    expect(await screen.findByText(/Henüz kurye yok/)).toBeTruthy();
  });

  it("yönetim yetkisi YOKSA düzenleme yüzeyi açılmaz", async () => {
    izinVer("delivery.view");
    sunucu("/delivery/couriers", { data: [KURYE()] }, "get");
    sar();
    await screen.findByText("Deniz Kurye");
    expect(screen.queryByRole("button", { name: "Düzenle" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Kurye ekle" })).toBeNull();
  });

  it("silme ONAY penceresi açmadan istek göndermez", async () => {
    await listeyiAc();
    fireEvent.click(screen.getByRole("button", { name: "Sil" }));
    expect(istekler.some((i) => i.method === "delete")).toBe(false);
    expect(await screen.findByRole("heading", { name: "Kurye profilini sil" })).toBeTruthy();
  });
});

/* ══════════════ 2 · Dokunmatik erişim (KIRMIZI) ══════════════ */

describe("KY-2 · satır aksiyonları HOVER'a bağlı değildir", () => {
  it("aksiyon şeridi opacity-0 ile gizlenmez (dokunmatikte de görünür)", async () => {
    await listeyiAc();
    const dugme = screen.getByRole("button", { name: "Düzenle" });
    const serit = dugme.parentElement!;
    expect(serit.className).not.toMatch(/opacity-0/);
    expect(serit.className).not.toMatch(/group-hover/);
  });
});

/* ══════════════ 3 · Alan adları — TÜM dallar (KIRMIZI) ══════════════ */

describe("KY-3 · her koşullu dal render edilir, her alanın adı vardır", () => {
  it("KURYE EKLE dalı — isim alanı adlı", async () => {
    await listeyiAc([]);
    fireEvent.click(screen.getByRole("button", { name: "Kurye ekle" }));
    expect(await screen.findByLabelText(/Kurye adı/)).toBeTruthy();
    adlarDogru(1);
  });

  it("SATIR DÜZENLEME dalı — isim ve telefon adlı", async () => {
    await listeyiAc();
    fireEvent.click(screen.getByRole("button", { name: "Düzenle" }));
    expect(await screen.findByLabelText(/Kurye adı/)).toBeTruthy();
    expect(screen.getByLabelText(/Telefon/)).toBeTruthy();
    adlarDogru(2);
  });

  it("HESAP YOK dalı — dört alanın dördü de adlı", async () => {
    await listeyiAc();
    sunucu(/\/account$/, { data: null }, "get");
    fireEvent.click(screen.getByRole("button", { name: "Hesap" }));
    expect(await screen.findByLabelText(/^Ad$/)).toBeTruthy();
    expect(screen.getByLabelText(/Soyad/)).toBeTruthy();
    expect(screen.getByLabelText(/E-posta/)).toBeTruthy();
    expect(screen.getByLabelText(/Şifre/)).toBeTruthy();
    adlarDogru(4);
  });

  it("HESAP VAR dalı — şifre sıfırlama alanı adlı", async () => {
    await listeyiAc();
    sunucu(/\/account$/, { data: HESAP }, "get");
    fireEvent.click(screen.getByRole("button", { name: "Hesap" }));
    fireEvent.click(await screen.findByRole("button", { name: "Şifre sıfırla" }));
    expect(await screen.findByLabelText(/Yeni şifre/)).toBeTruthy();
    adlarDogru(1);
  });
});

/* ══════════════ 4 · Doğrulama alanda (KIRMIZI) ══════════════ */

describe("KY-4 · doğrulama alanda, gönder düğmesi kapanmaz", () => {
  it("kısa isimle gönderim YAPILMAZ; hata ALANDA çıkar; düğme AÇIK kalır", async () => {
    await listeyiAc([]);
    fireEvent.click(screen.getByRole("button", { name: "Kurye ekle" }));
    const alan = await screen.findByLabelText(/Kurye adı/);
    fireEvent.change(alan, { target: { value: "A" } });

    const ekle = screen.getByRole("button", { name: "Ekle" });
    expect((ekle as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(ekle);

    await waitFor(() => expect(alan.getAttribute("aria-invalid")).toBe("true"));
    // Odak da ilk hatalı alana taşınmalı (bkz. araclarGoc · AR-4 notu).
    await waitFor(() => expect(document.activeElement).toBe(alan));
    expect(istekler.some((i) => i.method === "post" && i.url === "/delivery/couriers")).toBe(
      false
    );
  });

  it("geçerli isimle gövde sunucuya gider", async () => {
    await listeyiAc([]);
    sunucu("/delivery/couriers", { data: KURYE({ id: 9, name: "Yeni Kurye" }) }, "post");
    fireEvent.click(screen.getByRole("button", { name: "Kurye ekle" }));
    fireEvent.change(await screen.findByLabelText(/Kurye adı/), {
      target: { value: "Yeni Kurye" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ekle" }));

    await waitFor(() => {
      const yazma = istekler.find(
        (i) => i.method === "post" && i.url === "/delivery/couriers"
      );
      expect(yazma?.body?.name).toBe("Yeni Kurye");
    });
  });

  it("geçersiz e-postayla hesap oluşturma İSTEĞİ GİTMEZ, hata alanda çıkar", async () => {
    await listeyiAc();
    sunucu(/\/account$/, { data: null }, "get");
    fireEvent.click(screen.getByRole("button", { name: "Hesap" }));
    const eposta = await screen.findByLabelText(/E-posta/);
    fireEvent.change(eposta, { target: { value: "gecersiz" } });
    fireEvent.change(screen.getByLabelText(/Şifre/), { target: { value: "12345678" } });
    fireEvent.change(screen.getByLabelText(/Soyad/), { target: { value: "Kurye" } });
    fireEvent.click(screen.getByRole("button", { name: "Hesap oluştur" }));

    await waitFor(() => expect(eposta.getAttribute("aria-invalid")).toBe("true"));
    expect(istekler.some((i) => i.method === "post" && i.url.includes("/account"))).toBe(
      false
    );
  });

  it("kısa şifreyle sıfırlama İSTEĞİ GİTMEZ, hata alanda çıkar", async () => {
    await listeyiAc();
    sunucu(/\/account$/, { data: HESAP }, "get");
    fireEvent.click(screen.getByRole("button", { name: "Hesap" }));
    fireEvent.click(await screen.findByRole("button", { name: "Şifre sıfırla" }));
    const alan = await screen.findByLabelText(/Yeni şifre/);
    fireEvent.change(alan, { target: { value: "kısa" } });
    fireEvent.click(screen.getByRole("button", { name: "Şifreyi kaydet" }));

    await waitFor(() => expect(alan.getAttribute("aria-invalid")).toBe("true"));
    expect(istekler.some((i) => i.url.includes("/password"))).toBe(false);
  });
});

/* ══════════════ 4b · Şifre mutation cache/observer'da kalmaz ══════════════ */

/** QueryClient mutation cache'inin ve observer'ların serileştirilmiş hâlinde düz metin şifre aranır. */
function cacheSifreIceriyor(sifre: string) {
  const mutasyonlar = sonQc.getMutationCache().getAll();
  const durumlar = mutasyonlar.map((mu) => mu.state);
  return JSON.stringify(durumlar).includes(sifre) || mutasyonlar.length > 0;
}

describe("KY-4b · şifre taşıyan mutation'lar settled sonrası cache'te şifre bırakmaz", () => {
  it("hesap oluşturma: hata sonrası hata alanda, şifre alanı korunur, cache boş; yeniden gönderim başarır, cache yine boş", async () => {
    await listeyiAc();
    sunucu(/\/account$/, { data: null }, "get");
    sunucu(/\/account$/, { status: 422, data: { detail: [{ loc: ["body", "email"], msg: "E-posta zaten kayıtlı" }] } }, "post");
    fireEvent.click(screen.getByRole("button", { name: "Hesap" }));
    const eposta = await screen.findByLabelText(/E-posta/);
    fireEvent.change(eposta, { target: { value: "deniz@kurye.example.com" } });
    const sifre = screen.getByLabelText(/Şifre/) as HTMLInputElement;
    fireEvent.change(sifre, { target: { value: "cokGizli123" } });
    fireEvent.change(screen.getByLabelText(/Soyad/), { target: { value: "Kurye" } });
    fireEvent.click(screen.getByRole("button", { name: "Hesap oluştur" }));
    await screen.findByText("E-posta zaten kayıtlı");
    expect(sifre.value).toBe("cokGizli123");
    await waitFor(() => expect(cacheSifreIceriyor("cokGizli123")).toBe(false));
    // Yeniden gönderim: başarı → alan temizlenir, cache yine boş.
    sunucu(/\/account$/, { data: HESAP }, "post");
    fireEvent.click(screen.getByRole("button", { name: "Hesap oluştur" }));
    await waitFor(() => expect(istekler.filter((i) => i.method === "post" && i.url.includes("/account"))).toHaveLength(2));
    await waitFor(() => expect(sifre.value).toBe(""));
    await waitFor(() => expect(cacheSifreIceriyor("cokGizli123")).toBe(false));
  });

  it("şifre sıfırlama: hata sonrası hata alanda, şifre alanı korunur, cache boş; yeniden gönderim başarır, alan temizlenir", async () => {
    await listeyiAc();
    sunucu(/\/account$/, { data: HESAP }, "get");
    sunucu(/\/reset-password$/, { status: 422, data: { detail: [{ loc: ["body", "new_password"], msg: "Şifre çok zayıf" }] } }, "post");
    fireEvent.click(screen.getByRole("button", { name: "Hesap" }));
    fireEvent.click(await screen.findByRole("button", { name: "Şifre sıfırla" }));
    const alan = (await screen.findByLabelText(/Yeni şifre/)) as HTMLInputElement;
    fireEvent.change(alan, { target: { value: "yeniGizli123" } });
    fireEvent.click(screen.getByRole("button", { name: "Şifreyi kaydet" }));
    await screen.findByText("Şifre çok zayıf");
    expect(alan.value).toBe("yeniGizli123");
    await waitFor(() => expect(cacheSifreIceriyor("yeniGizli123")).toBe(false));
    sunucu(/\/reset-password$/, { data: null }, "post");
    fireEvent.click(screen.getByRole("button", { name: "Şifreyi kaydet" }));
    await waitFor(() => expect(istekler.filter((i) => i.url.includes("/reset-password"))).toHaveLength(2));
    await waitFor(() => expect(screen.queryByLabelText(/Yeni şifre/)).not.toBeInTheDocument());
    await waitFor(() => expect(cacheSifreIceriyor("yeniGizli123")).toBe(false));
  });
});

/* ══════════════ 5 · Kirli form koruması, PENCERESİZ (KIRMIZI) ══════════════ */

describe("KY-5 · satır içi form kirliyken rota koruması kurulur", () => {
  it("düzenleme formu kirliyken sayfadan ayrılma uyarısı devreye girer", async () => {
    await listeyiAc();
    fireEvent.click(screen.getByRole("button", { name: "Düzenle" }));
    fireEvent.change(await screen.findByLabelText(/Kurye adı/), {
      target: { value: "Deniz Yeni" },
    });
    await act(async () => {});

    // `beforeunload` kaydı bekçinin KURULDUĞUNUN gözlemlenebilir kanıtıdır:
    // olay iptal edilirse tarayıcı "sayfadan ayrılmak istiyor musun" sorar.
    const olay = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(olay);
    expect(olay.defaultPrevented, "kirli satır içi form korumasız").toBe(true);
  });

  it("form TEMİZKEN uyarı KURULMAZ (bekçi her şeye uyarmıyor)", async () => {
    await listeyiAc();
    fireEvent.click(screen.getByRole("button", { name: "Düzenle" }));
    await screen.findByLabelText(/Kurye adı/);
    await act(async () => {});

    const olay = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(olay);
    expect(olay.defaultPrevented).toBe(false);
  });
});
