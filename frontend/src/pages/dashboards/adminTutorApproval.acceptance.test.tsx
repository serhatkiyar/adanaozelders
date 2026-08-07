// İP-4 · Eğitmen onay kuyruğu — UI KABUL MATRİSİ (bölüm A: gerçek DOM).
//
// SÖZLEŞME: Bu dosya davranış bilinçli değiştirilmedikçe DÜZENLENMEZ. Bir
// iddia uygulamaya uydurmak için zayıflatılacaksa gerekçesi ayrı başlıkta
// raporlanır.
//
// Paketin ilk commit'i olduğu için ekran henüz YOKTUR: ilk koşum kırmızıdır.
//
// ## Neden bu testler var (P1-1)
//
// `AdminHome.tsx`'teki `<PendingTutorsSection/>` YALNIZ `section === "overview"`
// dalında duruyor; `AdminSectionPage` prop tipi (`Exclude<Tab,"overview">`) o
// dalı hiç geçirmiyor ve `App.tsx` ADMIN kökünü `/yonetim`'e (AdminDashboardPage)
// yönlendiriyor. Yani `useApproveTutor`/`useRejectTutor` tüm kod tabanında
// ULAŞILAMAZ bir dalın içinde. Admin ya SQL'e iniyor (ve `tutor_service.approve`
// yan etkilerini atlıyor) ya da eğitmeni siliyor.
//
// ## Neden saf/kaynak testi yetmez
//
// "Buton var mı" sorusunun tek geçerli kanıtı gerçek render + gerçek tıklama +
// gerçekten gönderilen istektir. Kaynak taraması ölü dalın içindeki butonu da
// "var" sayar — P1-1 tam olarak böyle gözden kaçtı.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { Toaster } from "@/components/Toaster";
import AdminSectionPage from "@/pages/admin/AdminSectionPage";
import { useAuthStore } from "@/store/authStore";
import { useToastStore } from "@/store/toastStore";

import type { AxiosRequestConfig } from "axios";

const TUTORS_VIEW = "tutors.view";
const TUTORS_MANAGE = "tutors.manage";

/* ══════════════ Sahte sunucu — gerçek axios örneği, yalnız adapter değişir ══════════════ */

interface Istek {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

type Yanit = { status?: number; data: unknown } | ((istek: Istek) => { status?: number; data: unknown });

let istekler: Istek[] = [];
let rotalar: { esles: (i: Istek) => boolean; yanit: Yanit }[] = [];
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
  istekler = [];
  rotalar = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const sorgu = new URLSearchParams(
      Object.entries((config.params ?? {}) as Record<string, unknown>).map(
        ([k, v]) => [k, String(v)] as [string, string]
      )
    ).toString();
    const istek: Istek = {
      method: (config.method ?? "get").toLowerCase(),
      url: String(config.url) + (sorgu ? `?${sorgu}` : ""),
      body: config.data ? JSON.parse(String(config.data)) : null,
    };
    istekler.push(istek);
    const rota = rotalar.find((r) => r.esles(istek));
    const ham = rota ? (typeof rota.yanit === "function" ? rota.yanit(istek) : rota.yanit) : { data: {} };
    const status = ham.status ?? 200;
    if (status >= 400) {
      const hata = new Error(`istek başarısız: ${status}`) as Error & {
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
  // Toast kuyruğu testler arasında taşınmamalı: bir sonraki testin "hata
  // görünüyor mu" iddiası önceki testin toast'ıyla YALANCI YEŞİL olurdu.
  useToastStore.setState({ toasts: [] });
});

/* ══════════════ Render yardımcıları ══════════════ */

function izinVer(...kodlar: string[]) {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: kodlar } as never,
  });
}

function sar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/yonetim/egitmenler"]}>
        <Routes>
          <Route path="/yonetim/egitmenler" element={<AdminSectionPage section="listings" />} />
        </Routes>
      </MemoryRouter>
      <Toaster />
    </QueryClientProvider>
  );
}

/* ══════════════ Fixture'lar ══════════════ */

const BEKLEYEN = {
  id: 41,
  email: "aday@ip4egitmen.example.com",
  first_name: "Aday",
  last_name: "Ogretmen",
  full_name: "Aday Ogretmen",
  username: "adayogretmen",
  role_id: 2,
  status: "PENDING_APPROVAL",
  headline: "Matematik öğretmeni",
  bio: "10 yıllık deneyim",
  hourly_rate: "400.00",
  avatar_url: null,
  created_at: "2027-04-01T09:00:00+00:00",
  rating_avg: 0,
  rating_count: 0,
};

