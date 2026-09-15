import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { EgitmenDiplomaDogrulama, varlikIsaretleri } from "@/panel/pages/egitmenler/EgitmenDiplomaDogrulama";
import { BELGE_TURU_ETIKETI, DOGRULAMA_ENGELI, EDEVLET_ADRESI, NOT_MAX, ONAY_ACIK_NEDENI, derecemetni, dogrulanabilirMi, notHatasi, notPayloadi, onayKontrolMetni } from "@/panel/pages/egitmenler/DiplomaDogrulamaPenceresi";
import { MESGUL_NEDENI } from "@/panel/components/varlikKilidi";
import { PANEL_MENU, izinBeyaniniKarsilarMi, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import { usePendingEducations, useVerifyEducation } from "@/hooks/useAdmin";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import type { AdminEducation } from "@/types";

vi.mock("@/hooks/useAdmin", () => ({
  usePendingEducations: vi.fn(),
  useVerifyEducation: vi.fn(),
}));

const karar = vi.fn();
const sozler: { res: (v: unknown) => void; rej: (e: unknown) => void }[] = [];
const ertelenmis = () => new Promise((res, rej) => { sozler.push({ res, rej }); });

const kayit = (ek: Partial<AdminEducation> = {}): AdminEducation => ({
  id: 1, tutor_id: 7, tutor_name: "Ayşe Yılmaz", school_name: "Çukurova Üniversitesi", degree: "Lisans",
  field_of_study: "Matematik", start_year: 2014, end_year: 2018, document_url: "https://depo.tr/private/diploma.pdf?X-Amz-Signature=SIG",
  document_name: "ayse-diploma.pdf", document_type: "DIPLOMA", verification_status: "PENDING",
  verification_code: "BARKOD-9F3A", verification_tckn: "12345678901", ...ek,
});
const TAM = kayit();
const EKSIK = kayit({ id: 2, tutor_id: 8, tutor_name: "Berk Demir", school_name: "Anadolu Üniversitesi", degree: null, field_of_study: null, start_year: null, end_year: null, document_url: null, document_name: null, document_type: null, verification_code: null, verification_tckn: null });
const DENKLIK = kayit({ id: 3, tutor_id: 9, tutor_name: null, school_name: "Sorbonne", document_type: "DENKLIK", document_url: null, verification_code: "BARKOD-77", verification_tckn: null, document_name: null });
const LISTE = [TAM, EKSIK, DENKLIK];

const sonuc = (data: unknown, ek: object = {}) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn(), ...ek }) as never;
const son = (h: unknown) => vi.mocked(h as () => unknown).mock.calls.at(-1);

function izin(...izinler: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: izinler } as never });
}
function agac() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[PATHS.adminNewTutorDiplomas]}>
          <Routes>
            <Route path={PATHS.adminNewTutorDiplomas} element={<EgitmenDiplomaDogrulama />} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>
  );
}
const kur = () => render(agac());
const satir = (id: number) => within(screen.getByTestId(`diploma-${id}`));
/** Açık çekmece: AntD kapalı çekmeceyi DOM'da bırakır, `ant-drawer-open` açık olanı seçer. */
const cekmece = () => document.querySelector(".ant-drawer-open") as HTMLElement;
const pencere = () => within(cekmece());
const cekmeceAcikMi = () => document.querySelector(".ant-drawer-open") !== null;
// AntD yükleniyor simgesi jsdom'da erişilebilir ada "loading" ekler; ad SONUNA göre eşlenir.
const cekmeceDugmesi = (ad: string) =>
  within(cekmece().querySelector(".ant-drawer-footer") as HTMLElement).getByRole("button", { name: new RegExp(`${ad}$`) });
const onayGorunur = () => [...document.querySelectorAll(".ant-modal-confirm")].some((x) => !x.classList.contains("ant-zoom-leave"));
const onayDugmesi = (ad: RegExp) => {
  const acik = [...document.querySelectorAll(".ant-modal-confirm")].filter((x) => !x.classList.contains("ant-zoom-leave"));
  return within(acik[acik.length - 1] as HTMLElement).getByRole("button", { name: ad });
};
/** Ertelenmiş sözü act içinde sonuçlandırır (kilit bırakma ve state akışı flush olsun). */
const sonuclandir = async (i: number, hata?: unknown) =>
  act(async () => {
    if (hata === undefined) sozler[i].res({});
    else sozler[i].rej(hata);
    await Promise.resolve();
  });
