/**
 * İP-A7d1 · Ekran (a) — `LibraryEditorModal` kabul matrisi.
 *
 * Göç dalgası 1'in "çok bölümlü form" ekranı: yirmi küsur alan, ÜÇ bağımsız
 * koşullu dal (admin/operatör kimlik yetkisi · yeni/düzenleme · günün
 * açık/kapalı olması) ve ÇAPRAZ ALAN doğrulaması (kapanış açılıştan sonra
 * olmalı). `Form.*` sözleşmesini bu genişlikte hiçbir form zorlamadı —
 * A6 pilotu (`DamageDialog`) beş alanlıydı.
 *
 * ## Zorunlu kabul kriteri (A4'ten beri taşınıyor)
 *
 * Form TÜM KOŞULLU DALLARIYLA render edilir ve her alanın erişilebilir adı
 * doğrulanır (`test-utils/alanAdlari`). Gerekçe: `Form.Control`un adsız alan
 * koruması yalnız RENDER EDİLDİĞİNDE ateşlenir; testin uğramadığı bir dalda
 * duran alan üretime adsız çıkar ve kaynak sayacı "0 borç" der.
 *
 * Dallar KARTEZYEN ÇARPILMAZ — "her koşullu alan en az bir kez" yeterlidir.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import {
  LibraryEditorModal,
  emptyEditor,
  type EditorState,
} from "@/components/LibraryEditorModal";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { adsizKontroller, formKontrolleri } from "@/test-utils/alanAdlari";
import { useAuthStore } from "@/store/authStore";

import type { AxiosRequestConfig } from "axios";

/* ── Sahte sunucu ── */

interface Istek {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

let istekler: Istek[] = [];
let eskiAdapter: unknown;
/** Yazma isteğine verilecek yanıt; `null` → 200. */
let yazmaHatasi: { status: number; data: unknown } | null = null;

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  istekler = [];
  yazmaHatasi = null;
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const istek: Istek = {
      method: (config.method ?? "get").toLowerCase(),
      url: String(config.url),
      body: config.data ? JSON.parse(String(config.data)) : null,
    };
    istekler.push(istek);
    if (istek.method !== "get" && yazmaHatasi) {
      const hata = new Error("yazma reddedildi") as Error & {
        isAxiosError: boolean;
        response: unknown;
      };
      hata.isAxiosError = true;
      hata.response = { status: yazmaHatasi.status, data: yazmaHatasi.data, headers: {}, config };
      throw hata;
    }
    return {
      data: istek.method === "get" ? [] : { id: 42 },
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    } as never;
  };
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: ["*"] } as never,
  });
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
});