const YAYINDA = {
  ...BEKLEYEN,
  id: 42,
  full_name: "Yayinda Ogretmen",
  username: "yayindaogretmen",
  status: "APPROVED",
};

function tutorSunucusu(liste: Record<string, unknown>[]) {
  sunucu("/admin/tutors", { data: liste }, "get");
}

/* ═════════════════════ A-1 · Kuyruk ekranda ═════════════════════ */

describe("A-1 · onay kuyruğu /yonetim/egitmenler altında render ediliyor", () => {
  it("bekleyen başvurular ayrı bir kuyruk başlığı altında sayılarıyla listelenir", async () => {
    izinVer(TUTORS_VIEW, TUTORS_MANAGE);
    tutorSunucusu([YAYINDA, BEKLEYEN]);

    sar();

    const baslik = await screen.findByRole("heading", { name: /onay bekleyen/i });
    const kuyruk = baslik.closest("section");
    expect(kuyruk, "kuyruk başlığı bir <section> içinde değil").not.toBeNull();
    expect(within(kuyruk as HTMLElement).getByText("Aday Ogretmen")).toBeTruthy();
    expect(within(kuyruk as HTMLElement).queryByText("Yayinda Ogretmen")).toBeNull();
  });

  it("bekleyen yoksa kuyruk başlığı hiç basılmaz (boş alarm gösterilmez)", async () => {
    izinVer(TUTORS_VIEW, TUTORS_MANAGE);
    tutorSunucusu([YAYINDA]);

    sar();

    await screen.findByText("Yayinda Ogretmen");
    expect(screen.queryByRole("heading", { name: /onay bekleyen/i })).toBeNull();
  });
});

/* ═════════════════════ A-2 · Satır aksiyonları ═════════════════════ */

describe("A-2 · PENDING_APPROVAL satırında Onayla ve Reddet aksiyonu var", () => {
  it("bekleyen satırda iki aksiyon da bulunur", async () => {
    izinVer(TUTORS_VIEW, TUTORS_MANAGE);
    tutorSunucusu([BEKLEYEN]);

    sar();

    const satir = (await screen.findByText("Aday Ogretmen")).closest("div.rounded-2xl");
    expect(satir).not.toBeNull();
    const icinde = within(satir as HTMLElement);
    expect(icinde.getByRole("button", { name: "Onayla" })).toBeTruthy();
    expect(icinde.getByRole("button", { name: "Reddet" })).toBeTruthy();
  });

  it("yayındaki satırda onay/red aksiyonu YOKTUR (yanlış satıra tıklama riski)", async () => {
    izinVer(TUTORS_VIEW, TUTORS_MANAGE);
    tutorSunucusu([YAYINDA]);

    sar();

    const satir = (await screen.findByText("Yayinda Ogretmen")).closest("div.rounded-2xl");
    const icinde = within(satir as HTMLElement);
    expect(icinde.queryByRole("button", { name: "Onayla" })).toBeNull();
    expect(icinde.queryByRole("button", { name: "Reddet" })).toBeNull();
  });
});

/* ═════════════════════ A-3 · Onay isteği gerçekten gidiyor ═════════════════════ */

describe("A-3 · Onayla tıklaması POST /admin/tutors/{id}/approve üretir", () => {
  it("gerçek tıklama gerçek istek üretir", async () => {
    izinVer(TUTORS_VIEW, TUTORS_MANAGE);
    tutorSunucusu([BEKLEYEN]);
    sunucu("/admin/tutors/41/approve", { data: {} }, "post");

    sar();

    fireEvent.click(await screen.findByRole("button", { name: "Onayla" }));

    // Deterministik bekleme: kullanıcıya görünen sonuç (başarı bildirimi)
    // beliriyorsa istek KESİNLİKLE gitmiştir.
    await screen.findByText(/onaylandı/i);
    expect(
      istekler.some((i) => i.method === "post" && i.url.endsWith("/admin/tutors/41/approve"))
    ).toBe(true);
  });

  it("onay isteği patlarsa kullanıcı hatayı GÖRÜR (sessiz başarısızlık yok)", async () => {
    izinVer(TUTORS_VIEW, TUTORS_MANAGE);
    tutorSunucusu([BEKLEYEN]);
    sunucu("/admin/tutors/41/approve", { status: 500, data: { detail: "Onaylama başarısız." } }, "post");

    sar();

    fireEvent.click(await screen.findByRole("button", { name: "Onayla" }));

    expect(await screen.findByText(/onaylama başarısız/i)).toBeTruthy();
  });
});

/* ═════════════════════ A-4 · Red gerekçesi zorunlu ═════════════════════ */