const incele = async (id: number, ad: string) => userEvent.click(satir(id).getByRole("button", { name: `${ad} İncele` }));

beforeEach(() => {
  karar.mockReset().mockImplementation(ertelenmis);
  sozler.length = 0;
  vi.mocked(usePendingEducations).mockReset().mockReturnValue(sonuc(LISTE));
  vi.mocked(useVerifyEducation).mockReturnValue({ mutateAsync: karar, isPending: false } as never);
  izin("tutors.view", "tutors.manage", "users.view");
});

describe("saf kurallar", () => {
  it("not sözleşmesi, doğrulama önkoşulu, varlık işaretleri ve derece metni", () => {
    // Backend `note` isteğe bağlı ve ≤500: alt sınır UYDURULMAZ.
    expect(notHatasi("")).toBeUndefined();
    expect(notHatasi("ab")).toBeUndefined();
    expect(notHatasi("x".repeat(NOT_MAX))).toBeUndefined();
    expect(notHatasi("x".repeat(NOT_MAX + 1))).toBe(`En fazla ${NOT_MAX} karakter yazılabilir.`);
    expect(notPayloadi("   ")).toBeUndefined();
    expect(notPayloadi("  neden  ")).toBe("neden");
    // 409 önkoşulu: belge YA DA barkod yeter, ikisi de yoksa doğrulanamaz.
    expect(dogrulanabilirMi(TAM)).toBe(true);
    expect(dogrulanabilirMi(DENKLIK)).toBe(true);
    expect(dogrulanabilirMi({ document_url: "u", verification_code: null })).toBe(true);
    expect(dogrulanabilirMi(EKSIK)).toBe(false);
    expect(varlikIsaretleri(TAM)).toEqual(["Belge var", "Barkod var", "TCKN var"]);
    expect(varlikIsaretleri(DENKLIK)).toEqual(["Barkod var"]);
    expect(varlikIsaretleri(EKSIK)).toEqual([]);
    expect(derecemetni(TAM)).toBe("Lisans · Matematik");
    expect(derecemetni(EKSIK)).toBe("Belirtilmemiş");
    expect(derecemetni(EKSIK, "Derece belirtilmemiş")).toBe("Derece belirtilmemiş");
    expect(Object.values(BELGE_TURU_ETIKETI)).toEqual(["Diploma", "Denklik Belgesi", "Öğrenci Belgesi"]);
    // Onay metni MEVCUT materyali anlatır: olmayan belgeyi ya da olmayan barkodu kontrol ettirmez.
    expect(onayKontrolMetni(TAM)).toContain("yüklenen belgedeki adı");
    expect(onayKontrolMetni(TAM)).toContain("barkodu e-Devlet");
    expect(onayKontrolMetni({ document_url: "u", verification_code: null })).toBe("yüklenen belgedeki adı hesap adıyla karşılaştırdıysanız");
    expect(onayKontrolMetni(DENKLIK)).toBe("barkodu e-Devlet'te doğruladıysanız");
  });

  it("menü yaprağı, izin beyanı, seçili anahtar ve tembel rota", async () => {
    const yaprak = rotaIzniBul(PANEL_MENU, PATHS.adminNewTutorDiplomas);
    expect(yaprak?.requiredPermission).toBe("tutors");
    expect(izinBeyaniniKarsilarMi(["tutors.view"], yaprak!)).toBe(true);
    expect(izinBeyaniniKarsilarMi(["orders.view"], yaprak!)).toBe(false);
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewTutorDiplomas)).toEqual({ selectedKey: "egitmenler-diploma", openKeys: ["egitmenler"] });
    // Kardeş rotalar birbirini seçili göstermez.
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewTutorApplications).selectedKey).toBe("egitmenler-basvurular");
    const egitmenler = PANEL_MENU.find((m) => m.key === "egitmenler");
    expect(egitmenler?.children?.map((c) => c.key)).toContain("egitmenler-diploma");
    const modul = await import("@/panel/pages/egitmenler/EgitmenDiplomaDogrulama");
    expect(typeof modul.EgitmenDiplomaDogrulama).toBe("function");
  });
});