/** Yüzeyi açık başlatan koşum — pencere durumu EKRANDA yaşamaz. */
function Kosum({
  baslangic,
  canEditIdentity = true,
}: {
  baslangic: EditorState;
  canEditIdentity?: boolean;
}) {
  const yuzey = useDuzenlemeYuzeyi<EditorState, void>();
  useEffect(() => {
    yuzey.ac(baslangic);
    // Yalnız ilk render'da açılır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <LibraryEditorModal yuzey={yuzey} canEditIdentity={canEditIdentity} />;
}

function sar(baslangic: EditorState, canEditIdentity = true) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Kosum baslangic={baslangic} canEditIdentity={canEditIdentity} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Açık bir gün + kapalı bir gün içeren hafta (iki dal birden). */
function karisikHafta(): EditorState {
  const t = emptyEditor();
  t.hours = (t.hours ?? []).map((h) =>
    h.weekday === 0
      ? { ...h, is_closed: false, open_minute: 540, close_minute: 1320 }
      : h
  );
  return t;
}

function duzenlemeHali(): EditorState {
  return { ...karisikHafta(), id: 7, name: "Şehit Pilot Kütüphanesi" };
}

const pencere = () => screen.getByRole("dialog") as HTMLElement;

/**
 * Formun KENDİ alanı olmayan, bilinen adsız kontrol — `MapPicker`ın kendi
 * arama kutusu.
 *
 * Bu borç bu paketin kapsamı DIŞINDADIR: `MapPicker.tsx` göç eden üç ekrandan
 * biri değil ve paketin kabul kriteri "seçilen üç ekran ve ortak katman
 * dışında ekran dosyası değişmedi"dir. Borç zaten çalışma zamanı kapısında
 * isimle kayıtlı (`CALISMA_ZAMANI_ADSIZ["src/components/MapPicker.tsx"] = 1`)
 * ve raporda dalga 2'ye taşınır.
 *
 * İstisna SAYIYLA da doğrulanır (aşağıda): liste bayatlarsa — borç kapanırsa
 * ya da ikincisi doğarsa — test kırılır, sessizce affetmez.
 */
/**
 * Formun adsız kontrolleri.
 *
 * ── İP-A7d3: "BİLİNEN İSTİSNA" FİLTRESİ KALDIRILDI ──
 *
 * A7d1'de `MapPicker`ın adres arama kutusu adsızdı ve bu üç dal testinde
 * filtreyle affediliyordu. Filtre bilinçliydi ve yanına bir TERS PROVA
 * konmuştu: "istisna gerçekten render ediliyor mu" (`toBe(1)`). Borç dalga
 * 3'te kapanınca o ters prova kendiliğinden kırıldı ve mesajı da tam olarak
 * buydu — "bilinen istisna listesi bayatladı".
 *
 * Bu, filtrenin doğru tasarlandığının kanıtıdır: sessizce affetmeye devam
 * etmedi, borç kapandığı gün haber verdi.
 */
function formunAdsizlari(kap: HTMLElement) {
  return adsizKontroller(kap);
}
const yazmaIstegi = () => istekler.find((i) => i.method !== "get");

/* ══════════════ 1. Koşullu dallar × erişilebilir ad ══════════════ */

describe("İP-A7d1 (a) · her koşullu dal render edilir, her alanın adı vardır", () => {
  const dallar: { ad: string; kur: () => { baslangic: EditorState; kimlik: boolean } }[] = [
    {
      ad: "admin · YENİ kayıt (görsel yöneticisi yok, durum var)",
      kur: () => ({ baslangic: karisikHafta(), kimlik: true }),
    },
    {
      ad: "admin · DÜZENLEME (görsel yöneticisi var)",
      kur: () => ({ baslangic: duzenlemeHali(), kimlik: true }),
    },
    {
      ad: "operatör · ad salt-okunur, durum bölümü YOK",
      kur: () => ({ baslangic: duzenlemeHali(), kimlik: false }),
    },
  ];

  for (const dal of dallar) {
    it(`${dal.ad} — adsız form kontrolü YOK`, async () => {
      const { baslangic, kimlik } = dal.kur();
      const { container } = sar(baslangic, kimlik);
      await screen.findByRole("dialog");

      // Yalancı yeşil kapısı: hiç kontrol render edilmediyse "0 adsız" bir şey
      // kanıtlamaz. Bu formun en dar dalı bile onlarca alan taşır.
      expect(
        formKontrolleri(pencere()).length,
        "hiç form kontrolü render edilmedi — dal açılmamış olabilir"
      ).toBeGreaterThanOrEqual(15);

      const adsiz = formunAdsizlari(pencere());
      expect(
        adsiz,
        `adsız kontrol:\n${adsiz.map((a) => a.html).join("\n")}`
      ).toEqual([]);
      // İP-A7d3: eski ters prova ("bilinen istisna GERÇEKTEN render ediliyor")
      // KALKTI çünkü istisna kapandı. Yerine, harita arama kutusunun HÂLÂ
      // render edildiği ve artık ADLI olduğu iddiası geldi — yoksa "0 adsız"
      // kutu hiç basılmadığı için de doğru olabilirdi.
      expect(
        within(pencere()).getByRole("textbox", { name: "Haritada adres ara" })
      ).toBeTruthy();
      expect(container).toBeTruthy();
    });
  }

  it("admin YENİ dalında görsel yöneticisi yerine yönlendirme metni çıkar", async () => {
    sar(karisikHafta(), true);
    await screen.findByRole("dialog");
    expect(within(pencere()).getByText(/önce kütüphaneyi/i)).toBeTruthy();
  });

  it("operatör dalında görünürlük (durum) bölümü YOKTUR", async () => {
    sar(duzenlemeHali(), false);
    await screen.findByRole("dialog");
    expect(within(pencere()).queryByRole("button", { name: "Yayında" })).toBeNull();
    expect(within(pencere()).queryByRole("button", { name: "Gizli" })).toBeNull();
  });

  it("günü AÇIK yapınca saat alanları belirir ve ADLARI olur", async () => {
    // Dördüncü dal: gün kapalıyken saat alanları hiç render edilmez.
    const kapali = emptyEditor();
    sar(kapali, true);
    await screen.findByRole("dialog");

    const oncekiSayi = formKontrolleri(pencere()).length;
    fireEvent.click(within(pencere()).getByLabelText("Pazartesi açık"));

    await waitFor(() =>
      expect(formKontrolleri(pencere()).length).toBeGreaterThan(oncekiSayi)
    );
    expect(formunAdsizlari(pencere())).toEqual([]);
    expect(within(pencere()).getByLabelText("Pazartesi açılış saati")).toBeTruthy();
    expect(within(pencere()).getByLabelText("Pazartesi kapanış saati")).toBeTruthy();
  });
});

/* ══════════════ 2. Gönderim sözleşmesi ══════════════ */

describe("İP-A7d1 (a) · gönder düğmesi ve doğrulama", () => {
  it("gönder düğmesi geçerlilik yüzünden KAPANMAZ", async () => {
    sar(emptyEditor(), true);
    await screen.findByRole("dialog");
    const gonder = within(pencere()).getByRole("button", { name: "Ekle" });
    expect((gonder as HTMLButtonElement).disabled).toBe(false);
  });

  it("ad boşken gönderim YAPILMAZ; hata ALANDA çıkar ve odak oraya gider", async () => {
    sar(emptyEditor(), true);
    await screen.findByRole("dialog");

    fireEvent.click(within(pencere()).getByRole("button", { name: "Ekle" }));

    const alan = within(pencere()).getByLabelText(/Kütüphane Adı/);
    await waitFor(() => expect(alan.getAttribute("aria-invalid")).toBe("true"));
    expect(yazmaIstegi(), "geçersiz form sunucuya gitti").toBeUndefined();
    expect(document.activeElement, "odak ilk hatalı alana taşınmadı").toBe(alan);

    const tanim = alan.getAttribute("aria-describedby")!;
    expect(document.getElementById(tanim)?.textContent).toMatch(/ad/i);
  });

  it("ÇAPRAZ ALAN: kapanış açılıştan önceyse o günün alanında hata çıkar", async () => {
    const t = emptyEditor();
    t.name = "Test Kütüphanesi";
    t.hours = (t.hours ?? []).map((h) =>
      h.weekday === 0 ? { ...h, is_closed: false, open_minute: 600, close_minute: 540 } : h
    );
    sar(t, true);
    await screen.findByRole("dialog");

    fireEvent.click(within(pencere()).getByRole("button", { name: "Ekle" }));

    const kapanis = within(pencere()).getByLabelText("Pazartesi kapanış saati");
    await waitFor(() => expect(kapanis.getAttribute("aria-invalid")).toBe("true"));
    expect(yazmaIstegi()).toBeUndefined();
    expect(document.activeElement).toBe(kapanis);
  });

  it("geçerli formda gövde sunucuya gider ve saatler dakikaya çevrilir", async () => {
    const t = karisikHafta();
    t.name = "Test Kütüphanesi";
    sar(t, true);
    await screen.findByRole("dialog");

    fireEvent.click(within(pencere()).getByRole("button", { name: "Ekle" }));

    await waitFor(() => expect(yazmaIstegi()).toBeTruthy());
    const govde = yazmaIstegi()!.body as Record<string, unknown>;
    expect(govde.name).toBe("Test Kütüphanesi");
    const saatler = govde.hours as { weekday: number; open_minute: number | null }[];
    expect(saatler.find((h) => h.weekday === 0)?.open_minute).toBe(540);
    // Görsel alanları YALNIZ medya yöneticisinden yönetilir; gövdeye girmez.
    expect(govde).not.toHaveProperty("cover_url");
  });

  it("sunucu 422'si ALANIN altına yazılır, şeride düşmez", async () => {
    yazmaHatasi = {
      status: 422,
      data: { detail: [{ loc: ["body", "name"], msg: "Bu ad zaten kullanılıyor." }] },
    };
    const t = karisikHafta();
    t.name = "Test Kütüphanesi";
    sar(t, true);
    await screen.findByRole("dialog");

    fireEvent.click(within(pencere()).getByRole("button", { name: "Ekle" }));

    const alan = within(pencere()).getByLabelText(/Kütüphane Adı/);
    await waitFor(() => expect(alan.getAttribute("aria-invalid")).toBe("true"));
    const tanim = alan.getAttribute("aria-describedby")!;
    expect(document.getElementById(tanim)?.textContent).toBe("Bu ad zaten kullanılıyor.");
  });

  it("alana düşmeyen sunucu hatası ŞERİTTE görünür", async () => {
    yazmaHatasi = { status: 500, data: { detail: "Sunucu hatası" } };
    const t = karisikHafta();
    t.name = "Test Kütüphanesi";
    sar(t, true);
    await screen.findByRole("dialog");

    fireEvent.click(within(pencere()).getByRole("button", { name: "Ekle" }));
    expect(await within(pencere()).findByRole("alert")).toBeTruthy();
  });

  it("operatörde ad zorunlu DEĞİLDİR (kimlik yetkisi yok, alan salt-okunur)", async () => {
    // Ters prova: "ad zorunlu" kuralı koşulludur, koşulsuz değil.
    const t = duzenlemeHali();
    t.name = "";
    sar(t, false);
    await screen.findByRole("dialog");

    fireEvent.click(within(pencere()).getByRole("button", { name: "Güncelle" }));
    await waitFor(() => expect(yazmaIstegi()).toBeTruthy());
  });
});

/* ══════════════ 3. Pencere sözleşmesi ══════════════ */

describe("İP-A7d1 (a) · pencere ortak yüzeyden gelir", () => {
  it("pencere role=dialog + aria-modal taşır (etiketsiz overlay değil)", async () => {
    sar(karisikHafta(), true);
    const p = await screen.findByRole("dialog");
    expect(p.getAttribute("aria-modal")).toBe("true");
  });

  it("temiz formda ESC pencereyi kapatır", async () => {
    sar(karisikHafta(), true);
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("KİRLİ formda kapatma önce sorar (veri kaybı koruması)", async () => {
    sar(karisikHafta(), true);
    await screen.findByRole("dialog");

    fireEvent.change(within(pencere()).getByLabelText(/Telefon/), {
      target: { value: "0322 000 00 00" },
    });
    fireEvent.keyDown(document, { key: "Escape" });

    // Onay penceresi açılır ve editör KAPANMAZ.
    //
    // Not: editör panelini `getByRole("dialog")` ile aramak burada yanıltıcı
    // olurdu — onay penceresi (Radix) açıkken kardeş düğümlere `aria-hidden`
    // koyar ve editör erişilebilirlik ağacından geçici olarak düşer. Varlığı
    // DOM üzerinden okunur.
    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
    expect(
      document.querySelector('[role="dialog"]'),
      "onay sorulmadan editör kapandı"
    ).not.toBeNull();
  });
});