describe("A-4 · Reddet gerekçe olmadan gönderilemiyor", () => {
  it("gerekçe kutusu boşken onay düğmesi devre dışıdır ve hiçbir istek gitmez", async () => {
    izinVer(TUTORS_VIEW, TUTORS_MANAGE);
    tutorSunucusu([BEKLEYEN]);
    sunucu("/admin/tutors/41/reject", { data: {} }, "post");

    sar();

    fireEvent.click(await screen.findByRole("button", { name: "Reddet" }));

    const gonder = await screen.findByRole("button", { name: "Başvuruyu reddet" });
    expect((gonder as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(gonder);
    expect(istekler.some((i) => i.url.includes("/reject"))).toBe(false);
  });

  it("gerekçe yazılınca istek gövdesinde reason ile gider", async () => {
    izinVer(TUTORS_VIEW, TUTORS_MANAGE);
    tutorSunucusu([BEKLEYEN]);
    sunucu("/admin/tutors/41/reject", { data: {} }, "post");

    sar();

    fireEvent.click(await screen.findByRole("button", { name: "Reddet" }));
    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "Diploma barkodu doğrulanamadı." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Başvuruyu reddet" }));

    await screen.findByText(/reddedildi/i);
    const istek = istekler.find((i) => i.method === "post" && i.url.includes("/reject"));
    expect(istek, "red isteği hiç gitmedi").toBeTruthy();
    expect(istek?.body).toEqual({ reason: "Diploma barkodu doğrulanamadı." });
  });

  it("yalnız boşluktan oluşan gerekçe kabul edilmez", async () => {
    izinVer(TUTORS_VIEW, TUTORS_MANAGE);
    tutorSunucusu([BEKLEYEN]);
    sunucu("/admin/tutors/41/reject", { data: {} }, "post");

    sar();

    fireEvent.click(await screen.findByRole("button", { name: "Reddet" }));
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "   " } });

    const gonder = screen.getByRole("button", { name: "Başvuruyu reddet" });
    expect((gonder as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(gonder);
    expect(istekler.some((i) => i.url.includes("/reject"))).toBe(false);
  });
});

/* ═════════════════════ A-5 · Liste tazeleniyor ═════════════════════ */

describe("A-5 · onay sonrası liste tazeleniyor ve eğitmen kuyruktan düşüyor", () => {
  it("onaydan sonra liste yeniden çekilir ve satır kuyrukta kalmaz", async () => {
    izinVer(TUTORS_VIEW, TUTORS_MANAGE);
    let liste: Record<string, unknown>[] = [BEKLEYEN];
    sunucu("/admin/tutors", () => ({ data: liste }), "get");
    sunucu("/admin/tutors/41/approve", () => {
      liste = [{ ...BEKLEYEN, status: "APPROVED" }];
      return { data: {} };
    }, "post");

    sar();

    fireEvent.click(await screen.findByRole("button", { name: "Onayla" }));
    await screen.findByText(/onaylandı/i);

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: /onay bekleyen/i })).toBeNull()
    );
    expect(
      istekler.filter((i) => i.method === "get" && i.url.includes("/admin/tutors")).length
    ).toBeGreaterThan(1);
  });
});

/* ═════════════════════ F-1 · Fail-closed erişim ═════════════════════ */

describe("F-1 · izin bilgisi yoksa yönetim aksiyonu gösterilmez", () => {
  it("izin listesi boş bir admin kuyruğu göremez (fail-closed)", async () => {
    izinVer();
    tutorSunucusu([BEKLEYEN]);

    sar();

    expect(await screen.findByText(/yetkiniz yok/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Onayla" })).toBeNull();
  });

  it("izin bilgisi HİÇ yüklenmemişse de aksiyon gösterilmez", async () => {
    // Eski persist edilmiş oturum / `/me` henüz dönmemiş hâli: `undefined`.
    // Fail-open sözleşmesinde bu durum "her şeyi göster" demekti.
    useAuthStore.setState({
      token: "test-token",
      isAuthenticated: true,
      user: { id: 1, role_id: 1 } as never,
    });
    tutorSunucusu([BEKLEYEN]);

    sar();

    expect(await screen.findByText(/yetkiniz yok/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Onayla" })).toBeNull();
  });

  it("yalnız görüntüleme izni olan admin kuyruğu görür ama aksiyon alamaz", async () => {
    izinVer(TUTORS_VIEW);
    tutorSunucusu([BEKLEYEN]);

    sar();

    expect(await screen.findByText("Aday Ogretmen")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Onayla" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reddet" })).toBeNull();
  });
});