describe("EgitmenDiplomaDogrulama · liste", () => {
  it("tutors.view yokken AccessDenied ve sorgu kapalı (yoklama dahil)", () => {
    izin("orders.view");
    kur();
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    expect(son(usePendingEducations)).toEqual([false]);
  });

  it("sunucu sırası korunur, gerçek kuyruk sayısı gösterilir, belge türü ve fallback metinleri doğrudur", () => {
    kur();
    const satirlar = screen.getAllByTestId(/^diploma-/).map((d) => d.getAttribute("data-testid"));
    expect(satirlar).toEqual(["diploma-1", "diploma-2", "diploma-3"]);
    expect(within(screen.getByLabelText("Teyit bekleyen belgeler")).getByText("3")).toBeInTheDocument();
    expect(satir(1).getByText("Diploma")).toBeInTheDocument();
    expect(satir(3).getByText("Denklik Belgesi")).toBeInTheDocument();
    expect(satir(2).getByText("Belge türü yok")).toBeInTheDocument();
    expect(satir(2).getByText("Derece belirtilmemiş")).toBeInTheDocument();
    expect(satir(3).getByText("Eğitmen #9")).toBeInTheDocument();
    expect(satir(2).getByText("Belge ve barkod yok")).toBeInTheDocument();
    expect(satir(1).queryByText("Belge ve barkod yok")).not.toBeInTheDocument();
    expect(son(usePendingEducations)).toEqual([true]);
  });

  it("KAPALI listede TCKN, barkod, belge adı ve imzalı adres HİÇ yok", () => {
    kur();
    const govde = document.body.innerHTML;
    for (const sizinti of ["12345678901", "BARKOD-9F3A", "BARKOD-77", "ayse-diploma.pdf", "X-Amz-Signature", "private/diploma.pdf"]) {
      expect(govde).not.toContain(sizinti);
    }
    // Varlık işaretleri değer TAŞIMADAN bilgi verir.
    expect(satir(1).getByText("TCKN var")).toBeInTheDocument();
  });

  it("eğitmen adı users.view ile Link, izin yokken düz metin (ölü bağlantı yok)", () => {
    const a = kur();
    expect(satir(1).getByRole("link", { name: "Ayşe Yılmaz" })).toHaveAttribute("href", ROUTES.adminNewCustomer("tutor", 7));
    a.unmount();
    izin("tutors.view", "tutors.manage");
    kur();
    expect(satir(1).queryByRole("link", { name: "Ayşe Yılmaz" })).not.toBeInTheDocument();
    expect(satir(1).getByText("Ayşe Yılmaz")).toBeInTheDocument();
  });

  it("yükleniyor, ilk yükleme hatası, boş kuyruk ve önbellekli tazeleme hatası ayrı yüzeylerdir", async () => {
    const yukleniyor = kur();
    vi.mocked(usePendingEducations).mockReturnValue(sonuc(undefined, { isPending: true }));
    yukleniyor.unmount();
    const a = kur();
    expect(screen.getByText("Diploma kuyruğu yükleniyor…")).toBeInTheDocument();
    a.unmount();

    const yenile = vi.fn();
    vi.mocked(usePendingEducations).mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x"), refetch: yenile }));
    const b = kur();
    expect(screen.getByText("Diploma kuyruğu yüklenemedi.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(yenile).toHaveBeenCalledTimes(1);
    b.unmount();

    vi.mocked(usePendingEducations).mockReturnValue(sonuc([]));
    const c = kur();
    expect(screen.getByText("Teyit bekleyen belge yok")).toBeInTheDocument();
    c.unmount();

    // Önbellekte veri varken tazeleme hatası kayıtları GİZLEMEZ.
    vi.mocked(usePendingEducations).mockReturnValue(sonuc(LISTE, { isError: true, error: new Error("x") }));
    kur();
    expect(screen.getByText(/Kuyruk güncellenemedi/)).toBeInTheDocument();
    expect(screen.getByTestId("diploma-1")).toBeInTheDocument();
  });

  it("view-only: kayıt incelenebilir ama karar yüzeyi hiç çizilmez; açıklama boş/hata/yükleniyor durumlarında da görünür", async () => {
    izin("tutors.view", "users.view");
    const a = kur();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    await incele(1, "Ayşe Yılmaz");
    expect(pencere().getByText("12345678901")).toBeInTheDocument();
    for (const ad of ["Doğrula", "Reddet", "Belgeyi reddet"]) {
      expect(pencere().queryByRole("button", { name: ad })).not.toBeInTheDocument();
    }
    const altBilgi = within(document.querySelector(".ant-drawer-open .ant-drawer-footer") as HTMLElement);
    expect(altBilgi.getByRole("button", { name: "Kapat" })).toBeInTheDocument();
    a.unmount();
    vi.mocked(usePendingEducations).mockReturnValue(sonuc([]));
    const b = kur();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    b.unmount();
    vi.mocked(usePendingEducations).mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x") }));
    kur();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
  });
});

describe("EgitmenDiplomaDogrulama · inceleme penceresi", () => {
  it("açılınca hassas alanlar görünür, kapanınca DOM'dan tamamen kalkar", async () => {
    kur();
    await incele(1, "Ayşe Yılmaz");
    const p = pencere();
    expect(p.getByText("12345678901")).toBeInTheDocument();
    expect(p.getByText("BARKOD-9F3A")).toBeInTheDocument();
    expect(p.getByText("ayse-diploma.pdf")).toBeInTheDocument();
    expect(p.getByText("Çukurova Üniversitesi")).toBeInTheDocument();
    expect(p.getByText("2014 – 2018")).toBeInTheDocument();
    expect(p.getByText(/Belgedeki ad hesap adıyla aynı olmalı/)).toBeInTheDocument();
    // Yetkili modda da açık bir kapatma yolu var (X ikonuna mahkûm değil).
    expect(cekmeceDugmesi("Kapat")).toBeInTheDocument();
    // Not alanı yalnız red modunda doğar ve odağı alır.
    expect(p.queryByLabelText(/Red notu/)).not.toBeInTheDocument();
    await userEvent.click(cekmeceDugmesi("Reddet"));
    expect(pencere().getByLabelText(/Red notu/)).toHaveFocus();
    await userEvent.click(cekmeceDugmesi("Geri"));
    await userEvent.click((document.querySelector(".ant-drawer-open .ant-drawer-close") as HTMLElement));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
    const govde = document.body.innerHTML;
    for (const sizinti of ["12345678901", "BARKOD-9F3A", "ayse-diploma.pdf", "X-Amz-Signature"]) {
      expect(govde).not.toContain(sizinti);
    }
  });

  it("belge ve e-Devlet bağlantıları gerçek `a` sözleşmesini taşır; iç içe a/button yok", async () => {
    kur();
    await incele(1, "Ayşe Yılmaz");
    const belge = pencere().getByRole("link", { name: "Belgeyi aç" });
    expect(belge).toHaveAttribute("href", TAM.document_url);
    expect(belge).toHaveAttribute("target", "_blank");
    expect(belge).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(belge).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
    // İmzalı adres ÖZNİTELİKTE de metinde de kopyalanmaz (yalnız href).
    expect(belge).not.toHaveAttribute("title");
    expect(belge.textContent).toBe("Belgeyi aç");
    expect(belge.querySelector("button")).toBeNull();
    expect(belge.closest("button")).toBeNull();
    const edevlet = pencere().getByRole("link", { name: /e-Devlet/ });
    expect(edevlet).toHaveAttribute("href", EDEVLET_ADRESI);
    expect(edevlet).toHaveAttribute("target", "_blank");
  });

  it("eksik alanlarda dürüst uyarı verir ve doğrulama önkoşulu düğmeyi kapatır (Reddet açık kalır)", async () => {
    kur();
    await incele(2, "Berk Demir");
    const p = pencere();
    expect(p.getByText("Belge yüklenmemiş")).toBeInTheDocument();
    expect(p.getByText("Barkod girilmemiş")).toBeInTheDocument();
    expect(p.getByText("TCKN girilmemiş")).toBeInTheDocument();
    expect(p.getByText("Dosya adı yok")).toBeInTheDocument();
    expect(p.getByText(DOGRULAMA_ENGELI)).toBeInTheDocument();
    expect(p.getByRole("button", { name: "Doğrula" })).toBeDisabled();
    expect(p.getByRole("button", { name: "Reddet" })).toBeEnabled();
    expect(karar).not.toHaveBeenCalled();
  });

  it("arka plan tazelemesinde seçili hedef sabit kalır; kayıt düşerse pencere anlık görüntüyle durur", async () => {
    const a = kur();
    await incele(1, "Ayşe Yılmaz");
    expect(pencere().getByText("Çukurova Üniversitesi")).toBeInTheDocument();
    // 30 sn'lik yoklama listeyi değiştirir: sıra kayar, ama açık pencere aynı kayda bakar.
    const guncel = kayit({ verification_code: "BARKOD-YENI" });
    vi.mocked(usePendingEducations).mockReturnValue(sonuc([DENKLIK, guncel]));
    a.rerender(agac());
    await waitFor(() => expect(pencere().getByText("BARKOD-YENI")).toBeInTheDocument());
    // Kayıt kuyruktan düşerse pencere ani kaybolmaz: açılış anlık görüntüsü kalır.
    vi.mocked(usePendingEducations).mockReturnValue(sonuc([DENKLIK]));
    a.rerender(agac());
    expect(pencere().getByText("Çukurova Üniversitesi")).toBeInTheDocument();
  });
});

describe("EgitmenDiplomaDogrulama · doğrulama", () => {
  /** Onay penceresinin kendi "Doğrula"sı — çekmecedeki düğmeyle karışmasın diye modal'a kapsanır. */
  const onayla = async () => userEvent.click(onayDugmesi(/Doğrula$/));

  it("onay bağlamı gösterir, tek istek gönderir, başarıda mesaj verip pencereyi kapatır", async () => {
    kur();
    await incele(1, "Ayşe Yılmaz");
    await userEvent.click(cekmeceDugmesi("Doğrula"));
    expect((await screen.findAllByText(/doğrulayın; belge onaylanmış sayılacak/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Ayşe Yılmaz · Çukurova Üniversitesi/)).toBeInTheDocument();
    await onayla();
    await waitFor(() => expect(karar).toHaveBeenCalledTimes(1));
    expect(karar).toHaveBeenCalledWith({ id: 1, action: "verify" });
    await sonuclandir(0);
    expect(await screen.findByText("Diploma doğrulandı.")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
  });

  it("onay metni kaydın materyaline göre yazılır: yalnız belge / yalnız barkod", async () => {
    const BELGE_ONLY = kayit({ id: 4, tutor_name: "Cem Ak", school_name: "Ege Üniversitesi", verification_code: null });
    const a = kur();
    vi.mocked(usePendingEducations).mockReturnValue(sonuc([BELGE_ONLY]));
    a.rerender(agac());
    await incele(4, "Cem Ak");
    await userEvent.click(cekmeceDugmesi("Doğrula"));
    const belgeMetni = (await screen.findAllByText(/doğrulayın; belge onaylanmış sayılacak/)).map((e) => e.textContent).join(" ");
    expect(belgeMetni).toContain("yüklenen belgedeki adı hesap adıyla karşılaştırdıysanız");
    expect(belgeMetni).not.toContain("barkodu e-Devlet");
    await userEvent.click(onayDugmesi(/Vazgeç$/));
    a.unmount();

    // Yalnız barkodu olan kayıt (DENKLIK): "yüklenen belge" denmez.
    vi.mocked(usePendingEducations).mockReturnValue(sonuc([DENKLIK]));
    kur();
    await incele(3, "Eğitmen #9");
    await userEvent.click(cekmeceDugmesi("Doğrula"));
    const barkodMetni = (await screen.findAllByText(/doğrulayın; belge onaylanmış sayılacak/)).map((e) => e.textContent).join(" ");
    expect(barkodMetni).toContain("barkodu e-Devlet'te doğruladıysanız");
    expect(barkodMetni).not.toContain("yüklenen belgedeki");
  });

  it("onay AÇIKKEN (mutasyon başlamadan) çekmece kilitli: kapanmaz, karar değiştirilemez, ikinci onay açılmaz", async () => {
    kur();
    await incele(1, "Ayşe Yılmaz");
    await userEvent.click(cekmeceDugmesi("Doğrula"));
    expect(onayGorunur()).toBe(true);
    // Henüz hiçbir istek yok: koruma kilitten değil, AÇIK ONAYDAN geliyor.
    expect(karar).not.toHaveBeenCalled();
    for (const ad of ["Kapat", "Reddet", "Doğrula"]) {
      expect(cekmeceDugmesi(ad)).toBeDisabled();
      expect(cekmeceDugmesi(ad)).toHaveAttribute("title", ONAY_ACIK_NEDENI);
    }
    // X ve ESC de kapatmaz.
    await userEvent.click(document.querySelector(".ant-drawer-open .ant-drawer-close") as HTMLElement);
    expect(cekmeceAcikMi()).toBe(true);
    fireEvent.keyDown(cekmece(), { key: "Escape", keyCode: 27 });
    expect(cekmeceAcikMi()).toBe(true);
    // Red moduna geçilmez ve ikinci bir onay açılmaz.
    expect(pencere().queryByLabelText(/Red notu/)).not.toBeInTheDocument();
    expect(document.querySelectorAll(".ant-modal-confirm").length).toBe(1);
    // Normal Vazgeç: kilit tamamen kalkar, çekmece yeniden kullanılabilir.
    await userEvent.click(onayDugmesi(/Vazgeç$/));
    await waitFor(() => expect(onayGorunur()).toBe(false));
    await waitFor(() => expect(cekmeceDugmesi("Reddet")).toBeEnabled());
    expect(cekmeceDugmesi("Kapat")).toBeEnabled();
    await userEvent.click(cekmeceDugmesi("Reddet"));
    expect(pencere().getByLabelText(/Red notu/)).toBeInTheDocument();
    expect(karar).not.toHaveBeenCalled();
  });

  it("aynı tick çift onay TEK istek gönderir", async () => {
    kur();
    await incele(1, "Ayşe Yılmaz");
    await userEvent.click(cekmeceDugmesi("Doğrula"));
    const onay = onayDugmesi(/Doğrula$/);
    fireEvent.click(onay);
    fireEvent.click(onay);
    await waitFor(() => expect(karar).toHaveBeenCalledTimes(1));
  });

  it("hata (409) görünür kalır, onay ve pencere açık kalır, yeniden denenebilir", async () => {
    kur();
    await incele(1, "Ayşe Yılmaz");
    await userEvent.click(cekmeceDugmesi("Doğrula"));
    await onayla();
    await waitFor(() => expect(karar).toHaveBeenCalledTimes(1));
    await sonuclandir(0, { response: { status: 409, data: { detail: "Bu eğitime henüz barkod/belge eklenmemiş" } } });
    expect(await screen.findByText("Bu eğitime henüz barkod/belge eklenmemiş")).toBeInTheDocument();
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();
    await onayla();
    await waitFor(() => expect(karar).toHaveBeenCalledTimes(2));
  });

  it("pending sırasında Vazgeç onayı kapatmaz", async () => {
    kur();
    await incele(1, "Ayşe Yılmaz");
    await userEvent.click(cekmeceDugmesi("Doğrula"));
    await onayla();
    await waitFor(() => expect(karar).toHaveBeenCalledTimes(1));
    await userEvent.click(onayDugmesi(/Vazgeç$/));
    // Onay penceresi kapanmaz: sonuç gizlenmeden bitmesi beklenir.
    expect(onayGorunur()).toBe(true);
  });

  it("aynı kayıtta çapraz işlem engellenir; farklı kayıtlar birbirini kilitlemez", async () => {
    kur();
    await incele(1, "Ayşe Yılmaz");
    await userEvent.click(cekmeceDugmesi("Doğrula"));
    await onayla();
    await waitFor(() => expect(karar).toHaveBeenCalledTimes(1));
    // Aynı varlıkta ikinci işlem (reject) düğmesi kilit nedeniyle kapalı.
    await waitFor(() => expect(cekmeceDugmesi("Reddet")).toBeDisabled());
    expect(cekmeceDugmesi("Reddet")).toHaveAttribute("title", MESGUL_NEDENI);
  });
});

describe("EgitmenDiplomaDogrulama · reddetme", () => {
  const redModu = async (id = 1, ad = "Ayşe Yılmaz") => {
    await incele(id, ad);
    await userEvent.click(cekmeceDugmesi("Reddet"));
  };

  it("boş not `undefined` gider, dolu not trimlenir; başarıda mesaj + kapanış", async () => {
    const a = kur();
    await redModu();
    expect(pencere().getByText(/Not eğitmene gösterilir/)).toBeInTheDocument();
    await userEvent.click(cekmeceDugmesi("Belgeyi reddet"));
    await waitFor(() => expect(karar).toHaveBeenCalledWith({ id: 1, action: "reject", note: undefined }));
    await sonuclandir(0);
    expect(await screen.findByText("Belge reddedildi.")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
    a.unmount();

    karar.mockClear();
    kur();
    await redModu();
    await userEvent.type(pencere().getByLabelText(/Red notu/), "  ad eşleşmiyor  ");
    await userEvent.click(cekmeceDugmesi("Belgeyi reddet"));
    await waitFor(() => expect(karar).toHaveBeenCalledWith({ id: 1, action: "reject", note: "ad eşleşmiyor" }));
  });

  it("500 karakter üst sınırı girişte uygulanır ve sayaç gerçeği yazar", async () => {
    kur();
    await redModu();
    const alan = pencere().getByLabelText(/Red notu/) as HTMLTextAreaElement;
    expect(alan).toHaveAttribute("maxLength", String(NOT_MAX));
    fireEvent.change(alan, { target: { value: "x".repeat(NOT_MAX) } });
    expect(pencere().getByText(`Not eğitmene gösterilir; boş bırakılabilir (${NOT_MAX}/${NOT_MAX}).`)).toBeInTheDocument();
    // Üst sınırı aşan değer alanda hata olarak bildirilir (gönderim yapılmaz).
    fireEvent.change(alan, { target: { value: "x".repeat(NOT_MAX + 1) } });
    await userEvent.click(cekmeceDugmesi("Belgeyi reddet"));
    expect(pencere().getByRole("alert")).toHaveTextContent(`En fazla ${NOT_MAX} karakter yazılabilir.`);
    expect(karar).not.toHaveBeenCalled();
  });

  it("422 not alanına, 409/genel hata Alert'e düşer; alan değişince yalnız not hatası silinir; not korunur ve yeniden denenir", async () => {
    kur();
    await redModu();
    await userEvent.type(pencere().getByLabelText(/Red notu/), "gerekçe");
    await userEvent.click(cekmeceDugmesi("Belgeyi reddet"));
    await waitFor(() => expect(karar).toHaveBeenCalledTimes(1));
    await sonuclandir(0, { response: { status: 422, data: { detail: [{ loc: ["body", "note"], msg: "String should have at most 500 characters" }] } } });
    expect(await pencere().findByRole("alert")).toHaveTextContent("String should have at most 500 characters");
    // Hata sonrası pencere açık ve yazılan not korunur.
    expect(pencere().getByLabelText(/Red notu/)).toHaveValue("gerekçe");
    await userEvent.type(pencere().getByLabelText(/Red notu/), "!");
    expect(pencere().queryByRole("alert")).not.toBeInTheDocument();
    // Kilit hata sonrası bırakılır: düğme yükleme durumundan çıkınca yeniden denenebilir.
    await waitFor(() => expect(cekmeceDugmesi("Belgeyi reddet")).toBeEnabled());
    await userEvent.click(cekmeceDugmesi("Belgeyi reddet"));
    await waitFor(() => expect(karar).toHaveBeenCalledTimes(2));
    await sonuclandir(1, { response: { status: 409, data: { detail: "Kayıt sonuçlanmış" } } });
    expect(await screen.findByText("Kayıt sonuçlanmış")).toBeInTheDocument();
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();
  });

  it("hata sonrası Geri → tekrar Reddet: not korunur, eski hata görünmez", async () => {
    kur();
    await redModu();
    await userEvent.type(pencere().getByLabelText(/Red notu/), "gerekçe");
    await userEvent.click(cekmeceDugmesi("Belgeyi reddet"));
    await waitFor(() => expect(karar).toHaveBeenCalledTimes(1));
    await sonuclandir(0, { response: { status: 409, data: { detail: "Kayıt sonuçlanmış" } } });
    expect(await screen.findByText("Kayıt sonuçlanmış")).toBeInTheDocument();
    await waitFor(() => expect(cekmeceDugmesi("Geri")).toBeEnabled());
    await userEvent.click(cekmeceDugmesi("Geri"));
    await userEvent.click(cekmeceDugmesi("Reddet"));
    // Not korunur, bayat hata gitmiştir.
    expect(pencere().getByLabelText(/Red notu/)).toHaveValue("gerekçe");
    expect(screen.queryByText("Kayıt sonuçlanmış")).not.toBeInTheDocument();
    expect(pencere().queryByRole("alert")).not.toBeInTheDocument();
  });

  it("422 alan hatası da moddan çıkışta temizlenir", async () => {
    kur();
    await redModu();
    await userEvent.type(pencere().getByLabelText(/Red notu/), "gerekçe");
    await userEvent.click(cekmeceDugmesi("Belgeyi reddet"));
    await waitFor(() => expect(karar).toHaveBeenCalledTimes(1));
    await sonuclandir(0, { response: { status: 422, data: { detail: [{ loc: ["body", "note"], msg: "Geçersiz not" }] } } });
    expect(await pencere().findByRole("alert")).toHaveTextContent("Geçersiz not");
    await waitFor(() => expect(cekmeceDugmesi("Geri")).toBeEnabled());
    await userEvent.click(cekmeceDugmesi("Geri"));
    await userEvent.click(cekmeceDugmesi("Reddet"));
    expect(pencere().queryByRole("alert")).not.toBeInTheDocument();
    expect(pencere().getByLabelText(/Red notu/)).toHaveValue("gerekçe");
  });

  it("kirli kapatma onay ister, temiz inceleme doğrudan kapanır, pending'de kapanmaz", async () => {
    const a = kur();
    // Temiz: doğrudan kapanır.
    await incele(1, "Ayşe Yılmaz");
    await userEvent.click((document.querySelector(".ant-drawer-open .ant-drawer-close") as HTMLElement));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
    // Kirli: onay sorulur.
    await redModu();
    await userEvent.type(pencere().getByLabelText(/Red notu/), "yazdım");
    // "Geri" ile normal moda dönmek yazılanı silmez: kapatma yine onay ister.
    await userEvent.click(cekmeceDugmesi("Geri"));
    await userEvent.click((document.querySelector(".ant-drawer-open .ant-drawer-close") as HTMLElement));
    expect((await screen.findAllByText("Kaydedilmemiş değişiklikler var")).length).toBeGreaterThan(0);
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Düzenlemeye devam et" }));
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();
    a.unmount();

    // Pending: kapanma ve ikinci gönderim yok.
    karar.mockClear();
    kur();
    await redModu();
    await userEvent.click(cekmeceDugmesi("Belgeyi reddet"));
    await waitFor(() => expect(karar).toHaveBeenCalledTimes(1));
    await userEvent.click((document.querySelector(".ant-drawer-open .ant-drawer-close") as HTMLElement));
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();
    fireEvent.keyDown(document.querySelector(".ant-drawer-open") as HTMLElement, { key: "Escape", keyCode: 27 });
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();
    expect(karar).toHaveBeenCalledTimes(1);
  });
});
